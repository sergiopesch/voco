//! Opt-in local metadata only. Producers never wait for the disk writer.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const FILE_LIMIT: u64 = 8 * 1024 * 1024;
const QUEUE_LIMIT: usize = 256;
static RECORDER: OnceLock<Recorder> = OnceLock::new();
static REQUEST_ID: AtomicU64 = AtomicU64::new(0);

struct Recorder {
    sender: mpsc::SyncSender<Value>,
    dropped: Arc<AtomicU64>,
    start: Instant,
}

pub fn initialize() {
    if std::env::var("VOCO_PERFORMANCE_LOG").as_deref() != Ok("1") {
        return;
    }
    if let Err(error) = start(&crate::xdg_state_home().join("voco/performance")) {
        log::warn!("Local performance recorder unavailable: {error}");
    }
}

fn start(directory: &Path) -> io::Result<()> {
    let writer = RotatingWriter::new(directory, FILE_LIMIT)?;
    let (sender, receiver) = mpsc::sync_channel(QUEUE_LIMIT);
    let dropped = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let recorder = Recorder {
        sender,
        dropped: dropped.clone(),
        start,
    };
    RECORDER
        .set(recorder)
        .map_err(|_| io::Error::other("recorder already initialized"))?;
    std::thread::Builder::new()
        .name("voco-performance".into())
        .spawn(move || {
            if let Err(error) = write_events(writer, receiver, dropped, start) {
                log::warn!("Local performance recorder stopped: {error}");
            }
        })?;
    Ok(())
}

fn emit(mut value: Value) {
    if let Some(recorder) = RECORDER.get() {
        value["t_us"] = json!(recorder.start.elapsed().as_micros() as u64);
        if recorder.sender.try_send(value).is_err() {
            recorder.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

pub fn lifecycle(record: &Value) {
    if RECORDER.get().is_none() {
        return;
    }
    if let Some(safe) = lifecycle_payload(record) {
        emit(safe);
    }
}

fn lifecycle_payload(record: &Value) -> Option<Value> {
    let name = record["event"].as_str()?;
    if !crate::is_supported_dictation_trace_event(name)
        && !matches!(
            name,
            "app_start"
                | "frontend_app_mounted"
                | "frontend_toggle_received"
                | "frontend_init_complete"
                | "frontend_hotkey_handler_ready"
        )
    {
        return None;
    }
    // A second allowlist prevents future trace fields from exporting content.
    let mut safe = json!({"event": "lifecycle", "name": name});
    for key in [
        "dictation_session_id",
        "duration_ms",
        "chunk_count",
        "response_delta_count",
        "track_sample_rate",
        "track_channel_count",
        "echo_cancellation",
        "noise_suppression",
        "auto_gain_control",
        "selected_device_configured",
    ] {
        if record[key].is_number() || record[key].is_boolean() {
            safe[key] = record[key].clone();
        }
    }
    // Frontend reloads restart frontend session numbering; reports separate epochs.
    Some(safe)
}

/// Finite metadata only: never persist destination tokens, paths, names or text.
pub fn destination_check(
    scope: &str,
    events_tracked: bool,
    stage: &str,
    outcome: &str,
    duration_ms: u64,
) {
    if !matches!(scope, "control" | "window" | "unavailable")
        || !matches!(stage, "status" | "paste")
        || !matches!(outcome, "observed" | "matched" | "rejected" | "unverified")
    {
        return;
    }
    emit(json!({"event": "destination_check", "scope": scope,
        "events_tracked": events_tracked, "stage": stage, "outcome": outcome,
        "duration_ms": duration_ms}));
}

pub fn speech_queue_failure(request: &Value) -> Result<(), String> {
    let reason = request["reason"]
        .as_str()
        .filter(|s| {
            matches!(
                *s,
                "transport_failed"
                    | "backlog_limit"
                    | "response_invalid"
                    | "prefix_revision"
                    | "insertion_failed"
                    | "capture_invalid"
            )
        })
        .ok_or("Invalid speech diagnostic reason")?;
    let session_hash = request["session"]
        .as_str()
        .filter(|s| s.len() <= 80)
        .map(|s| format!("{:x}", Sha256::digest(s.as_bytes())));
    emit(
        json!({"event":"speech_queue_failed", "reason":reason, "stream_session_hash":session_hash,
        "dictation_session_id":request["dictation_session_id"].as_u64()}),
    );
    Ok(())
}

/// Correlate IPC with worker records without exporting request content.
pub fn speech_exchange(request: &Value, result: &Result<Value, String>, elapsed: Duration) {
    if RECORDER.get().is_none() {
        return;
    }
    let op = request["op"]
        .as_str()
        .filter(|s| matches!(*s, "warmup" | "start" | "push" | "finish" | "cancel"))
        .unwrap_or("invalid");
    let outcome = match result {
        Ok(_) => "ok",
        Err(error) if error.contains("warm-up timed out") => "startup_timeout",
        Err(error) if error.contains("response timed out") => "response_timeout",
        Err(error) if error.contains("identity mismatch") => "identity_mismatch",
        Err(error) if error.contains("rejected request") => "request_rejected",
        Err(error) if error.contains("absolute local file") => "runtime_missing",
        Err(error) if error.contains("spawn failed") => "spawn_failed",
        Err(error) if error.contains("worker lost") => "worker_lost",
        Err(error) if error.contains("ready") => "startup_failed",
        Err(error) if error == "worker closed output" => "worker_eof",
        Err(error) if error == "worker disconnected" => "worker_disconnected",
        Err(error) if error == "worker request channel full" => "request_backlog",
        Err(_) => "transport_failed",
    };
    // Worker logs retain every decode request; app logs retain boundaries and
    // slow/error IPC requests so normal 20ms traffic does not double log volume.
    if op == "push" && outcome == "ok" && elapsed < Duration::from_millis(100) {
        return;
    }
    let session_hash = request["session"]
        .as_str()
        .filter(|s| s.len() <= 80)
        .map(|s| format!("{:x}", Sha256::digest(s.as_bytes())));
    emit(
        json!({"event":"speech_exchange", "op":op, "outcome":outcome,
        "stream_session_hash":session_hash, "request_seq":request["seq"].as_u64(),
        "dictation_session_id":request["dictation_session_id"].as_u64(),
        "ipc_total_us":elapsed.as_micros() as u64}),
    );
}

/// Natural process status, with a finite reason vocabulary; never stderr or text.
pub fn speech_worker_failure(stage: &str, error: &str, status: Option<std::process::ExitStatus>) {
    if RECORDER.get().is_none() {
        return;
    }
    if let Some(record) = speech_worker_failure_payload(stage, error, status) {
        emit(record);
    }
}

fn speech_worker_failure_payload(
    stage: &str,
    error: &str,
    status: Option<std::process::ExitStatus>,
) -> Option<Value> {
    use std::os::unix::process::ExitStatusExt;
    if !matches!(stage, "startup" | "exchange") {
        return None;
    }
    let reason = match error {
        "worker closed output" => "output_eof",
        "worker disconnected" => "channel_disconnected",
        "worker request channel full" => "request_backlog",
        "worker warm-up timed out" => "startup_timeout",
        "worker response timed out" => "response_timeout",
        "worker read failed" => "read_failed",
        "worker write failed" => "write_failed",
        "worker response truncated or too large" => "response_bounds",
        "invalid worker response" => "response_invalid",
        "worker did not become ready" => "ready_invalid",
        "worker response identity mismatch" => "identity_mismatch",
        "worker rejected request; recording retained for recovery" => "request_rejected",
        _ => "transport_failed",
    };
    Some(
        json!({"event":"speech_worker_failed", "stage":stage, "reason":reason,
        "exit_observed":status.is_some(), "exit_code":status.and_then(|value| value.code()),
        "exit_signal":status.and_then(|value| value.signal())}),
    )
}

pub fn shutdown() {
    emit(json!({"event": "clean_exit_requested"}));
}

pub struct RequestTrace {
    data: Option<RequestData>,
}
struct RequestData {
    id: u64,
    mode: &'static str,
    start: Instant,
    stage_start: Instant,
    stage: &'static str,
    stages: BTreeMap<&'static str, u64>,
    samples: Option<usize>,
    session: Option<u64>,
    outcome: &'static str,
    preview: Option<crate::transcribe::PreviewDiagnostics>,
}
impl RequestTrace {
    pub fn new(mode: &'static str) -> Self {
        let data = RECORDER.get().map(|_| {
            let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed) + 1;
            emit(json!({"event":"request_started", "request_id":id, "mode":mode}));
            RequestData {
                id,
                mode,
                start: Instant::now(),
                stage_start: Instant::now(),
                stage: "validate_input",
                stages: BTreeMap::new(),
                samples: None,
                session: None,
                outcome: "error",
                preview: None,
            }
        });
        Self { data }
    }
    pub fn audio(&mut self, samples: usize, session: Option<u64>) {
        if let Some(data) = &mut self.data {
            data.samples = Some(samples);
            data.session = session;
        }
    }
    pub fn stage(&mut self, next: &'static str) {
        if let Some(data) = &mut self.data {
            data.stages
                .insert(data.stage, data.stage_start.elapsed().as_micros() as u64);
            data.stage = next;
            data.stage_start = Instant::now();
        }
    }
    pub fn preview(&mut self, diagnostics: Option<crate::transcribe::PreviewDiagnostics>) {
        if let Some(data) = &mut self.data {
            data.preview = diagnostics;
        }
    }
    pub fn outcome(&mut self, value: &'static str) {
        if let Some(data) = &mut self.data {
            data.outcome = value;
        }
    }
}
impl Drop for RequestTrace {
    fn drop(&mut self) {
        if let Some(mut data) = self.data.take() {
            data.stages
                .insert(data.stage, data.stage_start.elapsed().as_micros() as u64);
            emit(
                json!({"event":"request_completed", "request_id":data.id, "mode":data.mode,
                "outcome":data.outcome, "last_stage":data.stage, "stages_us":data.stages,
                "total_us":data.start.elapsed().as_micros() as u64,
                "audio_samples":data.samples, "dictation_session_id":data.session,
                "preview_diagnostics":data.preview}),
            );
        }
    }
}

fn write_events(
    mut writer: RotatingWriter,
    receiver: mpsc::Receiver<Value>,
    dropped: Arc<AtomicU64>,
    start: Instant,
) -> io::Result<()> {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();
    let run = format!("{epoch}-{}", std::process::id());
    let executable_hash = std::env::current_exe()
        .ok()
        .and_then(|p| fs::read(p).ok())
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)));
    let header = json!({"event":"run_metadata", "version":env!("CARGO_PKG_VERSION"),
        "executable_sha256":executable_hash, "model":"nemotron-speech-streaming-en-0.6b-q8-context1", "fallback_model":"base.en",
        "native_capture_compiled":cfg!(feature="native-capture-dev"),
        "desktop_paste_enabled":crate::insertion::desktop_paste_enabled(),
        "desktop_stream_enabled":crate::insertion::desktop_stream_enabled(),
        "desktop_clipboard_helper":crate::insertion::desktop_clipboard_helper(),
        "session_type":crate::session_type_label(), "logical_cpus":std::thread::available_parallelism().ok().map(|n|n.get()),
        "resource_scope":"Rust process including native decoder threads; excludes WebKit/helper processes",
        "started_unix_us":epoch});
    let mut seq = 0u64;
    let mut write = |writer: &mut RotatingWriter, mut value: Value| -> io::Result<()> {
        seq += 1;
        value["schema"] = json!(1);
        value["run_id"] = json!(run);
        value["seq"] = json!(seq);
        if value.get("t_us").is_none() {
            value["t_us"] = json!(start.elapsed().as_micros() as u64);
        }
        value["dropped_events"] = json!(dropped.load(Ordering::Relaxed));
        writer.write(&value)
    };
    write(&mut writer, header)?;
    let mut next_sample = Instant::now();
    loop {
        let timeout = next_sample.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(timeout) {
            Ok(mut value) => {
                // Producer timestamp excludes writer backlog from latency measurements.
                if let Some(recorder) = RECORDER.get() {
                    value["writer_observed_us"] =
                        json!(recorder.start.elapsed().as_micros() as u64);
                }
                let exit = value["event"] == "clean_exit_requested";
                write(&mut writer, value)?;
                if exit {
                    return Ok(());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if Instant::now() >= next_sample {
            write(&mut writer, resource_sample())?;
            next_sample = Instant::now() + Duration::from_secs(2);
        }
    }
}

fn resource_sample() -> Value {
    // SAFETY: getrusage initializes the provided valid structure on success.
    let mut usage = unsafe { std::mem::zeroed::<libc::rusage>() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
        return json!({"event":"resource_sample", "available":false});
    }
    let micros = |t: libc::timeval| t.tv_sec as i128 * 1_000_000 + t.tv_usec as i128;
    json!({"event":"resource_sample", "available":true,
        "cpu_us":micros(usage.ru_utime)+micros(usage.ru_stime),
        "peak_rss_kib":usage.ru_maxrss, "major_page_faults":usage.ru_majflt,
        "voluntary_context_switches":usage.ru_nvcsw, "involuntary_context_switches":usage.ru_nivcsw})
}

struct RotatingWriter {
    directory: PathBuf,
    file: File,
    bytes: u64,
    limit: u64,
}
impl RotatingWriter {
    fn new(directory: &Path, limit: u64) -> io::Result<Self> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(directory)?;
        let metadata = fs::symlink_metadata(directory)?;
        if !metadata.is_dir()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
        {
            return Err(io::Error::other(
                "performance directory must be owned, private and not a symlink",
            ));
        }
        let file = Self::open(&directory.join("performance.jsonl"))?;
        let bytes = file.metadata()?.len();
        Ok(Self {
            directory: directory.into(),
            file,
            bytes,
            limit,
        })
    }
    fn open(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
        {
            return Err(io::Error::other(
                "performance log must be a private owned regular file with one link",
            ));
        }
        Ok(file)
    }
    fn write(&mut self, value: &Value) -> io::Result<()> {
        let mut line = serde_json::to_vec(value)?;
        line.push(b'\n');
        if line.len() as u64 > self.limit {
            return Err(io::Error::other("performance event exceeds file limit"));
        }
        if self.bytes + line.len() as u64 > self.limit {
            fs::rename(
                self.directory.join("performance.jsonl"),
                self.directory.join("performance.previous.jsonl"),
            )?;
            self.file = Self::open(&self.directory.join("performance.jsonl"))?;
            self.bytes = 0;
        }
        self.file.write_all(&line)?;
        self.bytes += line.len() as u64;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn worker_failure_is_sanitized_and_missing_status_is_not_zero() {
        use std::os::unix::process::ExitStatusExt;
        let record =
            speech_worker_failure_payload("startup", "private dictated text", None).unwrap();
        assert_eq!(
            record,
            json!({"event":"speech_worker_failed", "stage":"startup",
            "reason":"transport_failed", "exit_observed":false, "exit_code":null, "exit_signal":null})
        );
        assert!(
            speech_worker_failure_payload("private stage", "worker closed output", None).is_none()
        );
        let record = speech_worker_failure_payload(
            "startup",
            "worker closed output",
            Some(std::process::ExitStatus::from_raw(7 << 8)),
        )
        .unwrap();
        assert_eq!(record["exit_code"], 7);
        assert_eq!(record["reason"], "output_eof");
        let signal = speech_worker_failure_payload(
            "exchange",
            "worker closed output",
            Some(std::process::ExitStatus::from_raw(9)),
        )
        .unwrap();
        assert_eq!(signal["exit_signal"], 9);
        assert!(signal["exit_code"].is_null());
    }

    #[test]
    fn speech_diagnostics_reject_arbitrary_error_content() {
        assert!(super::speech_queue_failure(
            &serde_json::json!({"reason":"private dictated words"})
        )
        .is_err());
        assert!(super::speech_queue_failure(&serde_json::json!({"reason":"prefix_revision", "session":"fixture", "text":"ignored content"})).is_ok());
    }

    use super::*;
    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!(
            "voco-performance-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn preview_diagnostics_contain_only_bounded_numeric_metadata() {
        let value = serde_json::to_value(crate::transcribe::PreviewDiagnostics {
            initial_context_frames: 512,
            reduced_attempt_us: 123,
            fallback_us: Some(456),
        })
        .unwrap();
        assert_eq!(
            value,
            json!({"initial_context_frames":512, "reduced_attempt_us":123, "fallback_us":456})
        );
        for name in [
            "dictation_stop_checkpoint_wait_completed",
            "dictation_stop_preview_wait_completed",
            "dictation_stop_insertion_wait_completed",
        ] {
            assert_eq!(
                lifecycle_payload(&json!({"event":name, "duration_ms":0,
                "dictation_session_id":3, "transcript":"private", "clipboard":"private"}))
                .unwrap(),
                json!({"event":"lifecycle", "name":name, "duration_ms":0, "dictation_session_id":3})
            );
        }
    }

    #[test]
    fn lifecycle_excludes_content_and_unknown_events() {
        let record = lifecycle_payload(&json!({"event":"dictation_transcription_completed", "duration_ms":123,
            "transcript":"private speech", "clipboard":"private clipboard", "url":"https://private.example", "track_sample_rate":"secret"})).unwrap();
        assert_eq!(
            record,
            json!({"event":"lifecycle", "name":"dictation_transcription_completed", "duration_ms":123})
        );
        assert!(lifecycle_payload(&json!({"event":"arbitrary private message"})).is_none());
    }
    #[test]
    fn trigger_admission_logs_only_event_and_local_session() {
        for name in [
            "dictation_trigger_start_rejected",
            "dictation_trigger_stop_rejected",
            "dictation_trigger_start_admitted",
            "dictation_trigger_stop_admitted",
            "dictation_trigger_toggle_admitted",
        ] {
            let record = lifecycle_payload(&json!({"event":name, "dictation_session_id":2,
                "triggerId":"browser:private-token", "transcript":"private speech", "reason":"private free text"})).unwrap();
            assert_eq!(
                record,
                json!({"event":"lifecycle", "name":name, "dictation_session_id":2})
            );
        }
    }
    #[test]
    fn rotation_is_bounded_and_private() {
        let path = directory();
        let mut writer = RotatingWriter::new(&path, 80).unwrap();
        for _ in 0..20 {
            writer.write(&json!({"event":"test", "value":42})).unwrap();
        }
        assert_eq!(fs::read_dir(&path).unwrap().count(), 2);
        for entry in fs::read_dir(&path).unwrap() {
            let m = entry.unwrap().metadata().unwrap();
            assert!(m.len() <= 80);
            assert_eq!(m.mode() & 0o777, 0o600);
        }
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn refuses_symlink_and_public_file_without_changing_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let path = directory();
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        let target = path.join("target");
        fs::write(&target, b"private content").unwrap();
        symlink(&target, path.join("performance.jsonl")).unwrap();
        assert!(RotatingWriter::new(&path, 80).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"private content");
        fs::remove_file(path.join("performance.jsonl")).unwrap();
        fs::write(path.join("performance.jsonl"), b"old").unwrap();
        fs::set_permissions(
            path.join("performance.jsonl"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert!(RotatingWriter::new(&path, 80).is_err());
        fs::remove_dir_all(path).unwrap();
    }
}
