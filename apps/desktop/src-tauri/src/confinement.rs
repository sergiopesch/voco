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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn only_vocos_own_snap_counts() {
        assert!(names_voco(Some(OsStr::new("voco"))));
        assert!(!names_voco(Some(OsStr::new("voco-dbus-probe"))));
        assert!(!names_voco(None));
    }
}
