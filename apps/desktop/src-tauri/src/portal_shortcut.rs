//! The snap's shortcut on GNOME 48 and later without the companion: GNOME's
//! GlobalShortcuts portal (AGENTS.md, Shortcut).
//!
//! GNOME asks once, from setup's or Settings' button. VOCO records that, and
//! binds again at each start, which GNOME answers without a dialog. While the
//! companion's lease is fresh the portal session is closed, so one grab holds
//! the chord.

use crate::portal::{self, Refusal};
use glib::variant::ToVariant;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};
use webkit2gtk::gio;

const INTERFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
const SHORTCUT_ID: &str = "toggle";
const DESCRIPTION: &str = "Start or stop dictation";
const BOUND_FILE: &str = "global-shortcut";
/// How long setup's button waits for the person to answer GNOME's dialog.
const DIALOG_TIMEOUT: Duration = Duration::from_secs(300);
/// A rebind GNOME already allowed answers at once.
const REBIND_TIMEOUT: Duration = Duration::from_secs(30);
/// A paste never waits on a press longer than this (AGENTS.md, Delivery).
const HELD_LIMIT: Duration = Duration::from_millis(1_500);
/// After the shortcut's release, time for its modifier's own release.
const MODIFIER_GRACE: Duration = Duration::from_millis(150);

#[derive(Default)]
struct Shortcut {
    session: Option<String>,
    /// Closed while the companion's lease holds the chord.
    suspended: bool,
    /// GNOME's description of the trigger, such as "Press <Super>x".
    trigger: Option<String>,
    pressed: Option<Instant>,
    released: Option<Instant>,
}

static SHORTCUT: Mutex<Shortcut> = Mutex::new(Shortcut {
    session: None,
    suspended: false,
    trigger: None,
    pressed: None,
    released: None,
});
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
/// The toggles `Activated` asked for. The portal suite (portal_fixture.rs)
/// runs without a tauri app, so it counts them here.
#[cfg(test)]
pub(crate) static TOGGLES_REQUESTED: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

fn shortcut() -> MutexGuard<'static, Shortcut> {
    SHORTCUT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The snap holds its shortcut through this portal on GNOME Wayland.
pub fn applies() -> bool {
    crate::portal_keys::applies()
}

fn bound_path() -> Option<std::path::PathBuf> {
    crate::config::AppConfig::config_dir_without_migration()
        .ok()
        .map(|dir| dir.join(BOUND_FILE))
}

/// The person added VOCO's shortcut in GNOME's dialog.
pub fn bound() -> bool {
    bound_path().is_some_and(|path| path.exists())
}

fn record_bound(trigger: Option<&str>) {
    if let Some(path) = bound_path() {
        if let Err(error) = crate::config::atomic_write(&path, trigger.unwrap_or("")) {
            log::warn!("Could not record VOCO's GNOME shortcut: {error}");
        }
    }
}

/// For Reset: GNOME asks again at the next setup.
pub fn forget() {
    close();
    if let Some(path) = bound_path() {
        let _ = std::fs::remove_file(path);
    }
}

/// GNOME's description of the trigger, once bound.
pub fn trigger() -> Option<String> {
    shortcut().trigger.clone().or_else(|| {
        bound_path()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty())
    })
}

/// "LOGO+x" for the portal's preferred trigger, from VOCO's shortcut: the
/// shortcuts specification's modifier names, and the key's keysym in lower case.
fn preferred_trigger(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| match part.trim().to_ascii_lowercase().as_str() {
            "alt" | "option" => "ALT".to_owned(),
            "shift" => "SHIFT".to_owned(),
            "ctrl" | "control" => "CTRL".to_owned(),
            "super" | "logo" | "cmd" | "command" => "LOGO".to_owned(),
            key => key.to_owned(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

thread_local! {
    static SIGNALS: std::cell::RefCell<Vec<gio::SignalSubscriptionId>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Activated toggles; Deactivated marks the release, which a paste waits for.
/// Portal thread only.
fn watch(connection: &gio::DBusConnection) {
    unwatch(connection);
    let ids = ["Activated", "Deactivated"].map(|member| {
        connection.signal_subscribe(
            Some(portal::DESTINATION),
            Some(INTERFACE),
            Some(member),
            Some(portal::OBJECT),
            None,
            gio::DBusSignalFlags::NONE,
            move |_, _, _, _, signal, parameters| {
                let session = parameters.child_value(0).str().map(str::to_owned);
                let id = parameters.child_value(1).str().map(str::to_owned);
                let mut state = shortcut();
                if session.is_none()
                    || session != state.session
                    || id.as_deref() != Some(SHORTCUT_ID)
                {
                    return;
                }
                if signal == "Activated" {
                    state.pressed = Some(Instant::now());
                    state.released = None;
                    drop(state);
                    #[cfg(test)]
                    TOGGLES_REQUESTED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if let Some(app) = APP.get() {
                        crate::toggle_from_portal(app);
                    }
                } else {
                    state.released = Some(Instant::now());
                }
            },
        )
    });
    SIGNALS.with(|signals| signals.borrow_mut().extend(ids));
}

fn unwatch(connection: &gio::DBusConnection) {
    SIGNALS.with(|signals| {
        for id in signals.borrow_mut().drain(..) {
            connection.signal_unsubscribe(id);
        }
    });
}

/// Creates a session and binds VOCO's shortcut. Portal thread only.
fn bind(
    connection: &gio::DBusConnection,
    accelerator: &str,
    timeout: Duration,
) -> Result<(String, Option<String>), Refusal> {
    let created = portal::request(
        connection,
        INTERFACE,
        "CreateSession",
        |handle| {
            Ok(glib::Variant::tuple_from_iter([portal::options(&[
                ("handle_token", handle.to_variant()),
                (
                    "session_handle_token",
                    portal::token("shortcut").to_variant(),
                ),
            ])]))
        },
        Duration::from_secs(10),
    )?;
    let session = portal::result_string(&created, "session_handle")
        .ok_or_else(|| Refusal::Failed("GNOME returned no session.".into()))?;
    let preferred = preferred_trigger(accelerator);
    let results = portal::request(
        connection,
        INTERFACE,
        "BindShortcuts",
        |handle| {
            let properties = portal::options(&[
                ("description", DESCRIPTION.to_variant()),
                ("preferred_trigger", preferred.to_variant()),
            ]);
            let shortcut = glib::Variant::tuple_from_iter([SHORTCUT_ID.to_variant(), properties]);
            let shortcuts = glib::Variant::array_from_iter_with_type(
                glib::VariantTy::new("(sa{sv})").expect("static type"),
                [shortcut],
            );
            Ok(glib::Variant::tuple_from_iter([
                portal::object_path(&session)?,
                shortcuts,
                "".to_variant(),
                portal::options(&[("handle_token", handle.to_variant())]),
            ]))
        },
        timeout,
    );
    let results = match results {
        Ok(results) => results,
        Err(refusal) => {
            portal::close_session(connection, &session);
            return Err(refusal);
        }
    };
    let trigger = results
        .lookup_value("shortcuts", None)
        .and_then(|list| {
            (0..list.n_children())
                .map(|index| list.child_value(index))
                .find(|entry| entry.child_value(0).str() == Some(SHORTCUT_ID))
        })
        .and_then(|entry| {
            glib::VariantDict::new(Some(&entry.child_value(1)))
                .lookup_value("trigger_description", None)
                .and_then(|value| value.str().map(str::to_owned))
        });
    Ok((session, trigger))
}

fn adopt(connection: &gio::DBusConnection, session: String, trigger: Option<String>) {
    let mut state = shortcut();
    if state.suspended {
        drop(state);
        portal::close_session(connection, &session);
        return;
    }
    if let Some(old) = state.session.replace(session) {
        portal::close_session(connection, &old);
    }
    if trigger.is_some() {
        state.trigger = trigger;
    }
    drop(state);
    watch(connection);
}

/// At startup: bind again what the person already added, without a dialog.
pub fn setup(app: &tauri::AppHandle, accelerator: &str) {
    let _ = APP.set(app.clone());
    if applies() && bound() {
        rebind(accelerator.to_owned());
    }
}

fn rebind(accelerator: String) {
    portal::spawn(move |connection| {
        if !portal::has_interface(connection, INTERFACE, 1) {
            return;
        }
        match bind(connection, &accelerator, REBIND_TIMEOUT) {
            Ok((session, trigger)) => adopt(connection, session, trigger),
            Err(refusal) => log::warn!("VOCO's GNOME shortcut didn't bind: {refusal:?}"),
        }
    });
}

/// Whether this GNOME offers the GlobalShortcuts portal (GNOME 48 and later).
pub fn available() -> bool {
    applies()
        && portal::run(|connection| portal::has_interface(connection, INTERFACE, 1))
            .unwrap_or(false)
}

/// Setup's and Settings' button: GNOME shows its dialog once.
pub fn allow(accelerator: &str) -> Result<Option<String>, String> {
    if !applies() {
        return Err("VOCO uses GNOME's shortcut portal only in the snap on GNOME Wayland.".into());
    }
    let accelerator = accelerator.to_owned();
    let result = portal::run(move |connection| {
        if !portal::has_interface(connection, INTERFACE, 1) {
            return Err("This GNOME has no shortcut portal.".to_string());
        }
        match bind(connection, &accelerator, DIALOG_TIMEOUT) {
            Ok((session, trigger)) => {
                adopt(connection, session, trigger.clone());
                Ok(trigger)
            }
            Err(Refusal::Denied) => Err(
                "GNOME didn't add VOCO's shortcut. Choose the button again, then Add.".to_string(),
            ),
            Err(Refusal::TimedOut) => {
                Err("GNOME's dialog wasn't answered. Choose the button again.".to_string())
            }
            Err(Refusal::Failed(error)) => {
                Err(format!("GNOME couldn't add VOCO's shortcut: {error}"))
            }
        }
    })
    .unwrap_or_else(|| Err("VOCO can't reach GNOME's portal.".to_string()))?;
    record_bound(result.as_deref());
    Ok(result)
}

fn close() {
    let session = shortcut().session.take();
    if let Some(session) = session {
        portal::spawn(move |connection| {
            unwatch(connection);
            portal::close_session(connection, &session);
        });
    }
}

/// GNOME's portal holds VOCO's chord now.
pub fn holds() -> bool {
    let state = shortcut();
    state.session.is_some() && !state.suspended
}

/// The companion's lease holds the chord: release the portal's grab.
pub fn suspend() {
    let was = std::mem::replace(&mut shortcut().suspended, true);
    if !was {
        close();
    }
}

/// The companion's lease lapsed: bind again, if the person added the shortcut.
pub fn resume() {
    let was = std::mem::replace(&mut shortcut().suspended, false);
    if !(was && applies() && bound()) {
        return;
    }
    let accelerator = APP
        .get()
        .and_then(|app| crate::tray::current_hotkey(app).ok())
        .unwrap_or_else(|| crate::config::DEFAULT_HOTKEY.into());
    rebind(accelerator);
}

/// Through the portal VOCO can't read modifiers, so a paste waits while the
/// last press hasn't been released, at most 1.5 s after it, then 150 ms after
/// the release for the modifier's own (AGENTS.md, Delivery). Unknown without a
/// portal press.
pub fn keys_held() -> Option<bool> {
    let state = shortcut();
    state.session.as_ref()?;
    let pressed = state.pressed?;
    Some(held(pressed, state.released, Instant::now()))
}

fn held(pressed: Instant, released: Option<Instant>, now: Instant) -> bool {
    if now.saturating_duration_since(pressed) >= HELD_LIMIT {
        return false;
    }
    match released {
        Some(released) if released >= pressed => {
            now.saturating_duration_since(released) < MODIFIER_GRACE
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_trigger_uses_the_portal_spelling() {
        assert_eq!(preferred_trigger("Super+X"), "LOGO+x");
        assert_eq!(preferred_trigger("super + x"), "LOGO+x");
        assert_eq!(preferred_trigger("Cmd+X"), "LOGO+x");
        assert_eq!(preferred_trigger("Alt+D"), "ALT+d");
        assert_eq!(preferred_trigger("Alt+Shift+D"), "ALT+SHIFT+d");
        assert_eq!(preferred_trigger(crate::config::DEFAULT_HOTKEY), "LOGO+x");
    }

    #[test]
    fn a_paste_waits_for_the_release_then_the_modifier_grace() {
        let pressed = Instant::now();
        let at = |ms| pressed + Duration::from_millis(ms);
        assert!(held(pressed, None, at(100)), "still pressed");
        assert!(
            held(pressed, Some(at(200)), at(300)),
            "within the modifier grace"
        );
        assert!(!held(pressed, Some(at(200)), at(351)), "after the grace");
        assert!(
            !held(pressed, None, at(1_500)),
            "never past 1.5 s from the press"
        );
        assert!(
            !held(pressed, Some(at(1_400)), at(1_500)),
            "the limit wins over the grace"
        );
    }
}
