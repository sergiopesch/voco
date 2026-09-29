//! Same-session GNOME panel bridge. Leases restore the native tray after shell loss.
use glib::variant::ToVariant;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
use webkit2gtk::gio;

const PATH: &str = "/org/voco/Panel";
const INTERFACE: &str = "org.voco.Panel1";
const XML: &str = r#"<node><interface name="org.voco.Panel1">
<method name="Attach"><arg type="b" direction="out"/></method>
<method name="GetState"><arg type="s" direction="out"/></method>
<method name="ReserveShortcut"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="ReserveStopShortcut"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="Action"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="Detach"/><signal name="Changed"/>
</interface></node>"#;
/// The chords passive Wayland evdev also observes; Shell can reserve no other.
const ACCELERATORS: [&str; 2] = ["<Alt>d", "<Alt><Shift>d"];
/// Companion v11 holds its grab at every status and renews about once a second.
const SHORTCUT_LEASE: Duration = Duration::from_millis(2500);
/// A loaded v10 companion renews its Stop-only grab on every active poll.
const STOP_LEASE: Duration = Duration::from_millis(250);
static BUS: Mutex<Option<gio::DBusConnection>> = Mutex::new(None);
static OWNER: Mutex<Option<String>> = Mutex::new(None);
static LEVEL: Mutex<Option<(u64, f64, Instant)>> = Mutex::new(None);
// The attached Shell's latest proven grab: a v11 accelerator or a v10
// "session/accelerator" Stop token. The two key spaces cannot collide.
static SHORTCUT_UNTIL: Mutex<Option<(String, Instant)>> = Mutex::new(None);

// Refreshed only by the authenticated Shell while it holds the compositor grab.
// A lost extension cannot permanently suppress the passive keyboard fallback.
pub(crate) fn reserves_current_shortcut(app: &tauri::AppHandle) -> bool {
    crate::tray::panel_snapshot(app).is_some_and(|state| reserves(&state))
}

fn reserves(state: &serde_json::Value) -> bool {
    is_attached()
        && (holds_shortcut(state)
            || stop_shortcut_token(state).is_some_and(|token| lease_matches(&token)))
}

/// One fresh reservation decides both routes: while it suppresses passive evdev,
/// Shell's consumed chord toggles; otherwise evdev toggles and Shell's is refused.
fn holds_shortcut(state: &serde_json::Value) -> bool {
    shortcut_accelerator(state).is_some_and(lease_matches)
}

fn lease_matches(key: &str) -> bool {
    SHORTCUT_UNTIL
        .lock()
        .ok()
        .and_then(|until| until.clone())
        .is_some_and(|(reserved, until)| reserved == key && Instant::now() < until)
}

fn reserve(key: &str, lease: Duration) {
    if let Ok(mut until) = SHORTCUT_UNTIL.lock() {
        *until = Some((key.to_owned(), Instant::now() + lease));
    }
}

/// The configured chord Shell grabs whenever attached, idle included.
fn shortcut_accelerator(state: &serde_json::Value) -> Option<&str> {
    state["shortcutAccelerator"]
        .as_str()
        .filter(|value| ACCELERATORS.contains(value))
}

fn reserve_shortcut(state: &serde_json::Value, accelerator: &str) -> bool {
    let accepted = shortcut_accelerator(state) == Some(accelerator);
    if accepted {
        reserve(accelerator, SHORTCUT_LEASE);
    }
    accepted
}

pub fn is_attached() -> bool {
    OWNER.lock().is_ok_and(|owner| owner.is_some())
}

fn set_owner(sender: Option<String>) {
    if let Ok(mut owner) = OWNER.lock() {
        *owner = sender;
    }
}

/// Sample the authenticated compositor, not an asynchronously polled shortcut
/// flag. An ordinary streaming paste may race the physical Stop chord.
pub(crate) fn paste_modifiers_clear() -> Result<bool, String> {
    let owner = OWNER
        .lock()
        .ok()
        .and_then(|owner| owner.clone())
        .ok_or("The GNOME panel is unavailable; no paste keys were sent.")?;
    let bus = BUS
        .lock()
        .ok()
        .and_then(|bus| bus.clone())
        .ok_or("The GNOME panel connection is unavailable; no paste keys were sent.")?;
    let clear = bus
        .call_sync(
            Some(&owner),
            "/org/voco/PanelInput",
            "org.voco.PanelInput1",
            "ModifiersClear",
            None,
            None,
            gio::DBusCallFlags::NO_AUTO_START,
            150,
            gio::Cancellable::NONE,
        )
        .ok()
        .and_then(|value| value.get::<(bool,)>())
        .map(|(clear,)| clear)
        .ok_or_else(|| {
            "Could not verify released keyboard modifiers; no paste keys were sent.".to_string()
        })?;
    if !OWNER
        .lock()
        .is_ok_and(|current| current.as_ref() == Some(&owner))
    {
        return Err("The GNOME panel changed; no paste keys were sent.".into());
    }
    Ok(clear)
}

pub fn clear_shortcut() {
    if let Ok(mut until) = SHORTCUT_UNTIL.lock() {
        *until = None;
    }
}

/// Legacy v10 Stop lease: follows a capture and its configured chord, not UI revisions.
pub(crate) fn stop_shortcut_token(state: &serde_json::Value) -> Option<String> {
    if !matches!(
        state["status"].as_str(),
        Some("starting" | "recording" | "processing")
    ) {
        return None;
    }
    let session = state["stopSession"]
        .as_str()
        .filter(|value| !value.is_empty())?;
    let accelerator = state["stopAccelerator"]
        .as_str()
        .filter(|value| ACCELERATORS.contains(value))?;
    Some(format!("{session}/{accelerator}"))
}

fn valid_shortcut_reservation(state: &serde_json::Value, token: &str) -> bool {
    stop_shortcut_token(state).as_deref() == Some(token)
}

/// Wake only the attached shell when authoritative state changes; meter frames
/// remain bounded polling and no state is broadcast to unrelated bus clients.
pub fn publish() {
    if let (Ok(bus), Ok(owner)) = (BUS.lock(), OWNER.lock()) {
        if let (Some(bus), Some(owner)) = (bus.as_ref(), owner.as_ref()) {
            let _ = bus.emit_signal(Some(owner), PATH, INTERFACE, "Changed", None);
        }
    }
}

pub fn update_level(app: &tauri::AppHandle, epoch: u64, value: f64) {
    let Some(state) = app.try_state::<crate::tray::TrayMutex>() else {
        return;
    };
    let Ok(state) = state.lock() else {
        return;
    };
    if state.runtime_epoch != epoch
        || state.dictation_status != crate::tray::DictationStatus::Recording
    {
        return;
    }
    if let Ok(mut level) = LEVEL.lock() {
        *level = Some((
            epoch,
            if value.is_finite() {
                value.clamp(0.0, 1.0)
            } else {
                0.0
            },
            Instant::now(),
        ));
    }
}

pub fn level(epoch: u64, status: crate::tray::DictationStatus) -> f64 {
    if status != crate::tray::DictationStatus::Recording {
        return 0.0;
    }
    LEVEL
        .lock()
        .ok()
        .and_then(|level| *level)
        .filter(|(owner, _, at)| *owner == epoch && at.elapsed() < Duration::from_millis(250))
        .map_or(0.0, |(_, value, _)| value)
}

pub fn reset_level() {
    if let Ok(mut level) = LEVEL.lock() {
        *level = None;
    }
}

#[derive(Default)]
struct Lease {
    sender: String,
    seen: Option<Instant>,
    last_stop: String,
}

impl Lease {
    fn admits(&self, sender: &str) -> bool {
        self.seen.is_some() && self.sender == sender
    }
}

/// The application behind the bridge; tests substitute a recording double.
trait Host {
    fn snapshot(&self) -> Option<serde_json::Value>;
    /// The ordinary shortcut toggle, with native debounce and arbitration.
    fn toggle(&self);
    fn action(&self, action: &str, token: &str) -> bool;
    fn show_tray(&self, visible: bool);
}

impl Host for tauri::AppHandle {
    fn snapshot(&self) -> Option<serde_json::Value> {
        crate::tray::panel_snapshot(self)
    }

    fn toggle(&self) {
        crate::eval_toggle_with_backend(self, "gnome_panel");
    }

    fn action(&self, action: &str, token: &str) -> bool {
        crate::tray::panel_action(self, action, token)
    }

    fn show_tray(&self, visible: bool) {
        crate::tray::panel_visibility(self, visible);
    }
}

/// Forget the Shell connection: nothing stays reserved and the native tray returns.
fn release(host: &impl Host, lease: &mut Lease) {
    *lease = Lease::default();
    clear_shortcut();
    set_owner(None);
    host.show_tray(true);
}

type Reply = Result<Option<glib::Variant>, (&'static str, &'static str)>;

/// Every method but Attach, answered only for the attached Shell connection.
fn handle(
    host: &impl Host,
    lease: &mut Lease,
    sender: &str,
    method: &str,
    parameters: &glib::Variant,
) -> Reply {
    if !lease.admits(sender) {
        return Err(("org.voco.NotAttached", "Attach from GNOME Shell first"));
    }
    let accepted = match method {
        "ReserveShortcut" => {
            let (accelerator,) = parameters.get::<(String,)>().unwrap_or_default();
            host.snapshot()
                .is_some_and(|state| reserve_shortcut(&state, &accelerator))
        }
        "ReserveStopShortcut" => {
            let (token,) = parameters.get::<(String,)>().unwrap_or_default();
            let accepted = host
                .snapshot()
                .is_some_and(|state| valid_shortcut_reservation(&state, &token));
            if accepted {
                reserve(&token, STOP_LEASE);
            }
            accepted
        }
        "Action" => {
            let (action, token) = parameters.get::<(String, String)>().unwrap_or_default();
            if action == "shortcut" {
                // v11 consumes the chord at every status; it is the plain toggle.
                let accepted = host.snapshot().is_some_and(|state| holds_shortcut(&state));
                if accepted {
                    host.toggle();
                }
                accepted
            } else {
                let repeated = action == "stop" && lease.last_stop == token;
                let accepted = !repeated && host.action(&action, &token);
                if accepted && action == "stop" {
                    lease.last_stop = token;
                    // An already queued evdev observation must not
                    // turn this consumed Stop into a fresh Start.
                    crate::LAST_TOGGLE_MS.store(
                        crate::shortcut_monotonic_ms(),
                        std::sync::atomic::Ordering::SeqCst,
                    );
                }
                accepted
            }
        }
        "GetState" => {
            lease.seen = Some(Instant::now());
            let state = host.snapshot().unwrap_or(serde_json::Value::Null);
            return Ok(Some((state.to_string(),).to_variant()));
        }
        "Detach" => {
            release(host, lease);
            return Ok(None);
        }
        _ => return Err(("org.voco.UnknownMethod", "Unknown panel method")),
    };
    Ok(Some((accepted,).to_variant()))
}

pub fn setup(app: &tauri::AppHandle) {
    let app = app.clone();
    let lease = Arc::new(Mutex::new(Lease::default()));
    let expiry_app = app.clone();
    let expiry_lease = lease.clone();
    glib::timeout_add_seconds(1, move || {
        if let Ok(mut lease) = expiry_lease.lock() {
            if lease
                .seen
                .is_some_and(|seen| seen.elapsed() > Duration::from_secs(5))
            {
                release(&expiry_app, &mut lease);
            }
        }
        glib::ControlFlow::Continue
    });
    let lost_app = app.clone();
    gio::bus_own_name(
        gio::BusType::Session,
        "org.voco.Panel",
        gio::BusNameOwnerFlags::DO_NOT_QUEUE,
        move |connection, _| {
            if let Ok(mut bus) = BUS.lock() {
                *bus = Some(connection.clone());
            }
            let info = gio::DBusNodeInfo::for_xml(XML).expect("static panel interface");
            let interface = info.lookup_interface(INTERFACE).expect("panel interface");
            let app = app.clone();
            let lease = lease.clone();
            let result = connection.register_object(
                PATH,
                &interface,
                move |connection, sender, _, _, method, parameters, invocation| {
                    let Ok(mut lease) = lease.lock() else {
                        invocation.return_dbus_error("org.voco.Unavailable", "Panel unavailable");
                        return;
                    };
                    if method == "Attach" {
                        // Only the session's GNOME Shell can lease the indicator or
                        // read the meter; never trust a caller-supplied identity.
                        let owner = connection
                            .call_sync(
                                Some("org.freedesktop.DBus"),
                                "/org/freedesktop/DBus",
                                "org.freedesktop.DBus",
                                "GetNameOwner",
                                Some(&("org.gnome.Shell",).to_variant()),
                                None,
                                gio::DBusCallFlags::NONE,
                                500,
                                gio::Cancellable::NONE,
                            )
                            .ok()
                            .and_then(|v| v.get::<(String,)>());
                        let allowed = owner.is_some_and(|(owner,)| owner == sender);
                        if allowed {
                            lease.sender = sender.to_owned();
                            lease.seen = Some(Instant::now());
                            // A new lease never inherits a grab; Shell proves its own.
                            clear_shortcut();
                            set_owner(Some(sender.to_owned()));
                            crate::tray::panel_visibility(&app, false);
                        }
                        invocation.return_value(Some(&(allowed,).to_variant()));
                        return;
                    }
                    match handle(&app, &mut lease, sender, method, &parameters) {
                        Ok(reply) => invocation.return_value(reply.as_ref()),
                        Err((name, message)) => invocation.return_dbus_error(name, message),
                    }
                },
                |_, _, _, _, _| ().to_variant(),
                |_, _, _, _, _, _| false,
            );
            if let Err(error) = result {
                log::warn!("Panel bridge unavailable: {error}");
            }
        },
        |_, _| {},
        move |_, _| crate::tray::panel_visibility(&lost_app, true),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    // OWNER and SHORTCUT_UNTIL are process-wide; tests using them take turns.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|error| error.into_inner())
    }

    #[derive(Default)]
    struct FakeHost {
        state: Option<serde_json::Value>,
        toggles: Cell<usize>,
        actions: RefCell<Vec<(String, String)>>,
        tray: Cell<Option<bool>>,
    }

    impl Host for FakeHost {
        fn snapshot(&self) -> Option<serde_json::Value> {
            self.state.clone()
        }

        fn toggle(&self) {
            self.toggles.set(self.toggles.get() + 1);
        }

        fn action(&self, action: &str, token: &str) -> bool {
            self.actions
                .borrow_mut()
                .push((action.to_owned(), token.to_owned()));
            true
        }

        fn show_tray(&self, visible: bool) {
            self.tray.set(Some(visible));
        }
    }

    fn fake(state: serde_json::Value) -> FakeHost {
        FakeHost {
            state: Some(state),
            ..FakeHost::default()
        }
    }

    fn idle(accelerator: Option<&str>) -> serde_json::Value {
        serde_json::json!({"token":"3:7", "status":"idle", "canStop":false,
            "shortcutAccelerator":accelerator, "stopAccelerator":accelerator})
    }

    /// Start from an empty bridge with `sender` attached as the Shell.
    fn attach(sender: &str) -> Lease {
        clear_shortcut();
        set_owner(Some(sender.to_owned()));
        Lease {
            sender: sender.to_owned(),
            seen: Some(Instant::now()),
            ..Lease::default()
        }
    }

    fn call(
        host: &FakeHost,
        lease: &mut Lease,
        sender: &str,
        method: &str,
        parameters: glib::Variant,
    ) -> Result<bool, &'static str> {
        handle(host, lease, sender, method, &parameters)
            .map(|reply| {
                reply
                    .and_then(|reply| reply.get::<(bool,)>())
                    .is_some_and(|(accepted,)| accepted)
            })
            .map_err(|(name, _)| name)
    }

    fn reserve_call(accelerator: &str) -> glib::Variant {
        (accelerator,).to_variant()
    }

    fn shortcut_call() -> glib::Variant {
        ("shortcut", "").to_variant()
    }

    #[test]
    fn fresh_idle_reservation_suppresses_only_its_attached_current_chord() {
        let _serial = serial();
        let host = fake(idle(Some("<Alt>d")));
        let mut lease = attach(":1.5");
        assert_eq!(
            call(
                &host,
                &mut lease,
                ":1.5",
                "ReserveShortcut",
                reserve_call("<Alt>d")
            ),
            Ok(true)
        );
        let (_, until) = SHORTCUT_UNTIL.lock().unwrap().clone().unwrap();
        assert!(until > Instant::now() + Duration::from_secs(1));
        let mut state = idle(Some("<Alt>d"));
        assert!(reserves(&state));
        // One grab covers every status, not only an active capture.
        for status in ["recording", "processing", "attention"] {
            state["status"] = status.into();
            assert!(reserves(&state));
        }
        assert!(!reserves(&idle(Some("<Alt><Shift>d"))));
        assert!(!reserves(&idle(Some("<Control>v"))));
        assert!(!reserves(&idle(None)));
        set_owner(None);
        assert!(!reserves(&idle(Some("<Alt>d"))));
        set_owner(Some(":1.5".into()));
        assert!(reserves(&idle(Some("<Alt>d"))));
        *SHORTCUT_UNTIL.lock().unwrap() =
            Some(("<Alt>d".into(), Instant::now() - Duration::from_millis(1)));
        assert!(!reserves(&idle(Some("<Alt>d"))));
        assert_eq!(
            call(
                &host,
                &mut lease,
                ":1.5",
                "ReserveShortcut",
                reserve_call("<Alt>d")
            ),
            Ok(true)
        );
        clear_shortcut();
        assert!(!reserves(&idle(Some("<Alt>d"))));
        set_owner(None);
    }

    #[test]
    fn only_the_attached_shell_can_reserve_the_current_supported_chord() {
        let _serial = serial();
        let host = fake(idle(Some("<Alt>d")));
        let mut lease = attach(":1.5");
        for (sender, lease) in [(":1.9", &mut lease), (":1.5", &mut Lease::default())] {
            assert_eq!(
                call(
                    &host,
                    lease,
                    sender,
                    "ReserveShortcut",
                    reserve_call("<Alt>d")
                ),
                Err("org.voco.NotAttached")
            );
        }
        assert!(!reserves(&idle(Some("<Alt>d"))));
        for accelerator in ["<Alt><Shift>d", "<Control>v", "", "3:1/<Alt>d"] {
            assert_eq!(
                call(
                    &host,
                    &mut lease,
                    ":1.5",
                    "ReserveShortcut",
                    reserve_call(accelerator)
                ),
                Ok(false)
            );
            assert!(!reserves(&idle(Some("<Alt>d"))));
        }
        let unsupported = fake(idle(Some("<Control>v")));
        assert_eq!(
            call(
                &unsupported,
                &mut lease,
                ":1.5",
                "ReserveShortcut",
                reserve_call("<Control>v")
            ),
            Ok(false)
        );
        assert!(SHORTCUT_UNTIL.lock().unwrap().is_none());
        assert_eq!(
            call(
                &host,
                &mut lease,
                ":1.5",
                "ReserveShortcut",
                reserve_call("<Alt>d")
            ),
            Ok(true)
        );
        assert_eq!(
            call(&host, &mut lease, ":1.5", "Detach", ().to_variant()),
            Ok(false)
        );
        assert_eq!(host.tray.get(), Some(true));
        assert!(!is_attached());
        assert!(SHORTCUT_UNTIL.lock().unwrap().is_none());
        assert_eq!(
            call(
                &host,
                &mut lease,
                ":1.5",
                "ReserveShortcut",
                reserve_call("<Alt>d")
            ),
            Err("org.voco.NotAttached")
        );
    }

    #[test]
    fn consumed_shortcut_toggles_only_for_the_reserving_attached_shell() {
        let _serial = serial();
        let host = fake(idle(Some("<Alt>d")));
        let mut lease = attach(":1.5");
        assert_eq!(
            call(
                &host,
                &mut lease,
                ":1.5",
                "ReserveShortcut",
                reserve_call("<Alt>d")
            ),
            Ok(true)
        );
        for (sender, lease) in [(":1.9", &mut lease), (":1.5", &mut Lease::default())] {
            assert_eq!(
                call(&host, lease, sender, "Action", shortcut_call()),
                Err("org.voco.NotAttached")
            );
        }
        assert_eq!(host.toggles.get(), 0);
        for _ in 0..2 {
            assert_eq!(
                call(&host, &mut lease, ":1.5", "Action", shortcut_call()),
                Ok(true)
            );
        }
        // Each consumed chord is one ordinary toggle; native debounce is the only one.
        assert_eq!(host.toggles.get(), 2);
        assert!(host.actions.borrow().is_empty());
        // Without a fresh reservation passive evdev owns the chord instead.
        for state in [idle(Some("<Alt><Shift>d")), idle(None)] {
            let other = fake(state);
            assert_eq!(
                call(&other, &mut lease, ":1.5", "Action", shortcut_call()),
                Ok(false)
            );
            assert_eq!(other.toggles.get(), 0);
        }
        clear_shortcut();
        assert_eq!(
            call(&host, &mut lease, ":1.5", "Action", shortcut_call()),
            Ok(false)
        );
        assert_eq!(host.toggles.get(), 2);
        set_owner(None);
    }

    #[test]
    fn loaded_v10_companion_keeps_its_stop_reservation_and_explicit_stop() {
        let _serial = serial();
        let state = serde_json::json!({"token":"3:7", "stopSession":"3:1", "status":"recording",
            "canStop":true, "stopAccelerator":"<Alt>d", "shortcutAccelerator":"<Alt>d"});
        let host = fake(state.clone());
        let mut lease = attach(":1.5");
        assert_eq!(
            call(
                &host,
                &mut lease,
                ":1.5",
                "ReserveStopShortcut",
                reserve_call("3:1/<Alt>d")
            ),
            Ok(true)
        );
        assert!(reserves(&state));
        let mut finished = state.clone();
        finished["status"] = "idle".into();
        assert!(!reserves(&finished));
        // A v10 Stop token authorizes no v11 toggle.
        assert_eq!(
            call(&host, &mut lease, ":1.5", "Action", shortcut_call()),
            Ok(false)
        );
        for accepted in [true, false] {
            assert_eq!(
                call(
                    &host,
                    &mut lease,
                    ":1.5",
                    "Action",
                    ("stop", "3:1").to_variant()
                ),
                Ok(accepted)
            );
        }
        assert_eq!(
            *host.actions.borrow(),
            vec![("stop".to_owned(), "3:1".to_owned())]
        );
        assert_eq!(host.toggles.get(), 0);
        clear_shortcut();
        set_owner(None);
    }

    #[test]
    fn released_or_expired_reservation_does_not_suppress_passive_start() {
        let _serial = serial();
        *SHORTCUT_UNTIL.lock().unwrap() =
            Some(("3:1/<Alt>d".into(), Instant::now() + Duration::from_secs(1)));
        assert!(lease_matches("3:1/<Alt>d"));
        assert!(!lease_matches("3:2/<Alt>d"));
        clear_shortcut();
        assert!(!lease_matches("3:1/<Alt>d"));
        *SHORTCUT_UNTIL.lock().unwrap() = Some((
            "3:1/<Alt>d".into(),
            Instant::now() - Duration::from_millis(1),
        ));
        assert!(!lease_matches("3:1/<Alt>d"));
        clear_shortcut();
    }

    #[test]
    fn stop_shortcut_requires_current_active_state_and_supported_accelerator() {
        for status in [
            "starting",
            "recording",
            "processing",
            "idle",
            "recovery",
            "attention",
        ] {
            let state = serde_json::json!({"token":"3:7", "stopSession":"3:1", "status":status, "stopAccelerator":"<Alt>d"});
            assert_eq!(
                valid_shortcut_reservation(&state, "3:1/<Alt>d"),
                matches!(status, "starting" | "recording" | "processing")
            );
            assert!(!valid_shortcut_reservation(&state, "3:6"));
            assert!(!valid_shortcut_reservation(&state, "2:7"));
        }
        for accelerator in [None, Some("<Control>v"), Some("")] {
            let state = serde_json::json!({"token":"3:7", "stopSession":"3:1", "status":"recording", "stopAccelerator":accelerator});
            assert!(!valid_shortcut_reservation(&state, "3:1/<Alt>d"));
        }
    }
    #[test]
    fn reservation_survives_presentation_changes_but_not_authority_changes() {
        let mut state = serde_json::json!({"token":"3:7", "stopSession":"3:1", "status":"starting", "stopAccelerator":"<Alt>d"});
        let token = stop_shortcut_token(&state).unwrap();
        state["token"] = "3:8".into();
        state["status"] = "recording".into();
        assert!(valid_shortcut_reservation(&state, &token));
        for (field, value) in [
            ("stopSession", "3:2"),
            ("stopSession", "4:1"),
            ("stopSession", ""),
            ("stopAccelerator", "<Alt><Shift>d"),
            ("status", "idle"),
        ] {
            let mut changed = state.clone();
            changed[field] = value.into();
            assert!(!valid_shortcut_reservation(&changed, &token));
        }
        state.as_object_mut().unwrap().remove("stopSession");
        assert!(!valid_shortcut_reservation(&state, &token));
    }
}
