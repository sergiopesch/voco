//! The snap's shortcut on GNOME Wayland without the companion (AGENTS.md,
//! Shortcut): VOCO's own GNOME custom shortcut (gnome_custom_shortcut.rs),
//! whose command calls the running VOCO's `Toggle` over D-Bus.
//!
//! GNOME's keyboard shortcuts ask nobody, so setup adds VOCO's by itself when
//! nothing else uses the keys, and Settings and the tray move it at once.
//! GNOME runs the command for the press and again for each repeat while the
//! chord is held, and reports no release of either key: a press is told from
//! a repeat by GNOME's repeat timing, and a paste waits by it wherever GNOME
//! doesn't say which modifiers are down.

use crate::gnome_custom_shortcut as custom;
use crate::shortcut_chord::{hotkey_from_accelerator, Chord};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};
use webkit2gtk::gio::{self, prelude::SettingsExt};

/// VOCO 2026.0.70 to 2026.0.72 recorded here, beside the config, that GNOME
/// held the shortcut: through its GlobalShortcuts portal on GNOME 48 and
/// later, under the ID in the second file once Settings had changed its keys.
const PORTAL_RECORDS: [&str; 2] = ["global-shortcut", "global-shortcut-id"];
/// After the last sign of the chord, time for its modifier's own release.
/// People often let go of Super or Alt a moment after the letter, and keys
/// sent while it is down make another chord, which pastes nothing.
const MODIFIER_GRACE: Duration = Duration::from_millis(400);
/// How far a repeat may trail the time GNOME's keyboard repeat gives it.
const REPEAT_MARGIN: Duration = Duration::from_millis(100);

/// The `Toggle` calls of GNOME's shortcut, a held chord's repeats included.
#[derive(Default)]
struct Presses {
    last: Option<Instant>,
    /// That call was a repeat: the chord was still held then.
    repeating: bool,
}

static PRESSES: Mutex<Presses> = Mutex::new(Presses {
    last: None,
    repeating: false,
});
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn presses() -> MutexGuard<'static, Presses> {
    PRESSES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// GNOME's keyboard repeat: a held key repeats after `delay`, then every
/// `interval`.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Repeat {
    delay: Duration,
    interval: Duration,
}

/// GNOME repeats a held shortcut's press about every 30 ms once the
/// keyboard's repeat delay has passed, so only a press toggles (AGENTS.md,
/// Shortcut). None when the keyboard doesn't repeat. Read once: GNOME's
/// defaults are 500 ms and 30 ms.
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

/// A held chord's repeated call, by the time since the last one. After a
/// press the first repeat comes one repeat delay later, give or take the
/// margin; the rest follow each other at the repeat interval, and a gap as
/// long as a first repeat's is no such train. A call at once after a press is
/// the same press. Anything else is a new press: one soon after the last,
/// well before a repeat could come, and one after the chord went silent past
/// the repeat delay, when a chord still held would have repeated.
///
/// One press this can't tell: a second one that comes about a repeat delay
/// after the first reads as its repeat. GNOME's own report of the modifiers,
/// where there is one, settles it first (`bus_press`).
fn is_repeat(state: &Presses, now: Instant, repeat: Repeat) -> bool {
    let Some(last) = state.last else {
        return false;
    };
    let gap = now.saturating_duration_since(last);
    let train = repeat.interval + REPEAT_MARGIN;
    if state.repeating {
        return gap < repeat.delay.saturating_sub(REPEAT_MARGIN).max(train);
    }
    gap < train
        || (gap + REPEAT_MARGIN >= repeat.delay
            && gap < repeat.delay.max(repeat.interval) + REPEAT_MARGIN)
}

/// The snap holds its shortcut this way on GNOME Wayland.
pub fn applies() -> bool {
    crate::portal_keys::applies()
}

/// VOCO can keep its shortcut in GNOME's keyboard shortcuts here.
pub fn available() -> bool {
    applies() && custom::available()
}

/// GNOME's shortcut called VOCO's Toggle over D-Bus (panel.rs), as it does
/// for the press and for each repeat while the chord is held. The call
/// arrives within a few milliseconds, so repeats come at GNOME's own timing.
/// False for a repeat, which doesn't toggle.
pub fn note_bus_press() -> bool {
    // While a dictation's typing session is open, GNOME 50 and later say
    // whether the chord's modifier came up since the last call.
    let last = presses().last;
    let lifted = last.and_then(crate::portal_keys::modifiers_lifted_since);
    bus_press(&mut presses(), Instant::now(), repeat(), lifted)
}

/// A Toggle call: a press, or a held chord's repeat of one. `lifted` is
/// GNOME's word on whether every modifier was up since the last call: a
/// chord whose modifier came up in between is a new press whatever the
/// timing says, as when the shortcut is pressed to stop half a second after
/// it started the dictation. A keyboard that doesn't repeat sends no repeat
/// to tell apart, and this route reports no release that would end a held
/// press, so every call is then a press.
fn bus_press(
    state: &mut Presses,
    now: Instant,
    repeat: Option<Repeat>,
    lifted: Option<bool>,
) -> bool {
    let repeated =
        lifted != Some(true) && repeat.is_some_and(|repeat| is_repeat(state, now, repeat));
    state.last = Some(now);
    state.repeating = repeated;
    !repeated
}

/// How long after the last Toggle call, a repeat included, a paste waits
/// where GNOME doesn't say which modifiers are down. Without a repeat the
/// letter came up within the repeat delay, and the modifier gets its grace
/// after that: people often let go of it a moment later.
fn bus_grace(delay: Option<Duration>) -> Duration {
    delay.map_or(MODIFIER_GRACE, |delay| delay + MODIFIER_GRACE)
}

/// Whether a press over D-Bus still counts as held: unknown once its grace
/// has passed, which holds back no paste.
fn bus_held(last: Option<Instant>, now: Instant, delay: Option<Duration>) -> Option<bool> {
    (now.saturating_duration_since(last?) < bus_grace(delay)).then_some(true)
}

/// Where the shortcut's command can't call VOCO it runs `voco --toggle`,
/// with no release to wait for either: a paste waits this long after it, or
/// after its last repeat, for the chord's keys to come up (AGENTS.md,
/// Delivery).
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

/// Within `window` of the last press or repeat; never without a window.
fn within_repeat(last: Option<Instant>, now: Instant, window: Option<Duration>) -> bool {
    match (last, window) {
        (Some(last), Some(window)) => now.saturating_duration_since(last) < window,
        _ => false,
    }
}

/// A `voco --toggle` reached the snap. False for a held chord's repeat, which
/// GNOME's shortcut runs too: it doesn't toggle.
pub fn note_command_press() -> bool {
    let now = Instant::now();
    let mut last = COMMAND_PRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let repeat = within_repeat(*last, now, command_window(repeat_delay()));
    *last = Some(now);
    !repeat
}

/// This route reports no release, so where GNOME's keyboard connection
/// doesn't say which modifiers are down (portal_keys.rs), a press counts as
/// held for the keyboard's repeat delay and the modifier's grace after its
/// last call (AGENTS.md, Delivery). Keys sent while Super or Alt is down make
/// another chord, which pastes nothing, so a paste that outwaits its bound
/// sends none. Unknown without a press, or once its grace has passed.
pub fn keys_held() -> Option<bool> {
    let command = *COMMAND_PRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if command.is_some_and(|at| at.elapsed() < command_grace(repeat_delay())) {
        return Some(true);
    }
    bus_held(presses().last, Instant::now(), repeat_delay())
}

/// VOCO's GNOME shortcut exists for `hotkey`, with VOCO's command.
pub fn present(hotkey: &str) -> bool {
    Chord::of(hotkey).is_some_and(|chord| custom::present(&chord.gtk_accelerator()))
}

/// VOCO's GNOME shortcut, added or moved to `hotkey`'s keys, or the reason
/// it wasn't: something else in GNOME uses them, or GNOME can't hold them.
/// GNOME's keyboard shortcuts ask nobody, so neither does this.
pub fn hold(hotkey: &str) -> Result<(), String> {
    if !available() {
        return Err(
            "VOCO keeps a GNOME keyboard shortcut only in the snap on GNOME Wayland.".into(),
        );
    }
    let chord = Chord::of(hotkey)
        .ok_or_else(|| {
            format!("GNOME's keyboard shortcuts can't hold {hotkey}. Choose another shortcut.")
        })?
        .gtk_accelerator();
    custom::add(&chord, hotkey)
}

fn config_file(name: &str) -> Option<std::path::PathBuf> {
    crate::config::AppConfig::config_dir_without_migration()
        .ok()
        .map(|dir| dir.join(name))
}

fn drop_portal_records() {
    for path in PORTAL_RECORDS.into_iter().filter_map(config_file) {
        let _ = std::fs::remove_file(path);
    }
}

/// For Reset: VOCO's GNOME shortcut goes with the settings, and setup adds
/// it again.
pub fn forget() {
    drop_portal_records();
    if applies() {
        custom::remove();
    }
}

/// What a start does with an earlier VOCO's record that GNOME held the
/// shortcut.
#[derive(Debug, PartialEq, Eq)]
enum Handover {
    /// VOCO's GNOME shortcut already exists, as on GNOME 46, or this GNOME
    /// never had the portal: only the record goes.
    DropRecord,
    /// The portal held the chord and nothing holds it now: VOCO's GNOME
    /// shortcut takes the same keys.
    Add,
}

fn handover(listed: bool, had_portal: bool) -> Handover {
    if !listed && had_portal {
        Handover::Add
    } else {
        Handover::DropRecord
    }
}

/// VOCO 2026.0.70 to 2026.0.72 held this shortcut through GNOME's
/// GlobalShortcuts portal on GNOME 48 and later. The person agreed to those
/// keys in GNOME's dialog, so a start hands them to VOCO's GNOME shortcut
/// once, and the record goes. Kept when the keys are taken meanwhile, so the
/// next start tries again and Settings offers its Add button. GNOME 46 wrote
/// the same record beside its custom shortcut, and one removed there in
/// GNOME Settings stays removed.
fn hand_over_from_portal(hotkey: &str) {
    if !config_file(PORTAL_RECORDS[0]).is_some_and(|path| path.exists()) {
        return;
    }
    let listed = custom::listed();
    let had_portal = !listed && crate::portal_keys::gnome_has_shortcut_portal();
    match handover(listed, had_portal) {
        Handover::DropRecord => drop_portal_records(),
        Handover::Add => match hold(hotkey) {
            Ok(()) => {
                log::info!(
                    "VOCO's shortcut moved from GNOME's portal to GNOME's keyboard shortcuts"
                );
                drop_portal_records();
            }
            Err(error) => {
                log::warn!("VOCO's shortcut didn't move to GNOME's keyboard shortcuts: {error}")
            }
        },
    }
}

/// A saved change of shortcut: VOCO's GNOME shortcut takes the new keys
/// first, added if GNOME lists none, and GNOME refusing them, because
/// something else uses them, refuses the change. Nothing to do outside the
/// snap on GNOME Wayland, or when it already has them.
pub fn keep_in_step(hotkey: &str) -> Result<(), String> {
    if !available() || present(hotkey) {
        return Ok(());
    }
    hold(hotkey)
}

thread_local! {
    /// Kept for the process's life, so its change signal stays connected.
    static WATCHED: std::cell::RefCell<Option<gio::Settings>> = const { std::cell::RefCell::new(None) };
}

/// GNOME Settings, under Keyboard, changes the keys of VOCO's shortcut:
/// VOCO's config follows, so its labels name the keys GNOME listens for.
/// Keys VOCO can't take are left alone, and Settings then offers its own.
fn follow(binding: &str) {
    let Some(hotkey) = hotkey_from_accelerator(binding) else {
        return;
    };
    if let Some(app) = APP.get() {
        crate::follow_gnome_shortcut(app, hotkey);
    }
}

/// At startup, on GTK's thread: hand over an earlier VOCO's portal shortcut,
/// give VOCO's GNOME shortcut this VOCO's command, and follow its keys.
pub fn setup(app: &tauri::AppHandle, hotkey: &str) {
    let _ = APP.set(app.clone());
    if !available() {
        return;
    }
    hand_over_from_portal(hotkey);
    custom::update_command();
    if let Some(binding) = custom::binding() {
        follow(&binding);
    }
    if let Some(settings) = custom::watch(follow) {
        WATCHED.with(|watched| *watched.borrow_mut() = Some(settings));
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
        let mut state = Presses::default();
        assert!(bus_press(&mut state, at(0), repeat, None), "the press");
        // GNOME runs the command again at the repeat delay, then every 30 ms.
        for ms in [500, 530, 560, 590] {
            assert!(
                !bus_press(&mut state, at(ms), repeat, None),
                "the repeat at {ms} ms"
            );
        }
        // The next press, after the chord came up.
        assert!(bus_press(&mut state, at(1800), repeat, None));
        // A quick second press, well before a repeat could come, toggles too.
        assert!(bus_press(&mut state, at(2050), repeat, None));
    }

    #[test]
    fn a_chord_held_for_seconds_toggles_once_and_keeps_its_paste_waiting() {
        // What GNOME 50 did with Super+X held for 2 s: the press, a first
        // repeat 504 ms later, then one about every 30 ms.
        let repeat = repeat_after(500);
        let delay = Some(Duration::from_millis(500));
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut state = Presses::default();
        let mut toggles = usize::from(bus_press(&mut state, at(0), repeat, None));
        let mut last = 0;
        for ms in (504..2_000).step_by(30) {
            // GNOME reports the modifier down throughout, where it reports.
            for lifted in [None, Some(false)] {
                let mut copy = Presses {
                    last: state.last,
                    repeating: state.repeating,
                };
                assert!(!bus_press(&mut copy, at(ms), repeat, lifted), "{ms} ms");
            }
            toggles += usize::from(bus_press(&mut state, at(ms), repeat, Some(false)));
            last = ms;
        }
        assert_eq!(toggles, 1);
        assert_eq!(bus_held(state.last, at(last + 899), delay), Some(true));
        assert_eq!(bus_held(state.last, at(last + 900), delay), None);
        // A stall between two repeats, short of a first repeat's wait, is
        // still the train.
        assert!(!bus_press(&mut state, at(last + 300), repeat, None));
        // Let go, the next press toggles.
        assert!(bus_press(&mut state, at(last + 1_000), repeat, None));
    }

    #[test]
    fn a_slow_first_repeat_is_still_a_repeat() {
        // A repeat may trail GNOME's timing by the margin, and come early by it.
        let repeat = repeat_after(500);
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        for first in [400, 500, 599] {
            let mut state = Presses::default();
            assert!(bus_press(&mut state, at(0), repeat, None));
            assert!(
                !bus_press(&mut state, at(first), repeat, None),
                "a first repeat at {first} ms"
            );
            assert!(!bus_press(&mut state, at(first + 30), repeat, None));
        }
        // Past the delay and its margin the chord had gone silent: a press.
        let mut state = Presses::default();
        assert!(bus_press(&mut state, at(0), repeat, None));
        assert!(bus_press(&mut state, at(600), repeat, None));
    }

    #[test]
    fn a_press_half_a_second_after_the_last_is_new_once_gnome_saw_the_modifier_up() {
        let repeat = repeat_after(500);
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        // Start, then stop 500 ms later, the time a first repeat takes. During
        // a dictation GNOME 50 reports the modifier up in between.
        let mut state = Presses::default();
        assert!(bus_press(&mut state, at(0), repeat, None));
        assert!(bus_press(&mut state, at(500), repeat, Some(true)));
        assert!(bus_press(&mut state, at(1_000), repeat, Some(true)));
        // Without that report the timing alone reads the second as a repeat.
        // The third, as far behind it, is no repeat train: it toggles, so
        // presses at that pace never all go unanswered.
        let mut state = Presses::default();
        let toggled: Vec<bool> = [0, 500, 1_000, 1_500, 2_000]
            .into_iter()
            .map(|ms| bus_press(&mut state, at(ms), repeat, None))
            .collect();
        assert_eq!(toggled, [true, false, true, false, true]);
        // The modifier held throughout, by GNOME's word: the timing decides.
        let mut state = Presses::default();
        assert!(bus_press(&mut state, at(0), repeat, None));
        assert!(!bus_press(&mut state, at(500), repeat, Some(false)));
    }

    #[test]
    fn without_keyboard_repeat_every_call_over_the_bus_is_a_press() {
        // No repeat can arrive, and no release ever does.
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut state = Presses::default();
        for ms in [0, 300, 800, 1300, 1500, 4000] {
            assert!(
                bus_press(&mut state, at(ms), None, None),
                "the press at {ms} ms"
            );
        }
        // The paste after the last one still waits out the modifier's grace.
        assert_eq!(bus_held(state.last, at(4100), None), Some(true));
        assert_eq!(bus_held(state.last, at(4500), None), None);
    }

    #[test]
    fn a_shortcut_the_portal_held_is_handed_over_once() {
        // GNOME 48 and later with 2026.0.70 to 2026.0.72: the portal held it.
        assert_eq!(handover(false, true), Handover::Add);
        // GNOME 46 wrote the same record beside its custom shortcut, and one
        // removed there in GNOME Settings stays removed.
        assert_eq!(handover(true, false), Handover::DropRecord);
        assert_eq!(handover(false, false), Handover::DropRecord);
        // Already added, as after a handover whose record couldn't be deleted.
        assert_eq!(handover(true, true), Handover::DropRecord);
    }

    #[test]
    fn a_command_shortcuts_repeats_never_toggle() {
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
