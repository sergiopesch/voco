//! Own the X11 dictation shortcut scope for one frontend recording session.
//!
//! A session outlives individual clipboard transactions: Stop can arrive between
//! batches while a final suffix still needs the original destination identity.
//! This changes the grab window, never AT-SPI focus or delivery acceptance rules.
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    LazyLock, Mutex,
};

static HOTKEY: AtomicU64 = AtomicU64::new(0); // id + 1; all u32 IDs remain representable.
static DEGRADED: AtomicBool = AtomicBool::new(false);
// Invalidated synchronously on main-page load, without waiting on X11 or delivery.
static RENDERER_EPOCH: AtomicU64 = AtomicU64::new(1);

pub(crate) fn renderer_epoch() -> u64 {
    RENDERER_EPOCH.load(Ordering::SeqCst)
}

pub(crate) fn invalidate_renderer() -> u64 {
    RENDERER_EPOCH.fetch_add(1, Ordering::SeqCst) + 1
}

fn ensure_epoch(expected: u64, actual: u64) -> Result<(), String> {
    if expected != actual {
        return Err("The recording window changed. Start a new recording.".into());
    }
    Ok(())
}

fn acquire_for_renderer<L>(
    expected: u64,
    current: impl Fn() -> u64,
    acquire: impl FnOnce() -> Result<Option<L>, String>,
    release: impl FnOnce(L) -> Result<(), String>,
) -> Result<Option<L>, String> {
    ensure_epoch(expected, current())?;
    let lease = acquire()?;
    if let Err(stale) = ensure_epoch(expected, current()) {
        if let Some(lease) = lease {
            release(lease)?;
        }
        return Err(stale);
    }
    Ok(lease)
}

struct Owned<L> {
    session: String,
    epoch: u64,
    lease: L,
}

struct SessionSlot<L> {
    active: Option<Owned<L>>,
}

impl<L> SessionSlot<L> {
    fn begin(
        &mut self,
        session: &str,
        epoch: u64,
        acquire: impl FnOnce() -> Result<Option<L>, String>,
    ) -> Result<(), String> {
        if let Some(active) = &self.active {
            return if active.session == session && active.epoch == epoch {
                Ok(())
            } else {
                Err(
                    "Another recording still owns shortcut cleanup. Try again after it finishes."
                        .into(),
                )
            };
        }
        self.active = acquire()?.map(|lease| Owned {
            session: session.into(),
            epoch,
            lease,
        });
        Ok(())
    }

    fn take_before_epoch(&mut self, cutoff: u64) -> Option<L> {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.epoch < cutoff)
        {
            self.active.take().map(|active| active.lease)
        } else {
            None
        }
    }

    fn take(&mut self, session: &str) -> Option<L> {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.session == session)
        {
            self.active.take().map(|active| active.lease)
        } else {
            None
        }
    }
}

// Global-hotkey's actor owns X requests and its fixed 650-second watchdog.
// No periodic frontend timer, polling IPC or target identity enters diagnostics.
static SESSION: LazyLock<Mutex<SessionSlot<global_hotkey::FocusLease>>> =
    LazyLock::new(|| Mutex::new(SessionSlot { active: None }));

pub(crate) fn registered(id: Option<u32>) {
    HOTKEY.store(id.map_or(0, |id| u64::from(id) + 1), Ordering::SeqCst);
    // Registration success is a fresh proof. The actor revokes previous scopes
    // before changing a binding; an old session's later end cannot affect it.
    DEGRADED.store(false, Ordering::SeqCst);
}

pub(crate) fn degraded() -> bool {
    DEGRADED.load(Ordering::SeqCst)
        || SESSION
            .lock()
            .map(|slot| {
                slot.active
                    .as_ref()
                    .is_some_and(|active| active.lease.is_degraded())
            })
            .unwrap_or(true)
}

/// Automatic root restoration proves cleanup, not continued session scope.
/// Keep an old stream from silently continuing after focus/configuration changes.
pub(crate) fn delivery_ready() -> bool {
    !DEGRADED.load(Ordering::SeqCst)
        && SESSION
            .lock()
            .map(|slot| {
                slot.active.as_ref().is_none_or(|active| {
                    active.epoch == renderer_epoch()
                        && active.lease.is_active()
                        && !active.lease.is_degraded()
                })
            })
            .unwrap_or(false)
}

fn validate_session(session: &str) -> Result<(), String> {
    if session.is_empty()
        || session.len() > 128
        || !session
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid recording shortcut session.".into());
    }
    Ok(())
}

/// Called under insertion's delivery lock, before starting capture.
pub(crate) fn begin(session: &str, expected_epoch: u64) -> Result<(), String> {
    validate_session(session)?;
    ensure_epoch(expected_epoch, renderer_epoch())?;
    // A replacement renderer may reach Begin before the background reset job.
    // Both hold DELIVERY_LOCK; only the older epoch is eligible for cleanup.
    end_before_epoch(expected_epoch)?;
    ensure_epoch(expected_epoch, renderer_epoch())?;
    let hotkey = HOTKEY.load(Ordering::SeqCst);
    if hotkey == 0
        || std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
        || std::env::var_os("DISPLAY").is_none()
    {
        return Ok(()); // Evdev/IBus/Wayland routes retain their existing behavior.
    }
    if degraded() {
        return Err(
            "The recording shortcut needs attention. Restart VOCO before trying again.".into(),
        );
    }
    let mut slot = SESSION
        .lock()
        .map_err(|_| "Shortcut session state is unavailable.")?;
    slot.begin(session, expected_epoch, || {
        acquire_for_renderer(
            expected_epoch,
            renderer_epoch,
            || {
                // Starting on KeyPress can precede the user's release. Retry only this
                // explicit pre-mutation state; failed/uncertain grab requests never retry.
                let started = std::time::Instant::now();
                loop {
                    ensure_epoch(expected_epoch, renderer_epoch())?;
                    match global_hotkey::acquire_focus_lease((hotkey - 1) as u32) {
                        Ok(lease) => break Ok(Some(lease)),
                        // No concrete X window (or changed focus with confirmed rollback)
                        // keeps the existing strict/best-effort delivery route. Never
                        // turn an unsupported desktop into a new microphone failure.
                        Err(global_hotkey::FocusLeaseError::FocusUnavailable) => break Ok(None),
                        Err(global_hotkey::FocusLeaseError::ShortcutHeld)
                            if started.elapsed() < std::time::Duration::from_secs(1) =>
                        {
                            std::thread::sleep(std::time::Duration::from_millis(10));
                        }
                        Err(error) => {
                            if matches!(
                                error,
                                global_hotkey::FocusLeaseError::RestorationFailed
                                    | global_hotkey::FocusLeaseError::ActorUnavailable
                                    | global_hotkey::FocusLeaseError::TimedOut
                            ) {
                                // An uncertain acquire may have changed the server's
                                // binding. Do not advertise cached registration as ready.
                                DEGRADED.store(true, Ordering::SeqCst);
                            }
                            break Err(
                        "Could not reserve the recording shortcut. Release its keys and try again."
                            .into(),
                    );
                        }
                    }
                }
            },
            finish_lease,
        )
    })
}

/// A late end belongs only to its original session. Never take a newer lease.
pub(crate) fn end(session: &str) -> Result<(), String> {
    validate_session(session)?;
    let lease = SESSION
        .lock()
        .map_err(|_| "Shortcut session state is unavailable.")?
        .take(session);
    lease.map_or(Ok(()), finish_lease)
}

/// Reset jobs may run after a fresh renderer has already acquired its own scope.
/// Take by cutoff, never unconditionally or by whatever owner is current then.
pub(crate) fn end_before_epoch(cutoff: u64) -> Result<(), String> {
    let lease = SESSION
        .lock()
        .map_err(|_| "Shortcut session state is unavailable.")?
        .take_before_epoch(cutoff);
    lease.map_or(Ok(()), finish_lease)
}

fn finish_lease(lease: global_hotkey::FocusLease) -> Result<(), String> {
    if lease.finish().is_err() {
        DEGRADED.store(true, Ordering::SeqCst);
        return Err(
            "VOCO could not confirm shortcut cleanup. Restart VOCO if the shortcut stays reserved."
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_begin_does_not_acquire_twice() {
        let mut slot = SessionSlot { active: None };
        slot.begin("first", 1, || Ok(Some(7))).unwrap();
        slot.begin("first", 1, || panic!("duplicate acquisition"))
            .unwrap();
        assert_eq!(slot.take("first"), Some(7));
    }
    #[test]
    fn stale_end_and_overlapping_begin_preserve_owner() {
        let mut slot = SessionSlot { active: None };
        slot.begin("new", 1, || Ok(Some(9))).unwrap();
        assert!(slot.begin("old", 1, || panic!("overlap acquired")).is_err());
        assert_eq!(slot.take("old"), None);
        assert_eq!(slot.take("new"), Some(9));
        assert_eq!(slot.take("new"), None);
    }
    #[test]
    fn failed_acquisition_does_not_reserve_session() {
        let mut slot = SessionSlot { active: None };
        assert!(slot
            .begin("failed", 1, || Err("unavailable".into()))
            .is_err());
        slot.begin("next", 1, || Ok(Some(3))).unwrap();
        assert_eq!(slot.take("next"), Some(3));
    }
    #[test]
    fn unsupported_scope_does_not_reserve_or_replace_an_owner() {
        let mut slot = SessionSlot { active: None };
        slot.begin("unsupported", 1, || Ok(None::<u8>)).unwrap();
        slot.begin("next", 1, || Ok(Some(5))).unwrap();
        assert_eq!(slot.take("unsupported"), None);
        assert_eq!(slot.take("next"), Some(5));
    }

    #[test]
    fn stale_queued_begin_never_acquires() {
        let mut slot = SessionSlot { active: None };
        let result = slot.begin("old-renderer", 1, || {
            acquire_for_renderer(
                1,
                || 2,
                || panic!("stale Begin mutated X11"),
                |_: u8| Ok(()),
            )
        });
        assert!(result.unwrap_err().contains("window changed"));
        assert!(slot.active.is_none());
    }

    #[test]
    fn reload_during_acquire_releases_before_replacement_can_begin() {
        use std::cell::Cell;
        let epoch = Cell::new(1);
        let released = Cell::new(None);
        let mut slot = SessionSlot { active: None };
        let result = slot.begin("old-renderer", 1, || {
            acquire_for_renderer(
                1,
                || epoch.get(),
                || {
                    epoch.set(2); // PageLoad Started while actor acquisition is pending.
                    Ok(Some(11))
                },
                |lease| {
                    released.set(Some(lease));
                    Ok(())
                },
            )
        });
        assert!(result.unwrap_err().contains("window changed"));
        assert_eq!(released.get(), Some(11));
        assert!(slot.active.is_none());
        slot.begin("new-renderer", 2, || Ok(Some(22))).unwrap();
        assert_eq!(slot.take_before_epoch(2), None); // Late reset does not steal it.
        assert_eq!(slot.take("old-renderer"), None);
        assert_eq!(slot.take("new-renderer"), Some(22));
    }

    #[test]
    fn active_reload_cleanup_and_out_of_order_reset_preserve_new_owner() {
        let mut slot = SessionSlot { active: None };
        slot.begin("old-renderer", 1, || Ok(Some(11))).unwrap();
        assert_eq!(slot.take_before_epoch(2), Some(11));
        slot.begin("new-renderer", 3, || Ok(Some(33))).unwrap();
        assert_eq!(slot.take_before_epoch(2), None);
        assert_eq!(slot.take_before_epoch(3), None);
        assert_eq!(slot.take("old-renderer"), None);
        assert_eq!(slot.take("new-renderer"), Some(33));
    }

    #[test]
    fn stale_acquisition_cleanup_failure_is_not_reported_as_success() {
        use std::cell::Cell;
        let epoch = Cell::new(1);
        let mut slot = SessionSlot { active: None };
        let result = slot.begin("old-renderer", 1, || {
            acquire_for_renderer(
                1,
                || epoch.get(),
                || {
                    epoch.set(2);
                    Ok(Some(11))
                },
                |_| Err("cleanup unconfirmed".into()),
            )
        });
        assert_eq!(result, Err("cleanup unconfirmed".into()));
        assert!(slot.active.is_none());
    }

    #[test]
    fn unsupported_acquisition_still_rejects_a_renderer_reset() {
        use std::cell::Cell;
        let epoch = Cell::new(1);
        let result = acquire_for_renderer(
            1,
            || epoch.get(),
            || {
                epoch.set(2);
                Ok(None::<u8>)
            },
            |_| panic!("unsupported route owns no lease"),
        );
        assert!(result.unwrap_err().contains("window changed"));
    }

    #[test]
    fn only_bounded_non_content_session_ids_are_accepted() {
        for id in ["", "a b", "../target", "field:123", &"a".repeat(129)] {
            assert!(validate_session(id).is_err());
        }
        assert!(validate_session("53447b45-c0d1-4e01-b12c-33eeb1f2d205").is_ok());
    }
}
