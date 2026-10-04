#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!(
    "VOCO production builds require the app's custom-protocol feature; use `cargo tauri build --features custom-protocol` instead of `cargo build --release`"
);

mod activation;
mod browser_broker;
mod browser_event_delivery;
mod browser_protocol;
mod browser_socket;
mod config;
mod crash_recovery;
#[cfg(target_os = "linux")]
mod desktop_notifications;
mod digest_hex;
#[cfg(target_os = "linux")]
mod hotkey_state;
mod hotkey_trace;
mod ibus_shortcut;
mod insertion;
#[cfg(all(target_os = "linux", feature = "native-capture"))]
mod native_capture;
mod native_capture_commands;
pub mod panel_setup;
mod performance;
mod process_runner;
mod shortcut_arbitration;
mod shortcut_readiness;
mod single_instance;
mod speech_stream;
mod tray_icons;
mod trigger_socket;
#[cfg(target_os = "linux")]
mod virtual_keyboard;

/// Check input prerequisites without launching a window or sending keys.
pub fn check_desktop_input() -> Result<String, String> {
    let status = insertion::desktop_input_status();
    if status.available {
        Ok(status.detail)
    } else {
        Err(status.detail)
    }
}

/// Request one toggle from the running application without launching a window.
pub fn toggle_running_application() -> Result<(), String> {
    trigger_socket::toggle().map_err(|error| {
        format!("Could not reach VOCO's private control socket: {error}. Open VOCO in this desktop session first.")
    })
}
#[cfg(target_os = "linux")]
mod panel;
mod tray;

use config::{
    load_cached_update_check, save_cached_update_check, AppConfig, AppConfigPatch,
    CachedUpdateCheck,
};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

// Advanced on every main page load; the crash journal rejects older writers.
static RENDERER_EPOCH: AtomicU64 = AtomicU64::new(1);

// Debounce: ignore duplicate toggle events that arrive almost immediately.
// This collapses duplicate keyboard backends and duplicate evdev devices
// without eating legitimate quick user toggles.
static LAST_TOGGLE_MS: AtomicI64 = AtomicI64::new(-1);

// Evdev hotkey mode: 0 = Alt+D, 1 = Alt+Shift+D, 255 = custom (disabled)
static EVDEV_HOTKEY_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
static USE_EVDEV_HOTKEY: AtomicBool = AtomicBool::new(false);
static SHORTCUT_OBSERVATIONS: LazyLock<shortcut_readiness::Observations> =
    LazyLock::new(shortcut_readiness::Observations::default);
static IBUS_SHORTCUT_LEASE: shortcut_arbitration::ConsumingLease =
    shortcut_arbitration::ConsumingLease::new();
static SHORTCUT_RENDERER_HEARTBEAT_MS: AtomicI64 = AtomicI64::new(-1);
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
static EVDEV_LISTENER_STARTED: AtomicBool = AtomicBool::new(false);
static HOTKEY_BINDING_VERSION: AtomicU64 = AtomicU64::new(0);
static FRONTEND_HOTKEY_HANDLER_READY: AtomicBool = AtomicBool::new(false);
static BROWSER_EVENT_DELIVERY: LazyLock<browser_event_delivery::BrowserEventDelivery> =
    LazyLock::new(browser_event_delivery::BrowserEventDelivery::default);
static PENDING_TOGGLE_BACKEND: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static TRACE_START: LazyLock<Instant> = LazyLock::new(Instant::now);
static TRACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TRACE_MODES: LazyLock<(bool, bool)> = LazyLock::new(|| {
    trace_modes(
        std::env::var("VOCO_HOTKEY_TRACE").ok().as_deref(),
        std::env::var("VOCO_PERFORMANCE_LOG").ok().as_deref(),
    )
});
static CONFIG_WRITE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static CONFIG_REVISION: AtomicU64 = AtomicU64::new(0);
static REGISTERED_PLUGIN_SHORTCUT: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "linux")]
static EVDEV_WATCHED_PATHS: LazyLock<Mutex<std::collections::HashSet<std::path::PathBuf>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

const TOGGLE_DICTATION_EVENT: &str = "voco:toggle-dictation";
const CONFIG_CHANGED_EVENT: &str = "voco:config-changed";
const TOGGLE_DEBOUNCE_MS: i64 = 120;
const HIDDEN_WINDOW_POS_X: i32 = -100;
const HIDDEN_WINDOW_POS_Y: i32 = -100;
const HIDDEN_WINDOW_SIZE: u32 = 1;

fn trace_modes(hotkey: Option<&str>, performance: Option<&str>) -> (bool, bool) {
    (hotkey == Some("1"), performance == Some("1"))
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayPopoverAnchor {
    pub rect_position_x: i32,
    pub rect_position_y: i32,
    pub rect_width: u32,
    pub rect_height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSnapshot {
    revision: u64,
    config: AppConfig,
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
    // dirs ignores an empty or relative XDG_STATE_HOME, as the XDG spec requires.
    dirs::state_dir()
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
    trace_hotkey_event_with_fields(event, backend_used, None);
}

fn trace_hotkey_event_with_fields(
    event: &str,
    backend_used: Option<&str>,
    frontend_fields: Option<&FrontendTraceFields>,
) {
    let (hotkey_enabled, performance_enabled) = *TRACE_MODES;
    if !hotkey_enabled && !performance_enabled {
        return;
    }

    let backend = match backend_used {
        Some(value) => value,
        None => selected_backend_label(),
    };
    let mut record = serde_json::json!({
        "seq": TRACE_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1,
        "event": event,
        "t_ms": monotonic_trace_ms(),
        "backend_used": backend,
        "session_type": session_type_label(),
    });
    if let Some(fields) = frontend_fields {
        if let Some(selected_device_configured) = fields.selected_device_configured {
            record["selected_device_configured"] =
                serde_json::Value::Bool(selected_device_configured);
        }
        if let Some(track_sample_rate) = fields.track_sample_rate {
            record["track_sample_rate"] = serde_json::Value::Number(track_sample_rate.into());
        }
        if let Some(duration_ms) = fields.duration_ms {
            record["duration_ms"] = serde_json::Value::Number(duration_ms.into());
        }
        if let Some(dictation_session_id) = fields.dictation_session_id {
            record["dictation_session_id"] = serde_json::Value::Number(dictation_session_id.into());
        }
    }

    performance::lifecycle(&record);

    if !hotkey_enabled {
        return;
    }

    let line = match serde_json::to_string(&record) {
        Ok(line) => line,
        Err(error) => {
            warn!("Failed to encode hotkey trace event {event}: {error}");
            return;
        }
    };

    let path = hotkey_trace_path();
    if let Err(error) = hotkey_trace::append(&path, line.as_bytes()) {
        warn!(
            "Failed to write hotkey trace event to {}: {error}",
            path.display()
        );
    }
}

#[tauri::command]
fn trace_frontend_hotkey_event(
    app: tauri::AppHandle,
    event: String,
    fields: Option<FrontendTraceFields>,
) -> Result<(), String> {
    if let Some(fields) = fields.as_ref() {
        fields.validate()?;
    }

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
        | "onboarding_handoff_requested"
        | "onboarding_handoff_hidden"
        | "launcher_activation_presented"
        | "launcher_activation_preserved_capture"
        | "frontend_hotkey_listener_registered" => {
            trace_hotkey_event_with_fields(&event, None, fields.as_ref());
            Ok(())
        }
        "frontend_hotkey_handler_ready" => {
            trace_hotkey_event(&event, None);
            FRONTEND_HOTKEY_HANDLER_READY.store(true, Ordering::SeqCst);
            replay_pending_browser_stops(&app);
            replay_pending_toggle(&app);
            Ok(())
        }
        event if is_supported_dictation_trace_event(event) => {
            trace_hotkey_event_with_fields(event, None, fields.as_ref());
            Ok(())
        }
        "frontend_toggle_received" => {
            trace_hotkey_event_with_fields(&event, None, fields.as_ref());
            Ok(())
        }
        _ => Err(format!("Unsupported hotkey trace event: {event}")),
    }
}

fn is_supported_dictation_trace_event(event: &str) -> bool {
    matches!(
        event,
        "dictation_trigger_start_rejected"
            | "dictation_trigger_stop_rejected"
            | "dictation_trigger_start_admitted"
            | "dictation_trigger_stop_admitted"
            | "dictation_trigger_toggle_admitted"
            | "dictation_desktop_paste_preflight_completed"
            | "dictation_desktop_modifier_wait_completed"
            | "dictation_desktop_clipboard_write_completed"
            | "dictation_desktop_keyboard_dispatch_completed"
            | "dictation_desktop_stream_started"
            | "dictation_desktop_phrase_queued"
            | "dictation_desktop_snapshot_revised"
            | "dictation_desktop_live_prefix_dispatched"
            | "dictation_desktop_first_phrase_dispatched"
            | "dictation_desktop_stream_flush_completed"
            | "dictation_desktop_stream_failed"
            | "dictation_desktop_paste_session_started"
            | "dictation_desktop_paste_unavailable"
            | "dictation_desktop_paste_requested"
            | "dictation_desktop_paste_dispatched"
            | "dictation_desktop_paste_deferred"
            | "dictation_desktop_remainder_copied"
            | "dictation_desktop_remainder_kept"
            | "recording_state_requested"
            | "recording_get_user_media_started"
            | "recording_get_user_media_constraints_fallback"
            | "recording_get_user_media_default_fallback"
            | "recording_get_user_media_done"
            | "recording_audio_context_ready"
            | "recording_media_source_created"
            | "recording_worklet_connected"
            | "recording_script_processor_connected"
            | "recording_state_active"
            | "dictation_capture_input_gap"
            | "dictation_capture_health_interrupted"
            | "dictation_stop_to_final_transcript"
            | "dictation_stop_to_idle"
            | "dictation_interrupted"
            | "dictation_recording_duration"
            | "dictation_recording_stopped"
            | "dictation_audio_teardown_completed"
            | "dictation_recovery_retained"
            | "dictation_recording_limit_reached"
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendTraceFields {
    selected_device_configured: Option<bool>,
    track_sample_rate: Option<u64>,
    duration_ms: Option<u64>,
    dictation_session_id: Option<u64>,
}

impl FrontendTraceFields {
    fn validate(&self) -> Result<(), String> {
        if let Some(sample_rate) = self.track_sample_rate {
            if !(8_000..=384_000).contains(&sample_rate) {
                return Err(format!("Unsupported track sample rate: {sample_rate}"));
            }
        }
        if let Some(duration_ms) = self.duration_ms {
            if duration_ms > 3_600_000 {
                return Err(format!("Unsupported duration: {duration_ms}"));
            }
        }
        if let Some(dictation_session_id) = self.dictation_session_id {
            if !(1..=1_000_000).contains(&dictation_session_id) {
                return Err(format!(
                    "Unsupported dictation session id: {dictation_session_id}"
                ));
            }
        }
        Ok(())
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
    let Ok(shortcut) = hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() else {
        return 255;
    };
    if "Alt+D"
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .is_ok_and(|candidate| candidate == shortcut)
    {
        0
    } else if "Alt+Shift+D"
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .is_ok_and(|candidate| candidate == shortcut)
    {
        1
    } else {
        255
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

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn should_start_evdev_listener(use_evdev_hotkey: bool, listener_started: bool) -> bool {
    use_evdev_hotkey && !listener_started
}

fn validate_dictation_hotkey(hotkey: &str) -> Result<(), String> {
    let shortcut = hotkey
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|error| format!("Invalid hotkey '{hotkey}': {error}"))?;
    let required_modifiers = tauri_plugin_global_shortcut::Modifiers::ALT
        | tauri_plugin_global_shortcut::Modifiers::CONTROL
        | tauri_plugin_global_shortcut::Modifiers::SUPER
        | tauri_plugin_global_shortcut::Modifiers::META;
    if !shortcut.mods.intersects(required_modifiers) {
        return Err(
            "Dictation hotkey must include Alt, Control, or Super in addition to the main key"
                .to_string(),
        );
    }

    Ok(())
}

fn validate_loaded_config(config: &AppConfig) -> Result<(), String> {
    validate_dictation_hotkey(&config.hotkey)
}

fn config_writer() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| "VOCO configuration writer is unavailable".to_string())
}

/// Call only after a committed write, while still holding `config_writer()`, so
/// the config and its revision come from the same write.
fn publish_config(app: &tauri::AppHandle, config: AppConfig, kind: &str) -> ConfigSnapshot {
    let snapshot = ConfigSnapshot {
        revision: CONFIG_REVISION.fetch_add(1, Ordering::SeqCst) + 1,
        config,
    };
    if let Err(error) = app.emit_to("main", CONFIG_CHANGED_EVENT, snapshot.clone()) {
        warn!("Failed to emit {kind} configuration update: {error}");
    }
    snapshot
}

/// Rebinds `previous` after a failed change and returns the error to report. It
/// restores only the runtime binding; config.rs keeps or restores the file.
fn restore_hotkey(
    previous: &str,
    error: String,
    rebind: impl FnOnce(&str) -> Result<(), String>,
) -> String {
    match rebind(previous) {
        Ok(()) => error,
        Err(rollback) => format!("{error}; restoring {previous} also failed: {rollback}"),
    }
}

#[tauri::command]
fn get_config() -> Result<ConfigSnapshot, String> {
    let _guard = config_writer()?;
    let config = AppConfig::load().map_err(|error| error.to_string())?;
    validate_loaded_config(&config)?;
    Ok(ConfigSnapshot {
        revision: CONFIG_REVISION.load(Ordering::SeqCst),
        config,
    })
}

#[tauri::command]
fn reload_config_from_disk(app: tauri::AppHandle) -> Result<ConfigSnapshot, String> {
    let _guard = config_writer()?;
    let previous_hotkey = tray::current_hotkey(&app)?;
    let config = AppConfig::load().map_err(|error| error.to_string())?;
    validate_loaded_config(&config)?;
    apply_hotkey_runtime_state(&app, &config.hotkey).map_err(|error| {
        let error = format!(
            "Could not apply the repaired hotkey {}: {error}",
            config.hotkey
        );
        restore_hotkey(&previous_hotkey, error, |hotkey| {
            apply_hotkey_runtime_state(&app, hotkey)
        })
    })?;
    Ok(publish_config(&app, config, "reloaded"))
}

#[tauri::command]
fn reset_config_to_defaults(app: tauri::AppHandle) -> Result<ConfigSnapshot, String> {
    let _guard = config_writer()?;
    let previous_hotkey = tray::current_hotkey(&app)?;
    let rebind = |hotkey: &str| apply_hotkey_runtime_state(&app, hotkey);
    apply_hotkey_runtime_state(&app, &AppConfig::default().hotkey).map_err(|error| {
        let error = format!("Could not bind the default hotkey before resetting settings: {error}");
        restore_hotkey(&previous_hotkey, error, rebind)
    })?;
    let config = AppConfig::reset_to_defaults()
        .map_err(|error| restore_hotkey(&previous_hotkey, error.to_string(), rebind))?;
    Ok(publish_config(&app, config, "recovered"))
}

#[tauri::command]
fn open_config_directory() -> Result<(), String> {
    let directory = AppConfig::config_dir_without_migration().map_err(|error| error.to_string())?;
    process_runner::spawn_desktop_launcher(process_runner::command("xdg-open").arg(&directory))
        .map_err(|error| format!("Failed to open {}: {error}", directory.display()))?;
    Ok(())
}

fn persist_config_patch(
    app: &tauri::AppHandle,
    patch: AppConfigPatch,
    notify_hotkey_change: bool,
) -> Result<ConfigSnapshot, String> {
    let _guard = config_writer()?;
    let previous = AppConfig::load().map_err(|error| error.to_string())?;
    let mut config = previous.clone();
    patch.apply_to(&mut config);
    let hotkey_changed = previous.hotkey != config.hotkey;
    let rebind = |hotkey: &str| apply_hotkey_runtime_state(app, hotkey);

    if hotkey_changed {
        validate_dictation_hotkey(&config.hotkey)?;
        apply_hotkey_runtime_state(app, &config.hotkey)
            .map_err(|error| restore_hotkey(&previous.hotkey, error, rebind))?;
    }

    if let Err(error) = config.save() {
        return Err(if hotkey_changed {
            restore_hotkey(&previous.hotkey, error.to_string(), rebind)
        } else {
            error.to_string()
        });
    }

    let snapshot = publish_config(app, config, "authoritative");
    if hotkey_changed && notify_hotkey_change {
        send_notification(
            "Shortcut preference saved",
            &format!("Preferred shortcut: {}", snapshot.config.hotkey),
        );
    }

    Ok(snapshot)
}

#[tauri::command]
fn save_config_patch(
    app: tauri::AppHandle,
    patch: AppConfigPatch,
) -> Result<ConfigSnapshot, String> {
    persist_config_patch(&app, patch, false)
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

#[tauri::command]
fn sync_panel_level(app: tauri::AppHandle, epoch: u64, level: f64) {
    #[cfg(target_os = "linux")]
    panel::update_level(&app, epoch, level);
}

// --- Text insertion & notifications ---

#[tauri::command]
fn begin_runtime_status_session(app: tauri::AppHandle) -> Result<u64, String> {
    tray::begin_runtime_status_session(&app)
}

#[tauri::command]
fn sync_runtime_status(
    app: tauri::AppHandle,
    snapshot: tray::RuntimeStatusSnapshot,
) -> Result<(), String> {
    tray::update_runtime_status(&app, snapshot);
    Ok(())
}

fn send_notification(summary: &str, body: &str) {
    let summary = summary.to_string();
    let body = body.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        match desktop_notifications::send(&summary, &body) {
            Ok(()) => trace_hotkey_event("desktop_notification_accepted", None),
            Err(error) => {
                trace_hotkey_event(error.event(), None);
                warn!("Desktop notification failed: {}", error.event());
            }
        }
    });
}

#[tauri::command]
fn show_notification(summary: String, body: String) {
    send_notification(&summary, &body);
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("Only VOCO release and desktop setup URLs are supported".to_string());
    }

    process_runner::spawn_desktop_launcher(process_runner::command("xdg-open").arg(&url))
        .map_err(|error| format!("Failed to open external URL: {error}"))?;
    Ok(())
}

#[tauri::command(async)]
fn get_desktop_input_status(app: tauri::AppHandle) -> insertion::DesktopInputStatus {
    with_panel_recommendation(&app, insertion::desktop_input_status())
}

/// The GNOME companion keeps the shortcut out of the focused app. It is a
/// recommendation only: dictation works without it.
fn with_panel_recommendation(
    app: &tauri::AppHandle,
    mut input: insertion::DesktopInputStatus,
) -> insertion::DesktopInputStatus {
    if input.available {
        if let Some(detail) = stop_shortcut_setup_issue(app) {
            input.detail = detail;
            input.setup_area = Some("panel");
        }
    }
    input
}

#[tauri::command(async)]
fn get_panel_setup_status() -> Result<panel_setup::PanelSetupStatus, String> {
    let status = panel_setup::check(false);
    panel_setup::invalidate_check();
    status
}

#[tauri::command(async)]
fn enable_gnome_panel() -> Result<panel_setup::PanelSetupStatus, String> {
    let status = panel_setup::check(true);
    panel_setup::invalidate_check();
    status
}

#[tauri::command(async)]
fn get_desktop_paste_status() -> insertion::DesktopPasteStatus {
    insertion::desktop_paste_diagnostics().1
}

fn stop_shortcut_setup_issue(app: &tauri::AppHandle) -> Option<String> {
    let hotkey = tray::current_hotkey(app).unwrap_or_else(|_| "Alt+D".into());
    let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if prefers_evdev_hotkey(session_type.eq_ignore_ascii_case("wayland"), &hotkey) {
        let chord = if hotkey_to_evdev_mode(&hotkey) == 0 {
            "Alt+D"
        } else {
            "Alt+Shift+D"
        };
        return panel_setup::stop_shortcut_setup_detail(
            &session_type,
            chord,
            panel_setup::cached_check(),
            panel::is_attached(),
        );
    }
    None
}

#[tauri::command(async)]
async fn paste_desktop_text(
    text: String,
    correlation: Option<insertion::PasteCorrelation>,
) -> Result<insertion::InsertionResult, insertion::InsertionError> {
    // Helpers and the modifier wait block. Keep the UI/capture IPC event loop
    // responsive while the native transaction settles.
    tauri::async_runtime::spawn_blocking(move || {
        insertion::correlated_desktop_paste(&text, correlation.as_ref())
    })
    .await
    .map_err(|_| insertion::InsertionError {
        outcome: insertion::DeliveryOutcome::Uncertain,
        message: "Input task interrupted; review retained text before retrying.".into(),
        clipboard_changed: true,
    })?
}

/// Leave undelivered dictation on the clipboard without sending any keys.
#[tauri::command(async)]
async fn copy_desktop_text(text: String) -> Result<(), insertion::InsertionError> {
    tauri::async_runtime::spawn_blocking(move || insertion::copy_desktop_text(&text))
        .await
        .map_err(|_| insertion::InsertionError {
            outcome: insertion::DeliveryOutcome::Uncertain,
            message: "Copy task interrupted; check the clipboard before pasting.".into(),
            clipboard_changed: true,
        })?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDiagnostics {
    #[serde(flatten)]
    insertion: insertion::RuntimeDiagnostics,
    ibus_shortcut: ibus_shortcut::IbusShortcutStatus,
    shortcut: shortcut_readiness::Status,
    desktop_paste: insertion::DesktopPasteStatus,
    desktop_input: insertion::DesktopInputStatus,
}

struct BrowserIntegration(Option<browser_broker::BrowserBroker>);

/// Browser field commands act only on the broker's current session. Any other
/// session gets this error, which stops its delivery; Stop copies the rest.
const NO_BROWSER_FIELD: &str = "No enabled browser field is taking this dictation.";

impl BrowserIntegration {
    fn session(&self, id: u64) -> Option<&browser_broker::BrowserBroker> {
        self.0
            .as_ref()
            .filter(|broker| broker.get_status().session_id == Some(id))
    }
}

#[tauri::command(async)]
fn get_runtime_diagnostics(
    app: tauri::AppHandle,
    state: tauri::State<'_, ibus_shortcut::IbusShortcutService>,
) -> RuntimeDiagnostics {
    let ibus_shortcut = state.status();
    let (insertion, desktop_input, desktop_paste) = insertion::runtime_input_diagnostics();
    #[cfg(target_os = "linux")]
    let panel_reserved = panel::reserves_current_shortcut(&app);
    #[cfg(not(target_os = "linux"))]
    let panel_reserved = false;
    RuntimeDiagnostics {
        insertion,
        shortcut: shortcut_runtime_status(ibus_shortcut.available, panel_reserved),
        ibus_shortcut,
        desktop_paste,
        desktop_input: with_panel_recommendation(&app, desktop_input),
    }
}

fn shortcut_runtime_status(
    bridge_available: bool,
    panel_reserved: bool,
) -> shortcut_readiness::Status {
    let unknown = || shortcut_readiness::Status {
        hotkey: String::new(),
        route: None,
        state: "unknown",
        detail: "Shortcut configuration is unavailable. Start dictation from the tray.",
    };
    // Match the writer's lock order and keep config/runtime observations within
    // one committed generation. This read never registers or arms a shortcut.
    let Ok(_guard) = CONFIG_WRITE_LOCK.lock() else {
        return unknown();
    };
    let Ok(config) = AppConfig::load() else {
        return unknown();
    };
    if validate_loaded_config(&config).is_err() {
        return unknown();
    }
    let Ok(plugin) = REGISTERED_PLUGIN_SHORTCUT.lock() else {
        return unknown();
    };
    let now = shortcut_monotonic_ms();
    SHORTCUT_OBSERVATIONS.status(shortcut_readiness::Snapshot {
        hotkey: &config.hotkey,
        revision: CONFIG_REVISION.load(Ordering::SeqCst),
        now,
        renderer_current: FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst)
            && shortcut_heartbeat_is_current(
                SHORTCUT_RENDERER_HEARTBEAT_MS.load(Ordering::SeqCst),
                now,
            ),
        consuming_lease: IBUS_SHORTCUT_LEASE.has_authority(now),
        plugin_hotkey: plugin.as_deref(),
        use_evdev: USE_EVDEV_HOTKEY.load(Ordering::SeqCst),
        evdev_mode: EVDEV_HOTKEY_MODE.load(Ordering::SeqCst),
        configured_evdev_mode: hotkey_to_evdev_mode(&config.hotkey),
        bridge_available,
        panel_reserved,
    })
}

#[tauri::command(async)]
fn start_browser_field(
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    trigger_id: String,
) -> Result<browser_broker::BrowserStatus, String> {
    if !trigger_id.starts_with("browser:") {
        return Err(NO_BROWSER_FIELD.to_string());
    }
    browser
        .0
        .as_ref()
        .ok_or("The local browser integration is unavailable.")?
        .start(session_id, &trigger_id)
}

#[tauri::command(async)]
fn append_browser_field(
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    expected_committed_text: String,
    append_text: String,
) -> Result<browser_broker::BrowserStatus, String> {
    browser.session(session_id).ok_or(NO_BROWSER_FIELD)?.append(
        session_id,
        &expected_committed_text,
        &append_text,
        false,
    )
}

#[tauri::command(async)]
fn finish_browser_field(
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    expected_committed_text: String,
) -> Result<browser_broker::BrowserStatus, String> {
    browser.session(session_id).ok_or(NO_BROWSER_FIELD)?.append(
        session_id,
        &expected_committed_text,
        "",
        true,
    )
}

#[tauri::command(async)]
fn cancel_browser_field(
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
) -> Result<browser_broker::BrowserStatus, String> {
    browser
        .session(session_id)
        .ok_or(NO_BROWSER_FIELD)?
        .cancel(session_id)
}

#[tauri::command(async)]
fn release_browser_recording(
    browser: tauri::State<'_, BrowserIntegration>,
    trigger_id: String,
) -> Result<(), String> {
    if let Some(broker) = &browser.0 {
        broker.release(&trigger_id)?;
    }
    Ok(())
}

fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow<tauri::Wry>, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Window 'main' not found".to_string())
}

fn hide_overlay_window(window: &tauri::WebviewWindow<tauri::Wry>) -> Result<(), String> {
    if native_capture_commands::uses_native_backend() {
        return window
            .hide()
            .map_err(|e| format!("Failed to hide VOCO window: {e}"));
    }
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

// --- Bundled speech-runtime readiness ---

fn is_allowed_external_url(url: &str) -> bool {
    url == "https://github.com/sergiopesch/voco/blob/master/docs/platform/README.md#wayland-paste-keys"
        || url
            .strip_prefix("https://github.com/sergiopesch/voco/releases/tag/")
            .is_some_and(|tag| !tag.is_empty() && !tag.contains(['\r', '\n', '\\']))
}

fn prepare_model_at_startup(app: &tauri::AppHandle) -> Result<(), String> {
    info!("Preparing bundled Nemotron streaming model at startup");
    speech_stream::warmup()?;
    info!("Bundled Nemotron streaming model ready");
    tray::update_model_download_status(app, tray::ModelDownloadStatus::Ready);
    Ok(())
}

fn shortcut_monotonic_ms() -> i64 {
    i64::try_from(TRACE_START.elapsed().as_millis()).unwrap_or(i64::MAX)
}

fn shortcut_heartbeat_is_current(last: i64, now: i64) -> bool {
    last >= 0 && now >= last && now.saturating_sub(last) < 3000
}

#[tauri::command]
fn refresh_shortcut_heartbeat(app: tauri::AppHandle, ready: bool) {
    FRONTEND_HOTKEY_HANDLER_READY.store(ready, Ordering::SeqCst);
    SHORTCUT_RENDERER_HEARTBEAT_MS.store(
        if ready { shortcut_monotonic_ms() } else { -1 },
        Ordering::SeqCst,
    );
    if !ready {
        SHORTCUT_OBSERVATIONS.clear_poll();
    } else {
        replay_pending_browser_stops(&app);
    }
}

#[tauri::command]
fn ack_browser_stop(trigger_id: String) -> Result<(), String> {
    let token = trigger_id
        .strip_prefix("browser:")
        .ok_or("Invalid browser recording token")?;
    if !browser_protocol::opaque_id(token) {
        return Err("Invalid browser recording token".into());
    }
    BROWSER_EVENT_DELIVERY.acknowledge_stop(&trigger_id);
    Ok(())
}

fn refresh_shortcut_config(
    cached: &mut Option<ConfigSnapshot>,
    published_revision: u64,
    read_committed: impl FnOnce() -> Result<ConfigSnapshot, String>,
) -> Result<(), String> {
    if cached
        .as_ref()
        .is_none_or(|snapshot| snapshot.revision != published_revision)
    {
        // The reader holds CONFIG_WRITE_LOCK: config and revision must come
        // from the same completed write, never a plugin registration in flight.
        *cached = Some(read_committed()?);
    }
    Ok(())
}

fn should_register_shortcut_fallback(use_evdev: bool, consuming_context: bool) -> bool {
    should_register_global_shortcut(use_evdev) && !consuming_context
}

fn schedule_shortcut_arbitration(
    app: &tauri::AppHandle,
    snapshot: &ConfigSnapshot,
    posts: &mut shortcut_arbitration::ArbitrationPosts,
) {
    let fallback = should_register_shortcut_fallback(
        USE_EVDEV_HOTKEY.load(Ordering::SeqCst),
        IBUS_SHORTCUT_LEASE.has_authority(shortcut_monotonic_ms()),
    );
    if !posts.should_post(snapshot.revision, fallback, shortcut_monotonic_ms()) {
        return;
    }
    let handle = app.clone();
    let revision = snapshot.revision;
    let hotkey = snapshot.config.hotkey.clone();
    let _ = app.run_on_main_thread(move || {
        // Plugin registration itself marshals synchronously to this thread.
        // Never wait here for a writer that could be awaiting a plugin callback.
        let Ok(_guard) = CONFIG_WRITE_LOCK.try_lock() else {
            return;
        };
        if CONFIG_REVISION.load(Ordering::SeqCst) != revision {
            return;
        }
        let enable_plugin = should_register_shortcut_fallback(
            USE_EVDEV_HOTKEY.load(Ordering::SeqCst),
            IBUS_SHORTCUT_LEASE.has_authority(shortcut_monotonic_ms()),
        );
        let result = sync_global_shortcut_binding(&handle, &hotkey, enable_plugin);
        match result {
            Ok(()) => {}
            Err(error) => {
                warn!("Could not arbitrate consuming shortcut and global fallback: {error}");
            }
        }
    });
}

fn start_ibus_shortcut_listener(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut shortcut_config = None;
        let mut arbitration_posts = shortcut_arbitration::ArbitrationPosts::default();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(50));
            // Capture the observation epoch before checking renderer readiness,
            // so a reset during this iteration cannot publish an old reply.
            let observation_ticket = SHORTCUT_OBSERVATIONS.ticket();
            if !FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst)
                || !shortcut_heartbeat_is_current(
                    SHORTCUT_RENDERER_HEARTBEAT_MS.load(Ordering::SeqCst),
                    shortcut_monotonic_ms(),
                )
            {
                if let Some(snapshot) = shortcut_config.as_ref() {
                    schedule_shortcut_arbitration(&app_handle, snapshot, &mut arbitration_posts);
                }
                continue;
            }
            if refresh_shortcut_config(
                &mut shortcut_config,
                CONFIG_REVISION.load(Ordering::SeqCst),
                get_config,
            )
            .is_err()
            {
                if let Some(snapshot) = shortcut_config.as_ref() {
                    schedule_shortcut_arbitration(&app_handle, snapshot, &mut arbitration_posts);
                }
                continue;
            }
            let Some(snapshot) = shortcut_config.as_ref() else {
                continue;
            };
            let state = app_handle.state::<ibus_shortcut::IbusShortcutService>();
            let observation_started = shortcut_monotonic_ms();
            SHORTCUT_OBSERVATIONS.begin_poll(observation_ticket);
            IBUS_SHORTCUT_LEASE.begin_poll();
            match state.poll_trigger(&snapshot.config.hotkey) {
                Ok(poll) => {
                    SHORTCUT_OBSERVATIONS.poll(
                        observation_ticket,
                        snapshot.revision,
                        &snapshot.config.hotkey,
                        observation_started,
                        if poll.armed {
                            shortcut_readiness::Poll::Armed
                        } else {
                            shortcut_readiness::Poll::Disarmed
                        },
                    );
                    IBUS_SHORTCUT_LEASE.finish_poll(
                        shortcut_monotonic_ms(),
                        if poll.armed {
                            shortcut_arbitration::PollOutcome::Armed
                        } else {
                            shortcut_arbitration::PollOutcome::Disarmed
                        },
                    );
                    schedule_shortcut_arbitration(&app_handle, snapshot, &mut arbitration_posts);
                    if CONFIG_REVISION.load(Ordering::SeqCst) != snapshot.revision {
                        continue;
                    }
                    let Some(trigger) = poll.trigger else {
                        continue;
                    };
                    let (event, last_toggle) = match trigger.mode.as_str() {
                        "dictation" => (TOGGLE_DICTATION_EVENT, &LAST_TOGGLE_MS),
                        _ => continue,
                    };
                    if !shortcut_arbitration::admit_toggle(
                        last_toggle,
                        shortcut_monotonic_ms(),
                        TOGGLE_DEBOUNCE_MS,
                    ) {
                        continue;
                    }
                    if let Err(error) = app_handle.emit_to("main", event, &trigger) {
                        error!("Failed to deliver owned IBus shortcut: {error}");
                    } else {
                        trace_hotkey_event("owned_shortcut_event_emitted", Some("ibus"));
                    }
                }
                Err(error) => {
                    SHORTCUT_OBSERVATIONS.poll(
                        observation_ticket,
                        snapshot.revision,
                        &snapshot.config.hotkey,
                        observation_started,
                        if error.may_have_armed {
                            shortcut_readiness::Poll::Uncertain
                        } else {
                            shortcut_readiness::Poll::Unavailable
                        },
                    );
                    IBUS_SHORTCUT_LEASE.finish_poll(
                        shortcut_monotonic_ms(),
                        if error.may_have_armed {
                            shortcut_arbitration::PollOutcome::Uncertain
                        } else {
                            shortcut_arbitration::PollOutcome::Unavailable
                        },
                    );
                    schedule_shortcut_arbitration(&app_handle, snapshot, &mut arbitration_posts);
                    std::thread::sleep(std::time::Duration::from_millis(450));
                }
            }
        }
    });
}

// --- Toggle dictation via window event ---

pub fn eval_toggle(app_handle: &tauri::AppHandle) {
    eval_toggle_with_backend(app_handle, "internal");
}

// Keep passive duplicate suppression in one place so a rejected chord is visible.
// X11 owner-events=false grabs consume their key; a pending IBus poll is not a
// reason to discard that callback or to change its normal debounce behavior.
fn suppress_passive_shortcut(app_handle: &tauri::AppHandle, backend: &str) -> bool {
    #[cfg(target_os = "linux")]
    if backend == "evdev" && panel::reserves_current_shortcut(app_handle) {
        trace_hotkey_event("eval_toggle_suppressed_panel", Some(backend));
        return true;
    }
    if IBUS_SHORTCUT_LEASE.suppresses_backend(backend, shortcut_monotonic_ms()) {
        let event = "eval_toggle_suppressed_ibus";
        trace_hotkey_event(event, Some(backend));
        return true;
    }
    if backend == "global_shortcut" && IBUS_SHORTCUT_LEASE.poll_in_flight() {
        let event = "eval_toggle_x11_consumed_during_ibus_poll";
        trace_hotkey_event(event, Some(backend));
    }
    false
}

fn emit_toggle_event(app_handle: &tauri::AppHandle, backend_used: &str) {
    if let Err(e) = app_handle.emit_to("main", TOGGLE_DICTATION_EVENT, ()) {
        error!("Failed to emit toggle event: {e}");
    } else {
        trace_hotkey_event("toggle_event_emitted", Some(backend_used));
    }
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

fn replay_pending_browser_stops(app_handle: &tauri::AppHandle) {
    BROWSER_EVENT_DELIVERY.replay(|stop| {
        app_handle
            .emit_to("main", TOGGLE_DICTATION_EVENT, stop.clone())
            .is_ok()
    });
}

fn eval_toggle_with_backend(app_handle: &tauri::AppHandle, backend_used: &str) {
    trace_hotkey_event("eval_toggle_entered", Some(backend_used));

    if suppress_passive_shortcut(app_handle, backend_used) {
        return;
    }
    if !shortcut_arbitration::admit_toggle(
        &LAST_TOGGLE_MS,
        shortcut_monotonic_ms(),
        TOGGLE_DEBOUNCE_MS,
    ) {
        trace_hotkey_event("eval_toggle_debounced", Some(backend_used));
        return;
    }
    if backend_used == "evdev" {
        notify_passive_shortcut_once(app_handle);
    }

    if !FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst) {
        buffer_toggle_until_frontend_ready(backend_used);
        return;
    }

    emit_toggle_event(app_handle, backend_used);
}

/// Evdev only observes the chord, so the focused app acted on it too, often
/// moving the cursor before the first paste. Explain the fix once per launch.
fn notify_passive_shortcut_once(app_handle: &tauri::AppHandle) {
    static NOTIFIED: AtomicBool = AtomicBool::new(false);
    if NOTIFIED.load(Ordering::SeqCst) {
        return;
    }
    let app = app_handle.clone();
    // The panel check runs a bounded helper; keep it off the key listener.
    std::thread::spawn(move || {
        if let Some(detail) = stop_shortcut_setup_issue(&app) {
            if !NOTIFIED.swap(true, Ordering::SeqCst) {
                send_notification("Your shortcut also reached the app", &detail);
            }
        }
    });
}

// --- Hotkey configuration ---

#[derive(Debug)]
struct ConfiguredHotkey {
    hotkey: String,
    /// Startup notification title and body.
    notice: Option<(&'static str, String)>,
}

fn repair_invalid_configured_hotkey(config: &mut AppConfig) -> Option<String> {
    let error = validate_dictation_hotkey(&config.hotkey).err()?;
    let invalid_hotkey = std::mem::replace(&mut config.hotkey, "Alt+D".to_string());
    Some(format!(
        "Your shortcut '{invalid_hotkey}' was reset to Alt+D: {error}"
    ))
}

// A settings file VOCO cannot load or repair also fails get_config, so the
// window pauses dictation until the user fixes it there.
fn configured_hotkey() -> ConfiguredHotkey {
    let Ok(mut config) = AppConfig::load() else {
        return ConfiguredHotkey {
            hotkey: "Alt+D".to_string(),
            notice: Some((
                "Dictation paused",
                "VOCO could not load your settings. Open VOCO to fix them.".to_string(),
            )),
        };
    };
    let invalid_hotkey = config.hotkey.clone();
    let notice = repair_invalid_configured_hotkey(&mut config).map(|notice| match config.save() {
        Ok(()) => ("Shortcut reset", notice),
        Err(error) => (
            "Dictation paused",
            format!(
                "VOCO could not reset your shortcut '{invalid_hotkey}' to Alt+D ({error}). Open VOCO to fix your settings."
            ),
        ),
    });
    ConfiguredHotkey {
        hotkey: config.hotkey,
        notice,
    }
}

fn register_global_shortcut_listener(app: &tauri::AppHandle, hotkey: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut = hotkey
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid hotkey '{hotkey}': {e}"))?;
    let handle = app.clone();
    let label = hotkey.to_string();
    let binding_version = HOTKEY_BINDING_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
    let gesture = shortcut_arbitration::PluginGesture::new();
    // A root X11 passive grab sends keyboard input to VOCO while the chord is
    // held. Toggle on release so the following paste keys reach the focused app.
    let complete_on_release = cfg!(target_os = "linux") && !is_wayland_session();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            let current_version = HOTKEY_BINDING_VERSION.load(Ordering::SeqCst);
            let pressed = event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed;
            if complete_on_release {
                // A paste during the hold would also reach VOCO; it waits instead.
                insertion::note_x11_shortcut(pressed);
            }
            if !gesture.admit(
                pressed,
                complete_on_release,
                current_version == binding_version && !USE_EVDEV_HOTKEY.load(Ordering::SeqCst),
            ) {
                return;
            }

            debug!("{label} detected via global shortcut plugin");
            trace_hotkey_event(
                "hotkey_event_received_global_shortcut",
                Some("global_shortcut"),
            );
            eval_toggle_with_backend(&handle, "global_shortcut");
        })
        .map_err(|e| format!("Failed to register global shortcut {hotkey}: {e}"))?;
    Ok(())
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

fn apply_hotkey_runtime_state(app: &tauri::AppHandle, new_hotkey: &str) -> Result<(), String> {
    let use_evdev_hotkey = prefers_evdev_hotkey(is_wayland_session(), new_hotkey);

    #[cfg(target_os = "linux")]
    if should_start_evdev_listener(
        use_evdev_hotkey,
        EVDEV_LISTENER_STARTED.load(Ordering::SeqCst),
    ) {
        ensure_evdev_hotkey_listener(app);
    }

    let enable_plugin = should_register_shortcut_fallback(
        use_evdev_hotkey,
        IBUS_SHORTCUT_LEASE.has_authority(shortcut_monotonic_ms()),
    );
    sync_global_shortcut_binding(app, new_hotkey, enable_plugin)?;

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

    Ok(())
}

/// Change the hotkey at runtime.
pub fn change_hotkey_runtime(app: &tauri::AppHandle, new_hotkey: &str) -> Result<(), String> {
    persist_config_patch(
        app,
        AppConfigPatch::with_hotkey(new_hotkey.to_string()),
        true,
    )?;
    Ok(())
}

// --- Socket listener ---

fn cleanup_socket_files() {
    if let Err(error) = trigger_socket::shutdown() {
        warn!("Trigger socket cleanup preserved an unsafe or changed entry: {error}");
    }
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

            native_capture_commands::shutdown();
            crash_recovery::clean_exit();
            cleanup_socket_files();
            std::process::exit(128 + received_signal);
        });
    }
}

fn start_socket_listener(app_handle: tauri::AppHandle) {
    let paths = match trigger_socket::paths() {
        Ok(paths) => paths,
        Err(error) => {
            error!("Trigger sockets unavailable: {error}");
            return;
        }
    };
    for path in paths {
        let handle = app_handle.clone();
        std::thread::spawn(move || loop {
            let listener = match trigger_socket::bind(&path) {
                Ok(listener) => listener,
                Err(error) => {
                    error!(
                        "Failed to create trigger socket at {}: {error}",
                        path.display()
                    );
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    continue;
                }
            };
            info!("Socket listener ready: {}", path.display());
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        if let Err(error) = trigger_socket::validate_peer(&stream) {
                            warn!("Rejected trigger connection: {error}");
                            continue;
                        }
                        debug!("Toggle received via socket");
                        trace_hotkey_event("socket_toggle_received", Some("socket"));
                        eval_toggle_with_backend(&handle, "socket");
                    }
                    Err(error) => {
                        warn!("Socket accept error (will rebind): {error}");
                        break;
                    }
                }
            }
        });
    }
}

// --- evdev hotkey listener (passive Wayland shortcut) ---

/// Synthetic keyboards: VOCO's own paste keys, and another tool's ydotoold, must
/// never count as the person holding a shortcut or a modifier.
#[cfg(target_os = "linux")]
fn is_ignored_evdev_device_name(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized == virtual_keyboard::DEVICE_NAME.to_ascii_lowercase()
        || normalized.contains("ydotoold virtual device")
}

#[cfg(target_os = "linux")]
fn supports_evdev_hotkey(device: &evdev::Device) -> bool {
    supports_evdev_hotkey_parts(device.name(), device.supported_keys())
}

#[cfg(target_os = "linux")]
fn supports_evdev_hotkey_parts(
    name: Option<&str>,
    keys: Option<&evdev::AttributeSetRef<evdev::KeyCode>>,
) -> bool {
    if name.map(is_ignored_evdev_device_name).unwrap_or(false) {
        return false;
    }
    let Some(keys) = keys else {
        return false;
    };
    let has_alt =
        keys.contains(evdev::KeyCode::KEY_LEFTALT) || keys.contains(evdev::KeyCode::KEY_RIGHTALT);
    has_alt && (keys.contains(evdev::KeyCode::KEY_D) || keys.contains(evdev::KeyCode::KEY_R))
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
    key_state: &std::sync::Arc<Mutex<hotkey_state::HotkeyState>>,
) -> usize {
    let mut discovered = 0;

    for path in supported_evdev_keyboard_paths() {
        if mark_evdev_path_watched(&path) {
            discovered += 1;
            info!("Discovered evdev keyboard: {}", path.display());
            spawn_evdev_device_worker(app_handle.clone(), path, key_state.clone());
        }
    }

    discovered
}

#[cfg(target_os = "linux")]
fn spawn_evdev_device_worker(
    app_handle: tauri::AppHandle,
    path: std::path::PathBuf,
    key_state: std::sync::Arc<Mutex<hotkey_state::HotkeyState>>,
) {
    use evdev::raw_stream::RawDevice;

    std::thread::spawn(move || {
        let mut reopen_logged = false;

        loop {
            let mut dev = match RawDevice::open(&path) {
                Ok(device) => {
                    // event paths are reused after unplug. Recheck capabilities
                    // and the virtual-device exclusion on every open.
                    if !supports_evdev_hotkey_parts(device.name(), device.supported_keys()) {
                        if let Ok(mut state) = key_state.lock() {
                            state.detach(&path);
                        }
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        continue;
                    }
                    let held_keys = match device.get_key_state() {
                        Ok(keys) => keys,
                        Err(error) => {
                            warn!("Cannot synchronize keyboard {}: {error}", path.display());
                            std::thread::sleep(std::time::Duration::from_secs(2));
                            continue;
                        }
                    };
                    if let Ok(mut state) = key_state.lock() {
                        state.attach(&path, held_keys.iter());
                    } else {
                        error!("Failed to lock evdev keyboard state");
                        return;
                    }
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
            let keys = dev.supported_keys();
            let mut readiness = SHORTCUT_OBSERVATIONS.device(
                keys.is_some_and(|keys| keys.contains(evdev::KeyCode::KEY_D)),
                keys.is_some_and(|keys| {
                    keys.contains(evdev::KeyCode::KEY_LEFTSHIFT)
                        || keys.contains(evdev::KeyCode::KEY_RIGHTSHIFT)
                }),
            );

            loop {
                // RawDevice exposes SYN_DROPPED. The synchronized wrapper can
                // fabricate key presses when repairing state, which must never
                // be treated as fresh user activation.
                let events = match dev.fetch_events() {
                    Ok(events) => Ok(events.collect::<Vec<_>>()),
                    Err(error) => Err(error),
                };
                match events {
                    Ok(events) => {
                        if events.iter().any(|event| {
                            matches!(
                                event.destructure(),
                                evdev::EventSummary::Synchronization(
                                    _,
                                    evdev::SynchronizationCode::SYN_DROPPED,
                                    _
                                )
                            )
                        }) {
                            readiness.unsynchronized();
                        }
                        let (actions, synchronize_after_batch) = match key_state.lock() {
                            Ok(mut state) => state.batch(
                                &path,
                                &events,
                                EVDEV_HOTKEY_MODE.load(Ordering::SeqCst),
                            ),
                            Err(_) => {
                                error!("Failed to lock evdev keyboard state");
                                return;
                            }
                        };
                        for action in actions {
                            match action {
                                hotkey_state::HotkeyAction::Dictation => {
                                    trace_hotkey_event(
                                        "hotkey_event_received_evdev",
                                        Some("evdev"),
                                    );
                                    eval_toggle_with_backend(&app_handle, "evdev");
                                }
                            }
                        }
                        if synchronize_after_batch {
                            match dev.get_key_state() {
                                Ok(keys) => {
                                    if let Ok(mut state) = key_state.lock() {
                                        state.attach(&path, keys.iter());
                                        readiness.synchronized();
                                    }
                                }
                                Err(error) => {
                                    warn!(
                                        "Failed to resynchronize keyboard {}: {error}",
                                        path.display()
                                    );
                                    break;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        if let Ok(mut state) = key_state.lock() {
                            state.detach(&path);
                        }
                        warn!(
                            "Keyboard read error on {}: {e}. Reopening device",
                            path.display()
                        );
                        break;
                    }
                }
            }

            drop(readiness);
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

#[cfg(target_os = "linux")]
fn spawn_evdev_polling_supervisor(
    app_handle: tauri::AppHandle,
    key_state: std::sync::Arc<Mutex<hotkey_state::HotkeyState>>,
) {
    std::thread::spawn(move || loop {
        let discovered = spawn_supported_evdev_device_workers(&app_handle, &key_state);
        if discovered > 0 {
            info!(
                "evdev polling fallback discovered {} new keyboard path(s)",
                discovered
            );
        }

        std::thread::sleep(std::time::Duration::from_secs(3));
    });
}

#[cfg(target_os = "linux")]
fn spawn_evdev_device_watcher(
    app_handle: tauri::AppHandle,
    key_state: std::sync::Arc<Mutex<hotkey_state::HotkeyState>>,
) {
    use inotify::{EventMask, Inotify, WatchMask};

    std::thread::spawn(move || {
        let mut inotify = match Inotify::init() {
            Ok(inotify) => inotify,
            Err(e) => {
                warn!(
                    "Failed to initialize inotify for /dev/input watching: {e}. Falling back to polling."
                );
                spawn_evdev_polling_supervisor(app_handle, key_state);
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
            spawn_evdev_polling_supervisor(app_handle, key_state);
            return;
        }

        info!("Watching /dev/input for evdev hotkey device changes");

        let mut buffer = [0u8; 4096];
        loop {
            let events = match inotify.read_events_blocking(&mut buffer) {
                Ok(events) => events.collect::<Vec<_>>(),
                Err(e) => {
                    warn!("evdev device watcher failed: {e}. Falling back to polling discovery.");
                    spawn_evdev_polling_supervisor(app_handle, key_state);
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
                let discovered = spawn_supported_evdev_device_workers(&app_handle, &key_state);
                if discovered > 0 {
                    info!(
                        "evdev watcher discovered {} new keyboard path(s)",
                        discovered
                    );
                }
            }
        }
    });
}

// Shared with desktop paste, which waits for physical modifiers to be released.
#[cfg(target_os = "linux")]
static EVDEV_KEYS: LazyLock<std::sync::Arc<Mutex<hotkey_state::HotkeyState>>> =
    LazyLock::new(Default::default);

/// Whether a physical keyboard modifier is held; None without a complete view.
#[cfg(target_os = "linux")]
pub(crate) fn evdev_modifiers_held() -> Option<bool> {
    EVDEV_KEYS.lock().ok()?.modifiers_held()
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn evdev_modifiers_held() -> Option<bool> {
    None
}

#[cfg(target_os = "linux")]
fn start_hotkey_listener(app_handle: tauri::AppHandle) -> bool {
    let key_state = std::sync::Arc::clone(&EVDEV_KEYS);

    let initial_discovered = spawn_supported_evdev_device_workers(&app_handle, &key_state);
    if initial_discovered == 0 {
        warn!(
            "No readable keyboard for the passive shortcut at startup; VOCO keeps watching. The GNOME panel or a desktop shortcut for voco --toggle needs no keyboard access."
        );
    } else {
        info!(
            "evdev startup discovery found {} keyboard path(s)",
            initial_discovered
        );
    }
    // evdev_listener_started marks the discovery supervisor, not an open keyboard.
    info!("evdev device discovery supervisor started");
    trace_hotkey_event("evdev_listener_started", Some("evdev"));

    spawn_evdev_device_watcher(app_handle.clone(), key_state);
    // Without a readable keyboard, the panel or IBus, the chord does nothing at
    // all. Give the panel its usual time to attach, then say how to fix it.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        notify_unreachable_shortcut(&app_handle);
    });

    true
}

#[cfg(target_os = "linux")]
fn notify_unreachable_shortcut(app: &tauri::AppHandle) {
    let mode = EVDEV_HOTKEY_MODE.load(Ordering::SeqCst);
    let unreachable = USE_EVDEV_HOTKEY.load(Ordering::SeqCst)
        && mode <= 1
        && SHORTCUT_OBSERVATIONS.keyboards_for(mode) == Some(0)
        && !panel::is_attached()
        && !app
            .state::<ibus_shortcut::IbusShortcutService>()
            .status()
            .available;
    if !unreachable {
        return;
    }
    let hotkey = if mode == 0 { "Alt+D" } else { "Alt+Shift+D" };
    if let Some(detail) =
        panel_setup::unreachable_shortcut_detail(hotkey, panel_setup::cached_check(), false)
    {
        send_notification("Your shortcut can't reach VOCO yet", &detail);
    }
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

/// Without the companion or a StatusNotifier host, which stock Debian and
/// Fedora GNOME both lack, VOCO has nothing in the top bar. After the panel's
/// usual attach time, say so once and how to add one.
#[cfg(target_os = "linux")]
fn notify_missing_top_bar_presence() {
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(20));
        if panel::is_attached() || status_notifier_host_present() != Some(false) {
            return;
        }
        let gnome = std::env::var("XDG_CURRENT_DESKTOP")
            .unwrap_or_default()
            .split(':')
            .any(|desktop| desktop.eq_ignore_ascii_case("gnome"));
        let detail = if gnome {
            "Open VOCO from the app menu, choose Enable live panel in Help, then sign out and back in."
        } else {
            "Your desktop shows no tray icons. Open VOCO from the app menu for Settings and Review."
        };
        send_notification("VOCO has no icon in the top bar", detail);
    });
}

/// Whether a tray host owns the StatusNotifierWatcher name; None when unknown.
#[cfg(target_os = "linux")]
fn status_notifier_host_present() -> Option<bool> {
    use glib::variant::ToVariant;
    use webkit2gtk::gio;
    let bus = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE).ok()?;
    bus.call_sync(
        Some("org.freedesktop.DBus"),
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "NameHasOwner",
        Some(&("org.kde.StatusNotifierWatcher",).to_variant()),
        None,
        gio::DBusCallFlags::NONE,
        500,
        gio::Cancellable::NONE,
    )
    .ok()?
    .get::<(bool,)>()
    .map(|(owned,)| owned)
}

/// VOCO 2026.0.60 and earlier pasted through `voco-ydotoold.service`. After the
/// upgrade its unit file is gone, but this login's enablement link remains and
/// an instance can keep running or restarting until sign-out. Retire only
/// VOCO's own unit: the link must point at the file the old package shipped.
#[cfg(target_os = "linux")]
fn retire_legacy_input_service() {
    const UNIT: &str = "voco-ydotoold.service";
    let Some(config) = dirs::config_dir() else {
        return;
    };
    let link = config
        .join("systemd/user/graphical-session.target.wants")
        .join(UNIT);
    let ours = std::fs::read_link(&link)
        .is_ok_and(|target| target == std::path::Path::new("/usr/lib/systemd/user").join(UNIT));
    if !ours
        || std::path::Path::new("/usr/lib/systemd/user")
            .join(UNIT)
            .exists()
    {
        return;
    }
    if let Err(error) = std::fs::remove_file(&link) {
        warn!("Could not remove the retired input service link: {error}");
        return;
    }
    // Off the startup path; the manager may no longer know the unit at all.
    std::thread::spawn(|| {
        for arguments in [
            ["--user", "stop", UNIT].as_slice(),
            ["--user", "daemon-reload"].as_slice(),
        ] {
            let _ = process_runner::command("systemctl")
                .args(arguments)
                .status();
        }
        info!("Retired VOCO's previous Wayland input service");
    });
}

pub fn run() -> Result<(), String> {
    let single_instance_guard = match single_instance::acquire() {
        Ok(guard) => guard,
        #[cfg(target_os = "linux")]
        Err(single_instance::SingleInstanceError::AlreadyRunning { .. }) => {
            return activation::request()
        }
        Err(error) => return Err(error.to_string()),
    };

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    #[cfg(target_os = "linux")]
    if is_wayland_session() {
        retire_legacy_input_service();
        // Created now so the compositor has added the device long before the
        // first paste; a failure stays visible through desktop setup status.
        if let Err(detail) = virtual_keyboard::ensure() {
            warn!("{detail}");
        }
    }
    #[cfg(target_os = "linux")]
    notify_missing_top_bar_presence();

    #[cfg(target_os = "linux")]
    install_socket_cleanup_signal_handler();
    performance::initialize();
    // Recovery is optional: an unusable journal must not block dictation.
    if let Err(error) = crash_recovery::initialize(&xdg_state_home()) {
        warn!("Crash recovery is unavailable: {error}");
    }
    native_capture_commands::initialize();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(single_instance_guard)
        .manage(ibus_shortcut::IbusShortcutService::default())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if webview.label() == "main" {
                    // Journal writes from the previous renderer become stale.
                    let epoch = RENDERER_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
                    if let Err(error) = crash_recovery::renderer_restarted(epoch) {
                        log::warn!("Renderer crash recovery could not be prepared: {error}");
                    }
                    native_capture_commands::reset_renderer();
                }
                // Close the private channel first, so the engine drops a
                // shortcut armed or triggered for the previous renderer
                // before its replacement can start.
                webview
                    .state::<ibus_shortcut::IbusShortcutService>()
                    .shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            crash_recovery::list_crash_recovery,
            crash_recovery::get_crash_journal_epoch,
            crash_recovery::dismiss_crash_recovery,
            crash_recovery::begin_crash_journal,
            crash_recovery::update_crash_journal,
            crash_recovery::finish_crash_journal,
            crash_recovery::keep_crash_journal,
            speech_stream::speech_stream,
            native_capture_commands::native_capture_capabilities,
            native_capture_commands::native_capture_list_sources,
            native_capture_commands::native_capture_select_source,
            native_capture_commands::native_capture_begin,
            native_capture_commands::native_capture_drain,
            native_capture_commands::native_capture_stop,
            native_capture_commands::native_capture_cancel,
            native_capture_commands::debug_native_capture_enabled,
            native_capture_commands::save_debug_native_retained_source,
            get_config,
            reload_config_from_disk,
            reset_config_to_defaults,
            save_config_patch,
            load_cached_update_state,
            save_cached_update_state,
            get_desktop_paste_status,
            get_desktop_input_status,
            get_panel_setup_status,
            enable_gnome_panel,
            activation::take_launcher_activation,
            paste_desktop_text,
            copy_desktop_text,
            get_runtime_diagnostics,
            start_browser_field,
            refresh_shortcut_heartbeat,
            ack_browser_stop,
            append_browser_field,
            finish_browser_field,
            cancel_browser_field,
            release_browser_recording,
            begin_runtime_status_session,
            sync_runtime_status,
            sync_panel_level,
            trace_frontend_hotkey_event,
            has_pending_hotkey_toggle,
            hide_status_overlay,
            show_notification,
            open_external_url,
            open_config_directory,
        ])
        .setup(|app| {
            let browser_app = app.handle().clone();
            let browser = browser_broker::BrowserBroker::bind(move |trigger| {
                BROWSER_EVENT_DELIVERY.dispatch(
                    trigger,
                    FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst),
                    shortcut_heartbeat_is_current(
                        SHORTCUT_RENDERER_HEARTBEAT_MS.load(Ordering::SeqCst),
                        shortcut_monotonic_ms(),
                    ),
                    |event| {
                        browser_app
                            .emit_to("main", TOGGLE_DICTATION_EVENT, event.clone())
                            .is_ok()
                    },
                )
            });
            if let Err(error) = &browser {
                warn!("Browser integration unavailable: {error}");
            }
            app.manage(BrowserIntegration(browser.ok()));
            let startup_ms = now_ms();
            FRONTEND_HOTKEY_HANDLER_READY.store(false, Ordering::SeqCst);
            if let Ok(mut pending_backend) = PENDING_TOGGLE_BACKEND.lock() {
                *pending_backend = None;
            }
            trace_hotkey_event("app_start", Some("internal"));
            start_ibus_shortcut_listener(app.handle().clone());
            let configured_hotkey = configured_hotkey();
            let hotkey = configured_hotkey.hotkey;
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
                info!("evdev hotkey backend selected for {hotkey}");
            } else {
                info!("global shortcut backend selected for {hotkey}");
            }

            info!("Hotkey backend setup attempted");
            info!(
                "[timing] app start -> hotkey backend setup attempt: {}ms",
                now_ms() - startup_ms
            );

            start_socket_listener(app_handle.clone());
            if let Err(error) = activation::start(&app_handle) {
                warn!("Launcher activation unavailable: {error}");
            }

            #[cfg(target_os = "linux")]
            if use_evdev_hotkey {
                ensure_evdev_hotkey_listener(&app_handle);
            }

            if let Err(e) = tray::setup_tray(app, &hotkey) {
                error!("Failed to setup tray: {e}");
            }
            #[cfg(target_os = "linux")]
            panel::setup(app.handle());
            if let Some((title, notice)) = configured_hotkey.notice {
                warn!("{notice}");
                send_notification(title, &notice);
            }

            let model_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = prepare_model_at_startup(&model_handle) {
                    tray::update_model_download_status(
                        &model_handle,
                        tray::ModelDownloadStatus::Failed,
                    );
                    error!("Selected speech model startup failed: {error}");
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|error| error.to_string())?
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                crash_recovery::clean_exit();
                performance::shutdown();
                native_capture_commands::shutdown();
                app.state::<ibus_shortcut::IbusShortcutService>().shutdown();
                cleanup_socket_files();
            }
        });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkey_trace_requires_explicit_opt_in() {
        assert_eq!(trace_modes(None, None), (false, false));
        assert_eq!(trace_modes(Some("true"), None), (false, false));
        assert_eq!(trace_modes(Some("1"), None), (true, false));
        assert_eq!(trace_modes(None, Some("1")), (false, true));
    }

    #[test]
    fn external_url_allowlist_accepts_voco_releases_and_exact_setup_guide() {
        assert!(is_allowed_external_url(
            "https://github.com/sergiopesch/voco/blob/master/docs/platform/README.md#wayland-paste-keys"
        ));
        assert!(!is_allowed_external_url(
            "https://github.com/sergiopesch/voco/blob/master/docs/platform/README.md?redirect=elsewhere"
        ));
        assert!(is_allowed_external_url(
            "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.16"
        ));
        assert!(!is_allowed_external_url(
            "https://github.com/sergiopesch/voco"
        ));
        assert!(!is_allowed_external_url(
            "https://example.com/sergiopesch/voco/releases/tag/voco.2026.0.16"
        ));
        assert!(!is_allowed_external_url(
            "http://github.com/sergiopesch/voco/releases/tag/voco.2026.0.16"
        ));
    }

    #[test]
    fn consuming_shortcut_tracks_committed_config_without_plugin_reregistration() {
        let snapshot = |revision, hotkey: &str| ConfigSnapshot {
            revision,
            config: AppConfig {
                hotkey: hotkey.to_string(),
                ..AppConfig::default()
            },
        };
        let mut cached = None;
        refresh_shortcut_config(&mut cached, 0, || Ok(snapshot(0, "Alt+D"))).unwrap();
        // Both chords use evdev on Wayland: no plugin binding revision changes.
        refresh_shortcut_config(&mut cached, 1, || Ok(snapshot(1, "Alt+Shift+D"))).unwrap();
        assert_eq!(cached.as_ref().unwrap().config.hotkey, "Alt+Shift+D");
        // A write completing between the revision check and locked read must
        // publish the revision corresponding to the actual configuration read.
        refresh_shortcut_config(&mut cached, 2, || Ok(snapshot(3, "Ctrl+Shift+V"))).unwrap();
        refresh_shortcut_config(&mut cached, 3, || {
            panic!("must retain the committed snapshot")
        })
        .unwrap();
        assert_eq!(cached.as_ref().unwrap().config.hotkey, "Ctrl+Shift+V");
        assert!(
            refresh_shortcut_config(&mut cached, 4, || Err("write/read unavailable".into()))
                .is_err()
        );
        assert_eq!(cached.as_ref().unwrap().revision, 3);
    }

    #[test]
    fn consuming_context_releases_global_grab_and_unavailable_context_restores_it() {
        assert!(should_register_shortcut_fallback(false, false));
        assert!(!should_register_shortcut_fallback(false, true));
        assert!(!should_register_shortcut_fallback(true, true));
        assert!(!should_register_shortcut_fallback(true, false));
    }

    #[test]
    fn shortcut_heartbeat_uses_expiring_monotonic_elapsed_time() {
        assert!(!shortcut_heartbeat_is_current(-1, 0));
        assert!(shortcut_heartbeat_is_current(0, 0));
        assert!(shortcut_heartbeat_is_current(1000, 3999));
        assert!(!shortcut_heartbeat_is_current(1000, 4000));
        assert!(!shortcut_heartbeat_is_current(1000, 999));
    }

    #[cfg(unix)]
    #[test]
    fn frontend_trace_fields_accept_only_bounded_values() {
        assert!(FrontendTraceFields {
            selected_device_configured: Some(true),
            track_sample_rate: Some(48000),
            duration_ms: Some(42),
            dictation_session_id: Some(1),
        }
        .validate()
        .is_ok());

        assert!(FrontendTraceFields {
            selected_device_configured: None,
            track_sample_rate: Some(1),
            duration_ms: None,
            dictation_session_id: None,
        }
        .validate()
        .unwrap_err()
        .contains("Unsupported track sample rate"));

        assert!(FrontendTraceFields {
            selected_device_configured: None,
            track_sample_rate: None,
            duration_ms: Some(3_600_001),
            dictation_session_id: None,
        }
        .validate()
        .unwrap_err()
        .contains("Unsupported duration"));

        assert!(FrontendTraceFields {
            selected_device_configured: None,
            track_sample_rate: None,
            duration_ms: None,
            dictation_session_id: Some(0),
        }
        .validate()
        .unwrap_err()
        .contains("Unsupported dictation session id"));
    }

    #[test]
    fn dictation_trace_event_allowlist_covers_frontend_emissions() {
        let sources = [
            include_str!("../../src/hooks/useDictation.ts"),
            include_str!("../../src/lib/dictationRecording.ts"),
            include_str!("../../src/lib/desktopCaptureTail.ts"),
        ];
        let emitted_events: Vec<_> = sources
            .iter()
            .flat_map(|source| {
                source
                    .split("traceDictationEvent(")
                    .skip(1)
                    .filter_map(|call| call.trim_start().strip_prefix('"'))
                    .filter_map(|literal| literal.split_once('"').map(|(event, _)| event))
            })
            .collect();
        assert!(
            emitted_events.len() > 20,
            "frontend event extraction must cover real calls"
        );
        for event in emitted_events {
            assert!(
                is_supported_dictation_trace_event(event),
                "{event} should be accepted by the frontend trace allowlist"
            );
        }
        assert!(!is_supported_dictation_trace_event(
            "dictation_transcript_text"
        ));
    }

    #[test]
    fn hotkey_modes() {
        assert_eq!(hotkey_to_evdev_mode("Alt+D"), 0);
        assert_eq!(hotkey_to_evdev_mode("Alt+Shift+D"), 1);
        assert_eq!(hotkey_to_evdev_mode("alt + d"), 0);
        assert_eq!(hotkey_to_evdev_mode("SHIFT+ALT+KEYD"), 1);
        assert_eq!(hotkey_to_evdev_mode("Ctrl+Shift+V"), 255);
    }

    #[test]
    fn dictation_hotkey_requires_a_non_shift_modifier() {
        for hotkey in ["D", "Shift+D", "F8", "Shift+Equal"] {
            assert!(
                validate_dictation_hotkey(hotkey)
                    .unwrap_err()
                    .contains("must include Alt, Control, or Super"),
                "unsafe hotkey was not rejected: {hotkey}"
            );
        }
    }

    #[test]
    fn invalid_persisted_hotkeys_fall_back_without_touching_valid_values() {
        let mut invalid = AppConfig {
            hotkey: "Alt+".to_string(),
            ..AppConfig::default()
        };
        assert!(repair_invalid_configured_hotkey(&mut invalid).is_some());
        assert_eq!(invalid.hotkey, "Alt+D");

        let mut reserved = AppConfig {
            hotkey: "shift + alt + r".to_string(),
            ..AppConfig::default()
        };
        assert!(repair_invalid_configured_hotkey(&mut reserved).is_none());
        assert_eq!(reserved.hotkey, "shift + alt + r");

        let mut modifierless = AppConfig {
            hotkey: "F8".to_string(),
            ..AppConfig::default()
        };
        assert!(repair_invalid_configured_hotkey(&mut modifierless).is_some());
        assert_eq!(modifierless.hotkey, "Alt+D");

        let mut valid = AppConfig {
            hotkey: "Ctrl+Shift+V".to_string(),
            ..AppConfig::default()
        };
        assert!(repair_invalid_configured_hotkey(&mut valid).is_none());
        assert_eq!(valid.hotkey, "Ctrl+Shift+V");
    }

    #[test]
    fn config_snapshot_validation_fails_closed_for_an_unpersisted_hotkey_repair() {
        let invalid = AppConfig {
            hotkey: "F8".to_string(),
            ..AppConfig::default()
        };
        assert!(validate_loaded_config(&invalid)
            .unwrap_err()
            .contains("must include Alt, Control, or Super"));

        let valid = AppConfig {
            hotkey: "Alt+D".to_string(),
            ..AppConfig::default()
        };
        assert!(validate_loaded_config(&valid).is_ok());
    }

    #[test]
    fn hotkey_rollback_rebinds_the_previous_hotkey_and_names_a_failed_restore() {
        let mut rebound = Vec::new();
        let restored = restore_hotkey("Alt+D", "save failed".into(), |hotkey| {
            rebound.push(hotkey.to_string());
            Ok(())
        });
        assert_eq!(restored, "save failed");
        let failed = restore_hotkey("Alt+D", "save failed".into(), |hotkey| {
            rebound.push(hotkey.to_string());
            Err("grab refused".into())
        });
        assert_eq!(
            failed,
            "save failed; restoring Alt+D also failed: grab refused"
        );
        assert_eq!(rebound, ["Alt+D", "Alt+D"]);
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

    #[cfg(target_os = "linux")]
    #[test]
    fn evdev_hotkey_ignores_synthetic_keyboards() {
        assert!(is_ignored_evdev_device_name("VOCO virtual keyboard"));
        assert!(is_ignored_evdev_device_name("ydotoold virtual device"));
        assert!(is_ignored_evdev_device_name("YDOTOOLD Virtual Device"));
        assert!(!is_ignored_evdev_device_name(
            "AT Translated Set 2 keyboard"
        ));
    }
}
