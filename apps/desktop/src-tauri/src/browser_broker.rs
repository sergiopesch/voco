//! Exact-field browser broker. Only a matching recipient receipt proves mutation.
use crate::browser_protocol::{self as protocol, BrowserMessage};
use crate::browser_socket;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::net::Shutdown;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CLAIM_TTL: Duration = Duration::from_secs(2);
const SESSION_TTL: Duration = Duration::from_secs(600);
const RECEIPT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTrigger {
    pub trigger_id: String,
    pub mode: String,
    pub provider: String,
    pub action: String,
}
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub available: bool,
    pub ready: bool,
    pub setup_state: String,
    pub detail: String,
    pub session_id: Option<u64>,
    pub engine_active: bool,
    pub focus_lost: bool,
    pub progressive_commit_active: bool,
    pub committed_character_count: usize,
    pub ownership_intact: bool,
    pub finalization_outcome: Option<String>,
    pub error: Option<String>,
}
struct Connection {
    id: u64,
    stream: UnixStream,
}
struct Trigger {
    token: String,
    document: String,
    connection: u64,
    issued: Instant,
}
struct Session {
    id: u64,
    token: String,
    document: String,
    connection: u64,
    issued: Instant,
    sequence: u64,
    committed: String,
    valid: bool,
    claimed: bool,
    finalized: bool,
    uncertain: bool,
    stop_seen: bool,
}
#[derive(Clone)]
struct Pending {
    request_id: String,
    token: String,
    document: String,
    connection: u64,
    sequence: u64,
    expected: usize,
    appended: usize,
    receipt: Option<(String, usize)>,
}
#[derive(Default)]
struct State {
    connection: Option<Connection>,
    next_connection: u64,
    next_request: u64,
    next_session: u64,
    trigger: Option<Trigger>,
    session: Option<Session>,
    pending: Option<Pending>,
    used_tokens: HashSet<String>,
    last_trigger: Option<(String, String, bool)>,
}
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}
#[derive(Clone)]
pub struct BrowserBroker {
    shared: Arc<Shared>,
}

impl BrowserBroker {
    pub fn bind(
        on_trigger: impl Fn(BrowserTrigger) -> bool + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let path = browser_socket::socket_path(true)?;
        if path.exists() {
            browser_socket::validate_socket(&path)?;
            match UnixStream::connect(&path) {
                Ok(_) => return Err("A browser broker is already running.".into()),
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
                    fs::remove_file(&path).map_err(|_| "Cannot remove stale browser socket.")?
                }
                Err(_) => return Err("Cannot inspect existing browser socket.".into()),
            }
        }
        let listener = UnixListener::bind(&path).map_err(|_| "Cannot bind browser socket.")?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| "Cannot secure browser socket.")?;
        let broker = Self::empty();
        let shared = broker.shared.clone();
        let callback = Arc::new(on_trigger);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if browser_socket::validate_peer(&stream).is_err() {
                    continue;
                }
                let shared = shared.clone();
                let callback = callback.clone();
                std::thread::spawn(move || connection_loop(shared, stream, callback));
            }
        });
        Ok(broker)
    }
    fn empty() -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State::default()),
                changed: Condvar::new(),
            }),
        }
    }
    pub fn get_status(&self) -> BrowserStatus {
        self.shared
            .state
            .lock()
            .map(|s| status(&s))
            .unwrap_or_default()
    }
    pub fn session_status(&self, session_id: u64) -> Result<BrowserStatus, String> {
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| "Browser state unavailable.")?;
        if state.session.as_ref().map(|s| s.id) != Some(session_id) {
            return Err("Unknown browser session.".into());
        }
        Ok(status(&state))
    }
    pub fn start(&self, session_id: u64, trigger_id: &str) -> Result<BrowserStatus, String> {
        let token = trigger_id
            .strip_prefix("browser:")
            .ok_or("Unqualified browser trigger.")?;
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| "Browser state unavailable.")?;
        if session_id == 0
            || state.pending.is_some()
            || state
                .session
                .as_ref()
                .is_some_and(|s| s.valid && !s.finalized)
        {
            return Err("A browser session is already active.".into());
        }
        let trigger = state
            .trigger
            .as_ref()
            .ok_or("Browser trigger is unavailable.")?;
        if trigger.token != token
            || trigger.issued.elapsed() > CLAIM_TTL
            || state.used_tokens.contains(token)
        {
            return Err("Browser trigger is stale or already used.".into());
        }
        let trigger = state.trigger.take().expect("checked trigger");
        // Bound replay memory; connection replacement clears it and changes provenance.
        if state.used_tokens.len() >= 1000 {
            return Err("Browser connection trigger limit reached; reconnect it.".into());
        }
        state.used_tokens.insert(token.into());
        state.next_session = state
            .next_session
            .checked_add(1)
            .ok_or("Browser session counter exhausted.")?;
        let allocated_session_id = state.next_session;
        state.session = Some(Session {
            id: allocated_session_id,
            token: token.into(),
            document: trigger.document,
            connection: trigger.connection,
            issued: Instant::now(),
            sequence: 0,
            committed: String::new(),
            valid: true,
            claimed: false,
            finalized: false,
            uncertain: false,
            stop_seen: false,
        });
        drop(state);
        self.request(allocated_session_id, "claim", "", "", false)
    }
    pub fn append(
        &self,
        session_id: u64,
        expected_committed_text: &str,
        append_text: &str,
        finalize: bool,
    ) -> Result<BrowserStatus, String> {
        self.request(
            session_id,
            "append",
            expected_committed_text,
            append_text,
            finalize,
        )
    }
    pub fn commit(&self, session_id: u64, full_text: &str) -> Result<BrowserStatus, String> {
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| "Browser state unavailable.")?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.id == session_id)
            .ok_or("Unknown browser session.")?;
        let prefix = session.committed.clone();
        let suffix = full_text
            .strip_prefix(&prefix)
            .ok_or("Browser committed prefix changed.")?
            .to_owned();
        drop(state);
        self.append(session_id, &prefix, &suffix, true)
    }
    /// End the recording's browser authorization, even if its claim never succeeded.
    /// Unknown or stale tokens are idempotent and cannot affect another session.
    pub fn release(&self, trigger_id: &str) -> Result<(), String> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| "Browser state unavailable.")?;
        release_token(&mut state, trigger_id);
        self.shared.changed.notify_all();
        Ok(())
    }
    pub fn cancel(&self, session_id: u64) -> Result<BrowserStatus, String> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| "Browser state unavailable.")?;
        let session = state
            .session
            .as_mut()
            .filter(|s| s.id == session_id)
            .ok_or("Unknown browser session.")?;
        session.valid = false;
        let message = json!({"protocol":protocol::PROTOCOL,"type":"revoke","token":session.token,"documentId":session.document});
        if let Some(connection) = state.connection.as_mut() {
            let _ = send(&mut connection.stream, &message);
        }
        self.shared.changed.notify_all();
        Ok(status(&state))
    }
    fn request(
        &self,
        sid: u64,
        kind: &str,
        prefix: &str,
        text: &str,
        finalize: bool,
    ) -> Result<BrowserStatus, String> {
        if text.len() > protocol::MAX_TEXT {
            return Err("Browser append exceeds size limit.".into());
        }
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| "Browser state unavailable.")?;
        if state.pending.is_some() {
            return Err("Browser mutation already pending.".into());
        }
        let session = state
            .session
            .as_ref()
            .filter(|s| s.id == sid)
            .ok_or("Unknown browser session.")?;
        if !session.valid
            || session.finalized
            || session.issued.elapsed() > SESSION_TTL
            || session.committed != prefix
            || (kind == "append" && !session.claimed)
            || session.sequence >= 1000
            || session.committed.len() + text.len() > 1_000_000
        {
            return Err(
                "Browser target ownership is unavailable or committed prefix changed.".into(),
            );
        }
        let sequence = if kind == "claim" {
            0
        } else {
            session.sequence + 1
        };
        let pending = Pending {
            request_id: format!("{}:{}", session.connection, state.next_request),
            token: session.token.clone(),
            document: session.document.clone(),
            connection: session.connection,
            sequence,
            expected: prefix.chars().count(),
            appended: text.chars().count(),
            receipt: None,
        };
        state.next_request = state
            .next_request
            .checked_add(1)
            .ok_or("Browser request counter exhausted.")?;
        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "System clock cannot bound browser delivery.")?
            .as_millis()
            .checked_add(1500)
            .ok_or("Browser deadline overflow.")?;
        let mut message = json!({"protocol":protocol::PROTOCOL,"type":kind,"requestId":pending.request_id,"token":pending.token,"documentId":pending.document,
            "sequence":sequence,"expectedCommittedCharacters":pending.expected,"expiresAt":expires_at});
        if kind == "append" {
            message["text"] = text.into();
            message["final"] = finalize.into();
        }
        state.pending = Some(pending.clone());
        let sent = state
            .connection
            .as_mut()
            .filter(|c| c.id == pending.connection)
            .ok_or_else(|| "Browser disconnected.".to_string())
            .and_then(|c| send(&mut c.stream, &message));
        if sent.is_err() {
            invalidate(&mut state, true);
            state.pending = None;
            return Err("Browser delivery is uncertain; automatic retry is disabled.".into());
        }
        let deadline = Instant::now() + RECEIPT_TIMEOUT;
        loop {
            if let Some((outcome, count)) = state.pending.as_ref().and_then(|p| p.receipt.clone()) {
                state.pending = None;
                let session = state
                    .session
                    .as_mut()
                    .filter(|s| s.id == sid)
                    .ok_or("Browser session changed.")?;
                if outcome == "applied" {
                    // The receipt proves this exact mutation even if a subsequent
                    // focus invalidation arrived before this waiter woke.
                    session.uncertain = false;
                    session.committed.push_str(text);
                    session.sequence = sequence;
                    session.claimed = true;
                    session.finalized = finalize;
                    if count != session.committed.chars().count() {
                        session.valid = false;
                        session.uncertain = true;
                        return Err("Browser receipt count mismatch.".into());
                    }
                    return Ok(status(&state));
                }
                session.valid = false;
                session.uncertain = outcome == "uncertain";
                return Err(if outcome == "rejected" {
                    "Browser target changed; text was not inserted."
                } else {
                    "Browser delivery is uncertain; automatic retry is disabled."
                }
                .into());
            }
            if !state
                .session
                .as_ref()
                .is_some_and(|s| s.id == sid && s.valid)
                || Instant::now() >= deadline
            {
                invalidate(&mut state, true);
                state.pending = None;
                return Err("Browser delivery is uncertain; automatic retry is disabled.".into());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            state = self
                .shared
                .changed
                .wait_timeout(state, remaining)
                .map_err(|_| "Browser state unavailable.")?
                .0;
        }
    }
}
fn release_token(state: &mut State, trigger_id: &str) {
    let Some(token) = trigger_id
        .strip_prefix("browser:")
        .filter(|t| protocol::opaque_id(t))
    else {
        return;
    };
    let target = if let Some(session) = state.session.as_mut().filter(|s| s.token == token) {
        session.valid = false;
        session.stop_seen = true;
        Some((session.document.clone(), session.connection))
    } else if let Some((_, document, _)) =
        state.last_trigger.as_ref().filter(|(t, _, _)| t == token)
    {
        state.connection.as_ref().map(|c| (document.clone(), c.id))
    } else {
        None
    };
    let Some((document, connection_id)) = target else {
        return;
    };
    if state.trigger.as_ref().is_some_and(|t| t.token == token) {
        state.trigger = None;
    }
    if let Some((_, _, stopped)) = state.last_trigger.as_mut().filter(|(t, _, _)| t == token) {
        *stopped = true;
    }
    if state.used_tokens.len() < 1000 {
        state.used_tokens.insert(token.into());
    }
    if let Some(connection) = state.connection.as_mut().filter(|c| c.id == connection_id) {
        let _ = send(
            &mut connection.stream,
            &json!({"protocol":protocol::PROTOCOL,"type":"cancel","token":token,"documentId":document}),
        );
    }
}
fn status(state: &State) -> BrowserStatus {
    let active = state.session.as_ref();
    let connected = state.connection.is_some();
    let finalized = active.is_some_and(|s| s.finalized && !s.uncertain);
    let valid = active.is_some_and(|s| s.valid && s.claimed && s.issued.elapsed() <= SESSION_TTL);
    BrowserStatus {
        available: connected,
        ready: valid || finalized,
        setup_state: if valid { "ready" } else { "safety-disabled" }.into(),
        detail: "Automatic delivery requires a current exact-field browser authorization.".into(),
        session_id: active.map(|s| s.id),
        engine_active: connected || finalized,
        focus_lost: !finalized && active.is_some_and(|s| !s.valid),
        progressive_commit_active: active.is_some_and(|s| !s.committed.is_empty()),
        committed_character_count: active.map_or(0, |s| s.committed.chars().count()),
        ownership_intact: valid || finalized,
        finalization_outcome: active.and_then(|s| {
            if s.uncertain {
                Some("uncertain".into())
            } else if s.finalized {
                Some("committed".into())
            } else {
                None
            }
        }),
        error: None,
    }
}
fn send(stream: &mut UnixStream, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "Browser serialization failed.")?;
    protocol::write_frame(stream, &bytes).map_err(|_| "Browser transport failed.".into())
}
fn invalidate(state: &mut State, uncertain: bool) {
    state.trigger = None;
    if let Some(s) = state.session.as_mut() {
        s.valid = false;
        if !s.finalized {
            s.uncertain |= uncertain;
        }
    }
}
fn connection_loop(
    shared: Arc<Shared>,
    mut stream: UnixStream,
    callback: Arc<dyn Fn(BrowserTrigger) -> bool + Send + Sync>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let hello = protocol::read_frame(&mut stream)
        .ok()
        .and_then(|f| serde_json::from_slice::<BrowserMessage>(&f).ok());
    if !matches!(hello, Some(BrowserMessage::Hello { protocol: 1, ref client, ref capabilities }) if client == "chromium" && capabilities == &["plain-text-atomic-v1"])
    {
        return;
    }
    let _ = stream.set_read_timeout(None);
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let writer = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let id;
    {
        let Ok(mut state) = shared.state.lock() else {
            return;
        };
        // One extension connection at a time; a competing peer cannot replace an
        // authorized live session. Restart/reconnect requires the old connection close.
        if state.connection.is_some() {
            return;
        }
        state.next_connection += 1;
        id = state.next_connection;
        state.connection = Some(Connection { id, stream: writer });
        state.used_tokens.clear();
        state.last_trigger = None;
    }
    if send(
        &mut stream,
        &json!({"protocol":protocol::PROTOCOL,"type":"ready","capabilities":["plain-text-atomic-v1"]}),
    )
    .is_err()
    {
        disconnect(&shared, id, &callback);
        return;
    }
    while let Ok(frame) = protocol::read_frame(&mut stream) {
        let message = match serde_json::from_slice::<BrowserMessage>(&frame) {
            Ok(m) => m,
            Err(_) => break,
        };
        let event = {
            let Ok(mut state) = shared.state.lock() else {
                break;
            };
            match receive(&mut state, id, message) {
                Ok(event) => event,
                Err(()) => break,
            }
        };
        shared.changed.notify_all();
        if let Some(event) = event {
            let trigger_id = event.trigger_id.clone();
            if !callback(event) {
                if let Ok(mut state) = shared.state.lock() {
                    release_token(&mut state, &trigger_id);
                }
                shared.changed.notify_all();
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    disconnect(&shared, id, &callback);
}
fn disconnect(
    shared: &Shared,
    id: u64,
    callback: &Arc<dyn Fn(BrowserTrigger) -> bool + Send + Sync>,
) {
    let stops = if let Ok(mut state) = shared.state.lock() {
        if state.connection.as_ref().is_none_or(|c| c.id != id) {
            Vec::new()
        } else {
            state.connection = None;
            let mut tokens = Vec::with_capacity(2);
            if let Some(session) = state.session.as_mut().filter(|s| s.connection == id) {
                if !session.stop_seen {
                    session.stop_seen = true;
                    tokens.push(session.token.clone());
                }
            }
            if let Some((token, _, stopped)) = state.last_trigger.as_mut() {
                if !*stopped {
                    *stopped = true;
                    if !tokens.contains(token) {
                        tokens.push(token.clone());
                    }
                }
            }
            invalidate(&mut state, true);
            tokens
        }
    } else {
        Vec::new()
    };
    shared.changed.notify_all();
    for token in stops {
        // The connection is gone, but each unreleased token still owns its Stop.
        let _ = callback(BrowserTrigger {
            trigger_id: format!("browser:{token}"),
            mode: "dictation".into(),
            provider: "chromium".into(),
            action: "stop".into(),
        });
    }
}
fn receive(
    state: &mut State,
    connection: u64,
    message: BrowserMessage,
) -> Result<Option<BrowserTrigger>, ()> {
    if state.connection.as_ref().is_none_or(|c| c.id != connection) {
        return Err(());
    }
    match message {
        BrowserMessage::Trigger {
            protocol: 1,
            token,
            document_id,
            mode,
        } if protocol::opaque_id(&token)
            && protocol::opaque_id(&document_id)
            && mode == "dictation" =>
        {
            if state.used_tokens.contains(&token)
                || state.trigger.as_ref().is_some_and(|t| t.token == token)
            {
                return Err(());
            }
            if state
                .session
                .as_ref()
                .is_some_and(|s| s.valid && !s.finalized)
            {
                if let Some(connection) = state.connection.as_mut() {
                    send(&mut connection.stream, &json!({"protocol":protocol::PROTOCOL,"type":"cancel","token":token,"documentId":document_id})).map_err(|_| ())?;
                }
                return Ok(None);
            }
            if state.used_tokens.len() >= 1000 {
                return Err(());
            }
            let event = BrowserTrigger {
                trigger_id: format!("browser:{token}"),
                mode,
                provider: "chromium".into(),
                action: "start".into(),
            };
            state.last_trigger = Some((token.clone(), document_id.clone(), false));
            state.trigger = Some(Trigger {
                token,
                document: document_id,
                connection,
                issued: Instant::now(),
            });
            Ok(Some(event))
        }
        BrowserMessage::Stop {
            protocol: 1,
            token,
            document_id,
        } => {
            if let Some(session) = state.session.as_mut().filter(|s| {
                s.token == token && s.document == document_id && s.connection == connection
            }) {
                if session.stop_seen {
                    return Ok(None);
                }
                session.stop_seen = true;
                if let Some((_, _, stopped)) = state
                    .last_trigger
                    .as_mut()
                    .filter(|(t, d, _)| t == &token && d == &document_id)
                {
                    *stopped = true;
                }
            } else if let Some((last_token, last_document, stopped)) = state
                .last_trigger
                .as_mut()
                .filter(|(t, d, _)| t == &token && d == &document_id)
            {
                let _ = (last_token, last_document);
                if *stopped {
                    return Ok(None);
                }
                *stopped = true;
                state.trigger = None;
                state.used_tokens.insert(token.clone());
            } else {
                return Ok(None);
            }
            Ok(Some(BrowserTrigger {
                trigger_id: format!("browser:{token}"),
                mode: "dictation".into(),
                provider: "chromium".into(),
                action: "stop".into(),
            }))
        }
        BrowserMessage::Invalidate {
            protocol: 1,
            token,
            document_id,
            reason,
        } => {
            if reason.len() > 64 {
                return Err(());
            }
            if state
                .trigger
                .as_ref()
                .is_some_and(|t| t.token == token && t.document == document_id)
            {
                state.trigger = None;
            }
            if let Some(s) = state.session.as_mut().filter(|s| {
                s.token == token && s.document == document_id && s.connection == connection
            }) {
                s.valid = false;
            }
            Ok(None)
        }
        BrowserMessage::Receipt {
            protocol: 1,
            request_id,
            token,
            document_id,
            sequence,
            expected_committed_characters,
            outcome,
            committed_characters,
            reason,
        } => {
            let p = state.pending.as_mut().ok_or(())?;
            if p.receipt.is_some()
                || p.connection != connection
                || p.request_id != request_id
                || p.token != token
                || p.document != document_id
                || p.sequence != sequence
                || p.expected != expected_committed_characters
                || reason.as_ref().is_some_and(|r| r.len() > 64)
            {
                return Err(());
            }
            let valid_count = match outcome.as_str() {
                "applied" => committed_characters == p.expected + p.appended,
                "rejected" | "uncertain" => committed_characters == p.expected,
                _ => false,
            };
            if !valid_count {
                return Err(());
            }
            p.receipt = Some((outcome, committed_characters));
            Ok(None)
        }
        _ => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    fn fixture() -> (BrowserBroker, UnixStream, mpsc::Receiver<BrowserTrigger>) {
        fixture_with_admission(true)
    }
    fn fixture_with_admission(
        admitted: bool,
    ) -> (BrowserBroker, UnixStream, mpsc::Receiver<BrowserTrigger>) {
        let broker = BrowserBroker::empty();
        let (mut browser, native) = UnixStream::pair().unwrap();
        browser
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let (tx, rx) = mpsc::channel();
        let shared = broker.shared.clone();
        std::thread::spawn(move || {
            connection_loop(
                shared,
                native,
                Arc::new(move |t| tx.send(t).is_ok() && admitted),
            )
        });
        send(&mut browser, &json!({"protocol":protocol::PROTOCOL,"type":"hello","client":"chromium","capabilities":["plain-text-atomic-v1"]})).unwrap();
        assert_eq!(read(&mut browser)["type"], "ready");
        (broker, browser, rx)
    }
    fn read(browser: &mut UnixStream) -> Value {
        serde_json::from_slice(&protocol::read_frame(browser).unwrap()).unwrap()
    }
    fn trigger(browser: &mut UnixStream, rx: &mpsc::Receiver<BrowserTrigger>) -> String {
        send(browser, &json!({"protocol":protocol::PROTOCOL,"type":"trigger","token":"a".repeat(48),"documentId":"b".repeat(48),"mode":"dictation"})).unwrap();
        rx.recv_timeout(Duration::from_secs(1)).unwrap().trigger_id
    }
    fn receipt(request: &Value, outcome: &str, count: usize) -> Value {
        json!({"protocol":protocol::PROTOCOL,"type":"receipt","requestId":request["requestId"],"token":request["token"],"documentId":request["documentId"],
            "sequence":request["sequence"],"expectedCommittedCharacters":request["expectedCommittedCharacters"],"outcome":outcome,"committedCharacters":count})
    }
    fn claim(broker: &BrowserBroker, browser: &mut UnixStream, id: String) {
        let worker = broker.clone();
        let thread = std::thread::spawn(move || worker.start(7, &id));
        let request = read(browser);
        assert_eq!(request["type"], "claim");
        send(browser, &receipt(&request, "applied", 0)).unwrap();
        assert!(thread.join().unwrap().unwrap().ready);
    }
    #[test]
    fn claim_then_unicode_append_and_final_receipts_are_exact() {
        let (broker, mut browser, rx) = fixture();
        assert!(!broker.get_status().ready);
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        assert!(broker.start(8, &id).is_err());
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.append(1, "", "é🦀", false));
        let request = read(&mut browser);
        assert_eq!(request["sequence"], 1);
        send(&mut browser, &receipt(&request, "applied", 2)).unwrap();
        assert_eq!(t.join().unwrap().unwrap().committed_character_count, 2);
        assert!(broker.append(1, "wrong", "x", false).is_err());
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.commit(1, "é🦀你好"));
        let request = read(&mut browser);
        assert_eq!(request["text"], "你好");
        assert_eq!(request["final"], true);
        send(&mut browser, &receipt(&request, "applied", 4)).unwrap();
        let status = t.join().unwrap().unwrap();
        assert_eq!(status.committed_character_count, 4);
        assert_eq!(status.finalization_outcome.as_deref(), Some("committed"));
        assert!(status.engine_active);
        assert!(broker.append(1, "é🦀你好", "x", false).is_err());
    }
    #[test]
    fn every_receipt_identity_and_count_is_required() {
        for field in [
            "requestId",
            "token",
            "documentId",
            "sequence",
            "expectedCommittedCharacters",
            "committedCharacters",
            "protocol",
            "outcome",
        ] {
            let (broker, mut browser, rx) = fixture();
            let id = trigger(&mut browser, &rx);
            claim(&broker, &mut browser, id);
            let worker = broker.clone();
            let t = std::thread::spawn(move || worker.append(1, "", "safe", true));
            let request = read(&mut browser);
            let mut answer = receipt(&request, "applied", 4);
            answer[field] = if answer[field].is_number() {
                json!(99)
            } else {
                json!("wrong")
            };
            send(&mut browser, &answer).unwrap();
            assert!(t.join().unwrap().is_err(), "{field}");
            assert_eq!(
                broker.session_status(1).unwrap().committed_character_count,
                0
            );
            assert!(broker.commit(1, "safe").is_err());
        }
    }
    #[test]
    fn invalidated_target_never_reclaims_same_token_and_stop_is_explicit() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        send(&mut browser, &json!({"protocol":protocol::PROTOCOL,"type":"invalidate","token":"a".repeat(48),"documentId":"b".repeat(48),"reason":"focus-changed"})).unwrap();
        send(
            &mut browser,
            &json!({"protocol":protocol::PROTOCOL,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)}),
        )
        .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().action,
            "stop"
        );
        assert!(!broker.session_status(1).unwrap().ownership_intact);
        assert!(broker.commit(1, "no redirect").is_err());
        assert!(broker.start(8, &id).is_err());
    }
    #[test]
    fn terminal_tab_loss_revokes_delivery_before_stop_without_content_reply() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        send(&mut browser, &json!({"protocol":1,"type":"invalidate","token":"a".repeat(48),"documentId":"b".repeat(48),"reason":"disconnected"})).unwrap();
        send(
            &mut browser,
            &json!({"protocol":1,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)}),
        )
        .unwrap();
        let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(event.trigger_id, id);
        assert_eq!(event.action, "stop");
        assert!(!broker.session_status(1).unwrap().ownership_intact);
        assert!(broker.append(1, "", "no redirect", true).is_err());
    }
    #[test]
    fn native_disconnect_stops_recording_after_focus_loss_once() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        send(&mut browser, &json!({"protocol":1,"type":"invalidate","token":"a".repeat(48),"documentId":"b".repeat(48),"reason":"focus-changed"})).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
        drop(browser);
        let stop = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(stop.trigger_id, id);
        assert_eq!(stop.action, "stop");
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
    }
    #[test]
    fn native_disconnect_does_not_repeat_manual_stop() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        send(
            &mut browser,
            &json!({"protocol":1,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)}),
        )
        .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().action,
            "stop"
        );
        drop(browser);
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
    }
    #[test]
    fn native_disconnect_stops_pending_trigger_before_claim() {
        let (_broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        drop(browser);
        let stop = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(stop.trigger_id, id);
        assert_eq!(stop.action, "stop");
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
    }
    #[test]
    fn native_disconnect_stops_distinct_unreleased_session_and_pending_trigger() {
        let (broker, mut browser, rx) = fixture();
        let first = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, first.clone());
        send(&mut browser, &json!({"protocol":1,"type":"invalidate","token":"a".repeat(48),"documentId":"b".repeat(48),"reason":"focus-changed"})).unwrap();
        send(&mut browser, &json!({"protocol":1,"type":"trigger","token":"c".repeat(48),"documentId":"d".repeat(48),"mode":"dictation"})).unwrap();
        let second = rx.recv_timeout(Duration::from_secs(1)).unwrap().trigger_id;
        drop(browser);
        let stops = [
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        ];
        assert_eq!(stops[0].trigger_id, first);
        assert_eq!(stops[1].trigger_id, second);
        assert!(stops.iter().all(|event| event.action == "stop"));
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
    }
    #[test]
    fn released_recording_does_not_stop_again_on_disconnect() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        broker.release(&id).unwrap();
        assert_eq!(read(&mut browser)["type"], "cancel");
        drop(browser);
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
    }
    #[test]
    fn disconnect_after_dispatch_is_uncertain_and_never_replayed() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id);
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.commit(1, "maybe inserted"));
        let _request = read(&mut browser);
        drop(browser);
        assert!(t.join().unwrap().unwrap_err().contains("uncertain"));
        assert_eq!(
            broker
                .session_status(1)
                .unwrap()
                .finalization_outcome
                .as_deref(),
            Some("uncertain")
        );
        assert!(broker.commit(1, "maybe inserted").is_err());
    }
    #[test]
    fn unanswered_claim_expires_without_retry() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.start(7, &id));
        let _request = read(&mut browser);
        assert!(t.join().unwrap().is_err());
        browser
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        assert!(protocol::read_frame(&mut browser).is_err());
    }
    #[test]
    fn released_unclaimed_trigger_can_never_be_claimed() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        broker.release(&id).unwrap();
        let cancel = read(&mut browser);
        assert_eq!(cancel["type"], "cancel");
        assert_eq!(cancel["token"], "a".repeat(48));
        assert!(broker.start(7, &id).is_err());
        assert!(broker.get_status().available);
    }
    #[test]
    fn rejected_frontend_admission_cancels_only_its_token() {
        let (broker, mut browser, rx) = fixture_with_admission(false);
        let id = trigger(&mut browser, &rx);
        assert_eq!(read(&mut browser)["type"], "cancel");
        assert!(broker.start(7, &id).is_err());
        assert!(broker.get_status().available);
    }
    #[test]
    fn competing_new_tab_is_canceled_without_revoking_active_owner() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id);
        send(&mut browser, &json!({"protocol":1,"type":"trigger","token":"c".repeat(48),"documentId":"d".repeat(48),"mode":"dictation"})).unwrap();
        let cancel = read(&mut browser);
        assert_eq!(cancel["type"], "cancel");
        assert_eq!(cancel["token"], "c".repeat(48));
        assert!(broker.session_status(1).unwrap().ownership_intact);
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
    }
    #[test]
    fn revoked_delivery_preserves_stop_until_recording_release() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        broker.cancel(1).unwrap();
        assert_eq!(read(&mut browser)["type"], "revoke");
        assert!(!broker.session_status(1).unwrap().ownership_intact);
        assert!(broker.append(1, "", "unsafe", true).is_err());
        let stop =
            json!({"protocol":1,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)});
        send(&mut browser, &stop).unwrap();
        let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(event.trigger_id, id);
        assert_eq!(event.action, "stop");
        send(&mut browser, &stop).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
        broker.release(&id).unwrap();
        assert_eq!(read(&mut browser)["type"], "cancel");
    }
    #[test]
    fn renderer_session_reuse_cannot_alias_native_session() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id.clone());
        broker.cancel(1).unwrap();
        assert_eq!(read(&mut browser)["type"], "revoke");
        send(&mut browser, &json!({"protocol":1,"type":"trigger","token":"c".repeat(48),"documentId":"d".repeat(48),"mode":"dictation"})).unwrap();
        let next_trigger = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.start(7, &next_trigger.trigger_id));
        let request = read(&mut browser);
        send(&mut browser, &receipt(&request, "applied", 0)).unwrap();
        let next = t.join().unwrap().unwrap();
        assert_eq!(next.session_id, Some(2));
        send(
            &mut browser,
            &json!({"protocol":1,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)}),
        )
        .unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
        assert!(broker.session_status(2).unwrap().ownership_intact);
        assert!(broker.cancel(1).is_err());
        assert!(broker.append(1, "", "stale", true).is_err());
        assert!(broker.session_status(1).is_err());
        broker.release(&id).unwrap();
        assert!(broker.session_status(2).unwrap().ownership_intact);
        browser
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        assert!(protocol::read_frame(&mut browser).is_err());
    }
    #[test]
    fn fast_stop_cancels_pending_claim_without_disconnect() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        send(
            &mut browser,
            &json!({"protocol":protocol::PROTOCOL,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)}),
        )
        .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().action,
            "stop"
        );
        assert!(broker.get_status().available);
        assert!(broker.start(7, &id).is_err());
        send(
            &mut browser,
            &json!({"protocol":protocol::PROTOCOL,"type":"stop","token":"a".repeat(48),"documentId":"b".repeat(48)}),
        )
        .unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(20)).is_err());
    }
    #[test]
    fn receipt_before_disconnect_is_authoritative_even_before_waiter_wakes() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id);
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.commit(1, "done"));
        let request = read(&mut browser);
        {
            let mut state = broker.shared.state.lock().unwrap();
            let id = state.connection.as_ref().unwrap().id;
            let message = serde_json::from_value(receipt(&request, "applied", 4)).unwrap();
            receive(&mut state, id, message).unwrap();
            state.connection = None;
            invalidate(&mut state, true);
        }
        broker.shared.changed.notify_all();
        let result = t.join().unwrap().unwrap();
        assert_eq!(result.finalization_outcome.as_deref(), Some("committed"));
        assert_eq!(result.committed_character_count, 4);
        assert!(result.engine_active && result.ownership_intact);
    }
    #[test]
    fn acknowledged_final_receipt_survives_later_disconnect() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        claim(&broker, &mut browser, id);
        let worker = broker.clone();
        let t = std::thread::spawn(move || worker.commit(1, "done"));
        let request = read(&mut browser);
        send(&mut browser, &receipt(&request, "applied", 4)).unwrap();
        assert_eq!(
            t.join().unwrap().unwrap().finalization_outcome.as_deref(),
            Some("committed")
        );
        drop(browser);
        for _ in 0..100 {
            if !broker.get_status().available {
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        let result = broker.session_status(1).unwrap();
        assert_eq!(result.finalization_outcome.as_deref(), Some("committed"));
        assert_eq!(result.committed_character_count, 4);
        assert!(result.engine_active && result.ownership_intact);
    }
    #[test]
    fn stale_trigger_rejected_and_competing_live_connection_does_not_replace_owner() {
        let (broker, mut browser, rx) = fixture();
        let id = trigger(&mut browser, &rx);
        broker
            .shared
            .state
            .lock()
            .unwrap()
            .trigger
            .as_mut()
            .unwrap()
            .issued = Instant::now() - Duration::from_secs(3);
        assert!(broker.start(7, &id).is_err());
        let (mut peer, native) = UnixStream::pair().unwrap();
        let shared = broker.shared.clone();
        std::thread::spawn(move || connection_loop(shared, native, Arc::new(|_| true)));
        send(&mut peer, &json!({"protocol":protocol::PROTOCOL,"type":"hello","client":"chromium","capabilities":["plain-text-atomic-v1"]})).unwrap();
        assert!(protocol::read_frame(&mut peer).is_err());
        assert!(broker.get_status().available);
    }
}
