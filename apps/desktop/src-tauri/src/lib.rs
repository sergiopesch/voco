mod config;
mod insertion;
mod transcribe;

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

// --- Model management ---

#[derive(serde::Serialize)]
pub struct ModelStatus {
    downloaded: bool,
    path: String,
    size_mb: f64,
}

#[tauri::command]
fn get_model_status() -> Result<ModelStatus, String> {
    let path = transcribe::default_model_path()?;
    let downloaded = path.exists();
    let size_mb = if downloaded {
        std::fs::metadata(&path)
            .map(|m| m.len() as f64 / 1_048_576.0)
            .unwrap_or(0.0)
    } else {
        0.0
    };
    Ok(ModelStatus {
        downloaded,
        path: path.to_string_lossy().to_string(),
        size_mb,
    })
}

#[tauri::command]
fn download_model() -> Result<String, String> {
    let path = transcribe::default_model_path()?;
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }

    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

    let response = reqwest::blocking::get(url)
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read response: {e}"))?;

    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to save model: {e}"))?;

    Ok(path.to_string_lossy().to_string())
}

// --- Transcription ---

#[tauri::command]
fn transcribe_audio(
    samples: Vec<f32>,
    state: tauri::State<'_, WhisperMutex>,
) -> Result<String, String> {
    if samples.is_empty() {
        return Err("No audio samples provided".to_string());
    }

    let model_path = transcribe::default_model_path()?;
    if !model_path.exists() {
        return Err("Model not downloaded. Please download the model first.".to_string());
    }

    let mut whisper = state
        .lock()
        .map_err(|e| format!("Failed to lock whisper state: {e}"))?;

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
fn test_toggle(app: tauri::AppHandle) -> Result<String, String> {
    eval_toggle(&app);
    Ok("toggled".to_string())
}

#[tauri::command]
fn insert_text(text: String, strategy: String) -> Result<InsertResult, String> {
    let result = insertion::insert_text(&text, &strategy)?;
    Ok(InsertResult {
        strategy: format!("{:?}", result.strategy).to_lowercase(),
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
                    request.allow();
                    true
                },
            );
        }).ok();
    }
}

// --- Invoke toggle on the frontend via JS eval ---

fn eval_toggle(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.eval("window.__toggleDictation && window.__toggleDictation()") {
            eprintln!("JS eval failed: {e}");
        }
    } else {
        eprintln!("Window 'main' not found");
    }
}

// --- Register global shortcut via Tauri plugin (primary mechanism) ---

fn register_global_shortcut(app: &tauri::App) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut: Shortcut = "Alt+D".parse().expect("valid shortcut");
    let handle = app.handle().clone();

    // Unregister first in case a previous instance left it registered
    let _ = app.global_shortcut().unregister(shortcut);

    if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            eprintln!("Alt+D detected via global shortcut plugin");
            eval_toggle(&handle);
        }
    }) {
        eprintln!("Failed to register global shortcut: {e}");
        eprintln!("Falling back to evdev/socket listeners");
    } else {
        eprintln!("Global shortcut Alt+D registered");
    }
}

// --- Socket listener for GNOME custom keybinding (fallback) ---

fn socket_path() -> std::path::PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(runtime_dir).join("voice-dictation.sock")
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

// --- Global hotkey via evdev (Wayland fallback, needs input group) ---

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
            eprintln!("  (then log out and back in)");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(WhisperState::new()) as WhisperMutex)
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_platform_info,
            get_model_status,
            download_model,
            transcribe_audio,
            insert_text,
            test_toggle,
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            grant_webview_permissions(app);
            register_global_shortcut(app);
            start_socket_listener(app.handle().clone());
            #[cfg(target_os = "linux")]
            start_hotkey_listener(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
