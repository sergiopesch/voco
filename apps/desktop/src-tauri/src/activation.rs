//! Launcher activation has its own owner-only socket; it can never toggle capture.
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
            Err(_) => return Err("VOCO is running but could not receive the launcher request. Use its tray menu, or quit and reopen VOCO after upgrading.".to_string()),
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

#[tauri::command]
pub fn take_launcher_activation() -> bool {
    PENDING.swap(false, Ordering::SeqCst)
}
