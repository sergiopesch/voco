//! Launcher activation has its own owner-only socket; it can never toggle capture.
use std::ffi::OsStr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;

static PENDING: AtomicBool = AtomicBool::new(false);

fn path() -> std::io::Result<std::path::PathBuf> {
    Ok(crate::trigger_socket::paths()?[0].with_file_name("voco-activate.sock"))
}

pub fn request() -> Result<(), String> {
    let path = path().map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match crate::trigger_socket::connect_trigger(&path) {
            Ok(()) => return Ok(()),
            Err(error) if Instant::now() < deadline && matches!(error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return Err("VOCO is running but could not receive the launcher request. Use its tray or panel menu, or quit and reopen VOCO after upgrading.".to_string()),
        }
    }
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let listener = crate::trigger_socket::bind(&path().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };
            if crate::trigger_socket::validate_peer(&stream).is_err() {
                continue;
            }
            PENDING.store(true, Ordering::SeqCst);
            crate::trace_hotkey_event("launcher_activation_requested", None);
            let _ = app.emit_to("main", "voco:activate", ());
        }
    });
    Ok(())
}

/// A click on VOCO's own launcher opens VOCO even when it wasn't running, as a
/// second launch does. GIO names the desktop entry it launched and that process's
/// ID. A program started from a terminal inherits the terminal's entry and ID, and
/// a login autostart carries DESKTOP_AUTOSTART_ID or an autostart entry, so those
/// leave VOCO in the tray. Call it before GTK starts, which removes
/// DESKTOP_AUTOSTART_ID.
pub fn note_launch() {
    let entry = std::env::var_os("GIO_LAUNCHED_DESKTOP_FILE");
    let pid = std::env::var_os("GIO_LAUNCHED_DESKTOP_FILE_PID");
    let autostart = std::env::var_os("DESKTOP_AUTOSTART_ID").is_some();
    if opened_by_launcher(
        entry.as_deref(),
        pid.as_deref(),
        autostart,
        std::process::id(),
    ) {
        PENDING.store(true, Ordering::SeqCst);
        crate::trace_hotkey_event("launcher_activation_requested", Some("launch"));
    }
}

fn opened_by_launcher(
    entry: Option<&OsStr>,
    pid: Option<&OsStr>,
    autostart: bool,
    own_pid: u32,
) -> bool {
    let (Some(entry), Some(pid)) = (entry, pid) else {
        return false;
    };
    let entry = Path::new(entry);
    !autostart
        && pid.to_str().and_then(|pid| pid.parse::<u32>().ok()) == Some(own_pid)
        && entry.file_name() == Some(OsStr::new("VOCO.desktop"))
        && !entry
            .components()
            .any(|part| part.as_os_str() == "autostart")
}

#[tauri::command]
pub fn take_launcher_activation() -> bool {
    PENDING.swap(false, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opened(entry: Option<&str>, pid: Option<&str>, autostart: bool) -> bool {
        opened_by_launcher(entry.map(OsStr::new), pid.map(OsStr::new), autostart, 4242)
    }

    #[test]
    fn only_voco_s_own_launcher_opens_it_at_start() {
        assert!(opened(
            Some("/usr/share/applications/VOCO.desktop"),
            Some("4242"),
            false
        ));
        assert!(opened(
            Some("/home/u/.local/share/applications/VOCO.desktop"),
            Some("4242"),
            false
        ));
        // A program started from a terminal inherits the terminal's entry and ID.
        assert!(!opened(
            Some("/usr/share/applications/org.gnome.Ptyxis.desktop"),
            Some("1000"),
            false
        ));
        assert!(!opened(
            Some("/usr/share/applications/VOCO.desktop"),
            Some("1000"),
            false
        ));
        // A login autostart keeps VOCO in the tray.
        assert!(!opened(
            Some("/home/u/.config/autostart/VOCO.desktop"),
            Some("4242"),
            false
        ));
        assert!(!opened(
            Some("/usr/share/applications/VOCO.desktop"),
            Some("4242"),
            true
        ));
        assert!(!opened(None, None, false));
        assert!(!opened(
            Some("/usr/share/applications/VOCO.desktop"),
            Some("pid"),
            false
        ));
    }
}
