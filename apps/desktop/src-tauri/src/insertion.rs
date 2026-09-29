use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::process_runner;

// One clipboard transaction at a time. The value is when the latest paste keys
// were sent: an application reads the clipboard only after its key event and no
// helper reports that read, so the next copy first waits for PASTE_SETTLE.
static DELIVERY: Mutex<Option<Instant>> = Mutex::new(None);
const PASTE_SETTLE: Duration = Duration::from_millis(150);
const MODIFIER_RELEASE_TIMEOUT: Duration = Duration::from_millis(1500);
const TEXT_MIME: &str = "text/plain;charset=utf-8";
const DAEMON_SETUP: &str = "Start VOCO's input service with `systemctl --user enable --now voco-ydotoold.service`, then check desktop setup again.";

// An X11 passive grab sends every key to VOCO while the dictation shortcut is
// held, the paste helper's keys included. The value is when the chord was
// pressed; a lost release expires after MODIFIER_RELEASE_TIMEOUT.
static X11_SHORTCUT_PRESSED: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, serde::Serialize)]
pub struct InsertionResult {
    #[serde(rename = "pasteMetrics")]
    pub paste_metrics: PasteMetrics,
    /// Helpers acknowledge dispatch, not receipt by the focused application.
    pub outcome: &'static str,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteMetrics {
    pub preflight_ms: u64,
    pub settle_ms: u64,
    pub modifier_wait_ms: u64,
    pub clipboard_ms: u64,
    pub keyboard_ms: u64,
    pub leading_separator: bool,
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
    correlation: Option<&PasteCorrelation>,
) -> Result<InsertionResult, InsertionError> {
    let started = Instant::now();
    let result = desktop_paste(text);
    if let Some(correlation) = correlation {
        let mut record = serde_json::json!({"event":"native_dispatch", "session":correlation.session,
            "dictation_session_id":correlation.dictation_session_id,
            "delivery_seq":correlation.delivery_seq, "hypothesis_seq":correlation.hypothesis_seq,
            "duration_ms":started.elapsed().as_secs_f64() * 1000.0});
        add_text_lengths(&mut record, "input", text);
        match &result {
            Ok(result) => {
                let metrics = &result.paste_metrics;
                record["outcome"] = serde_json::json!("dispatched");
                record["settle_ms"] = serde_json::json!(metrics.settle_ms);
                record["modifier_wait_ms"] = serde_json::json!(metrics.modifier_wait_ms);
                record["leading_separator"] = serde_json::json!(metrics.leading_separator);
                record["routed_utf8_bytes"] = serde_json::json!(metrics.routed_utf8_bytes);
                record["payload_utf8_bytes"] = serde_json::json!(metrics.payload_utf8_bytes);
                record["payload_unicode_scalars"] =
                    serde_json::json!(metrics.payload_unicode_scalars);
                record["payload_utf16_units"] = serde_json::json!(metrics.payload_utf16_units);
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_area: Option<&'static str>,
}

/// Check input prerequisites without touching the clipboard or sending keys.
/// Onboarding must remain local even while checking readiness for later dictation.
pub fn desktop_input_status() -> DesktopInputStatus {
    if !desktop_paste_enabled() {
        return DesktopInputStatus {
            available: false,
            detail: "Desktop paste is not enabled.".into(),
            setup_area: None,
        };
    }
    let preflight = input_preflight();
    let support = preflight.diagnostics.clipboard;
    let compatibility = if !support.available {
        Err(InsertionError::rejected(support.detail))
    } else if matches!(preflight.session, SessionKind::Wayland) {
        wayland_paste_arguments().map(|_| ())
    } else {
        Ok(())
    };
    match compatibility {
        Ok(()) => DesktopInputStatus {
            available: true,
            detail: "Desktop input helpers are ready. VOCO pastes into whichever app has keyboard focus.".into(),
            setup_area: None,
        },
        Err(error) => DesktopInputStatus {
            available: false,
            detail: error.message,
            setup_area: None,
        },
    }
}

pub fn desktop_paste_diagnostics() -> (DesktopInputStatus, DesktopPasteStatus) {
    let input = desktop_input_status();
    let paste = DesktopPasteStatus {
        streaming_enabled: input.available && desktop_stream_enabled(),
        enabled: desktop_paste_enabled(),
        available: input.available,
        detail: input.detail.clone(),
    };
    (input, paste)
}

fn validate_text(text: &str) -> Result<(), InsertionError> {
    if !desktop_paste_enabled() {
        return Err(InsertionError::rejected("Desktop paste is not enabled."));
    }
    if text.is_empty() || text.len() > 100_000 {
        return Err(InsertionError::rejected(
            "Paste requires between 1 and 100000 UTF-8 bytes.",
        ));
    }
    Ok(())
}

fn delivery_slot() -> MutexGuard<'static, Option<Instant>> {
    // The slot holds only a timestamp; a panicked delivery cannot corrupt it.
    DELIVERY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

/// Give the previous recipient time to read the clipboard before replacing it.
fn settle(last_paste: Option<Instant>) -> u64 {
    let wait = last_paste.map_or(Duration::ZERO, |sent| {
        PASTE_SETTLE.saturating_sub(sent.elapsed())
    });
    if !wait.is_zero() {
        std::thread::sleep(wait);
    }
    wait.as_millis() as u64
}

/// Paste into whichever application has keyboard focus. Shift+Insert is the
/// paste key shared by GTK, Qt, Chromium, Firefox, Electron and terminal
/// emulators. Terminals paste PRIMARY, so both selections get the same text.
pub fn desktop_paste(text: &str) -> Result<InsertionResult, InsertionError> {
    validate_text(text)?;
    let mut last_paste = delivery_slot();
    let started = Instant::now();
    let preflight = input_preflight();
    if !preflight.diagnostics.clipboard.available {
        return Err(InsertionError::no_mutation(
            preflight.diagnostics.clipboard.detail,
        ));
    }
    let wayland = matches!(preflight.session, SessionKind::Wayland);
    let routed = paste_text(text);
    let (payload, leading_separator) = desktop_paste_payload(&routed);
    // Detect the installed CLI before replacing clipboard contents. Ubuntu's
    // legacy ydotool takes chord names; newer releases take keycode events.
    let keys = if wayland {
        wayland_clipboard_arguments(wayland_paste_arguments()?, leading_separator)
    } else {
        x11_paste_arguments(leading_separator)
    };
    let mut paste = process_runner::command(if wayland { SYSTEM_YDOTOOL } else { "xdotool" });
    paste.args(&keys);
    let (mut clipboard, mut primary) = copy_commands();
    let preflight_ms = elapsed_ms(started);
    let settle_ms = settle(*last_paste);
    let mut modifier_wait_ms = 0;
    // Wayland helpers emit raw key events: a still-held shortcut modifier would
    // turn Shift+Insert into another chord. xdotool clears modifiers itself, but
    // X11 delivers its keys to VOCO's grab until the shortcut is released.
    let held: fn() -> Option<bool> = if wayland {
        shortcut_modifiers_held
    } else {
        x11_shortcut_held
    };
    let result = clipboard_transaction(payload, &mut clipboard, &mut primary, &mut paste, || {
        modifier_wait_ms = wait_for_modifier_release(MODIFIER_RELEASE_TIMEOUT, held)?;
        Ok(())
    });
    // Also after an uncertain failure: the helper may have sent the keys.
    *last_paste = Some(Instant::now());
    let (clipboard_ms, keyboard_ms) = result?;
    Ok(InsertionResult {
        paste_metrics: PasteMetrics {
            preflight_ms,
            settle_ms,
            modifier_wait_ms,
            clipboard_ms,
            keyboard_ms,
            leading_separator,
            routed_utf8_bytes: routed.len(),
            payload_utf8_bytes: payload.len(),
            payload_unicode_scalars: payload.chars().count(),
            payload_utf16_units: payload.encode_utf16().count(),
        },
        outcome: "dispatched",
    })
}

/// Put undelivered dictation on the clipboard without sending keys, so the
/// person can paste it where they choose.
pub fn copy_desktop_text(text: &str) -> Result<(), InsertionError> {
    validate_text(text)?;
    let helper = desktop_clipboard_helper();
    if !command_available(helper) {
        return Err(InsertionError::no_mutation(format!(
            "Copying dictation requires {helper}."
        )));
    }
    let last_paste = delivery_slot();
    settle(*last_paste);
    let (mut clipboard, mut primary) = copy_commands();
    copy_selections(&paste_text(text), &mut clipboard, &mut primary)
}

/// Unknown state never blocks delivery: evdev may lack permission, and other
/// desktops have no companion to ask.
fn shortcut_modifiers_held() -> Option<bool> {
    crate::evdev_modifiers_held().or_else(|| {
        crate::panel::is_attached()
            .then(crate::panel::paste_modifiers_clear)
            .and_then(Result::ok)
            .map(|clear| !clear)
    })
}

/// The X11 shortcut callback reports each press and release of the chord.
pub fn note_x11_shortcut(pressed: bool) {
    *X11_SHORTCUT_PRESSED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = pressed.then(Instant::now);
}

fn x11_shortcut_held() -> Option<bool> {
    let pressed = *X11_SHORTCUT_PRESSED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Some(pressed.is_some_and(|at| at.elapsed() < MODIFIER_RELEASE_TIMEOUT))
}

fn wait_for_modifier_release(
    timeout: Duration,
    mut held: impl FnMut() -> Option<bool>,
) -> Result<u64, InsertionError> {
    let started = Instant::now();
    while held() == Some(true) {
        if started.elapsed() >= timeout {
            return Err(InsertionError::no_mutation(
                "Release the keyboard modifiers before dictating; no paste keys were sent.",
            ));
        }
        std::thread::sleep(Duration::from_millis(8));
    }
    Ok(elapsed_ms(started))
}

fn paste_text(text: &str) -> String {
    // The focused app may be a terminal: never send control sequences or a
    // line ending that could submit a command.
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

fn build_support(
    required_commands: &[&str],
    success_detail: &str,
    failure_detail: impl FnOnce(&[String]) -> String,
    command_is_available: impl Fn(&str) -> bool,
) -> InsertionSupport {
    let required_commands = required_commands
        .iter()
        .map(|command| (*command).to_string())
        .collect::<Vec<_>>();
    let missing_commands = required_commands
        .iter()
        .filter(|command| !command_is_available(command))
        .cloned()
        .collect::<Vec<_>>();
    let available = missing_commands.is_empty();
    let detail = if available {
        success_detail.to_string()
    } else {
        failure_detail(&missing_commands)
    };

    InsertionSupport {
        available,
        required_commands,
        missing_commands,
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
    // One paste path: the clipboard helper copies, then the key helper sends
    // Shift+Insert. Wayland's key helper works only through its ydotoold service.
    let (session_name, keys): (&str, &[&str]) = match session {
        SessionKind::Wayland => ("Wayland", &["ydotool", "ydotoold"]),
        SessionKind::X11OrOther => ("X11-like sessions", &["xdotool"]),
    };
    let requires = |missing: &[String]| {
        let mut detail = format!(
            "Pasting on {session_name} requires: {}.",
            missing.join(", ")
        );
        if missing.iter().any(|command| command == "ydotoold") {
            detail = format!("{detail} {DAEMON_SETUP}");
        }
        detail
    };
    let type_simulation = build_support(
        keys,
        "Paste keys are ready. VOCO pastes into whichever app has keyboard focus.",
        requires,
        command_is_available,
    );
    let clipboard = build_support(
        &[&[clipboard_program], keys].concat(),
        "Clipboard paste replaces the clipboard and primary selection with the transcript and leaves it there. Automatic restoration is unavailable because these helpers cannot verify ownership or preserve all formats.",
        requires,
        command_is_available,
    );

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

fn copy_arguments(helper: &str, primary: bool) -> &'static [&'static str] {
    match (helper, primary) {
        ("wl-copy", false) => &["--type", TEXT_MIME],
        ("wl-copy", true) => &["--primary", "--type", TEXT_MIME],
        (_, false) => &["-selection", "clipboard", "-in"],
        (_, true) => &["-selection", "primary", "-in"],
    }
}

/// Commands that copy stdin to CLIPBOARD and to PRIMARY.
fn copy_commands() -> (Command, Command) {
    let helper = desktop_clipboard_helper();
    let command = |primary| {
        let mut command = process_runner::command(helper);
        command.args(copy_arguments(helper, primary));
        command
    };
    (command(false), command(true))
}

struct InputPreflight {
    session: SessionKind,
    diagnostics: RuntimeDiagnostics,
}

fn input_preflight_with(
    session: SessionKind,
    clipboard_helper: &str,
    available: impl Fn(&str) -> bool + Copy,
    probe_daemon: impl FnOnce() -> bool,
) -> InputPreflight {
    // Sample the daemon once for this operation and again on the next one. Only
    // a running daemon counts: the packaged service's private ydotoold is not on
    // PATH, and an installed daemon that is not running cannot paste.
    let daemon_running = matches!(session, SessionKind::Wayland) && probe_daemon();
    let diagnostics = runtime_diagnostics_with(session, clipboard_helper, |command| {
        if command == "ydotoold" {
            daemon_running
        } else {
            available(command)
        }
    });
    InputPreflight {
        session,
        diagnostics,
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

fn desktop_paste_payload(text: &str) -> (&str, bool) {
    // Chromium's address bar strips a pasted chunk's leading whitespace. Send
    // VOCO's single joining space as a key in the same ordered paste gesture.
    // Preserve other whitespace verbatim rather than normalizing user content.
    match text.strip_prefix(' ') {
        Some(rest) if rest.starts_with(|ch: char| !ch.is_whitespace()) => (rest, true),
        _ => (text, false),
    }
}

fn x11_paste_arguments(leading_separator: bool) -> Vec<&'static str> {
    let mut args = vec!["key", "--clearmodifiers"];
    if leading_separator {
        args.push("space");
    }
    args.push("shift+Insert");
    args
}

fn wayland_clipboard_arguments(
    mut args: Vec<&'static str>,
    leading_separator: bool,
) -> Vec<&'static str> {
    if leading_separator {
        if args.last() == Some(&"shift+insert") {
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
        // delay so the chord retains 6–12 ms between key events.
        Ok(vec![
            "key",
            "--delay",
            "24",
            "--key-delay",
            "12",
            "shift+insert",
        ])
    } else if help.contains("Syntax: <keycode>:<pressed>") {
        // KEY_LEFTSHIFT down, KEY_INSERT down and up, KEY_LEFTSHIFT up.
        Ok(vec!["key", "42:1", "110:1", "110:0", "42:0"])
    } else {
        Err(InsertionError::rejected("The installed ydotool key interface is unsupported; no clipboard or keyboard action was performed."))
    }
}

/// Callers check first that ydotoold is running.
fn wayland_paste_arguments() -> Result<Vec<&'static str>, InsertionError> {
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

/// GUI toolkits paste CLIPBOARD on Shift+Insert and terminals paste PRIMARY.
/// PRIMARY is best effort because some compositors do not provide it.
fn copy_selections(
    text: &str,
    clipboard: &mut Command,
    primary: &mut Command,
) -> Result<(), InsertionError> {
    run_helper(clipboard, Some(text.as_bytes()), Duration::from_secs(5)).map_err(|mut error| {
        error.clipboard_changed = error.outcome == DeliveryOutcome::Uncertain;
        error
    })?;
    if let Err(error) = run_helper(primary, Some(text.as_bytes()), Duration::from_secs(5)) {
        log::warn!("Could not update the primary selection: {error}");
    }
    Ok(())
}

fn clipboard_transaction(
    text: &str,
    clipboard: &mut Command,
    primary: &mut Command,
    paste: &mut Command,
    before_paste: impl FnOnce() -> Result<(), InsertionError>,
) -> Result<(u64, u64), InsertionError> {
    let copy_started = Instant::now();
    copy_selections(text, clipboard, primary)?;
    let clipboard_ms = elapsed_ms(copy_started);
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
        error.message.push_str(
            " The clipboard was changed. Check your text field before pasting to avoid duplicates.",
        );
        error
    })?;
    // Neither helper exposes atomic compare-and-restore, all MIME formats, or
    // a target consumption acknowledgement. Restoring after a sleep can erase
    // a newer copy or replace the data before a slow application reads it.
    Ok((clipboard_ms, elapsed_ms(paste_started)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn scratch_directory(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "voco-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        directory
    }

    fn copy_to(path: &Path) -> Command {
        let mut copy = process_runner::command("/bin/sh");
        copy.args(["-c", "cat > \"$1\"", "copy"]).arg(path);
        copy
    }

    #[test]
    fn paste_waits_for_modifier_release_and_unknown_state_never_blocks() {
        let mut samples = [Some(true), Some(true), Some(false)].into_iter();
        wait_for_modifier_release(Duration::from_secs(1), || samples.next().unwrap()).unwrap();
        assert!(samples.next().is_none());
        wait_for_modifier_release(Duration::ZERO, || None).unwrap();
        let error = wait_for_modifier_release(Duration::ZERO, || Some(true)).unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::NoMutation);
        assert!(!error.clipboard_changed);
    }

    #[test]
    fn x11_paste_waits_for_the_shortcut_release_but_not_for_a_lost_one() {
        note_x11_shortcut(true);
        assert_eq!(x11_shortcut_held(), Some(true));
        note_x11_shortcut(false);
        assert_eq!(x11_shortcut_held(), Some(false));
        *X11_SHORTCUT_PRESSED.lock().unwrap() =
            Instant::now().checked_sub(MODIFIER_RELEASE_TIMEOUT);
        assert_eq!(x11_shortcut_held(), Some(false));
    }

    #[test]
    fn next_copy_waits_only_for_the_remaining_settle_interval() {
        assert_eq!(settle(None), 0);
        assert_eq!(settle(Instant::now().checked_sub(PASTE_SETTLE)), 0);
        let started = Instant::now();
        settle(Some(started));
        assert!(started.elapsed() >= PASTE_SETTLE);
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
            x11_paste_arguments(false),
            ["key", "--clearmodifiers", "shift+Insert"]
        );
        assert_eq!(
            x11_paste_arguments(true),
            ["key", "--clearmodifiers", "space", "shift+Insert"]
        );
    }

    #[test]
    fn paste_text_preserves_unicode_without_control_keys_or_line_submission() {
        let routed = paste_text("café\n你好\r\t\u{1b}text");
        assert_eq!(routed, "café 你好   text");
        assert_eq!(routed.len(), "café\n你好\r\t\u{1b}text".len());
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
        assert!(first.diagnostics.clipboard.available);
        assert!(first.diagnostics.type_simulation.available);
        let second = input_preflight_with(SessionKind::Wayland, "xclip", |_| true, probe);
        assert_eq!(scans.get(), 2);
        // Paste cannot work without the daemon, so readiness must not claim it.
        for support in [
            &second.diagnostics.clipboard,
            &second.diagnostics.type_simulation,
        ] {
            assert!(!support.available);
            assert_eq!(support.missing_commands, ["ydotoold"]);
            assert!(support
                .detail
                .contains("systemctl --user enable --now voco-ydotoold.service"));
        }
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
        assert_eq!(
            x11.diagnostics.clipboard.required_commands,
            ["xclip", "xdotool"]
        );
        for missing in ["xclip", "ydotool", "ydotoold"] {
            for daemon_running in [false, true] {
                let actual = input_preflight_with(
                    SessionKind::Wayland,
                    "xclip",
                    |name| name != missing,
                    || daemon_running,
                );
                // The packaged daemon is not on PATH: only whether it runs counts.
                let expected = runtime_diagnostics_with(SessionKind::Wayland, "xclip", |name| {
                    if name == "ydotoold" {
                        daemon_running
                    } else {
                        name != missing
                    }
                });
                assert_eq!(
                    serde_json::to_value(actual.diagnostics).unwrap(),
                    serde_json::to_value(expected).unwrap()
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
        assert_eq!(
            ready.clipboard.required_commands,
            vec!["xclip", "ydotool", "ydotoold"]
        );
    }

    #[test]
    fn both_selections_receive_the_text() {
        assert_eq!(
            copy_arguments("xclip", false),
            &["-selection", "clipboard", "-in"]
        );
        assert_eq!(
            copy_arguments("xclip", true),
            &["-selection", "primary", "-in"]
        );
        assert_eq!(copy_arguments("wl-copy", false), &["--type", TEXT_MIME]);
        assert_eq!(
            copy_arguments("wl-copy", true),
            &["--primary", "--type", TEXT_MIME]
        );
    }

    #[test]
    fn clipboard_gesture_matches_installed_ydotool_generation() {
        assert_eq!(
            paste_arguments_from_help("Each key sequence ctrl+Backspace").unwrap(),
            vec!["key", "--delay", "24", "--key-delay", "12", "shift+insert"]
        );
        assert_eq!(
            paste_arguments_from_help("Syntax: <keycode>:<pressed>").unwrap(),
            vec!["key", "42:1", "110:1", "110:0", "42:0"]
        );
        let error = paste_arguments_from_help("unknown helper").unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Rejected);
        assert!(!error.clipboard_changed);
    }

    #[test]
    fn wayland_separator_matches_both_helper_interfaces() {
        let legacy = || paste_arguments_from_help("Each key sequence ctrl+Backspace").unwrap();
        assert_eq!(wayland_clipboard_arguments(legacy(), false), legacy());
        assert_eq!(
            wayland_clipboard_arguments(legacy(), true),
            [
                "key",
                "--delay",
                "24",
                "--key-delay",
                "12",
                " ",
                "shift+insert"
            ]
        );
        let modern = || paste_arguments_from_help("Syntax: <keycode>:<pressed>").unwrap();
        assert_eq!(wayland_clipboard_arguments(modern(), false), modern());
        assert_eq!(
            wayland_clipboard_arguments(modern(), true),
            ["key", "57:1", "57:0", "42:1", "110:1", "110:0", "42:0"]
        );
    }

    #[test]
    fn structured_outcome_serialization_is_stable() {
        let error = InsertionError::uncertain("partial delivery");
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["outcome"], "uncertain");
        assert_eq!(json["clipboardChanged"], false);
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
        let directory = scratch_directory("clipboard-test");
        let clipboard = directory.join("clipboard");
        let primary = directory.join("primary");
        let consumed = directory.join("consumed");
        std::fs::write(&clipboard, b"old text").unwrap();
        let mut paste = process_runner::command("/bin/sh");
        paste
            .args([
                "-c",
                "sleep 0.05; cp \"$1\" \"$2\"; printf 'new user copy' > \"$1\"",
                "paste",
            ])
            .arg(&clipboard)
            .arg(&consumed);
        clipboard_transaction(
            "intended transcript\n",
            &mut copy_to(&clipboard),
            &mut copy_to(&primary),
            &mut paste,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(std::fs::read(&consumed).unwrap(), b"intended transcript\n");
        assert_eq!(std::fs::read(&primary).unwrap(), b"intended transcript\n");
        assert_eq!(std::fs::read(&clipboard).unwrap(), b"new user copy");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn missing_primary_selection_does_not_block_the_paste() {
        let directory = scratch_directory("primary-test");
        let clipboard = directory.join("clipboard");
        let consumed = directory.join("consumed");
        let mut paste = process_runner::command("/bin/sh");
        paste
            .args(["-c", "cp \"$1\" \"$2\"", "paste"])
            .arg(&clipboard)
            .arg(&consumed);
        let result = clipboard_transaction(
            "Synthetic phrase.",
            &mut copy_to(&clipboard),
            &mut process_runner::command("/definitely-missing-voco-test-helper"),
            &mut paste,
            || Ok(()),
        );
        let delivered = std::fs::read(&consumed);
        std::fs::remove_dir_all(directory).unwrap();
        result.unwrap();
        assert_eq!(delivered.unwrap(), b"Synthetic phrase.");
    }

    #[test]
    fn held_modifiers_after_copy_block_keyboard_dispatch() {
        let directory = scratch_directory("before-paste-test");
        let clipboard = directory.join("clipboard");
        let consumed = directory.join("wrong-chord");
        let mut paste = process_runner::command("/bin/sh");
        paste
            .args(["-c", "cp \"$1\" \"$2\"", "paste"])
            .arg(&clipboard)
            .arg(&consumed);
        let result = clipboard_transaction(
            "Synthetic phrase.",
            &mut copy_to(&clipboard),
            &mut copy_to(&directory.join("primary")),
            &mut paste,
            || {
                assert_eq!(std::fs::read(&clipboard).unwrap(), b"Synthetic phrase.");
                wait_for_modifier_release(Duration::ZERO, || Some(true)).map(|_| ())
            },
        );
        let keyboard_was_dispatched = consumed.exists();
        std::fs::remove_dir_all(directory).unwrap();
        let error = result.unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::NoMutation);
        assert!(error.clipboard_changed);
        assert!(!keyboard_was_dispatched);
    }

    #[test]
    fn failed_paste_after_copy_is_uncertain_even_if_paste_never_spawned() {
        let mut clipboard = process_runner::command("/bin/cat");
        let mut primary = process_runner::command("/bin/cat");
        let mut paste = process_runner::command("/definitely-missing-voco-test-helper");
        let error = clipboard_transaction(
            "transcript",
            &mut clipboard,
            &mut primary,
            &mut paste,
            || Ok(()),
        )
        .unwrap_err();
        assert_eq!(error.outcome, DeliveryOutcome::Uncertain);
        assert!(error.clipboard_changed);
    }

    #[test]
    fn diagnostics_distinguish_helpers_from_verified_delivery_and_no_restore() {
        let diagnostics = runtime_diagnostics_with(SessionKind::Wayland, "wl-copy", |command| {
            matches!(command, "ydotool" | "ydotoold" | "wl-copy")
        });
        assert!(diagnostics.clipboard.available);
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

    /// Application-delivery fixtures run this production paste against real
    /// applications on a private display; it replaces the clipboard there.
    #[test]
    #[ignore = "Explicit fixture text and a private desktop session are required"]
    fn paste_fixture_text_into_the_focused_application() {
        let text = std::env::var("VOCO_FIXTURE_PASTE_TEXT").expect("explicit fixture text");
        assert!(
            !Path::new("/dev/input").exists(),
            "Run only in a private desktop namespace"
        );
        let result = desktop_paste(&text).unwrap();
        assert_eq!(result.outcome, "dispatched");
    }
}
