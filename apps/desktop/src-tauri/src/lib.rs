mod config;
mod insertion;
mod transcribe;
mod tray;

use config::{load_cached_update_check, save_cached_update_check, AppConfig, CachedUpdateCheck};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use tauri::{Emitter, Manager};
use transcribe::{WhisperMutex, WhisperState};

// Debounce: ignore duplicate toggle events that arrive almost immediately.
// This collapses duplicate keyboard backends and duplicate evdev devices
// without eating legitimate quick user toggles.
static LAST_TOGGLE_MS: AtomicI64 = AtomicI64::new(0);

// Evdev hotkey mode: 0 = Alt+D, 1 = Alt+Shift+D, 255 = custom (disabled)
static EVDEV_HOTKEY_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
static USE_EVDEV_HOTKEY: AtomicBool = AtomicBool::new(false);
static EVDEV_LISTENER_STARTED: AtomicBool = AtomicBool::new(false);
static HOTKEY_BINDING_VERSION: AtomicU64 = AtomicU64::new(0);
static REGISTERED_PLUGIN_SHORTCUT: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));

const TOGGLE_DICTATION_EVENT: &str = "voco:toggle-dictation";
const LEGACY_TOGGLE_DICTATION_EVENT: &str = "voice:toggle-dictation";
const TOGGLE_DEBOUNCE_MS: i64 = 120;
const HIDDEN_WINDOW_POS_X: i32 = -100;
const HIDDEN_WINDOW_POS_Y: i32 = -100;
const HIDDEN_WINDOW_SIZE: u32 = 1;
const OVERLAY_CURSOR_OFFSET_X: i32 = 20;
const OVERLAY_CURSOR_OFFSET_Y: i32 = 24;
const OVERLAY_MARGIN: i32 = 16;

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayPopoverAnchor {
    pub rect_position_x: i32,
    pub rect_position_y: i32,
    pub rect_width: u32,
    pub rect_height: u32,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn hotkey_to_evdev_mode(hotkey: &str) -> u8 {
    match hotkey {
        "Alt+D" => 0,
        "Alt+Shift+D" => 1,
        _ => 255,
    }
}

fn is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
}

fn prefers_evdev_hotkey(session_is_wayland: bool, hotkey: &str) -> bool {
    session_is_wayland && hotkey_to_evdev_mode(hotkey) != 255
}

fn should_register_global_shortcut(use_evdev_hotkey: bool) -> bool {
    !use_evdev_hotkey
}

fn should_start_evdev_listener(use_evdev_hotkey: bool, listener_started: bool) -> bool {
    use_evdev_hotkey && !listener_started
}

#[tauri::command]
fn get_config() -> Result<AppConfig, String> {
    AppConfig::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let previous = AppConfig::load().unwrap_or_default();
    let hotkey_changed = previous.hotkey != config.hotkey;

    if hotkey_changed {
        apply_hotkey_runtime_state(&app, &config.hotkey, false)?;
    }

    if let Err(error) = config.save() {
        if hotkey_changed {
            let _ = apply_hotkey_runtime_state(&app, &previous.hotkey, false);
        }
        return Err(error.to_string());
    }

    Ok(())
}

#[tauri::command]
fn load_cached_update_state() -> Result<Option<CachedUpdateCheck>, String> {
    load_cached_update_check().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_cached_update_state(cache: CachedUpdateCheck) -> Result<(), String> {
    save_cached_update_check(&cache).map_err(|e| e.to_string())
}

// --- Transcription ---

fn decode_audio_base64(encoded: &str) -> Result<Vec<f32>, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid audio data: {e}"))?;

    if bytes.len() % 4 != 0 {
        return Err("Audio data length is not a multiple of 4 bytes".to_string());
    }

    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
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

// --- Text insertion & notifications ---

#[tauri::command]
fn set_dictation_status(app: tauri::AppHandle, status: String) -> Result<(), String> {
    let status = match status.as_str() {
        "idle" => tray::DictationStatus::Idle,
        "recording" => tray::DictationStatus::Recording,
        "processing" => tray::DictationStatus::Processing,
        "error" => tray::DictationStatus::Error,
        _ => return Err(format!("Unknown dictation status: {status}")),
    };

    tray::set_dictation_status(&app, status);
    Ok(())
}

#[tauri::command]
fn set_microphone_ready(app: tauri::AppHandle, ready: bool) -> Result<(), String> {
    tray::update_microphone_ready(&app, ready);
    Ok(())
}

fn send_notification(summary: &str, body: &str) {
    let _ = std::process::Command::new("notify-send")
        .arg("--app-name=VOCO")
        .arg("--icon=audio-input-microphone")
        .arg("--")
        .arg(summary)
        .arg(body)
        .spawn();
}

#[tauri::command]
fn show_notification(summary: String, body: String) {
    send_notification(&summary, &body);
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https URLs are supported".to_string());
    }

    let status = std::process::Command::new("xdg-open")
        .arg(&url)
        .status()
        .map_err(|error| format!("Failed to open external URL: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("xdg-open exited with status {status}"))
    }
}

#[tauri::command]
fn insert_text(text: String, strategy: String) -> Result<insertion::InsertionResult, String> {
    if text.is_empty() {
        return Err("No text to insert".to_string());
    }
    if text.len() > 100_000 {
        return Err("Text too long for insertion (max 100KB)".to_string());
    }
    insertion::insert_text(&text, &strategy)
}

fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow<tauri::Wry>, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Window 'main' not found".to_string())
}

fn hide_overlay_window(window: &tauri::WebviewWindow<tauri::Wry>) -> Result<(), String> {
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            HIDDEN_WINDOW_SIZE,
            HIDDEN_WINDOW_SIZE,
        )))
        .map_err(|e| format!("Failed to shrink overlay window: {e}"))?;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            HIDDEN_WINDOW_POS_X,
            HIDDEN_WINDOW_POS_Y,
        )))
        .map_err(|e| format!("Failed to move overlay window off-screen: {e}"))?;

    Ok(())
}

fn clamp_overlay_position(
    cursor_x: i32,
    cursor_y: i32,
    bounds: Option<(i32, i32, u32, u32)>,
    width: u32,
    height: u32,
) -> (i32, i32) {
    let mut x = cursor_x + OVERLAY_CURSOR_OFFSET_X;
    let mut y = cursor_y + OVERLAY_CURSOR_OFFSET_Y;

    if let Some((monitor_x, monitor_y, monitor_width, monitor_height)) = bounds {
        let min_x = monitor_x + OVERLAY_MARGIN;
        let min_y = monitor_y + OVERLAY_MARGIN;
        let max_x = (monitor_x + monitor_width as i32 - width as i32 - OVERLAY_MARGIN).max(min_x);
        let max_y = (monitor_y + monitor_height as i32 - height as i32 - OVERLAY_MARGIN).max(min_y);

        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);
    }

    (x, y)
}

fn show_overlay_window(
    window: &tauri::WebviewWindow<tauri::Wry>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let cursor = window
        .cursor_position()
        .map_err(|e| format!("Failed to read cursor position: {e}"))?;

    let monitor = window
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    let bounds = monitor.as_ref().map(|monitor| {
        (
            monitor.position().x,
            monitor.position().y,
            monitor.size().width,
            monitor.size().height,
        )
    });

    let (x, y) = clamp_overlay_position(
        cursor.x.round() as i32,
        cursor.y.round() as i32,
        bounds,
        width,
        height,
    );

    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            width, height,
        )))
        .map_err(|e| format!("Failed to resize overlay window: {e}"))?;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )))
        .map_err(|e| format!("Failed to position overlay window: {e}"))?;

    Ok(())
}

#[tauri::command]
fn show_status_overlay(app: tauri::AppHandle, width: u32, height: u32) -> Result<(), String> {
    let window = main_window(&app)?;
    show_overlay_window(
        &window,
        width.max(HIDDEN_WINDOW_SIZE),
        height.max(HIDDEN_WINDOW_SIZE),
    )
}

#[tauri::command]
fn hide_status_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    hide_overlay_window(&window)
}

#[cfg(target_os = "linux")]
fn grant_webview_permissions(app: &tauri::App) {
    use glib::object::Cast;
    use webkit2gtk::PermissionRequestExt;
    use webkit2gtk::UserMediaPermissionRequestExt;
    use webkit2gtk::WebViewExt;

    if let Some(window) = app.get_webview_window("main") {
        window
            .with_webview(move |wv| {
                let Ok(webview) = wv.inner().clone().downcast::<webkit2gtk::WebView>() else {
                    warn!("Failed to downcast webview for permission hookup");
                    return;
                };
                webview.connect_permission_request(
                    |_wv, request: &webkit2gtk::PermissionRequest| {
                        if let Some(user_media_request) =
                            request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
                        {
                            let wants_audio = user_media_request.is_for_audio_device();
                            let wants_video = user_media_request.is_for_video_device();

                            if wants_audio && !wants_video {
                                request.allow();
                            } else {
                                request.deny();
                            }
                            true
                        } else {
                            false
                        }
                    },
                );
            })
            .ok();
    }
}

// --- Auto-download model on first launch ---

const MODEL_SHA256: &str = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";

fn ensure_model_downloaded(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let path = transcribe::default_model_path()?;
    if path.exists() {
        return Ok(());
    }

    let tmp_path = path.with_extension("bin.tmp");
    let _ = std::fs::remove_file(&tmp_path);

    let set_tray_tooltip = |msg: &str| {
        tray::update_tray_tooltip(app_handle, msg);
    };

    set_tray_tooltip("VOCO — Downloading model...");
    info!("Downloading speech model (one-time, ~142 MB)...");
    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        set_tray_tooltip("VOCO — Download failed");
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);

    use std::io::Read;
    let mut reader = response;
    let mut bytes = Vec::with_capacity(total_size as usize);
    let mut downloaded: u64 = 0;
    let mut last_pct: u64 = 0;
    let mut buf = [0u8; 65536];

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download read error: {e}"))?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        downloaded += n as u64;

        if total_size > 0 {
            let pct = (downloaded * 100) / total_size;
            if pct != last_pct {
                last_pct = pct;
                set_tray_tooltip(&format!("VOCO — Downloading model {}%", pct));
            }
        }
    }

    use sha2::Digest;
    let hash = format!("{:x}", sha2::Sha256::digest(&bytes));
    if hash != MODEL_SHA256 {
        set_tray_tooltip("VOCO — Download corrupt, retry on next launch");
        return Err(format!(
            "Model integrity check failed (expected {}, got {}). Download may be corrupt.",
            &MODEL_SHA256[..16],
            &hash[..16]
        ));
    }

    std::fs::write(&tmp_path, &bytes).map_err(|e| format!("Failed to save model (tmp): {e}"))?;
    std::fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to finalize model file: {e}"))?;

    set_tray_tooltip("VOCO");
    info!("Model downloaded and verified: {}", path.display());
    Ok(())
}

// --- Toggle dictation via window event ---

pub fn eval_toggle(app_handle: &tauri::AppHandle) {
    // Debounce with SeqCst to guarantee cross-thread visibility.
    let now = now_ms();
    let last = LAST_TOGGLE_MS.swap(now, Ordering::SeqCst);
    if (now - last).abs() < TOGGLE_DEBOUNCE_MS {
        debug!("eval_toggle debounced ({}ms since last)", now - last);
        return;
    }

    if let Err(e) = app_handle.emit_to("main", TOGGLE_DICTATION_EVENT, ()) {
        error!("Failed to emit toggle event: {e}");
    }
    let _ = app_handle.emit_to("main", LEGACY_TOGGLE_DICTATION_EVENT, ());
}

// --- Hotkey configuration ---

fn configured_hotkey() -> String {
    AppConfig::load()
        .map(|c| c.hotkey)
        .unwrap_or_else(|_| "Alt+D".to_string())
}

fn register_global_shortcut_listener(app: &tauri::AppHandle, hotkey: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut = hotkey
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid hotkey '{hotkey}': {e}"))?;
    let handle = app.clone();
    let label = hotkey.to_string();
    let binding_version = HOTKEY_BINDING_VERSION.fetch_add(1, Ordering::SeqCst) + 1;

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }

            let current_version = HOTKEY_BINDING_VERSION.load(Ordering::SeqCst);
            if current_version != binding_version {
                debug!(
                    "Ignoring stale global shortcut callback for {label} (binding version {}, latest {})",
                    binding_version, current_version
                );
                return;
            }

            if USE_EVDEV_HOTKEY.load(Ordering::SeqCst) {
                debug!("{label} detected via global shortcut plugin but evdev is preferred");
                return;
            }

            debug!("{label} detected via global shortcut plugin");
            eval_toggle(&handle);
        })
        .map_err(|e| format!("Failed to register global shortcut {hotkey}: {e}"))
}

fn sync_global_shortcut_binding(
    app: &tauri::AppHandle,
    hotkey: &str,
    enable_plugin_shortcut: bool,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let mut current = REGISTERED_PLUGIN_SHORTCUT
        .lock()
        .map_err(|_| "Failed to lock shortcut binding state".to_string())?;

    if let Some(existing) = current.clone() {
        if !enable_plugin_shortcut || existing != hotkey {
            if app.global_shortcut().is_registered(existing.as_str()) {
                app.global_shortcut()
                    .unregister(existing.as_str())
                    .map_err(|e| format!("Failed to unregister global shortcut {existing}: {e}"))?;
            }
            *current = None;
            HOTKEY_BINDING_VERSION.fetch_add(1, Ordering::SeqCst);
            info!("Unregistered previous global shortcut {existing}");
        }
    }

    if !enable_plugin_shortcut {
        return Ok(());
    }

    if current.as_deref() == Some(hotkey) {
        return Ok(());
    }

    register_global_shortcut_listener(app, hotkey)?;
    *current = Some(hotkey.to_string());
    info!("Registered global shortcut {hotkey}");
    Ok(())
}

fn apply_hotkey_runtime_state(
    app: &tauri::AppHandle,
    new_hotkey: &str,
    notify: bool,
) -> Result<(), String> {
    let use_evdev_hotkey = prefers_evdev_hotkey(is_wayland_session(), new_hotkey);

    #[cfg(target_os = "linux")]
    if should_start_evdev_listener(
        use_evdev_hotkey,
        EVDEV_LISTENER_STARTED.load(Ordering::SeqCst),
    ) {
        ensure_evdev_hotkey_listener(app);
    }

    sync_global_shortcut_binding(
        app,
        new_hotkey,
        should_register_global_shortcut(use_evdev_hotkey),
    )?;

    USE_EVDEV_HOTKEY.store(use_evdev_hotkey, Ordering::SeqCst);
    EVDEV_HOTKEY_MODE.store(hotkey_to_evdev_mode(new_hotkey), Ordering::SeqCst);

    tray::update_hotkey_display(app, new_hotkey);
    info!("Hotkey changed to {new_hotkey}");
    info!(
        "Hotkey runtime backend preference: {}",
        if use_evdev_hotkey {
            "evdev"
        } else {
            "global-shortcut"
        }
    );

    if notify {
        send_notification(
            "Hotkey changed",
            &format!("VOCO will now respond to {new_hotkey}"),
        );
    }

    Ok(())
}

/// Change the hotkey at runtime.
pub fn change_hotkey_runtime(app: &tauri::AppHandle, new_hotkey: &str) -> Result<(), String> {
    let mut config = AppConfig::load().map_err(|e| e.to_string())?;
    let previous_hotkey = config.hotkey.clone();
    apply_hotkey_runtime_state(app, new_hotkey, true)?;
    config.hotkey = new_hotkey.to_string();
    if let Err(error) = config.save() {
        let _ = apply_hotkey_runtime_state(app, &previous_hotkey, false);
        return Err(error.to_string());
    }

    Ok(())
}

// --- Socket listener ---

fn socket_path() -> std::path::PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(runtime_dir).join("voco.sock")
}

fn legacy_socket_path() -> std::path::PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(runtime_dir).join("voice.sock")
}

fn start_socket_listener(app_handle: tauri::AppHandle) {
    use std::os::unix::net::UnixListener;

    for path in [socket_path(), legacy_socket_path()] {
        let handle = app_handle.clone();
        std::thread::spawn(move || loop {
            let _ = std::fs::remove_file(&path);

            let listener = match UnixListener::bind(&path) {
                Ok(l) => l,
                Err(e) => {
                    error!("Failed to create socket at {}: {e}", path.display());
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    continue;
                }
            };

            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            info!("Socket listener ready: {}", path.display());

            for stream in listener.incoming() {
                match stream {
                    Ok(_) => {
                        debug!("Toggle received via socket");
                        eval_toggle(&handle);
                    }
                    Err(e) => {
                        warn!("Socket accept error (will rebind): {e}");
                        break;
                    }
                }
            }
        });
    }
}

// --- evdev hotkey listener (primary mechanism on Wayland) ---

#[cfg(target_os = "linux")]
fn start_hotkey_listener(app_handle: tauri::AppHandle) -> bool {
    use evdev::{Device, InputEventKind, Key};

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
        warn!("No keyboard found for evdev. Add user to 'input' group: sudo usermod -aG input $USER");
        return false;
    }

    info!(
        "evdev hotkey listener started on {} keyboard(s)",
        devices.len()
    );

    let alt_held = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shift_held = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    for device in devices {
        let app = app_handle.clone();
        let alt = alt_held.clone();
        let shift = shift_held.clone();

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
                                        alt.store(pressed, Ordering::SeqCst);
                                    }
                                    Key::KEY_LEFTSHIFT | Key::KEY_RIGHTSHIFT => {
                                        shift.store(pressed, Ordering::SeqCst);
                                    }
                                    Key::KEY_D if pressed && !repeat => {
                                        let mode = EVDEV_HOTKEY_MODE.load(Ordering::SeqCst);
                                        let alt_down = alt.load(Ordering::SeqCst);
                                        let shift_down = shift.load(Ordering::SeqCst);

                                        let matched = match mode {
                                            0 => alt_down && !shift_down,
                                            1 => alt_down && shift_down,
                                            _ => false,
                                        };

                                        if matched {
                                            debug!("Hotkey detected via evdev (mode {})", mode);
                                            eval_toggle(&app);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Keyboard read error: {e}");
                        break;
                    }
                }
            }
        });
    }

    true
}

#[cfg(target_os = "linux")]
fn ensure_evdev_hotkey_listener(app_handle: &tauri::AppHandle) {
    if EVDEV_LISTENER_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    if !start_hotkey_listener(app_handle.clone()) {
        EVDEV_LISTENER_STARTED.store(false, Ordering::SeqCst);
    }
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(WhisperState::new()) as WhisperMutex)
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            load_cached_update_state,
            save_cached_update_state,
            transcribe_audio,
            insert_text,
            set_dictation_status,
            set_microphone_ready,
            show_status_overlay,
            hide_status_overlay,
            show_notification,
            open_external_url,
        ])
        .setup(|app| {
            let startup_ms = now_ms();
            let hotkey = configured_hotkey();
            let app_handle = app.handle().clone();
            EVDEV_HOTKEY_MODE.store(hotkey_to_evdev_mode(&hotkey), Ordering::SeqCst);
            let wayland_session = is_wayland_session();
            let use_evdev_hotkey = prefers_evdev_hotkey(wayland_session, &hotkey);
            USE_EVDEV_HOTKEY.store(use_evdev_hotkey, Ordering::SeqCst);

            #[cfg(target_os = "linux")]
            grant_webview_permissions(app);

            // Force WebView to load eagerly (required for Wayland)
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_always_on_top(true);
                let _ = window.set_ignore_cursor_events(true);
                let _ = hide_overlay_window(&window);
            }

            if let Err(e) = sync_global_shortcut_binding(
                &app_handle,
                &hotkey,
                should_register_global_shortcut(use_evdev_hotkey),
            ) {
                warn!("{e}");
            }

            if use_evdev_hotkey {
                info!("evdev hotkey backend active for {hotkey}");
            } else {
                info!("global shortcut backend active for {hotkey}");
            }

            info!("Hotkey listener attached");
            info!(
                "[timing] app start -> hotkey backend attachment: {}ms",
                now_ms() - startup_ms
            );

            start_socket_listener(app_handle.clone());

            #[cfg(target_os = "linux")]
            if use_evdev_hotkey {
                ensure_evdev_hotkey_listener(&app_handle);
            }

            if let Err(e) = tray::setup_tray(app, &hotkey) {
                error!("Failed to setup tray: {e}");
            }

            let download_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = ensure_model_downloaded(&download_handle) {
                    error!("Model auto-download failed: {e}");
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = std::fs::remove_file(socket_path());
                let _ = std::fs::remove_file(legacy_socket_path());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_audio_base64_valid() {
        use base64::Engine;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0.5f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.5f32).to_le_bytes());
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let samples = decode_audio_base64(&encoded).unwrap();
        assert_eq!(samples.len(), 2);
        assert!((samples[0] - 0.5).abs() < f32::EPSILON);
        assert!((samples[1] + 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn decode_audio_base64_empty() {
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"");
        assert!(decode_audio_base64(&encoded).unwrap().is_empty());
    }

    #[test]
    fn decode_audio_base64_invalid_length() {
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"abc");
        assert!(decode_audio_base64(&encoded)
            .unwrap_err()
            .contains("not a multiple of 4"));
    }

    #[test]
    fn decode_audio_base64_invalid_encoding() {
        assert!(decode_audio_base64("not-valid-base64!!!").is_err());
    }

    #[test]
    fn socket_path_uses_xdg_runtime_dir() {
        assert!(socket_path().to_str().unwrap().ends_with("voco.sock"));
    }

    #[test]
    fn configured_hotkey_returns_nonempty() {
        assert!(!configured_hotkey().is_empty());
    }

    #[test]
    fn hotkey_modes() {
        assert_eq!(hotkey_to_evdev_mode("Alt+D"), 0);
        assert_eq!(hotkey_to_evdev_mode("Alt+Shift+D"), 1);
        assert_eq!(hotkey_to_evdev_mode("Ctrl+Shift+V"), 255);
    }

    #[test]
    fn evdev_hotkey_backend_only_handles_supported_wayland_shortcuts() {
        assert!(prefers_evdev_hotkey(true, "Alt+D"));
        assert!(prefers_evdev_hotkey(true, "Alt+Shift+D"));
        assert!(!prefers_evdev_hotkey(true, "Ctrl+Shift+V"));
        assert!(!prefers_evdev_hotkey(false, "Alt+D"));
    }

    #[test]
    fn global_shortcut_registration_depends_on_backend_selection() {
        assert!(should_register_global_shortcut(false));
        assert!(!should_register_global_shortcut(true));
    }

    #[test]
    fn evdev_listener_only_starts_once_for_supported_runtime_hotkeys() {
        assert!(should_start_evdev_listener(true, false));
        assert!(!should_start_evdev_listener(true, true));
        assert!(!should_start_evdev_listener(false, false));
    }

    #[test]
    fn overlay_position_uses_cursor_offset_without_monitor_bounds() {
        assert_eq!(clamp_overlay_position(100, 150, None, 252, 112), (120, 174));
    }

    #[test]
    fn overlay_position_stays_inside_monitor_bounds() {
        assert_eq!(
            clamp_overlay_position(1900, 1060, Some((0, 0, 1920, 1080)), 252, 112),
            (1652, 952)
        );
    }

    #[test]
    fn overlay_position_handles_small_monitor_bounds() {
        assert_eq!(
            clamp_overlay_position(20, 20, Some((0, 0, 120, 90)), 252, 112),
            (16, 16)
        );
    }
}
