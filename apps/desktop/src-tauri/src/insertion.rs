use log::warn;
use std::io::Write;
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

fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").unwrap_or_default() == "wayland"
}

pub fn insert_text(text: &str, preferred: &str) -> Result<InsertionResult, String> {
    match preferred {
        "auto" | "type-simulation" => {
            if is_wayland() {
                if try_ydotool(text) {
                    return Ok(InsertionResult {
                        strategy: ActiveStrategy::Ydotool,
                    });
                }
                warn!("ydotool type failed, falling back to clipboard paste");
            } else {
                if try_xdotool(text) {
                    return Ok(InsertionResult {
                        strategy: ActiveStrategy::Xdotool,
                    });
                }
                warn!("xdotool type failed, falling back to clipboard paste");
            }
            clipboard_paste(text)?;
            Ok(InsertionResult {
                strategy: ActiveStrategy::Clipboard,
            })
        }
        _ => {
            clipboard_paste(text)?;
            Ok(InsertionResult {
                strategy: ActiveStrategy::Clipboard,
            })
        }
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
            return Err(
                "Failed to simulate paste on Wayland; transcript remains in clipboard.".to_string(),
            );
        }
    } else {
        let paste_ok = Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !paste_ok {
            return Err(
                "Failed to simulate paste on X11; transcript remains in clipboard.".to_string(),
            );
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
}
