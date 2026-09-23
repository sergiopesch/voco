//! Bounded, explicit companion setup; no package hook changes a user profile.
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSetupStatus {
    pub status: String,
    pub detail: String,
    pub can_enable: bool,
}

/// On GNOME Wayland these chords must be consumed by Shell. Passive evdev
/// observation alone lets the focused application act on Stop first (Alt+D
/// selects a browser address), invalidating an in-progress text destination.
pub fn stop_shortcut_setup_detail(
    session_type: &str,
    hotkey: &str,
    status: Result<PanelSetupStatus, String>,
    attached: bool,
) -> Option<String> {
    if !session_type.eq_ignore_ascii_case("wayland")
        || !(hotkey.eq_ignore_ascii_case("Alt+D") || hotkey.eq_ignore_ascii_case("Alt+Shift+D"))
    {
        return None;
    }
    match status {
        Ok(panel) if panel.status == "other-desktop" => None,
        Ok(panel) if panel.status == "active" && attached => None,
        Ok(panel) if panel.status == "active" => Some(format!(
            "VOCO's GNOME panel is loaded but has not connected to this app. Reopen VOCO or sign out and back in before using {hotkey}."
        )),
        Ok(panel) => Some(format!("VOCO cannot safely use {hotkey} in this GNOME session. {}", panel.detail)),
        Err(_) => Some(format!("VOCO cannot verify that GNOME consumes {hotkey}. Check the VOCO panel before dictating.")),
    }
}

/// A non-GNOME desktop has no GNOME Shell bridge; preserve its existing input
/// route. GNOME needs a current loaded companion and then a live reservation.
pub fn stop_reservation_required(status: &PanelSetupStatus) -> Result<bool, String> {
    match status.status.as_str() {
        "other-desktop" => Ok(false),
        "active" => Ok(true),
        _ => Err(status.detail.clone()),
    }
}

pub fn check(enable: bool) -> Result<PanelSetupStatus, String> {
    let child = crate::process_runner::command("/usr/bin/python3")
        .args([
            "-I",
            "-c",
            include_str!("../resources/voco_gnome_panel.py"),
            if enable { "--enable" } else { "--check" },
        ])
        .spawn()
        .map_err(|_| "Panel status is unavailable".to_string())?;
    let output = crate::process_runner::wait_with_output(child, Duration::from_secs(4), 4096)?;
    if !output.status.success() {
        return Err("Panel status is unavailable".to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid panel setup response".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel(status: &str) -> Result<PanelSetupStatus, String> {
        Ok(PanelSetupStatus {
            status: status.into(),
            detail: "Sign out and back in to load Stop.".into(),
            can_enable: false,
        })
    }

    #[test]
    fn default_wayland_stop_requires_live_companion() {
        let detail = stop_shortcut_setup_detail("wayland", "Alt+D", panel("restart"), false)
            .expect("unloaded companion must block start");
        assert!(detail.contains("Sign out and back in"));
        assert!(
            stop_shortcut_setup_detail("wayland", "Alt+Shift+D", panel("disabled"), false)
                .is_some()
        );
        assert!(stop_shortcut_setup_detail("wayland", "alt+d", panel("restart"), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", Err("bus".into()), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("active"), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("active"), true).is_none());
        assert!(
            stop_shortcut_setup_detail("wayland", "Alt+D", panel("other-desktop"), false).is_none()
        );
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("restart"), true).is_some());
        assert_eq!(
            stop_reservation_required(&panel("other-desktop").unwrap()),
            Ok(false)
        );
        assert_eq!(
            stop_reservation_required(&panel("active").unwrap()),
            Ok(true)
        );
        assert!(stop_reservation_required(&panel("restart").unwrap()).is_err());
        assert!(stop_shortcut_setup_detail("x11", "Alt+D", panel("restart"), false).is_none());
        assert!(
            stop_shortcut_setup_detail("wayland", "Control+Space", panel("restart"), false)
                .is_none()
        );
    }
}
