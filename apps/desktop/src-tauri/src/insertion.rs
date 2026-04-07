use log::warn;
use std::io::Write;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActiveStrategy {
    Ydotool,
    Xdotool,
    Clipboard,
}

#[derive(Debug, serde::Serialize)]
pub struct InsertionResult {
    pub strategy: ActiveStrategy,
}

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

fn runtime_diagnostics_with<F>(session: SessionKind, command_is_available: F) -> RuntimeDiagnostics
where
    F: Fn(&str) -> bool + Copy,
{
    let type_simulation = match session {
        SessionKind::Wayland => build_support(
            &["ydotool"],
            &[],
            |_| "Direct type simulation is ready on Wayland.".to_string(),
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
            |_| "Direct type simulation is ready on X11-like sessions.".to_string(),
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
            &["wl-copy", "ydotool"],
            &["wl-paste"],
            |optional_missing| {
                if optional_missing.is_empty() {
                    "Clipboard insertion and clipboard restoration are ready on Wayland."
                        .to_string()
                } else {
                    "Clipboard insertion is ready on Wayland, but clipboard restoration is unavailable until wl-paste is installed."
                        .to_string()
                }
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
            |_| "Clipboard insertion is ready on X11-like sessions.".to_string(),
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

pub fn runtime_diagnostics() -> RuntimeDiagnostics {
    runtime_diagnostics_with(session_kind(), command_available)
}

fn parse_requested_strategy(preferred: &str) -> Result<RequestedStrategy, String> {
    match preferred {
        "auto" => Ok(RequestedStrategy::Auto),
        "clipboard" => Ok(RequestedStrategy::Clipboard),
        "type-simulation" => Ok(RequestedStrategy::TypeSimulation),
        _ => Err(format!("Unknown insertion strategy: {preferred}")),
    }
}

pub fn insert_text(text: &str, preferred: &str) -> Result<InsertionResult, String> {
    match parse_requested_strategy(preferred)? {
        RequestedStrategy::Auto => {
            if let Some(strategy) = try_type_simulation(text) {
                return Ok(InsertionResult { strategy });
            }

            warn!("type simulation failed, falling back to clipboard paste");
            clipboard_paste(text)?;
            Ok(InsertionResult {
                strategy: ActiveStrategy::Clipboard,
            })
        }
        RequestedStrategy::Clipboard => {
            clipboard_paste(text)?;
            Ok(InsertionResult {
                strategy: ActiveStrategy::Clipboard,
            })
        }
        RequestedStrategy::TypeSimulation => try_type_simulation(text)
            .map(|strategy| InsertionResult { strategy })
            .ok_or_else(type_simulation_error),
    }
}

fn try_ydotool(text: &str) -> bool {
    Command::new("ydotool")
        .arg("type")
        .arg("--")
        .arg(text)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn try_xdotool(text: &str) -> bool {
    Command::new("xdotool")
        .arg("type")
        .arg("--clearmodifiers")
        .arg("--delay")
        .arg("12")
        .arg("--")
        .arg(text)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn try_type_simulation(text: &str) -> Option<ActiveStrategy> {
    if is_wayland() {
        if try_ydotool(text) {
            return Some(ActiveStrategy::Ydotool);
        }
        warn!("ydotool type failed");
    } else {
        if try_xdotool(text) {
            return Some(ActiveStrategy::Xdotool);
        }
        warn!("xdotool type failed");
    }

    None
}

fn type_simulation_error() -> String {
    let diagnostics = runtime_diagnostics();
    let support = diagnostics.type_simulation;
    if support.available {
        if diagnostics.session_type == "wayland" {
            "Type simulation failed on Wayland. Check ydotool/ydotoold and compositor support, or switch to clipboard insertion."
                .to_string()
        } else {
            "Type simulation failed on X11-like sessions. Check xdotool, window focus, and accessibility permissions."
                .to_string()
        }
    } else {
        format!(
            "{} Switch to clipboard insertion or install the missing helper(s).",
            support.detail
        )
    }
}

fn clipboard_error() -> String {
    let diagnostics = runtime_diagnostics();
    let support = diagnostics.clipboard;
    if support.available {
        if diagnostics.session_type == "wayland" {
            "Clipboard insertion failed on Wayland. Check wl-copy, ydotool/ydotoold, and compositor support."
                .to_string()
        } else {
            "Clipboard insertion failed on X11-like sessions. Check xclip, xdotool, and window focus."
                .to_string()
        }
    } else {
        support.detail
    }
}

/// Pipe bytes into a command's stdin.
fn pipe_to_command(cmd: &str, args: &[&str], data: &[u8]) -> Result<(), String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(data)
            .map_err(|e| format!("Failed to write to {cmd}: {e}"))?;
    }
    let status = child
        .wait()
        .map_err(|e| format!("{cmd} failed while waiting for completion: {e}"))?;
    if !status.success() {
        return Err(format!("{cmd} exited with status {status}"));
    }
    Ok(())
}

fn read_clipboard(cmd: &str, args: &[&str]) -> Option<Vec<u8>> {
    Command::new(cmd)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success() && !o.stdout.is_empty())
        .map(|o| o.stdout)
}

fn clipboard_paste(text: &str) -> Result<(), String> {
    let wayland = is_wayland();
    let diagnostics = runtime_diagnostics();
    if !diagnostics.clipboard.available {
        return Err(diagnostics.clipboard.detail);
    }

    let old = if wayland {
        read_clipboard("wl-paste", &["--no-newline"])
    } else {
        read_clipboard("xclip", &["-selection", "clipboard", "-o"])
    };

    if wayland {
        pipe_to_command("wl-copy", &[], text.as_bytes())?;
    } else {
        pipe_to_command("xclip", &["-selection", "clipboard"], text.as_bytes())?;
    }

    std::thread::sleep(std::time::Duration::from_millis(50));
    if wayland {
        let paste_ok = Command::new("ydotool")
            .args(["key", "29:1", "47:1", "47:0", "29:0"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !paste_ok {
            return Err(format!(
                "{} Transcript remains in clipboard.",
                clipboard_error()
            ));
        }
    } else {
        let paste_ok = Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !paste_ok {
            return Err(format!(
                "{} Transcript remains in clipboard.",
                clipboard_error()
            ));
        }
    }

    // Restore clipboard after target app has consumed the paste
    std::thread::sleep(std::time::Duration::from_millis(300));
    if let Some(old_data) = old {
        let (cmd, args): (&str, &[&str]) = if wayland {
            ("wl-copy", &[])
        } else {
            ("xclip", &["-selection", "clipboard"])
        };
        let _ = pipe_to_command(cmd, args, &old_data);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_strategy_serializes_kebab_case() {
        let json = serde_json::to_string(&ActiveStrategy::Ydotool).unwrap();
        assert_eq!(json, r#""ydotool""#);
        let json = serde_json::to_string(&ActiveStrategy::Clipboard).unwrap();
        assert_eq!(json, r#""clipboard""#);
    }

    #[test]
    fn is_wayland_returns_bool() {
        let _ = is_wayland();
    }

    #[test]
    fn pipe_to_command_returns_error_for_nonzero_exit() {
        let result = pipe_to_command("sh", &["-c", "exit 3"], b"");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exited with status"));
    }

    #[test]
    fn parse_requested_strategy_accepts_known_values() {
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
    }

    #[test]
    fn parse_requested_strategy_rejects_unknown_values() {
        let result = parse_requested_strategy("surprise-mode");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown insertion strategy"));
    }

    #[test]
    fn runtime_diagnostics_reports_wayland_requirements() {
        let diagnostics =
            runtime_diagnostics_with(SessionKind::Wayland, |command| command == "ydotool");
        assert_eq!(diagnostics.session_type, "wayland");
        assert!(diagnostics.type_simulation.available);
        assert!(!diagnostics.clipboard.available);
        assert_eq!(
            diagnostics.clipboard.missing_commands,
            vec!["wl-copy".to_string()]
        );
    }

    #[test]
    fn runtime_diagnostics_marks_optional_wayland_clipboard_restore_helper() {
        let diagnostics = runtime_diagnostics_with(SessionKind::Wayland, |command| {
            matches!(command, "ydotool" | "wl-copy")
        });
        assert!(diagnostics.clipboard.available);
        assert_eq!(
            diagnostics.clipboard.optional_missing_commands,
            vec!["wl-paste".to_string()]
        );
    }

    #[test]
    fn runtime_diagnostics_reports_x11_requirements() {
        let diagnostics =
            runtime_diagnostics_with(SessionKind::X11OrOther, |command| command == "xdotool");
        assert_eq!(diagnostics.session_type, "x11-or-other");
        assert!(diagnostics.type_simulation.available);
        assert!(!diagnostics.clipboard.available);
        assert_eq!(
            diagnostics.clipboard.missing_commands,
            vec!["xclip".to_string()]
        );
    }
}
