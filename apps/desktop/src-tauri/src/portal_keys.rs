//! The snap's paste keys on GNOME Wayland without the companion: GNOME's
//! RemoteDesktop portal, in a keyboard-only session (AGENTS.md, Delivery).
//!
//! GNOME asks once, from setup's or Settings' button; the restore token it
//! returns lets every later session start without a dialog. A session exists
//! only while a desktop dictation runs, because GNOME shows its remote-access
//! icon for as long as one does.

use crate::portal::{self, Refusal};
use glib::variant::ToVariant;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};
use webkit2gtk::gio;

const INTERFACE: &str = "org.freedesktop.portal.RemoteDesktop";
/// SelectDevices' keyboard device type.
const KEYBOARD: u32 = 1;
/// Remember the permission until the person revokes it.
const PERSIST_UNTIL_REVOKED: u32 = 2;
/// evdev key codes, as NotifyKeyboardKeycode takes them.
const KEY_LEFTSHIFT: i32 = 42;
const KEY_INSERT: i32 = 110;
/// The gap between the four key events, as the companion and uinput keep.
const KEY_GAP: Duration = Duration::from_millis(12);
/// With a saved token GNOME answers in well under a second; a longer wait
/// means it is showing its dialog again, after the permission was revoked.
const RESTORE_TIMEOUT: Duration = Duration::from_secs(120);
/// How long setup's button waits for the person to answer GNOME's dialog.
const DIALOG_TIMEOUT: Duration = Duration::from_secs(300);
/// How long a paste waits for a session still starting.
const STARTING_WAIT: Duration = Duration::from_millis(400);
const TOKEN_FILE: &str = "remote-desktop-token";

pub const NOT_ALLOWED: &str = "VOCO isn't allowed to type yet. Open VOCO's Settings and choose Allow typing, then turn on Allow Remote Interaction in GNOME's dialog.";
const NOT_READY: &str = "VOCO's typing connection to GNOME isn't ready, so it sent no paste keys.";
const CLOSED_BY_GNOME: &str = "GNOME's Stop ended VOCO's typing, so it sent no paste keys.";
const DENIED: &str = "GNOME didn't allow VOCO to type. Choose Allow typing again, turn on Allow Remote Interaction, then choose Share.";

/// Why a paste through the portal failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortalPasteError {
    /// No key was sent.
    NoMutation(String),
    /// Some keys may have been sent.
    Uncertain(String),
}

#[derive(Default)]
struct Typing {
    session: Option<String>,
    /// A session is starting for this generation.
    opening: Option<u64>,
    /// Each begin and end starts a new generation, so a session that finishes
    /// starting after its dictation ended is closed at once.
    generation: u64,
    /// GNOME closed the session (the remote-access Stop), not VOCO.
    closed_by_gnome: bool,
}

static TYPING: Mutex<Typing> = Mutex::new(Typing {
    session: None,
    opening: None,
    generation: 0,
    closed_by_gnome: false,
});
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
/// The stops GNOME's Stop asked for. The portal suite (portal_fixture.rs)
/// runs without a tauri app, so it counts them here.
#[cfg(test)]
pub(crate) static STOPS_REQUESTED: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
/// The renderer's dictation status: starting, recording or processing.
static DICTATING: AtomicBool = AtomicBool::new(false);
/// How often an open session checks that a dictation still needs it.
const IDLE_CHECK: Duration = Duration::from_secs(3);

fn typing() -> MutexGuard<'static, Typing> {
    TYPING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn setup(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
}

/// The snap types through this portal on GNOME Wayland unless the companion
/// asks for work.
pub fn applies() -> bool {
    crate::confinement::is_snap()
        && crate::session_type_from_environment() == crate::SessionType::Wayland
        && crate::is_gnome_desktop(&crate::current_desktop())
}

fn token_path() -> Option<std::path::PathBuf> {
    crate::config::AppConfig::config_dir_without_migration()
        .ok()
        .map(|dir| dir.join(TOKEN_FILE))
}

fn load_token() -> Option<String> {
    let token = std::fs::read_to_string(token_path()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

fn save_token(token: &str) {
    if let Some(path) = token_path() {
        if let Err(error) = crate::config::atomic_write(&path, token) {
            log::warn!("Could not save GNOME's typing permission: {error}");
        }
    }
}

/// GNOME allowed VOCO to type, and its restore token is saved.
pub fn allowed() -> bool {
    load_token().is_some()
}

/// The session a dictation opened, for the portal suite (portal_fixture.rs).
#[cfg(test)]
pub(crate) fn session() -> Option<String> {
    typing().session.clone()
}

/// For Reset: GNOME asks again at the next setup.
pub fn forget() {
    end();
    if let Some(path) = token_path() {
        let _ = std::fs::remove_file(path);
    }
}

/// Starts a keyboard session; `token` restores an earlier permission.
/// Returns the session and GNOME's new restore token. Portal thread only.
fn open(
    connection: &gio::DBusConnection,
    token: Option<&str>,
    timeout: Duration,
) -> Result<(String, Option<String>), Refusal> {
    let created = portal::request(
        connection,
        INTERFACE,
        "CreateSession",
        |handle| {
            Ok(glib::Variant::tuple_from_iter([portal::options(&[
                ("handle_token", handle.to_variant()),
                ("session_handle_token", portal::token("typing").to_variant()),
            ])]))
        },
        Duration::from_secs(10),
    )?;
    let session = portal::result_string(&created, "session_handle")
        .ok_or_else(|| Refusal::Failed("GNOME returned no session.".into()))?;
    let started = (|| {
        portal::request(
            connection,
            INTERFACE,
            "SelectDevices",
            |handle| {
                let mut entries = vec![
                    ("handle_token", handle.to_variant()),
                    ("types", KEYBOARD.to_variant()),
                    ("persist_mode", PERSIST_UNTIL_REVOKED.to_variant()),
                ];
                if let Some(token) = token {
                    entries.push(("restore_token", token.to_variant()));
                }
                Ok(glib::Variant::tuple_from_iter([
                    portal::object_path(&session)?,
                    portal::options(&entries),
                ]))
            },
            Duration::from_secs(10),
        )?;
        let results = portal::request(
            connection,
            INTERFACE,
            "Start",
            |handle| {
                Ok(glib::Variant::tuple_from_iter([
                    portal::object_path(&session)?,
                    "".to_variant(),
                    portal::options(&[("handle_token", handle.to_variant())]),
                ]))
            },
            timeout,
        )?;
        let devices = results
            .lookup_value("devices", None)
            .and_then(|value| value.get::<u32>())
            .unwrap_or(0);
        if devices & KEYBOARD == 0 {
            return Err(Refusal::Denied);
        }
        Ok(portal::result_string(&results, "restore_token"))
    })();
    match started {
        Ok(token) => Ok((session, token)),
        Err(refusal) => {
            portal::close_session(connection, &session);
            Err(refusal)
        }
    }
}

thread_local! {
    /// The Closed subscription for the current session, on the portal thread.
    static CLOSED_WATCH: std::cell::RefCell<Option<gio::SignalSubscriptionId>> =
        const { std::cell::RefCell::new(None) };
}

/// Follows GNOME closing `session`: the remote-access icon's Stop ends the
/// dictation as Stop does, and no later key goes out. Portal thread only.
fn watch_closed(connection: &gio::DBusConnection, session: &str) {
    let watched = session.to_owned();
    let id = connection.signal_subscribe(
        Some(portal::DESTINATION),
        Some(portal::SESSION),
        Some("Closed"),
        Some(session),
        None,
        gio::DBusSignalFlags::NONE,
        move |_, _, _, _, _, _| {
            let mut state = typing();
            if state.session.as_deref() != Some(watched.as_str()) {
                return;
            }
            state.session = None;
            state.closed_by_gnome = true;
            drop(state);
            log::info!("GNOME closed VOCO's typing session");
            #[cfg(test)]
            STOPS_REQUESTED.fetch_add(1, Ordering::SeqCst);
            if let Some(app) = APP.get() {
                crate::tray::request_stop(app);
            }
        },
    );
    unwatch(connection);
    CLOSED_WATCH.with(|watch| *watch.borrow_mut() = Some(id));
}

fn unwatch(connection: &gio::DBusConnection) {
    CLOSED_WATCH.with(|watch| {
        if let Some(id) = watch.borrow_mut().take() {
            connection.signal_unsubscribe(id);
        }
    });
}

/// Each runtime status snapshot. Only a change from dictating to idle closes
/// the session: a snapshot sent for another reason still says idle just after
/// `begin`, before the renderer reports the dictation starting.
pub fn note_dictating(dictating: bool) {
    if DICTATING.swap(dictating, Ordering::SeqCst) && !dictating {
        end();
    }
}

/// Closes a session that has stayed open while VOCO was idle for two checks
/// in a row, as after a dictation that failed before its status changed, so
/// GNOME's icon never stays up. Portal thread only.
fn watch_idle(generation: u64) {
    let idle_checks = std::cell::Cell::new(0);
    // On the portal thread's own context: g_timeout_add would use GTK's.
    let source = glib::timeout_source_new(IDLE_CHECK, None, glib::Priority::DEFAULT, move || {
        if typing().generation != generation {
            return glib::ControlFlow::Break;
        }
        if DICTATING.load(Ordering::SeqCst) {
            idle_checks.set(0);
            return glib::ControlFlow::Continue;
        }
        idle_checks.set(idle_checks.get() + 1);
        if idle_checks.get() < 2 {
            return glib::ControlFlow::Continue;
        }
        log::info!("Closing VOCO's typing session: no dictation needs it");
        end();
        glib::ControlFlow::Break
    });
    source.attach(Some(&glib::MainContext::ref_thread_default()));
}

/// A desktop dictation starts: open a session from the saved permission, in
/// the background. Without one, nothing opens and pastes are refused.
pub fn begin() {
    if !applies() || crate::panel::companion_asks_for_work() {
        return;
    }
    let Some(token) = load_token() else {
        return;
    };
    let generation = {
        let mut state = typing();
        if state.session.is_some() || state.opening.is_some() {
            return;
        }
        state.generation += 1;
        state.closed_by_gnome = false;
        state.opening = Some(state.generation);
        state.generation
    };
    let spawned = portal::spawn(move |connection| {
        let opened = open(connection, Some(&token), RESTORE_TIMEOUT);
        let mut state = typing();
        if state.opening == Some(generation) {
            state.opening = None;
        }
        match opened {
            Ok((session, token)) => {
                if let Some(token) = token {
                    save_token(&token);
                }
                if state.generation == generation {
                    state.session = Some(session.clone());
                    drop(state);
                    watch_closed(connection, &session);
                    watch_idle(generation);
                } else {
                    drop(state);
                    portal::close_session(connection, &session);
                }
            }
            Err(refusal) => {
                drop(state);
                log::warn!("VOCO's typing session didn't start: {refusal:?}");
            }
        }
    });
    if !spawned {
        typing().opening = None;
    }
}

/// The dictation ended, or the screen locked, or VOCO quits: close the
/// session, so GNOME's remote-access icon goes.
pub fn end() {
    let session = {
        let mut state = typing();
        state.generation += 1;
        state.opening = None;
        state.session.take()
    };
    if let Some(session) = session {
        portal::spawn(move |connection| {
            unwatch(connection);
            portal::close_session(connection, &session);
        });
    }
}

fn current_session() -> Result<String, PortalPasteError> {
    let deadline = Instant::now() + STARTING_WAIT;
    loop {
        let state = typing();
        if let Some(session) = &state.session {
            return Ok(session.clone());
        }
        if state.closed_by_gnome {
            return Err(PortalPasteError::NoMutation(CLOSED_BY_GNOME.into()));
        }
        let starting = state.opening.is_some();
        drop(state);
        if !starting || Instant::now() >= deadline {
            let detail = if allowed() { NOT_READY } else { NOT_ALLOWED };
            return Err(PortalPasteError::NoMutation(detail.into()));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn key(
    connection: &gio::DBusConnection,
    session: &str,
    code: i32,
    pressed: bool,
) -> Result<(), String> {
    let parameters = glib::Variant::tuple_from_iter([
        portal::object_path(session)?,
        portal::options(&[]),
        code.to_variant(),
        u32::from(pressed).to_variant(),
    ]);
    connection
        .call_sync(
            Some(portal::DESTINATION),
            portal::OBJECT,
            INTERFACE,
            "NotifyKeyboardKeycode",
            Some(&parameters),
            None,
            gio::DBusCallFlags::NONE,
            1_000,
            gio::Cancellable::NONE,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// A session is open, or opens within the starting wait: checked before the
/// clipboard copy, so a missing session typed nothing and changed nothing.
pub fn ready() -> Result<(), PortalPasteError> {
    current_session().map(|_| ())
}

/// Shift, Insert and their releases, 12 ms apart, never another key. Returns
/// when the Insert press went out.
pub fn paste() -> Result<Instant, PortalPasteError> {
    let session = current_session()?;
    let connection = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
        .map_err(|error| PortalPasteError::NoMutation(error.to_string()))?;
    key(&connection, &session, KEY_LEFTSHIFT, true).map_err(|error| {
        PortalPasteError::NoMutation(format!("GNOME refused VOCO's paste keys: {error}"))
    })?;
    let uncertain = |error: String| {
        let _ = key(&connection, &session, KEY_LEFTSHIFT, false);
        PortalPasteError::Uncertain(format!(
            "VOCO's paste keys may not have reached the app: {error}. Automatic typing stopped."
        ))
    };
    std::thread::sleep(KEY_GAP);
    key(&connection, &session, KEY_INSERT, true).map_err(uncertain)?;
    let inserted = Instant::now();
    std::thread::sleep(KEY_GAP);
    key(&connection, &session, KEY_INSERT, false).map_err(uncertain)?;
    std::thread::sleep(KEY_GAP);
    key(&connection, &session, KEY_LEFTSHIFT, false).map_err(uncertain)?;
    Ok(inserted)
}

/// Setup's and Settings' Allow typing: GNOME shows its dialog, and its answer
/// is kept for every later dictation. The test session closes at once.
pub fn allow() -> Result<(), String> {
    if !applies() {
        return Err("VOCO types through GNOME's portal only in the snap on GNOME Wayland.".into());
    }
    let result = portal::run(|connection| {
        if !portal::has_interface(connection, INTERFACE, 2) {
            return Err("This GNOME can't remember VOCO's typing permission.".to_string());
        }
        match open(connection, None, DIALOG_TIMEOUT) {
            Ok((session, token)) => {
                portal::close_session(connection, &session);
                token.ok_or_else(|| "GNOME didn't remember the permission.".to_string())
            }
            Err(Refusal::Denied) => Err(DENIED.to_string()),
            Err(Refusal::TimedOut) => {
                Err("GNOME's dialog wasn't answered. Choose Allow typing again.".to_string())
            }
            Err(Refusal::Failed(error)) => {
                Err(format!("GNOME couldn't open its typing dialog: {error}"))
            }
        }
    })
    .unwrap_or_else(|| Err("VOCO can't reach GNOME's portal.".to_string()))?;
    save_token(&result);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_say_what_to_do() {
        assert!(NOT_ALLOWED.contains("Allow typing"));
        assert!(DENIED.contains("Allow Remote Interaction"));
    }
}
