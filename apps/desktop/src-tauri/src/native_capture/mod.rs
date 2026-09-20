//! Explicitly selected development capture. The worker alone owns the Pulse shim;
//! renderer requests never run inside an audio callback. Raw audit persistence is opt-in.
pub(crate) mod audit;
pub(crate) mod private_bundle;
pub mod protocol;
mod pulse;
pub(crate) mod retained;
#[cfg(test)]
mod tests;

pub use protocol::{
    BeginRequest, CaptureDescriptor, DrainRequest, Identity, Source, SourceList, StopReceipt,
};
use protocol::{Delivery, Health, MAX_FRAMES};
use pulse::{Pulse, Status};
use std::sync::{
    mpsc::{self, Receiver, SyncSender},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const LEASE: Duration = Duration::from_secs(5);
const CALL_TIMEOUT: Duration = Duration::from_secs(8);
type Reply = SyncSender<Result<Response, String>>;
enum Request {
    List,
    Select(String, bool),
    Begin(BeginRequest),
    Drain(DrainRequest),
    Stop(Identity),
    VerifyStopped(Identity),
    Cancel(Identity),
    ResetRenderer,
    Shutdown,
}
enum Response {
    Sources(SourceList),
    Source(Source),
    Descriptor(CaptureDescriptor),
    Bytes(Vec<u8>),
    Receipt(StopReceipt),
    Empty,
}
struct Envelope {
    deadline: Instant,
    request: Request,
    reply: Reply,
}
struct Shared {
    commands: SyncSender<Envelope>,
    thread: Mutex<Option<JoinHandle<()>>>,
}
impl Drop for Shared {
    fn drop(&mut self) {
        let (reply, _) = mpsc::sync_channel(1);
        let _ = self.commands.try_send(Envelope {
            deadline: Instant::now() + CALL_TIMEOUT,
            request: Request::Shutdown,
            reply,
        });
        // The worker owns all resources, observes channel disconnection/lease expiry,
        // and never references this object. Explicit shutdown provides a joined result.
    }
}
#[derive(Clone)]
pub struct NativeCaptureService {
    shared: Arc<Shared>,
}
impl NativeCaptureService {
    pub fn new() -> Result<Self, String> {
        let (commands, incoming) = mpsc::sync_channel(8);
        let worker = thread::Builder::new()
            .name("voco-native-capture".into())
            .spawn(move || worker(incoming))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            shared: Arc::new(Shared {
                commands,
                thread: Mutex::new(Some(worker)),
            }),
        })
    }
    fn call(&self, request: Request) -> Result<Response, String> {
        let (reply, result) = mpsc::sync_channel(1);
        self.shared
            .commands
            .try_send(Envelope {
                deadline: Instant::now() + CALL_TIMEOUT,
                request,
                reply,
            })
            .map_err(|_| "Native capture worker unavailable or busy".to_string())?;
        result
            .recv_timeout(CALL_TIMEOUT)
            .map_err(|_| "Native capture command deadline exceeded".to_string())?
    }
    pub fn list_sources(&self) -> Result<SourceList, String> {
        match self.call(Request::List)? {
            Response::Sources(v) => Ok(v),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn select_source(
        &self,
        selection_token: String,
        acknowledged: bool,
    ) -> Result<Source, String> {
        match self.call(Request::Select(selection_token, acknowledged))? {
            Response::Source(v) => Ok(v),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn begin(&self, request: BeginRequest) -> Result<CaptureDescriptor, String> {
        request.validate()?;
        match self.call(Request::Begin(request))? {
            Response::Descriptor(v) => Ok(v),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn drain(&self, request: DrainRequest) -> Result<Vec<u8>, String> {
        match self.call(Request::Drain(request))? {
            Response::Bytes(v) => Ok(v),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn stop(&self, identity: Identity) -> Result<StopReceipt, String> {
        match self.call(Request::Stop(identity))? {
            Response::Receipt(v) => Ok(v),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn verify_stopped(&self, identity: Identity) -> Result<(), String> {
        match self.call(Request::VerifyStopped(identity))? {
            Response::Empty => Ok(()),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn cancel(&self, identity: Identity) -> Result<(), String> {
        match self.call(Request::Cancel(identity))? {
            Response::Empty => Ok(()),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn reset_renderer(&self) -> Result<(), String> {
        match self.call(Request::ResetRenderer)? {
            Response::Empty => Ok(()),
            _ => Err("Native response mismatch".into()),
        }
    }
    pub fn shutdown(&self) -> Result<(), String> {
        self.call(Request::Shutdown)?;
        let thread = self
            .shared
            .thread
            .lock()
            .map_err(|_| "Native worker join poisoned")?
            .take();
        if let Some(thread) = thread {
            thread.join().map_err(|_| "Native worker panicked")?;
        }
        Ok(())
    }
}
struct Session {
    identity: Identity,
    delivery: Delivery,
    lease: Instant,
    failure: Option<String>,
    audit: Option<audit::Audit>,
    audit_requested: bool,
}
impl Session {
    fn check(&self, identity: &Identity) -> Result<(), String> {
        if self.identity != *identity {
            Err("Stale native capture identity".into())
        } else {
            Ok(())
        }
    }
    fn receipt(&self, status: &Status) -> StopReceipt {
        let mut reason = self.failure.clone().or_else(|| status.error.clone());
        if status.stopped && (!status.cork_ack || !status.barrier_ack) && reason.is_none() {
            reason = Some("Native stop boundary was not acknowledged".into());
        }
        StopReceipt {
            state: if status.stopped {
                "stopped"
            } else {
                "stopping"
            },
            produced_frames: status.frames,
            last_sequence: status.blocks,
            cork_acknowledged: status.cork_ack,
            barrier_acknowledged: status.barrier_ack,
            health: Health {
                healthy: reason.is_none(),
                reason,
            },
            limit_reached: status.limit_reached,
            acknowledged_sequence: self.delivery.acknowledged(),
        }
    }
}
trait CaptureBackend {
    fn connect() -> Result<Self, String>
    where
        Self: Sized;
    fn enumerate(&mut self, epoch: u64) -> Result<(u64, Vec<Source>, Option<String>), String>;
    fn begin(&mut self, source: &Source, revision: u64) -> Result<(), String>;
    fn tick(&mut self);
    fn stop(&mut self);
    fn cancel(&mut self);
    fn status(&self) -> Status;
    fn blocks(&self) -> Result<Vec<protocol::Block>, String>;
    fn ack(&mut self, count: usize) -> Result<(), String>;
}
impl CaptureBackend for Pulse {
    fn connect() -> Result<Self, String> {
        Pulse::connect()
    }
    fn enumerate(&mut self, epoch: u64) -> Result<(u64, Vec<Source>, Option<String>), String> {
        Pulse::enumerate(self, epoch)
    }
    fn begin(&mut self, source: &Source, revision: u64) -> Result<(), String> {
        Pulse::begin(self, source, revision)
    }
    fn tick(&mut self) {
        Pulse::tick(self)
    }
    fn stop(&mut self) {
        Pulse::stop(self)
    }
    fn cancel(&mut self) {
        Pulse::cancel(self)
    }
    fn status(&self) -> Status {
        Pulse::status(self)
    }
    fn blocks(&self) -> Result<Vec<protocol::Block>, String> {
        Pulse::blocks(self)
    }
    fn ack(&mut self, count: usize) -> Result<(), String> {
        Pulse::ack(self, count)
    }
}
struct Worker<B: CaptureBackend> {
    pulse: Option<B>,
    sources: Vec<Source>,
    revision: u64,
    epoch: u64,
    approved: Option<String>,
    session: Option<Session>,
    next_capture: u64,
    request_deadline: Option<Instant>,
    audit_attempted: bool,
    audit_enabled: bool,
}
impl<B: CaptureBackend> Worker<B> {
    fn new() -> Self {
        Self {
            pulse: None,
            sources: Vec::new(),
            revision: 0,
            epoch: 0,
            approved: None,
            session: None,
            next_capture: 0,
            request_deadline: None,
            audit_attempted: false,
            audit_enabled: audit::enabled(),
        }
    }
    fn pulse(&mut self) -> Result<&mut B, String> {
        self.pulse
            .as_mut()
            .ok_or_else(|| "Native source must be explicitly selected".into())
    }
    fn next_command(
        &self,
        incoming: &Receiver<Envelope>,
    ) -> Result<Envelope, mpsc::RecvTimeoutError> {
        if self.pulse.is_some() {
            // A connected backend still needs event pumping and lease checks.
            incoming.recv_timeout(Duration::from_millis(5))
        } else {
            // With no backend, tick has no work. Wake for a command or channel
            // disconnection instead of polling 200 times per second while idle.
            incoming
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        }
    }
    fn tick(&mut self) {
        if let Some(pulse) = self.pulse.as_mut() {
            pulse.tick();
            if let Some(session) = self.session.as_mut() {
                let status = pulse.status();
                if session.lease.elapsed() >= LEASE
                    && session.failure.is_none()
                    && (!status.stopped || session.delivery.acknowledged() != status.blocks)
                {
                    session.failure = Some("Renderer drain lease expired".into());
                    pulse.stop();
                }
            }
        }
        let expired_stopped = self
            .session
            .as_ref()
            .is_some_and(|session| session.failure.is_some())
            && self
                .pulse
                .as_ref()
                .is_some_and(|pulse| pulse.status().stopped);
        if expired_stopped {
            self.finish_audit("lease-expired");
        }
    }
    fn release_complete(&mut self) -> Result<(), String> {
        if let Some(session) = &self.session {
            let status = self
                .pulse
                .as_ref()
                .ok_or("Native worker state missing")?
                .status();
            if !status.stopped || session.delivery.acknowledged() != status.blocks {
                return Err("Previous native capture is not fully stopped and acknowledged".into());
            }
            if !session.receipt(&status).health.healthy {
                self.approved = None;
            }
            self.finish_audit("failure");
            self.session = None;
        }
        Ok(())
    }
    fn finish_audit(&mut self, reason: &'static str) {
        if let Some(session) = self.session.as_mut() {
            let receipt = self
                .pulse
                .as_ref()
                .map(|pulse| session.receipt(&pulse.status()));
            if let Some(audit) = session.audit.take() {
                audit.finish(reason, receipt);
            }
        }
    }
    fn dispatch(&mut self, request: Request, deadline: Instant) -> Result<Response, String> {
        if Instant::now() >= deadline {
            return Err("Native command expired before dispatch".into());
        }
        self.request_deadline = Some(deadline);
        let result = self.handle(request);
        self.request_deadline = None;
        result
    }
    fn abandon_begin(&mut self, identity: &Identity) {
        if self
            .session
            .as_ref()
            .is_some_and(|s| s.identity == *identity)
        {
            let _ = self.handle(Request::Cancel(identity.clone()));
        }
    }
    fn handle(&mut self, request: Request) -> Result<Response, String> {
        match request {
            Request::List => {
                self.release_complete()?;
                // Reconnect only while idle. No active stream is silently migrated.
                if self
                    .pulse
                    .as_ref()
                    .is_some_and(|p| p.status().error.is_some())
                {
                    self.pulse = None;
                    self.approved = None;
                }
                if self.pulse.is_none() {
                    self.pulse = Some(B::connect()?);
                    self.epoch += 1;
                }
                let epoch = self.epoch;
                let (revision, sources, default_selection_token) =
                    match self.pulse()?.enumerate(epoch) {
                        Ok(catalog) => catalog,
                        Err(error) => {
                            self.pulse = None;
                            self.approved = None;
                            self.sources.clear();
                            return Err(error);
                        }
                    };
                self.revision = revision;
                self.sources = sources.clone();
                // Catalog refresh does not grant a newly returned selection token.
                if self
                    .approved
                    .as_ref()
                    .is_some_and(|token| !sources.iter().any(|s| &s.selection_token == token))
                {
                    self.approved = None;
                }
                Ok(Response::Sources(SourceList {
                    revision: format!("{epoch}:{revision}"),
                    sources,
                    default_selection_token,
                }))
            }
            Request::Select(token, acknowledged) => {
                if !acknowledged {
                    return Err("Explicit native microphone acknowledgement is required".into());
                }
                self.release_complete()?;
                let source = self
                    .sources
                    .iter()
                    .find(|s| s.selection_token == token)
                    .cloned()
                    .ok_or("Source selection is stale")?;
                if source.object_serial.is_none() {
                    return Err(
                        "Native capture requires a PipeWire source identity; check that PipeWire and its Pulse compatibility service are running".into(),
                    );
                }
                self.approved = Some(token);
                Ok(Response::Source(source))
            }
            Request::Begin(request) => {
                request.validate()?;
                self.release_complete()?;
                if self.approved.as_deref() != Some(&request.selection_token) {
                    return Err("Native microphone selection is not acknowledged".into());
                }
                let source = self
                    .sources
                    .iter()
                    .find(|s| s.selection_token == request.selection_token)
                    .cloned()
                    .ok_or("Selected source disappeared")?;
                let mut pending_audit = if self.audit_enabled && !self.audit_attempted {
                    self.audit_attempted = true;
                    Some(audit::Audit::reserve()?)
                } else {
                    None
                };
                let revision = self.revision;
                if let Err(error) = self.pulse()?.begin(&source, revision) {
                    self.pulse()?.cancel();
                    self.pulse = None;
                    self.approved = None;
                    if let Some(audit) = pending_audit.take() {
                        audit.finish("failure", None);
                    }
                    return Err(error);
                }
                let deadline = self
                    .request_deadline
                    .unwrap_or_else(|| Instant::now() + Duration::from_secs(5))
                    .min(Instant::now() + Duration::from_secs(5));
                loop {
                    let pulse = self.pulse()?;
                    pulse.tick();
                    let status = pulse.status();
                    if let Some(error) = status.error {
                        pulse.cancel();
                        self.pulse = None;
                        self.approved = None;
                        if let Some(audit) = pending_audit.take() {
                            audit.finish("failure", None);
                        }
                        return Err(error);
                    }
                    if Instant::now() >= deadline {
                        pulse.cancel();
                        self.pulse = None;
                        self.approved = None;
                        if let Some(audit) = pending_audit.take() {
                            audit.finish("failure", None);
                        }
                        return Err("Native startup deadline exceeded".into());
                    }
                    if status.ready {
                        break;
                    }
                    thread::sleep(Duration::from_millis(1));
                }
                self.next_capture += 1;
                let identity = Identity {
                    capture_id: format!("native-{}-{}", self.epoch, self.next_capture),
                    session_id: request.session_id,
                    generation: request.generation,
                };
                let descriptor = CaptureDescriptor {
                    identity: identity.clone(),
                    source,
                    format: "s16le",
                    sample_rate: 44100,
                    channels: 2,
                    channel_map: ["front-left", "front-right"],
                    frame_bytes: 4,
                    max_frames: MAX_FRAMES,
                };
                if let Some(audit) = pending_audit.as_mut() {
                    audit.descriptor(&descriptor);
                }
                self.session = Some(Session {
                    identity,
                    delivery: Delivery::default(),
                    lease: Instant::now(),
                    failure: None,
                    audit_requested: pending_audit.is_some(),
                    audit: pending_audit,
                });
                Ok(Response::Descriptor(descriptor))
            }
            Request::Drain(request) => {
                let identity = request.identity();
                let session = self.session.as_mut().ok_or("No active native capture")?;
                session.check(&identity)?;
                session.lease = Instant::now();
                let before = session.delivery.acknowledged();
                let pulse = self.pulse.as_mut().ok_or("Native worker missing")?;
                let mut ack_accepted = false;
                let outcome = (|| {
                    let count = session.delivery.acknowledge(request.ack_through_sequence)?;
                    if count != 0 {
                        pulse.ack(count)?;
                    }
                    ack_accepted = true;
                    if let Some(bytes) = session.delivery.replay() {
                        return Ok((bytes, true, false));
                    }
                    let receipt = session.receipt(&pulse.status());
                    let blocks = pulse.blocks()?;
                    let terminal = blocks.is_empty()
                        && receipt.state == "stopped"
                        && receipt.acknowledged_sequence == receipt.last_sequence;
                    let bytes = session.delivery.issue(&identity, &blocks, &receipt)?;
                    Ok::<_, String>((bytes, false, terminal))
                })();
                match outcome {
                    Ok((bytes, replay, terminal)) => {
                        if let Some(audit) = session.audit.as_mut() {
                            audit.drain(
                                &request,
                                before,
                                session.delivery.acknowledged(),
                                &bytes,
                                replay,
                            );
                        }
                        if terminal {
                            let healthy = session.receipt(&pulse.status()).health.healthy;
                            self.finish_audit(if healthy { "complete" } else { "failure" });
                        }
                        Ok(Response::Bytes(bytes))
                    }
                    Err(error) => {
                        if let Some(audit) = session.audit.as_mut() {
                            audit.rejected(
                                &request,
                                ack_accepted,
                                before,
                                session.delivery.acknowledged(),
                                &error,
                            );
                        }
                        Err(error)
                    }
                }
            }
            Request::Stop(identity) => {
                self.session
                    .as_ref()
                    .ok_or("No active native capture")?
                    .check(&identity)?;
                self.session.as_mut().expect("checked session").lease = Instant::now();
                self.pulse()?.stop();
                let deadline = Instant::now() + Duration::from_millis(3100);
                while !self.pulse()?.status().stopped && Instant::now() < deadline {
                    self.pulse()?.tick();
                    thread::sleep(Duration::from_millis(1));
                }
                let status = self.pulse()?.status();
                let session = self.session.as_mut().expect("checked session");
                let receipt = session.receipt(&status);
                if let Some(audit) = session.audit.as_mut() {
                    audit.stop(&receipt);
                }
                Ok(Response::Receipt(receipt))
            }
            Request::VerifyStopped(identity) => {
                self.session
                    .as_ref()
                    .ok_or("No native capture session")?
                    .check(&identity)?;
                if !self
                    .session
                    .as_ref()
                    .expect("checked session")
                    .audit_requested
                {
                    return Err("Native session did not request diagnostic capture".into());
                }
                if !self.pulse()?.status().stopped {
                    return Err("Native capture is still active".into());
                }
                Ok(Response::Empty)
            }
            Request::Cancel(identity) => {
                self.session
                    .as_ref()
                    .ok_or("No active native capture")?
                    .check(&identity)?;
                let audit_receipt = self
                    .session
                    .as_ref()
                    .map(|s| s.receipt(&self.pulse.as_ref().expect("checked capture").status()));
                let failed = self.session.as_ref().is_some_and(|s| s.failure.is_some());
                self.pulse()?.cancel();
                if let Some(audit) = self.session.as_mut().and_then(|s| s.audit.take()) {
                    audit.finish("cancel", audit_receipt);
                }
                if failed || self.pulse()?.status().error.is_some() {
                    self.pulse = None;
                    self.approved = None;
                    self.sources.clear();
                }
                self.session = None;
                Ok(Response::Empty)
            }
            Request::ResetRenderer | Request::Shutdown => {
                let audit_receipt = self
                    .session
                    .as_ref()
                    .and_then(|s| self.pulse.as_ref().map(|p| s.receipt(&p.status())));
                if let Some(pulse) = self.pulse.as_mut() {
                    pulse.cancel();
                }
                if let Some(audit) = self.session.as_mut().and_then(|s| s.audit.take()) {
                    audit.finish(
                        if matches!(request, Request::Shutdown) {
                            "shutdown"
                        } else {
                            "reset"
                        },
                        audit_receipt,
                    );
                }
                self.pulse = None;
                self.session = None;
                self.sources.clear();
                self.approved = None;
                Ok(Response::Empty)
            }
        }
    }
}
fn worker(incoming: Receiver<Envelope>) {
    let mut state = Worker::<Pulse>::new();
    loop {
        state.tick();
        match state.next_command(&incoming) {
            Ok(envelope) => {
                let shutdown = matches!(envelope.request, Request::Shutdown);
                let result = state.dispatch(envelope.request, envelope.deadline);
                // Only a successful, undeliverable Begin can create an orphan.
                // A stale rejected request must never cancel a newer owner.
                let begun = match &result {
                    Ok(Response::Descriptor(value)) => Some(value.identity.clone()),
                    _ => None,
                };
                if envelope.reply.send(result).is_err() {
                    if let Some(identity) = begun {
                        state.abandon_begin(&identity);
                    }
                }
                if shutdown {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = state.handle(Request::Shutdown);
                break;
            }
        }
    }
}
