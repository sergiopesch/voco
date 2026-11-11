//! VOCO's side of CI's portal suite (scripts/test-gnome-portals.py, AGENTS.md,
//! Delivery): the snap's real portal code against a private GNOME Shell, its
//! xdg-desktop-portal and GNOME backend. The suite answers GNOME's dialogs,
//! presses keys inside the Shell and reads the field; this process does what
//! VOCO does, one command at a time, and reports what each call returned.
//!
//! Each stdin line is one JSON command; each answer is one stdout line that
//! starts with [`REPLY`]. Without a tauri app nothing toggles or stops, so the
//! answers carry the counts of the toggles and stops the portal code asked for.

use serde_json::{json, Value};
use std::io::BufRead;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use webkit2gtk::gio;

const REPLY: &str = "VOCO-PORTAL-FIXTURE ";

fn counts() -> Value {
    json!({
        "stops": crate::portal_keys::STOPS_REQUESTED.load(Ordering::SeqCst),
        "toggles": crate::portal_shortcut::TOGGLES_REQUESTED.load(Ordering::SeqCst),
        "keysHeld": crate::portal_shortcut::keys_held(),
    })
}

fn status() -> Value {
    // The connection every portal call uses: GIO's shared session bus.
    let bus = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
        .expect("the private session bus");
    json!({
        "busName": bus.unique_name().map(|name| name.to_string()),
        "applies": crate::portal_keys::applies(),
        "typingAllowed": crate::portal_keys::allowed(),
        "shortcutPortal": crate::portal_shortcut::available(),
        "shortcutBound": crate::portal_shortcut::bound(),
        "shortcutHeld": crate::portal_shortcut::holds(),
        "trigger": crate::portal_shortcut::trigger(),
    })
}

/// The session `begin` opens in the background, once GNOME started it. Its
/// first paste comes well after that in a real dictation, which needs speech
/// first. Without GNOME's permission nothing opens.
fn started_session() -> Option<String> {
    if !crate::portal_keys::allowed() {
        return None;
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let session = crate::portal_keys::session();
        if session.is_some() || Instant::now() >= deadline {
            return session;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn outcome<T: serde::Serialize, E: serde::Serialize>(result: Result<T, E>) -> Value {
    match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "error": error }),
    }
}

fn run(command: &Value) -> Value {
    let text = || command["text"].as_str().expect("text").to_owned();
    match command["do"].as_str().expect("a command") {
        "status" => status(),
        "allow-typing" => outcome(crate::portal_keys::allow()),
        "allow-shortcut" => outcome(crate::portal_shortcut::allow(&text())),
        // A desktop dictation starts: the renderer asks for the session,
        // then reports the dictation starting.
        "begin" => {
            crate::portal_keys::begin();
            crate::portal_keys::note_dictating(true);
            json!({ "session": started_session() })
        }
        // A session asked for by a dictation whose status never changed.
        "begin-idle" => {
            crate::portal_keys::begin();
            json!({ "session": started_session() })
        }
        "session" => json!({ "session": crate::portal_keys::session() }),
        // The renderer reports idle once the dictation's last paste is done.
        "end" => {
            crate::portal_keys::note_dictating(false);
            json!({ "ok": true })
        }
        "paste" => outcome(crate::insertion::desktop_paste(&text())),
        "suspend" => {
            crate::portal_shortcut::suspend();
            json!({ "ok": true })
        }
        "resume" => {
            crate::portal_shortcut::resume();
            json!({ "ok": true })
        }
        "counts" => json!({}),
        other => panic!("Unknown portal fixture command: {other}"),
    }
}

#[test]
#[ignore = "The portal suite's private GNOME session is required"]
fn serve_the_portal_suite() {
    assert!(
        !std::path::Path::new("/dev/input").exists(),
        "Run only in a private desktop namespace"
    );
    assert!(
        crate::confinement::is_snap(),
        "The suite runs VOCO as its snap"
    );
    for line in std::io::stdin().lock().lines() {
        let line = line.expect("a command line");
        let command: Value = serde_json::from_str(&line).expect("a JSON command");
        if command["do"] == "quit" {
            break;
        }
        let began = Instant::now();
        let mut reply = run(&command);
        reply["ms"] = json!(began.elapsed().as_secs_f64() * 1000.0);
        reply["counts"] = counts();
        println!("{REPLY}{reply}");
    }
}
