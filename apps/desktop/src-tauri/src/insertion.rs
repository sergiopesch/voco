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

pub struct InsertionResult {
    pub strategy: ActiveStrategy,
    pub success: bool,
}

fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").unwrap_or_default() == "wayland"
}

pub fn insert_text(text: &str, preferred: &str) -> Result<InsertionResult, String> {
    match preferred {
        "auto" | "type-simulation" => {
            if is_wayland() {
                if try_ydotool(text) {
                    return Ok(InsertionResult { strategy: ActiveStrategy::Ydotool, success: true });
                }
                warn!("ydotool type failed, falling back to clipboard paste");
            } else {
                if try_xdotool(text) {
                    return Ok(InsertionResult { strategy: ActiveStrategy::Xdotool, success: true });
                }
                warn!("xdotool type failed, falling back to clipboard paste");
            }
            clipboard_paste(text)?;
            Ok(InsertionResult { strategy: ActiveStrategy::Clipboard, success: true })
        }
        _ => {
            clipboard_paste(text)?;
            Ok(InsertionResult { strategy: ActiveStrategy::Clipboard, success: true })
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

/// Pipe bytes into a command's stdin. Returns error description on failure.
fn pipe_to_command(cmd: &str, args: &[&str], data: &[u8]) -> Result<(), String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(data)
            .map_err(|e| format!("Failed to write to {cmd}: {e}"))?;
    }
    child.wait().map_err(|e| format!("{cmd} failed: {e}"))?;
    Ok(())
}

/// Read clipboard, returning content only if the command succeeds with non-empty output.
fn read_clipboard(cmd: &str, args: &[&str]) -> Option<Vec<u8>> {
    Command::new(cmd)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success() && !o.stdout.is_empty())
        .map(|o| o.stdout)
}

/// Restore clipboard contents, ignoring errors (best-effort).
fn restore_clipboard(cmd: &str, args: &[&str], data: &[u8]) {
    if let Ok(mut child) = Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(data);
        }
        let _ = child.wait();
    }
}

fn clipboard_paste(text: &str) -> Result<(), String> {
    let wayland = is_wayland();

    // Save current clipboard
    let old = if wayland {
        read_clipboard("wl-paste", &["--no-newline"])
    } else {
        read_clipboard("xclip", &["-selection", "clipboard", "-o"])
    };

    // Set clipboard to transcribed text
    if wayland {
        pipe_to_command("wl-copy", &[], text.as_bytes())?;
    } else {
        pipe_to_command("xclip", &["-selection", "clipboard"], text.as_bytes())?;
    }

    // Simulate Ctrl+V
    std::thread::sleep(std::time::Duration::from_millis(50));
    if wayland {
        let paste_ok = Command::new("ydotool")
            .args(["key", "29:1", "47:1", "47:0", "29:0"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !paste_ok {
            warn!("Warning: ydotool Ctrl+V failed — text is in clipboard, paste manually with Ctrl+V");
        }
    } else {
        let _ = Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .status();
    }

    // Restore clipboard after target app has consumed the paste
    std::thread::sleep(std::time::Duration::from_millis(300));
    if let Some(old_data) = old {
        if wayland {
            restore_clipboard("wl-copy", &[], &old_data);
        } else {
            restore_clipboard("xclip", &["-selection", "clipboard"], &old_data);
        }
    }

    Ok(())
}
