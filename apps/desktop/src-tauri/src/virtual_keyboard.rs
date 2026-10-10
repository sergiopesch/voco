//! Wayland paste keys through VOCO's own uinput keyboard.
//!
//! One keyboard is created per process and kept open. The compositor sees a new
//! uinput device only after udev and libinput add it, so a device created for
//! each paste could lose its first keys. When VOCO exits the kernel removes the
//! device and releases any key it still held.
//!
//! The package's udev rule gives the user of the active local session write
//! access to `/dev/uinput`; nothing else is needed: no daemon, socket or group.
//! A uinput device types into whichever session is active on the seat, so keys
//! are sent only while this user's graphical session is the active one.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use evdev::uinput::VirtualDevice;
use evdev::{AttributeSet, BusType, EventType, InputEvent, InputId, KeyCode};

pub const DEVICE_NAME: &str = "VOCO virtual keyboard";
/// Each event gets its own report this far apart, so every toolkit sees the
/// chord in order while a paste still takes under 100 ms.
const KEY_GAP: Duration = Duration::from_millis(12);
/// After creation, give the compositor time to add the device before its first
/// keys. A keyboard warmed at startup is long past this when dictation begins.
const ADD_SETTLE: Duration = Duration::from_millis(500);

pub const ACCESS_HELP: &str = "VOCO can't open /dev/uinput, so it can't send the paste keys. Sign out and back in once after installing VOCO; if that doesn't help, see Platform support: Access to /dev/uinput.";

struct Keyboard {
    device: VirtualDevice,
    created: Instant,
}

static KEYBOARD: Mutex<Option<Keyboard>> = Mutex::new(None);

fn slot() -> MutexGuard<'static, Option<Keyboard>> {
    // A panic while emitting cannot leave the device half-built: it is created
    // whole or not at all, so the guarded value stays usable.
    KEYBOARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn create() -> std::io::Result<VirtualDevice> {
    let mut keys = AttributeSet::<KeyCode>::new();
    // Shift and Insert only: the kernel drops any key a device didn't declare,
    // so this keyboard can't press Enter, Space or anything else that acts.
    for key in [KeyCode::KEY_LEFTSHIFT, KeyCode::KEY_INSERT] {
        keys.insert(key);
    }
    VirtualDevice::builder()?
        .name(DEVICE_NAME)
        .input_id(InputId::new(BusType::BUS_VIRTUAL, 0x564f, 0x434f, 1))
        .with_keys(&keys)?
        .build()
}

/// Create the keyboard now, if it doesn't exist yet. Sends no keys.
pub fn ensure() -> Result<(), String> {
    let mut keyboard = slot();
    if keyboard.is_none() {
        let device = create().map_err(|error| {
            log::warn!("Virtual keyboard unavailable: {error}");
            ACCESS_HELP.to_string()
        })?;
        *keyboard = Some(Keyboard {
            device,
            created: Instant::now(),
        });
    }
    Ok(())
}

/// Refuse keys when logind identifies an unsafe or inactive originating login.
pub fn require_active_session() -> Result<(), String> {
    crate::desktop_session::require_active()
}

/// Whether this login may create input devices, without creating one. For
/// processes that only check setup, such as `voco --check-desktop-input`.
pub fn check_access() -> Result<(), String> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/uinput")
        .map(|_| ())
        .map_err(|_| ACCESS_HELP.to_string())
}

/// The ordered key steps of one paste: Shift+Insert. A joining space travels
/// inside the pasted text, never as a key.
const PASTE_STEPS: [(KeyCode, i32); 4] = [
    (KeyCode::KEY_LEFTSHIFT, 1),
    (KeyCode::KEY_INSERT, 1),
    (KeyCode::KEY_INSERT, 0),
    (KeyCode::KEY_LEFTSHIFT, 0),
];

/// Send one paste gesture. The caller has already copied the text and waited
/// for the shortcut's modifiers to be released.
pub fn paste() -> Result<(), String> {
    let mut keyboard = slot();
    if keyboard.is_none() {
        drop(keyboard);
        ensure()?;
        keyboard = slot();
    }
    let Some(Keyboard { device, created }) = keyboard.as_mut() else {
        return Err(ACCESS_HELP.into());
    };
    let young = ADD_SETTLE.saturating_sub(created.elapsed());
    if !young.is_zero() {
        std::thread::sleep(young);
    }
    // Checked again after the copy and the modifier wait: the session may
    // have switched since the caller's check.
    require_active_session()?;
    for (index, (key, value)) in PASTE_STEPS.into_iter().enumerate() {
        if index > 0 {
            std::thread::sleep(KEY_GAP);
        }
        if let Err(error) = device.emit(&[InputEvent::new(EventType::KEY.0, key.0, value)]) {
            // Never leave Shift held for the focused app; the next paste
            // recreates the device.
            let _ = device.emit(&[InputEvent::new(
                EventType::KEY.0,
                KeyCode::KEY_LEFTSHIFT.0,
                0,
            )]);
            *keyboard = None;
            return Err(format!(
                "The virtual keyboard stopped accepting keys: {error}."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_is_shift_insert_and_nothing_else() {
        assert_eq!(
            PASTE_STEPS,
            [
                (KeyCode::KEY_LEFTSHIFT, 1),
                (KeyCode::KEY_INSERT, 1),
                (KeyCode::KEY_INSERT, 0),
                (KeyCode::KEY_LEFTSHIFT, 0),
            ]
        );
        for (key, value) in &PASTE_STEPS {
            assert!(matches!(*key, KeyCode::KEY_LEFTSHIFT | KeyCode::KEY_INSERT));
            if *value == 1 {
                assert!(
                    PASTE_STEPS.contains(&(*key, 0)),
                    "{key:?} is never released"
                );
            }
        }
    }

    /// The real device, read back from the kernel. The test grabs the device
    /// before sending, so its keys never reach a compositor or an app.
    #[test]
    #[ignore = "Needs write access to /dev/uinput and read access to its event node"]
    fn paste_reaches_the_kernel_in_order_and_quickly() {
        ensure().unwrap();
        let node = slot()
            .as_mut()
            .unwrap()
            .device
            .enumerate_dev_nodes_blocking()
            .unwrap()
            .filter_map(Result::ok)
            .find(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("event"))
            })
            .expect("the kernel exposes an event node");
        let started = Instant::now();
        let mut reader = loop {
            // udev creates the node shortly after the device appears.
            match evdev::Device::open(&node) {
                Ok(device) => break device,
                Err(_) if started.elapsed() < Duration::from_secs(5) => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(error) => panic!("{node:?}: {error}"),
            }
        };
        assert_eq!(reader.name(), Some(DEVICE_NAME));
        let declared: Vec<KeyCode> = reader.supported_keys().unwrap().iter().collect();
        assert_eq!(declared, [KeyCode::KEY_LEFTSHIFT, KeyCode::KEY_INSERT]);
        reader.grab().unwrap();
        std::thread::sleep(ADD_SETTLE);
        for _ in 0..2 {
            let sent = Instant::now();
            paste().unwrap();
            let elapsed = sent.elapsed();
            let expected = PASTE_STEPS.to_vec();
            let mut received = Vec::new();
            while received.len() < expected.len() {
                for event in reader.fetch_events().unwrap() {
                    if event.event_type() == EventType::KEY {
                        received.push((KeyCode(event.code()), event.value()));
                    }
                }
            }
            assert_eq!(received, expected);
            let gaps = KEY_GAP * (expected.len() as u32 - 1);
            assert!(
                elapsed >= gaps && elapsed < gaps + Duration::from_millis(50),
                "{elapsed:?}"
            );
        }
    }
}
