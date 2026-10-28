//! VOCO's strict snap, which can't use what confinement forbids: /dev/uinput,
//! evdev, its IBus engine, systemd's user manager or the network (AGENTS.md).
use std::sync::OnceLock;

/// Whether this process runs as VOCO's snap.
pub fn is_snap() -> bool {
    names_voco(std::env::var_os("SNAP_NAME").as_deref())
}

/// The Snap Store updates the snap, so it never checks for updates.
#[tauri::command]
pub fn store_updates() -> bool {
    is_snap()
}

fn names_voco(snap_name: Option<&std::ffi::OsStr>) -> bool {
    snap_name.is_some_and(|name| name == "voco")
}

/// Until the store connects the snap's audio-record plug on its own, setup
/// names the command that does (AGENTS.md).
pub const MICROPHONE_DETAIL: &str =
    "The VOCO snap can't use the microphone yet. Run snap connect voco:audio-record, then try again.";
/// WebKit, which captures on X11, lists its microphones once, through a
/// PipeWire connection that keeps what the snap could record when it opened.
/// So there a plug connected after VOCO started needs a restart.
pub const MICROPHONE_RESTART_DETAIL: &str = "The VOCO snap can't use the microphone yet. Run snap connect voco:audio-record, then quit VOCO and open it again.";
pub const MICROPHONE_RECONNECTED_DETAIL: &str =
    "VOCO can use the microphone you connected once it restarts. Quit VOCO and open it again.";

/// The audio-record plug as this process started, about when WebKit listed
/// its microphones; set only in the snap.
static RECORD_AT_START: OnceLock<Option<bool>> = OnceLock::new();

/// Read the snap's audio-record plug once, at startup.
pub fn note_startup() {
    if is_snap() {
        RECORD_AT_START.get_or_init(|| plug_connected("audio-record"));
    }
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneAccess {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<&'static str>,
}

/// Whether a recording may open the microphone. Only the snap's audio-record
/// plug can stop it here; outside the snap capture reports its own failures.
#[tauri::command]
pub fn microphone_access() -> MicrophoneAccess {
    microphone_access_for(
        is_snap(),
        || plug_connected("audio-record"),
        crate::native_capture_commands::uses_native_backend(),
        RECORD_AT_START.get().copied().flatten(),
    )
}

/// A snapctl that can't answer leaves the capture to report what went wrong.
/// `native` is native capture, which connects to PipeWire only once it may
/// record; `at_start` is the plug as this process started.
fn microphone_access_for(
    confined: bool,
    connected: impl FnOnce() -> Option<bool>,
    native: bool,
    at_start: Option<bool>,
) -> MicrophoneAccess {
    let detail = if !confined {
        None
    } else if connected() == Some(false) {
        Some(if native {
            MICROPHONE_DETAIL
        } else {
            MICROPHONE_RESTART_DETAIL
        })
    } else if !native && at_start == Some(false) {
        Some(MICROPHONE_RECONNECTED_DETAIL)
    } else {
        None
    };
    MicrophoneAccess {
        allowed: detail.is_none(),
        detail,
    }
}

/// snapctl's answer for one of this snap's plugs, within two seconds.
pub(crate) fn plug_connected(plug: &str) -> Option<bool> {
    let child = crate::process_runner::command("snapctl")
        .args(["is-connected", plug])
        .spawn()
        .ok()?;
    let output =
        crate::process_runner::wait_with_output(child, std::time::Duration::from_secs(2), 4096)
            .ok()?;
    plug_state(output.status.code())
}

/// `snapctl is-connected` exits 0 for a connected plug and 1 for one that isn't.
fn plug_state(code: Option<i32>) -> Option<bool> {
    match code {
        Some(0) => Some(true),
        Some(1) => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn the_snap_names_its_microphone_connection_before_capture() {
        let allowed = MicrophoneAccess {
            allowed: true,
            detail: None,
        };
        // Native capture: connect the plug, then try again.
        let refused = microphone_access_for(true, || Some(false), true, Some(false));
        assert!(!refused.allowed);
        assert_eq!(refused.detail, Some(MICROPHONE_DETAIL));
        assert!(MICROPHONE_DETAIL.contains("snap connect voco:audio-record"));
        // Connected, or snapctl couldn't say: the capture itself decides.
        for answer in [Some(true), None] {
            assert_eq!(
                microphone_access_for(true, || answer, true, Some(false)),
                allowed
            );
        }
        // Outside the snap nothing asks snapctl.
        assert!(microphone_access_for(false, || panic!("asked snapctl"), false, None).allowed);
    }

    #[test]
    fn webkit_capture_needs_a_restart_for_a_plug_connected_after_start() {
        let allowed = MicrophoneAccess {
            allowed: true,
            detail: None,
        };
        let refused = microphone_access_for(true, || Some(false), false, Some(false));
        assert_eq!(refused.detail, Some(MICROPHONE_RESTART_DETAIL));
        assert!(MICROPHONE_RESTART_DETAIL.contains("snap connect voco:audio-record"));
        // Connected since, WebKit still lists the microphones it saw at start.
        let stale = microphone_access_for(true, || Some(true), false, Some(false));
        assert!(!stale.allowed);
        assert_eq!(stale.detail, Some(MICROPHONE_RECONNECTED_DETAIL));
        // Connected at start, or unknown then: the capture decides.
        for at_start in [Some(true), None] {
            assert_eq!(
                microphone_access_for(true, || Some(true), false, at_start),
                allowed
            );
        }
    }

    #[test]
    fn snapctl_exit_codes_read_as_connected_or_not() {
        assert_eq!(plug_state(Some(0)), Some(true));
        assert_eq!(plug_state(Some(1)), Some(false));
        for code in [Some(2), Some(-1), None] {
            assert_eq!(plug_state(code), None);
        }
    }

    #[test]
    fn only_vocos_own_snap_counts() {
        assert!(names_voco(Some(OsStr::new("voco"))));
        assert!(!names_voco(Some(OsStr::new("voco-dbus-probe"))));
        assert!(!names_voco(None));
    }
}
