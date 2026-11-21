//! Separate confirmed IBus authority from uncertainty while its poll is in flight.
//! Passive evdev can observe a chord that IBus consumes, so it keeps both guards.
//! An X11 grab callback already consumed its chord and uses shared debounce only.
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::time::{Duration, Instant};

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
    /// How often VOCO closed its channel to the engine, and that count when
    /// the poll in flight began.
    closes: AtomicU64,
    poll_closes: AtomicU64,
}

impl ConsumingLease {
    pub const fn new() -> Self {
        Self {
            polling: AtomicBool::new(false),
            expires_at: AtomicI64::new(-1),
            closes: AtomicU64::new(0),
            poll_closes: AtomicU64::new(0),
        }
    }

    /// Call just before sending a request that can arm the engine, today only
    /// poll-trigger. A connect or hello that fails first cannot have armed it,
    /// so it must not hold back evdev.
    pub fn begin_poll(&self) {
        // The engine can process a chord before its poll reply reaches us.
        self.poll_closes
            .store(self.closes.load(Ordering::SeqCst), Ordering::SeqCst);
        self.polling.store(true, Ordering::SeqCst);
    }

    /// VOCO closed its channel to the engine, which disarms the shortcut there
    /// at once, so the lease ends with it. Left to run out, it kept the X11
    /// grab and evdev away for up to a second in which the engine took no
    /// chord either. A poll that went out on that channel renews nothing when
    /// its reply is counted afterwards. Returns whether a lease ended, which
    /// is when the fallback has to come back.
    pub fn channel_closed(&self, now: i64) -> bool {
        self.closes.fetch_add(1, Ordering::SeqCst);
        now < self.expires_at.swap(-1, Ordering::SeqCst)
    }

    pub fn finish_poll(&self, now: i64, outcome: PollOutcome) {
        match outcome {
            PollOutcome::Armed | PollOutcome::Uncertain => {
                self.expires_at
                    .store(now.saturating_add(ENGINE_ARM_MS), Ordering::SeqCst);
                // Compared after the store, so a close on another thread ends
                // the lease whichever of the two runs last.
                if self.closes.load(Ordering::SeqCst) != self.poll_closes.load(Ordering::SeqCst) {
                    self.expires_at.store(-1, Ordering::SeqCst);
                }
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

/// A held key's repeats follow each other at the keyboard's repeat interval,
/// 20 to 50 ms on the desktops VOCO supports, and a busy desktop can run one
/// late. A `voco --toggle` this soon after another is taken for a repeat.
/// That also takes a press this soon after a held key's last repeat for one,
/// which only has to be pressed again; a late repeat taken for a press would
/// start or stop a dictation by itself.
pub const COMMAND_TRAIN: Duration = Duration::from_millis(150);
/// After this long without a `voco --toggle`, the next is a press: a key
/// still held would have repeated, since keyboards wait far less than this
/// before the first repeat, 500 to 660 ms by default.
const COMMAND_QUIET: Duration = Duration::from_secs(2);

/// What one `voco --toggle` is, outside the snap.
#[derive(Debug, PartialEq)]
pub enum CommandCall {
    /// A press: it toggles.
    Press,
    /// A held key's repeat: it doesn't.
    Repeat,
    /// A press, or the first repeat of the one before: `settle` says which
    /// once `COMMAND_TRAIN` has passed.
    Unsettled(u64),
}

/// The `voco --toggle` calls of a desktop shortcut, outside the snap. The
/// desktop runs the command for the press and again for each repeat while the
/// key is held, and reports no release (AGENTS.md, Shortcut). VOCO can't read
/// every desktop's repeat delay, so a repeat is told by what follows it: a
/// held key's first repeat is followed by the next within `COMMAND_TRAIN`,
/// and a second press isn't.
#[derive(Default)]
pub struct CommandCalls {
    last: Option<Instant>,
    unsettled: Option<u64>,
    serial: u64,
}

impl CommandCalls {
    pub const fn new() -> Self {
        Self {
            last: None,
            unsettled: None,
            serial: 0,
        }
    }

    /// A call at `now`. The first value says that the call before it, left
    /// unsettled, was a press after all: nothing followed it in time, and
    /// its own `settle` hasn't run yet.
    pub fn note(&mut self, now: Instant) -> (bool, CommandCall) {
        let gap = self.last.map(|last| now.saturating_duration_since(last));
        self.last = Some(now);
        match gap {
            // A repeat, which also shows an unsettled call before it to have
            // been the first repeat of its train.
            Some(gap) if gap < COMMAND_TRAIN => {
                self.unsettled = None;
                (false, CommandCall::Repeat)
            }
            Some(gap) if gap < COMMAND_QUIET => {
                let earlier = self.unsettled.take().is_some();
                self.serial += 1;
                self.unsettled = Some(self.serial);
                (earlier, CommandCall::Unsettled(self.serial))
            }
            _ => (self.unsettled.take().is_some(), CommandCall::Press),
        }
    }

    /// `COMMAND_TRAIN` after an unsettled call: true when it was a press,
    /// false when a repeat followed it or a later call already settled it.
    pub fn settle(&mut self, serial: u64) -> bool {
        if self.unsettled == Some(serial) {
            self.unsettled = None;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    /// The toggles a train of `voco --toggle` calls makes, at these times in
    /// milliseconds, each unsettled call settled when its time comes.
    fn command_toggles(times_ms: &[u64]) -> Vec<u64> {
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let train = COMMAND_TRAIN.as_millis() as u64;
        let mut calls = CommandCalls::new();
        let mut toggles = Vec::new();
        let mut waiting: Option<(u64, u64)> = None;
        for &time in times_ms {
            // An unsettled call's timer fires before any call after it is due.
            if let Some((serial, due)) = waiting {
                if due <= time {
                    waiting = None;
                    if calls.settle(serial) {
                        toggles.push(due);
                    }
                }
            }
            let (earlier, call) = calls.note(at(time));
            assert!(
                !earlier,
                "a timer that fired in time left nothing to settle"
            );
            match call {
                CommandCall::Press => toggles.push(time),
                CommandCall::Repeat => waiting = None,
                CommandCall::Unsettled(serial) => waiting = Some((serial, time + train)),
            }
        }
        if let Some((serial, due)) = waiting {
            if calls.settle(serial) {
                toggles.push(due);
            }
        }
        toggles
    }

    /// One key held from `from` for `hold` ms at a keyboard's repeat timing.
    fn held(from: u64, delay: u64, interval: u64, hold: u64) -> Vec<u64> {
        let mut times = vec![from];
        let mut at = from + delay;
        while at <= from + hold {
            times.push(at);
            at += interval;
        }
        times
    }

    #[test]
    fn a_held_command_key_toggles_once_at_any_desktop_repeat_timing() {
        // GNOME's defaults, then KDE's and Sway's, then a slow and a fast keyboard.
        for (delay, interval) in [(500, 30), (600, 40), (660, 40), (1000, 100), (200, 20)] {
            assert_eq!(
                command_toggles(&held(0, delay, interval, 3_000)),
                [0],
                "{delay} ms, then every {interval} ms"
            );
        }
    }

    #[test]
    fn each_tap_of_the_command_key_toggles() {
        // Start, then stop well after: both at once.
        assert_eq!(command_toggles(&[0, 5_000]), [0, 5_000]);
        // Stop half a second after start, where a first repeat would come:
        // nothing follows it, so it toggles once that is known.
        assert_eq!(command_toggles(&[0, 500]), [0, 650]);
        // Three taps a second apart.
        assert_eq!(command_toggles(&[0, 1_000, 2_000]), [0, 1_150, 2_150]);
        // A bounce is no second press.
        assert_eq!(command_toggles(&[0, 40]), [0]);
    }

    #[test]
    fn a_tap_then_a_held_command_key_toggle_once_each() {
        let mut times = vec![0];
        times.extend(held(600, 500, 30, 2_000));
        assert_eq!(command_toggles(&times), [0, 750]);
        // Held, released, then tapped soon after the last repeat.
        let mut times = held(0, 500, 30, 2_000);
        times.push(2_400);
        assert_eq!(command_toggles(&times), [0, 2_550]);
    }

    #[test]
    fn a_press_is_taken_for_a_repeat_only_right_after_a_held_keys_last_one() {
        // Held with its last repeat at 1490 ms, then pressed again 110 ms on:
        // as late as a repeat can run, so it is taken for one.
        let mut times = held(0, 500, 30, 1_500);
        assert_eq!(times.last(), Some(&1_490));
        times.push(1_600);
        assert_eq!(command_toggles(&times), [0]);
        // From 150 ms after the last repeat it is a press again.
        let mut times = held(0, 500, 30, 1_500);
        times.push(1_640);
        assert_eq!(command_toggles(&times), [0, 1_790]);
    }

    #[test]
    fn a_stall_in_a_held_command_keys_repeats_toggles_nothing() {
        // The desktop starts one process a repeat, and a busy one can run late.
        let mut times = held(0, 500, 30, 1_000);
        times.extend(held(1_300, 30, 30, 600));
        assert_eq!(command_toggles(&times), [0]);
    }

    #[test]
    fn an_unsettled_command_call_is_a_press_when_its_timer_runs_late() {
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut calls = CommandCalls::new();
        assert_eq!(calls.note(at(0)), (false, CommandCall::Press));
        assert_eq!(calls.note(at(500)), (false, CommandCall::Unsettled(1)));
        // The next call comes before the first one's timer got to run: the
        // first was a press, said here, and its late timer adds no second.
        assert_eq!(calls.note(at(900)), (true, CommandCall::Unsettled(2)));
        assert!(!calls.settle(1));
        assert!(calls.settle(2));
        assert!(!calls.settle(2));
        // A repeat settles the call before it as no press.
        assert_eq!(calls.note(at(1_400)), (false, CommandCall::Unsettled(3)));
        assert_eq!(calls.note(at(1_430)), (false, CommandCall::Repeat));
        assert!(!calls.settle(3));
        // After a long silence a call is a press at once.
        assert_eq!(calls.note(at(9_000)), (false, CommandCall::Press));
    }

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
    fn closing_the_channel_ends_the_lease_at_once() {
        let lease = ConsumingLease::new();
        lease.begin_poll();
        lease.finish_poll(1000, PollOutcome::Armed);
        assert!(lease.has_authority(1100));
        assert!(lease.channel_closed(1100), "a lease ended");
        assert!(!lease.has_authority(1100), "the engine disarmed with it");
        assert!(!lease.suppresses_backend("evdev", 1100));
        assert!(!lease.channel_closed(1150), "none was left to end");
        // The next channel's poll arms the engine again.
        lease.begin_poll();
        lease.finish_poll(1300, PollOutcome::Armed);
        assert!(lease.has_authority(1400));
    }

    #[test]
    fn a_poll_from_before_the_close_cannot_renew_the_lease() {
        for outcome in [PollOutcome::Armed, PollOutcome::Uncertain] {
            let lease = ConsumingLease::new();
            lease.begin_poll();
            // The channel closes after the engine answered and before the
            // listener counts the reply.
            assert!(!lease.channel_closed(990));
            lease.finish_poll(1000, outcome);
            assert!(!lease.has_authority(1000));
            assert!(!lease.is_current(1000));
        }
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
