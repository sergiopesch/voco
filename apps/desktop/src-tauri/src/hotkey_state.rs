//! Physical-key state for the passive Linux evdev fallback. Each open device
//! owns its keys; unplugging one keyboard cannot leave global modifiers stuck.
use evdev::{InputEvent, InputEventKind, Key, Synchronization};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HotkeyAction {
    Dictation,
}

#[derive(Default)]
pub(crate) struct HotkeyState {
    devices: HashMap<PathBuf, HashSet<Key>>,
    resynchronizing: HashSet<PathBuf>,
}

impl HotkeyState {
    /// Synchronize a newly opened device without treating already-held keys as
    /// fresh presses. Replacement devices never inherit the previous state.
    pub(crate) fn attach(&mut self, device: &Path, keys: impl IntoIterator<Item = Key>) {
        self.devices
            .insert(device.to_path_buf(), keys.into_iter().collect());
        self.resynchronizing.remove(device);
    }

    pub(crate) fn detach(&mut self, device: &Path) {
        self.devices.remove(device);
        self.resynchronizing.remove(device);
    }

    /// Discard an incomplete kernel event batch and require a fresh state query
    /// after SYN_REPORT. Resynchronization never creates activation events.
    pub(crate) fn batch(
        &mut self,
        device: &Path,
        events: &[InputEvent],
        dictation_mode: u8,
    ) -> (Vec<HotkeyAction>, bool) {
        let mut actions = Vec::new();
        let mut needs_sync = false;
        for event in events {
            if event.kind() == InputEventKind::Synchronization(Synchronization::SYN_DROPPED) {
                self.devices.remove(device);
                self.resynchronizing.insert(device.to_path_buf());
                actions.clear();
                needs_sync = false;
                continue;
            }
            if self.resynchronizing.contains(device) {
                if event.kind() == InputEventKind::Synchronization(Synchronization::SYN_REPORT) {
                    needs_sync = true;
                }
                continue;
            }
            if let InputEventKind::Key(key) = event.kind() {
                if let Some(action) = self.event(device, key, event.value(), dictation_mode) {
                    actions.push(action);
                }
            }
        }
        (actions, needs_sync)
    }

    pub(crate) fn event(
        &mut self,
        device: &Path,
        key: Key,
        value: i32,
        dictation_mode: u8,
    ) -> Option<HotkeyAction> {
        let keys = self.devices.get_mut(device)?;
        match value {
            0 => {
                keys.remove(&key);
                return None;
            }
            1 if keys.insert(key) => {}
            // Repeats must neither toggle nor release held modifiers.
            _ => return None,
        }
        // Until every connected stream is synchronized, an unseen Control or
        // Super key could make a nominal Alt chord inexact.
        if !self.resynchronizing.is_empty() {
            return None;
        }
        let held = |left, right| {
            self.devices
                .values()
                .any(|keys| keys.contains(&left) || keys.contains(&right))
        };
        let alt = held(Key::KEY_LEFTALT, Key::KEY_RIGHTALT);
        let shift = held(Key::KEY_LEFTSHIFT, Key::KEY_RIGHTSHIFT);
        let ctrl = held(Key::KEY_LEFTCTRL, Key::KEY_RIGHTCTRL);
        let meta = held(Key::KEY_LEFTMETA, Key::KEY_RIGHTMETA);
        if !alt || ctrl || meta {
            return None;
        }
        match key {
            Key::KEY_D if (dictation_mode == 0 && !shift) || (dictation_mode == 1 && shift) => {
                Some(HotkeyAction::Dictation)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> HotkeyState {
        let mut state = HotkeyState::default();
        state.attach(Path::new("first"), []);
        state.attach(Path::new("second"), []);
        state
    }

    fn key(
        state: &mut HotkeyState,
        device: &str,
        key: Key,
        value: i32,
        mode: u8,
    ) -> Option<HotkeyAction> {
        state.event(Path::new(device), key, value, mode)
    }

    #[test]
    fn exact_modifiers_reject_ctrl_and_super_on_either_keyboard() {
        for extra in [
            Key::KEY_LEFTCTRL,
            Key::KEY_RIGHTCTRL,
            Key::KEY_LEFTMETA,
            Key::KEY_RIGHTMETA,
        ] {
            let mut state = state();
            key(&mut state, "first", Key::KEY_LEFTALT, 1, 0);
            key(&mut state, "second", extra, 1, 0);
            assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
            key(&mut state, "first", Key::KEY_D, 0, 0);
            key(&mut state, "second", extra, 0, 0);
            assert_eq!(
                key(&mut state, "first", Key::KEY_D, 1, 0),
                Some(HotkeyAction::Dictation)
            );
        }
    }

    #[test]
    fn releasing_one_alt_does_not_release_the_other() {
        let mut state = state();
        key(&mut state, "first", Key::KEY_LEFTALT, 1, 0);
        key(&mut state, "first", Key::KEY_RIGHTALT, 1, 0);
        key(&mut state, "first", Key::KEY_LEFTALT, 0, 0);
        assert_eq!(
            key(&mut state, "first", Key::KEY_D, 1, 0),
            Some(HotkeyAction::Dictation)
        );
    }

    #[test]
    fn modifiers_from_two_devices_are_independent_and_unplug_clears_only_owner() {
        let mut state = state();
        key(&mut state, "first", Key::KEY_LEFTALT, 1, 0);
        key(&mut state, "second", Key::KEY_LEFTALT, 1, 0);
        key(&mut state, "first", Key::KEY_LEFTALT, 0, 0);
        assert_eq!(
            key(&mut state, "first", Key::KEY_D, 1, 0),
            Some(HotkeyAction::Dictation)
        );
        key(&mut state, "first", Key::KEY_D, 0, 0);
        state.detach(Path::new("second"));
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
    }

    #[test]
    fn repeat_and_duplicate_press_do_not_toggle_or_clear_modifiers() {
        let mut state = state();
        key(&mut state, "first", Key::KEY_LEFTALT, 1, 0);
        key(&mut state, "first", Key::KEY_LEFTALT, 2, 0);
        assert_eq!(
            key(&mut state, "first", Key::KEY_D, 1, 0),
            Some(HotkeyAction::Dictation)
        );
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
        assert_eq!(key(&mut state, "first", Key::KEY_D, 2, 0), None);
    }

    #[test]
    fn modes_and_realtime_require_exact_shift_state() {
        let mut state = state();
        key(&mut state, "first", Key::KEY_LEFTALT, 1, 1);
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 1), None);
        key(&mut state, "first", Key::KEY_D, 0, 1);
        key(&mut state, "first", Key::KEY_LEFTSHIFT, 1, 1);
        key(&mut state, "first", Key::KEY_RIGHTSHIFT, 1, 1);
        key(&mut state, "first", Key::KEY_LEFTSHIFT, 0, 1);
        assert_eq!(
            key(&mut state, "first", Key::KEY_D, 1, 1),
            Some(HotkeyAction::Dictation)
        );
        key(&mut state, "first", Key::KEY_D, 0, 0);
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
        assert_eq!(key(&mut state, "first", Key::KEY_R, 1, 255), None);
    }

    #[test]
    fn dropped_kernel_events_clear_state_and_never_fabricate_activation() {
        use evdev::EventType;
        let mut state = state();
        key(&mut state, "first", Key::KEY_LEFTALT, 1, 0);
        let events = [
            InputEvent::new(EventType::KEY, Key::KEY_D.code(), 1),
            InputEvent::new(
                EventType::SYNCHRONIZATION,
                Synchronization::SYN_DROPPED.0,
                0,
            ),
            InputEvent::new(EventType::KEY, Key::KEY_D.code(), 1),
        ];
        assert_eq!(state.batch(Path::new("first"), &events, 0), (vec![], false));
        key(&mut state, "second", Key::KEY_LEFTALT, 1, 0);
        assert_eq!(key(&mut state, "second", Key::KEY_D, 1, 0), None);
        let report = [InputEvent::new(
            EventType::SYNCHRONIZATION,
            Synchronization::SYN_REPORT.0,
            0,
        )];
        assert_eq!(state.batch(Path::new("first"), &report, 0), (vec![], true));
        state.attach(Path::new("first"), [Key::KEY_LEFTALT, Key::KEY_D]);
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
        key(&mut state, "first", Key::KEY_D, 0, 0);
        assert_eq!(
            key(&mut state, "first", Key::KEY_D, 1, 0),
            Some(HotkeyAction::Dictation)
        );
    }

    #[test]
    fn reconnect_is_fresh_and_initial_held_key_does_not_toggle() {
        let mut state = state();
        state.attach(Path::new("first"), [Key::KEY_LEFTALT, Key::KEY_D]);
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
        state.detach(Path::new("first"));
        assert_eq!(key(&mut state, "first", Key::KEY_LEFTALT, 1, 0), None);
        state.attach(Path::new("first"), []);
        assert_eq!(key(&mut state, "first", Key::KEY_D, 1, 0), None);
    }
}
