use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// Includes recipient observation: another local insertion must not replace its payload.
static DELIVERY_LOCK: Mutex<()> = Mutex::new(());

use crate::process_runner;

// Scope changes serialize with pending clipboard observation. In particular,
// cancellation must not restore the root grab halfway through an old delivery.
pub(crate) fn begin_shortcut_session(session: &str, shortcut_epoch: u64) -> Result<(), String> {
    let _delivery = DELIVERY_LOCK
        .lock()
        .map_err(|_| "Desktop delivery state is unavailable.")?;
    crate::desktop_shortcut::begin(session, shortcut_epoch)
}

pub(crate) fn end_shortcut_session(session: &str) -> Result<(), String> {
    let _delivery = DELIVERY_LOCK
        .lock()
        .map_err(|_| "Desktop delivery state is unavailable.")?;
    crate::desktop_shortcut::end(session)
}

pub(crate) fn reset_shortcut_renderer(cutoff: u64) -> Result<(), String> {
    let _delivery = DELIVERY_LOCK
        .lock()
        .map_err(|_| "Desktop delivery state is unavailable.")?;
    crate::desktop_shortcut::end_before_epoch(cutoff)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActiveStrategy {
    Clipboard,
}

#[derive(Debug, serde::Serialize)]
pub struct InsertionResult {
    #[serde(rename = "pasteMetrics", skip_serializing_if = "Option::is_none")]
    pub paste_metrics: Option<PasteMetrics>,
    pub strategy: ActiveStrategy,
    /// Helpers acknowledge dispatch, not receipt by the intended application.
    pub outcome: &'static str,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteMetrics {
    pub terminal: bool,
    pub target_probe_ms: u64,
    pub preflight_ms: u64,
    pub clipboard_ms: u64,
    pub keyboard_ms: u64,
    pub leading_separator: bool,
    pub context_separator: bool,
    pub field_observed: bool,
    pub observation_wait_ms: u64,
    pub routed_utf8_bytes: usize,
    pub payload_utf8_bytes: usize,
    pub payload_unicode_scalars: usize,
    pub payload_utf16_units: usize,
}

/// Optional queue correlation; never includes destination identity or content.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasteCorrelation {
    pub session: String,
    pub dictation_session_id: Option<u64>,
    pub delivery_seq: u64,
    pub hypothesis_seq: u64,
}

fn add_text_lengths(record: &mut serde_json::Value, prefix: &str, text: &str) {
    record[format!("{prefix}_utf8_bytes")] = serde_json::json!(text.len());
    record[format!("{prefix}_unicode_scalars")] = serde_json::json!(text.chars().count());
    record[format!("{prefix}_utf16_units")] = serde_json::json!(text.encode_utf16().count());
}

pub fn correlated_desktop_paste(
    text: &str,
    expected_target: Option<&str>,
    correlation: Option<&PasteCorrelation>,
) -> Result<InsertionResult, InsertionError> {
    let started = Instant::now();
    let result = desktop_paste_for_target(
        text,
        expected_target,
        correlation.is_some_and(|c| c.delivery_seq == 1),
    );
    if let Some(correlation) = correlation {
        let mut record = serde_json::json!({"event":"native_dispatch", "session":correlation.session,
            "dictation_session_id":correlation.dictation_session_id,
            "delivery_seq":correlation.delivery_seq, "hypothesis_seq":correlation.hypothesis_seq,
            "duration_ms":started.elapsed().as_secs_f64() * 1000.0});
        add_text_lengths(&mut record, "input", text);
        match &result {
            Ok(result) => {
                record["outcome"] = serde_json::json!("dispatched");
                if let Some(metrics) = &result.paste_metrics {
                    record["context_separator"] = serde_json::json!(metrics.context_separator);
                    record["field_observed"] = serde_json::json!(metrics.field_observed);
                    record["observation_wait_ms"] = serde_json::json!(metrics.observation_wait_ms);
                    record["terminal"] = serde_json::json!(metrics.terminal);
                    record["leading_separator"] = serde_json::json!(metrics.leading_separator);
                    record["routed_utf8_bytes"] = serde_json::json!(metrics.routed_utf8_bytes);
                    record["payload_utf8_bytes"] = serde_json::json!(metrics.payload_utf8_bytes);
                    record["payload_unicode_scalars"] =
                        serde_json::json!(metrics.payload_unicode_scalars);
                    record["payload_utf16_units"] = serde_json::json!(metrics.payload_utf16_units);
                }
            }
            Err(error) => {
                record["outcome"] = serde_json::to_value(error.outcome).unwrap_or_default();
                record["clipboard_changed"] = serde_json::json!(error.clipboard_changed);
            }
        }
        // Diagnostics are optional and may fail independently of insertion.
        let _ = crate::performance::native_speech_quality(&record);
    }
    result
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeliveryOutcome {
    NoMutation,
    Uncertain,
    Rejected,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertionError {
    pub outcome: DeliveryOutcome,
    pub message: String,
    pub clipboard_changed: bool,
}

impl InsertionError {
    pub fn rejected(message: impl Into<String>) -> Self {
        Self {
            outcome: DeliveryOutcome::Rejected,
            message: message.into(),
            clipboard_changed: false,
        }
    }

    fn no_mutation(message: impl Into<String>) -> Self {
        Self {
            outcome: DeliveryOutcome::NoMutation,
            message: message.into(),
            clipboard_changed: false,
        }
    }

    fn uncertain(message: impl Into<String>) -> Self {
        Self {
            outcome: DeliveryOutcome::Uncertain,
            message: message.into(),
            clipboard_changed: false,
        }
    }
}

impl std::fmt::Display for InsertionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for InsertionError {}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertionSupport {
    pub available: bool,
    pub required_commands: Vec<String>,
    pub missing_commands: Vec<String>,
    pub optional_missing_commands: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostics {
    pub session_type: String,
    pub type_simulation: InsertionSupport,
    pub clipboard: InsertionSupport,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPasteStatus {
    pub failure_reason: Option<DesktopPasteFailure>,
    pub shortcut_epoch: u64,
    pub target_token: Option<String>,
    pub streaming_enabled: bool,
    pub enabled: bool,
    pub available: bool,
    pub detail: String,
}

pub fn desktop_paste_enabled() -> bool {
    std::env::var("VOCO_DESKTOP_PASTE").as_deref() != Ok("0")
}

pub fn desktop_stream_enabled() -> bool {
    std::env::var("VOCO_DESKTOP_STREAM").as_deref() != Ok("0")
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInputStatus {
    pub available: bool,
    pub detail: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopPasteFailure {
    Setup,
    Cursor,
}

/// Check input prerequisites without observing a target or sending keys.
/// Onboarding must remain local even while checking readiness for later dictation.
pub fn desktop_input_status() -> DesktopInputStatus {
    if !desktop_paste_enabled() {
        return DesktopInputStatus {
            available: false,
            detail: "Desktop paste is not enabled.".into(),
        };
    }
    let preflight = input_preflight();
    let support = preflight.diagnostics.clipboard;
    let compatibility = if !support.available {
        Err(InsertionError::rejected(support.detail))
    } else if matches!(preflight.session, SessionKind::Wayland) {
        wayland_paste_arguments(preflight.daemon_running).map(|_| ())
    } else {
        Ok(())
    };
    match compatibility {
        Ok(()) => DesktopInputStatus {
            available: true,
            detail: "Desktop input is ready. Focus a text field to dictate.".into(),
        },
        Err(error) => DesktopInputStatus {
            available: false,
            detail: error.message,
        },
    }
}

pub fn desktop_paste_diagnostics() -> (DesktopInputStatus, DesktopPasteStatus) {
    // Capture before the blocking probe so a late old-renderer preflight stays stale.
    let shortcut_epoch = crate::desktop_shortcut::renderer_epoch();
    let input = desktop_input_status();
    let paste = desktop_paste_status_with_input(shortcut_epoch, &input);
    (input, paste)
}

pub fn desktop_paste_status() -> DesktopPasteStatus {
    desktop_paste_diagnostics().1
}

fn desktop_paste_status_with_input(
    shortcut_epoch: u64,
    input: &DesktopInputStatus,
) -> DesktopPasteStatus {
    let enabled = desktop_paste_enabled();
    if !input.available {
        return DesktopPasteStatus {
            shortcut_epoch,
            target_token: None,
            streaming_enabled: false,
            enabled,
            available: false,
            failure_reason: Some(DesktopPasteFailure::Setup),
            detail: input.detail.clone(),
        };
    }
    let target_started = Instant::now();
    let target = desktop_target();
    crate::performance::destination_check(
        &target.scope,
        target.events_tracked,
        "status",
        "observed",
        target_started.elapsed().as_millis() as u64,
    );
    let available = target.available();
    if !available {
        crate::trace_hotkey_event(target.reason.failure_event(), None);
    }
    DesktopPasteStatus {
        shortcut_epoch,
        target_token: target.token.clone(),
        streaming_enabled: desktop_stream_enabled(),
        enabled,
        available,
        failure_reason: if available { None } else { Some(DesktopPasteFailure::Cursor) },
        detail: match target.input_state.as_str() {
            _ if available => input.detail.clone(),
            "none" => "Click in a text field, then press your dictation shortcut to start.".into(),
            "protected" => "Dictation is unavailable in password fields. Click in another text field and try again.".into(),
            _ if matches!(target.reason, DesktopTargetReason::NoFocusedControl) => "This app is not exposing a text cursor. Check its accessibility support, reopen it, and try again.".into(),
            _ => "VOCO cannot verify a text cursor here. Click in an editable text field and try again.".into(),
        },
    }
}

// Finite metadata only. Unknown helper output never becomes a log message.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum DesktopTargetReason {
    Ready,
    EventsPending,
    NoActiveWindow,
    AmbiguousWindows,
    NoFocusedControl,
    NotEditable,
    Protected,
    ControlUnavailable,
    ProbeFailed,
    #[default]
    #[serde(other)]
    Unknown,
}

impl DesktopTargetReason {
    fn failure_event(&self) -> &'static str {
        match self {
            Self::EventsPending => "dictation_desktop_cursor_events_pending",
            Self::NoActiveWindow => "dictation_desktop_cursor_no_active_window",
            Self::AmbiguousWindows => "dictation_desktop_cursor_ambiguous_windows",
            Self::NoFocusedControl => "dictation_desktop_cursor_no_focused_control",
            Self::NotEditable => "dictation_desktop_cursor_not_editable",
            Self::Protected => "dictation_desktop_cursor_protected",
            Self::ControlUnavailable => "dictation_desktop_cursor_control_unavailable",
            Self::ProbeFailed => "dictation_desktop_cursor_probe_failed",
            Self::Ready | Self::Unknown => "dictation_desktop_cursor_unavailable",
        }
    }
}

#[derive(Debug, serde::Deserialize)]
struct DesktopTarget {
    #[serde(default)]
    reason: DesktopTargetReason,
    #[serde(default = "unknown_focus_scope")]
    input_state: String,
    shortcut: String,
    token: Option<String>,
    #[serde(default = "unknown_focus_scope")]
    scope: String,
    #[serde(default)]
    events_tracked: bool,
}

impl DesktopTarget {
    fn available(&self) -> bool {
        self.scope == "control"
            && self.token.as_deref().is_some_and(|token| !token.is_empty())
            && match self.input_state.as_str() {
                "editable" => true,
                // A canvas proves focused pane identity, not a readable caret.
                // Losing event tracking must revoke this dispatch-only route.
                "terminal_surface" => self.events_tracked && self.shortcut == "ctrl+shift+v",
                _ => false,
            }
    }
}

fn unknown_focus_scope() -> String {
    "unavailable".into()
}

fn desktop_target() -> DesktopTarget {
    let unknown = || DesktopTarget {
        reason: DesktopTargetReason::ProbeFailed,
        input_state: unknown_focus_scope(),
        shortcut: "ctrl+v".into(),
        token: None,
        scope: unknown_focus_scope(),
        events_tracked: false,
    };
    let Ok(response) = crate::focus_probe::probe() else {
        return unknown();
    };
    serde_json::from_value(response).unwrap_or_else(|_| unknown())
}

fn desktop_paste_for_target(
    text: &str,
    expected_target: Option<&str>,
    first_delivery: bool,
) -> Result<InsertionResult, InsertionError> {
    // No IPC caller may turn a missing preflight identity into an unguarded
    // paste. Reject before probing, reading a field or mutating the clipboard.
    let expected_target = expected_target
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            InsertionError::rejected(
                "No dictation destination was verified. Focus a text field and start again.",
            )
        })?;
    if !desktop_paste_enabled() {
        return Err(InsertionError::rejected("Desktop paste is not enabled."));
    }
    if text.is_empty() || text.len() > 100_000 {
        return Err(InsertionError::rejected(
            "Paste requires between 1 and 100000 UTF-8 bytes.",
        ));
    }
    let _guard = DELIVERY_LOCK.try_lock().map_err(|_| {
        InsertionError::rejected(
            "Another insertion is still finishing; no additional text was sent.",
        )
    })?;
    if !crate::desktop_shortcut::delivery_ready() {
        return Err(InsertionError::rejected(
            "The recording shortcut scope changed. Review retained text and the destination before retrying.",
        ));
    }
    let target_started = Instant::now();
    let target = desktop_target();
    let target_probe_ms = target_started.elapsed().as_millis() as u64;
    if !target.available() || Some(expected_target) != target.token.as_deref() {
        crate::performance::destination_check(
            &target.scope,
            target.events_tracked,
            "paste",
            "rejected",
            target_probe_ms,
        );
        return Err(InsertionError::rejected("The dictation destination changed or could not be verified. Review retained text before copying."));
    }
    crate::performance::destination_check(
        &target.scope,
        target.events_tracked,
        "paste",
        "matched",
        target_probe_ms,
    );
    let terminal = target.shortcut == "ctrl+shift+v";
    let terminal_text;
    let payload = if terminal {
        terminal_text = terminal_paste_text(text);
        terminal_text.as_str()
    } else {
        text
    };
    // A fresh, bounded read of the focused control is optional. Unsupported
    // controls retain the existing best-effort route and cannot claim receipt.
    let prepared = crate::focus_probe::probe_with(serde_json::json!({
        "op":"prepare", "text":payload, "expected_token":expected_target,
        "first_delivery":first_delivery,
    }))
    .map_err(|_| {
        InsertionError::rejected("Destination observation was interrupted before insertion.")
    })?;
    if !matches!(
        prepared["observation"].as_str(),
        Some("prepared" | "unavailable" | "changed" | "unsupported")
    ) {
        return Err(InsertionError::rejected(
            "Invalid destination observation response.",
        ));
    }
    if prepared["observation"] == "unsupported" {
        return Err(InsertionError::rejected(
            "This rich text selection cannot be verified. Place the caret inside one paragraph and try again.",
        ));
    }
    if prepared["observation"] == "changed" {
        return Err(InsertionError::rejected(
            "The dictation caret or destination changed before insertion.",
        ));
    }
    let receipt = if prepared["observation"] == "prepared" {
        if prepared["scope"] != "control"
            || target.token.is_none()
            || prepared["token"].as_str() != target.token.as_deref()
            || !prepared["added_separator"].is_boolean()
        {
            return Err(InsertionError::rejected(
                "Destination changed during observation preparation.",
            ));
        }
        Some(
            prepared["receipt_id"]
                .as_str()
                .filter(|id| id.len() == 32 && id.bytes().all(|c| c.is_ascii_hexdigit()))
                .ok_or_else(|| {
                    InsertionError::rejected("Invalid destination observation receipt.")
                })?
                .to_owned(),
        )
    } else {
        None
    };
    let separator = receipt.is_some() && prepared["added_separator"].as_bool() == Some(true);
    let adjusted = if separator {
        format!(" {payload}")
    } else {
        payload.to_owned()
    };
    let result = (|| {
        let mut guard_probe_ms = 0;
        let mut metrics = clipboard_paste_with_shortcut(&adjusted, terminal, || {
            let started = Instant::now();
            let current = desktop_target();
            guard_probe_ms = started.elapsed().as_millis() as u64;
            if !current.available()
                || current.token.as_deref() != Some(expected_target)
                || current.shortcut != target.shortcut
                || !crate::desktop_shortcut::delivery_ready()
            {
                return Err(InsertionError::rejected(
                    "The dictation destination changed before text could be pasted. Review retained text before copying.",
                ));
            }
            Ok(())
        })?;
        metrics.target_probe_ms = target_probe_ms.saturating_add(guard_probe_ms);
        metrics.context_separator = separator;
        if let Some(receipt) = &receipt {
            let started = Instant::now();
            observe_delivery(
                |remaining| {
                    let response = crate::focus_probe::probe_with_timeout(
                        serde_json::json!({"op":"verify", "receipt_id":receipt}),
                        remaining,
                    )?;
                    if response["receipt_id"].as_str() != Some(receipt.as_str()) {
                        return Err(());
                    }
                    Ok(response)
                },
                Duration::from_secs(3),
            )
            .map_err(|(error, event)| {
                crate::trace_hotkey_event(event, None);
                error
            })?;
            metrics.observation_wait_ms = started.elapsed().as_millis() as u64;
            metrics.field_observed = true;
        }
        Ok(metrics)
    })();
    if receipt.is_some() {
        let _ = crate::focus_probe::probe_with_timeout(
            serde_json::json!({"op":"discard"}),
            Duration::from_millis(100),
        );
    }
    let metrics = result?;
    Ok(InsertionResult {
        paste_metrics: Some(metrics),
        strategy: ActiveStrategy::Clipboard,
        outcome: "dispatched",
    })
}

fn observation_failure_event(response: Option<&serde_json::Value>) -> &'static str {
    match response.and_then(|value| value["observation"].as_str()) {
        Some("pending") => "dictation_delivery_observation_timeout",
        Some("changed") => "dictation_delivery_observation_changed",
        Some("unavailable") | None => "dictation_delivery_observation_unavailable",
        _ => "dictation_delivery_observation_invalid",
    }
}

fn observe_delivery(
    mut check: impl FnMut(Duration) -> Result<serde_json::Value, ()>,
    timeout: Duration,
) -> Result<(), (InsertionError, &'static str)> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let response = if remaining.is_zero() {
            None
        } else {
            check(remaining).ok()
        };
        match response.as_ref().and_then(|v| v["observation"].as_str()) {
            Some("observed") => return Ok(()),
            Some("pending") if Instant::now() < deadline => std::thread::sleep(
                Duration::from_millis(15).min(deadline.saturating_duration_since(Instant::now())),
            ),
            _ => {
                let event = if remaining.is_zero() {
                    "dictation_delivery_observation_timeout"
                } else {
                    observation_failure_event(response.as_ref())
                };
                let mut error = InsertionError::uncertain("The destination did not confirm the expected insertion. Streaming stopped; review retained text before retrying.");
                error.clipboard_changed = true;
                return Err((error, event));
            }
        }
    }
}

fn terminal_paste_text(text: &str) -> String {
    // Dictation must not send terminal control sequences or embedded line endings.
    text.chars()
        .map(|ch| if ch.is_ascii_control() { ' ' } else { ch })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionKind {
    Wayland,
    X11OrOther,
}

fn session_kind() -> SessionKind {
    if std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
    {
        SessionKind::Wayland
    } else {
        SessionKind::X11OrOther
    }
}

fn session_type_label(session: SessionKind) -> &'static str {
    match session {
        SessionKind::Wayland => "wayland",
        SessionKind::X11OrOther => "x11-or-other",
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(target_family = "unix")]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(not(target_family = "unix"))]
    {
        std::fs::metadata(path)
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
    }
}

fn command_available(command: &str) -> bool {
    // Daemon selection qualifies this same distro client. A PATH override may
    // use an incompatible protocol and must not talk to the private helper.
    if command == "ydotool" {
        return is_executable(Path::new(SYSTEM_YDOTOOL));
    }
    let candidate = Path::new(command);
    if candidate.components().count() > 1 {
        return is_executable(candidate);
    }

    std::env::var_os("PATH")
        .map(|path_env| {
            std::env::split_paths(&path_env).any(|dir| {
                let path = dir.join(command);
                is_executable(&path)
            })
        })
        .unwrap_or(false)
}

const SYSTEM_YDOTOOL: &str = "/usr/bin/ydotool";

fn process_running(process_name: &str) -> bool {
    let mut command = process_runner::command("pgrep");
    command.args(["-x", process_name]);
    run_helper(&mut command, None, Duration::from_secs(1)).is_ok()
}

fn build_support<F>(
    required_commands: &[&str],
    optional_commands: &[&str],
    success_detail: impl FnOnce(&[String]) -> String,
    failure_detail: impl FnOnce(&[String]) -> String,
    command_is_available: F,
) -> InsertionSupport
where
    F: Fn(&str) -> bool,
{
    let required_commands = required_commands
        .iter()
        .map(|command| (*command).to_string())
        .collect::<Vec<_>>();
    let optional_missing_commands = optional_commands
        .iter()
        .filter(|command| !command_is_available(command))
        .map(|command| (*command).to_string())
        .collect::<Vec<_>>();
    let missing_commands = required_commands
        .iter()
        .filter(|command| !command_is_available(command))
        .cloned()
        .collect::<Vec<_>>();
    let available = missing_commands.is_empty();
    let detail = if available {
        success_detail(&optional_missing_commands)
    } else {
        failure_detail(&missing_commands)
    };

    InsertionSupport {
        available,
        required_commands,
        missing_commands,
        optional_missing_commands,
        detail,
    }
}

fn runtime_diagnostics_with<F>(
    session: SessionKind,
    clipboard_program: &str,
    command_is_available: F,
) -> RuntimeDiagnostics
where
    F: Fn(&str) -> bool + Copy,
{
    let type_simulation = match session {
        SessionKind::Wayland => build_support(
            &["ydotool"],
            &["ydotoold"],
            |optional_missing| {
                if optional_missing.is_empty() {
                    "The Wayland typing helpers are present. Delivery and target focus still require a working desktop session.".to_string()
                } else {
                    "Direct type simulation can run on Wayland, but ydotoold is missing or not running; cursor typing may be delayed or unreliable."
                        .to_string()
                }
            },
            |missing| {
                format!(
                    "Direct type simulation on Wayland requires: {}.",
                    missing.join(", ")
                )
            },
            command_is_available,
        ),
        SessionKind::X11OrOther => build_support(
            &["xdotool"],
            &[],
            |_| {
                "The X11 typing helper is present. Delivery and target focus still require a working desktop session.".to_string()
            },
            |missing| {
                format!(
                    "Direct type simulation on X11-like sessions requires: {}.",
                    missing.join(", ")
                )
            },
            command_is_available,
        ),
    };

    let clipboard = match session {
        SessionKind::Wayland => build_support(
            &[clipboard_program, "ydotool"],
            &["ydotoold"],
            |optional_missing| {
                let caveat = if optional_missing.is_empty() {
                    "Clipboard helpers are present on Wayland."
                } else {
                    "Clipboard helpers are present, but ydotoold is missing or not running; paste may fail."
                };
                format!("{caveat} Clipboard insertion replaces the current selection with the transcript and leaves it there. Automatic restoration is unavailable because these helpers cannot verify ownership or preserve all formats.")
            },
            |missing| {
                format!(
                    "Clipboard insertion on Wayland requires: {}.",
                    missing.join(", ")
                )
            },
            command_is_available,
        ),
        SessionKind::X11OrOther => build_support(
            &["xclip", "xdotool"],
            &[],
            |_| {
                "Clipboard helpers are present on X11-like sessions. Clipboard insertion replaces the current selection with the transcript and leaves it there. Automatic restoration is unavailable because these helpers cannot verify ownership or preserve all formats.".to_string()
            },
            |missing| {
                format!(
                    "Clipboard insertion on X11-like sessions requires: {}.",
                    missing.join(", ")
                )
            },
            command_is_available,
        ),
    };

    RuntimeDiagnostics {
        session_type: session_type_label(session).to_string(),
        type_simulation,
        clipboard,
    }
}

fn clipboard_helper_for(session: SessionKind, desktop: &str, has_x_display: bool) -> &'static str {
    let gnome = desktop
        .split(':')
        .any(|name| name.eq_ignore_ascii_case("gnome"));
    if matches!(session, SessionKind::Wayland) && !(gnome && has_x_display) {
        "wl-copy"
    } else {
        "xclip"
    }
}

pub fn desktop_clipboard_helper() -> &'static str {
    // GNOME lacks the wlroots data-control protocol. wl-copy's temporary focus
    // surface can stall under focus prevention; XWayland bridges the clipboard
    // without creating a focus-taking surface. Keyboard delivery remains Wayland.
    clipboard_helper_for(
        session_kind(),
        &std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
        std::env::var("DISPLAY").is_ok_and(|value| !value.is_empty()),
    )
}

struct InputPreflight {
    session: SessionKind,
    diagnostics: RuntimeDiagnostics,
    daemon_running: bool,
}

fn input_preflight_with(
    session: SessionKind,
    clipboard_helper: &str,
    available: impl Fn(&str) -> bool + Copy,
    probe_daemon: impl FnOnce() -> bool,
) -> InputPreflight {
    // This result belongs only to this operation. Reuse it for both diagnostic
    // routes and paste compatibility, then sample afresh on the next operation.
    let daemon_running = matches!(session, SessionKind::Wayland) && probe_daemon();
    let diagnostics = runtime_diagnostics_with(session, clipboard_helper, |command| {
        available(command) && (command != "ydotoold" || daemon_running)
    });
    InputPreflight {
        session,
        diagnostics,
        daemon_running,
    }
}

fn input_preflight() -> InputPreflight {
    input_preflight_with(
        session_kind(),
        desktop_clipboard_helper(),
        command_available,
        || process_running("ydotoold"),
    )
}

pub fn runtime_diagnostics() -> RuntimeDiagnostics {
    input_preflight().diagnostics
}

/// A failed spawn proves the helper did not run. Any later error is uncertain:
/// the helper may have typed a prefix or sent the paste gesture already.
fn run_helper(
    command: &mut Command,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<(), InsertionError> {
    command.stdout(Stdio::null()).stderr(Stdio::null());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let child = command.spawn().map_err(|error| {
        InsertionError::no_mutation(format!("Could not start the input helper: {error}"))
    })?;
    let result = match input {
        Some(data) => process_runner::wait_with_input_output(child, data, timeout, 64 * 1024),
        None => process_runner::wait_with_output(child, timeout, 64 * 1024),
    };
    let output = result.map_err(|error| {
        InsertionError::uncertain(format!("Input helper completion is uncertain: {error}. Text may have been partially delivered; automatic retry was stopped."))
    })?;
    if !output.status.success() {
        return Err(InsertionError::uncertain(format!(
            "Input helper exited with {}. Text may have been partially delivered; automatic retry was stopped.", output.status
        )));
    }
    Ok(())
}

fn clipboard_paste_with_shortcut(
    text: &str,
    terminal: bool,
    before_paste: impl FnOnce() -> Result<(), InsertionError>,
) -> Result<PasteMetrics, InsertionError> {
    let started = Instant::now();
    let preflight = input_preflight();
    let wayland = matches!(preflight.session, SessionKind::Wayland);
    if !preflight.diagnostics.clipboard.available {
        return Err(InsertionError::no_mutation(
            preflight.diagnostics.clipboard.detail,
        ));
    }
    // Detect the installed CLI before replacing clipboard contents. Ubuntu's
    // legacy ydotool takes chord names; newer releases take keycode events.
    let (payload, leading_separator) = desktop_paste_payload(text);
    let wayland_args = if wayland {
        Some(wayland_clipboard_arguments(
            wayland_paste_arguments(preflight.daemon_running)?,
            terminal,
            leading_separator,
        ))
    } else {
        None
    };
    let (copy_program, copy_args): (&str, &[&str]) = if desktop_clipboard_helper() == "wl-copy" {
        ("wl-copy", &["--type", "text/plain;charset=utf-8"])
    } else {
        ("xclip", &["-selection", "clipboard", "-in"])
    };
    let mut copy = process_runner::command(copy_program);
    copy.args(copy_args);
    let x11_args = x11_paste_arguments(terminal, leading_separator);
    let (paste_program, paste_args): (&str, &[&str]) = if wayland {
        (
            SYSTEM_YDOTOOL,
            wayland_args
                .as_deref()
                .expect("Wayland arguments checked above"),
        )
    } else {
        ("xdotool", &x11_args)
    };
    let mut paste = process_runner::command(paste_program);
    paste.args(paste_args);
    let preflight_ms = started.elapsed().as_millis() as u64;
    let (clipboard_ms, keyboard_ms) =
        clipboard_transaction(payload, &mut copy, &mut paste, before_paste)?;
    Ok(PasteMetrics {
        terminal,
        target_probe_ms: 0,
        preflight_ms,
        clipboard_ms,
        keyboard_ms,
        leading_separator,
        context_separator: false,
        field_observed: false,
        observation_wait_ms: 0,
        routed_utf8_bytes: text.len(),
        payload_utf8_bytes: payload.len(),
        payload_unicode_scalars: payload.chars().count(),
        payload_utf16_units: payload.encode_utf16().count(),
    })
}

fn desktop_paste_payload(text: &str) -> (&str, bool) {
    // Chromium's address bar strips a pasted chunk's leading whitespace. Send
    // VOCO's single joining space as a key in the same ordered paste gesture.
    // Preserve other whitespace verbatim rather than normalizing user content.
    match text.strip_prefix(' ') {
        Some(rest) if rest.starts_with(|ch: char| !ch.is_whitespace()) => (rest, true),
        _ => (text, false),
    }
}

fn x11_paste_arguments(terminal: bool, leading_separator: bool) -> Vec<&'static str> {
    let mut args = vec!["key", "--clearmodifiers"];
    if leading_separator {
        args.push("space");
    }
    args.push(if terminal { "ctrl+shift+v" } else { "ctrl+v" });
    args
}

fn wayland_clipboard_arguments(
    mut args: Vec<&'static str>,
    terminal: bool,
    leading_separator: bool,
) -> Vec<&'static str> {
    let legacy = args.last() == Some(&"ctrl+v");
    if terminal {
        if legacy {
            *args.last_mut().unwrap() = "ctrl+shift+v";
        } else {
            args = vec!["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"];
        }
    }
    if leading_separator {
        if legacy {
            // ydotool 0.1.x treats unknown key names as their first character:
            // "space" emits KEY_S. A literal space emits KEY_SPACE. xdotool
            // uses a different parser and still requires its "space" keysym.
            args.insert(args.len() - 1, " ");
        } else {
            args.splice(1..1, ["57:1", "57:0"]);
        }
    }
    args
}

fn paste_arguments_from_help(help: &str) -> Result<Vec<&'static str>, InsertionError> {
    if help.contains("Each key sequence") && help.contains("ctrl+Backspace") {
        // Legacy ydotool defaults to 100 ms and also uses --delay for key
        // spacing (ignoring --key-delay internally). Keep a nonzero 24 ms
        // delay: normal/terminal paste retains 6–12 ms between key events.
        Ok(vec!["key", "--delay", "24", "--key-delay", "12", "ctrl+v"])
    } else if help.contains("Syntax: <keycode>:<pressed>") {
        Ok(vec!["key", "29:1", "47:1", "47:0", "29:0"])
    } else {
        Err(InsertionError::rejected("The installed ydotool key interface is unsupported; no clipboard or keyboard action was performed."))
    }
}

fn wayland_paste_arguments(daemon_running: bool) -> Result<Vec<&'static str>, InsertionError> {
    if !daemon_running {
        return Err(InsertionError::rejected(
            "Start the ydotoold desktop input service before dictating.",
        ));
    }
    let child = process_runner::command(SYSTEM_YDOTOOL)
        .args(["key", "--help"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| InsertionError::rejected("The desktop paste helper is unavailable."))?;
    let output = process_runner::wait_with_output(child, Duration::from_secs(2), 16 * 1024)
        .map_err(|_| {
            InsertionError::rejected(
                "The desktop paste helper did not answer its compatibility check.",
            )
        })?;
    if !output.status.success() {
        return Err(InsertionError::rejected(
            "The desktop paste helper could not connect to its input service.",
        ));
    }
    let help = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    paste_arguments_from_probe(&help)
}

fn paste_arguments_from_probe(help: &str) -> Result<Vec<&'static str>, InsertionError> {
    // Legacy clients can exit successfully after falling back to direct uinput.
    // A daemon owned by a different login must not produce a false ready result.
    if help.contains("ydotoold backend unavailable") {
        return Err(InsertionError::rejected("The desktop paste helper cannot reach its input service. Start ydotoold for this login, then check desktop setup again."));
    }
    paste_arguments_from_help(help)
}

fn clipboard_transaction(
    text: &str,
    copy: &mut Command,
    paste: &mut Command,
    before_paste: impl FnOnce() -> Result<(), InsertionError>,
) -> Result<(u64, u64), InsertionError> {
    let copy_started = Instant::now();
    run_helper(copy, Some(text.as_bytes()), Duration::from_secs(5)).map_err(|mut error| {
        error.clipboard_changed = error.outcome == DeliveryOutcome::Uncertain;
        error
    })?;

    let clipboard_ms = copy_started.elapsed().as_millis() as u64;
    // Clipboard helpers may block. Revalidate the bound destination after they
    // finish, immediately before sending keys. This narrows the focus race;
    // it cannot make a desktop keyboard gesture atomic with another app.
    before_paste().map_err(|mut error| {
        error.clipboard_changed = true;
        error
    })?;
    let paste_started = Instant::now();
    run_helper(paste, None, Duration::from_secs(5)).map_err(|mut error| {
        // Clipboard mutation already happened, even if the paste helper could
        // not start. No automatic retry or restoration is safe here.
        error.outcome = DeliveryOutcome::Uncertain;
        error.clipboard_changed = true;
        error
            .message
            .push_str(" The clipboard was set to the transcript; copy it from VOCO if needed.");
        error
    })?;

    let keyboard_ms = paste_started.elapsed().as_millis() as u64;
    // Neither helper exposes atomic compare-and-restore, all MIME formats, or
    // a target consumption acknowledgement. Restoring after a sleep can erase
    // a newer copy or replace the data before a slow application reads it.
    Ok((clipboard_ms, keyboard_ms))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn missing_destination_rejects_before_any_desktop_operation() {
        for target in [None, Some("")] {
            let error = desktop_paste_for_target("Synthetic phrase.", target, true).unwrap_err();
            assert_eq!(error.outcome, DeliveryOutcome::Rejected);
            assert!(!error.clipboard_changed);
            assert!(error
                .message
                .contains("No dictation destination was verified"));
        }
    }

    #[test]
    fn observation_waits_for_content_and_never_retries_uncertain_delivery() {
        let mut calls = 0;
        observe_delivery(
            |_| {
                calls += 1;
                Ok(serde_json::json!({"observation": if calls == 1 {"pending"} else {"observed"}}))
            },
            Duration::from_millis(100),
        )
        .unwrap();
        assert_eq!(calls, 2);
        for result in [
            Ok(serde_json::json!({"observation":"changed"})),
            Ok(serde_json::json!({"observation":"unavailable"})),
            Err(()),
        ] {
            let (error, event) =
                observe_delivery(|_| result.clone(), Duration::from_millis(100)).unwrap_err();
            assert!(matches!(error.outcome, DeliveryOutcome::Uncertain));
            assert!(error.clipboard_changed);
            assert!(crate::is_supported_dictation_trace_event(event));
        }
        let (error, event) = observe_delivery(
            |_| panic!("Expired budget must not issue another probe"),
            Duration::ZERO,
        )
        .unwrap_err();
        assert!(matches!(error.outcome, DeliveryOutcome::Uncertain));
        assert_eq!(event, "dictation_delivery_observation_timeout");
        assert_eq!(
            observation_failure_event(Some(&serde_json::json!({"observation":"private text"}))),
            "dictation_delivery_observation_invalid"
        );
    }

    #[test]
    fn correlation_lengths_distinguish_units_without_exporting_text() {
        let mut record = serde_json::json!({});
        add_text_lengths(&mut record, "input", " é😀");
        let (payload, split) = desktop_paste_payload(" é😀");
        add_text_lengths(&mut record, "payload", payload);
        assert!(split);
        assert_eq!(record["input_utf8_bytes"], 7);
        assert_eq!(record["input_unicode_scalars"], 3);
        assert_eq!(record["input_utf16_units"], 4);
        assert_eq!(record["payload_utf8_bytes"], 6);
        assert_eq!(record["payload_unicode_scalars"], 2);
        assert_eq!(record["payload_utf16_units"], 3);
        assert!(!record.to_string().contains("é"));
    }

    #[test]
    fn streaming_separator_is_an_ordered_key_before_paste() {
        assert_eq!(desktop_paste_payload(" next words"), ("next words", true));
        for text in ["First words", ".", " ", "  indented", "\nparagraph", ""] {
            assert_eq!(desktop_paste_payload(text), (text, false));
        }
        assert_eq!(
            x11_paste_arguments(false, true),
            ["key", "--clearmodifiers", "space", "ctrl+v"]
        );
        assert_eq!(
            x11_paste_arguments(true, true),
            ["key", "--clearmodifiers", "space", "ctrl+shift+v"]
        );
    }

    #[test]
    fn cursor_failure_diagnostics_accept_only_finite_metadata() {
        for (reason, expected) in [
            ("events_pending", "dictation_desktop_cursor_events_pending"),
            (
                "no_active_window",
                "dictation_desktop_cursor_no_active_window",
            ),
            (
                "ambiguous_windows",
                "dictation_desktop_cursor_ambiguous_windows",
            ),
            (
                "no_focused_control",
                "dictation_desktop_cursor_no_focused_control",
            ),
            ("not_editable", "dictation_desktop_cursor_not_editable"),
            ("protected", "dictation_desktop_cursor_protected"),
            (
                "control_unavailable",
                "dictation_desktop_cursor_control_unavailable",
            ),
            ("probe_failed", "dictation_desktop_cursor_probe_failed"),
            ("private field text", "dictation_desktop_cursor_unavailable"),
        ] {
            let target: DesktopTarget = serde_json::from_value(serde_json::json!({
                "shortcut": "ctrl+v", "token": null, "reason": reason,
            }))
            .unwrap();
            assert_eq!(target.reason.failure_event(), expected);
            assert!(crate::is_supported_dictation_trace_event(expected));
        }
        let legacy: DesktopTarget = serde_json::from_value(serde_json::json!({
            "shortcut": "ctrl+v", "token": null,
        }))
        .unwrap();
        assert_eq!(
            legacy.reason.failure_event(),
            "dictation_desktop_cursor_unavailable"
        );
    }

    #[test]
    fn terminal_surface_admission_requires_control_identity_and_focus_tracking() {
        let valid = serde_json::json!({
            "input_state": "terminal_surface", "reason": "ready",
            "scope": "control", "token": "bound-pane", "shortcut": "ctrl+shift+v",
            "events_tracked": true,
        });
        let target: DesktopTarget = serde_json::from_value(valid.clone()).unwrap();
        assert!(target.available(), "A verified terminal pane does not need an accessible text caret");
        for (field, value) in [
            ("token", serde_json::Value::Null),
            ("token", serde_json::json!("")),
            ("scope", serde_json::json!("window")),
            ("shortcut", serde_json::json!("ctrl+v")),
            ("events_tracked", serde_json::json!(false)),
            ("input_state", serde_json::json!("protected")),
            ("input_state", serde_json::json!("none")),
            ("input_state", serde_json::json!("unknown")),
        ] {
            let mut rejected = valid.clone();
            rejected[field] = value;
            let target: DesktopTarget = serde_json::from_value(rejected).unwrap();
            assert!(!target.available(), "Invalid destination admitted after changing {field}");
        }
        let target: DesktopTarget = serde_json::from_value(serde_json::json!({
            "input_state": "editable", "scope": "control", "token": "bound-field",
            "shortcut": "ctrl+v", "events_tracked": false,
        })).unwrap();
        assert!(target.available(), "Ordinary editable controls retain their existing admission");
    }

    #[test]
    fn terminal_paste_preserves_unicode_without_control_keys_or_line_submission() {
        assert_eq!(
            terminal_paste_text("café\n你好\r\t\u{1b}text"),
            "café 你好   text"
        );
    }

    #[test]
    fn input_preflight_reuses_one_scan_and_refreshes_next_operation() {
        let scans = Cell::new(0);
        let probe = || {
            scans.set(scans.get() + 1);
            scans.get() == 1
        };
        let first = input_preflight_with(SessionKind::Wayland, "xclip", |_| true, probe);
        assert_eq!(scans.get(), 1);
        assert!(first.daemon_running);
        assert!(first
            .diagnostics
            .clipboard
            .optional_missing_commands
            .is_empty());
        assert!(first
            .diagnostics
            .type_simulation
            .optional_missing_commands
            .is_empty());
        let second = input_preflight_with(SessionKind::Wayland, "xclip", |_| true, probe);
        assert_eq!(scans.get(), 2);
        assert!(!second.daemon_running);
        assert_eq!(
            second.diagnostics.clipboard.optional_missing_commands,
            ["ydotoold"]
        );
        assert_eq!(
            second.diagnostics.type_simulation.optional_missing_commands,
            ["ydotoold"]
        );
        // The missing-daemon route must reject before spawning the key helper.
        let error = wayland_paste_arguments(second.daemon_running).unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Rejected);
        assert!(!error.clipboard_changed);
        assert_eq!(
            error.message,
            "Start the ydotoold desktop input service before dictating."
        );
        assert_eq!(scans.get(), 2);
    }

    #[test]
    fn legacy_client_fallback_is_not_desktop_readiness() {
        let help = "Each key sequence ctrl+Backspace";
        assert!(paste_arguments_from_probe(help).is_ok());
        let fallback = format!(
            "{help}\nydotool: notice: ydotoold backend unavailable (may have latency+delay issues)"
        );
        assert!(paste_arguments_from_probe(&fallback).is_err());
    }

    #[test]
    fn input_preflight_preserves_missing_helpers_and_skips_x11_daemon_scan() {
        let x11 = input_preflight_with(
            SessionKind::X11OrOther,
            "xclip",
            |_| true,
            || panic!("X11 must not query the Wayland daemon"),
        );
        assert!(x11.diagnostics.clipboard.available);
        assert!(!x11.daemon_running);
        for missing in ["xclip", "ydotool", "ydotoold"] {
            for daemon_running in [false, true] {
                let actual = input_preflight_with(
                    SessionKind::Wayland,
                    "xclip",
                    |name| name != missing,
                    || daemon_running,
                );
                let previous = runtime_diagnostics_with(SessionKind::Wayland, "xclip", |name| {
                    name != missing && (name != "ydotoold" || daemon_running)
                });
                assert_eq!(
                    serde_json::to_value(actual.diagnostics).unwrap(),
                    serde_json::to_value(previous).unwrap()
                );
            }
        }
    }

    #[test]
    fn clipboard_transport_matches_session_and_preflight_requirements() {
        assert_eq!(
            clipboard_helper_for(SessionKind::Wayland, "ubuntu:GNOME", true),
            "xclip"
        );
        assert_eq!(
            clipboard_helper_for(SessionKind::Wayland, "gnome", true),
            "xclip"
        );
        assert_eq!(
            clipboard_helper_for(SessionKind::Wayland, "GNOME", false),
            "wl-copy"
        );
        assert_eq!(
            clipboard_helper_for(SessionKind::Wayland, "KDE", true),
            "wl-copy"
        );
        assert_eq!(
            clipboard_helper_for(SessionKind::X11OrOther, "GNOME", true),
            "xclip"
        );
        let missing = runtime_diagnostics_with(SessionKind::Wayland, "xclip", |c| c != "xclip");
        assert!(!missing.clipboard.available);
        assert_eq!(missing.clipboard.missing_commands, vec!["xclip"]);
        let ready = runtime_diagnostics_with(SessionKind::Wayland, "xclip", |c| c != "wl-copy");
        assert!(ready.clipboard.available);
        assert_eq!(ready.clipboard.required_commands, vec!["xclip", "ydotool"]);
    }

    #[test]
    fn clipboard_gesture_matches_installed_ydotool_generation() {
        assert_eq!(
            paste_arguments_from_help("Each key sequence ctrl+Backspace").unwrap(),
            vec!["key", "--delay", "24", "--key-delay", "12", "ctrl+v"]
        );
        assert_eq!(
            paste_arguments_from_help("Syntax: <keycode>:<pressed>").unwrap(),
            vec!["key", "29:1", "47:1", "47:0", "29:0"]
        );
        let error = paste_arguments_from_help("unknown helper").unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Rejected);
        assert!(!error.clipboard_changed);
    }

    #[test]
    fn wayland_separator_and_terminal_chords_match_both_helper_interfaces() {
        for terminal in [false, true] {
            for separator in [false, true] {
                let legacy = paste_arguments_from_help("Each key sequence ctrl+Backspace").unwrap();
                let mut expected = vec!["key", "--delay", "24", "--key-delay", "12"];
                if separator {
                    expected.push(" ");
                }
                expected.push(if terminal { "ctrl+shift+v" } else { "ctrl+v" });
                assert_eq!(
                    wayland_clipboard_arguments(legacy, terminal, separator),
                    expected
                );

                let modern = paste_arguments_from_help("Syntax: <keycode>:<pressed>").unwrap();
                let mut expected = vec!["key"];
                if separator {
                    expected.extend(["57:1", "57:0"]);
                }
                expected.push("29:1");
                if terminal {
                    expected.push("42:1");
                }
                expected.extend(["47:1", "47:0"]);
                if terminal {
                    expected.push("42:0");
                }
                expected.push("29:0");
                assert_eq!(
                    wayland_clipboard_arguments(modern, terminal, separator),
                    expected
                );
            }
        }
    }

    #[test]
    fn structured_outcome_serialization_is_stable() {
        let error = InsertionError::uncertain("partial delivery");
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["outcome"], "uncertain");
        assert_eq!(json["clipboardChanged"], false);
        assert_eq!(
            serde_json::to_string(&ActiveStrategy::Clipboard).unwrap(),
            r#""clipboard""#
        );
    }

    #[test]
    fn helper_spawn_failure_and_failed_exit_have_different_outcomes() {
        let mut missing = process_runner::command("/definitely-missing-voco-test-helper");
        assert_eq!(
            run_helper(&mut missing, None, Duration::from_secs(1))
                .unwrap_err()
                .outcome,
            DeliveryOutcome::NoMutation
        );
        let mut failed = process_runner::command("/bin/sh");
        failed.args(["-c", "exit 3"]);
        assert_eq!(
            run_helper(&mut failed, None, Duration::from_secs(1))
                .unwrap_err()
                .outcome,
            DeliveryOutcome::Uncertain
        );
    }

    #[test]
    fn hung_helper_and_blocked_stdin_are_bounded_and_uncertain() {
        let started = std::time::Instant::now();
        let mut command = process_runner::command("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let error = run_helper(
            &mut command,
            Some(&vec![b'x'; 1024 * 1024]),
            Duration::from_millis(50),
        )
        .unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Uncertain);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn clipboard_transaction_never_restores_over_a_new_copy() {
        let directory = std::env::temp_dir().join(format!(
            "voco-clipboard-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let clipboard = directory.join("selection");
        let consumed = directory.join("consumed");
        std::fs::write(&clipboard, b"old text").unwrap();
        let mut copy = process_runner::command("/bin/sh");
        copy.args(["-c", "cat > \"$1\"", "copy"]).arg(&clipboard);
        let mut paste = process_runner::command("/bin/sh");
        paste
            .args([
                "-c",
                "sleep 0.05; cp \"$1\" \"$2\"; printf 'new user copy' > \"$1\"",
                "paste",
            ])
            .arg(&clipboard)
            .arg(&consumed);
        clipboard_transaction("intended transcript\n", &mut copy, &mut paste, || Ok(())).unwrap();
        assert_eq!(std::fs::read(&consumed).unwrap(), b"intended transcript\n");
        assert_eq!(std::fs::read(&clipboard).unwrap(), b"new user copy");
        std::fs::remove_file(clipboard).unwrap();
        std::fs::remove_file(consumed).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn destination_change_after_copy_blocks_keyboard_dispatch() {
        let directory = std::env::temp_dir().join(format!(
            "voco-before-paste-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let clipboard = directory.join("selection");
        let consumed = directory.join("wrong-recipient");
        let mut copy = process_runner::command("/bin/sh");
        copy.args(["-c", "cat > \"$1\"", "copy"]).arg(&clipboard);
        let mut paste = process_runner::command("/bin/sh");
        paste
            .args(["-c", "cp \"$1\" \"$2\"", "paste"])
            .arg(&clipboard)
            .arg(&consumed);
        let result = clipboard_transaction("Synthetic phrase.", &mut copy, &mut paste, || {
            assert_eq!(std::fs::read(&clipboard).unwrap(), b"Synthetic phrase.");
            Err(InsertionError::rejected(
                "Destination changed during clipboard preparation.",
            ))
        });
        let keyboard_was_dispatched = consumed.exists();
        std::fs::remove_dir_all(directory).unwrap();
        let error = result.unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Rejected);
        assert!(error.clipboard_changed);
        assert!(!keyboard_was_dispatched);
    }

    #[test]
    fn failed_paste_after_copy_is_uncertain_even_if_paste_never_spawned() {
        let mut copy = process_runner::command("/bin/cat");
        let mut paste = process_runner::command("/definitely-missing-voco-test-helper");
        let error =
            clipboard_transaction("transcript", &mut copy, &mut paste, || Ok(())).unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Uncertain);
        assert!(error.clipboard_changed);
    }

    #[test]
    fn diagnostics_distinguish_helpers_from_verified_delivery_and_no_restore() {
        let diagnostics = runtime_diagnostics_with(SessionKind::Wayland, "wl-copy", |command| {
            matches!(command, "ydotool" | "wl-copy")
        });
        assert!(diagnostics.clipboard.available);
        assert_eq!(
            diagnostics.clipboard.optional_missing_commands,
            vec!["ydotoold".to_string()]
        );
        assert!(diagnostics.clipboard.detail.contains("leaves it there"));
        assert!(diagnostics
            .clipboard
            .detail
            .contains("cannot verify ownership"));
        let diagnostics = runtime_diagnostics_with(SessionKind::X11OrOther, "xclip", |command| {
            command == "xdotool"
        });
        assert!(!diagnostics.clipboard.available);
        assert_eq!(
            diagnostics.clipboard.missing_commands,
            vec!["xclip".to_string()]
        );
    }
}
