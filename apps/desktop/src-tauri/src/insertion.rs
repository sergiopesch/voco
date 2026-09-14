use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::process_runner;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActiveStrategy {
    Ydotool,
    Xdotool,
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

pub fn desktop_paste_status() -> DesktopPasteStatus {
    let enabled = desktop_paste_enabled();
    if !enabled {
        return DesktopPasteStatus {
            target_token: None,
            streaming_enabled: false,
            enabled,
            available: false,
            detail: "Desktop paste is not enabled.".into(),
        };
    }
    let support = runtime_diagnostics().clipboard;
    let compatibility = if support.available && is_wayland() {
        wayland_paste_arguments().map(|_| ())
    } else if support.available {
        Ok(())
    } else {
        Err(InsertionError::rejected(support.detail.clone()))
    };
    let target_started = Instant::now();
    let target = desktop_target();
    crate::performance::destination_check(
        &target.scope,
        target.events_tracked,
        "status",
        "observed",
        target_started.elapsed().as_millis() as u64,
    );
    DesktopPasteStatus {
        target_token: target.token,
        streaming_enabled: desktop_stream_enabled(),
        enabled,
        available: compatibility.is_ok(),
        detail: compatibility
            .err()
            .map(|e| e.message)
            .unwrap_or(support.detail),
    }
}

#[derive(Debug, serde::Deserialize)]
struct DesktopTarget {
    shortcut: String,
    token: Option<String>,
    #[serde(default = "unknown_focus_scope")]
    scope: String,
    #[serde(default)]
    events_tracked: bool,
}

fn unknown_focus_scope() -> String {
    "unavailable".into()
}

fn desktop_target() -> DesktopTarget {
    let unknown = || DesktopTarget {
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

pub fn desktop_paste_for_target(
    text: &str,
    expected_target: Option<&str>,
) -> Result<InsertionResult, InsertionError> {
    if !desktop_paste_enabled() {
        return Err(InsertionError::rejected("Desktop paste is not enabled."));
    }
    if text.is_empty() || text.len() > 100_000 {
        return Err(InsertionError::rejected(
            "Paste requires between 1 and 100000 UTF-8 bytes.",
        ));
    }
    let target_started = Instant::now();
    let target = desktop_target();
    let target_probe_ms = target_started.elapsed().as_millis() as u64;
    if expected_target.is_some() && expected_target != target.token.as_deref() {
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
        if expected_target.is_some() {
            "matched"
        } else {
            "unverified"
        },
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
    let mut metrics = clipboard_paste_with_shortcut(payload, terminal)?;
    metrics.target_probe_ms = target_probe_ms;
    Ok(InsertionResult {
        paste_metrics: Some(metrics),
        strategy: ActiveStrategy::Clipboard,
        outcome: "dispatched",
    })
}

fn terminal_paste_text(text: &str) -> String {
    // Dictation must not send terminal control sequences or embedded line endings.
    text.chars()
        .map(|ch| if ch.is_ascii_control() { ' ' } else { ch })
        .collect()
}

#[derive(Debug)]
enum RequestedStrategy {
    Auto,
    Clipboard,
    TypeSimulation,
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

fn is_wayland() -> bool {
    matches!(session_kind(), SessionKind::Wayland)
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

pub fn runtime_diagnostics() -> RuntimeDiagnostics {
    runtime_diagnostics_with(session_kind(), desktop_clipboard_helper(), |command| {
        if command == "ydotoold" {
            command_available(command) && process_running(command)
        } else {
            command_available(command)
        }
    })
}

fn parse_requested_strategy(preferred: &str) -> Result<RequestedStrategy, InsertionError> {
    match preferred {
        "auto" => Ok(RequestedStrategy::Auto),
        "clipboard" => Ok(RequestedStrategy::Clipboard),
        "type-simulation" => Ok(RequestedStrategy::TypeSimulation),
        _ => Err(InsertionError::rejected(format!(
            "Unknown insertion strategy: {preferred}"
        ))),
    }
}

pub fn insert_text(text: &str, preferred: &str) -> Result<InsertionResult, InsertionError> {
    if text.is_empty() || text.len() > 100_000 {
        return Err(InsertionError::rejected(
            "Insertion requires 1 to 100,000 UTF-8 bytes.",
        ));
    }
    deliver_with(
        parse_requested_strategy(preferred)?,
        || type_simulation(text),
        || clipboard_paste(text),
    )
}

fn deliver_with(
    requested: RequestedStrategy,
    type_text: impl FnOnce() -> Result<ActiveStrategy, InsertionError>,
    paste_text: impl FnOnce() -> Result<(), InsertionError>,
) -> Result<InsertionResult, InsertionError> {
    let strategy = match requested {
        RequestedStrategy::Auto => match type_text() {
            Ok(strategy) => strategy,
            // Only an operation known not to have started can authorize trying
            // the entire transcript through another route.
            Err(error) if error.outcome == DeliveryOutcome::NoMutation => {
                paste_text()?;
                ActiveStrategy::Clipboard
            }
            Err(error) => return Err(error),
        },
        RequestedStrategy::Clipboard => {
            paste_text()?;
            ActiveStrategy::Clipboard
        }
        RequestedStrategy::TypeSimulation => type_text()?,
    };
    Ok(InsertionResult {
        paste_metrics: None,
        strategy,
        outcome: "dispatched",
    })
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

fn typing_timeout(text: &str, wayland: bool) -> Duration {
    // Account for the configured per-key delay while bounding an unresponsive
    // helper. Long dictations should use owned input-method delivery.
    let per_character_ms = if wayland { 8 } else { 32 };
    Duration::from_millis((5_000 + text.chars().count() as u64 * per_character_ms).min(180_000))
}

fn type_simulation(text: &str) -> Result<ActiveStrategy, InsertionError> {
    let wayland = is_wayland();
    let (program, arguments, strategy) = if wayland {
        (
            "ydotool",
            vec!["type", "--key-delay", "2", "--", text],
            ActiveStrategy::Ydotool,
        )
    } else {
        (
            "xdotool",
            vec!["type", "--clearmodifiers", "--delay", "12", "--", text],
            ActiveStrategy::Xdotool,
        )
    };
    let mut command = process_runner::command(program);
    command.args(arguments);
    run_helper(&mut command, None, typing_timeout(text, wayland))?;
    Ok(strategy)
}

fn clipboard_paste(text: &str) -> Result<(), InsertionError> {
    clipboard_paste_with_shortcut(text, false).map(|_| ())
}

fn clipboard_paste_with_shortcut(
    text: &str,
    terminal: bool,
) -> Result<PasteMetrics, InsertionError> {
    let started = Instant::now();
    let wayland = is_wayland();
    let diagnostics = runtime_diagnostics();
    if !diagnostics.clipboard.available {
        return Err(InsertionError::no_mutation(diagnostics.clipboard.detail));
    }
    // Detect the installed CLI before replacing clipboard contents. Ubuntu's
    // legacy ydotool takes chord names; newer releases take keycode events.
    let (payload, leading_separator) = desktop_paste_payload(text);
    let wayland_args = if wayland {
        let mut args = wayland_paste_arguments()?;
        if terminal {
            if args.last() == Some(&"ctrl+v") {
                *args.last_mut().unwrap() = "ctrl+shift+v";
            } else {
                args = vec!["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"];
            }
        }
        if leading_separator {
            if args.iter().any(|arg| arg.starts_with("ctrl+")) {
                args.insert(args.len() - 1, "space");
            } else {
                args.splice(1..1, ["57:1", "57:0"]);
            }
        }
        Some(args)
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
            "ydotool",
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
    let (clipboard_ms, keyboard_ms) = clipboard_transaction(payload, &mut copy, &mut paste)?;
    Ok(PasteMetrics {
        terminal,
        target_probe_ms: 0,
        preflight_ms,
        clipboard_ms,
        keyboard_ms,
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

fn paste_arguments_from_help(help: &str) -> Result<Vec<&'static str>, InsertionError> {
    if help.contains("Each key sequence") && help.contains("ctrl+Backspace") {
        Ok(vec!["key", "--key-delay", "12", "ctrl+v"])
    } else if help.contains("Syntax: <keycode>:<pressed>") {
        Ok(vec!["key", "29:1", "47:1", "47:0", "29:0"])
    } else {
        Err(InsertionError::rejected("The installed ydotool key interface is unsupported; no clipboard or keyboard action was performed."))
    }
}

fn wayland_paste_arguments() -> Result<Vec<&'static str>, InsertionError> {
    if !process_running("ydotoold") {
        return Err(InsertionError::rejected(
            "Start the ydotoold desktop input service before dictating.",
        ));
    }
    let child = process_runner::command("ydotool")
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
    paste_arguments_from_help(&help)
}

fn clipboard_transaction(
    text: &str,
    copy: &mut Command,
    paste: &mut Command,
) -> Result<(u64, u64), InsertionError> {
    let copy_started = Instant::now();
    run_helper(copy, Some(text.as_bytes()), Duration::from_secs(5)).map_err(|mut error| {
        error.clipboard_changed = error.outcome == DeliveryOutcome::Uncertain;
        error
    })?;

    let clipboard_ms = copy_started.elapsed().as_millis() as u64;
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
    fn terminal_paste_preserves_unicode_without_control_keys_or_line_submission() {
        assert_eq!(
            terminal_paste_text("café\n你好\r\t\u{1b}text"),
            "café 你好   text"
        );
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
            vec!["key", "--key-delay", "12", "ctrl+v"]
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
    fn structured_outcome_serialization_is_stable() {
        let error = InsertionError::uncertain("partial delivery");
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["outcome"], "uncertain");
        assert_eq!(json["clipboardChanged"], false);
        assert_eq!(
            serde_json::to_string(&ActiveStrategy::Ydotool).unwrap(),
            r#""ydotool""#
        );
    }

    #[test]
    fn uncertain_partial_write_never_retries_full_transcript() {
        let pasted = Cell::new(false);
        let result = deliver_with(
            RequestedStrategy::Auto,
            || Err(InsertionError::uncertain("helper typed abc before failing")),
            || {
                pasted.set(true);
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err().outcome, DeliveryOutcome::Uncertain);
        assert!(!pasted.get());
    }

    #[test]
    fn only_proven_no_mutation_allows_auto_fallback() {
        let pasted = Cell::new(false);
        let result = deliver_with(
            RequestedStrategy::Auto,
            || Err(InsertionError::no_mutation("spawn failed")),
            || {
                pasted.set(true);
                Ok(())
            },
        )
        .unwrap();
        assert!(pasted.get());
        assert_eq!(result.outcome, "dispatched");
        assert!(matches!(result.strategy, ActiveStrategy::Clipboard));
        assert!(deliver_with(
            RequestedStrategy::Auto,
            || Err(InsertionError::rejected("invalid target")),
            || panic!("rejected delivery cannot authorize a retry")
        )
        .is_err());
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
        clipboard_transaction("intended transcript\n", &mut copy, &mut paste).unwrap();
        assert_eq!(std::fs::read(&consumed).unwrap(), b"intended transcript\n");
        assert_eq!(std::fs::read(&clipboard).unwrap(), b"new user copy");
        std::fs::remove_file(clipboard).unwrap();
        std::fs::remove_file(consumed).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn failed_paste_after_copy_is_uncertain_even_if_paste_never_spawned() {
        let mut copy = process_runner::command("/bin/cat");
        let mut paste = process_runner::command("/definitely-missing-voco-test-helper");
        let error = clipboard_transaction("transcript", &mut copy, &mut paste).unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Uncertain);
        assert!(error.clipboard_changed);
    }

    #[test]
    fn typing_deadline_accounts_for_length_but_is_bounded() {
        assert!(typing_timeout("longer text", false) > typing_timeout("x", false));
        assert_eq!(
            typing_timeout(&"x".repeat(100_000), false),
            Duration::from_secs(180)
        );
    }

    #[test]
    fn parse_requested_strategy_accepts_known_values_and_rejects_unknown() {
        assert!(matches!(
            parse_requested_strategy("auto"),
            Ok(RequestedStrategy::Auto)
        ));
        assert!(matches!(
            parse_requested_strategy("clipboard"),
            Ok(RequestedStrategy::Clipboard)
        ));
        assert!(matches!(
            parse_requested_strategy("type-simulation"),
            Ok(RequestedStrategy::TypeSimulation)
        ));
        assert_eq!(
            parse_requested_strategy("surprise-mode")
                .unwrap_err()
                .outcome,
            DeliveryOutcome::Rejected
        );
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
