//! Separate confirmed IBus authority from uncertainty while its poll is in flight.
//! Passive evdev can observe a chord that IBus consumes, so it keeps both guards.
//! An X11 grab callback already consumed its chord and uses shared debounce only.
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

// The engine arms the shortcut for 1 s from each poll-trigger it handles
// (voco_ibus_engine.py). The lease starts this bound when the reply or error
// arrives, so it outlasts the engine's arm; readiness starts it before the
// request, so an Armed status never does.
pub const ENGINE_ARM_MS: i64 = 1_000;
// Retries an arbitration pass the main thread skipped for a concurrent writer.
const ARBITRATION_REFRESH_MS: i64 = 1_000;

/// A plugin callback owns one registration; a release cannot borrow another press.
pub struct PluginGesture {
    pressed: AtomicBool,
}

impl PluginGesture {
    pub const fn new() -> Self {
        Self {
            pressed: AtomicBool::new(false),
        }
    }

    pub fn admit(&self, pressed: bool, complete_on_release: bool, eligible: bool) -> bool {
        if !eligible {
            self.pressed.store(false, Ordering::SeqCst);
            return false;
        }
        if !complete_on_release {
            return pressed;
        }
        if pressed {
            self.pressed.store(true, Ordering::SeqCst);
            false
        } else {
            self.pressed.swap(false, Ordering::SeqCst)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PollOutcome {
    Armed,
    Disarmed,
    Uncertain,
    Unavailable,
}

pub struct ConsumingLease {
    polling: AtomicBool,
    expires_at: AtomicI64,
}

impl ConsumingLease {
    pub const fn new() -> Self {
        Self {
            polling: AtomicBool::new(false),
            expires_at: AtomicI64::new(-1),
        }
    }

    /// Call just before sending a request that can arm the engine, today only
    /// poll-trigger. A connect or hello that fails first cannot have armed it,
    /// so it must not hold back evdev.
    pub fn begin_poll(&self) {
        // The engine can process a chord before its poll reply reaches us.
        self.polling.store(true, Ordering::SeqCst);
    }

    pub fn finish_poll(&self, now: i64, outcome: PollOutcome) {
        match outcome {
            PollOutcome::Armed | PollOutcome::Uncertain => {
                self.expires_at
                    .store(now.saturating_add(ENGINE_ARM_MS), Ordering::SeqCst);
            }
            PollOutcome::Disarmed => self.expires_at.store(-1, Ordering::SeqCst),
            // Connection failures before sending a poll cannot renew a lease.
            PollOutcome::Unavailable => {}
        }
        self.polling.store(false, Ordering::SeqCst);
    }

    /// Only a completed Armed/Uncertain reply can change fallback registration.
    /// A later pending poll must not revoke an existing consuming X11 grab.
    pub fn has_authority(&self, now: i64) -> bool {
        now < self.expires_at.load(Ordering::SeqCst)
    }

    pub fn poll_in_flight(&self) -> bool {
        self.polling.load(Ordering::SeqCst)
    }

    pub fn is_current(&self, now: i64) -> bool {
        self.poll_in_flight() || self.has_authority(now)
    }

    pub fn suppresses_backend(&self, backend: &str, now: i64) -> bool {
        // The X11 backend uses an owner_events=false root grab.
        // Its callback proves the key was delivered to the grabbing client,
        // not the destination's ordinary IBus process_key_event route.
        backend == "evdev" && self.is_current(now)
    }
}

/// Fallback arbitration on the main thread is idempotent and re-checks its own
/// inputs, so the listener posts it only when the configuration revision or the
/// fallback decision changes, and otherwise once a second.
#[derive(Default)]
pub struct ArbitrationPosts {
    last: Option<(u64, bool, i64)>,
}

impl ArbitrationPosts {
    pub fn should_post(&mut self, revision: u64, fallback: bool, now: i64) -> bool {
        if let Some((last_revision, last_fallback, posted)) = self.last {
            if (last_revision, last_fallback) == (revision, fallback)
                && now.saturating_sub(posted) < ARBITRATION_REFRESH_MS
            {
                return false;
            }
        }
        self.last = Some((revision, fallback, now));
        true
    }
}

pub fn admit_toggle(last: &AtomicI64, now: i64, debounce_ms: i64) -> bool {
    let mut observed = last.load(Ordering::SeqCst);
    loop {
        if observed >= 0 && now.saturating_sub(observed) < debounce_ms {
            return false;
        }
        match last.compare_exchange(observed, now, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return true,
            Err(current) => observed = current,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn plugin_x11_waits_for_one_completed_gesture_without_a_timer() {
        let gesture = PluginGesture::new();
        assert!(!gesture.admit(false, true, true), "orphan release");
        for _ in 0..10 {
            assert!(
                !gesture.admit(true, true, true),
                "held/repeated press must not start or stop"
            );
        }
        assert!(gesture.admit(false, true, true));
        assert!(!gesture.admit(false, true, true), "duplicate release");
        assert!(!gesture.admit(true, true, true));
        assert!(
            gesture.admit(false, true, true),
            "next completed gesture can stop"
        );
    }

    #[test]
    fn plugin_stale_binding_or_backend_change_cancels_the_pending_gesture() {
        let old = PluginGesture::new();
        assert!(!old.admit(true, true, true));
        assert!(!old.admit(false, true, false));
        assert!(
            !old.admit(false, true, true),
            "canceled press cannot return later"
        );
        let replacement = PluginGesture::new();
        assert!(
            !replacement.admit(false, true, true),
            "new registration cannot inherit a press"
        );
        assert!(
            !replacement.admit(true, true, false),
            "evdev owns the chord"
        );
        assert!(
            !replacement.admit(false, true, true),
            "ignored press cannot become a release toggle"
        );
    }

    #[test]
    fn plugin_non_linux_builds_keep_pressed_semantics() {
        let gesture = PluginGesture::new();
        assert!(gesture.admit(true, false, true));
        assert!(!gesture.admit(false, false, true));
        assert!(!gesture.admit(true, false, false));
    }

    #[test]
    fn plugin_concurrent_release_callbacks_consume_one_press_once() {
        let gesture = Arc::new(PluginGesture::new());
        assert!(!gesture.admit(true, true, true));
        let barrier = Arc::new(Barrier::new(16));
        let workers: Vec<_> = (0..16)
            .map(|_| {
                let gesture = Arc::clone(&gesture);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    gesture.admit(false, true, true)
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .filter_map(|w| w.join().ok())
                .filter(|v| *v)
                .count(),
            1
        );
    }

    #[test]
    fn simultaneous_backends_admit_only_one_toggle() {
        let last = Arc::new(AtomicI64::new(-1));
        let barrier = Arc::new(Barrier::new(16));
        let workers: Vec<_> = (0..16)
            .map(|_| {
                let last = Arc::clone(&last);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    admit_toggle(&last, 1000, 90)
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .filter_map(|worker| worker.join().ok())
                .filter(|accepted| *accepted)
                .count(),
            1
        );
    }

    #[test]
    fn rejected_events_do_not_extend_the_admission_window() {
        let last = AtomicI64::new(-1);
        assert!(admit_toggle(&last, 0, 90));
        assert!(!admit_toggle(&last, 80, 90));
        assert!(admit_toggle(&last, 90, 90));
    }

    #[test]
    fn uncertain_poll_preserves_authority_beyond_normal_debounce() {
        let lease = ConsumingLease::new();
        lease.begin_poll();
        assert!(lease.is_current(1000));
        lease.finish_poll(1000, PollOutcome::Armed);
        lease.begin_poll();
        lease.finish_poll(1400, PollOutcome::Uncertain);
        assert!(lease.is_current(1900));
        assert!(!lease.is_current(2400));
    }

    #[test]
    fn unavailable_connections_cannot_starve_manual_fallback() {
        let lease = ConsumingLease::new();
        lease.finish_poll(1000, PollOutcome::Armed);
        for now in [1500, 2000, 2500] {
            lease.begin_poll();
            lease.finish_poll(now, PollOutcome::Unavailable);
        }
        assert!(!lease.is_current(2500));
    }

    #[test]
    fn confirmed_unsupported_context_restores_manual_fallback_immediately() {
        let lease = ConsumingLease::new();
        lease.finish_poll(1000, PollOutcome::Armed);
        lease.begin_poll();
        lease.finish_poll(1100, PollOutcome::Disarmed);
        assert!(!lease.is_current(1100));
    }

    #[test]
    fn pending_disarmed_poll_blocks_only_passive_events_not_registration_or_x11() {
        let lease = ConsumingLease::new();
        lease.finish_poll(1000, PollOutcome::Disarmed);
        lease.begin_poll();
        assert!(lease.suppresses_backend("evdev", 1050));
        assert!(!lease.suppresses_backend("global_shortcut", 1050));
        assert!(!lease.has_authority(1050));
    }

    #[test]
    fn queued_registration_check_is_not_changed_by_a_later_pending_poll() {
        let lease = ConsumingLease::new();
        lease.finish_poll(1000, PollOutcome::Disarmed); // Schedules main-thread sync.
        assert!(!lease.has_authority(1000));
        lease.begin_poll(); // Main thread runs during the next round trip.
        assert!(!lease.has_authority(1050)); // Keep the existing X11 registration.
        lease.finish_poll(1060, PollOutcome::Armed);
        assert!(lease.has_authority(1060)); // A real reply still changes authority.
    }

    #[test]
    fn armed_and_uncertain_leases_keep_passive_duplicate_guard_until_expiry() {
        for outcome in [PollOutcome::Armed, PollOutcome::Uncertain] {
            let lease = ConsumingLease::new();
            lease.finish_poll(1000, outcome);
            for now in [1000, 1999] {
                assert!(lease.has_authority(now));
                assert!(lease.suppresses_backend("evdev", now));
                assert!(!lease.suppresses_backend("global_shortcut", now));
            }
            assert!(!lease.has_authority(2000));
            assert!(!lease.suppresses_backend("evdev", 2000));
        }
    }

    #[test]
    fn pending_poll_cannot_renew_expired_registration_authority() {
        let lease = ConsumingLease::new();
        lease.finish_poll(1000, PollOutcome::Armed);
        lease.begin_poll();
        assert!(!lease.has_authority(2000));
        assert!(lease.suppresses_backend("evdev", 2000));
        lease.finish_poll(2100, PollOutcome::Unavailable);
        assert!(!lease.has_authority(2100));
        assert!(!lease.suppresses_backend("evdev", 2100));
    }

    #[test]
    fn consuming_x11_admission_still_uses_the_shared_debounce() {
        let lease = ConsumingLease::new();
        let last = AtomicI64::new(-1);
        lease.begin_poll();
        assert!(!lease.suppresses_backend("global_shortcut", 1000));
        assert!(admit_toggle(&last, 1000, 90));
        assert!(!admit_toggle(&last, 1089, 90));
        assert!(admit_toggle(&last, 1090, 90));
        assert!(lease.suppresses_backend("evdev", 1090));
    }

    #[test]
    fn arbitration_posts_only_on_a_change_or_once_a_second() {
        let mut posts = ArbitrationPosts::default();
        assert!(posts.should_post(1, true, 0), "the first pass posts");
        assert!(!posts.should_post(1, true, 50));
        assert!(posts.should_post(1, false, 100), "a decision change posts");
        assert!(!posts.should_post(1, false, 150));
        assert!(posts.should_post(1, true, 200), "and so does changing back");
        assert!(posts.should_post(2, true, 250), "a new revision posts");
        assert!(!posts.should_post(2, true, 1_249));
        assert!(
            posts.should_post(2, true, 1_250),
            "an unchanged pass retries after 1 s"
        );
        assert!(!posts.should_post(2, true, 1_300));
    }
}
