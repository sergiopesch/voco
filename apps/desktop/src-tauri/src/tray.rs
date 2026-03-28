use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::TrayIconBuilder,
    Manager,
};
use log::{error, info};
use std::sync::Mutex;

const HOTKEY_PRESETS: &[&str] = &[
    "Alt+D",
    "Alt+Shift+D",
];

/// Holds the tray icon ID and toggle menu item for runtime updates
pub struct TrayState {
    pub tray_id: String,
    pub toggle_item: MenuItem<tauri::Wry>,
    pub current_hotkey: String,
    pub hotkey_items: Vec<(String, MenuItem<tauri::Wry>)>,
}

pub type TrayMutex = Mutex<TrayState>;

pub fn setup_tray(app: &tauri::App, hotkey_label: &str) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItemBuilder::with_id("quit", "Quit Voice").build(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Start Dictation").build(app)?;

    // Build hotkey submenu with presets
    let mut hotkey_submenu = SubmenuBuilder::with_id(app, "hotkey_menu", "Change Hotkey");
    let mut hotkey_items: Vec<(String, MenuItem<tauri::Wry>)> = Vec::new();

    for &preset in HOTKEY_PRESETS {
        let label = if preset == hotkey_label {
            format!("✓ {preset}")
        } else {
            format!("  {preset}")
        };
        let id = format!("hotkey:{preset}");
        let item = MenuItemBuilder::with_id(&id, &label).build(app)?;
        hotkey_submenu = hotkey_submenu.item(&item);
        hotkey_items.push((preset.to_string(), item));
    }

    hotkey_submenu = hotkey_submenu.separator();
    let edit_config = MenuItemBuilder::with_id("edit_config", "Custom...").build(app)?;
    hotkey_submenu = hotkey_submenu.item(&edit_config);

    let hotkey_menu = hotkey_submenu.build()?;

    let menu = MenuBuilder::new(app)
        .item(&toggle)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&hotkey_menu)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?;

    let icon_rgba = create_mic_icon(32, [255, 255, 255, 220]);
    let icon = tauri::image::Image::new_owned(icon_rgba, 32, 32);

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Voice")
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => {
                    app.exit(0);
                }
                "toggle" => {
                    crate::eval_toggle(app);
                }
                "edit_config" => {
                    open_config_file();
                }
                id if id.starts_with("hotkey:") => {
                    let new_hotkey = id.strip_prefix("hotkey:").unwrap();
                    if let Err(e) = crate::change_hotkey_runtime(app, new_hotkey) {
                        error!("Failed to change hotkey: {e}");
                    }
                }
                _ => {}
            }
        })
        .build(app)?;

    let tray_id = tray.id().as_ref().to_string();
    app.manage(Mutex::new(TrayState {
        tray_id,
        toggle_item: toggle,
        current_hotkey: hotkey_label.to_string(),
        hotkey_items,
    }));

    Ok(())
}

/// Update the hotkey checkmarks in the tray menu
pub fn update_hotkey_display(app: &tauri::AppHandle, new_hotkey: &str) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else { return };

    tray_state.current_hotkey = new_hotkey.to_string();

    for (preset, item) in &tray_state.hotkey_items {
        let label = if preset == new_hotkey {
            format!("✓ {preset}")
        } else {
            format!("  {preset}")
        };
        let _ = item.set_text(&label);
    }
}

fn open_config_file() {
    let config_path = dirs::config_dir()
        .map(|d| d.join("voice/config.json"))
        .unwrap_or_default();

    if config_path.exists() {
        if let Err(e) = std::process::Command::new("xdg-open")
            .arg(&config_path)
            .spawn()
        {
            error!("Failed to open config file: {e}");
        } else {
            info!("Opened config file: {}", config_path.display());
        }
    } else {
        error!("Config file not found: {}", config_path.display());
    }
}

/// Update the tray icon and menu to reflect recording state
pub fn update_tray_icon(app: &tauri::AppHandle, recording: bool) {
    let color = if recording {
        [255, 80, 80, 240]
    } else {
        [255, 255, 255, 220]
    };

    let icon_rgba = create_mic_icon(32, color);
    let icon = tauri::image::Image::new_owned(icon_rgba, 32, 32);

    let state = app.state::<TrayMutex>();
    let Ok(tray_state) = state.lock() else {
        error!("Failed to lock tray state");
        return;
    };

    if let Some(tray) = app.tray_by_id(&tray_state.tray_id) {
        let tooltip = if recording { "Voice — Recording..." } else { "Voice" };
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_tooltip(Some(tooltip));
    }

    let label = if recording { "Stop Dictation" } else { "Start Dictation" };
    let _ = tray_state.toggle_item.set_text(label);
}

/// Update just the tray tooltip
pub fn update_tray_tooltip(app: &tauri::AppHandle, tooltip: &str) {
    let state = app.state::<TrayMutex>();
    let Ok(tray_state) = state.lock() else { return };
    if let Some(tray) = app.tray_by_id(&tray_state.tray_id) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn create_mic_icon(size: u32, color: [u8; 4]) -> Vec<u8> {
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let s = size as f32;

    for py in 0..size {
        for px in 0..size {
            let x = px as f32;
            let y = py as f32;

            let nx = x / s;
            let ny = y / s;

            let alpha = mic_shape(nx, ny);

            if alpha > 0.0 {
                let idx = ((py * size + px) * 4) as usize;
                let a = (alpha.min(1.0) * color[3] as f32) as u8;
                pixels[idx] = color[0];
                pixels[idx + 1] = color[1];
                pixels[idx + 2] = color[2];
                pixels[idx + 3] = a;
            }
        }
    }

    pixels
}

fn mic_shape(nx: f32, ny: f32) -> f32 {
    let cx = 0.5;

    let cap_cx = cx;
    let cap_cy = 0.28;
    let cap_rx = 0.22;
    let cap_ry = 0.28;
    let dx = (nx - cap_cx) / cap_rx;
    let dy = (ny - cap_cy) / cap_ry;
    let cap_dist = dx * dx + dy * dy;
    if cap_dist <= 1.0 {
        return smooth_edge(1.0 - cap_dist, 0.08);
    }

    let arc_cy = 0.62;
    let arc_rx = 0.28;
    let arc_ry = 0.10;
    let arc_dx = (nx - cx) / arc_rx;
    let arc_dy = (ny - arc_cy) / arc_ry;
    let arc_dist = arc_dx * arc_dx + arc_dy * arc_dy;
    if (0.7..=1.0).contains(&arc_dist) && ny > 0.56 {
        return smooth_edge(1.0 - (arc_dist - 0.85).abs() / 0.15, 0.3);
    }

    let stand_hw = 0.04;
    if (nx - cx).abs() < stand_hw && ny > 0.62 && ny < 0.82 {
        return smooth_edge(1.0 - (nx - cx).abs() / stand_hw, 0.3);
    }

    let base_hw = 0.20;
    let base_h = 0.06;
    let base_y = 0.82;
    if (nx - cx).abs() < base_hw && ny >= base_y && ny < base_y + base_h {
        let edge_x = smooth_edge(1.0 - (nx - cx).abs() / base_hw, 0.15);
        let edge_y = smooth_edge(1.0 - ((ny - base_y - base_h / 2.0).abs() / (base_h / 2.0)), 0.3);
        return edge_x.min(edge_y);
    }

    0.0
}

fn smooth_edge(v: f32, softness: f32) -> f32 {
    if softness <= 0.0 {
        return if v > 0.0 { 1.0 } else { 0.0 };
    }
    (v / softness).clamp(0.0, 1.0)
}
