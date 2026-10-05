//! Physical-key state for the passive Linux evdev fallback. Each open device
//! owns its keys; unplugging one keyboard cannot leave global modifiers stuck.
use crate::Preset;
use evdev::{EventSummary, InputEvent, KeyCode, SynchronizationCode};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// An open, synchronized keyboard: the keys it holds, and whether it has a
/// Shift key for Alt+Shift+D.
struct Keyboard {
    keys: HashSet<KeyCode>,
    shift: bool,
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
        shift: bool,
    ) {
        let keys = keys.into_iter().collect();
        self.devices
            .insert(device.to_path_buf(), Keyboard { keys, shift });
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
            .filter(|keyboard| !preset.shift() || keyboard.shift)
            .count()
    }

    /// Unknown until every watched keyboard is synchronized.
    pub(crate) fn modifiers_held(&self) -> Option<bool> {
        if self.devices.is_empty() || !self.resynchronizing.is_empty() {
            return None;
        }
        Some(self.devices.values().any(|keyboard| {
            [
                KeyCode::KEY_LEFTALT,
                KeyCode::KEY_RIGHTALT,
                KeyCode::KEY_LEFTSHIFT,
                KeyCode::KEY_RIGHTSHIFT,
                KeyCode::KEY_LEFTCTRL,
                KeyCode::KEY_RIGHTCTRL,
                KeyCode::KEY_LEFTMETA,
                KeyCode::KEY_RIGHTMETA,
            ]
            .iter()
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
        // Until every connected stream is synchronized, an unseen Control or
        // Super key could make a nominal Alt chord inexact.
        if !self.resynchronizing.is_empty() {
            return false;
        }
        let held = |left, right| {
            self.devices
                .values()
                .any(|keyboard| keyboard.keys.contains(&left) || keyboard.keys.contains(&right))
        };
        let alt = held(KeyCode::KEY_LEFTALT, KeyCode::KEY_RIGHTALT);
        let shift = held(KeyCode::KEY_LEFTSHIFT, KeyCode::KEY_RIGHTSHIFT);
        let ctrl = held(KeyCode::KEY_LEFTCTRL, KeyCode::KEY_RIGHTCTRL);
        let meta = held(KeyCode::KEY_LEFTMETA, KeyCode::KEY_RIGHTMETA);
        if !alt || ctrl || meta {
            return false;
        }
        key == KeyCode::KEY_D && preset.is_some_and(|preset| preset.shift() == shift)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> HotkeyState {
        let mut state = HotkeyState::default();
        state.attach(Path::new("first"), [], true);
        state.attach(Path::new("second"), [], true);
        state
    }

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
            true,
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
        state.attach(Path::new("first"), [KeyCode::KEY_LEFTSHIFT], true);
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
                state.keyboards_for(Preset::AltD),
                state.keyboards_for(Preset::AltShiftD),
            )
        };
        assert_eq!(counts(&state), (0, 0));
        state.attach(Path::new("full"), [], true);
        state.attach(Path::new("no-shift"), [], false);
        assert_eq!(counts(&state), (2, 1));
        let dropped = [InputEvent::new(
            evdev::EventType::SYNCHRONIZATION.0,
            SynchronizationCode::SYN_DROPPED.0,
            0,
        )];
        state.batch(Path::new("full"), &dropped, ALT_D);
        assert_eq!(counts(&state), (1, 0));
        state.attach(Path::new("full"), [], true);
        assert_eq!(counts(&state), (2, 1));
        state.detach(Path::new("no-shift"));
        assert_eq!(counts(&state), (1, 1));
    }

    #[test]
    fn reconnect_is_fresh_and_initial_held_key_does_not_toggle() {
        let mut state = state();
        state.attach(
            Path::new("first"),
            [KeyCode::KEY_LEFTALT, KeyCode::KEY_D],
            true,
        );
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
        state.detach(Path::new("first"));
        assert!(!key(&mut state, "first", KeyCode::KEY_LEFTALT, 1, ALT_D));
        state.attach(Path::new("first"), [], true);
        assert!(!key(&mut state, "first", KeyCode::KEY_D, 1, ALT_D));
    }
}
