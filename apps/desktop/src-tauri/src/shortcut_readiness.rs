//! Observations only: none of these methods registers, arms, or admits a shortcut.
use crate::shortcut_arbitration::{PollOutcome, ENGINE_ARM_MS};
use crate::Preset;
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

struct PollObservation {
    revision: u64,
    hotkey: String,
    at: i64,
    outcome: PollOutcome,
}

#[derive(Default)]
pub(crate) struct Observations {
    poll: Mutex<(u64, Option<PollObservation>)>,
}

pub(crate) struct Snapshot<'a> {
    pub hotkey: &'a str,
    pub revision: u64,
    pub now: i64,
    pub renderer_current: bool,
    pub consuming_lease: bool,
    pub plugin_hotkey: Option<&'a str>,
    pub use_evdev: bool,
    /// The evdev listener's preset; None for a custom shortcut.
    pub evdev_preset: Option<Preset>,
    /// Keyboards that can type the `evdev_preset` chord; None when unknown or
    /// without a preset.
    pub evdev_keyboards: Option<usize>,
    pub configured_preset: Option<Preset>,
    pub bridge_available: bool,
    pub panel_reserved: bool,
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

    pub fn poll(&self, ticket: u64, revision: u64, hotkey: &str, at: i64, outcome: PollOutcome) {
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
                && snapshot.now.saturating_sub(p.at) < ENGINE_ARM_MS
        });
        if current.is_some_and(|p| p.outcome == PollOutcome::Armed) {
            return status(
                Some("ibus"),
                "available",
                "VOCO Dictation has armed this shortcut in the current input context.",
            );
        }
        // The admission lease also covers uncertain replies. Its existence is a
        // reason to withhold passive readiness, never proof of success.
        if snapshot.consuming_lease {
            return status(
                None,
                "unknown",
                "The input-context shortcut is being checked. Start dictation from the tray.",
            );
        }
        // A fresh GNOME panel lease means Shell consumes the chord and toggles.
        if snapshot.panel_reserved {
            return status(
                Some("gnome-panel"),
                "available",
                "VOCO's GNOME panel handles this shortcut.",
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
            && snapshot.evdev_preset.is_some()
            && snapshot.evdev_preset == snapshot.configured_preset
        {
            match snapshot.evdev_keyboards {
                Some(0) => {}
                Some(_) => {
                    return status(
                        Some("evdev"),
                        "available",
                        "A live synchronized keyboard supports the configured shortcut.",
                    )
                }
                None => {
                    return status(
                        None,
                        "unknown",
                        "Keyboard observations are unavailable. Start dictation from the tray.",
                    )
                }
            }
        }
        // An idle bridge has no insertion session, so its engineActive field
        // cannot describe shortcut focus. A current disarmed reply and a live
        // connection support setup guidance, never shortcut availability.
        if snapshot.bridge_available && current.is_some_and(|p| p.outcome == PollOutcome::Disarmed)
        {
            return status(
                Some("ibus"),
                "focus-required",
                "Select VOCO Dictation and focus an eligible text field, or start from the tray.",
            );
        }
        status(None, "unavailable", "No working route is currently confirmed for this shortcut. Start dictation from the tray.")
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
            evdev_preset: Some(Preset::AltD),
            evdev_keyboards: Some(0),
            configured_preset: Some(Preset::AltD),
            bridge_available: false,
            panel_reserved: false,
        }
    }
    #[test]
    fn only_a_live_keyboard_for_the_chord_makes_evdev_available() {
        let o = Observations::default();
        assert_eq!(o.status(snapshot()).state, "unavailable");
        let live = || Snapshot {
            evdev_keyboards: Some(1),
            ..snapshot()
        };
        assert_eq!(o.status(live()).route, Some("evdev"));
        let unknown = o.status(Snapshot {
            evdev_keyboards: None,
            ..snapshot()
        });
        assert_eq!(unknown.state, "unknown");
        let detail = "Keyboard observations are unavailable. Start dictation from the tray.";
        assert_eq!(unknown.detail, detail);
        let other_route = Snapshot {
            use_evdev: false,
            ..live()
        };
        assert_eq!(o.status(other_route).state, "unavailable");
    }
    #[test]
    fn old_runtime_mode_cannot_advertise_new_config() {
        let o = Observations::default();
        let mut s = snapshot();
        s.evdev_keyboards = Some(1);
        s.hotkey = "Alt+Shift+D";
        s.configured_preset = Some(Preset::AltShiftD);
        assert_eq!(o.status(s).state, "unavailable");
    }
    #[test]
    fn armed_poll_requires_current_config_and_fresh_heartbeat() {
        let o = Observations::default();
        o.poll(o.ticket(), 1, "Alt+D", 100, PollOutcome::Armed);
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
        for outcome in [PollOutcome::Uncertain, PollOutcome::Unavailable] {
            o.poll(o.ticket(), 1, "Alt+D", 100, outcome);
            let mut s = snapshot();
            s.evdev_keyboards = Some(1);
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
        o.poll(ticket, 1, "Alt+D", 100, PollOutcome::Armed);
        assert_ne!(o.status(snapshot()).state, "available");
    }
    #[test]
    fn gnome_panel_lease_is_an_available_route_without_devices() {
        let o = Observations::default();
        let reserved = || Snapshot {
            panel_reserved: true,
            ..snapshot()
        };
        assert_eq!(o.status(reserved()).route, Some("gnome-panel"));
        let stale = Snapshot {
            renderer_current: false,
            ..reserved()
        };
        assert_eq!(o.status(stale).state, "unknown");
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
        o.poll(o.ticket(), 1, "Alt+D", 100, PollOutcome::Disarmed);
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
        for outcome in [PollOutcome::Uncertain, PollOutcome::Unavailable] {
            o.poll(o.ticket(), 1, "Alt+D", 100, outcome);
            assert_eq!(o.status(connected()).state, "unavailable");
        }
        o.poll(o.ticket(), 1, "Alt+D", 100, PollOutcome::Armed);
        assert_eq!(o.status(connected()).state, "available");
    }
}
