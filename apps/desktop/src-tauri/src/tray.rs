use log::{error, info};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Position, Size,
};

use crate::config::AppConfig;

const HOTKEY_PRESETS: &[&str] = &["Alt+D", "Alt+Shift+D"];

/// Holds the tray icon ID and toggle menu item for runtime updates
pub struct TrayState {
    pub tray_id: String,
    pub toggle_item: MenuItem<tauri::Wry>,
    pub current_hotkey: String,
    pub hotkey_items: Vec<(String, MenuItem<tauri::Wry>)>,
    pub dictation_status: DictationStatus,
    pub microphone_ready: bool,
}

pub type TrayMutex = Mutex<TrayState>;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DictationStatus {
    Idle,
    Recording,
    Processing,
    Error,
}

#[derive(Copy, Clone)]
enum TrayVisualState {
    NotReady,
    Ready,
    Recording,
    Processing,
}

fn tray_debug_enabled() -> bool {
    std::env::var("VOCO_TRAY_DEBUG")
        .or_else(|_| std::env::var("VOICE_TRAY_DEBUG"))
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn tray_state_label(state: TrayVisualState) -> &'static str {
    match state {
        TrayVisualState::NotReady => "not-ready",
        TrayVisualState::Ready => "ready",
        TrayVisualState::Recording => "recording",
        TrayVisualState::Processing => "processing",
    }
}

pub fn setup_tray(app: &tauri::App, hotkey_label: &str) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItemBuilder::with_id("quit", "Quit VOCO").build(app)?;
    let open_panel = MenuItemBuilder::with_id("open_panel", "Open VOCO").build(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Start Dictation").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;

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
        .item(&open_panel)
        .item(&toggle)
        .item(&settings)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&hotkey_menu)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?;

    let icon_rgba = create_mic_icon(32, TrayVisualState::NotReady);
    let icon = tauri::image::Image::new_owned(icon_rgba, 32, 32);

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("VOCO — Initializing microphone...")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                let rect_position = match rect.position {
                    Position::Physical(position) => position,
                    Position::Logical(position) => position.to_physical(1.0),
                };
                let rect_size = match rect.size {
                    Size::Physical(size) => size,
                    Size::Logical(size) => size.to_physical(1.0),
                };
                let _ = tray.app_handle().emit_to(
                    "main",
                    "voco:open-popover",
                    crate::TrayPopoverAnchor {
                        rect_position_x: rect_position.x,
                        rect_position_y: rect_position.y,
                        rect_width: rect_size.width,
                        rect_height: rect_size.height,
                    },
                );
            }
        })
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => {
                    app.exit(0);
                }
                "open_panel" => {
                    let _ = app.emit_to(
                        "main",
                        "voco:open-popover",
                        crate::TrayPopoverAnchor::default(),
                    );
                }
                "toggle" => {
                    crate::eval_toggle(app);
                }
                "settings" => {
                    let _ = app.emit_to("main", "voco:open-settings", ());
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
        dictation_status: DictationStatus::Idle,
        microphone_ready: false,
    }));

    Ok(())
}

/// Update the hotkey checkmarks in the tray menu
pub fn update_hotkey_display(app: &tauri::AppHandle, new_hotkey: &str) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        return;
    };

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
    let config_path = AppConfig::config_path().unwrap_or_default();

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

pub fn set_dictation_status(
    app: &tauri::AppHandle,
    status: DictationStatus,
) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        error!("Failed to lock tray state");
        return;
    };

    tray_state.dictation_status = status;
    apply_tray_state(app, &tray_state);
}

/// Update microphone readiness state in tray icon and tooltip.
pub fn update_microphone_ready(app: &tauri::AppHandle, ready: bool) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        error!("Failed to lock tray state");
        return;
    };

    tray_state.microphone_ready = ready;
    apply_tray_state(app, &tray_state);
}

fn apply_tray_state(app: &tauri::AppHandle, tray_state: &TrayState) {
    let (state, tooltip) = if !tray_state.microphone_ready {
        (TrayVisualState::NotReady, "VOCO — Microphone not ready")
    } else {
        match tray_state.dictation_status {
            DictationStatus::Recording => (TrayVisualState::Recording, "VOCO — Listening"),
            DictationStatus::Processing => {
                (TrayVisualState::Processing, "VOCO — Transcribing")
            }
            DictationStatus::Error => (TrayVisualState::NotReady, "VOCO — Needs attention"),
            DictationStatus::Idle => (TrayVisualState::Ready, "VOCO — Ready to listen"),
        }
    };

    let debug_enabled = tray_debug_enabled();
    let effective_tooltip = if debug_enabled {
        format!("{tooltip} [dbg:{}]", tray_state_label(state))
    } else {
        tooltip.to_string()
    };

    let icon_rgba = create_mic_icon(32, state);
    let icon = tauri::image::Image::new_owned(icon_rgba, 32, 32);

    if let Some(tray) = app.tray_by_id(&tray_state.tray_id) {
        if let Err(e) = tray.set_icon(Some(icon)) {
            error!("Failed to set tray icon: {e}");
        }
        if let Err(e) = tray.set_tooltip(Some(&effective_tooltip)) {
            error!("Failed to set tray tooltip: {e}");
        }

        if debug_enabled {
            info!(
                "Tray update -> state={}, recording={}, microphone_ready={}, tooltip='{}'",
                tray_state_label(state),
                matches!(tray_state.dictation_status, DictationStatus::Recording),
                tray_state.microphone_ready,
                effective_tooltip
            );
        }
    }

    let label = if matches!(tray_state.dictation_status, DictationStatus::Recording) {
        "Stop Dictation"
    } else {
        "Start Dictation"
    };
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

fn create_mic_icon(size: u32, state: TrayVisualState) -> Vec<u8> {
    let icon_bytes = match state {
        TrayVisualState::NotReady => include_bytes!("../../../../assets/voco-logo.png").as_slice(),
        TrayVisualState::Ready => {
            include_bytes!("../../../../assets/voco logo green v1.png").as_slice()
        }
        TrayVisualState::Recording => {
            include_bytes!("../../../../assets/voco logo red v1.png").as_slice()
        }
        TrayVisualState::Processing => {
            include_bytes!("../../../../assets/voco logo yellow v1.png").as_slice()
        }
    };

    image::load_from_memory_with_format(icon_bytes, image::ImageFormat::Png)
        .expect("official tray icon should decode")
        .resize_exact(size, size, image::imageops::FilterType::Lanczos3)
        .to_rgba8()
        .into_raw()
}
