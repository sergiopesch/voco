// Copyright 2026 VOCO Contributors
// SPDX-License-Identifier: Apache-2.0 OR MIT
// This addition changes shortcut scope, never the application's delivery receipt rules.

use super::wake::WakeSender;
use super::{ignored_mods, HotKeyState, ThreadMessage};
use crossbeam_channel::bounded;
use once_cell::sync::Lazy;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    ChangeWindowAttributesAux, ConnectionExt, EventMask, GrabMode, Keycode, MapState, ModMask,
    NotifyMode, Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

// Existing audio limit is 600 seconds; permit 50 seconds for finalization. This
// watchdog never extends any paste observation deadline and is not renewed.
const MAX_LEASE: Duration = Duration::from_secs(650);
const REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
static NEXT_NONCE: AtomicU64 = AtomicU64::new(1);
static ACTORS: Lazy<Mutex<Vec<Weak<Actor>>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Finite errors: no window identifiers, destination content or titles escape.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum FocusLeaseError {
    #[error("X11 shortcut owner is unavailable")]
    Unavailable,
    #[error("X11 shortcut has multiple registered owners")]
    AmbiguousOwner,
    #[error("Another X11 focus lease is active")]
    Busy,
    #[error("X11 shortcut registration changed")]
    StaleRegistration,
    #[error("A concrete X11 focus window is unavailable")]
    FocusUnavailable,
    #[error("Release the shortcut before starting its focus lease")]
    ShortcutHeld,
    #[error("Could not scope the X11 shortcut")]
    RegistrationFailed,
    #[error("Could not restore the global X11 shortcut")]
    RestorationFailed,
    #[error("X11 shortcut actor stopped")]
    ActorUnavailable,
    #[error("X11 shortcut request timed out")]
    TimedOut,
    #[error("X11 focus lease is no longer active")]
    Inactive,
}

type LeaseResult = Result<(), FocusLeaseError>;
pub(super) type Completion = Arc<Mutex<Option<LeaseResult>>>;

pub(super) struct AcquireRequest {
    pub(super) id: u32,
    pub(super) generation: u64,
    pub(super) nonce: u64,
    pub(super) completion: Completion,
}

pub(super) struct Actor {
    pub(super) tx: WakeSender<ThreadMessage>,
    registrations: Mutex<BTreeMap<u32, u64>>,
    next_generation: AtomicU64,
}

impl Actor {
    pub(super) fn new(tx: impl Into<WakeSender<ThreadMessage>>) -> Arc<Self> {
        let actor = Arc::new(Self {
            tx: tx.into(),
            registrations: Mutex::new(BTreeMap::new()),
            next_generation: AtomicU64::new(1),
        });
        let mut actors = ACTORS.lock().unwrap_or_else(|p| p.into_inner());
        actors.retain(|a| a.strong_count() != 0);
        actors.push(Arc::downgrade(&actor));
        actor
    }

    pub(super) fn registered(&self, id: u32) {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        self.registrations
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(id, generation);
    }

    pub(super) fn unregistered(&self, id: u32) {
        self.registrations
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&id);
    }

    pub(super) fn clear(&self) {
        self.registrations
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }

    fn generation(&self, id: u32) -> Option<u64> {
        self.registrations.lock().ok()?.get(&id).copied()
    }
}

fn only_owner<T>(mut owners: Vec<T>) -> Result<T, FocusLeaseError> {
    match owners.len() {
        0 => Err(FocusLeaseError::Unavailable),
        1 => Ok(owners.pop().unwrap()),
        _ => Err(FocusLeaseError::AmbiguousOwner),
    }
}

/// Bind an already-registered shortcut to the exact X input-focus window.
///
/// The caller must retain this guard through its complete desktop streaming
/// session and final drain, then call `finish`. Real X focus departure, window
/// destruction, registration changes and the fixed watchdog restore root scope.
/// This does not assert destination ownership or receipt of pasted text.
pub fn acquire_focus_lease(hotkey_id: u32) -> Result<FocusLease, FocusLeaseError> {
    let (actor, generation) = {
        let mut actors = ACTORS
            .lock()
            .map_err(|_| FocusLeaseError::ActorUnavailable)?;
        actors.retain(|a| a.strong_count() != 0);
        let owners = actors
            .iter()
            .filter_map(Weak::upgrade)
            .filter_map(|actor| {
                actor
                    .generation(hotkey_id)
                    .map(|generation| (actor, generation))
            })
            .collect();
        only_owner(owners)?
    };
    let nonce = NEXT_NONCE.fetch_add(1, Ordering::Relaxed);
    let mut guard = FocusLease {
        actor,
        nonce,
        active: true,
        completion: Arc::new(Mutex::new(None)),
    };
    let (tx, rx) = bounded(1);
    guard
        .actor
        .tx
        .send(ThreadMessage::AcquireFocusLease {
            request: AcquireRequest {
                id: hotkey_id,
                generation,
                nonce,
                completion: guard.completion.clone(),
            },
            reply: tx,
        })
        .map_err(|_| FocusLeaseError::ActorUnavailable)?;
    match rx.recv_timeout(REQUEST_TIMEOUT) {
        Ok(Ok(())) => Ok(guard),
        Ok(Err(error)) => {
            // Even a failed acquire may have queued rollback work; release is
            // nonce-bound and cannot alter a newer lease.
            guard.release_without_wait();
            Err(error)
        }
        Err(_) => Err(FocusLeaseError::TimedOut), // guard Drop enqueues cancellation
    }
}

/// Session-owned lease. Drop is a best-effort cancellation, not proof of restore.
pub struct FocusLease {
    actor: Arc<Actor>,
    nonce: u64,
    active: bool,
    completion: Completion,
}

impl FocusLease {
    /// Explicitly restore global scope and report whether restoration succeeded.
    pub fn finish(mut self) -> LeaseResult {
        let completed = *self
            .completion
            .lock()
            .map_err(|_| FocusLeaseError::ActorUnavailable)?;
        if let Some(result) = completed {
            self.active = false;
            return result;
        }
        let (tx, rx) = bounded(1);
        self.actor
            .tx
            .send(ThreadMessage::ReleaseFocusLease {
                nonce: self.nonce,
                reply: Some(tx),
            })
            .map_err(|_| FocusLeaseError::ActorUnavailable)?;
        let result = rx
            .recv_timeout(REQUEST_TIMEOUT)
            .unwrap_or(Err(FocusLeaseError::TimedOut));
        // The actor may have auto-restored this lease and completed another one
        // before processing this stale finish. Its own completion is authoritative.
        let completed = *self
            .completion
            .lock()
            .map_err(|_| FocusLeaseError::ActorUnavailable)?;
        if result != Err(FocusLeaseError::TimedOut) || completed.is_some() {
            self.active = false;
        }
        completed.unwrap_or(result)
    }

    /// Whether this guard still owns an active scoped binding. A successful
    /// automatic restoration is healthy cleanup, but is no longer scoped.
    pub fn is_active(&self) -> bool {
        self.active
            && self
                .completion
                .lock()
                .map(|result| result.is_none())
                .unwrap_or(false)
    }

    /// A failed automatic restoration remains visible even after another lease
    /// completes; callers must not claim the global shortcut is still ready.
    pub fn is_degraded(&self) -> bool {
        self.completion
            .lock()
            .map(|result| matches!(*result, Some(Err(_))))
            .unwrap_or(true)
    }

    fn release_without_wait(&mut self) {
        if self.active {
            let _ = self.actor.tx.send(ThreadMessage::ReleaseFocusLease {
                nonce: self.nonce,
                reply: None,
            });
            self.active = false;
        }
    }
}

impl Drop for FocusLease {
    fn drop(&mut self) {
        self.release_without_wait();
    }
}

struct Lease {
    id: u32,
    generation: u64,
    nonce: u64,
    keycode: Keycode,
    mods: ModMask,
    window: Window,
    previous_event_mask: EventMask,
    expires: Instant,
    completion: Completion,
}

#[derive(Default)]
pub(super) struct LeaseState {
    current: Option<Lease>,
    // Only the most recent completion is retained. A stale guard can never
    // mutate the current lease, even if another session uses the same shortcut.
    completed: Option<(u64, LeaseResult)>,
}

impl Drop for LeaseState {
    fn drop(&mut self) {
        if let Some(lease) = self.current.take() {
            *lease.completion.lock().unwrap_or_else(|p| p.into_inner()) =
                Some(Err(FocusLeaseError::ActorUnavailable));
        }
    }
}

fn grab_variants(
    conn: &RustConnection,
    window: Window,
    keycode: Keycode,
    mods: ModMask,
) -> LeaseResult {
    for extra in ignored_mods() {
        let result = conn
            .grab_key(
                false,
                window,
                mods | extra,
                keycode,
                GrabMode::ASYNC,
                GrabMode::ASYNC,
            )
            .map_err(|_| FocusLeaseError::RegistrationFailed)
            .and_then(|cookie| {
                cookie
                    .check()
                    .map_err(|_| FocusLeaseError::RegistrationFailed)
            });
        if result.is_err() {
            let _ = ungrab_variants(conn, window, keycode, mods);
            return result;
        }
    }
    Ok(())
}

fn ungrab_variants(
    conn: &RustConnection,
    window: Window,
    keycode: Keycode,
    mods: ModMask,
) -> LeaseResult {
    let mut outcome = Ok(());
    for extra in ignored_mods() {
        if conn
            .ungrab_key(keycode, window, mods | extra)
            .map_err(|_| ())
            .and_then(|cookie| cookie.check().map_err(|_| ()))
            .is_err()
        {
            outcome = Err(FocusLeaseError::RegistrationFailed);
        }
    }
    outcome
}

fn concrete_focus(conn: &RustConnection, root: Window) -> Result<Window, FocusLeaseError> {
    let window = conn
        .get_input_focus()
        .map_err(|_| FocusLeaseError::FocusUnavailable)?
        .reply()
        .map_err(|_| FocusLeaseError::FocusUnavailable)?
        .focus;
    if window <= 1 || window == root {
        return Err(FocusLeaseError::FocusUnavailable);
    }
    let attrs = conn
        .get_window_attributes(window)
        .map_err(|_| FocusLeaseError::FocusUnavailable)?
        .reply()
        .map_err(|_| FocusLeaseError::FocusUnavailable)?;
    if attrs.map_state != MapState::VIEWABLE {
        return Err(FocusLeaseError::FocusUnavailable);
    }
    Ok(window)
}

fn key_is_down(keys: &[u8; 32], key: Keycode) -> bool {
    keys[key as usize / 8] & (1 << (key % 8)) != 0
}

fn invalidating_event(event: &Event, window: Window) -> bool {
    match event {
        Event::FocusOut(event) => {
            event.event == window
                && (event.mode == NotifyMode::NORMAL || event.mode == NotifyMode::WHILE_GRABBED)
        }
        Event::DestroyNotify(event) => event.window == window,
        Event::UnmapNotify(event) => event.window == window,
        _ => false,
    }
}

enum ReleaseDecision {
    Restore,
    Complete(LeaseResult),
}

fn release_decision(
    current: Option<u64>,
    completed: Option<(u64, LeaseResult)>,
    nonce: u64,
) -> ReleaseDecision {
    if current == Some(nonce) {
        return ReleaseDecision::Restore;
    }
    if let Some((completed, result)) = completed {
        if completed == nonce {
            return ReleaseDecision::Complete(result);
        }
    }
    ReleaseDecision::Complete(Err(FocusLeaseError::Inactive))
}

impl LeaseState {
    pub(super) fn deadline(&self) -> Option<Instant> {
        self.current.as_ref().map(|lease| lease.expires)
    }

    pub(super) fn acquire(
        &mut self,
        conn: &RustConnection,
        root: Window,
        hotkeys: &BTreeMap<Keycode, Vec<HotKeyState>>,
        actor: &Actor,
        request: AcquireRequest,
    ) -> LeaseResult {
        let AcquireRequest {
            id,
            generation,
            nonce,
            completion,
        } = request;
        if self.current.is_some() {
            return Err(FocusLeaseError::Busy);
        }
        if actor.generation(id) != Some(generation) {
            return Err(FocusLeaseError::StaleRegistration);
        }
        let matches: Vec<_> = hotkeys
            .iter()
            .flat_map(|(key, entries)| {
                entries
                    .iter()
                    .filter(move |state| state.id == id)
                    .map(move |state| (*key, state))
            })
            .collect();
        let (keycode, state) = only_owner(matches)?;
        if hotkeys.values().flatten().any(|state| state.pressed) {
            return Err(FocusLeaseError::ShortcutHeld);
        }
        let keys = conn
            .query_keymap()
            .map_err(|_| FocusLeaseError::FocusUnavailable)?
            .reply()
            .map_err(|_| FocusLeaseError::FocusUnavailable)?
            .keys;
        if key_is_down(&keys, keycode) {
            return Err(FocusLeaseError::ShortcutHeld);
        }
        let window = concrete_focus(conn, root)?;
        let previous_event_mask = conn
            .get_window_attributes(window)
            .map_err(|_| FocusLeaseError::FocusUnavailable)?
            .reply()
            .map_err(|_| FocusLeaseError::FocusUnavailable)?
            .your_event_mask;
        conn.change_window_attributes(
            window,
            &ChangeWindowAttributesAux::new().event_mask(
                previous_event_mask | EventMask::FOCUS_CHANGE | EventMask::STRUCTURE_NOTIFY,
            ),
        )
        .map_err(|_| FocusLeaseError::RegistrationFailed)?
        .check()
        .map_err(|_| FocusLeaseError::RegistrationFailed)?;
        if let Err(error) = grab_variants(conn, window, keycode, state.mods) {
            let _ = conn
                .change_window_attributes(
                    window,
                    &ChangeWindowAttributesAux::new().event_mask(previous_event_mask),
                )
                .map(|cookie| cookie.ignore_error());
            let _ = conn.flush();
            return Err(error);
        }
        self.current = Some(Lease {
            id,
            generation,
            nonce,
            keycode,
            mods: state.mods,
            window,
            previous_event_mask,
            expires: Instant::now() + MAX_LEASE,
            completion,
        });
        // The ancestor root grab wins until all target variants are installed.
        // Retain the same HotKeyState; moving scope must not reset held-key state.
        let scoped = ungrab_variants(conn, root, keycode, state.mods).and_then(|_| {
            if concrete_focus(conn, root)? == window {
                Ok(())
            } else {
                Err(FocusLeaseError::FocusUnavailable)
            }
        });
        if let Err(error) = scoped {
            self.restore(conn, root, actor)?;
            return Err(error);
        }
        Ok(())
    }

    pub(super) fn restore(
        &mut self,
        conn: &RustConnection,
        root: Window,
        actor: &Actor,
    ) -> LeaseResult {
        let Some(lease) = self.current.take() else {
            return Ok(());
        };
        let result = grab_variants(conn, root, lease.keycode, lease.mods)
            .map_err(|_| FocusLeaseError::RestorationFailed);
        // Removing passive grabs does not release an active key grab. KeyRelease
        // still completes the original pressed state after restoration.
        let _ = ungrab_variants(conn, lease.window, lease.keycode, lease.mods);
        let _ = conn
            .change_window_attributes(
                lease.window,
                &ChangeWindowAttributesAux::new().event_mask(lease.previous_event_mask),
            )
            .map(|cookie| cookie.ignore_error());
        let _ = conn.flush();
        if result.is_err() {
            actor.unregistered(lease.id);
        }
        *lease.completion.lock().unwrap_or_else(|p| p.into_inner()) = Some(result);
        self.completed = Some((lease.nonce, result));
        result
    }

    pub(super) fn release(
        &mut self,
        conn: &RustConnection,
        root: Window,
        actor: &Actor,
        nonce: u64,
    ) -> LeaseResult {
        match release_decision(
            self.current.as_ref().map(|lease| lease.nonce),
            self.completed,
            nonce,
        ) {
            ReleaseDecision::Restore => self.restore(conn, root, actor),
            ReleaseDecision::Complete(result) => result,
        }
    }

    pub(super) fn observe(
        &mut self,
        conn: &RustConnection,
        root: Window,
        actor: &Actor,
        event: &Event,
    ) {
        if self
            .current
            .as_ref()
            .is_some_and(|lease| invalidating_event(event, lease.window))
        {
            let _ = self.restore(conn, root, actor);
        }
    }

    pub(super) fn maintain(&mut self, conn: &RustConnection, root: Window, actor: &Actor) {
        if self.current.as_ref().is_some_and(|lease| {
            Instant::now() >= lease.expires || actor.generation(lease.id) != Some(lease.generation)
        }) {
            let _ = self.restore(conn, root, actor);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use x11rb::protocol::xproto::{FocusOutEvent, NotifyDetail, FOCUS_OUT_EVENT};

    #[test]
    fn missing_or_ambiguous_owner_never_selects_arbitrarily() {
        assert_eq!(only_owner::<u32>(vec![]), Err(FocusLeaseError::Unavailable));
        assert_eq!(only_owner(vec![1, 2]), Err(FocusLeaseError::AmbiguousOwner));
        assert_eq!(only_owner(vec![7]), Ok(7));
    }

    #[test]
    fn keyboard_state_checks_full_keycode_range() {
        let mut keys = [0; 32];
        keys[0] = 1;
        keys[31] = 128;
        assert!(key_is_down(&keys, 0));
        assert!(key_is_down(&keys, 255));
        assert!(!key_is_down(&keys, 1));
        assert!(!key_is_down(&keys, 254));
    }

    #[test]
    fn real_departure_including_while_grabbed_invalidates_but_grab_notifications_do_not() {
        for (mode, expected) in [
            (NotifyMode::NORMAL, true),
            (NotifyMode::WHILE_GRABBED, true),
            (NotifyMode::GRAB, false),
            (NotifyMode::UNGRAB, false),
        ] {
            let event = Event::FocusOut(FocusOutEvent {
                response_type: FOCUS_OUT_EVENT,
                detail: NotifyDetail::NONLINEAR,
                sequence: 0,
                event: 42,
                mode,
            });
            assert_eq!(invalidating_event(&event, 42), expected);
            assert!(!invalidating_event(&event, 43));
        }
    }

    #[test]
    fn registration_generation_changes_on_replacement() {
        let (tx, _rx) = crossbeam_channel::unbounded();
        let actor = Actor::new(tx);
        actor.registered(9);
        let first = actor.generation(9).unwrap();
        actor.unregistered(9);
        assert_eq!(actor.generation(9), None);
        actor.registered(9);
        assert_ne!(actor.generation(9), Some(first));
        actor.clear();
        assert_eq!(actor.generation(9), None);
    }

    #[test]
    fn dropping_guard_releases_only_its_original_actor_and_nonce() {
        let (tx, rx) = crossbeam_channel::unbounded();
        let actor = Actor::new(tx);
        drop(FocusLease {
            actor,
            nonce: 41,
            active: true,
            completion: Arc::new(Mutex::new(None)),
        });
        match rx.try_recv().unwrap() {
            ThreadMessage::ReleaseFocusLease { nonce, reply } => {
                assert_eq!(nonce, 41);
                assert!(reply.is_none());
            }
            _ => panic!("unexpected actor request"),
        }
        assert!(rx.try_recv().is_err());
    }
    #[test]
    fn stale_release_does_not_restore_a_newer_session() {
        assert!(matches!(
            release_decision(Some(42), Some((41, Ok(()))), 41),
            ReleaseDecision::Complete(Ok(()))
        ));
        assert!(matches!(
            release_decision(Some(42), Some((41, Ok(()))), 40),
            ReleaseDecision::Complete(Err(FocusLeaseError::Inactive))
        ));
        assert!(matches!(
            release_decision(Some(42), Some((41, Ok(()))), 42),
            ReleaseDecision::Restore
        ));
    }

    #[test]
    fn automatic_restoration_failure_survives_later_actor_completions() {
        let (tx, rx) = crossbeam_channel::unbounded();
        let actor = Actor::new(tx);
        let guard = FocusLease {
            actor,
            nonce: 41,
            active: true,
            completion: Arc::new(Mutex::new(Some(Err(FocusLeaseError::RestorationFailed)))),
        };
        assert!(guard.is_degraded());
        assert_eq!(guard.finish(), Err(FocusLeaseError::RestorationFailed));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn timed_out_acquire_queues_nonce_bound_release_for_late_actor() {
        let (tx, rx) = crossbeam_channel::unbounded();
        let actor = Actor::new(tx);
        actor.registered(0xFA71_0001);
        let worker = std::thread::spawn(move || {
            let nonce = match rx.recv().unwrap() {
                ThreadMessage::AcquireFocusLease { request, reply } => {
                    let nonce = request.nonce;
                    std::thread::sleep(REQUEST_TIMEOUT + Duration::from_millis(60));
                    assert!(reply.send(Ok(())).is_err());
                    nonce
                }
                _ => panic!("unexpected actor request"),
            };
            match rx.recv_timeout(Duration::from_secs(1)).unwrap() {
                ThreadMessage::ReleaseFocusLease {
                    nonce: released,
                    reply,
                } => {
                    assert_eq!(released, nonce);
                    assert!(reply.is_none());
                }
                _ => panic!("missing acquire cancellation"),
            }
        });
        assert!(matches!(
            acquire_focus_lease(0xFA71_0001),
            Err(FocusLeaseError::TimedOut)
        ));
        worker.join().unwrap();
    }
    #[test]
    fn actor_exit_marks_active_guard_degraded_without_waiting_for_finish() {
        let (tx, _rx) = crossbeam_channel::unbounded();
        let actor = Actor::new(tx);
        let completion = Arc::new(Mutex::new(None));
        let guard = FocusLease {
            actor,
            nonce: 19,
            active: true,
            completion: completion.clone(),
        };
        let state = LeaseState {
            current: Some(Lease {
                id: 1,
                generation: 2,
                nonce: 19,
                keycode: 40,
                mods: ModMask::M1,
                window: 42,
                previous_event_mask: EventMask::NO_EVENT,
                expires: Instant::now() + MAX_LEASE,
                completion,
            }),
            completed: None,
        };
        assert!(!guard.is_degraded());
        drop(state);
        assert!(guard.is_degraded());
        assert_eq!(guard.finish(), Err(FocusLeaseError::ActorUnavailable));
    }
    #[test]
    fn healthy_automatic_restore_is_not_an_active_session_lease() {
        let (tx, rx) = crossbeam_channel::unbounded();
        let actor = Actor::new(tx);
        let completion = Arc::new(Mutex::new(None));
        let guard = FocusLease {
            actor,
            nonce: 22,
            active: true,
            completion: completion.clone(),
        };
        assert!(guard.is_active());
        *completion.lock().unwrap() = Some(Ok(()));
        assert!(!guard.is_active());
        assert!(!guard.is_degraded());
        assert_eq!(guard.finish(), Ok(()));
        assert!(rx.try_recv().is_err());
    }
}
