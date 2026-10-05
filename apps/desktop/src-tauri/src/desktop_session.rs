//! Bind Wayland paste to its originating login, not logind's elected user display.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
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
}

impl Session {
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
            Ok(session) if session.id == origin.id && session.eligible(uid) => session.active,
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
            (
                Binding::Bound(Origin {
                    id: session.id,
                    path,
                }),
                session.active,
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
            // An incomplete enumeration cannot establish a unique origin.
            Err(_) => return (Binding::Unresolved, true),
        };
        if session.uid != uid || !session.graphical_user() {
            continue;
        }
        // A second graphical login, even remote or on another seat, makes the
        // origin ambiguous. Do not infer this app's display from seat/activity.
        if !session.eligible(uid) || session.id.is_empty() || session.id != id || origin.is_some() {
            return (Binding::Refused, false);
        }
        origin = Some((Origin { id, path }, session.active));
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
