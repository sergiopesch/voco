//! Observations only: none of these methods registers, arms, or admits a shortcut.
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    pub hotkey: String,
    pub route: Option<&'static str>,
    pub state: &'static str,
    pub detail: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Poll {
    Armed,
    Disarmed,
    Uncertain,
    Unavailable,
}

struct PollObservation {
    revision: u64,
    hotkey: String,
    at: i64,
    outcome: Poll,
}

#[derive(Default)]
pub(crate) struct Observations {
    poll: Mutex<(u64, Option<PollObservation>)>,
    // Counts reflect open, synchronized devices, not discovered paths.
    devices: Mutex<[usize; 2]>,
}

pub(crate) struct Snapshot<'a> {
    pub hotkey: &'a str,
    pub revision: u64,
    pub now: i64,
    pub renderer_current: bool,
    pub consuming_lease: bool,
    pub plugin_hotkey: Option<&'a str>,
    pub use_evdev: bool,
    pub evdev_mode: u8,
    pub configured_evdev_mode: u8,
    pub bridge_available: bool,
}

impl Observations {
    pub fn clear_poll(&self) {
        if let Ok(mut poll) = self.poll.lock() {
            poll.0 = poll.0.wrapping_add(1);
            poll.1 = None;
        }
    }

    pub fn ticket(&self) -> u64 {
        self.poll.lock().map(|poll| poll.0).unwrap_or(u64::MAX)
    }

    pub fn begin_poll(&self, ticket: u64) {
        if let Ok(mut poll) = self.poll.lock() {
            if poll.0 == ticket {
                poll.1 = None;
            }
        }
    }

    pub fn poll(&self, ticket: u64, revision: u64, hotkey: &str, at: i64, outcome: Poll) {
        if let Ok(mut poll) = self.poll.lock() {
            if poll.0 == ticket {
                poll.1 = Some(PollObservation {
                    revision,
                    hotkey: hotkey.to_owned(),
                    at,
                    outcome,
                });
            }
        }
    }

    pub fn device(&self, dictation: bool, shift: bool) -> Device<'_> {
        let mut device = Device {
            owner: self,
            index: usize::from(shift),
            capable: dictation,
            active: false,
        };
        device.synchronized();
        device
    }

    pub fn status(&self, snapshot: Snapshot<'_>) -> Status {
        let status = |route, state, detail| Status {
            hotkey: snapshot.hotkey.to_owned(),
            route,
            state,
            detail,
        };
        if !snapshot.renderer_current {
            return status(
                None,
                "unknown",
                "The shortcut handler is not currently confirmed. Start dictation from the tray.",
            );
        }
        let Ok(poll) = self.poll.lock() else {
            return status(
                None,
                "unknown",
                "Shortcut observations are unavailable. Start dictation from the tray.",
            );
        };
        let current = poll.1.as_ref().filter(|p| {
            p.revision == snapshot.revision
                && p.hotkey == snapshot.hotkey
                && snapshot.now >= p.at
                && snapshot.now.saturating_sub(p.at) < 1000
        });
        if current.is_some_and(|p| p.outcome == Poll::Armed) {
            return status(
                Some("ibus"),
                "available",
                "VOCO Dictation has armed this shortcut in the current input context.",
            );
        }
        // The admission lease also covers uncertain replies and in-flight polls.
        // Its existence is a reason to withhold passive readiness, never proof of success.
        if snapshot.consuming_lease {
            return status(
                None,
                "unknown",
                "The input-context shortcut is being checked. Start dictation from the tray.",
            );
        }
        if !snapshot.use_evdev && snapshot.plugin_hotkey == Some(snapshot.hotkey) {
            return status(
                Some("global-shortcut"),
                "available",
                "The configured shortcut has an active global registration.",
            );
        }
        if snapshot.use_evdev
            && snapshot.evdev_mode <= 1
            && snapshot.evdev_mode == snapshot.configured_evdev_mode
        {
            if let Ok(devices) = self.devices.lock() {
                let count = if snapshot.evdev_mode == 0 {
                    devices[0].saturating_add(devices[1])
                } else {
                    devices[1]
                };
                if count > 0 {
                    return status(
                        Some("evdev"),
                        "available",
                        "A live synchronized keyboard supports the configured shortcut.",
                    );
                }
            } else {
                return status(
                    None,
                    "unknown",
                    "Keyboard observations are unavailable. Start dictation from the tray.",
                );
            }
        }
        // An idle bridge has no insertion session, so its engineActive field
        // cannot describe shortcut focus. A current disarmed reply and a live
        // connection support setup guidance, never shortcut availability.
        if snapshot.bridge_available && current.is_some_and(|p| p.outcome == Poll::Disarmed) {
            return status(
                Some("ibus"),
                "focus-required",
                "Select VOCO Dictation and focus an eligible text field, or start from the tray.",
            );
        }
        status(None, "unavailable", "No working route is currently confirmed for this shortcut. Start dictation from the tray.")
    }
}

pub(crate) struct Device<'a> {
    owner: &'a Observations,
    index: usize,
    capable: bool,
    active: bool,
}

impl Device<'_> {
    pub fn unsynchronized(&mut self) {
        if self.active {
            if let Ok(mut devices) = self.owner.devices.lock() {
                devices[self.index] = devices[self.index].saturating_sub(1);
            }
            self.active = false;
        }
    }

    pub fn synchronized(&mut self) {
        if self.capable && !self.active {
            if let Ok(mut devices) = self.owner.devices.lock() {
                devices[self.index] += 1;
                self.active = true;
            }
        }
    }
}
impl Drop for Device<'_> {
    fn drop(&mut self) {
        self.unsynchronized();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Snapshot<'static> {
        Snapshot {
            hotkey: "Alt+D",
            revision: 1,
            now: 100,
            renderer_current: true,
            consuming_lease: false,
            plugin_hotkey: None,
            use_evdev: true,
            evdev_mode: 0,
            configured_evdev_mode: 0,
            bridge_available: false,
        }
    }
    #[test]
    fn only_live_synchronized_dictation_devices_count() {
        let o = Observations::default();
        let _realtime_only = o.device(false, true);
        assert_eq!(o.status(snapshot()).state, "unavailable");
        let mut first = o.device(true, true);
        let second = o.device(true, false);
        first.unsynchronized();
        drop(second);
        assert_eq!(o.status(snapshot()).state, "unavailable");
        first.synchronized();
        assert_eq!(o.status(snapshot()).route, Some("evdev"));
        drop(first);
        assert_eq!(o.status(snapshot()).state, "unavailable");
    }
    #[test]
    fn shift_requires_a_capable_live_device() {
        let o = Observations::default();
        let _device = o.device(true, false);
        let mut s = snapshot();
        s.hotkey = "Alt+Shift+D";
        s.evdev_mode = 1;
        s.configured_evdev_mode = 1;
        assert_eq!(o.status(s).state, "unavailable");
    }
    #[test]
    fn old_runtime_mode_cannot_advertise_new_config() {
        let o = Observations::default();
        let _device = o.device(true, true);
        let mut s = snapshot();
        s.hotkey = "Alt+Shift+D";
        s.configured_evdev_mode = 1;
        assert_eq!(o.status(s).state, "unavailable");
    }
    #[test]
    fn armed_poll_requires_current_config_and_fresh_heartbeat() {
        let o = Observations::default();
        o.poll(o.ticket(), 1, "Alt+D", 100, Poll::Armed);
        assert_eq!(o.status(snapshot()).route, Some("ibus"));
        let mut s = snapshot();
        s.revision = 2;
        assert_ne!(o.status(s).state, "available");
        let mut s = snapshot();
        s.hotkey = "Alt+Shift+D";
        assert_ne!(o.status(s).state, "available");
        let mut s = snapshot();
        s.now = 1100;
        assert_ne!(o.status(s).state, "available");
        let mut s = snapshot();
        s.renderer_current = false;
        assert_eq!(o.status(s).state, "unknown");
        o.clear_poll();
        assert_ne!(o.status(snapshot()).state, "available");
    }
    #[test]
    fn uncertain_lease_does_not_prove_ready_or_enable_passive_route() {
        let o = Observations::default();
        let _device = o.device(true, true);
        for outcome in [Poll::Uncertain, Poll::Unavailable] {
            o.poll(o.ticket(), 1, "Alt+D", 100, outcome);
            let mut s = snapshot();
            s.consuming_lease = true;
            s.bridge_available = true;
            assert_eq!(o.status(s).state, "unknown");
        }
    }
    #[test]
    fn late_poll_after_renderer_reset_cannot_restore_readiness() {
        let o = Observations::default();
        let ticket = o.ticket();
        o.clear_poll();
        o.poll(ticket, 1, "Alt+D", 100, Poll::Armed);
        assert_ne!(o.status(snapshot()).state, "available");
    }
    #[test]
    fn plugin_must_match_current_key_and_selected_route() {
        let o = Observations::default();
        let mut s = snapshot();
        s.use_evdev = false;
        s.plugin_hotkey = Some("Alt+Shift+D");
        assert_ne!(o.status(s).state, "available");
        let mut s = snapshot();
        s.use_evdev = false;
        s.plugin_hotkey = Some("Alt+D");
        assert_eq!(o.status(s).route, Some("global-shortcut"));
    }
    #[test]
    fn idle_connected_bridge_needs_a_current_disarmed_poll_for_focus_guidance() {
        let o = Observations::default();
        let connected = || Snapshot {
            bridge_available: true,
            ..snapshot()
        };
        assert_eq!(o.status(connected()).state, "unavailable");
        o.poll(o.ticket(), 1, "Alt+D", 100, Poll::Disarmed);
        assert_eq!(o.status(snapshot()).state, "unavailable");
        let status = o.status(connected());
        assert_eq!(status.state, "focus-required");
        assert_eq!(status.route, Some("ibus"));
        for s in [
            Snapshot {
                now: 1100,
                ..connected()
            },
            Snapshot {
                revision: 2,
                ..connected()
            },
            Snapshot {
                hotkey: "Alt+Shift+D",
                ..connected()
            },
        ] {
            assert_eq!(o.status(s).state, "unavailable");
        }
        for outcome in [Poll::Uncertain, Poll::Unavailable] {
            o.poll(o.ticket(), 1, "Alt+D", 100, outcome);
            assert_eq!(o.status(connected()).state, "unavailable");
        }
        o.poll(o.ticket(), 1, "Alt+D", 100, Poll::Armed);
        assert_eq!(o.status(connected()).state, "available");
    }
}
