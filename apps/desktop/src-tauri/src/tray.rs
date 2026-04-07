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
    pub recording: bool,
    pub microphone_ready: bool,
}

pub type TrayMutex = Mutex<TrayState>;

#[derive(Copy, Clone)]
enum TrayVisualState {
    NotReady,
    Ready,
    Recording,
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

    let icon_rgba = create_mic_icon(32, [140, 140, 140, 235], TrayVisualState::NotReady);
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
        recording: false,
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

/// Update the tray icon and menu to reflect recording state.
pub fn set_recording_state(app: &tauri::AppHandle, recording: bool) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        error!("Failed to lock tray state");
        return;
    };

    tray_state.recording = recording;
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
    let (state, color, tooltip) = if tray_state.recording {
        (
            TrayVisualState::Recording,
            [225, 229, 236, 244],
            "VOCO — Listening",
        )
    } else if tray_state.microphone_ready {
        (
            TrayVisualState::Ready,
            [170, 176, 186, 240],
            "VOCO — Ready to listen",
        )
    } else {
        (
            TrayVisualState::NotReady,
            [140, 140, 140, 235],
            "VOCO — Microphone not ready",
        )
    };

    let debug_enabled = tray_debug_enabled();
    let effective_tooltip = if debug_enabled {
        format!("{tooltip} [dbg:{}]", tray_state_label(state))
    } else {
        tooltip.to_string()
    };

    let icon_rgba = create_mic_icon(32, color, state);
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
                "Tray update -> state={}, color=rgba({},{},{},{}), recording={}, microphone_ready={}, tooltip='{}'",
                tray_state_label(state),
                color[0],
                color[1],
                color[2],
                color[3],
                tray_state.recording,
                tray_state.microphone_ready,
                effective_tooltip
            );
        }
    }

    let label = if tray_state.recording {
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

fn create_mic_icon(size: u32, color: [u8; 4], state: TrayVisualState) -> Vec<u8> {
    let mut pixels = create_base_mic_icon(size, color);
    draw_state_badge(&mut pixels, size, state);
    pixels
}

fn create_base_mic_icon(size: u32, color: [u8; 4]) -> Vec<u8> {
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let s = size as f32;
    let orb_fill = match color {
        [225, 229, 236, _] => [48, 52, 60, 255],
        [170, 176, 186, _] => [38, 42, 50, 255],
        _ => [28, 28, 36, 245],
    };
    let rim = match color {
        [225, 229, 236, _] => [236, 239, 244, 235],
        [170, 176, 186, _] => [200, 206, 214, 220],
        _ => [120, 120, 132, 205],
    };

    for py in 0..size {
        for px in 0..size {
            let x = px as f32;
            let y = py as f32;

            let nx = x / s;
            let ny = y / s;
            let idx = ((py * size + px) * 4) as usize;

            let orb_alpha = circle_alpha(nx, ny, 0.5, 0.5, 0.46, 0.028);
            if orb_alpha <= 0.0 {
                continue;
            }

            let glow_dist = ((nx - 0.5).powi(2) + (ny - 0.42).powi(2)).sqrt();
            let glow = (1.0 - glow_dist / 0.48).clamp(0.0, 1.0);

            let rim_dist = ((nx - 0.5).powi(2) + (ny - 0.5).powi(2)).sqrt();
            let rim_strength = (1.0 - ((rim_dist - 0.43).abs() / 0.042)).clamp(0.0, 1.0);

            let top_highlight = ellipse_alpha(nx, ny, 0.38, 0.28, 0.15, 0.10, 0.18) * 0.18;

            let mut red = orb_fill[0] as f32;
            let mut green = orb_fill[1] as f32;
            let mut blue = orb_fill[2] as f32;

            red = red * (1.0 - glow * 0.34) + color[0] as f32 * glow * 0.34;
            green = green * (1.0 - glow * 0.34) + color[1] as f32 * glow * 0.34;
            blue = blue * (1.0 - glow * 0.34) + color[2] as f32 * glow * 0.34;

            red = red * (1.0 - rim_strength * 0.3) + rim[0] as f32 * rim_strength * 0.3;
            green = green * (1.0 - rim_strength * 0.3) + rim[1] as f32 * rim_strength * 0.3;
            blue = blue * (1.0 - rim_strength * 0.3) + rim[2] as f32 * rim_strength * 0.3;

            red = red * (1.0 - top_highlight) + 255.0 * top_highlight;
            green = green * (1.0 - top_highlight) + 255.0 * top_highlight;
            blue = blue * (1.0 - top_highlight) + 255.0 * top_highlight;

            pixels[idx] = red.round().clamp(0.0, 255.0) as u8;
            pixels[idx + 1] = green.round().clamp(0.0, 255.0) as u8;
            pixels[idx + 2] = blue.round().clamp(0.0, 255.0) as u8;
            pixels[idx + 3] = (orb_alpha * 255.0).round().clamp(0.0, 255.0) as u8;

            let alpha = mic_shape(nx, ny);
            if alpha > 0.0 {
                blend_pixel(
                    &mut pixels,
                    size,
                    px as i32,
                    py as i32,
                    [242, 244, 247, color[3]],
                    alpha.min(1.0),
                );

                if (0.405..=0.595).contains(&nx) && (0.25..=0.52).contains(&ny) {
                    let groove_phase = ((nx - 0.405) / 0.038).fract();
                    let groove_distance = (groove_phase - 0.5).abs();
                    if groove_distance < 0.14 {
                        let groove = 1.0 - groove_distance / 0.14;
                        blend_pixel(
                            &mut pixels,
                            size,
                            px as i32,
                            py as i32,
                            [122, 128, 138, 96],
                            groove * alpha.min(1.0),
                        );
                    }
                }
            }
        }
    }

    pixels
}

fn draw_state_badge(pixels: &mut [u8], size: u32, state: TrayVisualState) {
    match state {
        TrayVisualState::NotReady => {
            // A high-contrast slash keeps "not ready" visible in monochrome trays.
            draw_line(pixels, size, (9, 23), (23, 9), [255, 255, 255, 235], 1.5);
            draw_line(pixels, size, (10, 23), (23, 10), [255, 255, 255, 160], 1.0);
        }
        TrayVisualState::Ready => {
            // Check mark also survives panel desaturation.
            draw_line(pixels, size, (9, 18), (13, 22), [255, 255, 255, 235], 1.6);
            draw_line(pixels, size, (13, 22), (22, 12), [255, 255, 255, 235], 1.6);
        }
        TrayVisualState::Recording => {
            // Bright center dot for active capture.
            draw_filled_circle(pixels, size, 22.0, 10.0, 3.2, [255, 255, 255, 245]);
        }
    }
}

fn draw_line(
    pixels: &mut [u8],
    size: u32,
    start: (i32, i32),
    end: (i32, i32),
    color: [u8; 4],
    thickness: f32,
) {
    let (x0, y0) = start;
    let (x1, y1) = end;

    let min_x = (x0.min(x1) as f32 - thickness - 1.0).floor().max(0.0) as i32;
    let max_x = (x0.max(x1) as f32 + thickness + 1.0)
        .ceil()
        .min(size as f32 - 1.0) as i32;
    let min_y = (y0.min(y1) as f32 - thickness - 1.0).floor().max(0.0) as i32;
    let max_y = (y0.max(y1) as f32 + thickness + 1.0)
        .ceil()
        .min(size as f32 - 1.0) as i32;

    let ax = x0 as f32;
    let ay = y0 as f32;
    let bx = x1 as f32;
    let by = y1 as f32;
    let abx = bx - ax;
    let aby = by - ay;
    let ab_len_sq = (abx * abx + aby * aby).max(0.0001);

    for py in min_y..=max_y {
        for px in min_x..=max_x {
            let px_f = px as f32;
            let py_f = py as f32;

            let apx = px_f - ax;
            let apy = py_f - ay;
            let t = ((apx * abx + apy * aby) / ab_len_sq).clamp(0.0, 1.0);
            let cx = ax + abx * t;
            let cy = ay + aby * t;

            let dx = px_f - cx;
            let dy = py_f - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist <= thickness {
                let softness = 0.8;
                let alpha_factor =
                    (1.0 - ((dist - (thickness - softness)).max(0.0) / softness)).clamp(0.0, 1.0);
                blend_pixel(pixels, size, px, py, color, alpha_factor);
            }
        }
    }
}

fn draw_filled_circle(pixels: &mut [u8], size: u32, cx: f32, cy: f32, radius: f32, color: [u8; 4]) {
    let min_x = (cx - radius - 1.0).floor().max(0.0) as i32;
    let max_x = (cx + radius + 1.0).ceil().min(size as f32 - 1.0) as i32;
    let min_y = (cy - radius - 1.0).floor().max(0.0) as i32;
    let max_y = (cy + radius + 1.0).ceil().min(size as f32 - 1.0) as i32;

    for py in min_y..=max_y {
        for px in min_x..=max_x {
            let dx = px as f32 - cx;
            let dy = py as f32 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist <= radius {
                let alpha_factor = (1.0 - (dist / radius).powf(2.2)).clamp(0.4, 1.0);
                blend_pixel(pixels, size, px, py, color, alpha_factor);
            }
        }
    }
}

fn blend_pixel(pixels: &mut [u8], size: u32, x: i32, y: i32, color: [u8; 4], alpha_factor: f32) {
    if x < 0 || y < 0 || x >= size as i32 || y >= size as i32 {
        return;
    }

    let idx = (((y as u32) * size + (x as u32)) * 4) as usize;

    let src_a = ((color[3] as f32 / 255.0) * alpha_factor).clamp(0.0, 1.0);
    let dst_a = (pixels[idx + 3] as f32 / 255.0).clamp(0.0, 1.0);
    let out_a = src_a + dst_a * (1.0 - src_a);

    if out_a <= 0.0 {
        return;
    }

    let blend_channel = |src: u8, dst: u8| -> u8 {
        let src_c = src as f32 / 255.0;
        let dst_c = dst as f32 / 255.0;
        let out_c = (src_c * src_a + dst_c * dst_a * (1.0 - src_a)) / out_a;
        (out_c * 255.0).round().clamp(0.0, 255.0) as u8
    };

    pixels[idx] = blend_channel(color[0], pixels[idx]);
    pixels[idx + 1] = blend_channel(color[1], pixels[idx + 1]);
    pixels[idx + 2] = blend_channel(color[2], pixels[idx + 2]);
    pixels[idx + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
}

fn mic_shape(nx: f32, ny: f32) -> f32 {
    let body = ellipse_alpha(nx, ny, 0.5, 0.39, 0.16, 0.23, 0.1);
    let trimmed_body = if ny > 0.56 {
        body * (1.0 - smoothstep(0.56, 0.62, ny))
    } else {
        body
    };
    let stem = rect_alpha(nx, ny, 0.472, 0.56, 0.528, 0.72, 0.015);
    let base = rect_alpha(nx, ny, 0.36, 0.73, 0.64, 0.79, 0.02);

    let yoke_dx = (nx - 0.5) / 0.24;
    let yoke_dy = (ny - 0.56) / 0.16;
    let yoke_dist = yoke_dx * yoke_dx + yoke_dy * yoke_dy;
    let yoke = if (0.7..=1.06).contains(&yoke_dist) && ny <= 0.62 {
        1.0 - ((yoke_dist - 0.88).abs() / 0.18)
    } else {
        0.0
    };

    trimmed_body.max(stem).max(base).max(yoke.clamp(0.0, 1.0))
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if (edge1 - edge0).abs() <= f32::EPSILON {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn circle_alpha(nx: f32, ny: f32, cx: f32, cy: f32, radius: f32, feather: f32) -> f32 {
    let dist = ((nx - cx).powi(2) + (ny - cy).powi(2)).sqrt();
    if dist <= radius {
        return 1.0;
    }
    if dist >= radius + feather {
        return 0.0;
    }
    1.0 - smoothstep(radius, radius + feather, dist)
}

fn ellipse_alpha(nx: f32, ny: f32, cx: f32, cy: f32, rx: f32, ry: f32, feather: f32) -> f32 {
    let dx = (nx - cx) / rx;
    let dy = (ny - cy) / ry;
    let dist = dx * dx + dy * dy;
    if dist <= 1.0 {
        return 1.0;
    }
    if dist >= 1.0 + feather {
        return 0.0;
    }
    1.0 - smoothstep(1.0, 1.0 + feather, dist)
}

fn rect_alpha(nx: f32, ny: f32, x0: f32, y0: f32, x1: f32, y1: f32, feather: f32) -> f32 {
    if (x0..=x1).contains(&nx) && (y0..=y1).contains(&ny) {
        return 1.0;
    }

    let dx = if nx < x0 {
        x0 - nx
    } else if nx > x1 {
        nx - x1
    } else {
        0.0
    };
    let dy = if ny < y0 {
        y0 - ny
    } else if ny > y1 {
        ny - y1
    } else {
        0.0
    };
    let dist = (dx * dx + dy * dy).sqrt();
    if dist >= feather {
        return 0.0;
    }
    1.0 - smoothstep(0.0, feather, dist)
}
