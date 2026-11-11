//! GNOME's desktop portals, for the snap (AGENTS.md, Delivery and Shortcut).
//!
//! One thread runs a private main context that holds every portal request,
//! session and signal subscription, so waiting for GNOME's answer, or for the
//! person to answer GNOME's dialog, never blocks GTK's main thread, and every
//! signal arrives on that thread.

use glib::variant::{ObjectPath, ToVariant};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};
use webkit2gtk::gio;

pub(crate) const DESTINATION: &str = "org.freedesktop.portal.Desktop";
pub(crate) const OBJECT: &str = "/org/freedesktop/portal/desktop";
const REQUEST: &str = "org.freedesktop.portal.Request";
pub(crate) const SESSION: &str = "org.freedesktop.portal.Session";
/// How long a method call may take; the answer comes later, as a Response.
const CALL_TIMEOUT_MS: i32 = 5_000;

struct Portal {
    context: glib::MainContext,
    connection: gio::DBusConnection,
}

static PORTAL: OnceLock<Option<Portal>> = OnceLock::new();

fn portal() -> Option<&'static Portal> {
    PORTAL
        .get_or_init(|| {
            let connection =
                gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE).ok()?;
            let context = glib::MainContext::new();
            let thread_context = context.clone();
            std::thread::Builder::new()
                .name("voco-portal".into())
                .spawn(move || {
                    let main_loop = glib::MainLoop::new(Some(&thread_context), false);
                    let _ = thread_context.with_thread_default(|| main_loop.run());
                })
                .ok()?;
            Some(Portal {
                context,
                connection,
            })
        })
        .as_ref()
}

/// Runs `job` on the portal thread and returns its result. Called on the
/// portal thread itself, it runs at once.
pub(crate) fn run<T: Send + 'static>(
    job: impl FnOnce(&gio::DBusConnection) -> T + Send + 'static,
) -> Option<T> {
    let portal = portal()?;
    let (sender, receiver) = mpsc::channel();
    let connection = portal.connection.clone();
    portal.context.invoke(move || {
        let _ = sender.send(job(&connection));
    });
    receiver.recv().ok()
}

/// Runs `job` on the portal thread without waiting for it.
pub(crate) fn spawn(job: impl FnOnce(&gio::DBusConnection) + Send + 'static) -> bool {
    let Some(portal) = portal() else {
        return false;
    };
    let connection = portal.connection.clone();
    portal.context.invoke(move || job(&connection));
    true
}

/// Whether the session's portal offers `interface` at `version` or later.
pub(crate) fn has_interface(
    connection: &gio::DBusConnection,
    interface: &str,
    version: u32,
) -> bool {
    connection
        .call_sync(
            Some(DESTINATION),
            OBJECT,
            "org.freedesktop.DBus.Properties",
            "Get",
            Some(&(interface, "version").to_variant()),
            Some(glib::VariantTy::new("(v)").expect("static type")),
            gio::DBusCallFlags::NONE,
            CALL_TIMEOUT_MS,
            gio::Cancellable::NONE,
        )
        .ok()
        .and_then(|reply| reply.child_value(0).as_variant())
        .and_then(|value| value.get::<u32>())
        .is_some_and(|found| found >= version)
}

/// A unique token for one request or session, as the portal API asks.
pub(crate) fn token(kind: &str) -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    format!(
        "voco_{kind}_{}_{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    )
}

/// The object path GNOME gives a request this connection makes with `token`.
fn request_path(connection: &gio::DBusConnection, token: &str) -> Option<String> {
    let unique = connection.unique_name()?;
    let sender = unique.trim_start_matches(':').replace('.', "_");
    Some(format!("{OBJECT}/request/{sender}/{token}"))
}

pub(crate) fn object_path(path: &str) -> Result<glib::Variant, String> {
    ObjectPath::try_from(path.to_string())
        .map(|path| path.to_variant())
        .map_err(|_| format!("Not an object path: {path}"))
}

/// Builds `a{sv}` options.
pub(crate) fn options(entries: &[(&str, glib::Variant)]) -> glib::Variant {
    let dict = glib::VariantDict::new(None);
    for (key, value) in entries {
        dict.insert_value(key, value);
    }
    dict.end()
}

/// How a request ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// The person cancelled or denied GNOME's dialog (Response 1).
    Denied,
    /// GNOME ended the request otherwise (Response 2), or the call failed.
    Failed(String),
    /// No Response before the deadline; the request was closed.
    TimedOut,
}

/// Calls a portal method that answers with a Request, then waits on the
/// portal thread for its Response. `parameters` receives the request's
/// handle token, to put in its options. Must run on the portal thread.
pub(crate) fn request(
    connection: &gio::DBusConnection,
    interface: &str,
    method: &str,
    parameters: impl FnOnce(&str) -> Result<glib::Variant, String>,
    timeout: Duration,
) -> Result<glib::VariantDict, Refusal> {
    let handle = token("request");
    let path = request_path(connection, &handle)
        .ok_or_else(|| Refusal::Failed("The session bus gave VOCO no name.".into()))?;
    let answer = std::rc::Rc::new(std::cell::RefCell::new(None::<(u32, glib::Variant)>));
    let slot = answer.clone();
    // Subscribed before the call, so even an immediate Response is seen.
    let subscription = connection.signal_subscribe(
        Some(DESTINATION),
        Some(REQUEST),
        Some("Response"),
        Some(&path),
        None,
        gio::DBusSignalFlags::NONE,
        move |_, _, _, _, _, parameters| {
            if let Some(code) = parameters.child_value(0).get::<u32>() {
                *slot.borrow_mut() = Some((code, parameters.child_value(1)));
            }
        },
    );
    let finish = |result| {
        connection.signal_unsubscribe(subscription);
        result
    };
    let arguments = match parameters(&handle) {
        Ok(arguments) => arguments,
        Err(error) => return finish(Err(Refusal::Failed(error))),
    };
    let called = connection.call_sync(
        Some(DESTINATION),
        OBJECT,
        interface,
        method,
        Some(&arguments),
        Some(glib::VariantTy::new("(o)").expect("static type")),
        gio::DBusCallFlags::NONE,
        CALL_TIMEOUT_MS,
        gio::Cancellable::NONE,
    );
    if let Err(error) = called {
        return finish(Err(Refusal::Failed(format!("{method}: {error}"))));
    }
    let context = glib::MainContext::ref_thread_default();
    let deadline = Instant::now() + timeout;
    while answer.borrow().is_none() && Instant::now() < deadline {
        if !context.iteration(false) {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    let Some((code, results)) = answer.borrow_mut().take() else {
        let _ = connection.call_sync(
            Some(DESTINATION),
            &path,
            REQUEST,
            "Close",
            None,
            None,
            gio::DBusCallFlags::NONE,
            CALL_TIMEOUT_MS,
            gio::Cancellable::NONE,
        );
        return finish(Err(Refusal::TimedOut));
    };
    finish(match code {
        0 => Ok(glib::VariantDict::new(Some(&results))),
        1 => Err(Refusal::Denied),
        _ => Err(Refusal::Failed(format!("{method} ended with {code}"))),
    })
}

/// A string from a Response's results.
pub(crate) fn result_string(results: &glib::VariantDict, key: &str) -> Option<String> {
    results
        .lookup_value(key, None)
        .and_then(|value| value.str().map(str::to_owned))
}

/// Ends a portal session; a session GNOME already closed is no error.
pub(crate) fn close_session(connection: &gio::DBusConnection, session: &str) {
    let _ = connection.call_sync(
        Some(DESTINATION),
        session,
        SESSION,
        "Close",
        None,
        None,
        gio::DBusCallFlags::NONE,
        CALL_TIMEOUT_MS,
        gio::Cancellable::NONE,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_and_valid_path_elements() {
        let first = token("request");
        let second = token("request");
        assert_ne!(first, second);
        assert!(first
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'));
    }

    #[test]
    fn options_build_a_string_keyed_dictionary() {
        let built = options(&[
            ("handle_token", "t1".to_variant()),
            ("types", 1u32.to_variant()),
        ]);
        assert_eq!(built.type_().as_str(), "a{sv}");
        let dict = glib::VariantDict::new(Some(&built));
        assert_eq!(result_string(&dict, "handle_token").as_deref(), Some("t1"));
        assert_eq!(
            dict.lookup_value("types", None)
                .and_then(|v| v.get::<u32>()),
            Some(1)
        );
    }
}
