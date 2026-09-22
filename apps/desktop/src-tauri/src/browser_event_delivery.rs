//! Browser Stop survives a temporarily unresponsive renderer without becoming a toggle.
use crate::browser_broker::BrowserTrigger;
use std::sync::Mutex;

#[derive(Default)]
pub struct BrowserEventDelivery {
    pending_stops: Mutex<Vec<BrowserTrigger>>,
}

impl BrowserEventDelivery {
    fn queue_stop(pending: &mut Vec<BrowserTrigger>, stop: BrowserTrigger) {
        if !pending
            .iter()
            .any(|event| event.trigger_id == stop.trigger_id)
        {
            pending.push(stop);
        }
    }

    pub fn dispatch(
        &self,
        trigger: BrowserTrigger,
        handler_ready: bool,
        heartbeat_current: bool,
        mut emit: impl FnMut(&BrowserTrigger) -> bool,
    ) -> bool {
        match trigger.action.as_str() {
            "start" => {
                // Serialize Start emission with Stop retention. A Stop queued
                // during Start will follow it and block all later Starts.
                let pending = self
                    .pending_stops
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                handler_ready && heartbeat_current && pending.is_empty() && emit(&trigger)
            }
            "stop" => {
                // Tauri can report successful emission even with no listener.
                // Only the renderer's exact-token receipt can retire this Stop.
                {
                    let mut pending = self
                        .pending_stops
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    Self::queue_stop(&mut pending, trigger.clone());
                }
                // A listener can still stop an active capture while startup,
                // settings or a config error has paused the readiness heartbeat.
                // If no listener exists, the retained Stop is replayed later.
                let _ = emit(&trigger);
                true
            }
            _ => false,
        }
    }

    pub fn replay(&self, mut emit: impl FnMut(&BrowserTrigger) -> bool) {
        let snapshot = self
            .pending_stops
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        for stop in &snapshot {
            let _ = emit(stop);
        }
    }

    pub fn acknowledge_stop(&self, trigger_id: &str) -> bool {
        let mut pending = self
            .pending_stops
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let before = pending.len();
        pending.retain(|stop| stop.trigger_id != trigger_id);
        pending.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trigger(token: &str, action: &str) -> BrowserTrigger {
        BrowserTrigger {
            trigger_id: format!("browser:{token}"),
            mode: "dictation".into(),
            provider: "chromium".into(),
            action: action.into(),
        }
    }

    #[test]
    fn stale_heartbeat_stop_replays_exact_token_and_never_admits_start() {
        let delivery = BrowserEventDelivery::default();
        let mut sent = Vec::new();
        assert!(!delivery.dispatch(trigger("new", "start"), true, false, |_| true));
        assert!(
            delivery.dispatch(trigger("old", "stop"), true, false, |event| {
                sent.push(event.trigger_id.clone());
                false
            })
        );
        assert_eq!(sent, ["browser:old"]);
        assert!(!delivery.dispatch(trigger("new", "start"), true, true, |_| true));
        delivery.replay(|event| {
            sent.push(event.trigger_id.clone());
            false
        });
        assert!(!delivery.dispatch(trigger("new", "start"), true, true, |_| true));
        delivery.replay(|event| {
            sent.push(event.trigger_id.clone());
            true
        });
        assert!(!delivery.dispatch(trigger("new", "start"), true, true, |_| true));
        assert!(!delivery.acknowledge_stop("browser:new"));
        assert!(delivery.acknowledge_stop("browser:old"));
        assert!(delivery.dispatch(trigger("new", "start"), true, true, |_| true));
        delivery.replay(|event| {
            sent.push(event.trigger_id.clone());
            true
        });
        assert_eq!(sent, ["browser:old", "browser:old", "browser:old"]);
    }

    #[test]
    fn absent_handler_queues_once_until_registration() {
        let delivery = BrowserEventDelivery::default();
        let mut attempted = 0;
        for _ in 0..2 {
            assert!(
                delivery.dispatch(trigger("one", "stop"), false, false, |_| {
                    attempted += 1;
                    true // Tauri can return Ok with zero listeners.
                })
            );
        }
        assert_eq!(attempted, 2);
        let mut replayed = Vec::new();
        delivery.replay(|event| {
            replayed.push(event.trigger_id.clone());
            true
        });
        assert_eq!(replayed, ["browser:one"]);
        assert!(delivery.acknowledge_stop("browser:one"));
    }

    #[test]
    fn successful_emit_does_not_claim_a_listener_received_stop() {
        let delivery = BrowserEventDelivery::default();
        assert!(delivery.dispatch(trigger("one", "stop"), true, true, |_| true));
        let mut replayed = Vec::new();
        delivery.replay(|event| {
            replayed.push(event.trigger_id.clone());
            true
        });
        assert_eq!(replayed, ["browser:one"]);
        assert!(!delivery.acknowledge_stop("browser:other"));
        assert!(delivery.acknowledge_stop("browser:one"));
        delivery.replay(|_| panic!("acknowledged Stop must not replay"));
    }

    #[test]
    fn replay_releases_lock_before_renderer_acknowledges() {
        let delivery = BrowserEventDelivery::default();
        delivery.dispatch(trigger("one", "stop"), false, false, |_| true);
        delivery.replay(|event| {
            assert!(delivery.acknowledge_stop(&event.trigger_id));
            true
        });
        delivery.replay(|_| panic!("acknowledged Stop must not replay"));
    }
}
