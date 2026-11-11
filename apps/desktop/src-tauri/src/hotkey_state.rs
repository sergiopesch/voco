//! Physical-key state for the passive Linux evdev fallback. Each open device
//! owns its keys; unplugging one keyboard cannot leave global modifiers stuck.
use crate::Preset;
use evdev::{EventSummary, InputEvent, KeyCode, SynchronizationCode};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const ALT: [KeyCode; 2] = [KeyCode::KEY_LEFTALT, KeyCode::KEY_RIGHTALT];
const SUPER: [KeyCode; 2] = [KeyCode::KEY_LEFTMETA, KeyCode::KEY_RIGHTMETA];
const SHIFT: [KeyCode; 2] = [KeyCode::KEY_LEFTSHIFT, KeyCode::KEY_RIGHTSHIFT];
const CONTROL: [KeyCode; 2] = [KeyCode::KEY_LEFTCTRL, KeyCode::KEY_RIGHTCTRL];

/// A preset's physical keys: either key of its one modifier, Shift only when
/// the preset names it, and its letter.
struct Chord {
    modifier: [KeyCode; 2],
    shift: bool,
    key: KeyCode,
}

impl Chord {
    fn of(preset: Preset) -> Self {
        match preset {
            Preset::SuperX => Self {
                modifier: SUPER,
                shift: false,
                key: KeyCode::KEY_X,
            },
            Preset::AltD => Self {
                modifier: ALT,
                shift: false,
                key: KeyCode::KEY_D,
            },
            Preset::AltShiftD => Self {
                modifier: ALT,
                shift: true,
                key: KeyCode::KEY_D,
            },
        }
    }

    fn typable(&self, supported: &HashSet<KeyCode>) -> bool {
        let either = |pair: [KeyCode; 2]| pair.iter().any(|key| supported.contains(key));
        either(self.modifier) && (!self.shift || either(SHIFT)) && supported.contains(&self.key)
    }
}

/// The presets a keyboard with these keys can type.
pub(crate) fn typable_presets(supported: impl IntoIterator<Item = KeyCode>) -> Vec<Preset> {
    let supported = supported.into_iter().collect();
    Preset::ALL
        .into_iter()
        .filter(|preset| Chord::of(*preset).typable(&supported))
        .collect()
}

/// An open, synchronized keyboard: the keys it holds, and the presets it can
/// type.
struct Keyboard {
    keys: HashSet<KeyCode>,
    typable: Vec<Preset>,
}

#[derive(Default)]
pub(crate) struct HotkeyState {
    devices: HashMap<PathBuf, Keyboard>,
    resynchronizing: HashSet<PathBuf>,
}

impl HotkeyState {
    /// Synchronize a newly opened device without treating already-held keys as
    /// fresh presses. Replacement devices never inherit the previous state.
    pub(crate) fn attach(
        &mut self,
        device: &Path,
        keys: impl IntoIterator<Item = KeyCode>,
        typable: Vec<Preset>,
    ) {
        let keys = keys.into_iter().collect();
        self.devices
            .insert(device.to_path_buf(), Keyboard { keys, typable });
        self.resynchronizing.remove(device);
    }

    pub(crate) fn detach(&mut self, device: &Path) {
        self.devices.remove(device);
        self.resynchronizing.remove(device);
    }

    /// Open, synchronized keyboards that can type a preset's chord, not
    /// discovered paths. One that is resynchronizing doesn't count, and never
    /// hides the others.
    pub(crate) fn keyboards_for(&self, preset: Preset) -> usize {
        self.devices
            .values()
            .filter(|keyboard| keyboard.typable.contains(&preset))
            .count()
    }

    /// Unknown until every watched keyboard is synchronized.
    pub(crate) fn modifiers_held(&self) -> Option<bool> {
        if self.devices.is_empty() || !self.resynchronizing.is_empty() {
            return None;
        }
        Some(self.devices.values().any(|keyboard| {
            [ALT, SHIFT, CONTROL, SUPER]
                .iter()
                .flatten()
                .any(|modifier| keyboard.keys.contains(modifier))
        }))
    }

    /// Count the batch's dictation toggles, or discard an incomplete kernel batch
    /// and require a fresh state query after SYN_REPORT. Resynchronization never
    /// creates activation events.
    pub(crate) fn batch(
        &mut self,
        device: &Path,
        events: &[InputEvent],
        preset: Option<Preset>,
    ) -> (usize, bool) {
        let mut toggles = 0;
        let mut needs_sync = false;
        for event in events {
            if matches!(
                event.destructure(),
                EventSummary::Synchronization(_, SynchronizationCode::SYN_DROPPED, _)
            ) {
                self.devices.remove(device);
                self.resynchronizing.insert(device.to_path_buf());
                toggles = 0;
                needs_sync = false;
                continue;
            }
            if self.resynchronizing.contains(device) {
                if matches!(
                    event.destructure(),
                    EventSummary::Synchronization(_, SynchronizationCode::SYN_REPORT, _)
                ) {
                    needs_sync = true;
                }
                continue;
            }
            if let EventSummary::Key(_, key, value) = event.destructure() {
                if self.event(device, key, value, preset) {
                    toggles += 1;
                }
            }
        }
        (toggles, needs_sync)
    }

    /// Whether this key event completes the preset's chord; never without one.
    pub(crate) fn event(
        &mut self,
        device: &Path,
        key: KeyCode,
        value: i32,
        preset: Option<Preset>,
    ) -> bool {
        let Some(Keyboard { keys, .. }) = self.devices.get_mut(device) else {
            return false;
        };
        match value {
            0 => {
                keys.remove(&key);
                return false;
            }
            1 if keys.insert(key) => {}
            // Repeats must neither toggle nor release held modifiers.
            _ => return false,
        }
        let Some(preset) = preset else {
            return false;
        };
        // Until every connected stream is synchronized, an unseen modifier
        // could make a nominal chord inexact.
        if !self.resynchronizing.is_empty() {
            return false;
        }
        let held = |pair: [KeyCode; 2]| {
            self.devices
                .values()
                .any(|keyboard| pair.iter().any(|key| keyboard.keys.contains(key)))
        };
        let chord = Chord::of(preset);
        // Exact modifiers, on any keyboard: the chord's own, Shift only when it
        // names Shift, and no other. Super+X never fires with Alt held, nor
        // Alt+D with Super.
        let exact = [ALT, SUPER]
            .into_iter()
            .all(|pair| held(pair) == (pair == chord.modifier))
            && held(SHIFT) == chord.shift
            && !held(CONTROL);
        exact && key == chord.key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_SHIFT: [KeyCode; 4] = [
        KeyCode::KEY_LEFTALT,
        KeyCode::KEY_LEFTMETA,
        KeyCode::KEY_D,
        KeyCode::KEY_X,
    ];

    fn full() -> Vec<Preset> {
        typable_presets(NO_SHIFT.into_iter().chain([KeyCode::KEY_LEFTSHIFT]))
    }

    fn state() -> HotkeyState {
        let mut state = HotkeyState::default();
        state.attach(Path::new("first"), [], full());
        state.attach(Path::new("second"), [], full());
        state
    }

    const SUPER_X: Option<Preset> = Some(Preset::SuperX);
    const ALT_D: Option<Preset> = Some(Preset::AltD);
    const ALT_SHIFT_D: Option<Preset> = Some(Preset::AltShiftD);

    fn key(
        state: &mut HotkeyState,
        device: &str,
        key: KeyCode,
        value: i32,
        preset: Option<Preset>,
    ) -> bool {
        state.event(Path::new(device), key, value, preset)
    }

    #[test]
    fn exact_modifiers_reject_ctrl_and_super_on_either_keyboard() {
        for extra in [
            KeyCode::KEY_LEFTCTRL,
            KeyCode::KEY_RIGHTCTRL,
            KeyCode::KEY_LEFTMETA,
            KeyCode::KEY_RIGHTMETA,
        ] {
            let mut state = state();
            key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
            key(&mut state, "second", extra, 1, ALT_D);
            assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
            key(&mut state, "first", KeyCode::KEY_D, 0, ALT_D);
            key(&mut state, "second", extra, 0, ALT_D);
            assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        }
    }

    #[test]
    fn super_x_needs_super_alone_on_either_keyboard() {
        for extra in [
            KeyCode::KEY_LEFTALT,
            KeyCode::KEY_RIGHTALT,
            KeyCode::KEY_LEFTCTRL,
            KeyCode::KEY_RIGHTCTRL,
            KeyCode::KEY_LEFTSHIFT,
            KeyCode::KEY_RIGHTSHIFT,
        ] {
            let mut state = state();
            key(&mut state, "first", KeyCode::KEY_LEFTMETA, 1, SUPER_X);
            key(&mut state, "second", extra, 1, SUPER_X);
            assert!(!key(&mut state, "first", KeyCode::KEY_X, 1, SUPER_X));
            key(&mut state, "first", KeyCode::KEY_X, 0, SUPER_X);
            key(&mut state, "second", extra, 0, SUPER_X);
            assert!(key(&mut state, "first", KeyCode::KEY_X, 1, SUPER_X));
        }
        let mut state = state();
        key(&mut state, "second", KeyCode::KEY_RIGHTMETA, 1, SUPER_X);
        assert!(key(&mut state, "first", KeyCode::KEY_X, 1, SUPER_X));
    }

    #[test]
    fn each_preset_takes_only_its_own_modifier_and_letter() {
        let mut state = state();
        key(&mut state, "first", KeyCode::KEY_LEFTMETA, 1, SUPER_X);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, SUPER_X));
        key(&mut state, "first", KeyCode::KEY_D, 0, SUPER_X);
        // Super held makes Alt+D inexact, and Super+X is no Alt chord.
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        key(&mut state, "first", KeyCode::KEY_D, 0, ALT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTMETA, 0, ALT_D);
        assert!(!key(&mut state, "first", KeyCode::KEY_X, 1, ALT_D));
        key(&mut state, "first", KeyCode::KEY_X, 0, ALT_D);
        assert!(!key(&mut state, "first", KeyCode::KEY_X, 1, SUPER_X));
        key(&mut state, "first", KeyCode::KEY_X, 0, SUPER_X);
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
    }

    #[test]
    fn releasing_one_alt_does_not_release_the_other() {
        let mut state = state();
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
        key(&mut state, "first", KeyCode::KEY_RIGHTALT, 1, ALT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 0, ALT_D);
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
    }

    #[test]
    fn modifiers_from_two_devices_are_independent_and_unplug_clears_only_owner() {
        let mut state = state();
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
        key(&mut state, "second", KeyCode::KEY_LEFTALT, 1, ALT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 0, ALT_D);
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        key(&mut state, "first", KeyCode::KEY_D, 0, ALT_D);
        state.detach(Path::new("second"));
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
    }

    #[test]
    fn repeat_and_duplicate_press_do_not_toggle_or_clear_modifiers() {
        let mut state = state();
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 2, ALT_D);
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 2, ALT_D));
    }

    #[test]
    fn modes_require_exact_shift_state() {
        let mut state = state();
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_SHIFT_D);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_SHIFT_D));
        key(&mut state, "first", KeyCode::KEY_D, 0, ALT_SHIFT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTSHIFT, 1, ALT_SHIFT_D);
        key(&mut state, "first", KeyCode::KEY_RIGHTSHIFT, 1, ALT_SHIFT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTSHIFT, 0, ALT_SHIFT_D);
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_SHIFT_D));
        key(&mut state, "first", KeyCode::KEY_D, 0, ALT_D);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        // Evdev never toggles a custom shortcut, even with Alt+Shift held.
        key(&mut state, "first", KeyCode::KEY_D, 0, None);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, None));
    }

    #[test]
    fn dropped_kernel_events_clear_state_and_never_fabricate_activation() {
        use evdev::EventType;
        let mut state = state();
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
        let events = [
            InputEvent::new(EventType::KEY.0, KeyCode::KEY_D.code(), 1),
            InputEvent::new(
                EventType::SYNCHRONIZATION.0,
                SynchronizationCode::SYN_DROPPED.0,
                0,
            ),
            InputEvent::new(EventType::KEY.0, KeyCode::KEY_D.code(), 1),
        ];
        assert_eq!(state.batch(Path::new("first"), &events, ALT_D), (0, false));
        key(&mut state, "second", KeyCode::KEY_LEFTALT, 1, ALT_D);
        assert!(!key(&mut state, "second", KeyCode::KEY_D, 1, ALT_D));
        let report = [InputEvent::new(
            EventType::SYNCHRONIZATION.0,
            SynchronizationCode::SYN_REPORT.0,
            0,
        )];
        assert_eq!(state.batch(Path::new("first"), &report, ALT_D), (0, true));
        state.attach(
            Path::new("first"),
            [KeyCode::KEY_LEFTALT, KeyCode::KEY_D],
            full(),
        );
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        key(&mut state, "first", KeyCode::KEY_D, 0, ALT_D);
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
    }

    #[test]
    fn modifier_state_is_unknown_until_every_keyboard_is_synchronized() {
        assert_eq!(HotkeyState::default().modifiers_held(), None);
        let mut state = state();
        assert_eq!(state.modifiers_held(), Some(false));
        key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D);
        assert_eq!(state.modifiers_held(), Some(false));
        key(&mut state, "second", KeyCode::KEY_RIGHTMETA, 1, ALT_D);
        assert_eq!(state.modifiers_held(), Some(true));
        key(&mut state, "second", KeyCode::KEY_RIGHTMETA, 0, ALT_D);
        assert_eq!(state.modifiers_held(), Some(false));
        let dropped = [InputEvent::new(
            evdev::EventType::SYNCHRONIZATION.0,
            SynchronizationCode::SYN_DROPPED.0,
            0,
        )];
        state.batch(Path::new("first"), &dropped, ALT_D);
        assert_eq!(state.modifiers_held(), None);
        state.attach(Path::new("first"), [KeyCode::KEY_LEFTSHIFT], full());
        assert_eq!(state.modifiers_held(), Some(true));
    }

    #[test]
    fn a_keyboard_detached_while_resynchronizing_stops_blocking_the_chord() {
        let mut state = state();
        let dropped = [InputEvent::new(
            evdev::EventType::SYNCHRONIZATION.0,
            SynchronizationCode::SYN_DROPPED.0,
            0,
        )];
        state.batch(Path::new("second"), &dropped, ALT_D);
        key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        key(&mut state, "first", KeyCode::KEY_D, 0, ALT_D);
        state.detach(Path::new("second"));
        assert!(key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        assert_eq!(state.modifiers_held(), Some(true));
    }

    #[test]
    fn only_open_synchronized_keyboards_count_for_their_chord() {
        let mut state = HotkeyState::default();
        let counts = |state: &HotkeyState| {
            (
                state.keyboards_for(Preset::SuperX),
                state.keyboards_for(Preset::AltD),
                state.keyboards_for(Preset::AltShiftD),
            )
        };
        assert_eq!(counts(&state), (0, 0, 0));
        state.attach(Path::new("full"), [], full());
        state.attach(Path::new("no-shift"), [], typable_presets(NO_SHIFT));
        state.attach(
            Path::new("no-super"),
            [],
            typable_presets([KeyCode::KEY_RIGHTALT, KeyCode::KEY_D, KeyCode::KEY_X]),
        );
        assert_eq!(counts(&state), (2, 3, 1));
        let dropped = [InputEvent::new(
            evdev::EventType::SYNCHRONIZATION.0,
            SynchronizationCode::SYN_DROPPED.0,
            0,
        )];
        state.batch(Path::new("full"), &dropped, ALT_D);
        assert_eq!(counts(&state), (1, 2, 0));
        state.attach(Path::new("full"), [], full());
        assert_eq!(counts(&state), (2, 3, 1));
        state.detach(Path::new("no-shift"));
        assert_eq!(counts(&state), (1, 2, 1));
    }

    #[test]
    fn a_keyboard_types_a_preset_only_with_all_its_keys() {
        assert_eq!(full(), Preset::ALL);
        assert_eq!(
            typable_presets([KeyCode::KEY_RIGHTMETA, KeyCode::KEY_X]),
            [Preset::SuperX]
        );
        assert_eq!(
            typable_presets([
                KeyCode::KEY_LEFTALT,
                KeyCode::KEY_RIGHTSHIFT,
                KeyCode::KEY_D
            ]),
            [Preset::AltD, Preset::AltShiftD]
        );
        for unable in [
            &[KeyCode::KEY_LEFTMETA, KeyCode::KEY_D][..],
            &[KeyCode::KEY_LEFTALT, KeyCode::KEY_X],
            &[KeyCode::KEY_X, KeyCode::KEY_D, KeyCode::KEY_LEFTSHIFT],
        ] {
            assert!(typable_presets(unable.iter().copied()).is_empty());
        }
    }

    #[test]
    fn reconnect_is_fresh_and_initial_held_key_does_not_toggle() {
        let mut state = state();
        state.attach(
            Path::new("first"),
            [KeyCode::KEY_LEFTALT, KeyCode::KEY_D],
            full(),
        );
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        state.detach(Path::new("first"));
        assert!(!key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D));
        state.attach(Path::new("first"), [], full());
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
    }
}
