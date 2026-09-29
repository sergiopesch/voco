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

/// On Wayland only the desktop can consume these chords: VOCO's GNOME 46 panel,
/// or elsewhere a desktop keybinding for `voco --toggle`. Passive evdev
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
    let Ok(panel) = status else {
        return Some(format!(
            "VOCO cannot confirm that GNOME keeps {hotkey} out of the app you are dictating into. Check the VOCO panel in Help."
        ));
    };
    let remedy = match panel.status.as_str() {
        "active" if attached => return None,
        "active" => "VOCO's GNOME panel is enabled but not connected yet. Reopen VOCO, or sign out and back in.".into(),
        "disabled" => "Enable the VOCO panel in Help to keep the shortcut out of other apps.".into(),
        "other-desktop" | "unsupported" => "To avoid that, choose another shortcut in VOCO and assign `voco --toggle` to it in your desktop's keyboard settings.".into(),
        _ => panel.detail,
    };
    Some(format!(
        "{hotkey} also reaches the app you are dictating into: browsers move the cursor to the address bar, so your words land there, and terminals delete a word. {remedy}"
    ))
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
        assert!(detail.starts_with("Alt+D also reaches the app you are dictating into"));
        assert!(detail.ends_with("Sign out and back in to load the shortcut."));
        assert!(
            stop_shortcut_setup_detail("wayland", "Alt+Shift+D", panel("disabled"), false)
                .is_some_and(|detail| detail.contains("Enable the VOCO panel"))
        );
        assert!(stop_shortcut_setup_detail("wayland", "alt+d", panel("restart"), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", Err("bus".into()), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("active"), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("active"), true).is_none());
        // Without a companion that can grab the chord, evdev only observes it.
        for status in ["other-desktop", "unsupported"] {
            assert!(
                stop_shortcut_setup_detail("wayland", "Alt+D", panel(status), false)
                    .is_some_and(|detail| detail.contains("voco --toggle"))
            );
        }
        // A previous companion that is still loaded attaches without grabbing Start.
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("restart"), true).is_some());
        assert!(stop_shortcut_setup_detail("x11", "Alt+D", panel("restart"), false).is_none());
        assert!(
            stop_shortcut_setup_detail("wayland", "Control+Space", panel("restart"), false)
                .is_none()
        );
    }
}
