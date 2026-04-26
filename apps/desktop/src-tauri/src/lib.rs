mod config;
mod insertion;
mod transcribe;
mod tray;

use config::{load_cached_update_check, save_cached_update_check, AppConfig, CachedUpdateCheck};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
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
static FRONTEND_HOTKEY_HANDLER_READY: AtomicBool = AtomicBool::new(false);
static PENDING_TOGGLE_BACKEND: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static TRACE_START: LazyLock<Instant> = LazyLock::new(Instant::now);
static TRACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TRACE_FILE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static REGISTERED_PLUGIN_SHORTCUT: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "linux")]
static EVDEV_WATCHED_PATHS: LazyLock<Mutex<std::collections::HashSet<std::path::PathBuf>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

const TOGGLE_DICTATION_EVENT: &str = "voco:toggle-dictation";
const LEGACY_TOGGLE_DICTATION_EVENT: &str = "voice:toggle-dictation";
const TOGGLE_DEBOUNCE_MS: i64 = 120;
const MAX_AUDIO_SECONDS: usize = 60;
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

fn monotonic_trace_ms() -> u128 {
    TRACE_START.elapsed().as_micros() / 1000
}

fn xdg_state_home() -> std::path::PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map(std::path::PathBuf::from)
        .or_else(dirs::state_dir)
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/state")))
        .unwrap_or_else(std::env::temp_dir)
}

fn hotkey_trace_path() -> std::path::PathBuf {
    xdg_state_home().join("voco").join("hotkey-trace.jsonl")
}

fn session_type_label() -> &'static str {
    match std::env::var("XDG_SESSION_TYPE") {
        Ok(value) if value.eq_ignore_ascii_case("wayland") => "Wayland",
        Ok(value) if value.eq_ignore_ascii_case("x11") => "X11",
        _ => "unknown",
    }
}

fn selected_backend_label() -> &'static str {
    if USE_EVDEV_HOTKEY.load(Ordering::SeqCst) {
        "evdev"
    } else {
        "global_shortcut"
    }
}

pub fn trace_hotkey_event(event: &str, backend_used: Option<&str>) {
    let path = hotkey_trace_path();
    let Some(parent) = path.parent() else {
        return;
    };
    if let Err(error) = std::fs::create_dir_all(parent) {
        warn!(
            "Failed to create hotkey trace directory {}: {error}",
            parent.display()
        );
        return;
    }

    let backend = match backend_used {
        Some(value) => value,
        None => selected_backend_label(),
    };
    let record = serde_json::json!({
        "seq": TRACE_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1,
        "event": event,
        "t_ms": monotonic_trace_ms(),
        "backend_used": backend,
        "session_type": session_type_label(),
    });

    let line = match serde_json::to_string(&record) {
        Ok(line) => line,
        Err(error) => {
            warn!("Failed to encode hotkey trace event {event}: {error}");
            return;
        }
    };

    use std::io::Write;
    let _guard = match TRACE_FILE_LOCK.lock() {
        Ok(guard) => guard,
        Err(error) => {
            warn!("Failed to lock hotkey trace writer: {error}");
            return;
        }
    };
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(mut file) => {
            if let Err(error) = writeln!(file, "{line}") {
                warn!(
                    "Failed to write hotkey trace event to {}: {error}",
                    path.display()
                );
            }
        }
        Err(error) => warn!(
            "Failed to open hotkey trace file {}: {error}",
            path.display()
        ),
    }
}

#[tauri::command]
fn trace_frontend_hotkey_event(app: tauri::AppHandle, event: String) -> Result<(), String> {
    match event.as_str() {
        "frontend_main_module_loaded"
        | "frontend_render_requested"
        | "frontend_app_mounted"
        | "frontend_init_started"
        | "frontend_config_load_started"
        | "frontend_config_loaded"
        | "frontend_audio_prepare_started"
        | "frontend_audio_prepare_done"
        | "frontend_init_complete"
        | "frontend_hotkey_listener_registered" => {
            trace_hotkey_event(&event, None);
            Ok(())
        }
        "frontend_hotkey_handler_ready" => {
            trace_hotkey_event(&event, None);
            FRONTEND_HOTKEY_HANDLER_READY.store(true, Ordering::SeqCst);
            replay_pending_toggle(&app);
            Ok(())
        }
        "frontend_toggle_received"
        | "recording_state_requested"
        | "recording_get_user_media_started"
        | "recording_get_user_media_done"
        | "recording_audio_context_ready"
        | "recording_media_source_created"
        | "recording_worklet_connected"
        | "recording_script_processor_connected"
        | "recording_state_active" => {
            trace_hotkey_event(&event, None);
            Ok(())
        }
        _ => Err(format!("Unsupported hotkey trace event: {event}")),
    }
}

#[tauri::command]
fn has_pending_hotkey_toggle() -> bool {
    PENDING_TOGGLE_BACKEND
        .lock()
        .map(|pending_backend| pending_backend.is_some())
        .unwrap_or(false)
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

fn decode_audio_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if !bytes.len().is_multiple_of(4) {
        return Err("Audio data length is not a multiple of 4 bytes".to_string());
    }

    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

#[tauri::command]
fn transcribe_audio(
    audio_bytes: Vec<u8>,
    state: tauri::State<'_, WhisperMutex>,
) -> Result<String, String> {
    let samples = decode_audio_bytes(&audio_bytes)?;

    if samples.is_empty() {
        return Err("No audio samples provided".to_string());
    }
    if samples.len() > 16000 * MAX_AUDIO_SECONDS {
        return Err(format!(
            "Audio too long (max {} seconds)",
            MAX_AUDIO_SECONDS
        ));
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

#[tauri::command]
fn get_runtime_diagnostics() -> insertion::RuntimeDiagnostics {
    insertion::runtime_diagnostics()
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
    eval_toggle_with_backend(app_handle, "internal");
}

fn emit_toggle_event(app_handle: &tauri::AppHandle, backend_used: &str) {
    if let Err(e) = app_handle.emit_to("main", TOGGLE_DICTATION_EVENT, ()) {
        error!("Failed to emit toggle event: {e}");
    } else {
        trace_hotkey_event("toggle_event_emitted", Some(backend_used));
    }
    let _ = app_handle.emit_to("main", LEGACY_TOGGLE_DICTATION_EVENT, ());
}

fn buffer_toggle_until_frontend_ready(backend_used: &str) {
    let Ok(mut pending_backend) = PENDING_TOGGLE_BACKEND.lock() else {
        error!("Failed to lock pending toggle state");
        return;
    };

    if pending_backend.is_none() {
        *pending_backend = Some(backend_used.to_string());
    }
    trace_hotkey_event("toggle_event_buffered", Some(backend_used));
}

fn replay_pending_toggle(app_handle: &tauri::AppHandle) {
    let pending_backend = match PENDING_TOGGLE_BACKEND.lock() {
        Ok(mut pending_backend) => pending_backend.take(),
        Err(error) => {
            error!("Failed to lock pending toggle state: {error}");
            None
        }
    };

    if let Some(backend_used) = pending_backend {
        trace_hotkey_event("pending_toggle_replayed", Some(&backend_used));
        emit_toggle_event(app_handle, &backend_used);
    }
}

fn eval_toggle_with_backend(app_handle: &tauri::AppHandle, backend_used: &str) {
    trace_hotkey_event("eval_toggle_entered", Some(backend_used));

    // Debounce with SeqCst to guarantee cross-thread visibility.
    let now = now_ms();
    let last = LAST_TOGGLE_MS.swap(now, Ordering::SeqCst);
    if (now - last).abs() < TOGGLE_DEBOUNCE_MS {
        debug!("eval_toggle debounced ({}ms since last)", now - last);
        trace_hotkey_event("eval_toggle_debounced", Some(backend_used));
        return;
    }

    if !FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst) {
        buffer_toggle_until_frontend_ready(backend_used);
        return;
    }

    emit_toggle_event(app_handle, backend_used);
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
            trace_hotkey_event("hotkey_event_received_global_shortcut", Some("global_shortcut"));
            eval_toggle_with_backend(&handle, "global_shortcut");
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
    trace_hotkey_event("global_shortcut_registered", Some("global_shortcut"));
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

fn socket_base_dir_from(runtime_dir: Option<std::ffi::OsString>) -> std::path::PathBuf {
    if let Some(runtime_dir) = runtime_dir {
        return std::path::PathBuf::from(runtime_dir);
    }

    std::env::temp_dir().join(format!("voco-{}", current_effective_uid()))
}

#[cfg(target_os = "linux")]
fn current_effective_uid() -> u32 {
    // SAFETY: `geteuid` has no preconditions and simply returns the current process euid.
    unsafe { libc::geteuid() as u32 }
}

#[cfg(not(target_os = "linux"))]
fn current_effective_uid() -> u32 {
    0
}

fn socket_base_dir() -> std::path::PathBuf {
    socket_base_dir_from(std::env::var_os("XDG_RUNTIME_DIR"))
}

fn socket_path() -> std::path::PathBuf {
    socket_base_dir().join("voco.sock")
}

fn legacy_socket_path() -> std::path::PathBuf {
    socket_base_dir().join("voice.sock")
}

fn cleanup_socket_paths<I>(paths: I)
where
    I: IntoIterator<Item = std::path::PathBuf>,
{
    for path in paths {
        match std::fs::remove_file(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => warn!("Failed to remove socket {}: {error}", path.display()),
        }
    }
}

fn cleanup_socket_files() {
    cleanup_socket_paths([socket_path(), legacy_socket_path()]);
}

#[cfg(target_os = "linux")]
fn install_socket_cleanup_signal_handler() {
    let mut signals = std::mem::MaybeUninit::<libc::sigset_t>::uninit();
    // SAFETY: `sigemptyset`, `sigaddset`, and `pthread_sigmask` are called with valid pointers,
    // and the signal set is fully initialized before it is used by `sigwait`.
    unsafe {
        libc::sigemptyset(signals.as_mut_ptr());
        libc::sigaddset(signals.as_mut_ptr(), libc::SIGINT);
        libc::sigaddset(signals.as_mut_ptr(), libc::SIGTERM);

        let signals = signals.assume_init();
        let mask_status = libc::pthread_sigmask(libc::SIG_BLOCK, &signals, std::ptr::null_mut());
        if mask_status != 0 {
            warn!("Failed to install socket cleanup signal mask: {mask_status}");
            return;
        }

        std::thread::spawn(move || loop {
            let mut received_signal = 0;
            let wait_status = libc::sigwait(&signals, &mut received_signal);
            if wait_status != 0 {
                warn!("sigwait failed while waiting for shutdown signal: {wait_status}");
                continue;
            }

            cleanup_socket_files();
            std::process::exit(128 + received_signal);
        });
    }
}

fn ensure_socket_parent_dir(path: &std::path::Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Socket path has no parent: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create socket dir {}: {e}", parent.display()))?;

    if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Failed to secure socket dir {}: {e}", parent.display()))?;
        }
    }

    Ok(())
}

fn start_socket_listener(app_handle: tauri::AppHandle) {
    use std::os::unix::net::UnixListener;

    for path in [socket_path(), legacy_socket_path()] {
        let handle = app_handle.clone();
        std::thread::spawn(move || loop {
            if let Err(e) = ensure_socket_parent_dir(&path) {
                error!("{e}");
                std::thread::sleep(std::time::Duration::from_secs(2));
                continue;
            }

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
                        trace_hotkey_event("socket_toggle_received", Some("socket"));
                        eval_toggle_with_backend(&handle, "socket");
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
fn supports_evdev_hotkey(device: &evdev::Device) -> bool {
    let Some(keys) = device.supported_keys() else {
        return false;
    };

    let has_alt = keys.contains(evdev::Key::KEY_LEFTALT) || keys.contains(evdev::Key::KEY_RIGHTALT);
    let has_d = keys.contains(evdev::Key::KEY_D);
    has_alt && has_d
}

#[cfg(target_os = "linux")]
fn supported_evdev_keyboard_paths() -> Vec<std::path::PathBuf> {
    evdev::enumerate()
        .filter_map(|(path, device)| supports_evdev_hotkey(&device).then_some(path))
        .collect()
}

#[cfg(target_os = "linux")]
fn mark_evdev_path_watched(path: &std::path::Path) -> bool {
    let Ok(mut watched_paths) = EVDEV_WATCHED_PATHS.lock() else {
        error!("Failed to lock evdev watched path set");
        return false;
    };

    watched_paths.insert(path.to_path_buf())
}

#[cfg(target_os = "linux")]
fn spawn_supported_evdev_device_workers(
    app_handle: &tauri::AppHandle,
    alt_held: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    shift_held: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> usize {
    let mut discovered = 0;

    for path in supported_evdev_keyboard_paths() {
        if mark_evdev_path_watched(&path) {
            discovered += 1;
            info!("Discovered evdev keyboard: {}", path.display());
            spawn_evdev_device_worker(
                app_handle.clone(),
                path,
                alt_held.clone(),
                shift_held.clone(),
            );
        }
    }

    discovered
}

#[cfg(target_os = "linux")]
fn spawn_evdev_device_worker(
    app_handle: tauri::AppHandle,
    path: std::path::PathBuf,
    alt_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
    shift_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use evdev::{Device, InputEventKind, Key};

    std::thread::spawn(move || {
        let mut reopen_logged = false;

        loop {
            let mut dev = match Device::open(&path) {
                Ok(device) => {
                    if reopen_logged {
                        info!("Reconnected evdev keyboard at {}", path.display());
                        reopen_logged = false;
                    }
                    device
                }
                Err(e) => {
                    if !reopen_logged {
                        warn!(
                            "Failed to open evdev keyboard {}: {e}. Retrying in 2s",
                            path.display()
                        );
                        reopen_logged = true;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    continue;
                }
            };

            info!(
                "Watching evdev keyboard: {} ({})",
                dev.name().unwrap_or("Unnamed device"),
                path.display()
            );
            trace_hotkey_event("evdev_device_worker_started", Some("evdev"));

            loop {
                match dev.fetch_events() {
                    Ok(events) => {
                        for ev in events {
                            if let InputEventKind::Key(key) = ev.kind() {
                                let pressed = ev.value() == 1;
                                let repeat = ev.value() == 2;

                                match key {
                                    Key::KEY_LEFTALT | Key::KEY_RIGHTALT => {
                                        alt_held.store(pressed, Ordering::SeqCst);
                                    }
                                    Key::KEY_LEFTSHIFT | Key::KEY_RIGHTSHIFT => {
                                        shift_held.store(pressed, Ordering::SeqCst);
                                    }
                                    Key::KEY_D if pressed && !repeat => {
                                        let mode = EVDEV_HOTKEY_MODE.load(Ordering::SeqCst);
                                        let alt_down = alt_held.load(Ordering::SeqCst);
                                        let shift_down = shift_held.load(Ordering::SeqCst);

                                        let matched = match mode {
                                            0 => alt_down && !shift_down,
                                            1 => alt_down && shift_down,
                                            _ => false,
                                        };

                                        if matched {
                                            debug!("Hotkey detected via evdev (mode {})", mode);
                                            trace_hotkey_event(
                                                "hotkey_event_received_evdev",
                                                Some("evdev"),
                                            );
                                            eval_toggle_with_backend(&app_handle, "evdev");
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!(
                            "Keyboard read error on {}: {e}. Reopening device",
                            path.display()
                        );
                        break;
                    }
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

#[cfg(target_os = "linux")]
fn spawn_evdev_polling_supervisor(
    app_handle: tauri::AppHandle,
    alt_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
    shift_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    std::thread::spawn(move || loop {
        let discovered = spawn_supported_evdev_device_workers(&app_handle, &alt_held, &shift_held);
        if discovered > 0 {
            info!(
                "evdev polling fallback attached {} newly discovered keyboard(s)",
                discovered
            );
        }

        std::thread::sleep(std::time::Duration::from_secs(3));
    });
}

#[cfg(target_os = "linux")]
fn spawn_evdev_device_watcher(
    app_handle: tauri::AppHandle,
    alt_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
    shift_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use inotify::{EventMask, Inotify, WatchMask};

    std::thread::spawn(move || {
        let mut inotify = match Inotify::init() {
            Ok(inotify) => inotify,
            Err(e) => {
                warn!(
                    "Failed to initialize inotify for /dev/input watching: {e}. Falling back to polling."
                );
                spawn_evdev_polling_supervisor(app_handle, alt_held, shift_held);
                return;
            }
        };

        if let Err(e) = inotify.watches().add(
            "/dev/input",
            WatchMask::CREATE
                | WatchMask::ATTRIB
                | WatchMask::MOVED_TO
                | WatchMask::DELETE_SELF
                | WatchMask::MOVE_SELF,
        ) {
            warn!("Failed to watch /dev/input for hotkey devices: {e}. Falling back to polling.");
            spawn_evdev_polling_supervisor(app_handle, alt_held, shift_held);
            return;
        }

        info!("Watching /dev/input for evdev hotkey device changes");

        let mut buffer = [0u8; 4096];
        loop {
            let events = match inotify.read_events_blocking(&mut buffer) {
                Ok(events) => events.collect::<Vec<_>>(),
                Err(e) => {
                    warn!("evdev device watcher failed: {e}. Falling back to polling discovery.");
                    spawn_evdev_polling_supervisor(app_handle, alt_held, shift_held);
                    return;
                }
            };

            let should_rescan = events.iter().any(|event| {
                event
                    .mask
                    .intersects(EventMask::DELETE_SELF | EventMask::MOVE_SELF)
                    || event
                        .name
                        .as_ref()
                        .map(|name| name.to_string_lossy().starts_with("event"))
                        .unwrap_or(false)
            });

            if should_rescan {
                let discovered =
                    spawn_supported_evdev_device_workers(&app_handle, &alt_held, &shift_held);
                if discovered > 0 {
                    info!(
                        "evdev watcher attached {} newly discovered keyboard(s)",
                        discovered
                    );
                }
            }
        }
    });
}

#[cfg(target_os = "linux")]
fn start_hotkey_listener(app_handle: tauri::AppHandle) -> bool {
    let alt_held = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shift_held = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let initial_discovered =
        spawn_supported_evdev_device_workers(&app_handle, &alt_held, &shift_held);
    if initial_discovered == 0 {
        warn!(
            "No keyboard found for evdev at startup. Add user to 'input' group if needed; VOCO will keep watching for devices."
        );
    } else {
        info!(
            "evdev hotkey listener started on {} keyboard(s)",
            initial_discovered
        );
    }
    trace_hotkey_event("evdev_listener_started", Some("evdev"));

    spawn_evdev_device_watcher(app_handle, alt_held, shift_held);

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

    #[cfg(target_os = "linux")]
    install_socket_cleanup_signal_handler();

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
            get_runtime_diagnostics,
            set_dictation_status,
            set_microphone_ready,
            trace_frontend_hotkey_event,
            has_pending_hotkey_toggle,
            show_status_overlay,
            hide_status_overlay,
            show_notification,
            open_external_url,
        ])
        .setup(|app| {
            let startup_ms = now_ms();
            FRONTEND_HOTKEY_HANDLER_READY.store(false, Ordering::SeqCst);
            if let Ok(mut pending_backend) = PENDING_TOGGLE_BACKEND.lock() {
                *pending_backend = None;
            }
            trace_hotkey_event("app_start", Some("internal"));
            let hotkey = configured_hotkey();
            let app_handle = app.handle().clone();
            EVDEV_HOTKEY_MODE.store(hotkey_to_evdev_mode(&hotkey), Ordering::SeqCst);
            let wayland_session = is_wayland_session();
            let use_evdev_hotkey = prefers_evdev_hotkey(wayland_session, &hotkey);
            USE_EVDEV_HOTKEY.store(use_evdev_hotkey, Ordering::SeqCst);
            trace_hotkey_event(
                "hotkey_backend_selected",
                Some(if use_evdev_hotkey {
                    "evdev"
                } else {
                    "global_shortcut"
                }),
            );

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
                cleanup_socket_files();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_audio_bytes_valid() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0.5f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.5f32).to_le_bytes());
        let samples = decode_audio_bytes(&bytes).unwrap();
        assert_eq!(samples.len(), 2);
        assert!((samples[0] - 0.5).abs() < f32::EPSILON);
        assert!((samples[1] + 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn decode_audio_bytes_empty() {
        assert!(decode_audio_bytes(&[]).unwrap().is_empty());
    }

    #[test]
    fn decode_audio_bytes_invalid_length() {
        assert!(decode_audio_bytes(b"abc")
            .unwrap_err()
            .contains("not a multiple of 4"));
    }

    #[test]
    fn socket_path_uses_xdg_runtime_dir() {
        assert!(socket_path().to_str().unwrap().ends_with("voco.sock"));
    }

    #[test]
    fn socket_base_dir_uses_private_tmp_fallback_without_runtime_dir() {
        let path = socket_base_dir_from(None);
        assert!(path.starts_with(std::env::temp_dir()));
        assert!(path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .starts_with("voco-"));
    }

    #[test]
    fn cleanup_socket_paths_removes_existing_files() {
        let unique = format!(
            "voco-cleanup-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let temp_dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let primary = temp_dir.join("voco.sock");
        let legacy = temp_dir.join("voice.sock");
        std::fs::write(&primary, b"").unwrap();
        std::fs::write(&legacy, b"").unwrap();

        cleanup_socket_paths([primary.clone(), legacy.clone()]);

        assert!(!primary.exists());
        assert!(!legacy.exists());
        std::fs::remove_dir_all(temp_dir).unwrap();
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
