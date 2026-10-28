//! VOCO's strict snap, which can't use what confinement forbids: /dev/uinput,
//! evdev, its IBus engine, systemd's user manager or the network (AGENTS.md).

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
    microphone_access_for(is_snap(), || plug_connected("audio-record"))
}

/// A snapctl that can't answer leaves the capture to report what went wrong.
fn microphone_access_for(
    confined: bool,
    connected: impl FnOnce() -> Option<bool>,
) -> MicrophoneAccess {
    let allowed = !confined || connected() != Some(false);
    MicrophoneAccess {
        allowed,
        detail: (!allowed).then_some(MICROPHONE_DETAIL),
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
        let refused = microphone_access_for(true, || Some(false));
        assert!(!refused.allowed);
        assert_eq!(refused.detail, Some(MICROPHONE_DETAIL));
        assert!(MICROPHONE_DETAIL.contains("snap connect voco:audio-record"));
        // Connected, or snapctl couldn't say: the capture itself decides.
        for answer in [Some(true), None] {
            assert_eq!(
                microphone_access_for(true, || answer),
                MicrophoneAccess {
                    allowed: true,
                    detail: None
                }
            );
        }
        // Outside the snap nothing asks snapctl.
        assert!(microphone_access_for(false, || panic!("asked snapctl")).allowed);
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
