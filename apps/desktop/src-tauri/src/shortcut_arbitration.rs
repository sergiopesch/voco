//! Admission is shared by consuming IBus and passive fallback backends.
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

// Matches the engine's monotonic poll-trigger arm lifetime. Start this bound
// when a response/error arrives, conservatively later than engine processing.
const ENGINE_ARM_MS: i64 = 1_000;

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

    pub fn is_current(&self, now: i64) -> bool {
        self.polling.load(Ordering::SeqCst) || now < self.expires_at.load(Ordering::SeqCst)
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
}
