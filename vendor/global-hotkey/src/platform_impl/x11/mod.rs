// Copyright 2022-2022 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::collections::BTreeMap;
use std::os::fd::AsFd;
use std::sync::Arc;

mod focus_lease;
mod wake;
pub use focus_lease::{acquire_focus_lease, FocusLease, FocusLeaseError};

use crossbeam_channel::Sender;
use keyboard_types::{Code, Modifiers};
use x11rb::connection::Connection;
use x11rb::errors::ReplyError;
use x11rb::protocol::xproto::{ConnectionExt, GrabMode, KeyButMask, Keycode, ModMask, Window};
use x11rb::protocol::{xkb, ErrorKind, Event};
use x11rb::rust_connection::RustConnection;
use xkeysym::RawKeysym;

use crate::{hotkey::HotKey, Error, GlobalHotKeyEvent};

enum ThreadMessage {
    RegisterHotKey(HotKey, Sender<crate::Result<()>>),
    RegisterHotKeys(Vec<HotKey>, Sender<crate::Result<()>>),
    UnRegisterHotKey(HotKey, Sender<crate::Result<()>>),
    UnRegisterHotKeys(Vec<HotKey>, Sender<crate::Result<()>>),
    AcquireFocusLease {
        request: focus_lease::AcquireRequest,
        reply: Sender<Result<(), FocusLeaseError>>,
    },
    ReleaseFocusLease {
        nonce: u64,
        reply: Option<Sender<Result<(), FocusLeaseError>>>,
    },
    DropThread,
}

pub struct GlobalHotKeyManager {
    thread_tx: wake::WakeSender<ThreadMessage>,
    _actor: Arc<focus_lease::Actor>,
}

impl GlobalHotKeyManager {
    pub fn new() -> crate::Result<Self> {
        let (thread_tx, thread_rx) = wake::channel()?;
        let actor = focus_lease::Actor::new(thread_tx.clone());
        let thread_actor = actor.clone();
        std::thread::spawn(move || {
            if let Err(_err) = events_processor(thread_rx, &thread_actor) {
                #[cfg(feature = "tracing")]
                tracing::error!("{}", _err);
            }
            thread_actor.clear();
        });
        Ok(Self {
            thread_tx,
            _actor: actor,
        })
    }

    pub fn register(&self, hotkey: HotKey) -> crate::Result<()> {
        let (tx, rx) = crossbeam_channel::bounded(1);
        self.thread_tx
            .send(ThreadMessage::RegisterHotKey(hotkey, tx))?;

        rx.recv().map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "X11 shortcut actor stopped before replying",
            )
        })?
    }

    pub fn unregister(&self, hotkey: HotKey) -> crate::Result<()> {
        let (tx, rx) = crossbeam_channel::bounded(1);
        self.thread_tx
            .send(ThreadMessage::UnRegisterHotKey(hotkey, tx))?;

        rx.recv().map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "X11 shortcut actor stopped before replying",
            )
        })?
    }

    pub fn register_all(&self, hotkeys: &[HotKey]) -> crate::Result<()> {
        let (tx, rx) = crossbeam_channel::bounded(1);
        self.thread_tx
            .send(ThreadMessage::RegisterHotKeys(hotkeys.to_vec(), tx))?;

        rx.recv().map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "X11 shortcut actor stopped before replying",
            )
        })?
    }

    pub fn unregister_all(&self, hotkeys: &[HotKey]) -> crate::Result<()> {
        let (tx, rx) = crossbeam_channel::bounded(1);
        self.thread_tx
            .send(ThreadMessage::UnRegisterHotKeys(hotkeys.to_vec(), tx))?;

        rx.recv().map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "X11 shortcut actor stopped before replying",
            )
        })?
    }
}

impl Drop for GlobalHotKeyManager {
    fn drop(&mut self) {
        let _ = self.thread_tx.send(ThreadMessage::DropThread);
    }
}

// XGrabKey works only with the exact state (modifiers)
// and since X11 considers NumLock, ScrollLock and CapsLock a modifier when it is ON,
// we also need to register our shortcut combined with these extra modifiers as well
fn ignored_mods() -> [ModMask; 4] {
    [
        ModMask::default(), // modifier only
        ModMask::M2,        // NumLock
        ModMask::LOCK,      // CapsLock
        ModMask::M2 | ModMask::LOCK,
    ]
}

#[inline]
fn register_hotkey(
    conn: &RustConnection,
    root: Window,
    hotkeys: &mut BTreeMap<Keycode, Vec<HotKeyState>>,
    hotkey: HotKey,
) -> crate::Result<()> {
    let (mods, key) = (
        modifiers_to_x11_mods(hotkey.mods),
        keycode_to_x11_keysym(hotkey.key),
    );

    let Some(key) = key else {
        return Err(Error::FailedToRegister(format!(
            "Unknown scancode for key: {}",
            hotkey.key
        )));
    };

    let keycode = keysym_to_keycode(conn, key).map_err(Error::FailedToRegister)?;

    let Some(keycode) = keycode else {
        return Err(Error::FailedToRegister(format!(
            "Unable to find keycode for key: {}",
            hotkey.key
        )));
    };

    for m in ignored_mods() {
        let result = conn
            .grab_key(
                false,
                root,
                mods | m,
                keycode,
                GrabMode::ASYNC,
                GrabMode::ASYNC,
            )
            .map_err(|err| Error::FailedToRegister(err.to_string()))?;

        if let Err(err) = result.check() {
            return match err {
                ReplyError::ConnectionError(err) => Err(Error::FailedToRegister(err.to_string())),
                ReplyError::X11Error(err) => {
                    if let ErrorKind::Access = err.error_kind {
                        for m in ignored_mods() {
                            if let Ok(result) = conn.ungrab_key(keycode, root, mods | m) {
                                result.ignore_error();
                            }
                        }

                        Err(Error::AlreadyRegistered(hotkey))
                    } else {
                        Err(Error::FailedToRegister(format!("{err:?}")))
                    }
                }
            };
        }
    }

    let entry = hotkeys.entry(keycode).or_default();
    match entry.iter().find(|e| e.mods == mods) {
        None => {
            let state = HotKeyState {
                id: hotkey.id(),
                mods,
                pressed: false,
            };
            entry.push(state);
            Ok(())
        }
        Some(_) => Err(Error::AlreadyRegistered(hotkey)),
    }
}

#[inline]
fn unregister_hotkey(
    conn: &RustConnection,
    root: Window,
    hotkeys: &mut BTreeMap<Keycode, Vec<HotKeyState>>,
    hotkey: HotKey,
) -> crate::Result<()> {
    let (modifiers, key) = (
        modifiers_to_x11_mods(hotkey.mods),
        keycode_to_x11_keysym(hotkey.key),
    );

    let Some(key) = key else {
        return Err(Error::FailedToUnRegister(hotkey));
    };

    let keycode = keysym_to_keycode(conn, key).map_err(|_err| Error::FailedToUnRegister(hotkey))?;

    let Some(keycode) = keycode else {
        return Err(Error::FailedToUnRegister(hotkey));
    };

    let mut removed = true;
    for m in ignored_mods() {
        removed &= conn
            .ungrab_key(keycode, root, modifiers | m)
            .map_err(|_| ())
            .and_then(|cookie| cookie.check().map_err(|_| ()))
            .is_ok();
    }
    // A successful unregister must be processed by the server before callers
    // register another binding or claim cleanup. Queued writes are insufficient.
    if !removed {
        return Err(Error::FailedToUnRegister(hotkey));
    }

    let entry = hotkeys.entry(keycode).or_default();
    entry.retain(|k| k.mods != modifiers);
    Ok(())
}

struct HotKeyState {
    id: u32,
    pressed: bool,
    mods: ModMask,
}

fn events_processor(
    thread_rx: wake::WakeReceiver<ThreadMessage>,
    actor: &focus_lease::Actor,
) -> Result<(), String> {
    let mut hotkeys = BTreeMap::<Keycode, Vec<HotKeyState>>::new();
    let mut lease = focus_lease::LeaseState::default();

    let (conn, screen) = RustConnection::connect(None)
        .map_err(|err| format!("Unable to open x11 connection, maybe you are not running under X11? Other window systems on Linux are not supported by `global-hotkey` crate: {err}"))?;

    xkb::ConnectionExt::xkb_use_extension(&conn, 1, 0)
        .map_err(|err| format!("Unable to send xkb_use_extension request to x11 server: {err}"))?
        .reply()
        .map_err(|err| format!("xkb_use_extension request to x11 server has failed: {err}"))?;

    xkb::ConnectionExt::xkb_per_client_flags(
        &conn,
        xkb::ID::USE_CORE_KBD.into(),
        xkb::PerClientFlag::DETECTABLE_AUTO_REPEAT,
        xkb::PerClientFlag::DETECTABLE_AUTO_REPEAT,
        Default::default(),
        Default::default(),
        Default::default(),
    )
    .map_err(|err| format!("Unable to send xkb_per_client_flags request to x11 server: {err}"))?
    .reply()
    .map_err(|err| format!("xkb_per_client_flags request to x11 server has failed: {err}"))?;

    let root = conn.setup().roots[screen].root;

    // X11 sends masks for Lock keys as well, and we only care about the 4 below
    let full_mask = KeyButMask::CONTROL | KeyButMask::SHIFT | KeyButMask::MOD4 | KeyButMask::MOD1;

    loop {
        lease.maintain(&conn, root, actor);
        conn.flush()
            .map_err(|_| "X11 output connection failed".to_string())?;
        let mut events_drained = false;
        for _ in 0..512 {
            let Some(event) = conn
                .poll_for_event()
                .map_err(|_| "X11 event connection failed".to_string())?
            else {
                events_drained = true;
                break;
            };
            lease.observe(&conn, root, actor, &event);
            match event {
                Event::KeyPress(event) => {
                    let keycode = event.detail;

                    let event_mods = event.state & full_mask;
                    let event_mods = ModMask::from(event_mods.bits());

                    if let Some(entry) = hotkeys.get_mut(&keycode) {
                        for state in entry {
                            if event_mods == state.mods && !state.pressed {
                                GlobalHotKeyEvent::send(GlobalHotKeyEvent {
                                    id: state.id,
                                    state: crate::HotKeyState::Pressed,
                                });
                                state.pressed = true;
                            }
                        }
                    }
                }
                Event::KeyRelease(event) => {
                    let keycode = event.detail;

                    if let Some(entry) = hotkeys.get_mut(&keycode) {
                        for state in entry {
                            if state.pressed {
                                GlobalHotKeyEvent::send(GlobalHotKeyEvent {
                                    id: state.id,
                                    state: crate::HotKeyState::Released,
                                });
                                state.pressed = false;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // Recheck the queue after draining wake bytes. A sender queues first,
        // then signals: arriving between this check and poll still wakes us.
        thread_rx
            .drain_signal()
            .map_err(|_| "X11 command wake source failed".to_string())?;
        match thread_rx.queue.try_recv() {
            Ok(msg) => match msg {
                ThreadMessage::AcquireFocusLease { request, reply } => {
                    let nonce = request.nonce;
                    let result = if events_drained {
                        lease.acquire(&conn, root, &hotkeys, actor, request)
                    } else {
                        Err(FocusLeaseError::FocusUnavailable)
                    };
                    if reply.send(result).is_err() && result.is_ok() {
                        let _ = lease.release(&conn, root, actor, nonce);
                    }
                }
                ThreadMessage::ReleaseFocusLease { nonce, reply } => {
                    let result = lease.release(&conn, root, actor, nonce);
                    if let Some(reply) = reply {
                        let _ = reply.send(result);
                    }
                }
                ThreadMessage::RegisterHotKey(hotkey, tx) => {
                    let result = lease
                        .restore(&conn, root, actor)
                        .map_err(|e| Error::FailedToRegister(e.to_string()))
                        .and_then(|_| register_hotkey(&conn, root, &mut hotkeys, hotkey));
                    if result.is_ok() {
                        actor.registered(hotkey.id());
                    }
                    let _ = tx.send(result);
                }
                ThreadMessage::RegisterHotKeys(keys, tx) => {
                    let result = lease
                        .restore(&conn, root, actor)
                        .map_err(|e| Error::FailedToRegister(e.to_string()))
                        .and_then(|_| {
                            keys.into_iter().try_for_each(|hotkey| {
                                register_hotkey(&conn, root, &mut hotkeys, hotkey)?;
                                actor.registered(hotkey.id());
                                Ok(())
                            })
                        });
                    let _ = tx.send(result);
                }
                ThreadMessage::UnRegisterHotKey(hotkey, tx) => {
                    let restored = lease.restore(&conn, root, actor);
                    let result = unregister_hotkey(&conn, root, &mut hotkeys, hotkey);
                    actor.unregistered(hotkey.id());
                    let _ = tx.send(
                        restored
                            .map_err(|e| Error::FailedToRegister(e.to_string()))
                            .and(result),
                    );
                }
                ThreadMessage::UnRegisterHotKeys(keys, tx) => {
                    let restored = lease.restore(&conn, root, actor);
                    let result = keys.into_iter().try_for_each(|hotkey| {
                        let result = unregister_hotkey(&conn, root, &mut hotkeys, hotkey);
                        actor.unregistered(hotkey.id());
                        result
                    });
                    let _ = tx.send(
                        restored
                            .map_err(|e| Error::FailedToRegister(e.to_string()))
                            .and(result),
                    );
                }
                ThreadMessage::DropThread => {
                    let _ = lease.restore(&conn, root, actor);
                    return Ok(());
                }
            },
            Err(crossbeam_channel::TryRecvError::Empty) => {
                // poll_for_event above drains x11rb's internal queue as well as
                // the socket. Do not block merely because the raw fd is empty
                // while an already-buffered X event remains unprocessed.
                if events_drained {
                    thread_rx
                        .wait(conn.stream().as_fd(), lease.deadline())
                        .map_err(|_| "X11 event wait failed".to_string())?;
                }
            }
            Err(crossbeam_channel::TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn keycode_to_x11_keysym(key: Code) -> Option<RawKeysym> {
    Some(match key {
        Code::KeyA => xkeysym::key::A,
        Code::KeyB => xkeysym::key::B,
        Code::KeyC => xkeysym::key::C,
        Code::KeyD => xkeysym::key::D,
        Code::KeyE => xkeysym::key::E,
        Code::KeyF => xkeysym::key::F,
        Code::KeyG => xkeysym::key::G,
        Code::KeyH => xkeysym::key::H,
        Code::KeyI => xkeysym::key::I,
        Code::KeyJ => xkeysym::key::J,
        Code::KeyK => xkeysym::key::K,
        Code::KeyL => xkeysym::key::L,
        Code::KeyM => xkeysym::key::M,
        Code::KeyN => xkeysym::key::N,
        Code::KeyO => xkeysym::key::O,
        Code::KeyP => xkeysym::key::P,
        Code::KeyQ => xkeysym::key::Q,
        Code::KeyR => xkeysym::key::R,
        Code::KeyS => xkeysym::key::S,
        Code::KeyT => xkeysym::key::T,
        Code::KeyU => xkeysym::key::U,
        Code::KeyV => xkeysym::key::V,
        Code::KeyW => xkeysym::key::W,
        Code::KeyX => xkeysym::key::X,
        Code::KeyY => xkeysym::key::Y,
        Code::KeyZ => xkeysym::key::Z,
        Code::Backslash => xkeysym::key::backslash,
        Code::BracketLeft => xkeysym::key::bracketleft,
        Code::BracketRight => xkeysym::key::bracketright,
        Code::Backquote => xkeysym::key::quoteleft,
        Code::Comma => xkeysym::key::comma,
        Code::Digit0 => xkeysym::key::_0,
        Code::Digit1 => xkeysym::key::_1,
        Code::Digit2 => xkeysym::key::_2,
        Code::Digit3 => xkeysym::key::_3,
        Code::Digit4 => xkeysym::key::_4,
        Code::Digit5 => xkeysym::key::_5,
        Code::Digit6 => xkeysym::key::_6,
        Code::Digit7 => xkeysym::key::_7,
        Code::Digit8 => xkeysym::key::_8,
        Code::Digit9 => xkeysym::key::_9,
        Code::Equal => xkeysym::key::equal,
        Code::Minus => xkeysym::key::minus,
        Code::Period => xkeysym::key::period,
        Code::Quote => xkeysym::key::leftsinglequotemark,
        Code::Semicolon => xkeysym::key::semicolon,
        Code::Slash => xkeysym::key::slash,
        Code::Backspace => xkeysym::key::BackSpace,
        Code::CapsLock => xkeysym::key::Caps_Lock,
        Code::Enter => xkeysym::key::Return,
        Code::Space => xkeysym::key::space,
        Code::Tab => xkeysym::key::Tab,
        Code::Delete => xkeysym::key::Delete,
        Code::End => xkeysym::key::End,
        Code::Home => xkeysym::key::Home,
        Code::Insert => xkeysym::key::Insert,
        Code::PageDown => xkeysym::key::Page_Down,
        Code::PageUp => xkeysym::key::Page_Up,
        Code::ArrowDown => xkeysym::key::Down,
        Code::ArrowLeft => xkeysym::key::Left,
        Code::ArrowRight => xkeysym::key::Right,
        Code::ArrowUp => xkeysym::key::Up,
        Code::Numpad0 => xkeysym::key::KP_0,
        Code::Numpad1 => xkeysym::key::KP_1,
        Code::Numpad2 => xkeysym::key::KP_2,
        Code::Numpad3 => xkeysym::key::KP_3,
        Code::Numpad4 => xkeysym::key::KP_4,
        Code::Numpad5 => xkeysym::key::KP_5,
        Code::Numpad6 => xkeysym::key::KP_6,
        Code::Numpad7 => xkeysym::key::KP_7,
        Code::Numpad8 => xkeysym::key::KP_8,
        Code::Numpad9 => xkeysym::key::KP_9,
        Code::NumpadAdd => xkeysym::key::KP_Add,
        Code::NumpadDecimal => xkeysym::key::KP_Decimal,
        Code::NumpadDivide => xkeysym::key::KP_Divide,
        Code::NumpadMultiply => xkeysym::key::KP_Multiply,
        Code::NumpadSubtract => xkeysym::key::KP_Subtract,
        Code::Escape => xkeysym::key::Escape,
        Code::PrintScreen => xkeysym::key::Print,
        Code::ScrollLock => xkeysym::key::Scroll_Lock,
        Code::NumLock => xkeysym::key::F1,
        Code::F1 => xkeysym::key::F1,
        Code::F2 => xkeysym::key::F2,
        Code::F3 => xkeysym::key::F3,
        Code::F4 => xkeysym::key::F4,
        Code::F5 => xkeysym::key::F5,
        Code::F6 => xkeysym::key::F6,
        Code::F7 => xkeysym::key::F7,
        Code::F8 => xkeysym::key::F8,
        Code::F9 => xkeysym::key::F9,
        Code::F10 => xkeysym::key::F10,
        Code::F11 => xkeysym::key::F11,
        Code::F12 => xkeysym::key::F12,
        Code::F13 => xkeysym::key::F13,
        Code::F14 => xkeysym::key::F14,
        Code::F15 => xkeysym::key::F15,
        Code::F16 => xkeysym::key::F16,
        Code::F17 => xkeysym::key::F17,
        Code::F18 => xkeysym::key::F18,
        Code::F19 => xkeysym::key::F19,
        Code::F20 => xkeysym::key::F20,
        Code::F21 => xkeysym::key::F21,
        Code::F22 => xkeysym::key::F22,
        Code::F23 => xkeysym::key::F23,
        Code::F24 => xkeysym::key::F24,
        Code::AudioVolumeDown => xkeysym::key::XF86_AudioLowerVolume,
        Code::AudioVolumeMute => xkeysym::key::XF86_AudioMute,
        Code::AudioVolumeUp => xkeysym::key::XF86_AudioRaiseVolume,
        Code::MediaPlay => xkeysym::key::XF86_AudioPlay,
        Code::MediaPause => xkeysym::key::XF86_AudioPause,
        Code::MediaStop => xkeysym::key::XF86_AudioStop,
        Code::MediaTrackNext => xkeysym::key::XF86_AudioNext,
        Code::MediaTrackPrevious => xkeysym::key::XF86_AudioPrev,
        Code::Pause => xkeysym::key::Pause,
        _ => return None,
    })
}

fn modifiers_to_x11_mods(modifiers: Modifiers) -> ModMask {
    let mut x11mods = ModMask::default();
    if modifiers.contains(Modifiers::SHIFT) {
        x11mods |= ModMask::SHIFT;
    }
    if modifiers.intersects(Modifiers::SUPER | Modifiers::META) {
        x11mods |= ModMask::M4;
    }
    if modifiers.contains(Modifiers::ALT) {
        x11mods |= ModMask::M1;
    }
    if modifiers.contains(Modifiers::CONTROL) {
        x11mods |= ModMask::CONTROL;
    }
    x11mods
}

fn keysym_to_keycode(conn: &RustConnection, keysym: RawKeysym) -> Result<Option<Keycode>, String> {
    let setup = conn.setup();
    let min_keycode = setup.min_keycode;
    let max_keycode = setup.max_keycode;
    let count = max_keycode - min_keycode + 1;

    let mapping = conn
        .get_keyboard_mapping(min_keycode, count)
        .map_err(|err| err.to_string())?
        .reply()
        .map_err(|err| err.to_string())?;

    let keysyms_per_keycode = mapping.keysyms_per_keycode as usize;

    for (i, keysyms) in mapping.keysyms.chunks(keysyms_per_keycode).enumerate() {
        if keysyms.contains(&keysym) {
            return Ok(Some(min_keycode + i as u8));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod actor_shutdown_tests {
    use super::*;
    fn mock_manager() -> (
        GlobalHotKeyManager,
        crossbeam_channel::Receiver<ThreadMessage>,
    ) {
        let (tx, rx) = crossbeam_channel::unbounded();
        let tx: wake::WakeSender<_> = tx.into();
        let actor = focus_lease::Actor::new(tx.clone());
        (
            GlobalHotKeyManager {
                thread_tx: tx,
                _actor: actor,
            },
            rx,
        )
    }
    #[test]
    fn dead_actor_never_reports_registration_or_unregistration_success() {
        let (manager, rx) = mock_manager();
        drop(rx);
        let key = "Alt+D".parse().unwrap();
        assert!(manager.register(key).is_err());
        assert!(manager.unregister(key).is_err());
        assert!(manager.register_all(&[key]).is_err());
        assert!(manager.unregister_all(&[key]).is_err());
    }
    #[test]
    fn actor_exit_after_accepting_request_is_not_a_successful_acknowledgement() {
        let (manager, rx) = mock_manager();
        let worker = std::thread::spawn(move || {
            drop(rx.recv().unwrap());
        });
        assert!(manager.register("Alt+D".parse().unwrap()).is_err());
        worker.join().unwrap();
    }
}
