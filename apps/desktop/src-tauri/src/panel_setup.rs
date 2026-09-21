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
