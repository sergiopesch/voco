use log::{debug, error};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
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
    pub review_item: MenuItem<tauri::Wry>,
    pub hotkey_menu: Submenu<tauri::Wry>,
    pub current_hotkey: String,
    pub hotkey_items: Vec<(String, MenuItem<tauri::Wry>)>,
    pub runtime: RuntimeStatusSnapshot,
    icons: crate::tray_icons::TrayIcons,
    applied_presentation: Option<TrayPresentation>,
    applied_visual: Option<TrayVisualState>,
    meter_timer: Option<glib::SourceId>,
    meter: crate::tray_icons::MeterEnvelope,
    applied_meter: Option<usize>,
    // Tracks recording boundaries apart from the timer, which also stops while
    // the companion hides the fallback tray.
    meter_recording: bool,
    fallback_visible: bool,
}

pub type TrayMutex = Mutex<TrayState>;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DictationStatus {
    #[default]
    Idle,
    Starting,
    Recording,
    Processing,
    Error,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CursorDeliveryState {
    #[default]
    Inactive,
    Owned,
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

/// The renderer's runtime status as the tray last accepted it; the default is
/// the launch state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
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
    pub cursor_delivery: CursorDeliveryState,
    pub cursor_required: bool,
    pub cursor_setup_state: String,
    // Rust's startup thread owns model readiness. A renderer snapshot always
    // arrives as Checking, so both runtime transitions keep this field.
    #[serde(skip)]
    model_download_status: ModelDownloadStatus,
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
    status_text: &'static str,
    title: &'static str,
    stop_label: &'static str,
    dictation_action: TrayDictationAction,
    popover_enabled: bool,
    settings_enabled: bool,
    hotkey_menu_enabled: bool,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TrayDictationAction {
    Toggle,
    Stop,
    Ignore,
}

fn dictation_is_active(status: DictationStatus) -> bool {
    matches!(
        status,
        DictationStatus::Starting | DictationStatus::Recording | DictationStatus::Processing
    )
}

/// Desktop-input diagnostics arrive after the runtime initializes. Until then an
/// empty setup state is unknown, not missing setup, so the launch presentation
/// holds instead of flashing a setup warning. It never gates Start.
fn desktop_setup_pending(snapshot: &RuntimeStatusSnapshot) -> bool {
    snapshot.runtime_initialized
        && snapshot.dictation_status == DictationStatus::Idle
        && snapshot.cursor_required
        && snapshot.cursor_setup_state.is_empty()
}

fn derive_tray_presentation(snapshot: &RuntimeStatusSnapshot) -> TrayPresentation {
    let dictation_active = dictation_is_active(snapshot.dictation_status);
    let (visual_state, status_text) = if !snapshot.runtime_initialized {
        match snapshot.model_download_status {
            ModelDownloadStatus::Failed => (
                TrayVisualState::NotReady,
                "VOCO — Speech model needs attention",
            ),
            // Every launch passes through here: busy, not a warning.
            ModelDownloadStatus::Checking | ModelDownloadStatus::Ready => {
                (TrayVisualState::Processing, "VOCO — Initializing…")
            }
        }
    } else {
        match snapshot.dictation_status {
            DictationStatus::Starting => {
                (TrayVisualState::Processing, "VOCO — Starting microphone")
            }
            DictationStatus::Recording => {
                if snapshot.cursor_required
                    && snapshot.cursor_delivery == CursorDeliveryState::Owned
                {
                    (
                        TrayVisualState::Recording,
                        "VOCO — Listening · browser field",
                    )
                } else {
                    (TrayVisualState::Recording, "VOCO — Listening")
                }
            }
            DictationStatus::Processing => (TrayVisualState::Processing, "VOCO — Transcribing"),
            DictationStatus::Idle | DictationStatus::Error if snapshot.configuration_error => {
                (TrayVisualState::NotReady, "VOCO — Settings need attention")
            }
            DictationStatus::Error => (TrayVisualState::NotReady, "VOCO — Needs attention"),
            DictationStatus::Idle if snapshot.native_microphone_ready == Some(false) => (
                TrayVisualState::NotReady,
                "VOCO — Microphone setup required",
            ),
            DictationStatus::Idle
                if snapshot.native_microphone_ready.is_none()
                    && matches!(snapshot.microphone_permission, MicrophonePermission::Denied) =>
            {
                (
                    TrayVisualState::NotReady,
                    "VOCO — Microphone needs permission",
                )
            }
            DictationStatus::Idle if desktop_setup_pending(snapshot) => {
                (TrayVisualState::Processing, "VOCO — Initializing…")
            }
            DictationStatus::Idle
                if snapshot.cursor_required && snapshot.cursor_setup_state != "ready" =>
            {
                (TrayVisualState::NotReady, "VOCO — Desktop setup needed")
            }
            DictationStatus::Idle
                if matches!(snapshot.model_download_status, ModelDownloadStatus::Failed) =>
            {
                (
                    TrayVisualState::NotReady,
                    "VOCO — Speech model needs attention",
                )
            }
            DictationStatus::Idle
                if matches!(
                    snapshot.model_download_status,
                    ModelDownloadStatus::Checking
                ) =>
            {
                (TrayVisualState::Processing, "VOCO — Checking speech model…")
            }
            DictationStatus::Idle if !snapshot.microphone_ready => (
                TrayVisualState::Ready,
                "VOCO — Ready · microphone checks on first use",
            ),
            DictationStatus::Idle => (TrayVisualState::Ready, "VOCO — Ready to listen"),
        }
    };

    let runtime_ready = snapshot.runtime_initialized && !snapshot.configuration_error;
    let browser_allowed = !matches!(snapshot.microphone_permission, MicrophonePermission::Denied);
    let dictation_allowed =
        runtime_ready && snapshot.native_microphone_ready.unwrap_or(browser_allowed);

    let dictation_action = match snapshot.dictation_status {
        DictationStatus::Starting | DictationStatus::Recording => TrayDictationAction::Stop,
        // The status row reports transcription; Start keeps its name, disabled.
        DictationStatus::Processing => TrayDictationAction::Ignore,
        DictationStatus::Idle | DictationStatus::Error if dictation_allowed => {
            TrayDictationAction::Toggle
        }
        DictationStatus::Idle | DictationStatus::Error => TrayDictationAction::Ignore,
    };
    let stop_label = if snapshot.dictation_status == DictationStatus::Starting {
        "Stop after microphone starts"
    } else {
        "Stop dictation"
    };
    let popover_enabled =
        snapshot.runtime_initialized && !dictation_active && !snapshot.configuration_error;

    // Only states that need the user carry a label beside the icon. Ready and
    // dictating share the bare icon, so toggling never shifts the panel.
    let title = match snapshot.dictation_status {
        _ if !snapshot.runtime_initialized
            && snapshot.model_download_status == ModelDownloadStatus::Failed =>
        {
            "Check setup"
        }
        _ if !snapshot.runtime_initialized => "Starting VOCO",
        DictationStatus::Starting | DictationStatus::Recording | DictationStatus::Processing => "",
        _ if visual_state == TrayVisualState::NotReady => "Check setup",
        _ if desktop_setup_pending(snapshot)
            || snapshot.model_download_status != ModelDownloadStatus::Ready =>
        {
            "Starting VOCO"
        }
        _ => "",
    };
    TrayPresentation {
        visual_state,
        title,
        status_text,
        stop_label,
        dictation_action,
        popover_enabled,
        settings_enabled: (snapshot.runtime_initialized || snapshot.configuration_error)
            && !dictation_active,
        hotkey_menu_enabled: snapshot.runtime_initialized
            && !snapshot.configuration_error
            && !dictation_active,
    }
}

fn tray_state_label(state: TrayVisualState) -> &'static str {
    match state {
        TrayVisualState::NotReady => "not-ready",
        TrayVisualState::Ready => "ready",
        TrayVisualState::Recording => "recording",
        TrayVisualState::Processing => "processing",
    }
}

fn current_tray_presentation(app: &tauri::AppHandle) -> Option<TrayPresentation> {
    let state = app.state::<TrayMutex>();
    state
        .lock()
        .ok()
        .map(|state| derive_tray_presentation(&state.runtime))
}

pub fn setup_tray(
    app: &tauri::App,
    hotkey_label: &str,
    icons: crate::tray_icons::TrayIcons,
) -> Result<(), Box<dyn std::error::Error>> {
    let status_item = MenuItemBuilder::with_id("status", "VOCO — Initializing…")
        .enabled(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit VOCO").build(app)?;
    let open_panel = MenuItemBuilder::with_id("open_panel", "Open VOCO").build(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Start dictation").build(app)?;
    let stop = MenuItemBuilder::with_id("stop", "Stop dictation")
        .enabled(false)
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let review = MenuItemBuilder::with_id("review", "Review").build(app)?;

    // Build hotkey submenu with presets
    let mut hotkey_submenu = SubmenuBuilder::with_id(app, "hotkey_menu", "Change shortcut");
    let mut hotkey_items: Vec<(String, MenuItem<tauri::Wry>)> = Vec::new();

    // apply_tray_state marks the configured preset before the menu can show.
    for &preset in HOTKEY_PRESETS {
        let item = MenuItemBuilder::with_id(format!("hotkey:{preset}"), preset).build(app)?;
        hotkey_submenu = hotkey_submenu.item(&item);
        hotkey_items.push((preset.to_string(), item));
    }

    hotkey_submenu = hotkey_submenu.separator();
    let edit_config = MenuItemBuilder::with_id("edit_config", "Custom shortcut…").build(app)?;
    hotkey_submenu = hotkey_submenu.item(&edit_config);

    let hotkey_menu = hotkey_submenu.build()?;

    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .item(&open_panel)
        .item(&toggle)
        .item(&stop)
        .item(&settings)
        .item(&review)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&hotkey_menu)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?;

    let startup = crate::tray_icons::startup_icon()?;
    let (width, height) = startup.dimensions();
    let icon = tauri::image::Image::new_owned(startup.into_raw(), width, height);

    let tray = TrayIconBuilder::new()
        .temp_dir_path(icons.directory())
        .title("Starting VOCO")
        .icon(icon)
        .menu(&menu)
        // Linux's AppIndicator backend reports no icon clicks and shows no tooltip,
        // so the menu holds every fallback tray action and the status line.
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => return app.exit(0),
                "stop" => return request_stop(app),
                _ => {}
            }
            // Every other item follows the presentation the menu shows now, read
            // without holding the tray lock: a preset change refreshes the tray inline.
            let Some(presentation) = current_tray_presentation(app) else {
                return;
            };
            match id {
                "open_panel" if presentation.popover_enabled => {
                    let _ = app.emit_to(
                        "main",
                        "voco:show-popover",
                        crate::TrayPopoverAnchor::default(),
                    );
                }
                "toggle" if presentation.dictation_action == TrayDictationAction::Toggle => {
                    crate::eval_toggle(app)
                }
                "settings" if presentation.settings_enabled => {
                    let _ = app.emit_to("main", "voco:open-settings", ());
                }
                "review" if presentation.settings_enabled => {
                    let _ = app.emit_to("main", "voco:open-review", ());
                }
                "edit_config" if presentation.hotkey_menu_enabled => {
                    let _ = app.emit_to("main", "voco:open-hotkey-settings", ());
                }
                id if id.starts_with("hotkey:") && presentation.hotkey_menu_enabled => {
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
        review_item: review,
        hotkey_menu,
        current_hotkey: hotkey_label.to_string(),
        hotkey_items,
        runtime: RuntimeStatusSnapshot::default(),
        icons,
        applied_presentation: None,
        applied_visual: None,
        meter_timer: None,
        meter: crate::tray_icons::MeterEnvelope::default(),
        applied_meter: None,
        meter_recording: false,
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

    if !apply_runtime_snapshot(&mut tray_state.runtime, snapshot) {
        return;
    }
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
    // HOTKEY_PRESETS lists the presets in evdev mode order.
    let configured = crate::hotkey_to_evdev_mode(&tray_state.current_hotkey);
    for (mode, (preset, item)) in (0u8..).zip(&tray_state.hotkey_items) {
        let mark = if mode == configured { '✓' } else { ' ' };
        let _ = item.set_text(format!("{mark} {preset}"));
    }
    let presentation = derive_tray_presentation(&tray_state.runtime);
    // Even equivalent presentation updates carry a new action token to Shell.
    #[cfg(target_os = "linux")]
    crate::panel::publish();
    if tray_state.applied_presentation.as_ref() == Some(&presentation) {
        return;
    }
    let state = presentation.visual_state;

    if let Some(tray) = app.tray_by_id(&tray_state.tray_id) {
        if tray_state.applied_visual != Some(state) {
            // Listening shows the meter, from silence until its first tick.
            let path = match state {
                TrayVisualState::Recording => tray_state.icons.meter_path(0),
                TrayVisualState::NotReady
                | TrayVisualState::Ready
                | TrayVisualState::Processing => tray_state.icons.path(tray_state_label(state)),
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
        crate::trace_hotkey_event("tray_status_updated", None);
        debug!(
            "Tray update -> state={}, recording={}, microphone_ready={}, status='{}'",
            tray_state_label(state),
            tray_state.runtime.dictation_status == DictationStatus::Recording,
            tray_state.runtime.microphone_ready,
            presentation.status_text
        );
    }

    let _ = tray_state.status_item.set_text(presentation.status_text);
    let _ = tray_state
        .toggle_item
        .set_enabled(presentation.dictation_action == TrayDictationAction::Toggle);
    let _ = tray_state.stop_item.set_text(presentation.stop_label);
    let _ = tray_state
        .stop_item
        .set_enabled(presentation.dictation_action == TrayDictationAction::Stop);
    let _ = tray_state
        .open_panel_item
        .set_enabled(presentation.popover_enabled);
    let _ = tray_state
        .settings_item
        .set_enabled(presentation.settings_enabled);
    let _ = tray_state
        .review_item
        .set_enabled(presentation.settings_enabled);
    let _ = tray_state
        .hotkey_menu
        .set_enabled(presentation.hotkey_menu_enabled);
    tray_state.applied_presentation = Some(presentation);
}

/// Every frame is a StatusNotifier icon swap that the panel host reloads from
/// disk. About eleven a second keeps speech legible without flooding it.
const METER_TICK: std::time::Duration = std::time::Duration::from_millis(90);

/// Only a visible fallback tray draws levels; the GNOME companion polls them itself.
fn meter_timer_wanted(status: DictationStatus, fallback_visible: bool) -> bool {
    status == DictationStatus::Recording && fallback_visible
}

/// Skip one-frame jitter, but always land exactly on silence and full scale.
fn meter_swap(applied: Option<usize>, frame: usize) -> bool {
    let top = crate::tray_icons::METER_FRAMES - 1;
    applied.is_none_or(|applied| {
        applied != frame && (applied.abs_diff(frame) >= 2 || frame == 0 || frame == top)
    })
}

fn sync_meter_timer(app: &tauri::AppHandle, state: &mut TrayState) {
    let recording = state.runtime.dictation_status == DictationStatus::Recording;
    if state.meter_recording != recording {
        // Levels belong to one recording, whichever meter shows them.
        state.meter_recording = recording;
        crate::panel::reset_level();
        state.meter = crate::tray_icons::MeterEnvelope::default();
    }
    if !meter_timer_wanted(state.runtime.dictation_status, state.fallback_visible) {
        if let Some(timer) = state.meter_timer.take() {
            timer.remove();
        }
        state.applied_meter = None;
        return;
    }
    if state.meter_timer.is_some() {
        return;
    }
    state.applied_meter = None;
    let app = app.clone();
    let mut previous = std::time::Instant::now();
    state.meter_timer = Some(glib::timeout_add(METER_TICK, move || {
        // Only the stored SourceId removes this source; returning Break would
        // make that later removal panic.
        let managed = app.state::<TrayMutex>();
        let Ok(mut state) = managed.try_lock() else {
            return glib::ControlFlow::Continue;
        };
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(previous).as_secs_f64();
        previous = now;
        if !meter_timer_wanted(state.runtime.dictation_status, state.fallback_visible) {
            return glib::ControlFlow::Continue;
        }
        let level = crate::panel::level(state.runtime.epoch, state.runtime.dictation_status);
        let frame = state.meter.step(level, elapsed, meter_animations_enabled());
        if !meter_swap(state.applied_meter, frame) {
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
    }));
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

/// Accept the renderer's next snapshot for the current epoch.
fn apply_runtime_snapshot(
    current: &mut RuntimeStatusSnapshot,
    incoming: RuntimeStatusSnapshot,
) -> bool {
    if !accept_runtime_snapshot(
        current.epoch,
        &mut current.revision,
        incoming.epoch,
        incoming.revision,
    ) {
        return false;
    }
    *current = RuntimeStatusSnapshot {
        model_download_status: current.model_download_status,
        ..incoming
    };
    true
}

/// A renderer load starts the next epoch from the launch state.
fn begin_runtime_session(current: &mut RuntimeStatusSnapshot) -> u64 {
    *current = RuntimeStatusSnapshot {
        epoch: current.epoch.saturating_add(1),
        model_download_status: current.model_download_status,
        ..RuntimeStatusSnapshot::default()
    };
    current.epoch
}

pub fn begin_runtime_status_session(app: &tauri::AppHandle) -> Result<u64, String> {
    let state = app.state::<TrayMutex>();
    let mut tray_state = state
        .lock()
        .map_err(|_| "Failed to lock tray state".to_string())?;
    let epoch = begin_runtime_session(&mut tray_state.runtime);
    // A shortcut lease proven for the previous renderer never carries over.
    #[cfg(target_os = "linux")]
    crate::panel::clear_shortcut();
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
    tray_state.runtime.model_download_status = status;
    drop(tray_state);
    refresh_tray(app);
}

/// Only presentation state crosses the panel bus: never transcript or audio.
#[cfg(target_os = "linux")]
pub fn panel_snapshot(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    let state = app.try_state::<TrayMutex>()?;
    let state = state.lock().ok()?;
    let mut presentation = panel_presentation(&state.runtime);
    let accelerator = panel_accelerator(crate::is_wayland_session(), &state.current_hotkey);
    // The companion grabs shortcutAccelerator whenever attached; an older companion still
    // loaded in the Shell reads only the Stop fields until the session restarts.
    presentation["shortcutAccelerator"] = serde_json::json!(accelerator);
    presentation["stopAccelerator"] = serde_json::json!(accelerator);
    presentation["stopShortcutToken"] =
        serde_json::json!(crate::panel::stop_shortcut_token(&presentation));
    Some(presentation)
}

/// X11 already consumes its chord. GNOME only grabs the chords that passive
/// Wayland evdev also observes, so the focused application never receives them.
#[cfg(target_os = "linux")]
fn panel_accelerator(wayland: bool, hotkey: &str) -> Option<&'static str> {
    if !wayland {
        return None;
    }
    match crate::hotkey_to_evdev_mode(hotkey) {
        0 => Some("<Alt>d"),
        1 => Some("<Alt><Shift>d"),
        _ => None,
    }
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
        _ if presentation.visual_state == TrayVisualState::NotReady => "attention",
        // The same waits the fallback tray labels Starting VOCO: an idle pill
        // reads as ready, and the speech model may still be warming.
        _ if desktop_setup_pending(snapshot)
            || snapshot.model_download_status != ModelDownloadStatus::Ready =>
        {
            "initializing"
        }
        _ => "idle",
    };
    serde_json::json!({
        "version": 1, "status": status, "description": presentation.status_text,
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
            sync_meter_timer(app, &mut state);
            if let Some(tray) = app.tray_by_id(&state.tray_id) {
                let _ = tray.set_visible(visible);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn valid_panel_action(snapshot: &serde_json::Value, action: &str, token: &str) -> bool {
    !token.is_empty()
        && match action {
            "stop" => {
                snapshot["canStop"] == true && snapshot["stopSession"].as_str() == Some(token)
            }
            "open" | "settings" | "review" => {
                snapshot["canOpen"] == true && snapshot["token"].as_str() == Some(token)
            }
            _ => false,
        }
}

#[cfg(target_os = "linux")]
pub fn panel_action(app: &tauri::AppHandle, action: &str, token: &str) -> bool {
    let Some(snapshot) = panel_snapshot(app) else {
        return false;
    };
    if !valid_panel_action(&snapshot, action, token) {
        return false;
    }
    match action {
        "stop" => {
            // Explicit stop is rejected at idle by the renderer; never send a toggle
            // that could start a new recording after an asynchronous state change.
            app.emit_to(
                "main",
                "voco:toggle-dictation",
                serde_json::json!({"triggerId":"tray:stop", "action":"stop", "stopSession":token}),
            )
            .is_ok()
        }
        "open" | "settings" => app.emit_to("main", "voco:open-settings", ()).is_ok(),
        "review" => app.emit_to("main", "voco:open-review", ()).is_ok(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_stop_uses_capture_identity_while_open_uses_presentation_revision() {
        let mut state = serde_json::json!({"token":"4:9", "stopSession":"4:2", "canStop":true, "canOpen":false});
        assert!(valid_panel_action(&state, "stop", "4:2"));
        state["token"] = "4:10".into();
        assert!(valid_panel_action(&state, "stop", "4:2"));
        for token in ["", "4:1", "3:2", "4:9"] {
            assert!(!valid_panel_action(&state, "stop", token));
        }
        state["canStop"] = false.into();
        assert!(!valid_panel_action(&state, "stop", "4:2"));
        state["canOpen"] = true.into();
        assert!(valid_panel_action(&state, "open", "4:10"));
        assert!(!valid_panel_action(&state, "open", "4:9"));
        for action in ["settings", "review"] {
            assert!(valid_panel_action(&state, action, "4:10"));
            assert!(!valid_panel_action(&state, action, "4:9"));
            state["canOpen"] = false.into();
            assert!(!valid_panel_action(&state, action, "4:10"));
            state["canOpen"] = true.into();
        }
    }

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
        snapshot.native_microphone_ready = Some(false);
        let panel = panel_presentation(&snapshot);
        assert_eq!(panel["status"], "attention");
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

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_grabs_only_the_passive_wayland_chords() {
        for (hotkey, accelerator) in [
            ("Alt+D", Some("<Alt>d")),
            ("alt + d", Some("<Alt>d")),
            ("Alt+Shift+D", Some("<Alt><Shift>d")),
            ("SHIFT+ALT+KEYD", Some("<Alt><Shift>d")),
            ("Ctrl+Shift+V", None),
            ("Control+Space", None),
        ] {
            assert_eq!(panel_accelerator(true, hotkey), accelerator, "{hotkey}");
            assert_eq!(panel_accelerator(false, hotkey), None, "{hotkey}");
        }
    }

    fn ready_snapshot() -> RuntimeStatusSnapshot {
        RuntimeStatusSnapshot {
            microphone_ready: true,
            microphone_permission: MicrophonePermission::Granted,
            cursor_setup_state: "ready".to_string(),
            model_download_status: ModelDownloadStatus::Ready,
            runtime_initialized: true,
            ..RuntimeStatusSnapshot::default()
        }
    }

    #[test]
    fn ready_state_exposes_both_start_actions() {
        let presentation = derive_tray_presentation(&ready_snapshot());
        assert_eq!(presentation.visual_state, TrayVisualState::Ready);
        assert_eq!(presentation.status_text, "VOCO — Ready to listen");
        assert_eq!(presentation.dictation_action, TrayDictationAction::Toggle);
        assert!(presentation.popover_enabled);
        assert!(presentation.settings_enabled);
        assert!(presentation.hotkey_menu_enabled);
    }

    #[test]
    fn fallback_labels_match_capture_state_and_stop_is_never_toggle() {
        let mut snapshot = ready_snapshot();
        // Ready has no label, so starting or stopping never resizes the icon.
        assert_eq!(derive_tray_presentation(&snapshot).title, "");
        for (status, title) in [
            (DictationStatus::Starting, ""),
            (DictationStatus::Recording, ""),
            (DictationStatus::Processing, ""),
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
    fn start_follows_settings_and_microphone_at_idle_and_error() {
        let mut snapshot = ready_snapshot();
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
                assert_eq!(
                    presentation.dictation_action,
                    if unavailable {
                        TrayDictationAction::Ignore
                    } else {
                        TrayDictationAction::Toggle
                    }
                );
                assert_eq!(presentation.popover_enabled, !unavailable);
                assert!(presentation.settings_enabled);
            }
        }
        snapshot = ready_snapshot();
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Toggle
        );
    }

    #[test]
    fn dictation_action_follows_capture_and_runtime_state() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Recording;
        let recording = derive_tray_presentation(&snapshot);
        assert_eq!(recording.stop_label, "Stop dictation");
        assert_eq!(recording.dictation_action, TrayDictationAction::Stop);
        snapshot.dictation_status = DictationStatus::Processing;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Ignore
        );
        snapshot.dictation_status = DictationStatus::Idle;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Toggle
        );
        snapshot.runtime_initialized = false;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Ignore
        );
    }

    #[test]
    fn review_menu_remains_available_without_microphone_or_valid_settings() {
        let mut snapshot = ready_snapshot();
        snapshot.configuration_error = true;
        snapshot.native_microphone_ready = Some(false);
        snapshot.microphone_permission = MicrophonePermission::Denied;
        for status in [DictationStatus::Idle, DictationStatus::Error] {
            snapshot.dictation_status = status;
            let presentation = derive_tray_presentation(&snapshot);
            assert_eq!(presentation.status_text, "VOCO — Settings need attention");
            assert_eq!(presentation.dictation_action, TrayDictationAction::Ignore);
            assert!(presentation.settings_enabled);
            assert!(!presentation.popover_enabled);
        }
        snapshot.runtime_initialized = false;
        assert!(derive_tray_presentation(&snapshot).settings_enabled);
        assert_eq!(panel_presentation(&snapshot)["canOpen"], true);
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
        assert_eq!(presentation.status_text, "VOCO — Starting microphone");
        assert_eq!(presentation.visual_state, TrayVisualState::Processing);
        assert_eq!(presentation.stop_label, "Stop after microphone starts");
        assert_eq!(presentation.dictation_action, TrayDictationAction::Stop);
        assert!(!presentation.popover_enabled);
        assert!(!presentation.settings_enabled);
        assert!(!presentation.hotkey_menu_enabled);
    }

    #[test]
    fn recording_visual_returns_to_ready_at_idle() {
        let mut snapshot = ready_snapshot();
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::Ready
        );
        assert_eq!(
            derive_tray_presentation(&snapshot).status_text,
            "VOCO — Ready to listen"
        );
        snapshot.dictation_status = DictationStatus::Recording;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::Recording
        );
        snapshot.dictation_status = DictationStatus::Idle;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::Ready
        );
    }

    #[test]
    fn recording_names_the_browser_field_only_when_owned() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Recording;
        snapshot.cursor_required = true;
        snapshot.cursor_delivery = CursorDeliveryState::Owned;
        let owned = derive_tray_presentation(&snapshot);
        assert_eq!(owned.status_text, "VOCO — Listening · browser field");
        assert_eq!(owned.stop_label, "Stop dictation");
        assert!(!owned.popover_enabled);
        assert!(!owned.settings_enabled);
        assert!(!owned.hotkey_menu_enabled);

        snapshot.cursor_required = false;
        assert_eq!(
            derive_tray_presentation(&snapshot).status_text,
            "VOCO — Listening"
        );
    }

    #[test]
    fn recording_without_required_cursor_uses_generic_listening_state() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Recording;
        snapshot.cursor_delivery = CursorDeliveryState::Inactive;

        let presentation = derive_tray_presentation(&snapshot);

        assert_eq!(presentation.status_text, "VOCO — Listening");
        assert_eq!(presentation.stop_label, "Stop dictation");
        assert!(!presentation.hotkey_menu_enabled);

        snapshot.cursor_required = true;
        assert_eq!(
            derive_tray_presentation(&snapshot).status_text,
            "VOCO — Listening"
        );
    }

    #[test]
    fn processing_disables_conflicting_actions() {
        let mut snapshot = ready_snapshot();
        snapshot.dictation_status = DictationStatus::Processing;
        let presentation = derive_tray_presentation(&snapshot);
        assert_eq!(presentation.visual_state, TrayVisualState::Processing);
        assert_eq!(presentation.status_text, "VOCO — Transcribing");
        assert_eq!(presentation.dictation_action, TrayDictationAction::Ignore);
        assert!(!presentation.popover_enabled);
        assert!(!presentation.settings_enabled);
        assert!(!presentation.hotkey_menu_enabled);
    }

    #[test]
    fn hotkey_preset_checkmarks_follow_the_configured_evdev_mode() {
        // A preset's position is the mode its check mark matches.
        for (mode, preset) in (0u8..).zip(HOTKEY_PRESETS) {
            assert_eq!(crate::hotkey_to_evdev_mode(preset), mode, "{preset}");
        }
        assert_eq!(crate::hotkey_to_evdev_mode("not a shortcut"), 255);
    }

    #[test]
    fn cursor_setup_is_visible_at_idle() {
        let mut snapshot = ready_snapshot();
        snapshot.cursor_required = true;
        snapshot.cursor_setup_state = "not-enabled".to_string();
        let setup = derive_tray_presentation(&snapshot);
        assert_eq!(setup.visual_state, TrayVisualState::NotReady);
        assert_eq!(setup.status_text, "VOCO — Desktop setup needed");
        assert_eq!(setup.title, "Check setup");
        assert_eq!(setup.dictation_action, TrayDictationAction::Toggle);
    }

    #[test]
    fn pending_desktop_setup_holds_the_launch_presentation() {
        let mut snapshot = ready_snapshot();
        snapshot.cursor_required = true;
        snapshot.cursor_setup_state = String::new();
        let pending = derive_tray_presentation(&snapshot);
        assert_eq!(pending.visual_state, TrayVisualState::Processing);
        assert_eq!(pending.status_text, "VOCO — Initializing…");
        assert_eq!(pending.title, "Starting VOCO");

        // Waiting for diagnostics never changes what the menu allows.
        for status in [
            DictationStatus::Idle,
            DictationStatus::Starting,
            DictationStatus::Recording,
            DictationStatus::Processing,
            DictationStatus::Error,
        ] {
            let known = RuntimeStatusSnapshot {
                dictation_status: status,
                cursor_setup_state: "ready".to_string(),
                ..snapshot.clone()
            };
            let unknown = RuntimeStatusSnapshot {
                cursor_setup_state: String::new(),
                ..known.clone()
            };
            let (known, unknown) = (
                derive_tray_presentation(&known),
                derive_tray_presentation(&unknown),
            );
            assert_eq!(unknown.stop_label, known.stop_label);
            assert_eq!(unknown.dictation_action, known.dictation_action);
            assert_eq!(unknown.popover_enabled, known.popover_enabled);
            assert_eq!(unknown.settings_enabled, known.settings_enabled);
            assert_eq!(unknown.hotkey_menu_enabled, known.hotkey_menu_enabled);
        }

        // Problems that are already known are not hidden behind the wait.
        snapshot.native_microphone_ready = Some(false);
        assert_eq!(
            derive_tray_presentation(&snapshot).status_text,
            "VOCO — Microphone setup required"
        );
        snapshot.native_microphone_ready = None;
        snapshot.cursor_required = false;
        assert_eq!(
            derive_tray_presentation(&snapshot).visual_state,
            TrayVisualState::Ready
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_waits_for_desktop_setup_before_reporting_it() {
        let mut snapshot = ready_snapshot();
        snapshot.cursor_required = true;
        snapshot.cursor_setup_state = String::new();
        let pending = panel_presentation(&snapshot);
        assert_eq!(pending["status"], "initializing");
        assert_eq!(pending["canOpen"], true);
        for (setup, status) in [("not-enabled", "attention"), ("ready", "idle")] {
            snapshot.cursor_setup_state = setup.to_string();
            assert_eq!(panel_presentation(&snapshot)["status"], status);
        }
        snapshot.cursor_setup_state = String::new();
        snapshot.native_microphone_ready = Some(false);
        assert_eq!(panel_presentation(&snapshot)["status"], "attention");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_reads_starting_until_the_speech_model_is_ready() {
        let mut snapshot = ready_snapshot();
        snapshot.model_download_status = ModelDownloadStatus::Checking;
        assert_eq!(derive_tray_presentation(&snapshot).title, "Starting VOCO");
        let warming = panel_presentation(&snapshot);
        assert_eq!(warming["status"], "initializing");
        assert_eq!(warming["canOpen"], true);
        assert_eq!(warming["canStop"], false);
        // A dictation started during warmup still shows itself and keeps Stop.
        for (status, panel, can_stop) in [
            (DictationStatus::Starting, "starting", true),
            (DictationStatus::Recording, "recording", true),
            (DictationStatus::Processing, "processing", false),
        ] {
            snapshot.dictation_status = status;
            let active = panel_presentation(&snapshot);
            assert_eq!(active["status"], panel);
            assert_eq!(active["canStop"], can_stop);
        }
        snapshot.dictation_status = DictationStatus::Idle;
        snapshot.model_download_status = ModelDownloadStatus::Failed;
        assert_eq!(panel_presentation(&snapshot)["status"], "attention");
        snapshot.model_download_status = ModelDownloadStatus::Ready;
        assert_eq!(panel_presentation(&snapshot)["status"], "idle");
    }

    #[test]
    fn unchecked_microphone_is_a_first_use_check_not_a_failure() {
        let mut snapshot = ready_snapshot();
        snapshot.microphone_ready = false;

        let presentation = derive_tray_presentation(&snapshot);

        assert_eq!(presentation.visual_state, TrayVisualState::Ready);
        assert_eq!(
            presentation.status_text,
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
        assert_eq!(
            presentation.status_text,
            "VOCO — Microphone needs permission"
        );
        assert_eq!(presentation.dictation_action, TrayDictationAction::Ignore);
        assert!(presentation.popover_enabled);
        assert!(presentation.settings_enabled);
    }

    #[test]
    fn native_dictation_readiness_is_separate_from_browser_permission() {
        let mut snapshot = ready_snapshot();
        snapshot.microphone_permission = MicrophonePermission::Denied;
        snapshot.native_microphone_ready = Some(true);
        let ready = derive_tray_presentation(&snapshot);
        assert_eq!(ready.dictation_action, TrayDictationAction::Toggle);
        assert_eq!(ready.status_text, "VOCO — Ready to listen");
        snapshot.native_microphone_ready = Some(false);
        let unselected = derive_tray_presentation(&snapshot);
        assert_eq!(unselected.dictation_action, TrayDictationAction::Ignore);
        assert_eq!(unselected.status_text, "VOCO — Microphone setup required");
        snapshot.dictation_status = DictationStatus::Recording;
        assert_eq!(
            derive_tray_presentation(&snapshot).dictation_action,
            TrayDictationAction::Stop
        );
    }

    #[test]
    fn runtime_snapshot_deserializes_frontend_permission_state() {
        let mut payload = serde_json::json!({
            "epoch": 8,
            "revision": 13,
            "runtimeInitialized": true,
            "configurationError": false,
            "microphoneReady": false,
            "microphonePermission": "denied",
            "dictationStatus": "idle",
            "cursorDelivery": "inactive",
            "cursorRequired": false,
            "cursorSetupState": "ready"
        });
        let snapshot: RuntimeStatusSnapshot = serde_json::from_value(payload.clone())
            .expect("frontend runtime snapshot should deserialize");

        assert!(snapshot.runtime_initialized);
        assert_eq!(snapshot.microphone_permission, MicrophonePermission::Denied);
        payload["dictationStatus"] = "error".into();
        let failed: RuntimeStatusSnapshot = serde_json::from_value(payload.clone())
            .expect("failed dictation status should deserialize");
        assert_eq!(failed.dictation_status, DictationStatus::Error);
        assert_eq!(
            derive_tray_presentation(&failed).dictation_action,
            TrayDictationAction::Ignore
        );
        // The tray never presents transcript or recovery state, so it refuses them.
        for retired in [
            "hasRecoverableTranscript",
            "manualTranscriptReady",
            "recoveryAvailable",
        ] {
            let mut stale = payload.clone();
            stale[retired] = false.into();
            assert!(
                serde_json::from_value::<RuntimeStatusSnapshot>(stale).is_err(),
                "{retired}"
            );
        }
        for retired in ["pending", "preview-only", "unreconciled"] {
            let mut stale = payload.clone();
            stale["cursorDelivery"] = retired.into();
            assert!(
                serde_json::from_value::<RuntimeStatusSnapshot>(stale).is_err(),
                "{retired}"
            );
        }
        payload["cursorDelivery"] = "owned".into();
        let owned: RuntimeStatusSnapshot =
            serde_json::from_value(payload).expect("owned cursor delivery should deserialize");
        assert_eq!(owned.cursor_delivery, CursorDeliveryState::Owned);
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
    fn renderer_snapshots_and_reloads_keep_rust_model_readiness() {
        let mut first = RuntimeStatusSnapshot::default();
        assert_eq!(begin_runtime_session(&mut first), 1);
        for model in [ModelDownloadStatus::Ready, ModelDownloadStatus::Failed] {
            let mut current = RuntimeStatusSnapshot {
                epoch: 4,
                revision: 8,
                model_download_status: model,
                ..ready_snapshot()
            };
            let before = current.clone();
            let incoming = RuntimeStatusSnapshot {
                epoch: 4,
                revision: 9,
                runtime_initialized: true,
                configuration_error: true,
                microphone_permission: MicrophonePermission::Denied,
                native_microphone_ready: Some(false),
                dictation_status: DictationStatus::Recording,
                dictation_session_id: 2,
                cursor_delivery: CursorDeliveryState::Owned,
                cursor_required: true,
                cursor_setup_state: "not-enabled".to_string(),
                ..RuntimeStatusSnapshot::default()
            };
            // Stale, repeated, unrevised and foreign snapshots change nothing.
            for (epoch, revision) in [(4, 7), (4, 8), (4, 0), (3, 9), (5, 9)] {
                let stale = RuntimeStatusSnapshot {
                    epoch,
                    revision,
                    ..incoming.clone()
                };
                assert!(!apply_runtime_snapshot(&mut current, stale));
                assert_eq!(current, before);
            }
            // An accepted snapshot replaces every renderer field; the renderer's
            // Checking never overrides Rust's model readiness.
            assert!(apply_runtime_snapshot(&mut current, incoming.clone()));
            assert_eq!(
                current,
                RuntimeStatusSnapshot {
                    model_download_status: model,
                    ..incoming
                }
            );
            // A renderer load starts the next epoch from the launch state.
            assert_eq!(begin_runtime_session(&mut current), 5);
            assert_eq!(
                current,
                RuntimeStatusSnapshot {
                    epoch: 5,
                    model_download_status: model,
                    ..RuntimeStatusSnapshot::default()
                }
            );
        }
    }

    #[test]
    fn initializing_and_model_warmup_states_are_authoritative() {
        let initializing = derive_tray_presentation(&RuntimeStatusSnapshot::default());
        assert_eq!(initializing.visual_state, TrayVisualState::Processing);
        assert_eq!(initializing.status_text, "VOCO — Initializing…");
        assert_eq!(initializing.title, "Starting VOCO");
        assert_eq!(initializing.dictation_action, TrayDictationAction::Ignore);
        assert!(!initializing.popover_enabled);
        assert!(!initializing.settings_enabled);

        let failed_launch = derive_tray_presentation(&RuntimeStatusSnapshot {
            model_download_status: ModelDownloadStatus::Failed,
            ..RuntimeStatusSnapshot::default()
        });
        assert_eq!(failed_launch.visual_state, TrayVisualState::NotReady);
        assert_eq!(
            failed_launch.status_text,
            "VOCO — Speech model needs attention"
        );
        assert_eq!(failed_launch.title, "Check setup");
        assert_eq!(failed_launch.dictation_action, TrayDictationAction::Ignore);

        let mut warming = ready_snapshot();
        warming.model_download_status = ModelDownloadStatus::Checking;
        let progress = derive_tray_presentation(&warming);
        assert_eq!(progress.visual_state, TrayVisualState::Processing);
        assert_eq!(progress.status_text, "VOCO — Checking speech model…");
        assert_eq!(progress.dictation_action, TrayDictationAction::Toggle);

        warming.model_download_status = ModelDownloadStatus::Failed;
        let failed = derive_tray_presentation(&warming);
        assert_eq!(failed.visual_state, TrayVisualState::NotReady);
        assert_eq!(failed.status_text, "VOCO — Speech model needs attention");
        assert_eq!(failed.dictation_action, TrayDictationAction::Toggle);
    }

    #[test]
    fn configuration_failures_are_visible_at_idle() {
        let mut snapshot = ready_snapshot();
        snapshot.configuration_error = true;
        let presentation = derive_tray_presentation(&snapshot);
        assert_eq!(presentation.visual_state, TrayVisualState::NotReady);
        assert_eq!(presentation.status_text, "VOCO — Settings need attention");
        assert_eq!(presentation.dictation_action, TrayDictationAction::Ignore);
        assert!(!presentation.popover_enabled);
        assert!(presentation.settings_enabled);
        assert!(!presentation.hotkey_menu_enabled);

        snapshot.dictation_status = DictationStatus::Error;
        let from_startup_failure = derive_tray_presentation(&snapshot);
        assert_eq!(
            from_startup_failure.status_text,
            "VOCO — Settings need attention"
        );
    }

    #[test]
    fn meter_timer_runs_only_for_a_visible_recording() {
        for status in [
            DictationStatus::Idle,
            DictationStatus::Starting,
            DictationStatus::Recording,
            DictationStatus::Processing,
            DictationStatus::Error,
        ] {
            assert_eq!(
                meter_timer_wanted(status, true),
                status == DictationStatus::Recording
            );
            assert!(!meter_timer_wanted(status, false));
        }
    }

    #[test]
    fn meter_swaps_skip_jitter_but_land_on_silence_and_full_scale() {
        let top = crate::tray_icons::METER_FRAMES - 1;
        assert!(meter_swap(None, 0));
        assert!(meter_swap(None, 30));
        for (applied, frame, swap) in [
            (30, 30, false),
            (30, 31, false),
            (30, 29, false),
            (30, 32, true),
            (30, 28, true),
            (1, 0, true),
            (0, 0, false),
            (0, 1, false),
            (top - 1, top, true),
            (top, top, false),
            (top, top - 1, false),
        ] {
            assert_eq!(
                meter_swap(Some(applied), frame),
                swap,
                "{applied} -> {frame}"
            );
        }
    }

    #[test]
    fn meter_tick_keeps_attack_quick_and_release_short() {
        let tick = METER_TICK.as_secs_f64();
        let top = crate::tray_icons::METER_FRAMES - 1;
        let mut meter = crate::tray_icons::MeterEnvelope::default();
        assert!(meter.step(1.0, tick, true) >= top - 8);
        assert_eq!(meter.step(1.0, tick, true), top);
        let mut applied = Some(top);
        let mut ticks = 0;
        while applied != Some(0) {
            ticks += 1;
            assert!(ticks <= 10, "silence must land within a second");
            let frame = meter.step(0.0, tick, true);
            if meter_swap(applied, frame) {
                applied = Some(frame);
            }
        }
    }
}
