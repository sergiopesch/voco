//! GNOME's emulated-input connection for the snap's typing session (AGENTS.md,
//! Delivery). The RemoteDesktop portal's `ConnectToEIS` hands the session a
//! socket that speaks libei's protocol. VOCO sends its paste keys through it,
//! and from GNOME 50 the same connection reports the modifiers that are down,
//! so a paste waits for the keys really held instead of guessing from the
//! shortcut's signals. It carries modifier state only, never which key.

use crate::portal_keys::PortalPasteError;
use reis::ei;
use reis::event::{Connection, Device, DeviceCapability, EiEvent};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// evdev key codes, as libei's keyboard takes them.
const KEY_LEFTSHIFT: u32 = 42;
const KEY_INSERT: u32 = 110;
/// The gap between the four key events, as every other keyboard keeps.
const KEY_GAP: Duration = Duration::from_millis(12);
/// xkb's real modifiers keep X11's bits in every keymap xkbcommon compiles:
/// Shift, Control, Mod1 (Alt), Mod4 (Super) and Mod5 (AltGr), the ones
/// evdev's wait covers. Caps Lock and Num Lock are states, not held keys.
const CHORD_MODIFIERS: u32 = 0x01 | 0x04 | 0x08 | 0x40 | 0x80;

const NOT_READY: &str = "GNOME's keyboard for VOCO isn't ready, so it sent no paste keys.";

/// Whether a depressed-modifier mask holds a key that would turn Shift+Insert
/// into another chord.
fn holds_modifier(depressed: u32) -> bool {
    depressed & CHORD_MODIFIERS != 0
}

/// The keyboard GNOME gave this connection, while it may send.
#[derive(Clone)]
struct Link {
    connection: Connection,
    device: Device,
    keys: ei::Keyboard,
}

#[derive(Default)]
struct State {
    link: Option<Link>,
    /// The depressed modifiers GNOME last reported; unknown until it does,
    /// which GNOME before 50 never does.
    depressed: Option<u32>,
    closed: bool,
    /// Each emulation names a new sequence.
    sequence: u32,
}

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

impl Shared {
    fn state(&self) -> MutexGuard<'_, State> {
        // The state holds only handles and flags; a panicked holder can't
        // leave it half-written.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// One typing session's connection. Dropping it closes the socket, which
/// ends its reader thread.
pub(crate) struct Eis {
    socket: UnixStream,
    shared: Arc<Shared>,
}

impl Eis {
    /// Takes the socket `ConnectToEIS` returned and follows it on its own
    /// thread; `ready` says when GNOME's keyboard may send.
    pub(crate) fn connect(socket: OwnedFd) -> std::io::Result<Self> {
        let socket = UnixStream::from(socket);
        let context = ei::Context::new(socket.try_clone()?)?;
        let shared = Arc::new(Shared::default());
        let reader = shared.clone();
        std::thread::Builder::new()
            .name("voco-eis".into())
            .spawn(move || {
                follow(&context, &reader);
                let mut state = reader.state();
                state.link = None;
                state.depressed = None;
                state.closed = true;
                drop(state);
                reader.changed.notify_all();
            })?;
        Ok(Self { socket, shared })
    }

    /// Waits up to `timeout` for GNOME's keyboard.
    pub(crate) fn ready(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.shared.state();
        loop {
            if state.link.is_some() {
                return true;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if state.closed || left.is_zero() {
                return false;
            }
            state = self
                .shared
                .changed
                .wait_timeout(state, left)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    /// GNOME ended the connection.
    pub(crate) fn closed(&self) -> bool {
        self.shared.state().closed
    }

    /// Whether Shift, Control, Alt, Super or AltGr is down, by GNOME's own
    /// keyboard state. Unknown until GNOME reports it.
    pub(crate) fn modifiers_held(&self) -> Option<bool> {
        self.shared.state().depressed.map(holds_modifier)
    }

    /// Shift, Insert and their releases, 12 ms apart, never another key.
    /// Returns when the Insert press went out.
    pub(crate) fn paste(&self) -> Result<Instant, PortalPasteError> {
        let (link, sequence) = {
            let mut state = self.shared.state();
            let Some(link) = state.link.clone() else {
                return Err(PortalPasteError::NoMutation(NOT_READY.into()));
            };
            state.sequence = state.sequence.wrapping_add(1);
            (link, state.sequence)
        };
        let device = link.device.device();
        let key = |code: u32, state: ei::keyboard::KeyState| {
            link.keys.key(code, state);
            device.frame(link.connection.serial(), monotonic_us());
            link.connection.flush().map_err(|error| error.to_string())
        };
        device.start_emulating(link.connection.serial(), sequence);
        key(KEY_LEFTSHIFT, ei::keyboard::KeyState::Press).map_err(|error| {
            PortalPasteError::NoMutation(format!("GNOME refused VOCO's paste keys: {error}"))
        })?;
        let uncertain = |error: String| {
            let _ = key(KEY_LEFTSHIFT, ei::keyboard::KeyState::Released);
            PortalPasteError::Uncertain(format!(
                "VOCO's paste keys may not have reached the app: {error}. Automatic typing stopped."
            ))
        };
        std::thread::sleep(KEY_GAP);
        key(KEY_INSERT, ei::keyboard::KeyState::Press).map_err(uncertain)?;
        let inserted = Instant::now();
        std::thread::sleep(KEY_GAP);
        key(KEY_INSERT, ei::keyboard::KeyState::Released).map_err(uncertain)?;
        std::thread::sleep(KEY_GAP);
        key(KEY_LEFTSHIFT, ei::keyboard::KeyState::Released).map_err(uncertain)?;
        device.stop_emulating(link.connection.serial());
        // Every key is out and released; a failure here loses nothing.
        let _ = link.connection.flush();
        Ok(inserted)
    }
}

impl Drop for Eis {
    fn drop(&mut self) {
        let _ = self.socket.shutdown(std::net::Shutdown::Both);
    }
}

/// libei's frame timestamps: CLOCK_MONOTONIC in microseconds.
fn monotonic_us() -> u64 {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `time` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut time) };
    time.tv_sec as u64 * 1_000_000 + time.tv_nsec as u64 / 1_000
}

/// Reads the connection until it ends: binds the seat's keyboard, keeps the
/// device while GNOME lets it send, and keeps the modifiers GNOME reports.
fn follow(context: &ei::Context, shared: &Shared) {
    let Ok((connection, events)) =
        context.handshake_blocking("VOCO", ei::handshake::ContextType::Sender)
    else {
        return;
    };
    for event in events {
        let Ok(event) = event else {
            return;
        };
        let mut state = shared.state();
        match event {
            EiEvent::SeatAdded(added) => {
                added
                    .seat
                    .bind_capabilities(DeviceCapability::Keyboard.into());
                if connection.flush().is_err() {
                    return;
                }
            }
            EiEvent::DeviceResumed(resumed) => {
                if let Some(keys) = resumed.device.interface::<ei::Keyboard>() {
                    state.link = Some(Link {
                        connection: connection.clone(),
                        device: resumed.device,
                        keys,
                    });
                }
            }
            // libei: a paused device's modifiers are to be taken as lifted,
            // and GNOME reports them again when it resumes.
            EiEvent::DevicePaused(paused) => forget(&mut state, &paused.device),
            EiEvent::DeviceRemoved(removed) => forget(&mut state, &removed.device),
            EiEvent::KeyboardModifiers(modifiers) => {
                state.depressed = Some(modifiers.depressed);
            }
            EiEvent::Disconnected(_) => return,
            _ => {}
        }
        drop(state);
        shared.changed.notify_all();
    }
}

fn forget(state: &mut State, device: &Device) {
    if state
        .link
        .as_ref()
        .is_some_and(|link| &link.device == device)
    {
        state.link = None;
        state.depressed = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_chord_modifiers_hold_back_a_paste() {
        assert!(!holds_modifier(0));
        // Caps Lock (0x02), Num Lock (Mod2, 0x10) and Mod3 are no chord.
        assert!(!holds_modifier(0x02 | 0x10 | 0x20));
        for (name, bit) in [
            ("Shift", 0x01),
            ("Control", 0x04),
            ("Alt", 0x08),
            ("Super", 0x40),
            ("AltGr", 0x80),
        ] {
            assert!(holds_modifier(bit), "{name}");
            assert!(holds_modifier(bit | 0x10), "{name} with Num Lock");
        }
    }

    #[test]
    fn a_connection_gnome_closed_types_nothing_and_knows_nothing() {
        let (ours, theirs) = UnixStream::pair().unwrap();
        let eis = Eis::connect(OwnedFd::from(ours)).unwrap();
        drop(theirs);
        let started = Instant::now();
        assert!(!eis.ready(Duration::from_secs(5)));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "it waited out a closed connection"
        );
        assert_eq!(eis.modifiers_held(), None);
        assert!(matches!(eis.paste(), Err(PortalPasteError::NoMutation(_))));
    }

    #[test]
    fn dropping_the_connection_ends_its_reader() {
        let (ours, theirs) = UnixStream::pair().unwrap();
        let eis = Eis::connect(OwnedFd::from(ours)).unwrap();
        let shared = eis.shared.clone();
        // No handshake ever comes: the reader waits on the socket.
        assert!(!eis.ready(Duration::from_millis(50)));
        drop(eis);
        let deadline = Instant::now() + Duration::from_secs(5);
        while !shared.state().closed && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(shared.state().closed, "the reader outlived its connection");
        drop(theirs);
    }
}
