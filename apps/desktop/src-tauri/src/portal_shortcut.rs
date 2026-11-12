//! The snap's shortcut on GNOME 48 and later without the companion: GNOME's
//! GlobalShortcuts portal (AGENTS.md, Shortcut).
//!
//! GNOME asks once, from setup's or Settings' button. VOCO records that, and
//! binds again at each start, which GNOME answers without a dialog. While the
//! companion's lease is fresh the portal session is closed, so one grab holds
//! the chord.

use crate::portal::{self, Refusal};
use crate::shortcut_chord::{hotkey_from_trigger, Chord};
use glib::variant::ToVariant;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};
use webkit2gtk::gio::{self, prelude::SettingsExt};

const INTERFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
/// The shortcut's ID until VOCO's Settings changes its keys. GNOME keeps the
/// keys it stored for an ID whatever an app proposes later, and asks about
/// new keys only for an ID it hasn't seen, so each change takes the next one:
/// "toggle-2", "toggle-3".
const FIRST_ID: &str = "toggle";
/// The ID GNOME holds VOCO's shortcut under, beside the config; absent
/// while it is the first.
const ID_FILE: &str = "global-shortcut-id";
const DESCRIPTION: &str = "Start or stop dictation";
const BOUND_FILE: &str = "global-shortcut";
/// How long setup's button waits for the person to answer GNOME's dialog.
const DIALOG_TIMEOUT: Duration = Duration::from_secs(300);
/// A rebind GNOME already allowed answers at once.
const REBIND_TIMEOUT: Duration = Duration::from_secs(30);
/// After the shortcut's release, time for its modifier's own release.
/// People often let go of Super or Alt a moment after the letter, and keys
/// sent while it is down make another chord, which pastes nothing.
const MODIFIER_GRACE: Duration = Duration::from_millis(400);

#[derive(Default)]
struct Shortcut {
    session: Option<String>,
    /// The shortcut's ID in that session.
    id: String,
    /// Closed while the companion's lease holds the chord.
    suspended: bool,
    /// GNOME's description of the trigger, such as "Press <Super>x".
    trigger: Option<String>,
    pressed: Option<Instant>,
    released: Option<Instant>,
    /// The last `Activated`, a held chord's repeats included.
    activated: Option<Instant>,
    /// That `Activated` was a repeat: the chord was still held then.
    repeating: bool,
    /// The last press came from GNOME 46's custom shortcut, over D-Bus, with
    /// no portal session behind it and no release to come.
    bus: bool,
}

static SHORTCUT: Mutex<Shortcut> = Mutex::new(Shortcut {
    session: None,
    id: String::new(),
    suspended: false,
    trigger: None,
    pressed: None,
    released: None,
    activated: None,
    repeating: false,
    bus: false,
});
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
/// The toggles `Activated` asked for. The portal suite (portal_fixture.rs)
/// runs without a tauri app, so it counts them here.
#[cfg(test)]
pub(crate) static TOGGLES_REQUESTED: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
/// Every `Activated`, a held chord's repeats included.
#[cfg(test)]
pub(crate) static ACTIVATIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// GNOME's keyboard repeat: a held key repeats after `delay`, then every
/// `interval`.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Repeat {
    delay: Duration,
    interval: Duration,
}

/// GNOME's grabs, the portal's and a custom shortcut's, repeat a held chord's
/// press about every 30 ms once the keyboard's repeat delay has passed, so
/// only a press toggles (AGENTS.md, Shortcut). None when the keyboard doesn't
/// repeat. Read once: GNOME's defaults are 500 ms and 30 ms.
fn repeat() -> Option<Repeat> {
    static REPEAT: OnceLock<Option<Repeat>> = OnceLock::new();
    *REPEAT.get_or_init(|| {
        const DEFAULT: Repeat = Repeat {
            delay: Duration::from_millis(500),
            interval: Duration::from_millis(30),
        };
        let Some(schema) = gio::SettingsSchemaSource::default()
            .and_then(|source| source.lookup("org.gnome.desktop.peripherals.keyboard", true))
            .filter(|schema| {
                ["repeat", "delay", "repeat-interval"]
                    .iter()
                    .all(|key| schema.has_key(key))
            })
        else {
            return Some(DEFAULT);
        };
        let keyboard = gio::Settings::new_full(&schema, None::<&gio::SettingsBackend>, None);
        keyboard.boolean("repeat").then(|| Repeat {
            delay: Duration::from_millis(keyboard.uint("delay").into()),
            interval: Duration::from_millis(keyboard.uint("repeat-interval").into()),
        })
    })
}

fn repeat_delay() -> Option<Duration> {
    repeat().map(|repeat| repeat.delay)
}

/// How far a repeat may trail the time GNOME's keyboard repeat gives it.
const REPEAT_MARGIN: Duration = Duration::from_millis(100);

/// Without keyboard repeat, a press GNOME never reported released stops
/// counting as one this long after its last activation.
const STALE_REPEAT: Duration = Duration::from_millis(900);

/// How long a chord GNOME hasn't reported released can stay silent and still
/// be held. GNOME sends `Deactivated` only when the letter comes up under its
/// modifier: let go of Super first, as people often do, and nothing more
/// arrives. A chord still held repeats, first one repeat delay after the
/// press, so silence past that and a margin means the modifier is up. Without
/// keyboard repeat nothing tells a hold from that silence, so it gets the
/// time a held press counts for.
fn silence_window(repeat: Option<Repeat>) -> Duration {
    repeat.map_or(STALE_REPEAT, |repeat| repeat.delay.max(repeat.interval)) + REPEAT_MARGIN
}

/// Within `window` of the last press or repeat; never without a window.
fn within_repeat(last: Option<Instant>, now: Instant, window: Option<Duration>) -> bool {
    match (last, window) {
        (Some(last), Some(window)) => now.saturating_duration_since(last) < window,
        _ => false,
    }
}

/// A held chord's repeated `Activated`. GNOME hasn't reported the press
/// released, the chord hasn't gone silent, and the time since the last one is
/// a repeat's: the first comes one repeat delay after the press, the rest at
/// the repeat interval, a rhythm no hand presses. Anything else is a new
/// press, so one soon after the modifier came up first, which GNOME reports
/// no release for, still toggles.
fn is_repeat(state: &Shortcut, now: Instant, repeat: Option<Repeat>) -> bool {
    let down = state
        .pressed
        .is_some_and(|pressed| !state.released.is_some_and(|released| released >= pressed));
    let Some(last) = state.activated.filter(|_| down) else {
        return false;
    };
    let gap = now.saturating_duration_since(last);
    if gap >= silence_window(repeat) {
        return false;
    }
    match repeat {
        // Read as off: should GNOME repeat all the same, nothing times it.
        None => true,
        Some(repeat) => {
            state.repeating
                || gap < repeat.interval + REPEAT_MARGIN
                || gap + REPEAT_MARGIN >= repeat.delay
        }
    }
}

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

fn id_path() -> Option<std::path::PathBuf> {
    crate::config::AppConfig::config_dir_without_migration()
        .ok()
        .map(|dir| dir.join(ID_FILE))
}

/// The ID GNOME holds VOCO's shortcut under.
fn saved_id() -> String {
    id_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim().to_owned())
        .filter(|id| valid_id(id))
        .unwrap_or_else(|| FIRST_ID.to_owned())
}

/// Only an ID VOCO wrote: "toggle" or "toggle-N".
fn valid_id(id: &str) -> bool {
    id == FIRST_ID
        || id
            .strip_prefix("toggle-")
            .is_some_and(|number| number.parse::<u32>().is_ok_and(|number| number >= 2))
}

/// The ID a change of keys binds: one GNOME hasn't stored keys for.
fn next_id(id: &str) -> String {
    let number = id
        .strip_prefix("toggle-")
        .and_then(|number| number.parse::<u32>().ok())
        .unwrap_or(1);
    format!("toggle-{}", number.saturating_add(1))
}

fn record_id(id: &str) {
    let Some(path) = id_path() else { return };
    let written = if id == FIRST_ID {
        match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    } else {
        crate::config::atomic_write(&path, id).map_err(|error| error.to_string())
    };
    if let Err(error) = written {
        log::warn!("Could not record the ID of VOCO's GNOME shortcut: {error}");
    }
}

/// For Reset: GNOME asks again at the next setup.
pub fn forget() {
    close();
    if let Some(path) = bound_path() {
        let _ = std::fs::remove_file(path);
    }
    if let Some(path) = id_path() {
        let _ = std::fs::remove_file(path);
    }
    if applies() {
        crate::gnome_custom_shortcut::remove();
    }
}

/// On GNOME 46, without the portal, the snap adds a GNOME custom shortcut
/// that runs `voco --toggle` (gnome_custom_shortcut.rs).
pub fn custom_applies() -> bool {
    applies() && !available() && crate::gnome_custom_shortcut::available()
}

/// VOCO's GNOME custom shortcut exists for `hotkey`.
pub fn custom_present(hotkey: &str) -> bool {
    Chord::of(hotkey)
        .is_some_and(|chord| crate::gnome_custom_shortcut::present(&chord.gtk_accelerator()))
}

/// The press of a GNOME custom shortcut reaches VOCO as `voco --toggle`, with
/// no release to wait for: a paste waits this long after it, or after its last
/// repeat, for the chord's keys to come up (AGENTS.md, Delivery).
const COMMAND_GRACE: Duration = Duration::from_millis(400);
/// Each `voco --toggle` is a snap launch, about 150 ms on an idle machine and
/// longer while GNOME starts one per repeat, so repeats reach VOCO late and
/// unevenly: the gap between the press's and the first repeat's can exceed
/// the repeat delay by a few hundred milliseconds.
const COMMAND_LAUNCH_MARGIN: Duration = Duration::from_millis(400);
/// The last `voco --toggle`, a held chord's repeats included.
static COMMAND_PRESS: Mutex<Option<Instant>> = Mutex::new(None);

/// How long after one `voco --toggle` the next is a repeat, and a paste waits
/// for the keys to come up: the repeat delay and the launch margin.
fn command_window(delay: Option<Duration>) -> Option<Duration> {
    delay.map(|delay| delay + COMMAND_LAUNCH_MARGIN)
}

fn command_grace(delay: Option<Duration>) -> Duration {
    command_window(delay).map_or(COMMAND_GRACE, |window| COMMAND_GRACE.max(window))
}

/// A press GNOME reported, or a held chord's repeat of one. True for a press,
/// which toggles; a repeat only keeps the chord counted as held.
fn press(state: &mut Shortcut, now: Instant, repeat: Option<Repeat>) -> bool {
    let repeated = is_repeat(state, now, repeat);
    state.activated = Some(now);
    state.repeating = repeated;
    if repeated {
        return false;
    }
    state.pressed = Some(now);
    state.released = None;
    true
}

/// GNOME 46's custom shortcut called VOCO's Toggle over D-Bus (panel.rs),
/// as it does for the press and for each repeat while the chord is held.
/// The call arrives within a few milliseconds, so repeats come at GNOME's
/// own timing and are told from presses as the portal's are. False for a
/// repeat, which doesn't toggle.
pub fn note_bus_press() -> bool {
    let mut state = shortcut();
    state.bus = true;
    press(&mut state, Instant::now(), repeat())
}

/// How long after the last Toggle call, a repeat included, a paste waits.
/// GNOME 46 reports no release of either key. Without a repeat the letter
/// came up within the repeat delay, and the modifier gets the grace it gets
/// after a portal `Deactivated`: people often let go of it a moment later.
fn bus_grace(delay: Option<Duration>) -> Duration {
    delay.map_or(MODIFIER_GRACE, |delay| delay + MODIFIER_GRACE)
}

/// Whether a press over D-Bus still counts as held: unknown once its grace
/// has passed, which holds back no paste.
fn bus_held(last: Option<Instant>, now: Instant, delay: Option<Duration>) -> Option<bool> {
    (now.saturating_duration_since(last?) < bus_grace(delay)).then_some(true)
}

/// A `voco --toggle` reached the snap. False for a held chord's repeat, which
/// GNOME's custom shortcut runs too: it doesn't toggle.
pub fn note_command_press() -> bool {
    let now = Instant::now();
    let mut last = COMMAND_PRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let repeat = within_repeat(*last, now, command_window(repeat_delay()));
    *last = Some(now);
    !repeat
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
                    || id.as_deref() != Some(state.id.as_str())
                {
                    return;
                }
                if signal == "Activated" {
                    #[cfg(test)]
                    ACTIVATIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    state.bus = false;
                    if !press(&mut state, Instant::now(), repeat()) {
                        return;
                    }
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
    // A change in GNOME Settings, under Apps.
    let changed = connection.signal_subscribe(
        Some(portal::DESTINATION),
        Some(INTERFACE),
        Some("ShortcutsChanged"),
        Some(portal::OBJECT),
        None,
        gio::DBusSignalFlags::NONE,
        |_, _, _, _, _, parameters| {
            let session = parameters.child_value(0).str().map(str::to_owned);
            let mut state = shortcut();
            if session.is_none() || session != state.session {
                return;
            }
            let Some(trigger) = trigger_of(&parameters.child_value(1), &state.id) else {
                return;
            };
            state.trigger = Some(trigger.clone());
            drop(state);
            record_bound(Some(&trigger));
            follow(Some(&trigger));
        },
    );
    SIGNALS.with(|signals| signals.borrow_mut().push(changed));
}

fn unwatch(connection: &gio::DBusConnection) {
    SIGNALS.with(|signals| {
        for id in signals.borrow_mut().drain(..) {
            connection.signal_unsubscribe(id);
        }
    });
}

/// GNOME's description of the keys it holds for the shortcut `id`, from a
/// portal shortcut list. None when it lists none, or no keys for it.
fn trigger_of(shortcuts: &glib::Variant, id: &str) -> Option<String> {
    (0..shortcuts.n_children())
        .map(|index| shortcuts.child_value(index))
        .find(|entry| entry.child_value(0).str() == Some(id))
        .and_then(|entry| {
            glib::VariantDict::new(Some(&entry.child_value(1)))
                .lookup_value("trigger_description", None)
                .and_then(|value| value.str().map(str::to_owned))
        })
        .filter(|trigger| !trigger.trim().is_empty())
}

/// Creates a session and binds VOCO's shortcut under `id`, proposing
/// `accelerator`'s keys. GNOME asks the person about an ID it holds no keys
/// for, and answers at once, with the keys it holds, for one it knows.
/// Portal thread only.
fn bind(
    connection: &gio::DBusConnection,
    id: &str,
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
    let preferred = Chord::of(accelerator).map(|chord| chord.portal_trigger());
    let results = portal::request(
        connection,
        INTERFACE,
        "BindShortcuts",
        |handle| {
            let mut entries = vec![("description", DESCRIPTION.to_variant())];
            if let Some(preferred) = &preferred {
                entries.push(("preferred_trigger", preferred.to_variant()));
            }
            let properties = portal::options(&entries);
            let shortcut = glib::Variant::tuple_from_iter([id.to_variant(), properties]);
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
        .and_then(|list| trigger_of(&list, id));
    Ok((session, trigger))
}

/// GNOME holds the chord, and GNOME Settings changes it: VOCO's config
/// follows, so its labels name the key GNOME listens for.
fn follow(trigger: Option<&str>) {
    let Some(hotkey) = trigger.and_then(hotkey_from_trigger) else {
        return;
    };
    if let Some(app) = APP.get() {
        crate::follow_gnome_shortcut(app, hotkey);
    }
}

fn adopt(connection: &gio::DBusConnection, session: String, id: &str, trigger: Option<String>) {
    let mut state = shortcut();
    if state.suspended {
        drop(state);
        portal::close_session(connection, &session);
        return;
    }
    if let Some(old) = state.session.replace(session) {
        portal::close_session(connection, &old);
    }
    state.id = id.to_owned();
    if trigger.is_some() {
        state.trigger = trigger.clone();
    }
    drop(state);
    watch(connection);
    follow(trigger.as_deref());
}

/// At startup: bind again what the person already added, without a dialog.
pub fn setup(app: &tauri::AppHandle, accelerator: &str) {
    let _ = APP.set(app.clone());
    // GNOME 46: VOCO's own custom shortcut, added by an earlier VOCO, takes
    // this VOCO's command.
    if custom_applies() {
        crate::gnome_custom_shortcut::update_command();
    }
    if applies() && bound() {
        rebind(accelerator.to_owned());
    }
}

fn rebind(accelerator: String) {
    portal::spawn(move |connection| {
        if !portal::has_interface(connection, INTERFACE, 1) {
            return;
        }
        let id = saved_id();
        match bind(connection, &id, &accelerator, REBIND_TIMEOUT) {
            Ok((session, trigger)) => adopt(connection, session, &id, trigger),
            Err(refusal) => log::warn!("VOCO's GNOME shortcut didn't bind: {refusal:?}"),
        }
    });
}

/// Whether this GNOME offers the GlobalShortcuts portal (GNOME 48 and later).
pub fn available() -> bool {
    // The session's portal can't gain or lose the interface while VOCO runs,
    // and the diagnostics poll asks once a second.
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    applies()
        && *AVAILABLE.get_or_init(|| {
            portal::run(|connection| portal::has_interface(connection, INTERFACE, 1))
                .unwrap_or(false)
        })
}

/// Setup's and Settings' button: GNOME shows its dialog once.
pub fn allow(accelerator: &str) -> Result<Option<String>, String> {
    if !applies() {
        return Err("VOCO uses GNOME's shortcut portal only in the snap on GNOME Wayland.".into());
    }
    if custom_applies() {
        return add_custom(accelerator).map(Some);
    }
    let accelerator = accelerator.to_owned();
    let result = portal::run(move |connection| {
        if !portal::has_interface(connection, INTERFACE, 1) {
            return Err("This GNOME has no shortcut portal.".to_string());
        }
        let id = saved_id();
        match bind(connection, &id, &accelerator, DIALOG_TIMEOUT) {
            Ok((session, trigger)) => {
                adopt(connection, session, &id, trigger.clone());
                Ok(trigger)
            }
            Err(Refusal::Denied | Refusal::Ended) => Err(
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

/// GNOME 46: VOCO's own custom shortcut, added or moved to `accelerator`'s
/// keys. GNOME's keyboard settings ask nobody, so neither does this.
fn add_custom(accelerator: &str) -> Result<String, String> {
    let chord = Chord::of(accelerator)
        .ok_or_else(|| {
            format!("GNOME's keyboard shortcuts can't hold {accelerator}. Choose another shortcut.")
        })?
        .gtk_accelerator();
    crate::gnome_custom_shortcut::add(&chord, accelerator)?;
    let trigger = format!("Press {chord}");
    record_bound(Some(&trigger));
    Ok(trigger)
}

/// Settings' Apply shortcut, once GNOME holds VOCO's shortcut: GNOME's keys
/// become `accelerator`'s. Through the portal, VOCO binds the shortcut under
/// its next ID with those keys proposed, GNOME shows its dialog, and when the
/// person adds it the earlier session closes; GNOME then keeps only the new
/// ID. Cancelled or refused, the earlier keys stay. Returns GNOME's
/// description of the keys it now holds, which its dialog lets the person
/// alter.
pub fn change(accelerator: &str) -> Result<String, String> {
    if !applies() {
        return Err("VOCO uses GNOME's shortcut portal only in the snap on GNOME Wayland.".into());
    }
    // One change at a time: a second request while GNOME's dialog is open
    // would open another under it.
    static CHANGING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if CHANGING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err("GNOME's dialog is already open. Choose Add or Cancel there.".into());
    }
    let result = change_keys(accelerator);
    CHANGING.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}

fn change_keys(accelerator: &str) -> Result<String, String> {
    if custom_applies() {
        return add_custom(accelerator);
    }
    if Chord::of(accelerator).is_none() {
        return Err(format!(
            "GNOME can't hold {accelerator} for VOCO. Choose another shortcut."
        ));
    }
    if shortcut().suspended {
        return Err("The VOCO panel holds the shortcut now. Change it in the panel's menu.".into());
    }
    let label = accelerator.to_owned();
    let accelerator = accelerator.to_owned();
    let changed = portal::run(move |connection| {
        if !portal::has_interface(connection, INTERFACE, 1) {
            return Err("This GNOME has no shortcut portal.".to_string());
        }
        let id = next_id(&saved_id());
        match bind(connection, &id, &accelerator, DIALOG_TIMEOUT) {
            // GNOME's dialog lets the person alter the proposed keys. Keys
            // VOCO can't take, such as a key with no Alt, Ctrl or Super,
            // would leave its labels naming a shortcut GNOME doesn't hold.
            Ok((session, Some(trigger))) if hotkey_from_trigger(&trigger).is_none() => {
                portal::close_session(connection, &session);
                Ok(Err(trigger))
            }
            Ok((session, Some(trigger))) => {
                adopt(connection, session, &id, Some(trigger.clone()));
                Ok(Ok((id, trigger)))
            }
            // Added with its keys cleared in GNOME's dialog: nothing to press.
            Ok((session, None)) => {
                portal::close_session(connection, &session);
                Err(format!("GNOME added no keys for {label}. Choose Apply shortcut again, then Add."))
            }
            Err(Refusal::Denied | Refusal::Ended) => Err(format!(
                "GNOME kept your earlier shortcut. To change it to {label}, choose Apply shortcut again, then Add."
            )),
            Err(Refusal::TimedOut) => {
                Err("GNOME's dialog wasn't answered. Choose Apply shortcut again.".to_string())
            }
            Err(Refusal::Failed(error)) => {
                Err(format!("GNOME couldn't change VOCO's shortcut: {error}"))
            }
        }
    })
    .unwrap_or_else(|| Err("VOCO can't reach GNOME's portal.".to_string()))?;
    match changed {
        Ok((id, trigger)) => {
            record_id(&id);
            record_bound(Some(&trigger));
            Ok(trigger)
        }
        // GNOME replaced the keys it held for VOCO with ones VOCO refuses,
        // so it holds none VOCO uses: the earlier session closes too, and
        // setup's and Settings' Add button offers VOCO's shortcut again.
        Err(trigger) => {
            unbind();
            // "<Shift>F8" as a person writes it: "Shift+F8".
            let keys = trigger
                .trim()
                .trim_start_matches("Press")
                .trim()
                .replace('<', "")
                .replace('>', "+");
            Err(format!(
                "GNOME now holds {keys}, which VOCO can't use: its shortcut needs Alt, Ctrl or Super and a key VOCO can name. Choose the Add button to set VOCO's shortcut again."
            ))
        }
    }
}

/// GNOME no longer holds keys VOCO uses: close the session and drop the
/// records, so the next bind is the Add button's, never a start's.
fn unbind() {
    close();
    for path in [bound_path(), id_path()].into_iter().flatten() {
        let _ = std::fs::remove_file(path);
    }
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

/// Through the portal VOCO can't read modifiers, so a press is held until
/// GNOME's `Deactivated`, then 400 ms for the modifier's own release, or,
/// with no `Deactivated`, until the chord has stopped repeating (AGENTS.md,
/// Delivery). Keys sent while Super or Alt is down make another chord, which
/// pastes nothing, so a paste that outwaits its bound sends none. Unknown
/// without a portal press, or once a press has gone silent.
pub fn keys_held() -> Option<bool> {
    let command = *COMMAND_PRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if command.is_some_and(|at| at.elapsed() < command_grace(repeat_delay())) {
        return Some(true);
    }
    let state = shortcut();
    if state.bus {
        return bus_held(state.activated, Instant::now(), repeat_delay());
    }
    state.session.as_ref()?;
    let pressed = state.pressed?;
    held(
        pressed,
        state.released,
        state.activated,
        Instant::now(),
        silence_window(repeat()),
    )
}

/// Held until the release and its grace. A press with no release reads as
/// unknown once nothing, a repeat included, has activated it for `silence`:
/// the modifier came up first, which GNOME reports no release for.
fn held(
    pressed: Instant,
    released: Option<Instant>,
    activated: Option<Instant>,
    now: Instant,
    silence: Duration,
) -> Option<bool> {
    let last = activated.map_or(pressed, |activated| activated.max(pressed));
    match released {
        Some(released) if released >= pressed => {
            Some(now.saturating_duration_since(released) < MODIFIER_GRACE)
        }
        _ if now.saturating_duration_since(last) >= silence => None,
        _ => Some(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// GNOME's default keyboard repeat, or with another delay.
    fn repeat_after(delay_ms: u64) -> Option<Repeat> {
        Some(Repeat {
            delay: Duration::from_millis(delay_ms),
            interval: Duration::from_millis(30),
        })
    }

    #[test]
    fn a_press_over_the_bus_holds_back_pastes_for_the_modifiers_grace() {
        let delay = Some(Duration::from_millis(500));
        let pressed = Instant::now();
        let at = |ms: u64| pressed + Duration::from_millis(ms);
        // No release ever comes: held through the repeat delay, when a held
        // chord would have repeated, and the modifier's 400 ms after it.
        assert_eq!(bus_held(Some(pressed), at(0), delay), Some(true));
        assert_eq!(bus_held(Some(pressed), at(899), delay), Some(true));
        assert_eq!(bus_held(Some(pressed), at(900), delay), None);
        // A repeat moves the wait on: the chord was still down then.
        assert_eq!(bus_held(Some(at(800)), at(1699), delay), Some(true));
        assert_eq!(bus_held(Some(at(800)), at(1700), delay), None);
        // A keyboard that doesn't repeat: the grace alone.
        assert_eq!(bus_held(Some(pressed), at(399), None), Some(true));
        assert_eq!(bus_held(Some(pressed), at(400), None), None);
        assert_eq!(bus_held(None, at(0), delay), None);
    }

    #[test]
    fn presses_over_the_bus_toggle_and_their_repeats_dont() {
        let repeat = repeat_after(500);
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut state = Shortcut::default();
        assert!(press(&mut state, at(0), repeat), "the press");
        // GNOME runs the command again at the repeat delay, then every 30 ms.
        for ms in [500, 530, 560, 590] {
            assert!(!press(&mut state, at(ms), repeat), "the repeat at {ms} ms");
        }
        // The next press, after the chord came up.
        assert!(press(&mut state, at(1800), repeat));
        // A quick second press, well before a repeat could come, toggles too.
        assert!(press(&mut state, at(2050), repeat));
    }

    #[test]
    fn a_change_of_keys_takes_the_next_id() {
        assert_eq!(next_id(FIRST_ID), "toggle-2");
        assert_eq!(next_id("toggle-2"), "toggle-3");
        assert_eq!(next_id("toggle-41"), "toggle-42");
        for id in [FIRST_ID, "toggle-2", "toggle-17"] {
            assert!(valid_id(id), "{id}");
            assert!(valid_id(&next_id(id)), "after {id}");
        }
        // Anything else in the file is not an ID VOCO wrote.
        for id in [
            "",
            "toggle-",
            "toggle-1",
            "toggle-x",
            "other",
            "toggle-2\nmore",
        ] {
            assert!(!valid_id(id), "{id:?}");
        }
    }

    #[test]
    fn a_shortcut_list_gives_the_keys_of_its_own_id_only() {
        let entry = |id: &str, trigger: &str| {
            glib::Variant::tuple_from_iter([
                id.to_variant(),
                portal::options(&[("trigger_description", trigger.to_variant())]),
            ])
        };
        let list = glib::Variant::array_from_iter_with_type(
            glib::VariantTy::new("(sa{sv})").expect("static type"),
            [
                entry("toggle", "Press <Super>x"),
                entry("toggle-2", "Press <Control><Alt>d"),
                entry("toggle-3", " "),
            ],
        );
        assert_eq!(
            trigger_of(&list, "toggle-2").as_deref(),
            Some("Press <Control><Alt>d")
        );
        assert_eq!(
            trigger_of(&list, "toggle").as_deref(),
            Some("Press <Super>x")
        );
        // Listed without keys, or not listed.
        assert_eq!(trigger_of(&list, "toggle-3"), None);
        assert_eq!(trigger_of(&list, "toggle-4"), None);
    }

    #[test]
    fn a_paste_waits_for_the_release_then_the_modifier_grace() {
        let pressed = Instant::now();
        let at = |ms| pressed + Duration::from_millis(ms);
        let silence = silence_window(repeat_after(500));
        assert_eq!(silence, Duration::from_millis(600));
        let held = |released, activated, now| held(pressed, released, activated, now, silence);
        assert_eq!(held(None, None, at(100)), Some(true), "still pressed");
        assert_eq!(
            held(Some(at(200)), None, at(300)),
            Some(true),
            "within the modifier grace"
        );
        assert_eq!(
            held(Some(at(200)), None, at(601)),
            Some(false),
            "after the grace"
        );
        assert_eq!(
            held(None, Some(at(1_970)), at(2_000)),
            Some(true),
            "a long hold repeats, so it stays held and the paste's wait sends no keys"
        );
        assert_eq!(
            held(Some(at(2_000)), Some(at(1_970)), at(2_100)),
            Some(true),
            "a long hold's release still gets the grace"
        );
        assert_eq!(
            held(None, Some(at(4_990)), at(5_500)),
            Some(true),
            "repeats keep a long hold held"
        );
        assert_eq!(
            super::held(at(500), Some(at(400)), None, at(600), silence),
            Some(true),
            "an earlier release doesn't end a newer press"
        );
    }

    #[test]
    fn a_modifier_released_first_stops_holding_back_pastes_once_no_repeat_comes() {
        // GNOME sends no `Deactivated` when Super comes up before the letter.
        let pressed = Instant::now();
        let at = |ms| pressed + Duration::from_millis(ms);
        let silence = silence_window(repeat_after(500));
        let held = |activated, now| held(pressed, None, activated, now, silence);
        assert_eq!(
            held(None, at(599)),
            Some(true),
            "a chord still held would repeat by now, give or take the margin"
        );
        assert_eq!(
            held(None, at(600)),
            None,
            "no repeat came: the modifier is up, and the paste goes out"
        );
        assert_eq!(
            held(Some(at(700)), at(1_299)),
            Some(true),
            "after a hold's last repeat, the same silence"
        );
        assert_eq!(held(Some(at(700)), at(1_300)), None);
        // A shorter repeat delay is known sooner, a longer one later.
        assert_eq!(
            silence_window(repeat_after(250)),
            Duration::from_millis(350)
        );
        assert_eq!(
            silence_window(repeat_after(2_000)),
            Duration::from_millis(2_100)
        );
        // Without keyboard repeat a hold stays silent too.
        assert_eq!(silence_window(None), STALE_REPEAT + REPEAT_MARGIN);
    }

    #[test]
    fn a_held_chords_repeats_never_toggle() {
        let start = Instant::now();
        let at = |ms| start + Duration::from_millis(ms);
        let repeat = repeat_after(500);
        let down = Shortcut {
            pressed: Some(at(0)),
            activated: Some(at(0)),
            ..Shortcut::default()
        };
        assert!(
            is_repeat(&down, at(500), repeat),
            "the first repeat, after the delay"
        );
        let repeating = Shortcut {
            pressed: Some(at(0)),
            activated: Some(at(530)),
            repeating: true,
            ..Shortcut::default()
        };
        assert!(
            is_repeat(&repeating, at(560), repeat),
            "repeats about every 30 ms"
        );
        assert!(
            is_repeat(&repeating, at(900), repeat),
            "a stalled repeat is still one"
        );
        let up = Shortcut {
            pressed: Some(at(0)),
            released: Some(at(600)),
            activated: Some(at(560)),
            repeating: true,
            ..Shortcut::default()
        };
        assert!(
            !is_repeat(&up, at(700), repeat),
            "a press after the release toggles"
        );
        assert!(
            !is_repeat(&down, at(2_000), repeat),
            "after a silence no hold leaves, a press toggles with no Deactivated"
        );
        assert!(
            is_repeat(&down, at(800), None),
            "without keyboard repeat a lost release still can't swallow presses for long"
        );
        assert!(!is_repeat(&down, at(1_000), None));
    }

    #[test]
    fn a_press_soon_after_the_modifier_came_up_first_toggles() {
        // No `Deactivated` followed the press: Super was let go before the letter.
        let start = Instant::now();
        let at = |ms| start + Duration::from_millis(ms);
        let repeat = repeat_after(500);
        let pressed = Shortcut {
            pressed: Some(at(0)),
            activated: Some(at(0)),
            ..Shortcut::default()
        };
        assert!(
            !is_repeat(&pressed, at(250), repeat),
            "too soon for the first repeat, too slow for a repeat's rhythm: a press"
        );
        assert!(
            !is_repeat(&pressed, at(399), repeat),
            "still before the first repeat could come"
        );
        assert!(
            is_repeat(&pressed, at(400), repeat),
            "where the first repeat may fall, it counts as one"
        );
        assert!(is_repeat(&pressed, at(599), repeat));
        assert!(
            !is_repeat(&pressed, at(600), repeat),
            "past the first repeat's time the chord had gone silent: a press"
        );
        // A first repeat that came late toggled as a press; the rest of its
        // train, at the repeat interval, doesn't.
        let late = Shortcut {
            pressed: Some(at(650)),
            activated: Some(at(650)),
            ..Shortcut::default()
        };
        assert!(is_repeat(&late, at(680), repeat));
        // After a long hold's last repeat, the same silence ends it.
        let held = Shortcut {
            pressed: Some(at(0)),
            activated: Some(at(900)),
            repeating: true,
            ..Shortcut::default()
        };
        assert!(!is_repeat(&held, at(1_500), repeat));
    }

    #[test]
    fn a_custom_shortcuts_repeats_never_toggle() {
        let start = Instant::now();
        let at = |ms| start + Duration::from_millis(ms);
        let window = command_window(Some(Duration::from_millis(500)));
        assert!(
            !within_repeat(None, at(0), window),
            "the first press toggles"
        );
        assert!(
            within_repeat(Some(at(0)), at(820), window),
            "the first repeat doesn't, even when its launch was slow"
        );
        assert!(within_repeat(Some(at(820)), at(850), window));
        assert!(
            !within_repeat(Some(at(850)), at(1_800), window),
            "a press after the release does"
        );
        assert!(
            !within_repeat(Some(at(0)), at(50), None),
            "no repeat, no filter"
        );
        assert_eq!(
            command_grace(Some(Duration::from_millis(500))),
            Duration::from_millis(900)
        );
        assert_eq!(command_grace(None), COMMAND_GRACE);
    }
}
