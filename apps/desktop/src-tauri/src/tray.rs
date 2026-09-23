use log::{error, info};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Position, Size,
};

const HOTKEY_PRESETS: &[&str] = &["Alt+D", "Alt+Shift+D"];

/// Holds the tray icon ID and toggle menu item for runtime updates
pub struct TrayState {
    pub tray_id: String,
    pub toggle_item: MenuItem<tauri::Wry>,
    pub stop_item: MenuItem<tauri::Wry>,
    pub status_item: MenuItem<tauri::Wry>,
    pub open_panel_item: MenuItem<tauri::Wry>,
    pub settings_item: MenuItem<tauri::Wry>,
    pub hotkey_menu: Submenu<tauri::Wry>,
    pub current_hotkey: String,
    pub hotkey_items: Vec<(String, MenuItem<tauri::Wry>)>,
    pub dictation_status: DictationStatus,
    pub dictation_session_id: u64,
    pub has_recoverable_transcript: bool,
    pub microphone_ready: bool,
    pub microphone_permission: MicrophonePermission,
    pub native_microphone_ready: Option<bool>,
    pub cursor_delivery: CursorDeliveryState,
    pub cursor_required: bool,
    pub cursor_setup_state: String,
    pub manual_transcript_ready: bool,
    pub recovery_available: bool,
    pub configuration_error: bool,
    pub model_download_status: ModelDownloadStatus,
    pub runtime_initialized: bool,
    pub runtime_epoch: u64,
    pub runtime_revision: u64,
    icons: crate::tray_icons::TrayIcons,
    applied_presentation: Option<TrayPresentation>,
    applied_visual: Option<TrayVisualState>,
    meter_timer: Option<glib::SourceId>,
    meter: crate::tray_icons::MeterEnvelope,
    applied_meter: Option<usize>,
    fallback_visible: bool,
}

pub type TrayMutex = Mutex<TrayState>;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DictationStatus {
    Idle,
    Starting,
    Recording,
    Processing,
    Error,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CursorDeliveryState {
    Inactive,
    Pending,
    Owned,
    PreviewOnly,
    Unreconciled,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MicrophonePermission {
    #[default]
    Unknown,
    Granted,
    Denied,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default)]
pub enum ModelDownloadStatus {
    #[default]
    Checking,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStatusSnapshot {
    pub epoch: u64,
    pub revision: u64,
    pub runtime_initialized: bool,
    pub configuration_error: bool,
    pub microphone_ready: bool,
    pub microphone_permission: MicrophonePermission,
    #[serde(default)]
    pub native_microphone_ready: Option<bool>,
    pub dictation_status: DictationStatus,
    #[serde(default)]
    pub dictation_session_id: u64,
    #[serde(default)]
    pub has_recoverable_transcript: bool,
    pub cursor_delivery: CursorDeliveryState,
    pub cursor_required: bool,
    pub cursor_setup_state: String,
    pub manual_transcript_ready: bool,
    #[serde(default)]
    pub recovery_available: bool,
    #[serde(skip)]
    model_download_status: ModelDownloadStatus,
}

impl Default for RuntimeStatusSnapshot {
    fn default() -> Self {
        Self {
            epoch: 0,
            revision: 0,
            runtime_initialized: false,
            configuration_error: false,
            microphone_ready: false,
            microphone_permission: MicrophonePermission::Unknown,
            native_microphone_ready: None,
            dictation_status: DictationStatus::Idle,
            dictation_session_id: 0,
            has_recoverable_transcript: false,
            cursor_delivery: CursorDeliveryState::Inactive,
            cursor_required: false,
            cursor_setup_state: String::new(),
            manual_transcript_ready: false,
            recovery_available: false,
            model_download_status: ModelDownloadStatus::Checking,
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TrayVisualState {
    NotReady,
    Ready,
    Recording,
    Processing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayPresentation {
    visual_state: TrayVisualState,
    tooltip: String,
    title: &'static str,
    dictation_label: &'static str,
    dictation_enabled: bool,
    dictation_action: TrayDictationAction,
    popover_enabled: bool,
    settings_enabled: bool,
    hotkey_menu_enabled: bool,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TrayDictationAction {
    Toggle,
    Stop,
    ReviewRecovery,
    Ignore,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TrayLeftClickAction {
    StopDictation,
    ShowPopover,
    Ignore,
}

fn dictation_is_active(status: DictationStatus) -> bool {
    matches!(
        status,
        DictationStatus::Starting | DictationStatus::Recording | DictationStatus::Processing
    )
}

fn hotkeys_equivalent(left: &str, right: &str) -> bool {
    use tauri_plugin_global_shortcut::Shortcut;

    match (left.parse::<Shortcut>(), right.parse::<Shortcut>()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn derive_tray_presentation(snapshot: &RuntimeStatusSnapshot) -> TrayPresentation {
    let dictation_active = dictation_is_active(snapshot.dictation_status);
    let (visual_state, tooltip) = if !snapshot.runtime_initialized {
        match snapshot.model_download_status {
            ModelDownloadStatus::Failed => (
                TrayVisualState::NotReady,
                "VOCO — Speech model needs attention".to_string(),
            ),
            ModelDownloadStatus::Checking | ModelDownloadStatus::Ready => (
                TrayVisualState::NotReady,
                "VOCO — Initializing…".to_string(),
            ),
        }
    } else if snapshot.manual_transcript_ready && !dictation_active {
        (
            TrayVisualState::Ready,
            "VOCO — Transcript ready to copy".to_string(),
        )
    } else if snapshot.recovery_available && !dictation_active {
        (
            TrayVisualState::Processing,
            "VOCO — Dictation saved".to_string(),
        )
    } else if (snapshot.has_recoverable_transcript
        || matches!(snapshot.cursor_delivery, CursorDeliveryState::Unreconciled))
        && !snapshot.configuration_error
        && !dictation_active
    {
        (
            TrayVisualState::NotReady,
            "VOCO — Transcript needs attention".to_string(),
        )
    } else {
        match snapshot.dictation_status {
            DictationStatus::Starting => (
                TrayVisualState::Processing,
                "VOCO — Starting microphone".to_string(),
            ),
            DictationStatus::Recording => {
                if !snapshot.cursor_required
                    || snapshot.cursor_delivery == CursorDeliveryState::Inactive
                {
                    (TrayVisualState::Recording, "VOCO — Listening".to_string())
                } else if matches!(snapshot.cursor_delivery, CursorDeliveryState::Owned) {
                    (
                        TrayVisualState::Recording,
                        "VOCO — Listening · target verified".to_string(),
                    )
                } else if matches!(snapshot.cursor_delivery, CursorDeliveryState::Pending) {
                    (
                        TrayVisualState::Recording,
                        "VOCO — Listening · preparing target".to_string(),
                    )
                } else {
                    (
                        TrayVisualState::Recording,
                        "VOCO — Listening · manual copy".to_string(),
                    )
                }
            }
            DictationStatus::Processing => (
                TrayVisualState::Processing,
                "VOCO — Transcribing".to_string(),
            ),
            DictationStatus::Idle | DictationStatus::Error if snapshot.configuration_error => (
                TrayVisualState::NotReady,
                "VOCO — Settings need attention".to_string(),
            ),
            DictationStatus::Error => (
                TrayVisualState::NotReady,
                "VOCO — Needs attention".to_string(),
            ),
            DictationStatus::Idle if snapshot.native_microphone_ready == Some(false) => (
                TrayVisualState::NotReady,
                "VOCO — Microphone setup required".to_string(),
            ),
            DictationStatus::Idle
                if snapshot.native_microphone_ready.is_none()
                    && matches!(snapshot.microphone_permission, MicrophonePermission::Denied) =>
            {
                (
                    TrayVisualState::NotReady,
                    "VOCO — Microphone needs permission".to_string(),
                )
            }
            DictationStatus::Idle
                if snapshot.cursor_required
                    && snapshot.cursor_setup_state != "ready"
                    && snapshot.cursor_setup_state != "safety-disabled" =>
            {
                (
                    TrayVisualState::NotReady,
                    "VOCO — Text delivery needs setup · manual copy available".to_string(),
                )
            }
            DictationStatus::Idle
                if matches!(snapshot.model_download_status, ModelDownloadStatus::Failed) =>
            {
                (
                    TrayVisualState::NotReady,
                    "VOCO — Speech model needs attention".to_string(),
                )
            }
            DictationStatus::Idle
                if matches!(
                    snapshot.model_download_status,
                    ModelDownloadStatus::Checking
                ) =>
            {
                (
                    TrayVisualState::Processing,
                    "VOCO — Checking speech model…".to_string(),
                )
            }
            DictationStatus::Idle if !snapshot.microphone_ready => (
                TrayVisualState::Ready,
                "VOCO — Ready · microphone checks on first use".to_string(),
            ),
            DictationStatus::Idle => (TrayVisualState::Ready, "VOCO — Ready to listen".to_string()),
        }
    };

    let runtime_ready = snapshot.runtime_initialized && !snapshot.configuration_error;
    let browser_allowed = !matches!(snapshot.microphone_permission, MicrophonePermission::Denied);
    let dictation_allowed =
        runtime_ready && snapshot.native_microphone_ready.unwrap_or(browser_allowed);

    let (dictation_label, dictation_action) = match snapshot.dictation_status {
        DictationStatus::Starting => ("Stop after microphone starts", TrayDictationAction::Stop),
        DictationStatus::Recording => ("Stop Dictation", TrayDictationAction::Stop),
        DictationStatus::Processing => ("Transcribing…", TrayDictationAction::Ignore),
        DictationStatus::Idle | DictationStatus::Error
            if snapshot.runtime_initialized
                && (snapshot.manual_transcript_ready || snapshot.recovery_available) =>
        {
            (
                if snapshot.manual_transcript_ready {
                    "Review Transcript"
                } else {
                    "Review Recording"
                },
                TrayDictationAction::ReviewRecovery,
            )
        }
        DictationStatus::Idle | DictationStatus::Error => (
            "Start Dictation",
            if dictation_allowed {
                TrayDictationAction::Toggle
            } else {
                TrayDictationAction::Ignore
            },
        ),
    };
    let popover_enabled = snapshot.runtime_initialized
        && !dictation_active
        && (!snapshot.configuration_error
            || snapshot.manual_transcript_ready
            || snapshot.recovery_available);

    let title = match snapshot.dictation_status {
        _ if !snapshot.runtime_initialized
            && snapshot.model_download_status == ModelDownloadStatus::Failed =>
        {
            "Check setup"
        }
        _ if !snapshot.runtime_initialized => "Starting VOCO",
        DictationStatus::Starting => "Starting",
        DictationStatus::Recording => "",
        DictationStatus::Processing => "Finishing",
        _ if snapshot.manual_transcript_ready
            || snapshot.recovery_available
            || snapshot.has_recoverable_transcript
            || snapshot.cursor_delivery == CursorDeliveryState::Unreconciled =>
        {
            "Review"
        }
        _ if visual_state == TrayVisualState::NotReady => "Check setup",
        _ if snapshot.model_download_status != ModelDownloadStatus::Ready => "Starting VOCO",
        _ => "Ready",
    };
    TrayPresentation {
        visual_state,
        title,
        tooltip,
        dictation_label,
        dictation_enabled: dictation_action != TrayDictationAction::Ignore,
        dictation_action,
        popover_enabled,
        settings_enabled: snapshot.runtime_initialized && !dictation_active,
        hotkey_menu_enabled: snapshot.runtime_initialized
            && !snapshot.configuration_error
            && !dictation_active,
    }
}

fn derive_tray_left_click_action(snapshot: &RuntimeStatusSnapshot) -> TrayLeftClickAction {
    match snapshot.dictation_status {
        DictationStatus::Starting | DictationStatus::Recording => {
            TrayLeftClickAction::StopDictation
        }
        DictationStatus::Processing => TrayLeftClickAction::Ignore,
        DictationStatus::Idle | DictationStatus::Error => {
            if derive_tray_presentation(snapshot).popover_enabled {
                TrayLeftClickAction::ShowPopover
            } else {
                TrayLeftClickAction::Ignore
            }
        }
    }
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

fn runtime_snapshot_from_tray_state(tray_state: &TrayState) -> RuntimeStatusSnapshot {
    RuntimeStatusSnapshot {
        epoch: tray_state.runtime_epoch,
        revision: tray_state.runtime_revision,
        runtime_initialized: tray_state.runtime_initialized,
        configuration_error: tray_state.configuration_error,
        microphone_ready: tray_state.microphone_ready,
        microphone_permission: tray_state.microphone_permission,
        native_microphone_ready: tray_state.native_microphone_ready,
        dictation_status: tray_state.dictation_status,
        dictation_session_id: tray_state.dictation_session_id,
        has_recoverable_transcript: tray_state.has_recoverable_transcript,
        cursor_delivery: tray_state.cursor_delivery,
        cursor_required: tray_state.cursor_required,
        cursor_setup_state: tray_state.cursor_setup_state.clone(),
        manual_transcript_ready: tray_state.manual_transcript_ready,
        recovery_available: tray_state.recovery_available,
        model_download_status: tray_state.model_download_status,
    }
}

fn current_tray_presentation(app: &tauri::AppHandle) -> Option<TrayPresentation> {
    let state = app.state::<TrayMutex>();
    state
        .lock()
        .ok()
        .map(|state| derive_tray_presentation(&runtime_snapshot_from_tray_state(&state)))
}

fn tray_configuration_allowed(app: &tauri::AppHandle) -> bool {
    current_tray_presentation(app)
        .map(|presentation| presentation.hotkey_menu_enabled)
        .unwrap_or(false)
}

fn tray_popover_allowed(app: &tauri::AppHandle) -> bool {
    current_tray_presentation(app)
        .map(|presentation| presentation.popover_enabled)
        .unwrap_or(false)
}

fn tray_settings_allowed(app: &tauri::AppHandle) -> bool {
    current_tray_presentation(app)
        .map(|presentation| presentation.settings_enabled)
        .unwrap_or(false)
}

pub fn setup_tray(app: &tauri::App, hotkey_label: &str) -> Result<(), Box<dyn std::error::Error>> {
    let status_item = MenuItemBuilder::with_id("status", "VOCO — Starting")
        .enabled(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit VOCO").build(app)?;
    let open_panel = MenuItemBuilder::with_id("open_panel", "Open VOCO").build(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Start Dictation").build(app)?;
    let stop = MenuItemBuilder::with_id("stop", "Stop Dictation")
        .enabled(false)
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;

    // Build hotkey submenu with presets
    let mut hotkey_submenu = SubmenuBuilder::with_id(app, "hotkey_menu", "Change Hotkey");
    let mut hotkey_items: Vec<(String, MenuItem<tauri::Wry>)> = Vec::new();

    for &preset in HOTKEY_PRESETS {
        let label = if hotkeys_equivalent(preset, hotkey_label) {
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
    let edit_config = MenuItemBuilder::with_id("edit_config", "Custom hotkey…").build(app)?;
    hotkey_submenu = hotkey_submenu.item(&edit_config);

    let hotkey_menu = hotkey_submenu.build()?;

    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .item(&open_panel)
        .item(&toggle)
        .item(&stop)
        .item(&settings)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&hotkey_menu)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?;

    let icon_rgba = create_mic_icon(32, TrayVisualState::NotReady);
    let icon = tauri::image::Image::new_owned(icon_rgba, 32, 32);

    let icons = crate::tray_icons::TrayIcons::new()?;
    let tray = TrayIconBuilder::new()
        .temp_dir_path(icons.directory())
        .title("Starting VOCO")
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
                let anchor = match (rect.position, rect.size) {
                    (Position::Physical(position), Size::Physical(size)) => {
                        crate::TrayPopoverAnchor {
                            rect_position_x: position.x,
                            rect_position_y: position.y,
                            rect_width: size.width,
                            rect_height: size.height,
                        }
                    }
                    // Tauri does not expose the monitor scale associated with a logical tray
                    // rectangle. A zero anchor deliberately selects the centered fallback instead
                    // of guessing at 1× and placing the popover on the wrong monitor.
                    _ => crate::TrayPopoverAnchor::default(),
                };
                let app = tray.app_handle();
                let action = {
                    let state = app.state::<TrayMutex>();
                    state.lock().ok().map(|state| {
                        derive_tray_left_click_action(&runtime_snapshot_from_tray_state(&state))
                    })
                };
                match action {
                    Some(TrayLeftClickAction::StopDictation) => request_stop(app),
                    Some(TrayLeftClickAction::ShowPopover) => {
                        let _ = app.emit_to("main", "voco:toggle-popover", anchor);
                    }
                    Some(TrayLeftClickAction::Ignore) | None => {}
                }
            }
        })
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => {
                    app.exit(0);
                }
                "open_panel" if tray_popover_allowed(app) => {
                    let _ = app.emit_to(
                        "main",
                        "voco:show-popover",
                        crate::TrayPopoverAnchor::default(),
                    );
                }
                "toggle" => match current_tray_presentation(app).map(|p| p.dictation_action) {
                    Some(TrayDictationAction::Toggle) => crate::eval_toggle(app),
                    Some(TrayDictationAction::ReviewRecovery) => {
                        let _ = app.emit_to(
                            "main",
                            "voco:show-popover",
                            crate::TrayPopoverAnchor::default(),
                        );
                    }
                    Some(TrayDictationAction::Stop | TrayDictationAction::Ignore) | None => {}
                },
                "stop" => request_stop(app),
                "settings" if tray_settings_allowed(app) => {
                    let _ = app.emit_to("main", "voco:open-settings", ());
                }
                "edit_config" if tray_configuration_allowed(app) => {
                    let _ = app.emit_to("main", "voco:open-hotkey-settings", ());
                }
                id if id.starts_with("hotkey:") && tray_configuration_allowed(app) => {
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
        stop_item: stop,
        status_item,
        open_panel_item: open_panel,
        settings_item: settings,
        hotkey_menu,
        current_hotkey: hotkey_label.to_string(),
        hotkey_items,
        dictation_status: DictationStatus::Idle,
        dictation_session_id: 0,
        has_recoverable_transcript: false,
        microphone_ready: false,
        microphone_permission: MicrophonePermission::Unknown,
        native_microphone_ready: None,
        cursor_delivery: CursorDeliveryState::Inactive,
        cursor_required: false,
        cursor_setup_state: String::new(),
        manual_transcript_ready: false,
        recovery_available: false,
        configuration_error: false,
        model_download_status: ModelDownloadStatus::Checking,
        runtime_initialized: false,
        runtime_epoch: 0,
        runtime_revision: 0,
        icons,
        applied_presentation: None,
        applied_visual: None,
        meter_timer: None,
        meter: crate::tray_icons::MeterEnvelope::default(),
        applied_meter: None,
        fallback_visible: true,
    }));
    {
        let managed_state = app.state::<TrayMutex>();
        if let Ok(mut initial_state) = managed_state.lock() {
            apply_tray_state(app.handle(), &mut initial_state);
        };
    }

    Ok(())
}

/// Update the hotkey checkmarks in the tray menu
pub fn update_hotkey_display(app: &tauri::AppHandle, new_hotkey: &str) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        return;
    };

    tray_state.current_hotkey = new_hotkey.to_string();
    #[cfg(target_os = "linux")]
    crate::panel::clear_shortcut();
    drop(tray_state);
    refresh_tray(app);
}

pub fn current_hotkey(app: &tauri::AppHandle) -> Result<String, String> {
    app.state::<TrayMutex>()
        .lock()
        .map(|state| state.current_hotkey.clone())
        .map_err(|_| "Failed to lock tray state".to_string())
}

pub fn update_runtime_status(app: &tauri::AppHandle, snapshot: RuntimeStatusSnapshot) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        error!("Failed to lock tray state");
        return;
    };

    let active_epoch = tray_state.runtime_epoch;
    if !accept_runtime_snapshot(
        active_epoch,
        &mut tray_state.runtime_revision,
        snapshot.epoch,
        snapshot.revision,
    ) {
        return;
    }
    tray_state.microphone_ready = snapshot.microphone_ready;
    tray_state.microphone_permission = snapshot.microphone_permission;
    tray_state.native_microphone_ready = snapshot.native_microphone_ready;
    tray_state.dictation_status = snapshot.dictation_status;
    tray_state.dictation_session_id = snapshot.dictation_session_id;
    #[cfg(target_os = "linux")]
    if !matches!(
        snapshot.dictation_status,
        DictationStatus::Starting | DictationStatus::Recording | DictationStatus::Processing
    ) {
        // The compositor releases at idle; passive Start must be available then.
        crate::panel::clear_shortcut();
    }
    tray_state.has_recoverable_transcript = snapshot.has_recoverable_transcript;
    tray_state.cursor_delivery = snapshot.cursor_delivery;
    tray_state.cursor_required = snapshot.cursor_required;
    tray_state.cursor_setup_state = snapshot.cursor_setup_state;
    tray_state.manual_transcript_ready = snapshot.manual_transcript_ready;
    tray_state.recovery_available = snapshot.recovery_available;
    tray_state.configuration_error = snapshot.configuration_error;
    tray_state.runtime_initialized = snapshot.runtime_initialized;
    drop(tray_state);
    refresh_tray(app);
}

fn refresh_tray(app: &tauri::AppHandle) {
    // A worker must release the state lock before dispatching GTK work. Shell
    // requests and the meter also read this state on the GTK thread.
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let managed = handle.state::<TrayMutex>();
        if let Ok(mut state) = managed.lock() {
            apply_tray_state(&handle, &mut state);
        };
    }) {
        error!("Failed to refresh tray: {error}");
    }
}

fn apply_tray_state(app: &tauri::AppHandle, tray_state: &mut TrayState) {
    sync_meter_timer(app, tray_state);
    for (preset, item) in &tray_state.hotkey_items {
        let label = if hotkeys_equivalent(preset, &tray_state.current_hotkey) {
            format!("✓ {preset}")
        } else {
            format!("  {preset}")
        };
        let _ = item.set_text(&label);
    }
    let snapshot = runtime_snapshot_from_tray_state(tray_state);
    let presentation = derive_tray_presentation(&snapshot);
    // Even equivalent presentation updates carry a new action token to Shell.
    #[cfg(target_os = "linux")]
    crate::panel::publish();
    if tray_state.applied_presentation.as_ref() == Some(&presentation) {
        return;
    }
    let state = presentation.visual_state;
    let tooltip = &presentation.tooltip;

    let debug_enabled = tray_debug_enabled();
    let effective_tooltip = if debug_enabled {
        format!("{tooltip} [dbg:{}]", tray_state_label(state))
    } else {
        tooltip.clone()
    };

    if let Some(tray) = app.tray_by_id(&tray_state.tray_id) {
        if tray_state.applied_visual != Some(state) {
            let path = if tray_state.dictation_status == DictationStatus::Recording {
                tray_state.icons.meter_path(0)
            } else {
                tray_state.icons.path(tray_state_label(state))
            };
            match tray.with_inner_tray_icon(move |inner| {
                inner.set_icon_path(path).map_err(|error| error.to_string())
            }) {
                Ok(Ok(())) => tray_state.applied_visual = Some(state),
                error => error!("Failed to select tray icon: {error:?}"),
            }
        }
        if let Err(error) = tray.set_title(Some(presentation.title)) {
            error!("Failed to set tray status label: {error}");
        }
        if let Err(e) = tray.set_tooltip(Some(&effective_tooltip)) {
            error!("Failed to set tray tooltip: {e}");
        }
        crate::trace_hotkey_event("tray_status_updated", None);

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

    let _ = tray_state.status_item.set_text(&presentation.tooltip);
    let stopping = presentation.dictation_action == TrayDictationAction::Stop;
    let _ = tray_state.toggle_item.set_text(if stopping {
        "Start Dictation"
    } else {
        presentation.dictation_label
    });
    let _ = tray_state
        .toggle_item
        .set_enabled(presentation.dictation_enabled && !stopping);
    let _ = tray_state.stop_item.set_text(if stopping {
        presentation.dictation_label
    } else {
        "Stop Dictation"
    });
    let _ = tray_state.stop_item.set_enabled(stopping);
    let _ = tray_state
        .open_panel_item
        .set_enabled(presentation.popover_enabled);
    let _ = tray_state
        .settings_item
        .set_enabled(presentation.settings_enabled);
    let _ = tray_state
        .hotkey_menu
        .set_enabled(presentation.hotkey_menu_enabled);
    tray_state.applied_presentation = Some(presentation);
}

fn sync_meter_timer(app: &tauri::AppHandle, state: &mut TrayState) {
    if state.dictation_status != DictationStatus::Recording {
        if let Some(timer) = state.meter_timer.take() {
            timer.remove();
            crate::panel::reset_level();
        }
        state.applied_meter = None;
        return;
    }
    if state.meter_timer.is_some() {
        return;
    }
    crate::panel::reset_level();
    state.meter = crate::tray_icons::MeterEnvelope::default();
    state.applied_meter = None;
    let app = app.clone();
    let mut previous = std::time::Instant::now();
    state.meter_timer = Some(glib::timeout_add(
        std::time::Duration::from_millis(33),
        move || {
            let managed = app.state::<TrayMutex>();
            let Ok(mut state) = managed.try_lock() else {
                return glib::ControlFlow::Continue;
            };
            let now = std::time::Instant::now();
            let elapsed = now.duration_since(previous).as_secs_f64();
            previous = now;
            if state.dictation_status != DictationStatus::Recording {
                return glib::ControlFlow::Continue;
            }
            let level = crate::panel::level(state.runtime_epoch, state.dictation_status);
            let frame = state.meter.step(level, elapsed, meter_animations_enabled());
            if !state.fallback_visible || state.applied_meter == Some(frame) {
                return glib::ControlFlow::Continue;
            }
            if let Some(tray) = app.tray_by_id(&state.tray_id) {
                let path = state.icons.meter_path(frame);
                match tray.with_inner_tray_icon(move |inner| {
                    inner.set_icon_path(path).map_err(|e| e.to_string())
                }) {
                    Ok(Ok(())) => state.applied_meter = Some(frame),
                    error => error!("Failed to update tray meter: {error:?}"),
                }
            }
            glib::ControlFlow::Continue
        },
    ));
}

fn meter_animations_enabled() -> bool {
    use webkit2gtk::gio::{prelude::SettingsExt, Settings, SettingsSchemaSource};
    // Construct and retain GObjects only on the GLib callback thread. Other
    // desktops need not install GNOME's optional preference schema.
    thread_local! {
        static SETTINGS: Option<Settings> = SettingsSchemaSource::default()
            .and_then(|source| source.lookup("org.gnome.desktop.interface", true))
            .map(|schema| Settings::new_full(&schema, None::<&webkit2gtk::gio::SettingsBackend>, None));
    }
    SETTINGS.with(|settings| {
        settings
            .as_ref()
            .is_none_or(|settings| settings.boolean("enable-animations"))
    })
}

fn request_stop(app: &tauri::AppHandle) {
    let _ = app.emit_to(
        "main",
        "voco:toggle-dictation",
        serde_json::json!({"triggerId":"tray:stop", "action":"stop"}),
    );
}

fn accept_runtime_snapshot(
    active_epoch: u64,
    current_revision: &mut u64,
    incoming_epoch: u64,
    incoming_revision: u64,
) -> bool {
    if incoming_epoch != active_epoch
        || incoming_revision == 0
        || incoming_revision <= *current_revision
    {
        return false;
    }
    *current_revision = incoming_revision;
    true
}

pub fn begin_runtime_status_session(app: &tauri::AppHandle) -> Result<u64, String> {
    let state = app.state::<TrayMutex>();
    let mut tray_state = state
        .lock()
        .map_err(|_| "Failed to lock tray state".to_string())?;
    tray_state.runtime_epoch = tray_state.runtime_epoch.saturating_add(1).max(1);
    tray_state.runtime_revision = 0;
    #[cfg(target_os = "linux")]
    crate::panel::clear_shortcut();
    tray_state.microphone_ready = false;
    tray_state.microphone_permission = MicrophonePermission::Unknown;
    tray_state.native_microphone_ready = None;
    tray_state.dictation_status = DictationStatus::Idle;
    tray_state.dictation_session_id = 0;
    tray_state.has_recoverable_transcript = false;
    tray_state.cursor_delivery = CursorDeliveryState::Inactive;
    tray_state.cursor_required = false;
    tray_state.cursor_setup_state.clear();
    tray_state.manual_transcript_ready = false;
    tray_state.recovery_available = false;
    tray_state.configuration_error = false;
    tray_state.runtime_initialized = false;
    let epoch = tray_state.runtime_epoch;
    drop(tray_state);
    refresh_tray(app);
    Ok(epoch)
}

pub fn update_model_download_status(app: &tauri::AppHandle, status: ModelDownloadStatus) {
    let state = app.state::<TrayMutex>();
    let Ok(mut tray_state) = state.lock() else {
        error!("Failed to lock tray state while updating model download status");
        return;
    };
    tray_state.model_download_status = status;
    drop(tray_state);
    refresh_tray(app);
}

fn create_mic_icon(size: u32, state: TrayVisualState) -> Vec<u8> {
    // The frontend legend and native tray use the same optical-size assets.
    // Status belongs to the badge; the microphone stays silver in every state.
    let icon_bytes = match state {
        TrayVisualState::NotReady => include_bytes!("../../public/tray/not-ready.png").as_slice(),
        TrayVisualState::Ready => include_bytes!("../../public/tray/ready.png").as_slice(),
        TrayVisualState::Recording => include_bytes!("../../public/tray/recording.png").as_slice(),
        TrayVisualState::Processing => {
            include_bytes!("../../public/tray/processing.png").as_slice()
        }
    };

    let fitted = image::load_from_memory_with_format(icon_bytes, image::ImageFormat::Png)
        .expect("generated tray icon should decode")
        .resize(size, size, image::imageops::FilterType::Lanczos3)
        .to_rgba8();
    let mut canvas = image::RgbaImage::new(size, size);
    image::imageops::overlay(
        &mut canvas,
        &fitted,
        i64::from((size - fitted.width()) / 2),
        i64::from((size - fitted.height()) / 2),
    );
    canvas.into_raw()
}

/// Only presentation state crosses the panel bus: never transcript or audio.
#[cfg(target_os = "linux")]
pub fn panel_snapshot(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    let state = app.try_state::<TrayMutex>()?;
    let state = state.lock().ok()?;
    let snapshot = runtime_snapshot_from_tray_state(&state);
    let mut presentation = panel_presentation(&snapshot);
    // X11 already consumes its chord. GNOME only needs this reservation for
    // the supported passive Wayland shortcuts, through final queue drain.
    presentation["stopAccelerator"] = serde_json::json!(if crate::is_wayland_session() {
        match crate::hotkey_to_evdev_mode(&state.current_hotkey) {
            0 => Some("<Alt>d"),
            1 => Some("<Alt><Shift>d"),
            _ => None,
        }
    } else {
        None
    });
    Some(presentation)
}

#[cfg(target_os = "linux")]
fn panel_presentation(snapshot: &RuntimeStatusSnapshot) -> serde_json::Value {
    let presentation = derive_tray_presentation(snapshot);
    let status = match snapshot.dictation_status {
        _ if !snapshot.runtime_initialized
            && snapshot.model_download_status != ModelDownloadStatus::Failed =>
        {
            "initializing"
        }
        DictationStatus::Starting => "starting",
        DictationStatus::Recording => "recording",
        DictationStatus::Processing => "processing",
        _ if snapshot.manual_transcript_ready
            || snapshot.recovery_available
            || snapshot.has_recoverable_transcript
            || snapshot.cursor_delivery == CursorDeliveryState::Unreconciled =>
        {
            "recovery"
        }
        _ if presentation.visual_state == TrayVisualState::NotReady => "attention",
        _ => "idle",
    };
    serde_json::json!({
        "version": 1, "status": status, "description": presentation.tooltip,
        "token": format!("{}:{}", snapshot.epoch, snapshot.revision),
        // Presentation revisions can change while a Stop chord is held.
        "stopSession": (snapshot.dictation_session_id > 0).then(||
            format!("{}:{}", snapshot.epoch, snapshot.dictation_session_id)),
        "canStop": matches!(snapshot.dictation_status, DictationStatus::Starting | DictationStatus::Recording),
        "canOpen": presentation.settings_enabled,
        "level": crate::panel::level(snapshot.epoch, snapshot.dictation_status),
    })
}

#[cfg(target_os = "linux")]
pub fn panel_visibility(app: &tauri::AppHandle, visible: bool) {
    if let Some(state) = app.try_state::<TrayMutex>() {
        if let Ok(mut state) = state.lock() {
            state.fallback_visible = visible;
            state.applied_meter = None;
            if let Some(tray) = app.tray_by_id(&state.tray_id) {
                let _ = tray.set_visible(visible);
            }
        }
    }
}

#[cfg(target_os = "linux")]
pub fn panel_action(app: &tauri::AppHandle, action: &str, token: &str) -> bool {
    let Some(snapshot) = panel_snapshot(app) else {
        return false;
    };
    if snapshot["token"].as_str() != Some(token) {
        return false;
    }
    match action {
        "stop" if snapshot["canStop"] == true => {
            // Explicit stop is rejected at idle by the renderer; never send a toggle
            // that could start a new recording after an asynchronous state change.
            app.emit_to(
                "main",
                "voco:toggle-dictation",
                serde_json::json!({"triggerId":"tray:stop", "action":"stop"}),
            )
            .is_ok()
        }
        "open" if snapshot["canOpen"] == true => {
            if snapshot["status"] == "recovery" {
                app.emit_to(
                    "main",
                    "voco:show-popover",
                    crate::TrayPopoverAnchor::default(),
                )
                .is_ok()
            } else {
                app.emit_to("main", "voco:open-settings", ()).is_ok()
            }
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_actions_never_open_a_window_during_capture() {
        let mut snapshot = ready_snapshot();
        snapshot.epoch = 4;
        snapshot.revision = 9;
        for status in [
            DictationStatus::Starting,
            DictationStatus::Recording,
            DictationStatus::Processing,
        ] {
            snapshot.dictation_status = status;
            let panel = panel_presentation(&snapshot);
            assert_eq!(panel["canOpen"], false);
            assert_eq!(panel["canStop"], status != DictationStatus::Processing);
            assert_eq!(panel["token"], "4:9");
        }
        snapshot.dictation_status = DictationStatus::Idle;
        snapshot.recovery_available = true;
        snapshot.native_microphone_ready = Some(false);
        let panel = panel_presentation(&snapshot);
        assert_eq!(panel["status"], "recovery");
        assert_eq!(panel["canOpen"], true);
        assert_eq!(panel["canStop"], false);
        assert_eq!(panel["level"], 0.0);
        let mut fields: Vec<_> = panel
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        fields.sort_unstable();
        assert_eq!(
            fields,
            [
                "canOpen",
                "canStop",
                "description",
                "level",
                "status",
                "stopSession",
                "token",
                "version"
            ]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_stop_identity_tracks_capture_not_presentation() {
        let mut snapshot = ready_snapshot();
        snapshot.epoch = 3;
        snapshot.revision = 7;
        snapshot.dictation_session_id = 1;
        snapshot.dictation_status = DictationStatus::Starting;
        let starting = panel_presentation(&snapshot);
        snapshot.revision += 1;
        snapshot.dictation_status = DictationStatus::Recording;
        let recording = panel_presentation(&snapshot);
        assert_ne!(starting["token"], recording["token"]);
        assert_eq!(starting["stopSession"], recording["stopSession"]);
        snapshot.dictation_session_id += 1;
        assert_ne!(
            recording["stopSession"],
            panel_presentation(&snapshot)["stopSession"]
        );
        snapshot.epoch += 1;
        assert_ne!(
            recording["stopSession"],
            panel_presentation(&snapshot)["stopSession"]
        );
        snapshot.dictation_session_id = 0;
        assert!(panel_presentation(&snapshot)["stopSession"].is_null());
    }

    #[test]
    fn tray_assets_are_square_and_keep_the_microphone_stable() {
        let states = [
            TrayVisualState::NotReady,
            TrayVisualState::Ready,
            TrayVisualState::Recording,
            TrayVisualState::Processing,
        ];
        for size in [16, 24, 32] {
            let icons: Vec<_> = states
                .iter()
                .map(|state| create_mic_icon(size, *state))
                .collect();
            for (index, pixels) in icons.iter().enumerate() {
                assert_eq!(pixels.len(), (size * size * 4) as usize);
                assert!(pixels.chunks_exact(4).any(|pixel| pixel[3] == 0));
                assert!(pixels.chunks_exact(4).any(|pixel| pixel[3] == 255));
                for prior in &icons[..index] {
                    assert_ne!(
                        pixels, prior,
                        "Every tray state must remain visually distinct"
                    );
                    assert!(
                        pixels
                            .chunks_exact(4)
                            .zip(prior.chunks_exact(4))
                            .any(|(pixel, other)| pixel[3] != other[3]),
                        "State outlines must differ independently of color"
                    );
                }
                // Lanczos resampling spreads the lower-right badge boundary.
                // Compare the upper microphone, safely outside that filter support.
                assert_eq!(
                    &pixels[..(size * (size * 2 / 5) * 4) as usize],
                    &icons[0][..(size * (size * 2 / 5) * 4) as usize]
                );
            }
        }
    }

    fn ready_snapshot() -> RuntimeStatusSnapshot {
        RuntimeStatusSnapshot {
            microphone_ready: true,
            microphone_permission: MicrophonePermission::Granted,
            cursor_setup_state: "ready".to_string(),
            manual_transcript_ready: false,
            model_download_status: ModelDownloadStatus::Ready,
            runtime_initialized: true,
            ..RuntimeStatusSnapshot::default()
        }
    }

    #[test]
    fn ready_state_exposes_both_start_actions() {
        let presentation = derive_tray_presentation(&ready_snapshot());
        assert_eq!(presentation.visual_state, TrayVisualState::Ready);
        assert_eq!(presentation.tooltip, "VOCO — Ready to listen");
        assert_eq!(presentation.dictation_label, "Start Dictation");
        assert!(presentation.dictation_enabled);
        assert!(presentation.popover_enabled);
        assert!(presentation.settings_enabled);
        assert!(presentation.hotkey_menu_enabled);
    }

    #[test]
    fn fallback_labels_match_capture_state_and_stop_is_never_toggle() {
        let mut snapshot = ready_snapshot();
        assert_eq!(derive_tray_presentation(&snapshot).title, "Ready");
        for (status, title) in [
            (DictationStatus::Starting, "Starting"),
            (DictationStatus::Recording, ""),
            (DictationStatus::Processing, "Finishing"),
        ] {
            snapshot.dictation_status = status;
            let presentation = derive_tray_presentation(&snapshot);
            assert_eq!(presentation.title, title);
            assert_eq!(
                presentation.dictation_action,
                if status == DictationStatus::Processing {
                    TrayDictationAction::Ignore
                } else {
                    TrayDictationAction::Stop
                }
            );
        }
        snapshot.dictation_status = DictationStatus::Idle;
        snapshot.runtime_initialized = false;
        snapshot.model_download_status = ModelDownloadStatus::Failed;
        assert_eq!(derive_tray_presentation(&snapshot).title, "Check setup");
    }

    #[test]
    fn pending_manual_transcript_offers_review_without_starting_capture() {
        let mut snapshot = ready_snapshot();
        snapshot.manual_transcript_ready = true;
        for status in [DictationStatus::Idle, DictationStatus::Error] {
            snapshot.dictation_status = status;
            for unavailable in [false, true] {
                snapshot.configuration_error = unavailable;
                snapshot.native_microphone_ready = Some(!unavailable);
                snapshot.microphone_permission = if unavailable {
                    MicrophonePermission::Denied
                } else {
                    MicrophonePermission::Granted
                };
                let presentation = derive_tray_presentation(&snapshot);
                assert_eq!(presentation.dictation_label, "Review Transcript");
                assert_eq!(
                    presentation.dictation_action,
                    TrayDictationAction::ReviewRecovery
                );
                assert!(presentation.dictation_enabled);
                assert!(presentation.popover_enabled);
            }
        }
        snapshot.manual_transcript_ready = false;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Ignore
        );
        snapshot = ready_snapshot();
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Toggle
        );
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_label,
            "Start Dictation"
        );
    }

    #[test]
    fn pending_transcript_does_not_override_active_or_uninitialized_tray_actions() {
        let mut snapshot = ready_snapshot();
        snapshot.manual_transcript_ready = true;
        snapshot.dictation_status = DictationStatus::Recording;
        let recording = derive_tray_presentation(&snapshot);
        assert_eq!(recording.dictation_label, "Stop Dictation");
        assert_eq!(recording.dictation_action, TrayDictationAction::Stop);
        snapshot.dictation_status = DictationStatus::Processing;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Ignore
        );
        snapshot.dictation_status = DictationStatus::Idle;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::ReviewRecovery
        );
        snapshot.runtime_initialized = false;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Ignore
        );
    }

    #[test]
    fn retained_audio_offers_review_even_without_microphone_or_valid_settings() {
        let mut snapshot = ready_snapshot();
        snapshot.recovery_available = true;
        snapshot.configuration_error = true;
        snapshot.native_microphone_ready = Some(false);
        snapshot.microphone_permission = MicrophonePermission::Denied;
        for status in [DictationStatus::Idle, DictationStatus::Error] {
            snapshot.dictation_status = status;
            let presentation = derive_tray_presentation(&snapshot);
            assert_eq!(presentation.dictation_label, "Review Recording");
            assert_eq!(presentation.tooltip, "VOCO — Dictation saved");
            assert_eq!(
                presentation.dictation_action,
                TrayDictationAction::ReviewRecovery
            );
            assert!(presentation.popover_enabled);
            assert!(presentation.dictation_enabled);
        }
        snapshot.recovery_available = false;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Ignore
        );
    }

    #[test]
    fn startup_reserves_dictation_and_allows_queued_stop() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Starting;
        let presentation = derive_tray_presentation(&snapshot);
        assert_eq!(presentation.tooltip, "VOCO — Starting microphone");
        assert_eq!(presentation.visual_state, TrayVisualState::Processing);
        assert_eq!(presentation.dictation_label, "Stop after microphone starts");
        assert!(presentation.dictation_enabled);
        assert!(!presentation.popover_enabled);
        assert!(!presentation.settings_enabled);
        assert!(!presentation.hotkey_menu_enabled);
        assert_eq!(
            derive_tray_left_click_action(&snapshot),
            TrayLeftClickAction::StopDictation
        );
    }

    #[test]
    fn pending_recovery_survives_new_sessions_and_clears_on_explicit_dismissal() {
        let mut snapshot = ready_snapshot();
        snapshot.has_recoverable_transcript = true;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::NotReady
        );
        assert_eq!(
            derive_tray_presentation(&snapshot).tooltip,
            "VOCO — Transcript needs attention"
        );
        snapshot.dictation_status = DictationStatus::Recording;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::Recording
        );
        snapshot.dictation_status = DictationStatus::Idle;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::NotReady
        );
        snapshot.has_recoverable_transcript = false;
        snapshot.cursor_delivery = CursorDeliveryState::Inactive;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::Ready
        );
    }

    #[test]
    fn recording_distinguishes_owned_cursor_from_preview_fallback() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Recording;
        snapshot.cursor_required = true;
        snapshot.cursor_delivery = CursorDeliveryState::Owned;
        let owned = derive_tray_presentation(&snapshot);
        assert_eq!(owned.tooltip, "VOCO — Listening · target verified");
        assert_eq!(owned.dictation_label, "Stop Dictation");
        assert!(!owned.popover_enabled);
        assert!(!owned.settings_enabled);
        assert!(!owned.hotkey_menu_enabled);

        snapshot.cursor_delivery = CursorDeliveryState::PreviewOnly;
        let preview = derive_tray_presentation(&snapshot);
        assert_eq!(preview.tooltip, "VOCO — Listening · manual copy");

        snapshot.cursor_delivery = CursorDeliveryState::Pending;
        let pending = derive_tray_presentation(&snapshot);
        assert_eq!(pending.tooltip, "VOCO — Listening · preparing target");
    }

    #[test]
    fn recording_without_required_cursor_uses_generic_listening_state() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Recording;
        snapshot.cursor_delivery = CursorDeliveryState::Inactive;

        let presentation = derive_tray_presentation(&snapshot);

        assert_eq!(presentation.tooltip, "VOCO — Listening");
        assert_eq!(presentation.dictation_label, "Stop Dictation");
        assert!(!presentation.hotkey_menu_enabled);

        snapshot.cursor_required = true;
        assert_eq!(
            derive_tray_presentation(&snapshot).tooltip,
            "VOCO — Listening"
        );
    }

    #[test]
    fn processing_disables_conflicting_actions() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Processing;
        let presentation = derive_tray_presentation(&snapshot);
        assert_eq!(presentation.visual_state, TrayVisualState::Processing);
        assert_eq!(presentation.dictation_label, "Transcribing…");
        assert!(!presentation.dictation_enabled);
        assert!(!presentation.popover_enabled);
        assert!(!presentation.settings_enabled);
        assert!(!presentation.hotkey_menu_enabled);
    }

    #[test]
    fn hotkey_preset_checkmarks_match_valid_aliases() {
        assert!(hotkeys_equivalent("Alt+D", "alt + d"));
        assert!(hotkeys_equivalent("Alt+Shift+D", "SHIFT+ALT+KEYD"));
        assert!(!hotkeys_equivalent("Alt+D", "Alt+Shift+D"));
        assert!(!hotkeys_equivalent("Alt+D", "not a shortcut"));
    }

    #[test]
    fn cursor_setup_and_unreconciled_transcript_are_visible_at_idle() {
        let mut snapshot = ready_snapshot();
        snapshot.cursor_required = true;
        snapshot.cursor_setup_state = "incompatible".to_string();
        let setup = derive_tray_presentation(&snapshot);
        assert_eq!(setup.visual_state, TrayVisualState::NotReady);
        assert!(setup.tooltip.contains("Text delivery needs setup"));

        snapshot.cursor_delivery = CursorDeliveryState::Unreconciled;
        snapshot.has_recoverable_transcript = true;
        let unreconciled = derive_tray_presentation(&snapshot);
        assert_eq!(unreconciled.visual_state, TrayVisualState::NotReady);
        assert_eq!(unreconciled.tooltip, "VOCO — Transcript needs attention");
    }

    #[test]
    fn unchecked_microphone_is_a_first_use_check_not_a_failure() {
        let mut snapshot = ready_snapshot();
        snapshot.microphone_ready = false;

        let presentation = derive_tray_presentation(&snapshot);

        assert_eq!(presentation.visual_state, TrayVisualState::Ready);
        assert_eq!(
            presentation.tooltip,
            "VOCO — Ready · microphone checks on first use"
        );
    }

    #[test]
    fn denied_microphone_permission_is_not_presented_as_ready() {
        let mut snapshot = ready_snapshot();
        snapshot.microphone_ready = false;
        snapshot.microphone_permission = MicrophonePermission::Denied;
        snapshot.cursor_required = true;
        snapshot.cursor_setup_state = "not-enabled".to_string();

        let presentation = derive_tray_presentation(&snapshot);

        assert_eq!(presentation.visual_state, TrayVisualState::NotReady);
        assert_eq!(presentation.tooltip, "VOCO — Microphone needs permission");
        assert!(!presentation.dictation_enabled);
        assert!(presentation.popover_enabled);
        assert!(presentation.settings_enabled);
    }

    #[test]
    fn native_dictation_readiness_is_separate_from_browser_permission() {
        let mut snapshot = ready_snapshot();
        snapshot.microphone_permission = MicrophonePermission::Denied;
        snapshot.native_microphone_ready = Some(true);
        let ready = derive_tray_presentation(&snapshot);
        assert!(ready.dictation_enabled);
        assert_eq!(ready.tooltip, "VOCO — Ready to listen");
        snapshot.native_microphone_ready = Some(false);
        let unselected = derive_tray_presentation(&snapshot);
        assert!(!unselected.dictation_enabled);
        assert_eq!(unselected.tooltip, "VOCO — Microphone setup required");
        snapshot.dictation_status = DictationStatus::Recording;
        assert!(derive_tray_presentation(&snapshot).dictation_enabled);
    }

    #[test]
    fn runtime_snapshot_deserializes_frontend_permission_state() {
        let snapshot: RuntimeStatusSnapshot = serde_json::from_value(serde_json::json!({
            "epoch": 8,
            "revision": 13,
            "runtimeInitialized": true,
            "configurationError": false,
            "microphoneReady": false,
            "microphonePermission": "denied",
            "dictationStatus": "idle",
            "cursorDelivery": "inactive",
            "cursorRequired": false,
            "cursorSetupState": "ready",
            "manualTranscriptReady": false
        }))
        .expect("frontend runtime snapshot should deserialize");

        assert!(snapshot.runtime_initialized);
        assert_eq!(snapshot.microphone_permission, MicrophonePermission::Denied);
        assert!(!snapshot.recovery_available);
        let recovery: RuntimeStatusSnapshot = serde_json::from_value(serde_json::json!({
            "epoch": 8, "revision": 14, "runtimeInitialized": true,
            "configurationError": false, "microphoneReady": false,
            "microphonePermission": "denied", "dictationStatus": "error",
            "cursorDelivery": "inactive", "cursorRequired": false,
            "cursorSetupState": "ready", "manualTranscriptReady": false,
            "recoveryAvailable": true
        }))
        .expect("retained recovery status should deserialize");
        assert!(recovery.recovery_available);
        assert_eq!(
            derive_tray_presentation(&recovery).dictation_action,
            TrayDictationAction::ReviewRecovery
        );
    }

    #[test]
    fn stale_or_foreign_runtime_status_snapshots_are_rejected() {
        let active_epoch = 4;
        let mut current = 8;
        assert!(!accept_runtime_snapshot(active_epoch, &mut current, 3, 99));
        assert!(!accept_runtime_snapshot(active_epoch, &mut current, 4, 7));
        assert_eq!(current, 8);
        assert!(!accept_runtime_snapshot(active_epoch, &mut current, 4, 8));
        assert!(!accept_runtime_snapshot(active_epoch, &mut current, 4, 0));
        assert!(accept_runtime_snapshot(active_epoch, &mut current, 4, 9));
        assert_eq!(current, 9);
    }

    #[test]
    fn initializing_and_model_warmup_states_are_authoritative() {
        let initializing = derive_tray_presentation(&RuntimeStatusSnapshot::default());
        assert_eq!(initializing.visual_state, TrayVisualState::NotReady);
        assert_eq!(initializing.tooltip, "VOCO — Initializing…");
        assert!(!initializing.dictation_enabled);
        assert!(!initializing.popover_enabled);
        assert!(!initializing.settings_enabled);

        let mut warming = ready_snapshot();
        warming.model_download_status = ModelDownloadStatus::Checking;
        let progress = derive_tray_presentation(&warming);
        assert_eq!(progress.visual_state, TrayVisualState::Processing);
        assert_eq!(progress.tooltip, "VOCO — Checking speech model…");
        assert!(progress.dictation_enabled);

        warming.model_download_status = ModelDownloadStatus::Failed;
        let failed = derive_tray_presentation(&warming);
        assert_eq!(failed.visual_state, TrayVisualState::NotReady);
        assert_eq!(failed.tooltip, "VOCO — Speech model needs attention");
        assert!(failed.dictation_enabled);
    }

    #[test]
    fn configuration_failures_are_visible_at_idle() {
        let mut snapshot = ready_snapshot();
        snapshot.configuration_error = true;
        snapshot.has_recoverable_transcript = true;
        let presentation = derive_tray_presentation(&snapshot);
        assert_eq!(presentation.visual_state, TrayVisualState::NotReady);
        assert_eq!(presentation.tooltip, "VOCO — Settings need attention");
        assert!(!presentation.dictation_enabled);
        assert!(!presentation.popover_enabled);
        assert!(presentation.settings_enabled);
        assert!(!presentation.hotkey_menu_enabled);

        snapshot.dictation_status = DictationStatus::Error;
        let from_startup_failure = derive_tray_presentation(&snapshot);
        assert_eq!(
            from_startup_failure.tooltip,
            "VOCO — Settings need attention"
        );
    }

    #[test]
    fn left_click_uses_the_same_safe_popover_gate() {
        let initializing = RuntimeStatusSnapshot::default();
        assert_eq!(
            derive_tray_left_click_action(&initializing),
            TrayLeftClickAction::Ignore
        );

        let mut config_error = ready_snapshot();
        config_error.configuration_error = true;
        assert_eq!(
            derive_tray_left_click_action(&config_error),
            TrayLeftClickAction::Ignore
        );

        config_error.recovery_available = true;
        assert_eq!(
            derive_tray_left_click_action(&config_error),
            TrayLeftClickAction::ShowPopover
        );

        let mut recording = ready_snapshot();
        recording.dictation_status = DictationStatus::Recording;
        assert_eq!(
            derive_tray_left_click_action(&recording),
            TrayLeftClickAction::StopDictation
        );

        let mut processing = ready_snapshot();
        processing.dictation_status = DictationStatus::Processing;
        assert_eq!(
            derive_tray_left_click_action(&processing),
            TrayLeftClickAction::Ignore
        );
    }
}
