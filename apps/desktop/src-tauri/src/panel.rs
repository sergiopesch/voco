//! Same-session GNOME panel bridge. Leases restore the native tray after shell loss.
use glib::variant::ToVariant;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
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
<method name="NextRequest"><arg type="s" direction="out"/><arg type="u" direction="out"/></method>
<method name="PasteDone"><arg type="u" direction="in"/><arg type="t" direction="in"/></method>
<method name="PasteRefused"><arg type="u" direction="in"/><arg type="s" direction="in"/></method>
<method name="ModifiersState"><arg type="u" direction="in"/><arg type="b" direction="in"/></method>
<method name="CompanionAsking"><arg type="b" direction="out"/></method>
</interface></node>"#;
/// ReserveShortcut: the companion holds its grab at every status and renews it about
/// once a second.
const SHORTCUT_LEASE: Duration = Duration::from_millis(2500);
/// ReserveStopShortcut: an older companion still loaded in the Shell renews its Stop-only
/// grab on every active poll.
const STOP_LEASE: Duration = Duration::from_millis(250);
static BUS: Mutex<Option<gio::DBusConnection>> = Mutex::new(None);
static OWNER: Mutex<Option<String>> = Mutex::new(None);
static LEVEL: Mutex<Option<(u64, f64, Instant)>> = Mutex::new(None);
// The attached Shell's latest proven grab: a ReserveShortcut accelerator or a
// ReserveStopShortcut "session/accelerator" token. The two key spaces cannot collide.
static SHORTCUT_UNTIL: Mutex<Option<(String, Instant)>> = Mutex::new(None);
// The attached Shell once its companion asks for work with NextRequest: it
// takes the paste keys. A Shell still running an older copy keeps uinput.
static ASKING: Mutex<Option<String>> = Mutex::new(None);
// The request VOCO waits on, its next id, and the serving thread's context,
// where the companion's pending call waits.
static OPEN: Mutex<Option<Open>> = Mutex::new(None);
static NEXT_REQUEST_ID: AtomicU32 = AtomicU32::new(1);
static SERVE_CONTEXT: Mutex<Option<glib::MainContext>> = Mutex::new(None);
// The companion reports a paste once its 36 ms gesture is out; longer means the
// Shell is stuck, and its keys may or may not have gone.
const PASTE_TIMEOUT: Duration = Duration::from_millis(1000);
// A modifier check answers within ModifiersClear's 150 ms.
const MODIFIERS_TIMEOUT: Duration = Duration::from_millis(150);
// How long withdrawing a request waits for the serving thread.
const WITHDRAW_TIMEOUT: Duration = Duration::from_millis(500);
// VOCO keeps a NextRequest call this long before answering it with nothing.
const REQUEST_IDLE: Duration = Duration::from_secs(20);
const IDLE: (&str, u32) = ("idle", 0);

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
        .filter(|value| is_preset_accelerator(value))
}

/// The chords passive Wayland evdev also observes; Shell can reserve no other.
fn is_preset_accelerator(value: &str) -> bool {
    crate::Preset::ALL
        .iter()
        .any(|preset| preset.accelerator() == value)
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
    if let Ok(mut asking) = ASKING.lock() {
        *asking = None;
    }
    end_requests();
    // Attach, Detach and lease expiry change what the companion check reports.
    crate::panel_setup::invalidate_check();
}

/// Sample the authenticated compositor, not an asynchronously polled shortcut
/// flag. An ordinary streaming paste may race the physical Stop chord. A
/// companion that asks for work answers a modifier request; an earlier one
/// answers ModifiersClear itself.
pub(crate) fn paste_modifiers_clear() -> Result<bool, String> {
    if companion_asks_for_work() {
        let id = next_request_id();
        return match ask(Request::Modifiers(id), id, MODIFIERS_TIMEOUT) {
            Ok(Report::Modifiers(clear)) => Ok(clear),
            _ => {
                Err("Could not verify released keyboard modifiers; no paste keys were sent.".into())
            }
        };
    }
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

/// Whether the attached Shell's companion asks VOCO for work, so it takes the
/// paste keys: version 17 and later, from its first NextRequest.
pub(crate) fn companion_asks_for_work() -> bool {
    let Some(owner) = OWNER.lock().ok().and_then(|owner| owner.clone()) else {
        return false;
    };
    ASKING
        .lock()
        .is_ok_and(|asking| asking.as_deref() == Some(owner.as_str()))
}

/// Whether the companion asks VOCO for work. The VOCO that serves
/// org.voco.Panel knows; another process, such as `voco --check-desktop-input`,
/// asks that VOCO. None when no VOCO answers.
pub(crate) fn companion_asks_for_voco() -> Option<bool> {
    if SERVE_CONTEXT.lock().is_ok_and(|context| context.is_some()) {
        return Some(companion_asks_for_work());
    }
    ask_running_voco()
}

/// The answer of the VOCO that serves org.voco.Panel, within half a second.
pub(crate) fn ask_running_voco() -> Option<bool> {
    let bus = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE).ok()?;
    bus.call_sync(
        Some("org.voco.Panel"),
        PATH,
        INTERFACE,
        "CompanionAsking",
        None,
        None,
        gio::DBusCallFlags::NO_AUTO_START,
        500,
        gio::Cancellable::NONE,
    )
    .ok()?
    .get::<(bool,)>()
    .map(|(asking,)| asking)
}

/// Work for the companion. A confined VOCO can answer the Shell but not call
/// it, so the companion keeps one NextRequest call pending (AGENTS.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Request {
    Paste(u32),
    Modifiers(u32),
    Changed,
}

impl Request {
    fn wire(self) -> (&'static str, u32) {
        match self {
            Self::Paste(id) => ("paste", id),
            Self::Modifiers(id) => ("modifiers", id),
            Self::Changed => ("changed", 0),
        }
    }
}

/// What the companion reported for VOCO's open request.
#[derive(Debug, PartialEq)]
enum Report {
    Pasted(u64),
    Refused(String),
    Modifiers(bool),
}

/// The one request VOCO waits on, and where its report goes: pastes are
/// serialized, and a modifier check comes just before its paste.
struct Open {
    id: u32,
    report: mpsc::Sender<Report>,
}

/// The serving thread's NextRequest call and the work no call has taken yet.
/// gio's invocations aren't Send, so both stay on that thread.
#[derive(Default)]
struct Work {
    pending: Option<(gio::DBusMethodInvocation, glib::SourceId)>,
    queue: VecDeque<Request>,
}

thread_local! {
    static WORK: RefCell<Work> = RefCell::new(Work::default());
}

fn next_request_id() -> u32 {
    NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

/// A NextRequest from the attached Shell: queued work answers it at once;
/// otherwise it waits for some, at most REQUEST_IDLE.
fn hold_request(invocation: gio::DBusMethodInvocation) {
    WORK.with(|work| {
        let mut work = work.borrow_mut();
        if let Some(request) = work.queue.pop_front() {
            invocation.return_value(Some(&request.wire().to_variant()));
            return;
        }
        // The companion re-arms only after an answer, so a second call replaces the first.
        if let Some((earlier, timer)) = work.pending.take() {
            timer.remove();
            earlier.return_value(Some(&IDLE.to_variant()));
        }
        let timer = glib::timeout_add_local_once(REQUEST_IDLE, || {
            WORK.with(|work| {
                if let Some((invocation, _)) = work.borrow_mut().pending.take() {
                    invocation.return_value(Some(&IDLE.to_variant()));
                }
            });
        });
        work.pending = Some((invocation, timer));
    });
}

/// Hand a request to the pending call, or queue it for the next; changes
/// coalesce.
fn give(request: Request) {
    WORK.with(|work| {
        let mut work = work.borrow_mut();
        if let Some((invocation, timer)) = work.pending.take() {
            timer.remove();
            invocation.return_value(Some(&request.wire().to_variant()));
        } else if request != Request::Changed || !work.queue.contains(&Request::Changed) {
            work.queue.push_back(request);
        }
    });
}

/// Take back a request no call has taken. False once one has, when the
/// companion may be acting on it.
fn withdraw(request: Request) -> bool {
    WORK.with(|work| {
        let queue = &mut work.borrow_mut().queue;
        let queued = queue.len();
        queue.retain(|waiting| *waiting != request);
        queue.len() < queued
    })
}

/// A new attachment, or none, ends the old one's call and work.
fn end_requests() {
    WORK.with(|work| {
        let mut work = work.borrow_mut();
        work.queue.clear();
        if let Some((invocation, timer)) = work.pending.take() {
            timer.remove();
            invocation.return_dbus_error("org.voco.NotAttached", "The VOCO panel detached");
        }
    });
}

/// Run f on the serving thread, where the companion's call waits. None when
/// there is no such thread or it doesn't answer in time.
fn on_serving_thread<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
    timeout: Duration,
) -> Option<T> {
    let context = SERVE_CONTEXT.lock().ok()?.clone()?;
    let (answer, answers) = mpsc::channel();
    context.invoke(move || {
        let _ = answer.send(f());
    });
    answers.recv_timeout(timeout).ok()
}

/// Why a request came back without its report.
#[derive(Debug, PartialEq)]
enum Unanswered {
    /// Withdrawn before any call took it: the companion never saw it.
    NeverTaken,
    /// Taken, or not known to be withdrawn: the companion may have acted.
    NoReport,
}

/// Ask the companion and wait for its report on this request.
fn ask(request: Request, id: u32, timeout: Duration) -> Result<Report, Unanswered> {
    let (report, reports) = mpsc::channel();
    if let Ok(mut open) = OPEN.lock() {
        *open = Some(Open { id, report });
    }
    let started = Instant::now();
    let _ = on_serving_thread(move || give(request), timeout);
    let outcome = reports
        .recv_timeout(timeout.saturating_sub(started.elapsed()))
        // Withdrawn on the serving thread, where calls take work, no call can
        // take it afterwards.
        .map_err(
            |_| match on_serving_thread(move || withdraw(request), WITHDRAW_TIMEOUT) {
                Some(true) => Unanswered::NeverTaken,
                _ => Unanswered::NoReport,
            },
        );
    if let Ok(mut open) = OPEN.lock() {
        if open.as_ref().is_some_and(|open| open.id == id) {
            *open = None;
        }
    }
    outcome
}

/// A report from the attached Shell, accepted only for VOCO's open request.
fn report_for(id: u32, report: Report) -> Reply {
    let Ok(open) = OPEN.lock() else {
        return Err(("org.voco.Unavailable", "Panel unavailable"));
    };
    match open.as_ref() {
        Some(open) if open.id == id => {
            let _ = open.report.send(report);
            Ok(None)
        }
        _ => Err(("org.voco.UnknownRequest", "No such request is open")),
    }
}

/// What a failed companion paste leaves behind.
#[derive(Debug, PartialEq)]
pub(crate) enum CompanionPasteError {
    /// No key was sent, so the text can wait for the next paste.
    NoMutation(String),
    /// Keys may have been sent.
    Uncertain(String),
}

/// Shift+Insert typed by the companion inside GNOME Shell. Returns when the
/// Insert press went out, by the companion's clock.
pub(crate) fn companion_paste() -> Result<Instant, CompanionPasteError> {
    if !companion_asks_for_work() {
        return Err(CompanionPasteError::NoMutation(
            "The GNOME panel isn't attached; no paste keys were sent.".into(),
        ));
    }
    let id = next_request_id();
    let reply = ask(Request::Paste(id), id, PASTE_TIMEOUT);
    let now = Instant::now();
    let now_us = glib::monotonic_time();
    match reply {
        Ok(Report::Pasted(insert_us)) => Ok(instant_at(insert_us, now, now_us)),
        Ok(Report::Refused(reason)) => Err(refusal(&reason)),
        Ok(Report::Modifiers(_)) | Err(Unanswered::NoReport) => Err(
            CompanionPasteError::Uncertain("The GNOME panel's paste may not have finished.".into()),
        ),
        Err(Unanswered::NeverTaken) => Err(CompanionPasteError::NoMutation(
            "The GNOME panel didn't take the paste; no paste keys were sent.".into(),
        )),
    }
}

/// A refusal comes before any key; a gesture cut short by disabling may have
/// typed.
fn refusal(reason: &str) -> CompanionPasteError {
    match reason {
        "Disabled" => CompanionPasteError::Uncertain(
            "The GNOME panel stopped before the paste finished.".into(),
        ),
        "ModifiersHeld" => CompanionPasteError::NoMutation(
            "Keyboard modifiers are held; no paste keys were sent.".into(),
        ),
        "Busy" => CompanionPasteError::NoMutation(
            "Another paste is in flight; no paste keys were sent.".into(),
        ),
        _ => CompanionPasteError::NoMutation(
            "The GNOME panel refused the paste; no paste keys were sent.".into(),
        ),
    }
}

/// The Instant of a GLib monotonic time (CLOCK_MONOTONIC microseconds, as
/// Instant counts on Linux), from an Instant and the monotonic time read just
/// after it.
fn instant_at(at_us: u64, now: Instant, now_us: i64) -> Instant {
    let ago =
        u64::try_from(now_us.saturating_sub(i64::try_from(at_us).unwrap_or(i64::MAX))).unwrap_or(0);
    now.checked_sub(Duration::from_micros(ago)).unwrap_or(now)
}

pub fn clear_shortcut() {
    if let Ok(mut until) = SHORTCUT_UNTIL.lock() {
        *until = None;
    }
}

/// ReserveStopShortcut token: follows a capture and its configured chord, not UI revisions.
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
        .filter(|value| is_preset_accelerator(value))?;
    Some(format!("{session}/{accelerator}"))
}

fn valid_shortcut_reservation(state: &serde_json::Value, token: &str) -> bool {
    stop_shortcut_token(state).as_deref() == Some(token)
}

/// Wake only the attached shell when authoritative state changes; meter frames
/// remain bounded polling and no state is broadcast to unrelated bus clients.
/// A companion that asks for work hears of it through its pending call; an
/// earlier one listens for Changed.
pub fn publish() {
    if companion_asks_for_work() {
        if let Some(context) = SERVE_CONTEXT
            .lock()
            .ok()
            .and_then(|context| context.clone())
        {
            context.invoke(|| give(Request::Changed));
        }
        return;
    }
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
    if state.runtime.epoch != epoch
        || state.runtime.dictation_status != crate::tray::DictationStatus::Recording
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

/// Every method but Attach, answered only for the attached Shell connection,
/// except CompanionAsking, which any caller may ask.
fn handle(
    host: &impl Host,
    lease: &mut Lease,
    sender: &str,
    method: &str,
    parameters: &glib::Variant,
) -> Reply {
    if method == "CompanionAsking" {
        return Ok(Some((companion_asks_for_work(),).to_variant()));
    }
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
                // The ReserveShortcut grab covers every status; its chord is the plain toggle.
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
        "PasteDone" => {
            let (id, insert_us) = parameters.get::<(u32, u64)>().unwrap_or_default();
            return report_for(id, Report::Pasted(insert_us));
        }
        "PasteRefused" => {
            let (id, reason) = parameters.get::<(u32, String)>().unwrap_or_default();
            return report_for(id, Report::Refused(reason));
        }
        "ModifiersState" => {
            let (id, clear) = parameters.get::<(u32, bool)>().unwrap_or_default();
            return report_for(id, Report::Modifiers(clear));
        }
        _ => return Err(("org.voco.UnknownMethod", "Unknown panel method")),
    };
    Ok(Some((accepted,).to_variant()))
}

pub fn setup(app: &tauri::AppHandle) {
    serve(app.clone());
}

/// Owns org.voco.Panel and answers the attached Shell for host. Its calls run
/// on the thread-default main context of the caller.
fn serve<H: Host + Clone + Send + Sync + 'static>(app: H) {
    if let Ok(mut context) = SERVE_CONTEXT.lock() {
        *context = Some(glib::MainContext::ref_thread_default());
    }
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
                            app.show_tray(false);
                        }
                        invocation.return_value(Some(&(allowed,).to_variant()));
                        return;
                    }
                    // Kept until VOCO has work for the companion: a confined
                    // VOCO can only answer the Shell (AGENTS.md).
                    if method == "NextRequest" {
                        if !lease.admits(sender) {
                            invocation.return_dbus_error(
                                "org.voco.NotAttached",
                                "Attach from GNOME Shell first",
                            );
                            return;
                        }
                        if let Ok(mut asking) = ASKING.lock() {
                            *asking = Some(sender.to_owned());
                        }
                        hold_request(invocation);
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
        move |_, _| {
            crate::panel_setup::invalidate_check();
            lost_app.show_tray(true);
        },
    );
}

/// For insertion.rs's private-desktop paste test, which pastes as one process
/// per chunk: serves the panel bridge for an idle host and returns once the
/// session's companion has attached and asked for work.
#[cfg(test)]
pub(crate) fn serve_for_fixture(timeout: Duration) -> Result<(), String> {
    #[derive(Clone)]
    struct Idle;
    impl Host for Idle {
        fn snapshot(&self) -> Option<serde_json::Value> {
            Some(
                serde_json::json!({"version": 1, "token": "fixture", "stopSession": "", "status": "idle",
                "description": "Ready", "canStop": false, "canOpen": false, "level": 0}),
            )
        }
        fn toggle(&self) {}
        fn action(&self, _action: &str, _token: &str) -> bool {
            false
        }
        fn show_tray(&self, _visible: bool) {}
    }
    std::thread::spawn(|| {
        let context = glib::MainContext::new();
        let _default = context.acquire().expect("a new main context");
        context
            .with_thread_default(|| {
                serve(Idle);
                glib::MainLoop::new(Some(&context), false).run();
            })
            .expect("a thread-default main context");
    });
    let started = Instant::now();
    while !companion_asks_for_work() {
        if started.elapsed() > timeout {
            return Err("GNOME Shell's companion did not ask for work".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(())
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
        // A ReserveStopShortcut token authorizes no plain toggle.
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
        for status in ["starting", "recording", "processing", "idle", "attention"] {
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

    #[test]
    fn each_request_has_its_wire_name() {
        assert_eq!(Request::Paste(4).wire(), ("paste", 4));
        assert_eq!(Request::Modifiers(5).wire(), ("modifiers", 5));
        assert_eq!(Request::Changed.wire(), ("changed", 0));
    }

    #[test]
    fn waiting_changes_coalesce_and_withdrawn_work_is_gone() {
        end_requests();
        give(Request::Changed);
        give(Request::Changed);
        give(Request::Paste(3));
        WORK.with(|work| {
            assert_eq!(
                work.borrow().queue,
                VecDeque::from([Request::Changed, Request::Paste(3)])
            );
        });
        assert!(withdraw(Request::Paste(3)));
        assert!(!withdraw(Request::Paste(3)), "already withdrawn");
        end_requests();
        WORK.with(|work| assert!(work.borrow().queue.is_empty()));
    }

    #[test]
    fn only_the_open_request_takes_a_report() {
        let _serial = serial();
        let (report, reports) = mpsc::channel();
        *OPEN.lock().unwrap() = Some(Open { id: 5, report });
        assert_eq!(
            report_for(4, Report::Pasted(9)),
            Err(("org.voco.UnknownRequest", "No such request is open"))
        );
        assert_eq!(report_for(5, Report::Pasted(9)), Ok(None));
        assert_eq!(reports.try_recv(), Ok(Report::Pasted(9)));
        *OPEN.lock().unwrap() = None;
    }

    #[test]
    fn refusals_typed_nothing_and_a_cut_gesture_may_have() {
        for reason in ["ModifiersHeld", "Busy", "Unfamiliar"] {
            assert!(
                matches!(refusal(reason), CompanionPasteError::NoMutation(_)),
                "{reason}"
            );
        }
        assert!(matches!(
            refusal("Disabled"),
            CompanionPasteError::Uncertain(_)
        ));
    }

    #[test]
    fn work_goes_to_the_shell_that_asked_in_this_attachment() {
        let _serial = serial();
        set_owner(Some(":1.5".into()));
        assert!(!companion_asks_for_work(), "attached, not yet asking");
        *ASKING.lock().unwrap() = Some(":1.5".into());
        assert!(companion_asks_for_work());
        set_owner(Some(":1.6".into()));
        assert!(!companion_asks_for_work(), "a new attachment asks again");
        set_owner(None);
    }

    #[test]
    fn any_caller_learns_whether_the_companion_asks_for_work() {
        let _serial = serial();
        let host = fake(idle(Some("<Alt>d")));
        let mut lease = attach(":1.5");
        let ask = |lease: &mut Lease, sender: &str| {
            call(&host, lease, sender, "CompanionAsking", ().to_variant())
        };
        // `voco --check-desktop-input` in the snap asks from its own connection.
        assert_eq!(ask(&mut Lease::default(), ":1.9"), Ok(false));
        *ASKING.lock().unwrap() = Some(":1.5".into());
        assert_eq!(ask(&mut Lease::default(), ":1.9"), Ok(true));
        assert_eq!(ask(&mut lease, ":1.5"), Ok(true));
        assert!(lease.admits(":1.5"), "asking changes no lease");
        set_owner(None);
        assert_eq!(ask(&mut Lease::default(), ":1.9"), Ok(false));
        let info = gio::DBusNodeInfo::for_xml(XML).unwrap();
        let interface = info.lookup_interface(INTERFACE).unwrap();
        assert!(interface.lookup_method("CompanionAsking").is_some());
    }

    #[test]
    fn the_voco_serving_the_bridge_answers_for_itself() {
        let _serial = serial();
        *SERVE_CONTEXT.lock().unwrap() = Some(glib::MainContext::new());
        set_owner(Some(":1.5".into()));
        assert_eq!(companion_asks_for_voco(), Some(false));
        *ASKING.lock().unwrap() = Some(":1.5".into());
        assert_eq!(companion_asks_for_voco(), Some(true));
        set_owner(None);
        *SERVE_CONTEXT.lock().unwrap() = None;
    }

    #[test]
    fn work_no_call_took_is_withdrawn_and_typed_nothing() {
        let _serial = serial();
        // A serving thread with no pending call: the paste waits in its queue.
        let (ready, serving) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let context = glib::MainContext::new();
            let main = glib::MainLoop::new(Some(&context), false);
            context
                .with_thread_default(|| {
                    ready.send((context.clone(), main.clone())).unwrap();
                    main.run();
                })
                .unwrap();
        });
        let (context, main) = serving.recv().unwrap();
        *SERVE_CONTEXT.lock().unwrap() = Some(context);
        assert_eq!(
            ask(Request::Paste(8), 8, Duration::from_millis(50)),
            Err(Unanswered::NeverTaken)
        );
        assert!(OPEN.lock().unwrap().is_none(), "the request is closed");
        *SERVE_CONTEXT.lock().unwrap() = None;
        main.quit();
        thread.join().unwrap();
    }

    #[test]
    fn the_companions_insert_time_becomes_an_instant() {
        let now = Instant::now();
        assert_eq!(
            now.duration_since(instant_at(9_000, now, 10_000)),
            Duration::from_micros(1_000)
        );
        // A time after now, or beyond any clock, is now.
        assert_eq!(instant_at(11_000, now, 10_000), now);
        assert_eq!(instant_at(u64::MAX, now, 10_000), now);
    }
}
