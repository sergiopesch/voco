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
<method name="ReserveStopShortcut"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="Action"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="Detach"/><signal name="Changed"/>
</interface></node>"#;
static BUS: Mutex<Option<gio::DBusConnection>> = Mutex::new(None);
static OWNER: Mutex<Option<String>> = Mutex::new(None);
static LEVEL: Mutex<Option<(u64, f64, Instant)>> = Mutex::new(None);
static SHORTCUT_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

// Refreshed only by the authenticated Shell after it owns a compositor grab.
// A lost extension cannot permanently suppress the passive keyboard fallback.
pub fn reserves_stop_shortcut() -> bool {
    SHORTCUT_UNTIL
        .lock()
        .ok()
        .and_then(|until| *until)
        .is_some_and(|until| Instant::now() < until)
}

pub fn clear_shortcut() {
    if let Ok(mut until) = SHORTCUT_UNTIL.lock() {
        *until = None;
    }
}

fn valid_shortcut_reservation(state: &serde_json::Value, token: &str) -> bool {
    state["token"].as_str() == Some(token)
        && matches!(
            state["status"].as_str(),
            Some("starting" | "recording" | "processing")
        )
        && matches!(
            state["stopAccelerator"].as_str(),
            Some("<Alt>d" | "<Alt><Shift>d")
        )
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
                *lease = Lease::default();
                clear_shortcut();
                if let Ok(mut owner) = OWNER.lock() {
                    *owner = None;
                }
                crate::tray::panel_visibility(&expiry_app, true);
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
                            if let Ok(mut owner) = OWNER.lock() {
                                *owner = Some(sender.to_owned());
                            }
                            lease.seen = Some(Instant::now());
                            crate::tray::panel_visibility(&app, false);
                        }
                        invocation.return_value(Some(&(allowed,).to_variant()));
                        return;
                    }
                    if lease.sender != sender || lease.seen.is_none() {
                        invocation.return_dbus_error(
                            "org.voco.NotAttached",
                            "Attach from GNOME Shell first",
                        );
                        return;
                    }
                    match method {
                        "ReserveStopShortcut" => {
                            let (token,) = parameters.get::<(String,)>().unwrap_or_default();
                            let accepted = crate::tray::panel_snapshot(&app)
                                .is_some_and(|state| valid_shortcut_reservation(&state, &token));
                            if accepted {
                                if let Ok(mut until) = SHORTCUT_UNTIL.lock() {
                                    *until = Some(Instant::now() + Duration::from_millis(250));
                                }
                            }
                            invocation.return_value(Some(&(accepted,).to_variant()));
                        }
                        "GetState" => {
                            lease.seen = Some(Instant::now());
                            let state = crate::tray::panel_snapshot(&app)
                                .unwrap_or(serde_json::Value::Null);
                            invocation.return_value(Some(&(state.to_string(),).to_variant()));
                        }
                        "Action" => {
                            let (action, token) =
                                parameters.get::<(String, String)>().unwrap_or_default();
                            let repeated = action == "stop" && lease.last_stop == token;
                            let accepted =
                                !repeated && crate::tray::panel_action(&app, &action, &token);
                            if accepted && action == "stop" {
                                lease.last_stop = token;
                                // An already queued evdev observation must not
                                // turn this consumed Stop into a fresh Start.
                                crate::LAST_TOGGLE_MS.store(
                                    crate::shortcut_monotonic_ms(),
                                    std::sync::atomic::Ordering::SeqCst,
                                );
                            }
                            invocation.return_value(Some(&(accepted,).to_variant()));
                        }
                        "Detach" => {
                            *lease = Lease::default();
                            clear_shortcut();
                            if let Ok(mut owner) = OWNER.lock() {
                                *owner = None;
                            }
                            crate::tray::panel_visibility(&app, true);
                            invocation.return_value(None);
                        }
                        _ => invocation
                            .return_dbus_error("org.voco.UnknownMethod", "Unknown panel method"),
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

    #[test]
    fn released_or_expired_reservation_does_not_suppress_passive_start() {
        *SHORTCUT_UNTIL.lock().unwrap() = Some(Instant::now() + Duration::from_secs(1));
        assert!(reserves_stop_shortcut());
        clear_shortcut();
        assert!(!reserves_stop_shortcut());
        *SHORTCUT_UNTIL.lock().unwrap() = Some(Instant::now() - Duration::from_millis(1));
        assert!(!reserves_stop_shortcut());
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
            let state =
                serde_json::json!({"token":"3:7", "status":status, "stopAccelerator":"<Alt>d"});
            assert_eq!(
                valid_shortcut_reservation(&state, "3:7"),
                matches!(status, "starting" | "recording" | "processing")
            );
            assert!(!valid_shortcut_reservation(&state, "3:6"));
            assert!(!valid_shortcut_reservation(&state, "2:7"));
        }
        for accelerator in [None, Some("<Control>v"), Some("")] {
            let state = serde_json::json!({"token":"3:7", "status":"recording", "stopAccelerator":accelerator});
            assert!(!valid_shortcut_reservation(&state, "3:7"));
        }
    }
}
