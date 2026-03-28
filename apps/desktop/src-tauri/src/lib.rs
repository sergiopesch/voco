mod config;
mod insertion;
mod transcribe;
mod tray;

use config::AppConfig;
use std::sync::Mutex;
use transcribe::{WhisperMutex, WhisperState};

#[tauri::command]
fn get_config() -> Result<AppConfig, String> {
    AppConfig::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        session_type: std::env::var("XDG_SESSION_TYPE").unwrap_or_default(),
        desktop: std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
    }
}

#[derive(serde::Serialize)]
pub struct PlatformInfo {
    os: String,
    arch: String,
    session_type: String,
    desktop: String,
}

// --- Transcription ---

/// Decode base64-encoded little-endian f32 audio samples.
fn decode_audio_base64(encoded: &str) -> Result<Vec<f32>, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid audio data: {e}"))?;

    if bytes.len() % 4 != 0 {
        return Err("Audio data length is not a multiple of 4 bytes".to_string());
    }

    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    Ok(samples)
}

#[tauri::command]
fn transcribe_audio(
    audio_base64: String,
    state: tauri::State<'_, WhisperMutex>,
) -> Result<String, String> {
    let samples = decode_audio_base64(&audio_base64)?;

    if samples.is_empty() {
        return Err("No audio samples provided".to_string());
    }

    // Reject audio longer than 5 minutes at 16kHz (4.8M samples)
    if samples.len() > 16000 * 300 {
        return Err("Audio too long (max 5 minutes)".to_string());
    }

    let model_path = transcribe::default_model_path()?;
    if !model_path.exists() {
        return Err("Model not downloaded. Please download the model first.".to_string());
    }

    let mut whisper = state
        .try_lock()
        .map_err(|_| "Transcription already in progress".to_string())?;

    whisper.load_model(&model_path)?;
    whisper.transcribe(&samples)
}

// --- Text insertion ---

#[derive(serde::Serialize)]
pub struct InsertResult {
    strategy: String,
    success: bool,
}

#[tauri::command]
fn set_recording_state(app: tauri::AppHandle, recording: bool) -> Result<(), String> {
    tray::update_tray_icon(&app, recording);
    Ok(())
}

#[tauri::command]
fn show_notification(summary: String, body: String) {
    let _ = std::process::Command::new("notify-send")
        .arg("--app-name=Voice")
        .arg("--icon=audio-input-microphone")
        .arg("--")
        .arg(&summary)
        .arg(&body)
        .spawn();
}

#[tauri::command]
fn insert_text(text: String, strategy: String) -> Result<InsertResult, String> {
    if text.is_empty() {
        return Err("No text to insert".to_string());
    }
    // Reject unreasonably large text to prevent shell argument overflow
    if text.len() > 100_000 {
        return Err("Text too long for insertion (max 100KB)".to_string());
    }

    let result = insertion::insert_text(&text, &strategy)?;
    Ok(InsertResult {
        strategy: serde_json::to_value(&result.strategy)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "unknown".to_string()),
        success: result.success,
    })
}

#[cfg(target_os = "linux")]
fn grant_webview_permissions(app: &tauri::App) {
    use glib::object::Cast;
    use tauri::Manager;
    use webkit2gtk::PermissionRequestExt;
    use webkit2gtk::WebViewExt;

    if let Some(window) = app.get_webview_window("main") {
        window.with_webview(move |wv| {
            let webview: webkit2gtk::WebView = wv.inner().clone().downcast().unwrap();
            webview.connect_permission_request(
                |_wv, request: &webkit2gtk::PermissionRequest| {
                    // Only auto-grant UserMedia (microphone) requests
                    if request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>().is_some() {
                        request.allow();
                        true
                    } else {
                        false
                    }
                },
            );
        }).ok();
    }
}

// --- Auto-download model on first launch ---

const MODEL_SHA256: &str = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";

fn ensure_model_downloaded(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let path = transcribe::default_model_path()?;
    if path.exists() {
        return Ok(());
    }

    // Clean up any leftover partial download from a previous interrupted attempt
    let tmp_path = path.with_extension("bin.tmp");
    let _ = std::fs::remove_file(&tmp_path);

    let set_tray_tooltip = |msg: &str| {
        tray::update_tray_tooltip(app_handle, msg);
    };

    set_tray_tooltip("Voice — Downloading model...");
    eprintln!("Downloading speech model (one-time, ~142 MB)...");
    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client.get(url).send()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        set_tray_tooltip("Voice — Download failed");
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);

    // Stream the download to track progress
    use std::io::Read;
    let mut reader = response;
    let mut bytes = Vec::with_capacity(total_size as usize);
    let mut downloaded: u64 = 0;
    let mut last_pct: u64 = 0;
    let mut buf = [0u8; 65536];

    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download read error: {e}"))?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        downloaded += n as u64;

        if total_size > 0 {
            let pct = (downloaded * 100) / total_size;
            if pct != last_pct {
                last_pct = pct;
                set_tray_tooltip(&format!("Voice — Downloading model {}%", pct));
            }
        }
    }

    // Verify integrity before writing
    use sha2::Digest;
    let hash = format!("{:x}", sha2::Sha256::digest(&bytes));
    if hash != MODEL_SHA256 {
        set_tray_tooltip("Voice — Download corrupt, retry on next launch");
        return Err(format!(
            "Model integrity check failed (expected {}, got {}). Download may be corrupt.",
            &MODEL_SHA256[..16], &hash[..16]
        ));
    }

    // Write to a temporary file first, then atomically rename to the final path.
    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Failed to save model (tmp): {e}"))?;

    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize model file: {e}"))?;

    set_tray_tooltip("Voice");
    eprintln!("Model downloaded and verified: {}", path.display());
    Ok(())
}

// --- Invoke toggle on the frontend via JS eval ---

pub fn eval_toggle(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        // Window must be "shown" for WebKitGTK to run JS and getUserMedia.
        // We keep it at 1x1 off-screen so user never sees it.
        // Spawn so the 100ms delay doesn't block the caller (shortcut/evdev/socket thread).
        std::thread::spawn(move || {
            let _ = window.show();
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Err(e) = window.eval("window.__toggleDictation && window.__toggleDictation()") {
                eprintln!("JS eval failed: {e}");
            }
        });
    } else {
        eprintln!("Window 'main' not found");
    }
}

// --- Register global shortcut via Tauri plugin (primary mechanism) ---

/// Read the configured hotkey, falling back to "Alt+D" on error.
fn configured_hotkey() -> String {
    AppConfig::load()
        .map(|c| c.hotkey)
        .unwrap_or_else(|_| "Alt+D".to_string())
}

fn register_global_shortcut(app: &tauri::App, hotkey: &str) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut: Shortcut = match hotkey.parse() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to parse shortcut {hotkey}: {e}");
            return;
        }
    };
    let handle = app.handle().clone();
    let hotkey_label = hotkey.to_string();

    let _ = app.global_shortcut().unregister(shortcut);

    if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            eprintln!("{hotkey_label} detected via global shortcut plugin");
            eval_toggle(&handle);
        }
    }) {
        eprintln!("Failed to register global shortcut: {e}");
    } else {
        eprintln!("Global shortcut {hotkey} registered");
    }
}

// --- Socket listener for external triggers ---

fn socket_path() -> std::path::PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(runtime_dir).join("voice.sock")
}

fn start_socket_listener(app_handle: tauri::AppHandle) {
    use std::os::unix::net::UnixListener;

    let path = socket_path();
    let _ = std::fs::remove_file(&path);

    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to create socket at {}: {e}", path.display());
            return;
        }
    };

    // Restrict socket to owner only (prevent other users from triggering dictation)
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));

    eprintln!("Socket listener ready: {}", path.display());

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(_) => {
                    eprintln!("Toggle received via socket");
                    eval_toggle(&app_handle);
                }
                Err(e) => {
                    eprintln!("Socket error: {e}");
                    break;
                }
            }
        }
    });
}

// --- Global hotkey via evdev (Wayland, needs input group) ---

#[cfg(target_os = "linux")]
fn start_hotkey_listener(app_handle: tauri::AppHandle) {
    use evdev::{Device, InputEventKind, Key};

    std::thread::spawn(move || {
        let devices = evdev::enumerate()
            .filter_map(|(_, device)| {
                let keys = device.supported_keys()?;
                if keys.contains(Key::KEY_A) && keys.contains(Key::KEY_LEFTALT) {
                    Some(device)
                } else {
                    None
                }
            })
            .collect::<Vec<Device>>();

        if devices.is_empty() {
            eprintln!("No keyboard found for evdev hotkey listener. Add user to 'input' group:");
            eprintln!("  sudo usermod -aG input $USER");
            return;
        }

        eprintln!("evdev hotkey listener started on {} keyboard(s)", devices.len());

        let alt_held = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        for device in devices {
            let app = app_handle.clone();
            let alt = alt_held.clone();

            std::thread::spawn(move || {
                let mut dev = device;
                loop {
                    match dev.fetch_events() {
                        Ok(events) => {
                            for ev in events {
                                if let InputEventKind::Key(key) = ev.kind() {
                                    let pressed = ev.value() == 1;
                                    let repeat = ev.value() == 2;

                                    match key {
                                        Key::KEY_LEFTALT | Key::KEY_RIGHTALT => {
                                            alt.store(pressed, std::sync::atomic::Ordering::Relaxed);
                                        }
                                        Key::KEY_D if pressed && !repeat => {
                                            if alt.load(std::sync::atomic::Ordering::Relaxed) {
                                                eprintln!("Alt+D detected via evdev");
                                                eval_toggle(&app);
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Keyboard read error: {e}");
                            break;
                        }
                    }
                }
            });
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(WhisperState::new()) as WhisperMutex)
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_platform_info,
            transcribe_audio,
            insert_text,
            set_recording_state,
            show_notification,
        ])
        .setup(|app| {
            let hotkey = configured_hotkey();

            #[cfg(target_os = "linux")]
            grant_webview_permissions(app);
            register_global_shortcut(app, &hotkey);
            start_socket_listener(app.handle().clone());
            #[cfg(target_os = "linux")]
            start_hotkey_listener(app.handle().clone());

            if let Err(e) = tray::setup_tray(app, &hotkey) {
                eprintln!("Failed to setup tray: {e}");
            }

            // Auto-download model in background if not present
            let download_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = ensure_model_downloaded(&download_handle) {
                    eprintln!("Model auto-download failed: {e}");
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                // Clean up the Unix socket on exit
                let _ = std::fs::remove_file(socket_path());
            }
        });
}
