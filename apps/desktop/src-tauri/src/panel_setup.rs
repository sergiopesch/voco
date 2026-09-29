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

/// On GNOME Wayland Shell should consume these chords. Passive evdev
/// observation alone lets the focused application also act on them (Alt+D
/// focuses a browser address or deletes a terminal word), moving the cursor.
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
            "Dictation works, but VOCO's GNOME panel has not connected yet, so the focused app also receives {hotkey}. Reopen VOCO, or sign out and back in."
        )),
        Ok(panel) => Some(format!(
            "Dictation works, but without VOCO's GNOME panel the focused app also receives {hotkey}: browsers focus the address bar and terminals delete a word. {}",
            panel.detail
        )),
        Err(_) => Some(format!(
            "Dictation works, but VOCO cannot confirm that GNOME keeps {hotkey} out of the focused app. Check the VOCO panel."
        )),
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
            detail: "Sign out and back in to load the shortcut.".into(),
            can_enable: false,
        })
    }

    #[test]
    fn default_wayland_shortcut_recommends_live_companion() {
        let detail = stop_shortcut_setup_detail("wayland", "Alt+D", panel("restart"), false)
            .expect("unloaded companion is recommended");
        assert!(detail.starts_with("Dictation works"));
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
        assert!(stop_shortcut_setup_detail("x11", "Alt+D", panel("restart"), false).is_none());
        assert!(
            stop_shortcut_setup_detail("wayland", "Control+Space", panel("restart"), false)
                .is_none()
        );
    }
}
