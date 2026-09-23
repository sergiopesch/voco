#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!(
    "VOCO production builds require the app's custom-protocol feature; use `cargo tauri build --features custom-protocol` instead of `cargo build --release`"
);

mod activation;
mod audio_transport;
mod benchmark_stream;
mod browser_broker;
mod browser_event_delivery;
mod browser_protocol;
mod browser_socket;
mod config;
#[cfg(target_os = "linux")]
mod desktop_input_setup;
#[cfg(target_os = "linux")]
mod desktop_notifications;
mod desktop_shortcut;
mod digest_hex;
mod focus_probe;
#[cfg(target_os = "linux")]
mod hotkey_state;
mod hotkey_trace;
mod insertion;
#[cfg(all(target_os = "linux", feature = "native-capture"))]
mod native_capture;
mod native_capture_commands;
mod owned_preedit;
pub mod panel_setup;
mod performance;
mod process_runner;
mod shortcut_arbitration;
mod shortcut_readiness;
mod single_instance;
mod tray_icons;
mod trigger_socket;

/// Check input prerequisites without launching a window or sending keys.
pub fn check_desktop_input() -> Result<String, String> {
    let status = insertion::desktop_input_status();
    if status.available {
        Ok(status.detail)
    } else {
        Err(status.detail)
    }
}

/// Set up the packaged helper only while this process owns the app's idle boundary.
pub fn setup_desktop_input() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let guard = single_instance::acquire().map_err(|error| {
            format!("Close VOCO before updating its desktop input service: {error}")
        })?;
        desktop_input_setup::migrate(&guard).map_err(|error| error.detail)
    }
    #[cfg(not(target_os = "linux"))]
    Ok("Desktop input setup is only needed on Linux.".into())
}

/// Check the focused destination without recording, changing the clipboard or typing.
pub fn check_desktop_cursor() -> Result<String, String> {
    let status = insertion::desktop_paste_status();
    if status.available {
        Ok("Text cursor verified. VOCO can start here.".into())
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
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

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
static DEBUG_CAPTURE_WRITTEN: AtomicBool = AtomicBool::new(false);
static DEBUG_CAPTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static REGISTERED_PLUGIN_SHORTCUT: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "linux")]
static EVDEV_WATCHED_PATHS: LazyLock<Mutex<std::collections::HashSet<std::path::PathBuf>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

const TOGGLE_DICTATION_EVENT: &str = "voco:toggle-dictation";
const CONFIG_CHANGED_EVENT: &str = "voco:config-changed";
const LEGACY_TOGGLE_DICTATION_EVENT: &str = "voice:toggle-dictation";
const TOGGLE_DEBOUNCE_MS: i64 = 120;
const MAX_AUDIO_SECONDS: usize = 600;
const HIDDEN_WINDOW_POS_X: i32 = -100;
const HIDDEN_WINDOW_POS_Y: i32 = -100;
const HIDDEN_WINDOW_SIZE: u32 = 1;
const OVERLAY_CURSOR_OFFSET_X: i32 = 20;
const OVERLAY_CURSOR_OFFSET_Y: i32 = 24;
const OVERLAY_MARGIN: i32 = 16;

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
    std::env::var_os("XDG_STATE_HOME")
        .map(std::path::PathBuf::from)
        .or_else(dirs::state_dir)
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/state")))
        .unwrap_or_else(std::env::temp_dir)
}

fn hotkey_trace_path() -> std::path::PathBuf {
    xdg_state_home().join("voco").join("hotkey-trace.jsonl")
}

fn debug_capture_dir() -> std::path::PathBuf {
    xdg_state_home().join("voco").join("debug-captures")
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
        if let Some(audio_level_bucket) = fields.audio_level_bucket.as_deref() {
            record["audio_level_bucket"] =
                serde_json::Value::String(audio_level_bucket.to_string());
        }
        if let Some(chunk_count) = fields.chunk_count {
            record["chunk_count"] = serde_json::Value::Number(chunk_count.into());
        }
        if let Some(response_delta_count) = fields.response_delta_count {
            record["response_delta_count"] = serde_json::Value::Number(response_delta_count.into());
        }
        if let Some(selected_device_configured) = fields.selected_device_configured {
            record["selected_device_configured"] =
                serde_json::Value::Bool(selected_device_configured);
        }
        if let Some(track_sample_rate) = fields.track_sample_rate {
            record["track_sample_rate"] = serde_json::Value::Number(track_sample_rate.into());
        }
        if let Some(track_channel_count) = fields.track_channel_count {
            record["track_channel_count"] = serde_json::Value::Number(track_channel_count.into());
        }
        if let Some(echo_cancellation) = fields.echo_cancellation {
            record["echo_cancellation"] = serde_json::Value::Bool(echo_cancellation);
        }
        if let Some(noise_suppression) = fields.noise_suppression {
            record["noise_suppression"] = serde_json::Value::Bool(noise_suppression);
        }
        if let Some(auto_gain_control) = fields.auto_gain_control {
            record["auto_gain_control"] = serde_json::Value::Bool(auto_gain_control);
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
        "dictation_delivery_observation_timeout"
            | "dictation_delivery_observation_changed"
            | "dictation_delivery_observation_unavailable"
            | "dictation_delivery_observation_invalid"
            | "dictation_trigger_start_rejected"
            | "dictation_trigger_stop_rejected"
            | "dictation_trigger_start_admitted"
            | "dictation_trigger_stop_admitted"
            | "dictation_trigger_toggle_admitted"
            | "dictation_desktop_shortcut_acquired"
            | "dictation_desktop_shortcut_released"
            | "dictation_desktop_shortcut_acquire_failed"
            | "dictation_desktop_shortcut_release_failed"
            | "dictation_desktop_target_probe_completed"
            | "dictation_desktop_paste_preflight_completed"
            | "dictation_desktop_clipboard_write_completed"
            | "dictation_desktop_keyboard_dispatch_completed"
            | "dictation_desktop_terminal_route_dispatched"
            | "dictation_desktop_standard_route_dispatched"
            | "dictation_desktop_stream_started"
            | "dictation_desktop_phrase_queued"
            | "dictation_desktop_snapshot_requested"
            | "dictation_desktop_snapshot_limit_reached"
            | "dictation_desktop_snapshot_recognized"
            | "dictation_desktop_snapshot_failed"
            | "dictation_desktop_preview_transcribed"
            | "dictation_desktop_snapshot_coalesced"
            | "dictation_desktop_snapshot_superseded"
            | "dictation_desktop_snapshot_waiting_agreement"
            | "dictation_desktop_snapshot_unchanged"
            | "dictation_desktop_snapshot_revised"
            | "dictation_desktop_snapshot_empty"
            | "dictation_desktop_snapshot_preview_wait"
            | "dictation_desktop_snapshot_final_wait"
            | "dictation_desktop_live_prefix_dispatched"
            | "dictation_desktop_phrase_transcribed"
            | "dictation_desktop_first_phrase_dispatched"
            | "dictation_desktop_stream_flush_completed"
            | "dictation_desktop_stream_failed"
            | "dictation_desktop_paste_session_started"
            | "dictation_desktop_paste_unavailable"
            | "dictation_desktop_cursor_events_pending"
            | "dictation_desktop_cursor_no_active_window"
            | "dictation_desktop_cursor_ambiguous_windows"
            | "dictation_desktop_cursor_no_focused_control"
            | "dictation_desktop_cursor_not_editable"
            | "dictation_desktop_cursor_protected"
            | "dictation_desktop_cursor_control_unavailable"
            | "dictation_desktop_cursor_probe_failed"
            | "dictation_desktop_cursor_unavailable"
            | "dictation_desktop_paste_requested"
            | "dictation_desktop_paste_dispatched"
            | "dictation_desktop_paste_failed"
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
            | "dictation_live_preview_completed"
            | "dictation_live_preview_reused"
            | "dictation_stop_checkpoint_wait_completed"
            | "dictation_stop_preview_wait_completed"
            | "dictation_stop_insertion_wait_completed"
            | "dictation_live_preview_skipped_short_audio"
            | "dictation_live_preview_empty"
            | "dictation_live_preview_updated"
            | "dictation_live_preview_confirmed"
            | "dictation_live_preview_window_advanced"
            | "dictation_live_preview_failed"
            | "dictation_live_cursor_insert_updated"
            | "dictation_live_cursor_insert_cleared"
            | "dictation_live_cursor_insert_finalized"
            | "dictation_live_cursor_insert_failed"
            | "dictation_live_cursor_overlay_fallback"
            | "dictation_live_cursor_unsafe_rewrite_blocked"
            | "dictation_live_cursor_final_unreconciled"
            | "dictation_live_cursor_commit_waiting"
            | "dictation_live_cursor_tail_transcribed"
            | "dictation_live_cursor_tail_flushed"
            | "dictation_live_cursor_tail_flush_failed"
            | "dictation_owned_preedit_started"
            | "dictation_owned_preedit_unavailable"
            | "dictation_owned_preedit_updated"
            | "dictation_owned_preedit_failed"
            | "dictation_owned_preedit_cancelled"
            | "dictation_owned_preedit_committed"
            | "dictation_owned_preedit_commit_failed"
            | "dictation_owned_preedit_final_preserved"
            | "dictation_owned_preedit_progressive_commit"
            | "dictation_canonical_checkpoint_completed"
            | "dictation_canonical_checkpoint_committed"
            | "dictation_canonical_checkpoint_failed"
            | "dictation_canonical_final_completed"
            | "dictation_first_live_text_visible"
            | "dictation_stop_to_final_transcript"
            | "dictation_stop_to_idle"
            | "dictation_recording_duration"
            | "dictation_transcription_completed"
            | "dictation_recording_stopped"
            | "dictation_audio_teardown_completed"
            | "dictation_audio_prepared"
            | "dictation_transcription_started"
            | "dictation_recovery_retained"
            | "dictation_manual_transcript_ready"
            | "dictation_recording_limit_reached"
            | "dictation_enhancement_completed"
            | "dictation_local_assistant_completed"
            | "dictation_final_output_completed"
            | "dictation_final_output_unreconciled"
            | "dictation_final_insertion_failed"
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendTraceFields {
    audio_level_bucket: Option<String>,
    chunk_count: Option<u64>,
    response_delta_count: Option<u64>,
    selected_device_configured: Option<bool>,
    track_sample_rate: Option<u64>,
    track_channel_count: Option<u64>,
    echo_cancellation: Option<bool>,
    noise_suppression: Option<bool>,
    auto_gain_control: Option<bool>,
    duration_ms: Option<u64>,
    dictation_session_id: Option<u64>,
}

impl FrontendTraceFields {
    fn validate(&self) -> Result<(), String> {
        if let Some(bucket) = self.audio_level_bucket.as_deref() {
            match bucket {
                "silent" | "low" | "medium" | "high" => {}
                _ => return Err(format!("Unsupported audio level bucket: {bucket}")),
            }
        }
        if let Some(sample_rate) = self.track_sample_rate {
            if !(8_000..=384_000).contains(&sample_rate) {
                return Err(format!("Unsupported track sample rate: {sample_rate}"));
            }
        }
        if let Some(channel_count) = self.track_channel_count {
            if !(1..=16).contains(&channel_count) {
                return Err(format!("Unsupported track channel count: {channel_count}"));
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

#[tauri::command]
fn get_config() -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| "VOCO configuration writer is unavailable".to_string())?;
    let config = AppConfig::load().map_err(|error| error.to_string())?;
    validate_loaded_config(&config)?;
    Ok(ConfigSnapshot {
        revision: CONFIG_REVISION.load(Ordering::SeqCst),
        config,
    })
}

#[tauri::command]
fn reload_config_from_disk(app: tauri::AppHandle) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| "VOCO configuration writer is unavailable".to_string())?;
    let previous_hotkey = tray::current_hotkey(&app)?;
    let config = AppConfig::load().map_err(|error| error.to_string())?;
    validate_loaded_config(&config)?;
    if let Err(error) = apply_hotkey_runtime_state(&app, &config.hotkey, false) {
        let rollback = apply_hotkey_runtime_state(&app, &previous_hotkey, false);
        return match rollback {
            Ok(()) => Err(format!(
                "Could not apply the repaired hotkey {}: {error}",
                config.hotkey
            )),
            Err(rollback_error) => Err(format!(
                "Could not apply the repaired hotkey {}: {error}; restoring {previous_hotkey} also failed: {rollback_error}",
                config.hotkey
            )),
        };
    }

    let snapshot = ConfigSnapshot {
        revision: CONFIG_REVISION.fetch_add(1, Ordering::SeqCst) + 1,
        config,
    };
    if let Err(error) = app.emit_to("main", CONFIG_CHANGED_EVENT, snapshot.clone()) {
        warn!("Failed to emit reloaded configuration update: {error}");
    }
    Ok(snapshot)
}

#[tauri::command]
fn reset_config_to_defaults(app: tauri::AppHandle) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| "VOCO configuration writer is unavailable".to_string())?;
    let previous_hotkey = tray::current_hotkey(&app)?;
    let default_hotkey = AppConfig::default().hotkey;
    if let Err(error) = apply_hotkey_runtime_state(&app, &default_hotkey, false) {
        let rollback = apply_hotkey_runtime_state(&app, &previous_hotkey, false);
        return match rollback {
            Ok(()) => Err(format!(
                "Could not bind the default hotkey before resetting settings: {error}"
            )),
            Err(rollback_error) => Err(format!(
                "Could not bind the default hotkey before resetting settings: {error}; restoring {previous_hotkey} also failed: {rollback_error}"
            )),
        };
    }
    let config = match AppConfig::reset_to_defaults() {
        Ok(config) => config,
        Err(error) => {
            let rollback = apply_hotkey_runtime_state(&app, &previous_hotkey, false);
            return match rollback {
                Ok(()) => Err(error.to_string()),
                Err(rollback_error) => Err(format!(
                    "{error}; restoring the previous hotkey also failed: {rollback_error}"
                )),
            };
        }
    };
    let snapshot = ConfigSnapshot {
        revision: CONFIG_REVISION.fetch_add(1, Ordering::SeqCst) + 1,
        config,
    };
    if let Err(error) = app.emit_to("main", CONFIG_CHANGED_EVENT, snapshot.clone()) {
        warn!("Failed to emit recovered configuration update: {error}");
    }
    Ok(snapshot)
}

#[tauri::command]
fn open_config_directory() -> Result<(), String> {
    let directory = AppConfig::config_dir_for_recovery().map_err(|error| error.to_string())?;
    process_runner::spawn_desktop_launcher(process_runner::command("xdg-open").arg(&directory))
        .map_err(|error| format!("Failed to open {}: {error}", directory.display()))?;
    Ok(())
}

fn persist_config_patch(
    app: &tauri::AppHandle,
    patch: AppConfigPatch,
    notify_hotkey_change: bool,
) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| "VOCO configuration writer is unavailable".to_string())?;
    let previous = AppConfig::load().map_err(|error| error.to_string())?;
    let mut config = previous.clone();
    patch.apply_to(&mut config);
    let hotkey_changed = previous.hotkey != config.hotkey;

    if hotkey_changed {
        validate_dictation_hotkey(&config.hotkey)?;
        if let Err(error) = apply_hotkey_runtime_state(app, &config.hotkey, false) {
            let rollback = apply_hotkey_runtime_state(app, &previous.hotkey, false);
            return match rollback {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}; restoring the previous hotkey also failed: {rollback_error}"
                )),
            };
        }
    }

    if let Err(error) = config.save() {
        if hotkey_changed {
            if let Err(rollback_error) = apply_hotkey_runtime_state(app, &previous.hotkey, false) {
                return Err(format!(
                    "{error}; restoring the previous hotkey also failed: {rollback_error}"
                ));
            }
        }
        return Err(error.to_string());
    }

    let snapshot = ConfigSnapshot {
        revision: CONFIG_REVISION.fetch_add(1, Ordering::SeqCst) + 1,
        config,
    };
    if let Err(error) = app.emit_to("main", CONFIG_CHANGED_EVENT, snapshot.clone()) {
        warn!("Failed to emit authoritative configuration update: {error}");
    }
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

fn decode_audio_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    audio_transport::decode_samples(bytes)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugDictationCaptureResult {
    audio_path: String,
    timeline_path: String,
}

#[tauri::command]
fn debug_dictation_capture_enabled() -> bool {
    std::env::var("VOCO_DEBUG_CAPTURE_AUDIO").as_deref() == Ok("1")
        && !DEBUG_CAPTURE_WRITTEN.load(Ordering::SeqCst)
}

#[tauri::command(async)]
fn save_debug_dictation_capture(
    audio_bytes: Vec<u8>,
    timeline: serde_json::Value,
) -> Result<Option<DebugDictationCaptureResult>, String> {
    if std::env::var("VOCO_DEBUG_CAPTURE_AUDIO").as_deref() != Ok("1") {
        return Ok(None);
    }
    if DEBUG_CAPTURE_WRITTEN
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(None);
    }

    let result = write_debug_dictation_capture(&audio_bytes, &timeline);
    if result.is_err() {
        DEBUG_CAPTURE_WRITTEN.store(false, Ordering::SeqCst);
    }
    result.map(Some)
}

fn write_debug_dictation_capture(
    audio_bytes: &[u8],
    timeline: &serde_json::Value,
) -> Result<DebugDictationCaptureResult, String> {
    let samples = decode_audio_bytes(audio_bytes)?;
    if samples.is_empty() {
        return Err("Debug capture has no audio samples".to_string());
    }
    if samples.len() > 16_000 * MAX_AUDIO_SECONDS {
        return Err(format!(
            "Debug capture is too long (max {MAX_AUDIO_SECONDS} seconds)"
        ));
    }

    let timeline_bytes = serde_json::to_vec_pretty(timeline)
        .map_err(|error| format!("Failed to encode debug capture timeline: {error}"))?;
    if timeline_bytes.len() > 16 * 1024 * 1024 {
        return Err("Debug capture timeline is too large (max 16MB)".to_string());
    }

    let directory = debug_capture_dir();
    prepare_private_debug_capture_directory(&directory)?;

    let capture_id = format!(
        "dictation-{}-{}-{}",
        now_ms(),
        std::process::id(),
        DEBUG_CAPTURE_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1
    );
    let (audio_path, timeline_path) = write_private_debug_capture_pair(
        &directory,
        &capture_id,
        &encode_pcm16_wav(&samples, 16_000),
        &timeline_bytes,
    )?;

    Ok(DebugDictationCaptureResult {
        audio_path: audio_path.to_string_lossy().into_owned(),
        timeline_path: timeline_path.to_string_lossy().into_owned(),
    })
}

fn encode_pcm16_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_size = samples.len().saturating_mul(2).min(u32::MAX as usize) as u32;
    let mut wav = Vec::with_capacity(44 + data_size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36u32.saturating_add(data_size)).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&sample_rate.saturating_mul(2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    for sample in samples.iter().take((data_size / 2) as usize) {
        let pcm = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        wav.extend_from_slice(&pcm.to_le_bytes());
    }
    wav
}

fn prepare_private_debug_capture_directory(path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|error| {
        format!(
            "Failed to create debug capture directory {}: {error}",
            path.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let metadata = std::fs::symlink_metadata(path).map_err(|error| {
            format!(
                "Failed to inspect debug capture directory {}: {error}",
                path.display()
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "Debug capture path {} must be a real directory",
                path.display()
            ));
        }
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(format!(
                "Debug capture directory {} is not owned by the current user",
                path.display()
            ));
        }

        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(
            |error| {
                format!(
                    "Failed to secure debug capture directory {}: {error}",
                    path.display()
                )
            },
        )?;
        let secured = std::fs::symlink_metadata(path).map_err(|error| {
            format!(
                "Failed to verify debug capture directory {}: {error}",
                path.display()
            )
        })?;
        if secured.mode() & 0o777 != 0o700 || secured.uid() != unsafe { libc::geteuid() } {
            return Err(format!(
                "Debug capture directory {} could not be secured to mode 0700",
                path.display()
            ));
        }
    }
    Ok(())
}

fn create_private_debug_capture_file(path: &std::path::Path) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|error| {
        format!(
            "Failed to create private debug capture file {}: {error}",
            path.display()
        )
    })
}

fn verify_private_debug_capture_file(
    file: &std::fs::File,
    path: &std::path::Path,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|error| {
            format!(
                "Failed to inspect debug capture file {}: {error}",
                path.display()
            )
        })?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o777 != 0o600
        {
            return Err(format!(
                "Debug capture file {} is not a user-owned 0600 regular file",
                path.display()
            ));
        }
    }
    Ok(())
}

fn write_private_debug_capture_pair(
    directory: &std::path::Path,
    capture_id: &str,
    audio_bytes: &[u8],
    timeline_bytes: &[u8],
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let audio_path = directory.join(format!("{capture_id}.wav"));
    let timeline_path = directory.join(format!("{capture_id}.json"));
    let mut audio_file = create_private_debug_capture_file(&audio_path)?;
    let mut timeline_file = match create_private_debug_capture_file(&timeline_path) {
        Ok(file) => file,
        Err(error) => {
            let cleanup = std::fs::remove_file(&audio_path).map_err(|cleanup_error| {
                format!(
                    "{error}; failed to remove partial debug audio {}: {cleanup_error}",
                    audio_path.display()
                )
            });
            return cleanup.and(Err(error));
        }
    };

    let write_result = (|| {
        audio_file.write_all(audio_bytes).map_err(|error| {
            format!(
                "Failed to write debug audio capture {}: {error}",
                audio_path.display()
            )
        })?;
        timeline_file.write_all(timeline_bytes).map_err(|error| {
            format!(
                "Failed to write debug capture timeline {}: {error}",
                timeline_path.display()
            )
        })?;
        audio_file.sync_all().map_err(|error| {
            format!(
                "Failed to sync debug audio capture {}: {error}",
                audio_path.display()
            )
        })?;
        timeline_file.sync_all().map_err(|error| {
            format!(
                "Failed to sync debug capture timeline {}: {error}",
                timeline_path.display()
            )
        })?;
        verify_private_debug_capture_file(&audio_file, &audio_path)?;
        verify_private_debug_capture_file(&timeline_file, &timeline_path)?;
        if let Ok(directory_file) = std::fs::File::open(directory) {
            directory_file.sync_all().map_err(|error| {
                format!(
                    "Failed to sync debug capture directory {}: {error}",
                    directory.display()
                )
            })?;
        }
        Ok::<(), String>(())
    })();

    drop(audio_file);
    drop(timeline_file);

    if let Err(error) = write_result {
        let mut cleanup_errors = Vec::new();
        for path in [&audio_path, &timeline_path] {
            if let Err(cleanup_error) = std::fs::remove_file(path) {
                cleanup_errors.push(format!("{}: {cleanup_error}", path.display()));
            }
        }
        if cleanup_errors.is_empty() {
            return Err(error);
        }
        return Err(format!(
            "{error}; failed to remove partial debug capture files: {}",
            cleanup_errors.join(", ")
        ));
    }

    Ok((audio_path, timeline_path))
}

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
fn begin_desktop_shortcut_session(session_id: String, shortcut_epoch: u64) -> Result<(), String> {
    insertion::begin_shortcut_session(&session_id, shortcut_epoch)
}

#[tauri::command(async)]
fn end_desktop_shortcut_session(session_id: String) -> Result<(), String> {
    insertion::end_shortcut_session(&session_id)
}

#[tauri::command(async)]
fn get_desktop_input_status() -> insertion::DesktopInputStatus {
    insertion::desktop_input_status()
}

#[tauri::command(async)]
fn get_panel_setup_status() -> Result<panel_setup::PanelSetupStatus, String> {
    panel_setup::check(false)
}

#[tauri::command(async)]
fn enable_gnome_panel() -> Result<panel_setup::PanelSetupStatus, String> {
    panel_setup::check(true)
}

#[tauri::command(async)]
fn get_desktop_paste_status() -> insertion::DesktopPasteStatus {
    insertion::desktop_paste_status()
}

#[tauri::command(async)]
async fn paste_desktop_text(
    text: String,
    expected_target_token: Option<String>,
    correlation: Option<insertion::PasteCorrelation>,
) -> Result<insertion::InsertionResult, insertion::InsertionError> {
    // Recipient observation can wait on another app. Keep the UI/capture IPC
    // event loop responsive while the blocking native transaction settles.
    tauri::async_runtime::spawn_blocking(move || {
        insertion::correlated_desktop_paste(
            &text,
            expected_target_token.as_deref(),
            correlation.as_ref(),
        )
    })
    .await
    .map_err(|_| insertion::InsertionError {
        outcome: insertion::DeliveryOutcome::Uncertain,
        message: "Input task interrupted; review retained text before retrying.".into(),
        clipboard_changed: true,
    })?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDiagnostics {
    #[serde(flatten)]
    insertion: insertion::RuntimeDiagnostics,
    owned_preedit: owned_preedit::OwnedPreeditStatus,
    shortcut: shortcut_readiness::Status,
    desktop_paste: insertion::DesktopPasteStatus,
    desktop_input: insertion::DesktopInputStatus,
}

struct BrowserIntegration(Option<browser_broker::BrowserBroker>);

impl From<browser_broker::BrowserStatus> for owned_preedit::OwnedPreeditStatus {
    fn from(status: browser_broker::BrowserStatus) -> Self {
        Self {
            available: status.available,
            ready: status.ready,
            setup_state: status.setup_state,
            detail: status.detail,
            session_id: status.session_id,
            engine_active: status.engine_active,
            focus_lost: status.focus_lost,
            progressive_commit_active: status.progressive_commit_active,
            committed_character_count: status.committed_character_count,
            ownership_intact: status.ownership_intact,
            finalization_outcome: status.finalization_outcome,
            error: status.error,
        }
    }
}

impl BrowserIntegration {
    fn session(&self, id: u64) -> Option<&browser_broker::BrowserBroker> {
        self.0
            .as_ref()
            .filter(|broker| broker.get_status().session_id == Some(id))
    }
}

#[tauri::command(async)]
fn get_runtime_diagnostics(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
) -> RuntimeDiagnostics {
    let owned_preedit = state.status();
    let (desktop_input, desktop_paste) = insertion::desktop_paste_diagnostics();
    RuntimeDiagnostics {
        insertion: insertion::runtime_diagnostics(),
        shortcut: shortcut_runtime_status(owned_preedit.available),
        owned_preedit,
        desktop_paste,
        desktop_input,
    }
}

fn shortcut_runtime_status(bridge_available: bool) -> shortcut_readiness::Status {
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
    let mut status = SHORTCUT_OBSERVATIONS.status(shortcut_readiness::Snapshot {
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
    });
    if status.route == Some("global-shortcut") && desktop_shortcut::degraded() {
        status.state = "unavailable";
        status.detail =
            "Shortcut restoration could not be confirmed. Restart VOCO before using it.";
    }
    status
}

#[tauri::command(async)]
fn get_owned_preedit_status(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
) -> owned_preedit::OwnedPreeditStatus {
    if let Some(broker) = &browser.0 {
        let status = broker.get_status();
        if status.session_id.is_some() {
            return status.into();
        }
    }
    state.status()
}

#[tauri::command(async)]
fn start_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    trigger_id: Option<String>,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    if let Some(trigger) = trigger_id
        .as_deref()
        .filter(|id| id.starts_with("browser:"))
    {
        return browser
            .0
            .as_ref()
            .ok_or("The local browser integration is unavailable.")?
            .start(session_id, trigger)
            .map(Into::into);
    }
    state.start(session_id, trigger_id.as_deref())
}

#[tauri::command(async)]
fn update_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    confirmed_text: String,
    preedit_text: String,
    provisional_text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    // Browser hypotheses stay in VOCO. Only canonical checkpoints or a final
    // transcript can request an addressed application mutation.
    if let Some(broker) = browser.session(session_id) {
        return broker.session_status(session_id).map(Into::into);
    }
    state.update(session_id, confirmed_text, preedit_text, provisional_text)
}

#[tauri::command(async)]
fn commit_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    if let Some(broker) = browser.session(session_id) {
        return broker.commit(session_id, &text).map(Into::into);
    }
    state.commit(session_id, text)
}

#[tauri::command(async)]
fn checkpoint_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    expected_committed_text: String,
    append_text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    if let Some(broker) = browser.session(session_id) {
        return broker
            .append(session_id, &expected_committed_text, &append_text, false)
            .map(Into::into);
    }
    state.checkpoint(session_id, expected_committed_text, append_text)
}

#[tauri::command(async)]
fn finish_canonical_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
    expected_committed_text: String,
    append_text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    if let Some(broker) = browser.session(session_id) {
        return broker
            .append(session_id, &expected_committed_text, &append_text, true)
            .map(Into::into);
    }
    state.finish_canonical(session_id, expected_committed_text, append_text)
}

#[tauri::command(async)]
fn cancel_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    browser: tauri::State<'_, BrowserIntegration>,
    session_id: u64,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    if let Some(broker) = browser.session(session_id) {
        return broker.cancel(session_id).map(Into::into);
    }
    state.cancel(session_id)
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
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to keep overlay on top: {e}"))?;

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

    window
        .show()
        .map_err(|e| format!("Failed to show overlay window: {e}"))?;

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

// --- Bundled speech-runtime readiness ---

fn is_allowed_external_url(url: &str) -> bool {
    url == "https://github.com/sergiopesch/voco/blob/master/docs/platform/README.md#ydotoold-ydotool-daemon"
        || url
            .strip_prefix("https://github.com/sergiopesch/voco/releases/tag/")
            .is_some_and(|tag| !tag.is_empty() && !tag.contains(['\r', '\n', '\\']))
}

fn prepare_model_at_startup(app: &tauri::AppHandle) -> Result<(), String> {
    info!("Preparing bundled Nemotron streaming model at startup");
    benchmark_stream::warmup()?;
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

fn schedule_shortcut_arbitration(app: &tauri::AppHandle, snapshot: &ConfigSnapshot) {
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
                    schedule_shortcut_arbitration(&app_handle, snapshot);
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
                    schedule_shortcut_arbitration(&app_handle, snapshot);
                }
                continue;
            }
            let Some(snapshot) = shortcut_config.as_ref() else {
                continue;
            };
            let state = app_handle.state::<owned_preedit::OwnedPreeditService>();
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
                    schedule_shortcut_arbitration(&app_handle, snapshot);
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
                    schedule_shortcut_arbitration(&app_handle, snapshot);
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
fn suppress_passive_shortcut(backend: &str) -> bool {
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

fn replay_pending_browser_stops(app_handle: &tauri::AppHandle) {
    BROWSER_EVENT_DELIVERY.replay(|stop| {
        app_handle
            .emit_to("main", TOGGLE_DICTATION_EVENT, stop.clone())
            .is_ok()
    });
}

fn eval_toggle_with_backend(app_handle: &tauri::AppHandle, backend_used: &str) {
    trace_hotkey_event("eval_toggle_entered", Some(backend_used));

    if suppress_passive_shortcut(backend_used) {
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

    if !FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst) {
        buffer_toggle_until_frontend_ready(backend_used);
        return;
    }

    emit_toggle_event(app_handle, backend_used);
}

// --- Hotkey configuration ---

#[derive(Debug)]
struct ConfiguredHotkey {
    hotkey: String,
    repair_notice: Option<String>,
}

fn repair_invalid_configured_hotkey(config: &mut AppConfig) -> Option<String> {
    let error = validate_dictation_hotkey(&config.hotkey).err()?;
    let invalid_hotkey = std::mem::replace(&mut config.hotkey, "Alt+D".to_string());
    Some(format!(
        "Configured hotkey '{invalid_hotkey}' was reset: {error}"
    ))
}

fn configured_hotkey() -> ConfiguredHotkey {
    let Ok(mut config) = AppConfig::load() else {
        return ConfiguredHotkey {
            hotkey: "Alt+D".to_string(),
            repair_notice: Some(
                "VOCO could not load the configured hotkey and is using Alt+D.".to_string(),
            ),
        };
    };
    let repair_notice = repair_invalid_configured_hotkey(&mut config).map(|notice| {
        if let Err(error) = config.save() {
            return format!(
                "{notice} VOCO could not persist the repair ({error}); update the hotkey in Settings."
            );
        }
        notice
    });
    ConfiguredHotkey {
        hotkey: config.hotkey,
        repair_notice,
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
    // A root X11 passive grab temporarily removes GTK focus while the chord is
    // held. Observe its completion before querying the destination; no delay or
    // retry may substitute for the unchanged focus and delivery checks.
    let complete_on_release = cfg!(target_os = "linux") && !is_wayland_session();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            let current_version = HOTKEY_BINDING_VERSION.load(Ordering::SeqCst);
            if !gesture.admit(
                event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed,
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
    desktop_shortcut::registered(Some(shortcut.id()));
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
            desktop_shortcut::registered(None);
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

    if notify {
        send_notification(
            "Shortcut preference saved",
            &format!("Preferred shortcut: {new_hotkey}"),
        );
    }

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

// --- evdev hotkey listener (primary mechanism on Wayland) ---

#[cfg(target_os = "linux")]
fn is_ignored_evdev_device_name(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("ydotoold virtual device")
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

#[cfg(target_os = "linux")]
fn start_hotkey_listener(app_handle: tauri::AppHandle) -> bool {
    let key_state = std::sync::Arc::new(Mutex::new(hotkey_state::HotkeyState::default()));

    let initial_discovered = spawn_supported_evdev_device_workers(&app_handle, &key_state);
    if initial_discovered == 0 {
        warn!(
            "No keyboard found for evdev at startup. Add user to 'input' group if needed; VOCO will keep watching for devices."
        );
    } else {
        info!(
            "evdev startup discovery found {} keyboard path(s)",
            initial_discovered
        );
    }
    // This retained event marks discovery supervision, not an open keyboard.
    info!("evdev device discovery supervisor started");
    trace_hotkey_event("evdev_listener_started", Some("evdev"));

    spawn_evdev_device_watcher(app_handle, key_state);

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
    if let Err(error) = desktop_input_setup::migrate(&single_instance_guard) {
        if error.service_may_change {
            return Err(error.detail);
        }
        // A desktop setup failure must remain visible, but browser dictation and
        // explicit local recovery can still work without this optional helper.
        warn!("{}", error.detail);
    }

    #[cfg(target_os = "linux")]
    install_socket_cleanup_signal_handler();
    performance::initialize();
    native_capture_commands::initialize();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(single_instance_guard)
        .manage(owned_preedit::OwnedPreeditService::default())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if webview.label() == "main" {
                    let shortcut_epoch = desktop_shortcut::invalidate_renderer();
                    // Revoke authorization immediately; wait for bounded pending
                    // delivery/X11 cleanup off the UI thread. A late job cannot
                    // release a replacement renderer's newer ownership.
                    tauri::async_runtime::spawn_blocking(move || {
                        if insertion::reset_shortcut_renderer(shortcut_epoch).is_err() {
                            log::warn!("Renderer reset could not confirm shortcut cleanup");
                        }
                    });
                    native_capture_commands::reset_renderer();
                }
                // A renderer reload discards its session ids. Close the
                // private channel first so the engine clears only its owned
                // preedit before the replacement renderer can start.
                webview
                    .state::<owned_preedit::OwnedPreeditService>()
                    .shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            benchmark_stream::benchmark_stream,
            benchmark_stream::recover_stream,
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
            debug_dictation_capture_enabled,
            save_debug_dictation_capture,
            get_desktop_paste_status,
            get_desktop_input_status,
            get_panel_setup_status,
            enable_gnome_panel,
            activation::take_launcher_activation,
            begin_desktop_shortcut_session,
            end_desktop_shortcut_session,
            paste_desktop_text,
            get_runtime_diagnostics,
            get_owned_preedit_status,
            start_owned_preedit,
            refresh_shortcut_heartbeat,
            ack_browser_stop,
            update_owned_preedit,
            commit_owned_preedit,
            checkpoint_owned_preedit,
            finish_canonical_owned_preedit,
            cancel_owned_preedit,
            release_browser_recording,
            begin_runtime_status_session,
            sync_runtime_status,
            sync_panel_level,
            trace_frontend_hotkey_event,
            has_pending_hotkey_toggle,
            show_status_overlay,
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
            if let Some(notice) = configured_hotkey.repair_notice {
                warn!("{notice}");
                send_notification("Hotkey repaired", &notice);
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
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                performance::shutdown();
                native_capture_commands::shutdown();
                app.state::<owned_preedit::OwnedPreeditService>().shutdown();
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
    fn debug_capture_wav_is_valid_mono_pcm16() {
        let wav = encode_pcm16_wav(&[-1.0, 0.0, 1.0], 16_000);

        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u16::from_le_bytes([wav[20], wav[21]]), 1);
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        assert_eq!(
            u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
            16_000
        );
        assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]), 6);
        assert_eq!(wav.len(), 50);
    }

    #[cfg(unix)]
    #[test]
    fn debug_capture_pair_is_private_and_cleans_up_without_overwriting_collisions() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let unique = format!(
            "voco-debug-capture-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        prepare_private_debug_capture_directory(&directory).unwrap();

        let (audio_path, timeline_path) =
            write_private_debug_capture_pair(&directory, "success", b"audio", b"timeline").unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for path in [&audio_path, &timeline_path] {
            let metadata = std::fs::metadata(path).unwrap();
            assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
            assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
        }

        let collision_timeline = directory.join("collision.json");
        let mut existing = create_private_debug_capture_file(&collision_timeline).unwrap();
        existing.write_all(b"keep-existing").unwrap();
        drop(existing);
        let collision = write_private_debug_capture_pair(
            &directory,
            "collision",
            b"must-be-removed",
            b"must-not-overwrite",
        );
        assert!(collision.is_err());
        assert!(!directory.join("collision.wav").exists());
        assert_eq!(
            std::fs::read(&collision_timeline).unwrap(),
            b"keep-existing"
        );

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn external_url_allowlist_accepts_voco_releases_and_exact_setup_guide() {
        assert!(is_allowed_external_url(
            "https://github.com/sergiopesch/voco/blob/master/docs/platform/README.md#ydotoold-ydotool-daemon"
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
    fn frontend_trace_fields_accept_only_non_content_audio_buckets() {
        assert!(FrontendTraceFields {
            audio_level_bucket: Some("medium".to_string()),
            chunk_count: Some(12),
            response_delta_count: Some(3),
            selected_device_configured: Some(true),
            track_sample_rate: Some(48000),
            track_channel_count: Some(1),
            echo_cancellation: Some(false),
            noise_suppression: Some(false),
            auto_gain_control: Some(false),
            duration_ms: Some(42),
            dictation_session_id: Some(1),
        }
        .validate()
        .is_ok());

        assert!(FrontendTraceFields {
            audio_level_bucket: Some("raw audio here".to_string()),
            chunk_count: None,
            response_delta_count: None,
            selected_device_configured: None,
            track_sample_rate: None,
            track_channel_count: None,
            echo_cancellation: None,
            noise_suppression: None,
            auto_gain_control: None,
            duration_ms: None,
            dictation_session_id: None,
        }
        .validate()
        .unwrap_err()
        .contains("Unsupported audio level bucket"));

        assert!(FrontendTraceFields {
            audio_level_bucket: None,
            chunk_count: None,
            response_delta_count: None,
            selected_device_configured: None,
            track_sample_rate: Some(1),
            track_channel_count: Some(1),
            echo_cancellation: None,
            noise_suppression: None,
            auto_gain_control: None,
            duration_ms: None,
            dictation_session_id: None,
        }
        .validate()
        .unwrap_err()
        .contains("Unsupported track sample rate"));

        assert!(FrontendTraceFields {
            audio_level_bucket: None,
            chunk_count: None,
            response_delta_count: None,
            selected_device_configured: None,
            track_sample_rate: None,
            track_channel_count: None,
            echo_cancellation: None,
            noise_suppression: None,
            auto_gain_control: None,
            duration_ms: Some(3_600_001),
            dictation_session_id: None,
        }
        .validate()
        .unwrap_err()
        .contains("Unsupported duration"));

        assert!(FrontendTraceFields {
            audio_level_bucket: None,
            chunk_count: None,
            response_delta_count: None,
            selected_device_configured: None,
            track_sample_rate: None,
            track_channel_count: None,
            echo_cancellation: None,
            noise_suppression: None,
            auto_gain_control: None,
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
            emitted_events.len() > 30,
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
    fn evdev_hotkey_ignores_ydotool_virtual_device() {
        assert!(is_ignored_evdev_device_name("ydotoold virtual device"));
        assert!(is_ignored_evdev_device_name("YDOTOOLD Virtual Device"));
        assert!(!is_ignored_evdev_device_name(
            "AT Translated Set 2 keyboard"
        ));
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
