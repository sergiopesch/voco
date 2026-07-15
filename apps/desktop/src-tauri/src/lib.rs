#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!(
    "VOCO production builds require the app's custom-protocol feature; use `cargo tauri build --features custom-protocol` instead of `cargo build --release`"
);

mod config;
mod insertion;
mod owned_preedit;
mod single_instance;
pub mod transcribe;
mod tray;

use config::{
    load_cached_update_check, save_cached_update_check, AppConfig, AppConfigPatch,
    CachedUpdateCheck, TranscriptEnhancement,
};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};
use transcribe::{WhisperMutex, WhisperState};

// Debounce: ignore duplicate toggle events that arrive almost immediately.
// This collapses duplicate keyboard backends and duplicate evdev devices
// without eating legitimate quick user toggles.
static LAST_TOGGLE_MS: AtomicI64 = AtomicI64::new(0);
static LAST_REALTIME_TOGGLE_MS: AtomicI64 = AtomicI64::new(0);

// Evdev hotkey mode: 0 = Alt+D, 1 = Alt+Shift+D, 255 = custom (disabled)
static EVDEV_HOTKEY_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
static USE_EVDEV_HOTKEY: AtomicBool = AtomicBool::new(false);
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
static EVDEV_LISTENER_STARTED: AtomicBool = AtomicBool::new(false);
static HOTKEY_BINDING_VERSION: AtomicU64 = AtomicU64::new(0);
static REALTIME_HOTKEY_BINDING_VERSION: AtomicU64 = AtomicU64::new(0);
static FRONTEND_HOTKEY_HANDLER_READY: AtomicBool = AtomicBool::new(false);
static PENDING_TOGGLE_BACKEND: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static PENDING_REALTIME_TOGGLE_BACKEND: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));
static TRACE_START: LazyLock<Instant> = LazyLock::new(Instant::now);
static TRACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TRACE_FILE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static MODEL_DOWNLOAD_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static MODEL_VERIFIED_IDENTITY: LazyLock<Mutex<Option<CachedModelIdentity>>> =
    LazyLock::new(|| Mutex::new(None));
static CONFIG_WRITE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static CONFIG_REVISION: AtomicU64 = AtomicU64::new(0);
static DEBUG_CAPTURE_WRITTEN: AtomicBool = AtomicBool::new(false);
static DEBUG_CAPTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static REGISTERED_PLUGIN_SHORTCUT: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));
static REGISTERED_REALTIME_PLUGIN_SHORTCUT: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "linux")]
static EVDEV_WATCHED_PATHS: LazyLock<Mutex<std::collections::HashSet<std::path::PathBuf>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

const TOGGLE_DICTATION_EVENT: &str = "voco:toggle-dictation";
const TOGGLE_REALTIME_EVENT: &str = "voco:toggle-realtime";
const CONFIG_CHANGED_EVENT: &str = "voco:config-changed";
const LEGACY_TOGGLE_DICTATION_EVENT: &str = "voice:toggle-dictation";
const REALTIME_HOTKEY: &str = "Alt+Shift+R";
const TOGGLE_DEBOUNCE_MS: i64 = 120;
const MAX_AUDIO_SECONDS: usize = 600;
const PREVIEW_SAMPLE_RATE: usize = 16_000;
const MIN_PREVIEW_SAMPLES: usize = PREVIEW_SAMPLE_RATE * 7 / 10;
const MAX_PREVIEW_SAMPLES: usize = PREVIEW_SAMPLE_RATE * 20;
const HIDDEN_WINDOW_POS_X: i32 = -100;
const HIDDEN_WINDOW_POS_Y: i32 = -100;
const HIDDEN_WINDOW_SIZE: u32 = 1;
const OVERLAY_CURSOR_OFFSET_X: i32 = 20;
const OVERLAY_CURSOR_OFFSET_Y: i32 = 24;
const OVERLAY_MARGIN: i32 = 16;
const MAX_MODEL_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

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
        | "frontend_hotkey_listener_registered"
        | "frontend_realtime_hotkey_listener_registered" => {
            trace_hotkey_event_with_fields(&event, None, fields.as_ref());
            Ok(())
        }
        "frontend_hotkey_handler_ready" => {
            trace_hotkey_event(&event, None);
            FRONTEND_HOTKEY_HANDLER_READY.store(true, Ordering::SeqCst);
            replay_pending_toggle(&app);
            replay_pending_realtime_toggle(&app);
            Ok(())
        }
        event if is_supported_dictation_trace_event(event) => {
            trace_hotkey_event_with_fields(event, None, fields.as_ref());
            Ok(())
        }
        "frontend_toggle_received"
        | "frontend_realtime_toggle_received"
        | "realtime_start_requested"
        | "realtime_stop_requested"
        | "realtime_toggle_event_buffered"
        | "pending_realtime_toggle_replayed"
        | "eval_realtime_toggle_debounced"
        | "realtime_client_secret_created"
        | "realtime_websocket_connecting"
        | "realtime_websocket_open"
        | "realtime_websocket_closed"
        | "realtime_websocket_error"
        | "realtime_get_user_media_started"
        | "realtime_get_user_media_done"
        | "realtime_microphone_track_started"
        | "realtime_microphone_track_settings"
        | "realtime_audio_graph_connected"
        | "realtime_session_created"
        | "realtime_session_updated"
        | "realtime_input_audio_chunk_sent"
        | "realtime_input_audio_level_detected"
        | "realtime_local_speech_started"
        | "realtime_local_speech_stopped"
        | "realtime_server_speech_started"
        | "realtime_server_speech_stopped"
        | "realtime_input_audio_commit_fallback_sent"
        | "realtime_server_input_committed"
        | "realtime_server_response_created"
        | "realtime_output_audio_delta"
        | "realtime_output_audio_delta_ignored_after_cancel"
        | "realtime_output_audio_level_detected"
        | "realtime_server_response_done"
        | "realtime_response_cancel_sent"
        | "realtime_response_cancel_ignored_error"
        | "realtime_local_speech_commit_skipped_during_output"
        | "realtime_microphone_muted"
        | "realtime_microphone_unmuted"
        | "realtime_response_create_fallback_sent"
        | "realtime_no_speech_timeout"
        | "realtime_no_response_timeout"
        | "realtime_server_error"
        | "realtime_start_failed" => {
            trace_hotkey_event_with_fields(&event, None, fields.as_ref());
            Ok(())
        }
        _ => Err(format!("Unsupported hotkey trace event: {event}")),
    }
}

fn is_supported_dictation_trace_event(event: &str) -> bool {
    matches!(
        event,
        "recording_state_requested"
            | "recording_get_user_media_started"
            | "recording_get_user_media_constraints_fallback"
            | "recording_get_user_media_default_fallback"
            | "recording_get_user_media_done"
            | "recording_audio_context_ready"
            | "recording_media_source_created"
            | "recording_worklet_connected"
            | "recording_script_processor_connected"
            | "recording_state_active"
            | "dictation_live_preview_completed"
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
    let realtime_shortcut = REALTIME_HOTKEY
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|error| format!("Invalid built-in realtime hotkey: {error}"))?;
    if shortcut == realtime_shortcut {
        return Err(format!(
            "{REALTIME_HOTKEY} is reserved for realtime conversation"
        ));
    }
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
    std::process::Command::new("xdg-open")
        .arg(&directory)
        .spawn()
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
            "Hotkey changed",
            &format!("VOCO will now respond to {}", snapshot.config.hotkey),
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
    if !bytes.len().is_multiple_of(4) {
        return Err("Audio data length is not a multiple of 4 bytes".to_string());
    }

    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

#[tauri::command(async)]
fn transcribe_audio(
    app: tauri::AppHandle,
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

    ensure_model_downloaded(&app)?;

    let model_path = transcribe::default_model_path()?;
    if !model_path.exists() {
        return Err("Model is not available after download attempt.".to_string());
    }

    let mut whisper = state
        .lock()
        .map_err(|_| "Transcription state is unavailable".to_string())?;

    whisper.load_model(&model_path)?;
    whisper.transcribe(&samples)
}

#[tauri::command(async)]
fn transcribe_canonical_chunk(
    app: tauri::AppHandle,
    audio_bytes: Vec<u8>,
    previous_canonical_text: String,
    state: tauri::State<'_, WhisperMutex>,
) -> Result<transcribe::CanonicalTranscription, String> {
    let samples = decode_audio_bytes(&audio_bytes)?;
    validate_canonical_sample_count(samples.len())?;

    ensure_model_downloaded(&app)?;

    let model_path = transcribe::default_model_path()?;
    if !model_path.exists() {
        return Err("Model is not available after download attempt.".to_string());
    }

    let mut whisper = state
        .lock()
        .map_err(|_| "Transcription state is unavailable".to_string())?;

    whisper.load_model(&model_path)?;
    whisper.transcribe_canonical_chunk(&samples, &previous_canonical_text)
}

fn validate_canonical_sample_count(sample_count: usize) -> Result<(), String> {
    if sample_count == 0 {
        return Err("No canonical chunk audio samples provided".to_string());
    }
    if sample_count > transcribe::CANONICAL_CHUNK_MAX_SAMPLES {
        return Err("Canonical chunk audio too long (max 30 seconds)".to_string());
    }
    Ok(())
}

#[tauri::command(async)]
fn preview_transcribe_audio(
    app: tauri::AppHandle,
    audio_bytes: Vec<u8>,
    state: tauri::State<'_, WhisperMutex>,
) -> Result<Option<transcribe::PreviewTranscription>, String> {
    let samples = decode_audio_bytes(&audio_bytes)?;

    if !validate_preview_sample_count(samples.len())? {
        return Ok(None);
    }

    ensure_model_downloaded(&app)?;

    let model_path = transcribe::default_model_path()?;
    if !model_path.exists() {
        return Err("Model is not available after download attempt.".to_string());
    }

    let Ok(mut whisper) = state.try_lock() else {
        return Ok(None);
    };

    whisper.load_model(&model_path)?;
    let preview = whisper.transcribe_preview(&samples)?;
    if preview.text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(preview))
    }
}

fn validate_preview_sample_count(sample_count: usize) -> Result<bool, String> {
    if sample_count < MIN_PREVIEW_SAMPLES {
        return Ok(false);
    }
    if sample_count > MAX_PREVIEW_SAMPLES {
        return Err("Preview audio too long (max 20 seconds)".to_string());
    }
    Ok(true)
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
    if !is_allowed_external_url(&url) {
        return Err("Only VOCO GitHub release URLs are supported".to_string());
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

#[tauri::command(async)]
fn insert_text(text: String, strategy: String) -> Result<insertion::InsertionResult, String> {
    if text.is_empty() {
        return Err("No text to insert".to_string());
    }
    if text.len() > 100_000 {
        return Err("Text too long for insertion (max 100KB)".to_string());
    }
    insertion::insert_text(&text, &strategy)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawAgentResult {
    agent: String,
    response: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawSpeechResult {
    audio_path: String,
    provider: Option<String>,
    output_format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeClientSecretResult {
    value: String,
    expires_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptEnhancementResult {
    text: String,
    used_enhancement: bool,
    warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLlmTestResult {
    ok: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLlmAgentResult {
    response: String,
}

fn build_openclaw_message(transcript: &str, prompt_prefix: &str) -> String {
    let transcript = transcript.trim();
    let prompt_prefix = prompt_prefix.trim();

    if prompt_prefix.is_empty() {
        transcript.to_string()
    } else {
        format!("{prompt_prefix}\n\nUser said:\n{transcript}")
    }
}

fn validate_openclaw_agent(agent: &str) -> Result<(), String> {
    if agent.trim().is_empty() {
        return Err("OpenClaw agent is required".to_string());
    }
    if agent.len() > 80 {
        return Err("OpenClaw agent is too long (max 80 characters)".to_string());
    }
    if !agent
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(
            "OpenClaw agent may only contain letters, numbers, dots, dashes, and underscores"
                .to_string(),
        );
    }

    Ok(())
}

fn clip_command_output(output: &str, max_chars: usize) -> String {
    let trimmed = output.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let mut clipped = trimmed.chars().take(max_chars).collect::<String>();
    clipped.push_str("...");
    clipped
}

fn wait_for_openclaw_agent(
    mut child: std::process::Child,
    timeout: std::time::Duration,
) -> Result<std::process::Output, String> {
    let start = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("Failed to read OpenClaw output: {error}"));
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "OpenClaw did not respond within {} seconds",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed while waiting for OpenClaw: {error}"));
            }
        }
    }
}

#[tauri::command(async)]
fn ask_openclaw_agent(
    transcript: String,
    agent: String,
    prompt_prefix: String,
) -> Result<OpenClawAgentResult, String> {
    let transcript = transcript.trim();
    let agent = agent.trim();

    if transcript.is_empty() {
        return Err("No transcript to send to OpenClaw".to_string());
    }
    if transcript.len() > 100_000 {
        return Err("Transcript too long for OpenClaw (max 100KB)".to_string());
    }
    if prompt_prefix.len() > 4_000 {
        return Err("OpenClaw prompt prefix is too long (max 4KB)".to_string());
    }
    validate_openclaw_agent(agent)?;

    let message = build_openclaw_message(transcript, &prompt_prefix);
    let child = std::process::Command::new("openclaw")
        .arg("agent")
        .arg("--agent")
        .arg(agent)
        .arg("--thinking")
        .arg("minimal")
        .arg("--message")
        .arg(&message)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "OpenClaw CLI was not found in PATH".to_string()
            } else {
                format!("Failed to start OpenClaw: {error}")
            }
        })?;

    let output = wait_for_openclaw_agent(child, std::time::Duration::from_secs(120))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let detail = if stderr.trim().is_empty() {
            clip_command_output(&stdout, 800)
        } else {
            clip_command_output(&stderr, 800)
        };
        return Err(format!(
            "OpenClaw exited with status {}: {detail}",
            output.status
        ));
    }

    let response = stdout.trim();
    if response.is_empty() {
        return Err("OpenClaw returned an empty response".to_string());
    }

    Ok(OpenClawAgentResult {
        agent: agent.to_string(),
        response: response.to_string(),
    })
}

fn parse_openclaw_tts_output(output: &str) -> Result<OpenClawSpeechResult, String> {
    let parsed: serde_json::Value = serde_json::from_str(output.trim())
        .map_err(|error| format!("Failed to parse OpenClaw TTS output: {error}"))?;
    let audio_path = parsed
        .get("audioPath")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "OpenClaw TTS did not return an audio path".to_string())?
        .to_string();
    let provider = parsed
        .get("provider")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let output_format = parsed
        .get("outputFormat")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    Ok(OpenClawSpeechResult {
        audio_path,
        provider,
        output_format,
    })
}

fn openclaw_tts_convert(text: &str) -> Result<OpenClawSpeechResult, String> {
    let params = serde_json::json!({ "text": text }).to_string();
    let child = std::process::Command::new("openclaw")
        .arg("gateway")
        .arg("call")
        .arg("tts.convert")
        .arg("--json")
        .arg("--timeout")
        .arg("30000")
        .arg("--params")
        .arg(params)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "OpenClaw CLI was not found in PATH".to_string()
            } else {
                format!("Failed to start OpenClaw TTS: {error}")
            }
        })?;

    let output = wait_for_openclaw_agent(child, std::time::Duration::from_secs(45))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let detail = if stderr.trim().is_empty() {
            clip_command_output(&stdout, 800)
        } else {
            clip_command_output(&stderr, 800)
        };
        return Err(format!(
            "OpenClaw TTS exited with status {}: {detail}",
            output.status
        ));
    }

    parse_openclaw_tts_output(&stdout)
}

fn play_audio_file(audio_path: &str) -> Result<(), String> {
    let child = std::process::Command::new("ffplay")
        .arg("-nodisp")
        .arg("-autoexit")
        .arg("-loglevel")
        .arg("error")
        .arg(audio_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "ffplay was not found in PATH; install ffmpeg to play OpenClaw speech".to_string()
            } else {
                format!("Failed to start audio playback: {error}")
            }
        })?;

    let output = wait_for_openclaw_agent(child, std::time::Duration::from_secs(120))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        clip_command_output(&stdout, 800)
    } else {
        clip_command_output(&stderr, 800)
    };
    Err(format!(
        "Audio playback exited with status {}: {detail}",
        output.status
    ))
}

#[tauri::command(async)]
fn speak_openclaw_response(text: String) -> Result<OpenClawSpeechResult, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("No OpenClaw response to speak".to_string());
    }
    if text.len() > 100_000 {
        return Err("OpenClaw response too long for speech (max 100KB)".to_string());
    }

    let result = openclaw_tts_convert(text)?;
    play_audio_file(&result.audio_path)?;
    Ok(result)
}

fn validate_local_llm_endpoint(raw: &str) -> Result<String, String> {
    let value = raw.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        return Err("Local model endpoint is required".to_string());
    }
    if value.len() > 2048
        || value
            .chars()
            .any(|ch| ch.is_control() || ch == '\\' || ch.is_whitespace())
    {
        return Err("Local model endpoint is invalid".to_string());
    }
    let parsed =
        reqwest::Url::parse(&value).map_err(|_| "Local model endpoint is invalid".to_string())?;
    if parsed.scheme() != "http" || !url_has_loopback_host(&parsed) || parsed.port().is_none() {
        return Err(
            "Local model endpoint must use http://localhost, http://127.0.0.1, or http://[::1]"
                .to_string(),
        );
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("Local model endpoint must not include credentials or fragments".to_string());
    }
    Ok(value)
}

fn url_has_loopback_host(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);

    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

fn build_loopback_http_client(
    timeout: std::time::Duration,
    connect_timeout: std::time::Duration,
) -> Result<reqwest::blocking::Client, reqwest::Error> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

fn normalize_local_llm_model(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 120
        || value
            .chars()
            .any(|ch| ch.is_control() || ch == '\r' || ch == '\n')
    {
        return Err("Local model name is invalid".to_string());
    }
    Ok(Some(value.to_string()))
}

fn conservative_transcript_prompt() -> &'static str {
    "You improve dictation transcripts for direct insertion. Return only the final text. Preserve the speaker's words, meaning, order, names, numbers, and technical terms. Add punctuation, casing, paragraph breaks, and simple list formatting when obvious. Do not answer questions, add facts, summarize, expand abbreviations, or rewrite for style. If uncertain, keep the original wording."
}

fn local_assistant_prompt() -> &'static str {
    "You are VOCO's concise local assistant. Answer the user's dictated request directly in plain text. Keep the answer useful and compact. Do not mention system prompts, models, or implementation details."
}

fn replace_case_insensitive_owned(input: String, needle: &str, replacement: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut remaining = input.as_str();
    let needle_lower = needle.to_ascii_lowercase();

    loop {
        let remaining_lower = remaining.to_ascii_lowercase();
        let Some(index) = remaining_lower.find(&needle_lower) else {
            output.push_str(remaining);
            break;
        };
        output.push_str(&remaining[..index]);
        output.push_str(replacement);
        remaining = &remaining[index + needle.len()..];
    }

    output
}

fn collapse_horizontal_whitespace(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut pending_space = false;
    let mut newline_run = 0usize;
    for ch in text.chars() {
        if ch == '\n' {
            pending_space = false;
            while output.ends_with(' ') {
                output.pop();
            }
            if newline_run < 2 {
                output.push('\n');
            }
            newline_run += 1;
        } else if ch.is_whitespace() {
            pending_space = true;
        } else {
            if pending_space && !output.is_empty() && !output.ends_with('\n') {
                output.push(' ');
            }
            pending_space = false;
            newline_run = 0;
            output.push(ch);
        }
    }
    output.trim().to_string()
}

fn apply_spoken_formatting_commands(transcript: &str) -> String {
    let mut text = transcript.trim().to_string();
    let text_lower = text.to_ascii_lowercase();
    if let Some(index) = text_lower.rfind("scratch that") {
        text = text[index + "scratch that".len()..].trim().to_string();
    }

    for (command, replacement) in [
        ("new paragraph", "\n\n"),
        ("new line", "\n"),
        ("bullet point", "\n- "),
        ("new bullet", "\n- "),
        ("end code block", "\n```\n"),
        ("code block", "\n```\n"),
    ] {
        text = replace_case_insensitive_owned(text, command, replacement);
    }

    collapse_horizontal_whitespace(&text)
}

fn build_local_llm_body(
    system_prompt: &str,
    user_message: &str,
    model: Option<&str>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_message
            }
        ],
        "temperature": 0,
        "max_tokens": 2048,
        "stream": false
    });

    if let Some(model) = model {
        body["model"] = serde_json::Value::String(model.to_string());
    }

    body
}

fn parse_local_llm_chat_response(body: &str) -> Result<String, String> {
    let parsed: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse local model response: {error}"))?;
    let content = parsed
        .pointer("/choices/0/message/content")
        .and_then(|content| content.as_str())
        .or_else(|| {
            parsed
                .pointer("/choices/0/text")
                .and_then(|text| text.as_str())
        })
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "Local model returned no text".to_string())?;

    Ok(content.to_string())
}

fn read_bounded_response_body(
    mut reader: impl Read,
    max_bytes: usize,
    context: &str,
) -> Result<String, String> {
    let mut body = Vec::with_capacity(max_bytes.min(64 * 1024));
    reader
        .by_ref()
        .take(max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut body)
        .map_err(|error| format!("Failed to read {context}: {error}"))?;
    if body.len() > max_bytes {
        return Err(format!("{context} exceeded the {max_bytes}-byte limit"));
    }
    String::from_utf8(body).map_err(|error| format!("{context} was not valid UTF-8: {error}"))
}

fn call_local_llm_chat(
    endpoint: &str,
    system_prompt: &str,
    user_message: &str,
    model: Option<&str>,
    timeout: std::time::Duration,
) -> Result<String, String> {
    let endpoint = validate_local_llm_endpoint(endpoint)?;
    let model = normalize_local_llm_model(model)?;
    let client = build_loopback_http_client(timeout, std::time::Duration::from_millis(900))
        .map_err(|error| format!("Failed to build local model client: {error}"))?;
    let response = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .body(build_local_llm_body(system_prompt, user_message, model.as_deref()).to_string())
        .send()
        .map_err(|error| format!("Local model request failed: {error}"))?;
    let status = response.status();
    let response_body =
        read_bounded_response_body(response, MAX_MODEL_RESPONSE_BYTES, "local model response")?;
    if !status.is_success() {
        return Err(format!(
            "Local model request failed ({status}): {}",
            clip_command_output(&response_body, 600)
        ));
    }

    parse_local_llm_chat_response(&response_body)
}

#[tauri::command(async)]
fn enhance_transcript(
    transcript: String,
    mode: TranscriptEnhancement,
    endpoint: String,
    model: Option<String>,
) -> TranscriptEnhancementResult {
    let transcript = transcript.trim();
    if transcript.is_empty() {
        return TranscriptEnhancementResult {
            text: String::new(),
            used_enhancement: false,
            warning: None,
        };
    }
    if transcript.len() > 100_000 {
        return TranscriptEnhancementResult {
            text: transcript.to_string(),
            used_enhancement: false,
            warning: Some("Transcript too long for local enhancement".to_string()),
        };
    }

    let formatted = apply_spoken_formatting_commands(transcript);
    match mode {
        TranscriptEnhancement::Off => TranscriptEnhancementResult {
            text: transcript.to_string(),
            used_enhancement: false,
            warning: None,
        },
        TranscriptEnhancement::CommandsOnly => TranscriptEnhancementResult {
            used_enhancement: formatted != transcript,
            text: formatted,
            warning: None,
        },
        TranscriptEnhancement::Conservative => match call_local_llm_chat(
            &endpoint,
            conservative_transcript_prompt(),
            &formatted,
            model.as_deref(),
            std::time::Duration::from_secs(12),
        ) {
            Ok(text) => TranscriptEnhancementResult {
                text,
                used_enhancement: true,
                warning: None,
            },
            Err(error) => TranscriptEnhancementResult {
                text: formatted,
                used_enhancement: false,
                warning: Some(error),
            },
        },
    }
}

#[tauri::command(async)]
fn test_local_llm(endpoint: String, model: Option<String>) -> LocalLlmTestResult {
    match call_local_llm_chat(
        &endpoint,
        conservative_transcript_prompt(),
        "test",
        model.as_deref(),
        std::time::Duration::from_secs(4),
    ) {
        Ok(_) => LocalLlmTestResult {
            ok: true,
            detail: "Local model endpoint responded.".to_string(),
        },
        Err(error) => LocalLlmTestResult {
            ok: false,
            detail: error,
        },
    }
}

#[tauri::command(async)]
fn ask_local_llm_agent(
    transcript: String,
    endpoint: String,
    model: Option<String>,
) -> Result<LocalLlmAgentResult, String> {
    let transcript = transcript.trim();
    if transcript.is_empty() {
        return Err("No transcript to send to local model".to_string());
    }
    if transcript.len() > 100_000 {
        return Err("Transcript too long for local model (max 100KB)".to_string());
    }

    let response = call_local_llm_chat(
        &endpoint,
        local_assistant_prompt(),
        transcript,
        model.as_deref(),
        std::time::Duration::from_secs(60),
    )?;
    Ok(LocalLlmAgentResult { response })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenClawBrowserActionInput {
    action: String,
    url: Option<String>,
}

fn normalize_public_browser_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Browser URL is required".to_string());
    }
    if trimmed.len() > 2048 || trimmed.chars().any(|ch| ch.is_control() || ch == '\\') {
        return Err("Browser URL is invalid".to_string());
    }

    let with_scheme = if has_explicit_url_scheme(trimmed) {
        trimmed.to_string()
    } else if trimmed.chars().any(char::is_whitespace) {
        format!(
            "https://www.google.com/search?q={}",
            url_query_escape(trimmed)
        )
    } else {
        format!("https://{trimmed}")
    };

    let mut parsed =
        reqwest::Url::parse(&with_scheme).map_err(|_| "Browser URL is invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only public http(s) browser URLs are supported".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Browser URLs must not include credentials".to_string());
    }

    let raw_host = parsed
        .host_str()
        .ok_or_else(|| "Browser URL must include a public host".to_string())?;
    let host = raw_host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(raw_host)
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return Err("Browser URL must include a public host".to_string());
    }

    if let Ok(address) = host.parse::<std::net::IpAddr>() {
        if let std::net::IpAddr::V4(address) = address {
            let input_host = raw_url_authority_host(&with_scheme)
                .ok_or_else(|| "Browser URL host is invalid".to_string())?;
            if input_host != address.to_string() {
                return Err("Browser URL must use canonical IPv4 notation".to_string());
            }
        }
        if !is_public_browser_ip(address) {
            return Err("Browser URL must not target a private or special-use address".to_string());
        }
    } else {
        validate_public_browser_hostname(&host)?;
    }

    // Drop a trailing DNS root dot so the validated host and serialized destination are identical.
    parsed
        .set_host(Some(&host))
        .map_err(|_| "Browser URL host is invalid".to_string())?;
    Ok(parsed.to_string())
}

fn raw_url_authority_host(value: &str) -> Option<&str> {
    let (_, remainder) = value.split_once("://")?;
    let authority = remainder.split(['/', '?', '#']).next()?;
    let host_and_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if let Some(bracketed) = host_and_port.strip_prefix('[') {
        return bracketed.split_once(']').map(|(host, _)| host);
    }
    if let Some((host, port)) = host_and_port.rsplit_once(':') {
        if !host.contains(':') && port.bytes().all(|byte| byte.is_ascii_digit()) {
            return Some(host);
        }
    }
    Some(host_and_port)
}

fn has_explicit_url_scheme(value: &str) -> bool {
    let Some((scheme, _)) = value.split_once("://") else {
        return false;
    };
    !scheme.is_empty()
        && scheme.chars().enumerate().all(|(index, ch)| {
            ch.is_ascii_alphabetic() || (index > 0 && matches!(ch, '0'..='9' | '+' | '-' | '.'))
        })
}

fn validate_public_browser_hostname(host: &str) -> Result<(), String> {
    if host.len() > 253 || !host.contains('.') {
        return Err("Browser URL must use a public DNS name".to_string());
    }

    for label in host.split('.') {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Browser URL host is invalid".to_string());
        }
    }

    const PRIVATE_OR_SPECIAL_SUFFIXES: &[&str] = &[
        "localhost",
        "local",
        "localdomain",
        "internal",
        "intranet",
        "lan",
        "home",
        "home.arpa",
        "corp",
        "private",
        "onion",
        "alt",
        "test",
        "invalid",
        "example",
    ];
    if PRIVATE_OR_SPECIAL_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        || host.ends_with(".arpa")
    {
        return Err("Browser URL must not use a private or special-use hostname".to_string());
    }

    Ok(())
}

fn is_public_browser_ip(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => is_public_browser_ipv4(address),
        std::net::IpAddr::V6(address) => {
            if address.to_ipv4().is_some() {
                return false;
            }

            let segments = address.segments();
            let is_global_unicast = segments[0] & 0xe000 == 0x2000;
            let is_ietf_special = segments[0] == 0x2001 && segments[1] <= 0x01ff;
            let is_documentation = (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0);
            let is_six_to_four = segments[0] == 0x2002;

            is_global_unicast && !is_ietf_special && !is_documentation && !is_six_to_four
        }
    }
}

fn is_public_browser_ipv4(address: std::net::Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    !(first == 0
        || first == 10
        || first == 127
        || first >= 224
        || (first == 100 && (64..=127).contains(&second))
        || (first == 169 && second == 254)
        || (first == 172 && (16..=31).contains(&second))
        || (first == 192 && second == 0 && third == 0)
        || (first == 192 && second == 0 && third == 2)
        || (first == 192 && second == 88 && third == 99)
        || (first == 192 && second == 168)
        || (first == 198 && matches!(second, 18 | 19))
        || (first == 198 && second == 51 && third == 100)
        || (first == 203 && second == 0 && third == 113))
}

fn url_query_escape(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['+'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

#[tauri::command(async)]
fn invoke_openclaw_browser_action(request: OpenClawBrowserActionInput) -> Result<(), String> {
    let action = request.action.as_str();
    match action {
        "open_url" | "navigate" => {
            normalize_public_browser_url(request.url.as_deref().unwrap_or(""))?;
        }
        _ => return Err(format!("Unsupported OpenClaw browser action: {action}")),
    }

    Err("Realtime browser control is disabled: VOCO cannot yet enforce public-only DNS resolution and redirects in OpenClaw"
        .to_string())
}

fn load_realtime_api_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("OPENAI_API_KEY") {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return Ok(value);
        }
    }

    let path = dirs::home_dir()
        .ok_or_else(|| "Cannot find home directory".to_string())?
        .join(".openclaw")
        .join("realtime.env");
    let contents = read_private_realtime_env_file(&path)?;

    if let Some(value) = parse_realtime_api_key_from_env_file(&contents) {
        return Ok(value);
    }

    Err(format!("OPENAI_API_KEY is missing from {}", path.display()))
}

fn read_private_realtime_env_file(path: &std::path::Path) -> Result<String, String> {
    const MAX_REALTIME_ENV_BYTES: u64 = 64 * 1024;

    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK | libc::O_NOCTTY);
    }
    let file = options.open(path).map_err(|error| {
        format!(
            "Failed to open private key file {}: {error}",
            path.display()
        )
    })?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect key file {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "Realtime key path {} must be a regular file",
            path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(format!(
                "Realtime key file {} is not owned by the current user",
                path.display()
            ));
        }
        if metadata.mode() & 0o077 != 0 {
            return Err(format!(
                "Realtime key file {} is accessible to other users; run chmod 600 on it",
                path.display()
            ));
        }
    }
    if metadata.len() > MAX_REALTIME_ENV_BYTES {
        return Err(format!("Realtime key file {} is too large", path.display()));
    }

    let mut contents = String::new();
    file.take(MAX_REALTIME_ENV_BYTES + 1)
        .read_to_string(&mut contents)
        .map_err(|error| format!("Failed to read key file {}: {error}", path.display()))?;
    if contents.len() as u64 > MAX_REALTIME_ENV_BYTES {
        return Err(format!("Realtime key file {} is too large", path.display()));
    }
    Ok(contents)
}

fn parse_realtime_api_key_from_env_file(contents: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim().trim_start_matches("export ").trim() == "OPENAI_API_KEY" {
            let value = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    None
}

fn realtime_session_config() -> serde_json::Value {
    serde_json::json!({
        "type": "realtime",
        "model": "gpt-realtime-2",
        "output_modalities": ["audio"],
        "instructions": "You are the user's concise realtime voice companion. Answer in 1-2 short sentences. No preamble, no markdown, no waffle. Browser access and browser control are unavailable in this release. If the user asks you to browse, say briefly that you cannot access web pages and continue without claiming you opened, inspected, or changed anything.",
        "reasoning": {
            "effort": "low"
        },
        "audio": {
            "input": {
                "format": {
                    "type": "audio/pcm",
                    "rate": 24000
                },
                "turn_detection": {
                    "type": "server_vad",
                    "create_response": true,
                    "interrupt_response": true
                }
            },
            "output": {
                "format": {
                    "type": "audio/pcm",
                    "rate": 24000
                },
                "voice": "marin"
            }
        }
    })
}

fn realtime_error_detail(response_body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(response_body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .map(|message| message.to_string())
        })
        .unwrap_or_else(|| clip_command_output(response_body, 800))
}

fn parse_realtime_client_secret_response(
    response_body: &str,
) -> Result<RealtimeClientSecretResult, String> {
    let parsed: serde_json::Value = serde_json::from_str(response_body)
        .map_err(|error| format!("Failed to parse Realtime session response: {error}"))?;
    let value = parsed
        .get("value")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Realtime session response did not include a client secret".to_string())?
        .to_string();
    let expires_at = parsed.get("expires_at").and_then(|value| value.as_i64());

    Ok(RealtimeClientSecretResult { value, expires_at })
}

#[tauri::command(async)]
fn create_realtime_client_secret() -> Result<RealtimeClientSecretResult, String> {
    let api_key = load_realtime_api_key()?;
    let body = serde_json::json!({
        "session": realtime_session_config()
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Failed to build Realtime session client: {error}"))?;
    let response = client
        .post("https://api.openai.com/v1/realtime/client_secrets")
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| format!("Failed to create Realtime session secret: {error}"))?;

    let status = response.status();
    let response_body = read_bounded_response_body(
        response,
        MAX_MODEL_RESPONSE_BYTES,
        "Realtime session response",
    )?;
    if !status.is_success() {
        let detail = realtime_error_detail(&response_body);
        return Err(format!(
            "OpenAI Realtime client secret request failed ({status}): {detail}"
        ));
    }

    parse_realtime_client_secret_response(&response_body)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDiagnostics {
    #[serde(flatten)]
    insertion: insertion::RuntimeDiagnostics,
    owned_preedit: owned_preedit::OwnedPreeditStatus,
}

#[tauri::command(async)]
fn get_runtime_diagnostics(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
) -> RuntimeDiagnostics {
    RuntimeDiagnostics {
        insertion: insertion::runtime_diagnostics(),
        owned_preedit: state.status(),
    }
}

#[tauri::command(async)]
fn get_owned_preedit_status(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
) -> owned_preedit::OwnedPreeditStatus {
    state.status()
}

#[tauri::command(async)]
fn start_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    session_id: u64,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    state.start(session_id)
}

#[tauri::command(async)]
fn update_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    session_id: u64,
    confirmed_text: String,
    preedit_text: String,
    provisional_text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    state.update(session_id, confirmed_text, preedit_text, provisional_text)
}

#[tauri::command(async)]
fn commit_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    session_id: u64,
    text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    state.commit(session_id, text)
}

#[tauri::command(async)]
fn checkpoint_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    session_id: u64,
    expected_committed_text: String,
    append_text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    state.checkpoint(session_id, expected_committed_text, append_text)
}

#[tauri::command(async)]
fn finish_canonical_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    session_id: u64,
    expected_committed_text: String,
    append_text: String,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    state.finish_canonical(session_id, expected_committed_text, append_text)
}

#[tauri::command(async)]
fn cancel_owned_preedit(
    state: tauri::State<'_, owned_preedit::OwnedPreeditService>,
    session_id: u64,
) -> Result<owned_preedit::OwnedPreeditStatus, String> {
    state.cancel(session_id)
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

// --- Auto-download model on first launch ---

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const MODEL_SHA256: &str = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
const MODEL_MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CachedModelIdentity {
    length: u64,
    #[cfg(target_os = "linux")]
    device: u64,
    #[cfg(target_os = "linux")]
    inode: u64,
    #[cfg(target_os = "linux")]
    owner: u32,
    #[cfg(target_os = "linux")]
    modified_seconds: i64,
    #[cfg(target_os = "linux")]
    modified_nanoseconds: i64,
    #[cfg(target_os = "linux")]
    status_changed_seconds: i64,
    #[cfg(target_os = "linux")]
    status_changed_nanoseconds: i64,
}

#[derive(Debug, PartialEq, Eq)]
enum CachedModelVerification {
    Missing,
    Ready {
        identity: CachedModelIdentity,
    },
    OwnedCorrupt {
        reason: String,
        identity: CachedModelIdentity,
    },
}

fn cached_model_identity(metadata: &std::fs::Metadata) -> CachedModelIdentity {
    #[cfg(target_os = "linux")]
    use std::os::unix::fs::MetadataExt;

    CachedModelIdentity {
        length: metadata.len(),
        #[cfg(target_os = "linux")]
        device: metadata.dev(),
        #[cfg(target_os = "linux")]
        inode: metadata.ino(),
        #[cfg(target_os = "linux")]
        owner: metadata.uid(),
        #[cfg(target_os = "linux")]
        modified_seconds: metadata.mtime(),
        #[cfg(target_os = "linux")]
        modified_nanoseconds: metadata.mtime_nsec(),
        #[cfg(target_os = "linux")]
        status_changed_seconds: metadata.ctime(),
        #[cfg(target_os = "linux")]
        status_changed_nanoseconds: metadata.ctime_nsec(),
    }
}

fn cached_model_path_matches_identity(
    path: &std::path::Path,
    expected_identity: CachedModelIdentity,
) -> Result<bool, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Failed to re-inspect verified cached model {}: {error}",
                path.display()
            ));
        }
    };
    Ok(!metadata.file_type().is_symlink()
        && metadata.is_file()
        && cached_model_is_owned_by_current_user(&metadata)
        && cached_model_identity(&metadata) == expected_identity)
}

fn replace_verified_model_identity(identity: Option<CachedModelIdentity>) -> Result<(), String> {
    *MODEL_VERIFIED_IDENTITY
        .lock()
        .map_err(|_| "Verified model identity lock is poisoned".to_string())? = identity;
    Ok(())
}

fn cached_model_is_owned_by_current_user(metadata: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.uid() == current_effective_uid()
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = metadata;
        true
    }
}

fn owned_corrupt_cached_model(
    path: &std::path::Path,
    metadata: &std::fs::Metadata,
    reason: String,
) -> Result<CachedModelVerification, String> {
    if !cached_model_is_owned_by_current_user(metadata) {
        return Err(format!(
            "Cached model {} is corrupt but is not owned by the current user; it was preserved. Remove or replace it manually.",
            path.display()
        ));
    }

    Ok(CachedModelVerification::OwnedCorrupt {
        reason,
        identity: cached_model_identity(metadata),
    })
}

fn validate_model_cache_directory(model_path: &std::path::Path) -> Result<(), String> {
    let directory = model_path.parent().ok_or_else(|| {
        format!(
            "Model path {} has no parent directory",
            model_path.display()
        )
    })?;
    let metadata = std::fs::symlink_metadata(directory).map_err(|error| {
        format!(
            "Failed to inspect model directory {}: {error}",
            directory.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Model directory {} must be a real directory; refusing to follow or replace it",
            directory.display()
        ));
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;

        if metadata.uid() != current_effective_uid() {
            return Err(format!(
                "Model directory {} is not owned by the current user",
                directory.display()
            ));
        }
        if metadata.mode() & 0o022 != 0 {
            return Err(format!(
                "Model directory {} is writable by another user; secure it before VOCO uses cached models",
                directory.display()
            ));
        }
    }

    Ok(())
}

fn verify_existing_model_file(
    path: &std::path::Path,
    expected_sha256: &str,
    max_bytes: u64,
) -> Result<CachedModelVerification, String> {
    if expected_sha256.len() != 64 || !expected_sha256.as_bytes().iter().all(u8::is_ascii_hexdigit)
    {
        return Err("Pinned model SHA-256 is invalid".to_string());
    }

    let initial_metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CachedModelVerification::Missing);
        }
        Err(error) => {
            return Err(format!(
                "Failed to inspect cached model {}: {error}",
                path.display()
            ));
        }
    };

    if initial_metadata.file_type().is_symlink() || !initial_metadata.is_file() {
        return Err(format!(
            "Cached model {} must be a regular file; refusing to follow or replace it",
            path.display()
        ));
    }

    if initial_metadata.len() > max_bytes {
        return owned_corrupt_cached_model(
            path,
            &initial_metadata,
            format!(
                "cached model is too large ({} bytes, max {} bytes)",
                initial_metadata.len(),
                max_bytes
            ),
        );
    }

    let initial_identity = cached_model_identity(&initial_metadata);
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_NOCTTY);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Failed to open cached model {}: {error}", path.display()))?;
    let opened_metadata = file.metadata().map_err(|error| {
        format!(
            "Failed to inspect opened cached model {}: {error}",
            path.display()
        )
    })?;
    if !opened_metadata.is_file() || cached_model_identity(&opened_metadata) != initial_identity {
        return Err(format!(
            "Cached model {} changed while it was being opened; it was preserved",
            path.display()
        ));
    }

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut read_bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read cached model {}: {error}", path.display()))?;
        if count == 0 {
            break;
        }
        read_bytes = read_bytes.saturating_add(count as u64);
        if read_bytes > max_bytes {
            return owned_corrupt_cached_model(
                path,
                &opened_metadata,
                format!("cached model grew beyond the {max_bytes}-byte size limit"),
            );
        }
        hasher.update(&buffer[..count]);
    }

    let final_metadata = file.metadata().map_err(|error| {
        format!(
            "Failed to re-inspect cached model {}: {error}",
            path.display()
        )
    })?;
    if cached_model_identity(&final_metadata) != initial_identity
        || read_bytes != initial_metadata.len()
    {
        return Err(format!(
            "Cached model {} changed while its integrity was being verified; it was preserved",
            path.display()
        ));
    }

    let actual_sha256 = format!("{:x}", hasher.finalize());
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        return owned_corrupt_cached_model(
            path,
            &opened_metadata,
            format!(
                "SHA-256 mismatch (expected {}, got {})",
                &expected_sha256[..16],
                &actual_sha256[..16]
            ),
        );
    }

    Ok(CachedModelVerification::Ready {
        identity: initial_identity,
    })
}

fn remove_owned_corrupt_cached_model(
    path: &std::path::Path,
    expected_identity: CachedModelIdentity,
) -> Result<(), String> {
    validate_model_cache_directory(path)?;
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        format!(
            "Failed to re-inspect corrupt cached model {}: {error}",
            path.display()
        )
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || !cached_model_is_owned_by_current_user(&metadata)
        || cached_model_identity(&metadata) != expected_identity
    {
        return Err(format!(
            "Cached model {} changed after verification; it was preserved",
            path.display()
        ));
    }

    std::fs::remove_file(path).map_err(|error| {
        format!(
            "Failed to remove corrupt cached model {}: {error}",
            path.display()
        )
    })
}

fn remove_stale_model_temp_file(path: &std::path::Path) -> Result<(), String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect temporary model {}: {error}",
                path.display()
            ));
        }
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || !cached_model_is_owned_by_current_user(&metadata)
    {
        return Err(format!(
            "Temporary model path {} is not a user-owned regular file; refusing to replace it",
            path.display()
        ));
    }
    std::fs::remove_file(path)
        .map_err(|error| format!("Failed to remove stale temporary model: {error}"))
}

fn is_allowed_external_url(url: &str) -> bool {
    url.strip_prefix("https://github.com/sergiopesch/voco/releases/tag/")
        .is_some_and(|tag| !tag.is_empty() && !tag.contains(['\r', '\n', '\\']))
}

fn validate_model_content_length(content_length: Option<u64>) -> Result<(), String> {
    if let Some(size) = content_length {
        if size > MODEL_MAX_BYTES {
            return Err(format!(
                "Model download is too large ({} bytes, max {} bytes)",
                size, MODEL_MAX_BYTES
            ));
        }
    }

    Ok(())
}

fn ensure_model_downloaded(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let result = ensure_model_downloaded_inner(app_handle);
    if result.is_err() {
        if let Ok(mut identity) = MODEL_VERIFIED_IDENTITY.lock() {
            *identity = None;
        }
        tray::update_model_download_status(app_handle, tray::ModelDownloadStatus::Failed);
    }
    result
}

fn ensure_model_downloaded_inner(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let _download_guard = MODEL_DOWNLOAD_LOCK
        .lock()
        .map_err(|_| "Model download state lock is poisoned".to_string())?;

    let path = transcribe::default_model_path()?;
    validate_model_cache_directory(&path)?;
    let verified_identity = *MODEL_VERIFIED_IDENTITY
        .lock()
        .map_err(|_| "Verified model identity lock is poisoned".to_string())?;
    if let Some(identity) = verified_identity {
        if cached_model_path_matches_identity(&path, identity)? {
            return Ok(());
        }
        replace_verified_model_identity(None)?;
        info!("Previously verified speech model changed or was removed; checking the cache again");
    }

    match verify_existing_model_file(&path, MODEL_SHA256, MODEL_MAX_BYTES)? {
        CachedModelVerification::Ready { identity } => {
            replace_verified_model_identity(Some(identity))?;
            tray::update_model_download_status(app_handle, tray::ModelDownloadStatus::Ready);
            info!("Cached speech model verified: {}", path.display());
            return Ok(());
        }
        CachedModelVerification::OwnedCorrupt { reason, identity } => {
            warn!(
                "Cached speech model failed integrity verification ({reason}); removing the user-owned cache entry and downloading a verified copy"
            );
            remove_owned_corrupt_cached_model(&path, identity)?;
        }
        CachedModelVerification::Missing => {}
    }

    let tmp_path = path.with_extension("bin.tmp");
    remove_stale_model_temp_file(&tmp_path)?;

    tray::update_model_download_status(app_handle, tray::ModelDownloadStatus::Downloading(None));
    info!("Downloading speech model (one-time, ~142 MB)...");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(MODEL_URL)
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_size = response.content_length();
    validate_model_content_length(total_size)?;

    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let mut reader = response;
    let mut temp_options = std::fs::OpenOptions::new();
    temp_options.write(true).create_new(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        temp_options.mode(0o600).custom_flags(libc::O_CLOEXEC);
    }
    let mut file = temp_options
        .open(&tmp_path)
        .map_err(|e| format!("Failed to save model (tmp): {e}"))?;
    let mut hasher = Sha256::new();
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
        downloaded += n as u64;
        if downloaded > MODEL_MAX_BYTES {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!(
                "Model download exceeded max size of {} bytes",
                MODEL_MAX_BYTES
            ));
        }

        hasher.update(&buf[..n]);
        file.write_all(&buf[..n])
            .map_err(|e| format!("Failed to save model (tmp): {e}"))?;

        if let Some(pct) =
            total_size.and_then(|size| downloaded.saturating_mul(100).checked_div(size))
        {
            if pct != last_pct {
                last_pct = pct;
                tray::update_model_download_status(
                    app_handle,
                    tray::ModelDownloadStatus::Downloading(Some(pct.min(100) as u8)),
                );
            }
        }
    }

    file.sync_all()
        .map_err(|e| format!("Failed to flush model file (tmp): {e}"))?;
    drop(file);

    let hash = format!("{:x}", hasher.finalize());
    if hash != MODEL_SHA256 {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!(
            "Model integrity check failed (expected {}, got {}). Download may be corrupt.",
            &MODEL_SHA256[..16],
            &hash[..16]
        ));
    }

    std::fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to finalize model file: {e}"))?;

    let downloaded_metadata = std::fs::symlink_metadata(&path)
        .map_err(|e| format!("Failed to inspect finalized model file: {e}"))?;
    if downloaded_metadata.file_type().is_symlink()
        || !downloaded_metadata.is_file()
        || !cached_model_is_owned_by_current_user(&downloaded_metadata)
    {
        return Err("Finalized model path is not a user-owned regular file".to_string());
    }
    replace_verified_model_identity(Some(cached_model_identity(&downloaded_metadata)))?;
    tray::update_model_download_status(app_handle, tray::ModelDownloadStatus::Ready);
    info!("Model downloaded and verified: {}", path.display());
    Ok(())
}

// --- Toggle dictation via window event ---

pub fn eval_toggle(app_handle: &tauri::AppHandle) {
    eval_toggle_with_backend(app_handle, "internal");
}

pub fn eval_realtime_toggle(app_handle: &tauri::AppHandle) {
    eval_realtime_toggle_with_backend(app_handle, "internal");
}

fn eval_realtime_toggle_with_backend(app_handle: &tauri::AppHandle, backend_used: &str) {
    trace_hotkey_event("eval_realtime_toggle_entered", Some(backend_used));

    let now = now_ms();
    let last = LAST_REALTIME_TOGGLE_MS.swap(now, Ordering::SeqCst);
    if (now - last).abs() < TOGGLE_DEBOUNCE_MS {
        debug!(
            "eval_realtime_toggle debounced ({}ms since last)",
            now - last
        );
        trace_hotkey_event("eval_realtime_toggle_debounced", Some(backend_used));
        return;
    }

    if !FRONTEND_HOTKEY_HANDLER_READY.load(Ordering::SeqCst) {
        buffer_realtime_toggle_until_frontend_ready(backend_used);
        return;
    }

    emit_realtime_toggle_event(app_handle, backend_used);
}

fn emit_realtime_toggle_event(app_handle: &tauri::AppHandle, backend_used: &str) {
    if let Err(e) = app_handle.emit_to("main", TOGGLE_REALTIME_EVENT, ()) {
        error!("Failed to emit realtime toggle event: {e}");
    } else {
        trace_hotkey_event("realtime_toggle_event_emitted", Some(backend_used));
    }
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

fn buffer_realtime_toggle_until_frontend_ready(backend_used: &str) {
    let Ok(mut pending_backend) = PENDING_REALTIME_TOGGLE_BACKEND.lock() else {
        error!("Failed to lock pending realtime toggle state");
        return;
    };

    if pending_backend.is_none() {
        *pending_backend = Some(backend_used.to_string());
    }
    trace_hotkey_event("realtime_toggle_event_buffered", Some(backend_used));
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

fn replay_pending_realtime_toggle(app_handle: &tauri::AppHandle) {
    let pending_backend = match PENDING_REALTIME_TOGGLE_BACKEND.lock() {
        Ok(mut pending_backend) => pending_backend.take(),
        Err(error) => {
            error!("Failed to lock pending realtime toggle state: {error}");
            None
        }
    };

    if let Some(backend_used) = pending_backend {
        trace_hotkey_event("pending_realtime_toggle_replayed", Some(&backend_used));
        emit_realtime_toggle_event(app_handle, &backend_used);
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

fn register_realtime_global_shortcut_listener(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut = REALTIME_HOTKEY
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid realtime hotkey '{REALTIME_HOTKEY}': {e}"))?;
    let handle = app.clone();
    let binding_version = REALTIME_HOTKEY_BINDING_VERSION.fetch_add(1, Ordering::SeqCst) + 1;

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }

            let current_version = REALTIME_HOTKEY_BINDING_VERSION.load(Ordering::SeqCst);
            if current_version != binding_version {
                debug!(
                    "Ignoring stale realtime global shortcut callback (binding version {}, latest {})",
                    binding_version, current_version
                );
                return;
            }

            if USE_EVDEV_HOTKEY.load(Ordering::SeqCst) {
                debug!("{REALTIME_HOTKEY} detected via global shortcut plugin but evdev is preferred");
                return;
            }

            debug!("{REALTIME_HOTKEY} detected via global shortcut plugin");
            trace_hotkey_event(
                "realtime_hotkey_event_received_global_shortcut",
                Some("global_shortcut"),
            );
            eval_realtime_toggle_with_backend(&handle, "global_shortcut");
        })
        .map_err(|e| format!("Failed to register realtime global shortcut {REALTIME_HOTKEY}: {e}"))
}

fn sync_realtime_global_shortcut_binding(
    app: &tauri::AppHandle,
    enable_plugin_shortcut: bool,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let mut current = REGISTERED_REALTIME_PLUGIN_SHORTCUT
        .lock()
        .map_err(|_| "Failed to lock realtime shortcut binding state".to_string())?;

    if let Some(existing) = current.clone() {
        if !enable_plugin_shortcut {
            if app.global_shortcut().is_registered(existing.as_str()) {
                app.global_shortcut()
                    .unregister(existing.as_str())
                    .map_err(|e| {
                        format!("Failed to unregister realtime global shortcut {existing}: {e}")
                    })?;
            }
            *current = None;
            REALTIME_HOTKEY_BINDING_VERSION.fetch_add(1, Ordering::SeqCst);
            info!("Unregistered realtime global shortcut {existing}");
        }
    }

    if !enable_plugin_shortcut {
        return Ok(());
    }

    if current.as_deref() == Some(REALTIME_HOTKEY) {
        return Ok(());
    }

    register_realtime_global_shortcut_listener(app)?;
    *current = Some(REALTIME_HOTKEY.to_string());
    info!("Registered realtime global shortcut {REALTIME_HOTKEY}");
    trace_hotkey_event(
        "realtime_global_shortcut_registered",
        Some("global_shortcut"),
    );
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
    sync_realtime_global_shortcut_binding(app, should_register_global_shortcut(use_evdev_hotkey))?;

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
    persist_config_patch(
        app,
        AppConfigPatch::with_hotkey(new_hotkey.to_string()),
        true,
    )?;
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
fn is_ignored_evdev_device_name(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("ydotoold virtual device")
}

#[cfg(target_os = "linux")]
fn supports_evdev_hotkey(device: &evdev::Device) -> bool {
    if device
        .name()
        .map(is_ignored_evdev_device_name)
        .unwrap_or(false)
    {
        return false;
    }

    let Some(keys) = device.supported_keys() else {
        return false;
    };

    let has_alt = keys.contains(evdev::Key::KEY_LEFTALT) || keys.contains(evdev::Key::KEY_RIGHTALT);
    let has_d = keys.contains(evdev::Key::KEY_D);
    let has_r = keys.contains(evdev::Key::KEY_R);
    has_alt && (has_d || has_r)
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
                                    Key::KEY_R if pressed && !repeat => {
                                        let alt_down = alt_held.load(Ordering::SeqCst);
                                        let shift_down = shift_held.load(Ordering::SeqCst);

                                        if alt_down && shift_down {
                                            debug!("Realtime hotkey detected via evdev");
                                            trace_hotkey_event(
                                                "realtime_hotkey_event_received_evdev",
                                                Some("evdev"),
                                            );
                                            eval_realtime_toggle_with_backend(&app_handle, "evdev");
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

pub fn run() -> Result<(), String> {
    let single_instance_guard = single_instance::acquire().map_err(|error| error.to_string())?;

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    #[cfg(target_os = "linux")]
    install_socket_cleanup_signal_handler();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(single_instance_guard)
        .manage(Mutex::new(WhisperState::new()) as WhisperMutex)
        .manage(owned_preedit::OwnedPreeditService::default())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                // A renderer reload discards its session ids. Close the
                // private channel first so the engine clears only its owned
                // preedit before the replacement renderer can start.
                webview
                    .state::<owned_preedit::OwnedPreeditService>()
                    .shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            reload_config_from_disk,
            reset_config_to_defaults,
            save_config_patch,
            load_cached_update_state,
            save_cached_update_state,
            transcribe_audio,
            transcribe_canonical_chunk,
            preview_transcribe_audio,
            debug_dictation_capture_enabled,
            save_debug_dictation_capture,
            insert_text,
            ask_openclaw_agent,
            speak_openclaw_response,
            enhance_transcript,
            test_local_llm,
            ask_local_llm_agent,
            invoke_openclaw_browser_action,
            create_realtime_client_secret,
            get_runtime_diagnostics,
            get_owned_preedit_status,
            start_owned_preedit,
            update_owned_preedit,
            commit_owned_preedit,
            checkpoint_owned_preedit,
            finish_canonical_owned_preedit,
            cancel_owned_preedit,
            begin_runtime_status_session,
            sync_runtime_status,
            trace_frontend_hotkey_event,
            has_pending_hotkey_toggle,
            show_status_overlay,
            hide_status_overlay,
            show_notification,
            open_external_url,
            open_config_directory,
        ])
        .setup(|app| {
            let startup_ms = now_ms();
            FRONTEND_HOTKEY_HANDLER_READY.store(false, Ordering::SeqCst);
            if let Ok(mut pending_backend) = PENDING_TOGGLE_BACKEND.lock() {
                *pending_backend = None;
            }
            if let Ok(mut pending_backend) = PENDING_REALTIME_TOGGLE_BACKEND.lock() {
                *pending_backend = None;
            }
            trace_hotkey_event("app_start", Some("internal"));
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
            if let Err(e) = sync_realtime_global_shortcut_binding(
                &app_handle,
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
            if let Some(notice) = configured_hotkey.repair_notice {
                warn!("{notice}");
                send_notification("Hotkey repaired", &notice);
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
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<owned_preedit::OwnedPreeditService>().shutdown();
                cleanup_socket_files();
            }
        });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_test_directory(label: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "voco-model-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        directory
    }

    #[test]
    fn bounded_response_reader_accepts_body_at_limit() {
        let body = b"12345678";
        assert_eq!(
            read_bounded_response_body(body.as_slice(), body.len(), "test response").unwrap(),
            "12345678"
        );
    }

    #[test]
    fn bounded_response_reader_rejects_oversized_body() {
        let error =
            read_bounded_response_body(b"123456789".as_slice(), 8, "test response").unwrap_err();
        assert!(error.contains("exceeded the 8-byte limit"));
    }

    #[test]
    fn bounded_response_reader_rejects_invalid_utf8() {
        let error = read_bounded_response_body([0xff].as_slice(), 8, "test response").unwrap_err();
        assert!(error.contains("was not valid UTF-8"));
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
    fn preview_audio_accepts_the_frontend_point_seven_second_boundary() {
        assert!(!validate_preview_sample_count(MIN_PREVIEW_SAMPLES - 1).unwrap());
        assert!(validate_preview_sample_count(MIN_PREVIEW_SAMPLES).unwrap());
        assert!(validate_preview_sample_count(MAX_PREVIEW_SAMPLES).unwrap());
        assert!(validate_preview_sample_count(MAX_PREVIEW_SAMPLES + 1).is_err());
    }

    #[test]
    fn canonical_audio_accepts_only_nonempty_thirty_second_chunks() {
        assert!(validate_canonical_sample_count(0).is_err());
        assert!(validate_canonical_sample_count(1).is_ok());
        assert!(validate_canonical_sample_count(transcribe::CANONICAL_CHUNK_MAX_SAMPLES).is_ok());
        assert!(
            validate_canonical_sample_count(transcribe::CANONICAL_CHUNK_MAX_SAMPLES + 1).is_err()
        );
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
    fn external_url_allowlist_only_accepts_voco_release_tags() {
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
    fn model_content_length_rejects_oversized_downloads() {
        assert!(validate_model_content_length(Some(MODEL_MAX_BYTES)).is_ok());
        assert!(validate_model_content_length(None).is_ok());
        assert!(validate_model_content_length(Some(MODEL_MAX_BYTES + 1)).is_err());
    }

    #[test]
    fn existing_model_requires_the_pinned_sha256() {
        const FIXTURE_SHA256: &str =
            "f707aa7408e39f75df32062808b06429989342eed28fb3c33d3142dbc505fd83";
        let directory = model_test_directory("digest");
        let path = directory.join("model.bin");
        std::fs::write(&path, b"voco-model-fixture").unwrap();

        assert!(matches!(
            verify_existing_model_file(&path, FIXTURE_SHA256, 1024).unwrap(),
            CachedModelVerification::Ready { .. }
        ));
        let mismatch = verify_existing_model_file(&path, MODEL_SHA256, 1024).unwrap();
        assert!(matches!(
            mismatch,
            CachedModelVerification::OwnedCorrupt { ref reason, .. }
                if reason.contains("SHA-256 mismatch")
        ));

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn verified_model_identity_fast_path_detects_removal_and_replacement() {
        let directory = model_test_directory("verified-identity");
        let path = directory.join("model.bin");
        let original = directory.join("original.bin");
        std::fs::write(&path, b"voco-model-fixture").unwrap();
        let identity = cached_model_identity(&std::fs::symlink_metadata(&path).unwrap());

        assert!(cached_model_path_matches_identity(&path, identity).unwrap());
        std::fs::rename(&path, &original).unwrap();
        assert!(!cached_model_path_matches_identity(&path, identity).unwrap());

        std::fs::write(&path, b"voco-model-fixture").unwrap();
        assert!(!cached_model_path_matches_identity(&path, identity).unwrap());

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn oversized_owned_model_is_removed_only_if_its_identity_is_unchanged() {
        let directory = model_test_directory("oversized");
        let path = directory.join("model.bin");
        std::fs::write(&path, [0u8; 17]).unwrap();

        let verification = verify_existing_model_file(&path, MODEL_SHA256, 16).unwrap();
        let CachedModelVerification::OwnedCorrupt { reason, identity } = verification else {
            panic!("oversized model should be replaceable corruption");
        };
        assert!(reason.contains("too large"));
        remove_owned_corrupt_cached_model(&path, identity).unwrap();
        assert!(!path.exists());

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn changed_corrupt_model_is_preserved_instead_of_unlinked() {
        let directory = model_test_directory("changed");
        let path = directory.join("model.bin");
        let original = directory.join("original.bin");
        std::fs::write(&path, b"corrupt-one").unwrap();
        let verification = verify_existing_model_file(&path, MODEL_SHA256, 1024).unwrap();
        let CachedModelVerification::OwnedCorrupt { identity, .. } = verification else {
            panic!("wrong digest should be replaceable corruption");
        };

        std::fs::rename(&path, &original).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        let error = remove_owned_corrupt_cached_model(&path, identity).unwrap_err();
        assert!(error.contains("changed after verification"));
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn model_verification_rejects_symlinks_and_fifos_without_reading_them() {
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::symlink;

        let directory = model_test_directory("special-files");
        let target = directory.join("target.bin");
        let linked = directory.join("linked.bin");
        std::fs::write(&target, b"voco-model-fixture").unwrap();
        symlink(&target, &linked).unwrap();
        assert!(verify_existing_model_file(&linked, MODEL_SHA256, 1024)
            .unwrap_err()
            .contains("regular file"));

        let fifo = directory.join("model.fifo");
        let fifo_bytes = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_bytes.as_ptr(), 0o600) }, 0);
        let started = std::time::Instant::now();
        assert!(verify_existing_model_file(&fifo, MODEL_SHA256, 1024)
            .unwrap_err()
            .contains("regular file"));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));

        let started = std::time::Instant::now();
        assert!(
            verify_existing_model_file(std::path::Path::new("/dev/null"), MODEL_SHA256, 1024)
                .unwrap_err()
                .contains("regular file")
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(1));

        let storage = directory.join("storage");
        let linked_directory = directory.join("models");
        std::fs::create_dir(&storage).unwrap();
        symlink(&storage, &linked_directory).unwrap();
        assert!(
            validate_model_cache_directory(&linked_directory.join("model.bin"))
                .unwrap_err()
                .contains("real directory")
        );

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn openclaw_message_uses_prompt_prefix_when_present() {
        assert_eq!(
            build_openclaw_message("check gpio 17", "Teach safely."),
            "Teach safely.\n\nUser said:\ncheck gpio 17"
        );
    }

    #[test]
    fn openclaw_message_allows_empty_prompt_prefix() {
        assert_eq!(
            build_openclaw_message("  check gpio 17  ", "  "),
            "check gpio 17"
        );
    }

    #[test]
    fn openclaw_agent_validation_rejects_shell_metacharacters() {
        assert!(validate_openclaw_agent("main").is_ok());
        assert!(validate_openclaw_agent("robotics.professor-1").is_ok());
        assert!(validate_openclaw_agent("main; rm -rf /").is_err());
    }

    #[test]
    fn openclaw_tts_output_parses_audio_path() {
        let parsed = parse_openclaw_tts_output(
            r#"{"audioPath":"/tmp/openclaw/voice.mp3","provider":"microsoft","outputFormat":"audio-24khz-48kbitrate-mono-mp3"}"#,
        )
        .unwrap();
        assert_eq!(parsed.audio_path, "/tmp/openclaw/voice.mp3");
        assert_eq!(parsed.provider.as_deref(), Some("microsoft"));
        assert_eq!(
            parsed.output_format.as_deref(),
            Some("audio-24khz-48kbitrate-mono-mp3")
        );
    }

    #[test]
    fn openclaw_tts_output_requires_audio_path() {
        assert!(parse_openclaw_tts_output(r#"{"provider":"microsoft"}"#)
            .unwrap_err()
            .contains("audio path"));
    }

    #[test]
    fn local_llm_endpoint_validation_allows_only_loopback_http() {
        assert!(validate_local_llm_endpoint("http://127.0.0.1:8080/v1/chat/completions").is_ok());
        assert!(validate_local_llm_endpoint("http://localhost:8080/v1/chat/completions").is_ok());
        assert!(validate_local_llm_endpoint("http://[::1]:8080/v1/chat/completions").is_ok());
        assert!(validate_local_llm_endpoint("https://example.com/v1/chat/completions").is_err());
        assert!(
            validate_local_llm_endpoint("http://192.168.1.10:8080/v1/chat/completions").is_err()
        );
        assert!(
            validate_local_llm_endpoint("http://user@localhost:8080/v1/chat/completions").is_err()
        );
    }

    #[test]
    fn loopback_http_client_does_not_follow_redirects() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let redirect_target = TcpListener::bind("127.0.0.1:0").unwrap();
        redirect_target.set_nonblocking(true).unwrap();
        let redirect_target_url = format!(
            "http://127.0.0.1:{}",
            redirect_target.local_addr().unwrap().port()
        );

        let redirect_source = TcpListener::bind("127.0.0.1:0").unwrap();
        let redirect_source_url = format!(
            "http://127.0.0.1:{}",
            redirect_source.local_addr().unwrap().port()
        );
        let server = std::thread::spawn(move || {
            let (mut stream, _) = redirect_source.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).unwrap();
            let response = format!(
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: {redirect_target_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let client = build_loopback_http_client(
            std::time::Duration::from_secs(2),
            std::time::Duration::from_secs(1),
        )
        .unwrap();
        let response = client
            .post(redirect_source_url)
            .body("private transcript")
            .send()
            .unwrap();
        server.join().unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            redirect_target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn spoken_formatting_commands_are_deterministic() {
        assert_eq!(
            apply_spoken_formatting_commands(
                "first line new paragraph bullet point check gpio seventeen new bullet stop"
            ),
            "first line\n\n- check gpio seventeen\n- stop"
        );
        assert_eq!(
            apply_spoken_formatting_commands(
                "write the old sentence scratch that write the new one"
            ),
            "write the new one"
        );
        assert_eq!(
            apply_spoken_formatting_commands("code block let x equals one end code block"),
            "```\nlet x equals one\n```"
        );
    }

    #[test]
    fn local_llm_body_uses_conservative_prompt_and_optional_model() {
        let body = build_local_llm_body(
            conservative_transcript_prompt(),
            "hello world",
            Some("gemma-local"),
        );
        assert_eq!(body["model"], "gemma-local");
        assert_eq!(body["temperature"], 0);
        assert_eq!(body["messages"][1]["content"], "hello world");
        assert!(body["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("Preserve the speaker's words"));

        let body = build_local_llm_body(local_assistant_prompt(), "hello world", None);
        assert!(body.get("model").is_none());
        assert!(body["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("concise local assistant"));
    }

    #[test]
    fn local_llm_response_parser_reads_chat_completion_content() {
        let parsed = parse_local_llm_chat_response(
            r#"{"choices":[{"message":{"content":"Hello, world."}}]}"#,
        )
        .unwrap();
        assert_eq!(parsed, "Hello, world.");

        assert!(
            parse_local_llm_chat_response(r#"{"choices":[{"message":{"content":""}}]}"#)
                .unwrap_err()
                .contains("no text")
        );
    }

    #[test]
    fn local_llm_chat_posts_to_loopback_without_auth_header() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::mpsc;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!(
            "http://127.0.0.1:{}/v1/chat/completions",
            listener.local_addr().unwrap().port()
        );
        let (sender, receiver) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 1024];
            loop {
                let read = stream.read(&mut buffer).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n")
                    && String::from_utf8_lossy(&request).contains("hello local")
                {
                    break;
                }
            }
            let request_text = String::from_utf8_lossy(&request).to_string();
            sender.send(request_text).unwrap();

            let body = r#"{"choices":[{"message":{"content":"Hello, local."}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let response = call_local_llm_chat(
            &endpoint,
            conservative_transcript_prompt(),
            "hello local",
            Some("gemma-local"),
            std::time::Duration::from_secs(2),
        )
        .unwrap();

        let request = receiver.recv().unwrap();
        assert_eq!(response, "Hello, local.");
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request.contains("\"model\":\"gemma-local\""));
        assert!(request.contains("\"content\":\"hello local\""));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
    }

    #[test]
    fn realtime_api_key_parses_env_file_exports_and_quotes() {
        assert_eq!(
            parse_realtime_api_key_from_env_file(
                "\n# comment\nexport OPENAI_API_KEY='sk-test-value'\n"
            )
            .as_deref(),
            Some("sk-test-value")
        );
        assert_eq!(
            parse_realtime_api_key_from_env_file("OPENAI_API_KEY=\"sk-other\"").as_deref(),
            Some("sk-other")
        );
        assert!(parse_realtime_api_key_from_env_file("OTHER=value").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn realtime_env_file_must_be_private_regular_and_user_owned() {
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = std::env::temp_dir().join(format!(
            "voco-realtime-key-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("realtime.env");
        std::fs::write(&path, "OPENAI_API_KEY=sk-private").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(read_private_realtime_env_file(&path)
            .unwrap()
            .contains("sk-private"));

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_private_realtime_env_file(&path)
            .unwrap_err()
            .contains("accessible to other users"));

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let symlink_path = directory.join("linked.env");
        symlink(&path, &symlink_path).unwrap();
        assert!(read_private_realtime_env_file(&symlink_path).is_err());

        let fifo_path = directory.join("fifo.env");
        let fifo_path_bytes = std::ffi::CString::new(fifo_path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_path_bytes.as_ptr(), 0o600) }, 0);
        let started = std::time::Instant::now();
        assert!(read_private_realtime_env_file(&fifo_path)
            .unwrap_err()
            .contains("regular file"));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn realtime_client_secret_response_requires_value() {
        let parsed =
            parse_realtime_client_secret_response(r#"{"value":"ek_test","expires_at":1756310470}"#)
                .unwrap();
        assert_eq!(parsed.value, "ek_test");
        assert_eq!(parsed.expires_at, Some(1756310470));

        assert!(
            parse_realtime_client_secret_response(r#"{"expires_at":1756310470}"#)
                .unwrap_err()
                .contains("client secret")
        );
    }

    #[test]
    fn realtime_session_config_requests_audio_and_vad_responses() {
        let config = realtime_session_config();

        assert_eq!(config["output_modalities"][0], "audio");
        assert_eq!(config["audio"]["input"]["format"]["type"], "audio/pcm");
        assert_eq!(config["audio"]["input"]["format"]["rate"], 24000);
        assert_eq!(config["audio"]["output"]["format"]["type"], "audio/pcm");
        assert_eq!(config["audio"]["output"]["format"]["rate"], 24000);
        assert_eq!(
            config["audio"]["input"]["turn_detection"]["type"],
            "server_vad"
        );
        assert_eq!(
            config["audio"]["input"]["turn_detection"]["create_response"],
            true
        );
        assert_eq!(
            config["audio"]["input"]["turn_detection"]["interrupt_response"],
            true
        );
        assert!(config.get("tools").is_none());
        assert!(config.get("tool_choice").is_none());
        let serialized = config.to_string();
        assert!(!serialized.contains("openclaw_browser"));
        assert!(!serialized.contains("inspect_page"));
        assert!(!serialized.contains("list_tabs"));
        assert!(!serialized.contains("Sergio"));
        assert!(!serialized.contains("sergio"));
    }

    #[test]
    fn browser_url_parser_normalizes_only_public_http_destinations() {
        assert_eq!(
            normalize_public_browser_url("example.com").unwrap(),
            "https://example.com/"
        );
        assert_eq!(
            normalize_public_browser_url("weather tomorrow").unwrap(),
            "https://www.google.com/search?q=weather+tomorrow"
        );
        assert_eq!(
            normalize_public_browser_url("HTTPS://EXAMPLE.COM.:443/path?q=1#heading").unwrap(),
            "https://example.com/path?q=1#heading"
        );
        assert_eq!(
            normalize_public_browser_url("example.com:8443/path").unwrap(),
            "https://example.com:8443/path"
        );
        assert!(normalize_public_browser_url("https://8.8.8.8/dns-query").is_ok());
        assert!(normalize_public_browser_url("https://[2606:4700:4700::1111]/").is_ok());
    }

    #[test]
    fn browser_url_parser_rejects_credentials_private_names_and_malformed_inputs() {
        for url in [
            "ftp://example.com",
            "https://user@example.com",
            "https://user:password@example.com",
            "http:///",
            "https://localhost",
            "https://api.localhost",
            "https://printer.local",
            "https://service.internal",
            "https://host.localdomain",
            "https://intranet",
            "https://server.lan",
            "https://router.home.arpa",
            "https://service.corp",
            "https://hidden.onion",
            "https://example.test",
            "https://example.invalid",
            "https://example.example",
            "https://bad_host.example.com",
            "https://example.com\\private",
            "https://example.com\nprivate",
        ] {
            assert!(
                normalize_public_browser_url(url).is_err(),
                "unexpectedly accepted {url}"
            );
        }
    }

    #[test]
    fn browser_url_parser_rejects_non_public_and_odd_ip_literals() {
        for url in [
            "http://0.0.0.0",
            "http://10.0.0.1",
            "http://100.64.0.1",
            "http://127.0.0.1",
            "http://169.254.169.254/latest/meta-data",
            "http://172.16.0.1",
            "http://192.0.0.1",
            "http://192.0.2.1",
            "http://192.88.99.1",
            "http://192.168.1.1",
            "http://198.18.0.1",
            "http://198.51.100.1",
            "http://203.0.113.1",
            "http://224.0.0.1",
            "http://255.255.255.255",
            "http://2130706433",
            "http://0177.0.0.1",
            "http://0x7f000001",
            "http://134744072",
            "http://0x08080808",
            "http://010.010.010.010",
            "http://[::]",
            "http://[::1]",
            "http://[::ffff:127.0.0.1]",
            "http://[::ffff:10.0.0.1]",
            "http://[::ffff:8.8.8.8]",
            "http://[fc00::1]",
            "http://[fd00::1]",
            "http://[fe80::1]",
            "http://[ff02::1]",
            "http://[2001:db8::1]",
            "http://[2002:7f00:1::]",
            "http://[3fff::1]",
        ] {
            assert!(
                normalize_public_browser_url(url).is_err(),
                "unexpectedly accepted {url}"
            );
        }
    }

    #[test]
    fn realtime_browser_backend_is_fail_closed_for_every_action() {
        for action in ["open_url", "navigate"] {
            let error = invoke_openclaw_browser_action(OpenClawBrowserActionInput {
                action: action.to_string(),
                url: Some("https://example.com".to_string()),
            })
            .unwrap_err();
            assert!(error.contains("Realtime browser control is disabled"));
        }

        for action in [
            "inspect_page",
            "list_tabs",
            "click_ref",
            "type_ref",
            "press_key",
        ] {
            let error = invoke_openclaw_browser_action(OpenClawBrowserActionInput {
                action: action.to_string(),
                url: None,
            })
            .unwrap_err();
            assert!(error.contains("Unsupported OpenClaw browser action"));
        }
    }

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
        let emitted_events = [
            "recording_state_requested",
            "recording_get_user_media_started",
            "recording_get_user_media_constraints_fallback",
            "recording_get_user_media_default_fallback",
            "recording_get_user_media_done",
            "recording_audio_context_ready",
            "recording_media_source_created",
            "recording_script_processor_connected",
            "recording_worklet_connected",
            "recording_state_active",
            "dictation_live_preview_skipped_short_audio",
            "dictation_live_preview_completed",
            "dictation_live_preview_empty",
            "dictation_live_preview_updated",
            "dictation_live_preview_confirmed",
            "dictation_live_preview_window_advanced",
            "dictation_live_preview_failed",
            "dictation_live_cursor_unsafe_rewrite_blocked",
            "dictation_live_cursor_commit_waiting",
            "dictation_live_cursor_tail_transcribed",
            "dictation_live_cursor_tail_flushed",
            "dictation_live_cursor_tail_flush_failed",
            "dictation_owned_preedit_started",
            "dictation_owned_preedit_unavailable",
            "dictation_owned_preedit_updated",
            "dictation_owned_preedit_failed",
            "dictation_owned_preedit_cancelled",
            "dictation_owned_preedit_committed",
            "dictation_owned_preedit_commit_failed",
            "dictation_owned_preedit_final_preserved",
            "dictation_owned_preedit_progressive_commit",
            "dictation_canonical_checkpoint_completed",
            "dictation_canonical_checkpoint_committed",
            "dictation_canonical_checkpoint_failed",
            "dictation_canonical_final_completed",
            "dictation_first_live_text_visible",
            "dictation_live_cursor_insert_updated",
            "dictation_live_cursor_insert_failed",
            "dictation_live_cursor_overlay_fallback",
            "dictation_live_cursor_insert_cleared",
            "dictation_live_cursor_final_unreconciled",
            "dictation_live_cursor_insert_finalized",
            "dictation_stop_to_idle",
            "dictation_recording_duration",
            "dictation_transcription_completed",
            "dictation_stop_to_final_transcript",
            "dictation_enhancement_completed",
            "dictation_local_assistant_completed",
            "dictation_final_output_completed",
            "dictation_final_output_unreconciled",
            "dictation_final_insertion_failed",
        ];

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
    fn hotkey_modes() {
        assert_eq!(hotkey_to_evdev_mode("Alt+D"), 0);
        assert_eq!(hotkey_to_evdev_mode("Alt+Shift+D"), 1);
        assert_eq!(hotkey_to_evdev_mode("alt + d"), 0);
        assert_eq!(hotkey_to_evdev_mode("SHIFT+ALT+KEYD"), 1);
        assert_eq!(hotkey_to_evdev_mode("Ctrl+Shift+V"), 255);
    }

    #[test]
    fn realtime_hotkey_is_reserved_for_realtime() {
        assert!(validate_dictation_hotkey("Alt+D").is_ok());
        assert!(validate_dictation_hotkey("Alt+R").is_ok());
        assert!(validate_dictation_hotkey("Ctrl+Shift+V").is_ok());
        assert!(validate_dictation_hotkey("Command+D").is_ok());
        assert!(validate_dictation_hotkey("Alt+")
            .unwrap_err()
            .contains("Invalid hotkey"));
        assert!(validate_dictation_hotkey("Alt+Shift+R")
            .unwrap_err()
            .contains("reserved for realtime"));
        assert!(validate_dictation_hotkey("shift + alt + keyr")
            .unwrap_err()
            .contains("reserved for realtime"));
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
    fn invalid_or_reserved_persisted_hotkeys_fall_back_without_touching_valid_values() {
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
        assert!(repair_invalid_configured_hotkey(&mut reserved).is_some());
        assert_eq!(reserved.hotkey, "Alt+D");

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
