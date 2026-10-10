//! Bind Wayland paste to its originating login, not logind's elected user display,
//! and follow that login's screen lock.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::task::Poll;
use std::time::{Duration, Instant};

use glib::translate::{from_glib_full, ToGlibPtr};
use glib::variant::{ObjectPath, ToVariant};
use webkit2gtk::gio;

const SESSION_INTERFACE: &str = "org.freedesktop.login1.Session";
const LOOKUP_BUDGET: Duration = Duration::from_millis(750);
const MAX_SESSIONS: usize = 16;
// VOCO's device has no custom ID_SEAT rule, so libinput assigns it to seat0.
const KEYBOARD_SEAT: &str = "seat0";
const REFUSED: &str = "This desktop session isn't the active local session for VOCO's keyboard, so VOCO sent no paste keys.";
pub const LOCKED_DETAIL: &str = "The screen is locked, so VOCO sent no paste keys.";
/// The originating login's LockedHint, as logind last reported it.
static SESSION_LOCKED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LookupError {
    Missing,
    Unavailable,
}

#[derive(Clone, Debug)]
struct Session {
    id: String,
    uid: u32,
    kind: String,
    class: String,
    remote: bool,
    seat: String,
    active: bool,
    locked: bool,
}

impl Session {
    /// Keys may reach this login: it is in the foreground and not locked.
    fn usable(&self) -> bool {
        self.active && !self.locked
    }

    fn graphical_user(&self) -> bool {
        matches!(self.kind.as_str(), "wayland" | "x11") && self.class == "user"
    }

    fn eligible(&self, uid: u32) -> bool {
        self.uid == uid && self.graphical_user() && !self.remote && self.seat == KEYBOARD_SEAT
    }
}

trait Sessions {
    fn for_process(&self) -> Result<String, LookupError>;
    fn for_id(&self, id: &str) -> Result<String, LookupError>;
    fn for_user(&self, uid: u32) -> Result<Vec<(String, String)>, LookupError>;
    fn read(&self, path: &str) -> Result<Session, LookupError>;
}

#[derive(Debug, PartialEq, Eq)]
struct Origin {
    id: String,
    path: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
enum Binding {
    #[default]
    Unresolved,
    Bound(Origin),
    Refused,
}

impl Binding {
    fn check(&mut self, sessions: &impl Sessions, uid: u32, hint: Option<&str>) -> bool {
        if *self == Self::Unresolved {
            let (binding, allowed) = resolve(sessions, uid, hint);
            *self = binding;
            return allowed;
        }
        let Self::Bound(origin) = self else {
            // Genuine unavailability retains the existing fail-open policy.
            return *self == Self::Unresolved;
        };
        match sessions.read(&origin.path) {
            Ok(session) if session.id == origin.id && session.eligible(uid) => session.usable(),
            Ok(_) | Err(LookupError::Missing) => {
                // A known departed/changed origin never becomes a different login.
                *self = Self::Refused;
                false
            }
            Err(LookupError::Unavailable) => true,
        }
    }
}

fn bind(sessions: &impl Sessions, path: String, uid: u32, id: Option<&str>) -> (Binding, bool) {
    match sessions.read(&path) {
        Ok(session)
            if !session.id.is_empty()
                && session.eligible(uid)
                && id.is_none_or(|id| id == session.id) =>
        {
            let usable = session.usable();
            (
                Binding::Bound(Origin {
                    id: session.id,
                    path,
                }),
                usable,
            )
        }
        Ok(_) | Err(LookupError::Missing) => (Binding::Refused, false),
        Err(LookupError::Unavailable) => (Binding::Unresolved, true),
    }
}

fn resolve(sessions: &impl Sessions, uid: u32, hint: Option<&str>) -> (Binding, bool) {
    match sessions.for_process() {
        // Kernel/cgroup membership takes precedence over an inherited environment.
        Ok(path) => return bind(sessions, path, uid, None),
        Err(LookupError::Unavailable) => return (Binding::Unresolved, true),
        Err(LookupError::Missing) => {}
    }
    if let Some(id) = hint.filter(|id| !id.is_empty()) {
        return match sessions.for_id(id) {
            Ok(path) => bind(sessions, path, uid, Some(id)),
            Err(LookupError::Missing) => (Binding::Refused, false),
            Err(LookupError::Unavailable) => (Binding::Unresolved, true),
        };
    }
    // User-service apps often have neither cgroup session membership nor an ID
    // in their environment. One local graphical login is unambiguous; choosing
    // whichever login is active would silently rebind a background application.
    let candidates = match sessions.for_user(uid) {
        Ok(candidates) if candidates.len() <= MAX_SESSIONS => candidates,
        Ok(_) => return (Binding::Refused, false),
        Err(_) => return (Binding::Unresolved, true),
    };
    let mut origin = None;
    for (id, path) in candidates {
        let session = match sessions.read(&path) {
            Ok(session) => session,
            // A login known to have departed cannot be replaced on a later check.
            Err(LookupError::Missing) => return (Binding::Refused, false),
            // An incomplete enumeration cannot establish a unique origin.
            Err(LookupError::Unavailable) => return (Binding::Unresolved, true),
        };
        if session.uid != uid || !session.graphical_user() {
            continue;
        }
        // A second graphical login, even remote or on another seat, makes the
        // origin ambiguous. Do not infer this app's display from seat/activity.
        if !session.eligible(uid) || session.id.is_empty() || session.id != id || origin.is_some() {
            return (Binding::Refused, false);
        }
        origin = Some((Origin { id, path }, session.usable()));
    }
    origin.map_or((Binding::Unresolved, true), |(origin, active)| {
        (Binding::Bound(origin), active)
    })
}

static BINDING: Mutex<Binding> = Mutex::new(Binding::Unresolved);
static SESSION_HINT: LazyLock<Option<String>> =
    LazyLock::new(|| std::env::var("XDG_SESSION_ID").ok());

/// Called at Wayland startup and before both the copy and keyboard dispatch.
/// Once identified, the originating session remains bound for this process.
pub fn require_active() -> Result<(), String> {
    if is_locked() {
        return Err(LOCKED_DETAIL.into());
    }
    let mut binding = BINDING.lock().unwrap_or_else(|error| error.into_inner());
    if *binding == Binding::Refused {
        return Err(REFUSED.into());
    }
    let Some(logind) = Logind::connect() else {
        return Ok(());
    };
    if binding.check(&logind, unsafe { libc::geteuid() }, SESSION_HINT.as_deref()) {
        Ok(())
    } else {
        Err(REFUSED.into())
    }
}

/// Whether the originating login's screen is locked. Without logind or a
/// bound login this reads as unlocked, the same fail-open policy as paste.
pub fn is_locked() -> bool {
    SESSION_LOCKED.load(Ordering::SeqCst)
}

/// Follow the originating login's LockedHint for the life of the process.
/// `on_lock` runs on the GTK main thread each time the screen locks. Without
/// logind or a bound login nothing is watched.
pub fn watch_lock(on_lock: impl Fn() + Send + Sync + 'static) {
    std::thread::spawn(move || {
        let Some(logind) = Logind::connect() else {
            return;
        };
        let path = {
            let mut binding = BINDING.lock().unwrap_or_else(|error| error.into_inner());
            if *binding == Binding::Unresolved {
                let uid = unsafe { libc::geteuid() };
                *binding = resolve(&logind, uid, SESSION_HINT.as_deref()).0;
            }
            match &*binding {
                Binding::Bound(origin) => origin.path.clone(),
                _ => return,
            }
        };
        let on_lock = Arc::new(on_lock);
        let (bus, signal_path, signal_lock) = (logind.bus.clone(), path.clone(), on_lock.clone());
        let (subscribed, ready) = std::sync::mpsc::channel();
        // Signals are delivered on the context that subscribed: GTK's.
        glib::MainContext::default().invoke(move || {
            let _subscription = bus.signal_subscribe(
                Some("org.freedesktop.login1"),
                Some("org.freedesktop.DBus.Properties"),
                Some("PropertiesChanged"),
                Some(&signal_path),
                Some(SESSION_INTERFACE),
                gio::DBusSignalFlags::NONE,
                move |_, _, _, _, _, parameters| {
                    if let Some(locked) = locked_hint_change(parameters) {
                        note_lock(&SESSION_LOCKED, locked, &*signal_lock);
                    }
                },
            );
            // A subscription lasts as long as its connection, and GIO keeps the
            // shared system bus only while something holds it: hold it for good.
            std::mem::forget(bus);
            let _ = subscribed.send(());
        });
        // Read the state only once the match rule is queued: the bus handles one
        // connection's messages in order, so a change can't fall between the two.
        // A lock seen here stops a dictation that started meanwhile.
        if ready.recv().is_ok() {
            if let Some(session) = Logind::connect().and_then(|logind| logind.read(&path).ok()) {
                note_lock(&SESSION_LOCKED, session.locked, &*on_lock);
            }
        }
    });
}

/// Record a lock state from the signal or the first read. Only the change to
/// locked stops dictation, so seeing one lock twice stops it once.
fn note_lock(state: &AtomicBool, locked: bool, on_lock: &dyn Fn()) {
    if !locked {
        state.store(false, Ordering::SeqCst);
    } else if !state.swap(true, Ordering::SeqCst) {
        on_lock();
    }
}

/// LockedHint's new value in a logind session PropertiesChanged signal.
fn locked_hint_change(parameters: &glib::Variant) -> Option<bool> {
    let (_, changed, _) =
        parameters.get::<(String, HashMap<String, glib::Variant>, Vec<String>)>()?;
    changed.get("LockedHint")?.get::<bool>()
}

struct Logind {
    bus: gio::DBusConnection,
    deadline: Instant,
}

impl Logind {
    fn connect() -> Option<Self> {
        let deadline = Instant::now() + LOOKUP_BUDGET;
        // A private context keeps even initial bus authentication bounded without
        // pumping GTK's main context. Dropping GioFuture cancels a timed-out get.
        let mut connection = gio::bus_get_future(gio::BusType::System);
        let mut timeout = glib::timeout_future(LOOKUP_BUDGET);
        let bus = glib::MainContext::new().block_on(std::future::poll_fn(|cx| {
            if let Poll::Ready(result) = connection.as_mut().poll(cx) {
                return Poll::Ready(result.ok());
            }
            if timeout.as_mut().poll(cx).is_ready() {
                return Poll::Ready(None);
            }
            Poll::Pending
        }))?;
        Some(Self { bus, deadline })
    }

    fn call(
        &self,
        path: &str,
        interface: &str,
        method: &str,
        parameters: &glib::Variant,
    ) -> Result<glib::Variant, LookupError> {
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(LookupError::Unavailable);
        }
        self.bus
            .call_sync(
                Some("org.freedesktop.login1"),
                path,
                interface,
                method,
                Some(parameters),
                None,
                gio::DBusCallFlags::NO_AUTO_START,
                remaining.as_millis().clamp(1, 250) as i32,
                gio::Cancellable::NONE,
            )
            .map_err(|error| lookup_error(&error))
    }

    fn session_path(
        &self,
        method: &str,
        parameters: &glib::Variant,
    ) -> Result<String, LookupError> {
        self.call(
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            method,
            parameters,
        )?
        .get::<(ObjectPath,)>()
        .map(|(path,)| path.as_str().to_owned())
        .ok_or(LookupError::Unavailable)
    }
}

fn lookup_error(error: &glib::Error) -> LookupError {
    // GIO 0.18 exposes this through its C binding. The returned string is newly
    // allocated; GString takes and frees ownership.
    let remote: Option<glib::GString> = unsafe {
        from_glib_full(gio::ffi::g_dbus_error_get_remote_error(
            error.to_glib_none().0,
        ))
    };
    if matches!(
        remote.as_deref(),
        Some(
            "org.freedesktop.login1.NoSessionForPID"
                | "org.freedesktop.login1.NoSuchSession"
                | "org.freedesktop.DBus.Error.UnknownObject"
        )
    ) {
        LookupError::Missing
    } else {
        LookupError::Unavailable
    }
}

impl Sessions for Logind {
    fn for_process(&self) -> Result<String, LookupError> {
        self.session_path("GetSessionByPID", &(std::process::id(),).to_variant())
    }

    fn for_id(&self, id: &str) -> Result<String, LookupError> {
        self.session_path("GetSession", &(id,).to_variant())
    }

    fn for_user(&self, uid: u32) -> Result<Vec<(String, String)>, LookupError> {
        let path = self.session_path("GetUser", &(uid,).to_variant())?;
        self.call(
            &path,
            "org.freedesktop.DBus.Properties",
            "Get",
            &("org.freedesktop.login1.User", "Sessions").to_variant(),
        )?
        .get::<(glib::Variant,)>()
        .and_then(|(sessions,)| sessions.get::<Vec<(String, ObjectPath)>>())
        .map(|sessions| {
            sessions
                .into_iter()
                .map(|(id, path)| (id, path.as_str().to_owned()))
                .collect()
        })
        .ok_or(LookupError::Unavailable)
    }

    fn read(&self, path: &str) -> Result<Session, LookupError> {
        let (properties,) = self
            .call(
                path,
                "org.freedesktop.DBus.Properties",
                "GetAll",
                &(SESSION_INTERFACE,).to_variant(),
            )?
            .get::<(HashMap<String, glib::Variant>,)>()
            .ok_or(LookupError::Unavailable)?;
        decode_session(properties)
    }
}

fn decode_session(properties: HashMap<String, glib::Variant>) -> Result<Session, LookupError> {
    let string = |name: &str| {
        properties
            .get(name)
            .and_then(|value| value.get::<String>())
            .ok_or(LookupError::Unavailable)
    };
    let boolean = |name: &str| {
        properties
            .get(name)
            .and_then(|value| value.get::<bool>())
            .ok_or(LookupError::Unavailable)
    };
    let (uid, _) = properties
        .get("User")
        .and_then(|value| value.get::<(u32, ObjectPath)>())
        .ok_or(LookupError::Unavailable)?;
    let (seat, _) = properties
        .get("Seat")
        .and_then(|value| value.get::<(String, ObjectPath)>())
        .ok_or(LookupError::Unavailable)?;
    Ok(Session {
        id: string("Id")?,
        uid,
        kind: string("Type")?,
        class: string("Class")?,
        remote: boolean("Remote")?,
        seat,
        active: boolean("Active")?,
        // logind has reported it since v230; an older one never locks here.
        locked: properties
            .get("LockedHint")
            .and_then(|value| value.get::<bool>())
            .unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn properties() -> HashMap<String, glib::Variant> {
        let root = ObjectPath::try_from("/").unwrap();
        HashMap::from([
            ("Id".into(), "origin".to_variant()),
            ("User".into(), (1000u32, root.clone()).to_variant()),
            ("Seat".into(), ("seat0", root).to_variant()),
            ("Type".into(), "wayland".to_variant()),
            ("Class".into(), "user".to_variant()),
            ("Remote".into(), false.to_variant()),
            ("Active".into(), true.to_variant()),
        ])
    }

    #[test]
    fn locked_hint_decodes_and_an_old_logind_without_it_reads_unlocked() {
        let session = decode_session(properties()).unwrap();
        assert!(!session.locked && session.usable());
        let mut locked = properties();
        locked.insert("LockedHint".into(), true.to_variant());
        let session = decode_session(locked).unwrap();
        assert!(session.locked && session.active && !session.usable());
    }

    #[test]
    fn only_the_change_to_locked_stops_dictation() {
        let state = AtomicBool::new(false);
        let stops = std::cell::Cell::new(0);
        let stop = || stops.set(stops.get() + 1);
        // The first read and the signal can both report the same lock.
        note_lock(&state, true, &stop);
        note_lock(&state, true, &stop);
        assert_eq!(stops.get(), 1);
        note_lock(&state, false, &stop);
        assert!(!state.load(Ordering::SeqCst));
        note_lock(&state, true, &stop);
        assert_eq!(stops.get(), 2);
    }

    #[test]
    fn properties_changed_reports_only_a_locked_hint_value() {
        let changed = |props: HashMap<String, glib::Variant>| {
            (SESSION_INTERFACE, props, Vec::<String>::new()).to_variant()
        };
        let lock = changed(HashMap::from([("LockedHint".into(), true.to_variant())]));
        assert_eq!(locked_hint_change(&lock), Some(true));
        let unlock = changed(HashMap::from([("LockedHint".into(), false.to_variant())]));
        assert_eq!(locked_hint_change(&unlock), Some(false));
        let other = changed(HashMap::from([("IdleHint".into(), true.to_variant())]));
        assert_eq!(locked_hint_change(&other), None);
        assert_eq!(locked_hint_change(&"unexpected".to_variant()), None);
    }

    #[test]
    fn a_locked_origin_refuses_keys_and_unlocking_allows_them_again() {
        let mut fixture = Fixture::new();
        let path = fixture.add("origin", true);
        fixture.process = Ok(path.clone());
        let mut binding = Binding::default();
        assert!(binding.check(&fixture, 1000, None));
        fixture.change(&path, |session| session.locked = true);
        assert!(!binding.check(&fixture, 1000, None));
        assert!(
            matches!(binding, Binding::Bound(_)),
            "a lock never unbinds the origin"
        );
        fixture.change(&path, |session| session.locked = false);
        assert!(binding.check(&fixture, 1000, None));
    }

    #[test]
    fn logind_get_all_variants_decode_and_malformed_replies_stay_unknown() {
        let reply = (properties(),).to_variant();
        let (decoded,) = reply.get::<(HashMap<String, glib::Variant>,)>().unwrap();
        let session = decode_session(decoded).unwrap();
        assert!(session.eligible(1000) && session.active);
        for name in ["Id", "User", "Seat", "Type", "Class", "Remote", "Active"] {
            let mut missing = properties();
            missing.remove(name);
            assert!(matches!(
                decode_session(missing),
                Err(LookupError::Unavailable)
            ));
            let mut malformed = properties();
            malformed.insert(name.into(), 7u64.to_variant());
            assert!(matches!(
                decode_session(malformed),
                Err(LookupError::Unavailable)
            ));
        }
    }

    #[test]
    fn remote_errors_distinguish_missing_session_from_unavailable_logind() {
        for (name, expected) in [
            (
                "org.freedesktop.login1.NoSessionForPID",
                LookupError::Missing,
            ),
            ("org.freedesktop.login1.NoSuchSession", LookupError::Missing),
            (
                "org.freedesktop.DBus.Error.UnknownObject",
                LookupError::Missing,
            ),
            (
                "org.freedesktop.DBus.Error.ServiceUnknown",
                LookupError::Unavailable,
            ),
            (
                "org.freedesktop.DBus.Error.NoReply",
                LookupError::Unavailable,
            ),
        ] {
            let name = std::ffi::CString::new(name).unwrap();
            let error: glib::Error = unsafe {
                from_glib_full(gio::ffi::g_dbus_error_new_for_dbus_error(
                    name.as_ptr(),
                    c"fixture".as_ptr(),
                ))
            };
            assert_eq!(lookup_error(&error), expected);
        }
        let timeout = glib::Error::new(gio::IOErrorEnum::TimedOut, "fixture timeout");
        assert_eq!(lookup_error(&timeout), LookupError::Unavailable);
    }

    struct Fixture {
        process: Result<String, LookupError>,
        listed: Vec<(String, String)>,
        sessions: RefCell<HashMap<String, Result<Session, LookupError>>>,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                process: Err(LookupError::Missing),
                listed: vec![],
                sessions: RefCell::new(HashMap::new()),
            }
        }
        fn add(&mut self, id: &str, active: bool) -> String {
            let path = format!("/session/{id}");
            self.listed.push((id.into(), path.clone()));
            self.sessions.get_mut().insert(
                path.clone(),
                Ok(Session {
                    id: id.into(),
                    uid: 1000,
                    kind: "wayland".into(),
                    class: "user".into(),
                    remote: false,
                    seat: "seat0".into(),
                    active,
                    locked: false,
                }),
            );
            path
        }
        fn change(&mut self, path: &str, change: impl FnOnce(&mut Session)) {
            change(
                self.sessions
                    .get_mut()
                    .get_mut(path)
                    .unwrap()
                    .as_mut()
                    .unwrap(),
            );
        }
    }
    impl Sessions for Fixture {
        fn for_process(&self) -> Result<String, LookupError> {
            self.process.clone()
        }
        fn for_id(&self, id: &str) -> Result<String, LookupError> {
            self.listed
                .iter()
                .find(|(candidate, _)| candidate == id)
                .map(|(_, path)| path.clone())
                .ok_or(LookupError::Missing)
        }
        fn for_user(&self, _: u32) -> Result<Vec<(String, String)>, LookupError> {
            Ok(self.listed.clone())
        }
        fn read(&self, path: &str) -> Result<Session, LookupError> {
            self.sessions
                .borrow()
                .get(path)
                .cloned()
                .unwrap_or(Err(LookupError::Missing))
        }
    }

    #[test]
    fn a_secondary_origin_is_checked_instead_of_the_primary() {
        for origin_active in [false, true] {
            let mut f = Fixture::new();
            f.add("primary", !origin_active);
            let origin = f.add("origin", origin_active);
            f.process = Ok(origin.clone());
            let mut binding = Binding::Unresolved;
            assert_eq!(binding.check(&f, 1000, None), origin_active);
            assert_eq!(
                binding,
                Binding::Bound(Origin {
                    id: "origin".into(),
                    path: origin
                })
            );
        }
    }

    #[test]
    fn process_membership_precedes_a_stale_environment_hint() {
        let mut f = Fixture::new();
        f.add("primary", true);
        f.process = Ok(f.add("origin", false));
        assert!(!Binding::Unresolved.check(&f, 1000, Some("primary")));
    }

    #[test]
    fn user_service_can_bind_a_valid_environment_hint() {
        let mut f = Fixture::new();
        f.add("primary", false);
        f.add("origin", true);
        assert!(Binding::Unresolved.check(&f, 1000, Some("origin")));
    }

    #[test]
    fn user_service_without_a_hint_binds_the_only_graphical_login() {
        let mut f = Fixture::new();
        let manager = f.add("manager", true);
        f.change(&manager, |s| {
            s.kind = "unspecified".into();
            s.class = "manager".into();
            s.seat.clear();
        });
        let tty = f.add("tty", true);
        f.change(&tty, |s| s.kind = "tty".into());
        f.add("origin", true);
        assert!(Binding::Unresolved.check(&f, 1000, None));
    }

    #[test]
    fn activity_never_disambiguates_multiple_logins() {
        let mut f = Fixture::new();
        f.add("primary", false);
        f.add("origin", true);
        let mut binding = Binding::Unresolved;
        assert!(!binding.check(&f, 1000, None));
        assert_eq!(binding, Binding::Refused);
    }

    #[test]
    fn a_bound_origin_can_return_to_the_foreground_without_rebinding() {
        let mut f = Fixture::new();
        let path = f.add("origin", true);
        let mut binding = Binding::Unresolved;
        assert!(binding.check(&f, 1000, None));
        f.add("new_primary", true);
        f.change(&path, |s| s.active = false);
        assert!(!binding.check(&f, 1000, None));
        f.change(&path, |s| s.active = true);
        assert!(binding.check(&f, 1000, None));
    }

    #[test]
    fn a_departed_origin_is_never_replaced_even_after_a_transport_error() {
        let mut f = Fixture::new();
        let path = f.add("origin", true);
        let mut binding = Binding::Unresolved;
        assert!(binding.check(&f, 1000, None));
        f.sessions.get_mut().remove(&path);
        f.add("replacement", true);
        assert!(!binding.check(&f, 1000, None));
        f.process = Err(LookupError::Unavailable);
        assert!(!binding.check(&f, 1000, None));
    }

    #[test]
    fn an_origin_missing_during_enumeration_is_never_replaced() {
        let mut f = Fixture::new();
        let path = f.add("origin", true);
        f.sessions.get_mut().remove(&path);
        let mut binding = Binding::Unresolved;
        assert!(!binding.check(&f, 1000, None));
        assert_eq!(binding, Binding::Refused);

        f.listed.clear();
        f.add("replacement", true);
        assert!(!binding.check(&f, 1000, None));
        assert_eq!(binding, Binding::Refused);
    }

    #[test]
    fn unknown_transport_state_preserves_the_binding_and_existing_policy() {
        let mut f = Fixture::new();
        f.process = Err(LookupError::Unavailable);
        let mut binding = Binding::Unresolved;
        assert!(binding.check(&f, 1000, None));
        assert_eq!(binding, Binding::Unresolved);
        f.process = Err(LookupError::Missing);
        let path = f.add("origin", true);
        assert!(binding.check(&f, 1000, None));
        f.sessions
            .get_mut()
            .insert(path.clone(), Err(LookupError::Unavailable));
        assert!(binding.check(&f, 1000, None));
        assert_eq!(
            binding,
            Binding::Bound(Origin {
                id: "origin".into(),
                path
            })
        );
    }

    #[test]
    fn known_wrong_owner_type_class_remote_or_seat_is_refused() {
        let changes: [fn(&mut Session); 6] = [
            |s| s.uid = 1001,
            |s| s.kind = "tty".into(),
            |s| s.class = "greeter".into(),
            |s| s.remote = true,
            |s| s.seat = "seat1".into(),
            |s| s.seat.clear(),
        ];
        for change in changes {
            let mut f = Fixture::new();
            let path = f.add("origin", true);
            f.change(&path, change);
            f.process = Ok(path);
            assert!(!Binding::Unresolved.check(&f, 1000, None));
        }
    }

    #[test]
    fn explicit_missing_or_aliased_hint_never_falls_back_to_another_login() {
        let mut f = Fixture::new();
        let path = f.add("origin", true);
        assert!(!Binding::Unresolved.check(&f, 1000, Some("old")));
        f.listed.push(("auto".into(), path));
        assert!(!Binding::Unresolved.check(&f, 1000, Some("auto")));
    }

    #[test]
    fn remote_or_other_seat_login_prevents_ambiguous_fallback() {
        for remote in [false, true] {
            let mut f = Fixture::new();
            f.add("origin", true);
            let other = f.add("other", true);
            f.change(&other, |s| {
                s.remote = remote;
                s.seat = if remote { "" } else { "seat1" }.into();
            });
            assert!(!Binding::Unresolved.check(&f, 1000, None));
        }
    }

    #[test]
    fn enumeration_is_capped_and_an_incomplete_snapshot_cannot_bind() {
        let mut f = Fixture::new();
        for n in 0..=MAX_SESSIONS {
            f.add(&n.to_string(), true);
        }
        assert!(!Binding::Unresolved.check(&f, 1000, None));
        let mut f = Fixture::new();
        f.add("origin", true);
        let second = f.add("second", true);
        f.sessions
            .get_mut()
            .insert(second, Err(LookupError::Unavailable));
        let mut binding = Binding::Unresolved;
        assert!(binding.check(&f, 1000, None));
        assert_eq!(binding, Binding::Unresolved);
    }
}
