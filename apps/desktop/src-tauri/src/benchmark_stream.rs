//! Isolated candidate adapter. Explicit local executable, bounded IPC and reaping.
use serde_json::Value;
use std::time::Instant;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, LazyLock, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
struct Worker {
    child: Child,
    requests: Option<mpsc::SyncSender<Value>>,
    responses: mpsc::Receiver<Result<Value, String>>,
    io_thread: Option<JoinHandle<()>>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.requests.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(thread) = self.io_thread.take() {
            let _ = thread.join();
        }
    }
}
fn read_response(output: &mut impl BufRead) -> Result<Value, String> {
    let mut line = String::new();
    let bytes = output
        .take(1024 * 1024 + 1)
        .read_line(&mut line)
        .map_err(|_| "worker read failed")?;
    if bytes == 0 {
        return Err("worker closed output".into());
    }
    if line.len() > 1024 * 1024 || !line.ends_with('\n') {
        return Err("worker response truncated or too large".into());
    }
    serde_json::from_str(&line).map_err(|_| "invalid worker response".into())
}
fn configured_path(name: &str) -> Result<PathBuf, String> {
    let default = match name {
        "VOCO_STREAM_PYTHON" => "/usr/bin/python3",
        "VOCO_STREAM_WORKER" => "/usr/lib/voco/speech/stream_worker.py",
        _ => return Err("Unknown runtime path".into()),
    };
    let path = PathBuf::from(std::env::var_os(name).unwrap_or_else(|| default.into()));
    if !path.is_absolute() || !path.is_file() {
        return Err(format!("{name} must name an absolute local file"));
    }
    Ok(path)
}
fn receive_response(
    responses: &mpsc::Receiver<Result<Value, String>>,
    timeout: Duration,
    startup: bool,
) -> Result<Value, String> {
    responses
        .recv_timeout(timeout)
        .map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout if startup => "worker warm-up timed out",
            mpsc::RecvTimeoutError::Timeout => "worker response timed out",
            mpsc::RecvTimeoutError::Disconnected => "worker disconnected",
        })?
}
impl Worker {
    fn record_failure(&mut self, stage: &str, error: &str) {
        // Observe natural exit before Drop terminates a stuck worker. Missing
        // status means the process has not exited yet, never a successful exit.
        let status = self.child.try_wait().ok().flatten();
        crate::performance::speech_worker_failure(stage, error, status);
    }

    fn start() -> Result<Self, String> {
        let mut child = Command::new(configured_path("VOCO_STREAM_PYTHON")?)
            .arg(configured_path("VOCO_STREAM_WORKER")?)
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|_| "worker spawn failed")?;
        let mut input = child.stdin.take().ok_or("worker stdin missing")?;
        let mut output = BufReader::new(child.stdout.take().ok_or("worker stdout missing")?);
        let (request_tx, request_rx) = mpsc::sync_channel::<Value>(1);
        let (response_tx, response_rx) = mpsc::channel();
        let io_thread = thread::spawn(move || {
            let ready = read_response(&mut output);
            let valid = ready.as_ref().is_ok_and(|value| value["ready"] == true);
            if response_tx.send(ready).is_err() || !valid {
                return;
            }
            for request in request_rx {
                let result = (|| {
                    serde_json::to_writer(&mut input, &request)
                        .map_err(|_| "worker write failed")?;
                    input
                        .write_all(b"\n")
                        .and_then(|_| input.flush())
                        .map_err(|_| "worker write failed")?;
                    read_response(&mut output)
                })();
                let failed = result.is_err();
                if response_tx.send(result).is_err() || failed {
                    return;
                }
            }
        });
        let mut worker = Self {
            child,
            requests: Some(request_tx),
            responses: response_rx,
            io_thread: Some(io_thread),
        };
        let ready =
            receive_response(&worker.responses, Duration::from_secs(30), true).and_then(|ready| {
                if ready["ready"] == true {
                    Ok(ready)
                } else {
                    Err("worker did not become ready".into())
                }
            });
        if let Err(error) = ready {
            worker.record_failure("startup", &error);
            return Err(error);
        }
        Ok(worker)
    }
}
static WORKER: LazyLock<Mutex<Option<Worker>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Default)]
struct RecoveryWorker {
    worker: Option<Worker>,
    session: Option<String>,
    rate: Option<u64>,
    samples: u64,
}
static RECOVERY_WORKER: LazyLock<Mutex<RecoveryWorker>> =
    LazyLock::new(|| Mutex::new(RecoveryWorker::default()));

fn recover_with_worker(
    request: Value,
    slot: &mut RecoveryWorker,
    create_worker: impl FnOnce() -> Result<Worker, String>,
) -> Result<Value, String> {
    let session = request["session"]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 80)
        .ok_or("invalid recovery session")?;
    let session = session.to_owned();
    let result = (|| {
        let seq = request["seq"].as_u64().ok_or("invalid recovery sequence")?;
        let op = request["op"].as_str().ok_or("invalid recovery operation")?;
        match op {
            "cancel" => {
                // Late cleanup can only release its own worker, never a replacement
                // recovery or the persistent live recognition worker.
                if slot.session.as_deref() == Some(session.as_str()) {
                    *slot = RecoveryWorker::default();
                }
                return Ok(
                    serde_json::json!({"session":session,"seq":seq,"mode":"append-only","text":null}),
                );
            }
            "start" if seq == 0 => {
                // A new explicit attempt supersedes abandoned recovery after renderer
                // replacement. Neither session has any destination capability.
                *slot = RecoveryWorker {
                    session: Some(session.clone()),
                    ..Default::default()
                };
            }
            "push" | "finish" if slot.session.as_deref() == Some(session.as_str()) => {}
            _ => return Err("inactive or invalid recovery request".into()),
        }
        if op == "push" {
            let rate = request["rate"].as_u64().ok_or("invalid recovery rate")?;
            let audio = request["audio"]
                .as_array()
                .ok_or("invalid recovery audio")?;
            let count = audio.len() as u64;
            if !(8_000..=384_000).contains(&rate)
                || slot.rate.is_some_and(|previous| previous != rate)
                || count == 0
                || count > rate
                || slot.samples + count > (rate * 600).min(32 * 1024 * 1024)
                || !audio
                    .iter()
                    .all(|value| value.as_f64().is_some_and(|v| (v as f32).is_finite()))
            {
                return Err("invalid recovery audio bounds".into());
            }
            slot.rate = Some(rate);
            slot.samples += count;
        }
        let finished = op == "finish";
        let result = exchange_with_worker(request, &mut slot.worker, create_worker);
        if finished {
            *slot = RecoveryWorker::default();
        }
        result
    })();
    // Validation failures must release this session even if the renderer never
    // sends its final Cancel. A stale request cannot release a replacement.
    if result.is_err() && slot.session.as_deref() == Some(session.as_str()) {
        *slot = RecoveryWorker::default();
    }
    result
}

/// Explicit, local recognition only. A private worker prevents cancelled recovery
/// requests from disturbing a replacement live dictation. Finish/failure/cancel
/// reaps it; no model download or destination operation exists in this path.
#[tauri::command]
pub async fn recover_stream(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = RECOVERY_WORKER.lock().map_err(|_| "recovery lock failed")?;
        recover_with_worker(request, &mut slot, Worker::start)
    })
    .await
    .map_err(|_| "recovery task failed")?
}

fn request_metadata(request: &Value) -> Value {
    // Logging needs four bounded identifiers, never a second copy of each audio
    // packet. Keep this projection finite even for an invalid IPC request.
    serde_json::json!({
        "op": request["op"].as_str().filter(|op|
            matches!(*op, "warmup" | "start" | "push" | "finish" | "cancel")
        ).unwrap_or("invalid"),
        "session": request["session"].as_str().filter(|session| session.len() <= 80),
        "seq": request["seq"].as_u64(),
        "dictation_session_id": request["dictation_session_id"].as_u64(),
    })
}

fn exchange(request: Value) -> Result<Value, String> {
    let mut guard = WORKER.lock().map_err(|_| "worker lock failed")?;
    exchange_with_worker(request, &mut guard, Worker::start)
}

fn exchange_with_worker(
    request: Value,
    guard: &mut Option<Worker>,
    create_worker: impl FnOnce() -> Result<Worker, String>,
) -> Result<Value, String> {
    // An idle worker can exit without an exchange observing its closed pipes.
    // Only these pre-session boundaries may replace a known-dead child. A live
    // child or an uncertain liveness result must never cause request replay.
    if request["op"] == "warmup" || request["op"] == "start" {
        if let Some(worker) = guard.as_mut() {
            if worker
                .child
                .try_wait()
                .map_err(|_| "worker liveness check failed")?
                .is_some()
            {
                worker.record_failure("liveness", "worker exited while idle");
                guard.take();
            }
        }
    }
    if guard.is_none() {
        if request["op"] != "warmup" && request["op"] != "start" {
            return Err("worker lost; recording retained for recovery".into());
        }
        *guard = Some(create_worker()?);
    }
    if request["op"] == "warmup" {
        return Ok(serde_json::json!({"ready": true}));
    }
    let worker = guard.as_mut().ok_or("worker missing")?;
    // Retain only the response identity; transfer ownership of the audio array
    // through the channel instead of cloning its JSON number values again.
    let session = request["session"].clone();
    let seq = request["seq"].clone();
    let result: Result<Value, String> = (|| {
        worker
            .requests
            .as_ref()
            .ok_or("worker closed")?
            .try_send(request)
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => "worker request channel full",
                mpsc::TrySendError::Disconnected(_) => "worker disconnected",
            })?;
        let response = receive_response(&worker.responses, Duration::from_secs(10), false)?;
        if response["session"] != session || response["seq"] != seq {
            return Err("worker response identity mismatch".into());
        }
        if response.get("error").is_some() {
            return Err("worker rejected request; recording retained for recovery".into());
        }
        Ok(response)
    })();
    if let Err(error) = &result {
        worker.record_failure("exchange", error);
        guard.take();
    }
    result
}
// Backend startup owns eager warmup. Session starts use the same serialized
// worker slot, so an early recording cannot create a second model process.
pub(crate) fn warmup() -> Result<(), String> {
    let request = serde_json::json!({"op": "warmup"});
    let metadata = request_metadata(&request);
    let started = Instant::now();
    let result = exchange(request);
    crate::performance::speech_exchange(&metadata, &result, started.elapsed());
    result.map(|_| ())
}

#[tauri::command]
pub async fn benchmark_stream(request: Value) -> Result<Value, String> {
    if request["op"] == "quality" {
        crate::performance::speech_quality(&request)?;
        return Ok(serde_json::json!({"logged":true}));
    }
    if request["op"] == "diagnostic" {
        crate::performance::speech_queue_failure(&request)?;
        return Ok(serde_json::json!({"logged":true}));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = request_metadata(&request);
        let started = Instant::now();
        let result = exchange(request);
        crate::performance::speech_exchange(&metadata, &result, started.elapsed());
        result
    })
    .await
    .map_err(|_| "worker task failed")?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn exited_worker() -> Worker {
        let mut child = Command::new("/bin/true").spawn().unwrap();
        child.wait().unwrap();
        let (requests, receiver) = mpsc::sync_channel(1);
        drop(receiver);
        let (sender, responses) = mpsc::channel();
        drop(sender);
        Worker {
            child,
            requests: Some(requests),
            responses,
            io_thread: None,
        }
    }

    fn live_worker(requests_seen: std::sync::Arc<Mutex<Vec<Value>>>, fail_request: bool) -> Worker {
        let child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let (requests, receiver) = mpsc::sync_channel::<Value>(1);
        let (sender, responses) = mpsc::channel();
        let io_thread = thread::spawn(move || {
            for request in receiver {
                let response = if fail_request {
                    Err("worker response timed out".into())
                } else {
                    Ok(
                        serde_json::json!({"session":request["session"], "seq":request["seq"],
                        "text":null, "mode":"append-only"}),
                    )
                };
                requests_seen.lock().unwrap().push(request);
                if sender.send(response).is_err() {
                    break;
                }
            }
        });
        Worker {
            child,
            requests: Some(requests),
            responses,
            io_thread: Some(io_thread),
        }
    }

    #[test]
    fn recovery_owns_and_reaps_only_its_worker() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut slot = RecoveryWorker::default();
        recover_with_worker(
            serde_json::json!({"op":"start","session":"old","seq":0}),
            &mut slot,
            || Ok(live_worker(seen.clone(), false)),
        )
        .unwrap();
        let old_pid = slot.worker.as_ref().unwrap().child.id();
        recover_with_worker(
            serde_json::json!({"op":"start","session":"new","seq":0}),
            &mut slot,
            || Ok(live_worker(seen.clone(), false)),
        )
        .unwrap();
        let new_pid = slot.worker.as_ref().unwrap().child.id();
        assert_ne!(old_pid, new_pid);
        assert!(!std::path::Path::new(&format!("/proc/{old_pid}")).exists());
        recover_with_worker(
            serde_json::json!({"op":"cancel","session":"old","seq":1}),
            &mut slot,
            || panic!("cancel never starts a worker"),
        )
        .unwrap();
        assert_eq!(slot.worker.as_ref().unwrap().child.id(), new_pid);
        assert!(recover_with_worker(
            serde_json::json!({"op":"push","session":"old","seq":2,"rate":16000,"audio":[0.1]}),
            &mut slot,
            || panic!("push never starts a worker")
        )
        .is_err());
        assert_eq!(slot.worker.as_ref().unwrap().child.id(), new_pid);
        recover_with_worker(
            serde_json::json!({"op":"finish","session":"new","seq":1}),
            &mut slot,
            || panic!("finish never starts a worker"),
        )
        .unwrap();
        assert!(slot.worker.is_none());
        assert!(slot.session.is_none());
        assert!(!std::path::Path::new(&format!("/proc/{new_pid}")).exists());
    }

    #[test]
    fn recovery_preserves_high_source_rates_and_samples() {
        for rate in [176_400, 192_000, 384_000] {
            let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
            let mut slot = RecoveryWorker::default();
            recover_with_worker(
                serde_json::json!({"op":"start","session":"high-rate","seq":0}),
                &mut slot,
                || Ok(live_worker(seen.clone(), false)),
            )
            .unwrap();
            let audio = vec![0.25_f32; rate / 10];
            recover_with_worker(
                serde_json::json!({"op":"push","session":"high-rate","seq":1,
                "rate":rate,"audio":audio}),
                &mut slot,
                || panic!("push must reuse worker"),
            )
            .unwrap();
            let requests = seen.lock().unwrap();
            assert_eq!(requests[1]["rate"], rate);
            assert_eq!(requests[1]["audio"], serde_json::json!(audio));
        }
    }

    #[test]
    fn recovery_reaps_its_worker_on_each_validation_failure() {
        let requests = [
            serde_json::json!({"op":"push","session":"fixture","seq":1,"rate":16000,"audio":[0.1]}),
            serde_json::json!({"op":"push","session":"fixture","seq":1,"rate":48000,"audio":[0.1]}),
            serde_json::json!({"op":"push","session":"fixture","seq":1,"rate":16000,"audio":[1e100]}),
            serde_json::json!({"op":"push","session":"fixture","seq":1,"audio":[0.1]}),
            serde_json::json!({"op":"push","session":"fixture","seq":1,"rate":16000,"audio":"invalid"}),
            serde_json::json!({"op":"push","session":"fixture","seq":1,"rate":16000,"audio":[]}),
            serde_json::json!({"op":"push","session":"fixture","seq":1,"rate":16000,"audio":vec![0.1;16001]}),
            serde_json::json!({"op":"push","session":"fixture","seq":-1,"rate":16000,"audio":[0.1]}),
            serde_json::json!({"op":"start","session":"fixture","seq":1}),
            serde_json::json!({"op":"warmup","session":"fixture","seq":1}),
            serde_json::json!({"session":"fixture","seq":1}),
        ];
        for (index, request) in requests.into_iter().enumerate() {
            let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
            let mut slot = RecoveryWorker {
                worker: Some(live_worker(seen.clone(), false)),
                session: Some("fixture".into()),
                rate: Some(16000),
                samples: if index == 0 { 16000 * 600 } else { 0 },
            };
            let pid = slot.worker.as_ref().unwrap().child.id();
            assert!(recover_with_worker(request, &mut slot, || panic!(
                "invalid input must not create a worker"
            ))
            .is_err());
            assert!(slot.worker.is_none());
            assert!(slot.session.is_none());
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
            assert!(seen.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn recovery_validation_failure_cannot_reap_another_session() {
        let mut slot = RecoveryWorker {
            worker: Some(live_worker(Default::default(), false)),
            session: Some("replacement".into()),
            ..Default::default()
        };
        let pid = slot.worker.as_ref().unwrap().child.id();
        for request in [
            serde_json::json!({"op":"push","session":"old","seq":-1}),
            serde_json::json!({"op":"push","session":"old","seq":1,"rate":0,"audio":[]}),
            serde_json::json!({"op":"start","session":"old","seq":1}),
            serde_json::json!({"op":"cancel","session":"","seq":1}),
            serde_json::json!({"op":"cancel","seq":1}),
        ] {
            assert!(recover_with_worker(request, &mut slot, || panic!(
                "invalid input must not create a worker"
            ))
            .is_err());
            assert_eq!(slot.worker.as_ref().unwrap().child.id(), pid);
            assert!(std::path::Path::new(&format!("/proc/{pid}")).exists());
        }
    }

    #[test]
    fn recovery_reaps_worker_after_failed_start() {
        let mut slot = RecoveryWorker::default();
        assert!(recover_with_worker(
            serde_json::json!({"op":"start","session":"failure","seq":0}),
            &mut slot,
            || Ok(live_worker(Default::default(), true))
        )
        .is_err());
        assert!(slot.worker.is_none());
        assert!(slot.session.is_none());
    }

    #[test]
    fn audio_array_is_moved_to_worker_without_a_second_allocation() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut slot = Some(live_worker(seen.clone(), false));
        let request = serde_json::json!({
            "op":"push", "session":"fixture", "seq":1,
            "audio":vec![0.25_f32; 960], "rate":48000,
        });
        let allocation = request["audio"].as_array().unwrap().as_ptr() as usize;
        exchange_with_worker(request, &mut slot, || {
            panic!("worker unexpectedly replaced")
        })
        .unwrap();
        let received = seen.lock().unwrap();
        assert_eq!(
            received[0]["audio"].as_array().unwrap().as_ptr() as usize,
            allocation
        );
        assert_eq!(received[0]["audio"].as_array().unwrap().len(), 960);
        assert_eq!(received[0]["audio"][959], 0.25);
    }

    #[test]
    fn telemetry_projection_preserves_only_bounded_identifiers() {
        let metadata = request_metadata(&serde_json::json!({
            "op":"push", "session":"fixture", "seq":3, "dictation_session_id":4,
            "audio":[0.25], "text":"private fixture", "rate":48000,
        }));
        assert_eq!(
            metadata,
            serde_json::json!({
                "op":"push", "session":"fixture", "seq":3, "dictation_session_id":4,
            })
        );
        let invalid = request_metadata(&serde_json::json!({
            "op":"private fixture", "session":"x".repeat(81),
            "seq":["private fixture"], "dictation_session_id":-1,
        }));
        assert_eq!(
            invalid,
            serde_json::json!({
                "op":"invalid", "session":null, "seq":null, "dictation_session_id":null,
            })
        );
    }

    #[test]
    fn moved_request_still_rejects_mismatched_response_identity() {
        for response in [
            serde_json::json!({"session":"wrong", "seq":1}),
            serde_json::json!({"session":"fixture", "seq":2}),
        ] {
            let mut slot = Some(live_worker(Default::default(), false));
            let (sender, responses) = mpsc::channel();
            sender.send(Ok(response)).unwrap();
            slot.as_mut().unwrap().responses = responses;
            let result = exchange_with_worker(
                serde_json::json!({"op":"push", "session":"fixture", "seq":1, "audio":[0.25]}),
                &mut slot,
                || panic!("request must never replay"),
            );
            assert_eq!(result.unwrap_err(), "worker response identity mismatch");
            assert!(slot.is_none());
        }
    }

    #[test]
    fn known_dead_worker_is_replaced_only_before_start_or_warmup() {
        for op in ["start", "warmup"] {
            let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
            let creates = std::cell::Cell::new(0);
            let mut slot = Some(exited_worker());
            let request = serde_json::json!({"op":op, "session":"fixture", "seq":0});
            let result = exchange_with_worker(request.clone(), &mut slot, || {
                creates.set(creates.get() + 1);
                Ok(live_worker(seen.clone(), false))
            });
            assert!(result.is_ok());
            assert_eq!(creates.get(), 1);
            assert!(slot.as_mut().unwrap().child.try_wait().unwrap().is_none());
            assert_eq!(
                seen.lock().unwrap().as_slice(),
                if op == "start" {
                    std::slice::from_ref(&request)
                } else {
                    &[]
                }
            );
        }
    }

    #[test]
    fn live_worker_is_reused_at_start_boundary() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut slot = Some(live_worker(seen.clone(), false));
        let pid = slot.as_ref().unwrap().child.id();
        let request = serde_json::json!({"op":"start", "session":"fixture", "seq":0});
        exchange_with_worker(request.clone(), &mut slot, || {
            panic!("live worker replaced")
        })
        .unwrap();
        assert_eq!(slot.as_ref().unwrap().child.id(), pid);
        assert_eq!(seen.lock().unwrap().as_slice(), &[request]);
    }

    #[test]
    fn repeated_warmup_reuses_live_worker_without_starting_a_session() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut slot = Some(live_worker(seen.clone(), false));
        let pid = slot.as_ref().unwrap().child.id();
        for _ in 0..2 {
            let result =
                exchange_with_worker(serde_json::json!({"op":"warmup"}), &mut slot, || {
                    panic!("warmup replaced a live worker")
                })
                .unwrap();
            assert_eq!(result["ready"], true);
            assert_eq!(slot.as_ref().unwrap().child.id(), pid);
        }
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn audio_and_finish_never_restart_or_replay_after_worker_exit() {
        for op in ["push", "finish"] {
            let mut slot = Some(exited_worker());
            let result = exchange_with_worker(
                serde_json::json!({"op":op, "session":"fixture", "seq":1}),
                &mut slot,
                || panic!("in-session request restarted worker"),
            );
            assert_eq!(result.unwrap_err(), "worker disconnected");
            assert!(slot.is_none());
        }
    }

    #[test]
    fn uncertain_start_is_not_issued_twice() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let creates = std::cell::Cell::new(0);
        let mut slot = Some(exited_worker());
        let request = serde_json::json!({"op":"start", "session":"fixture", "seq":0});
        let result = exchange_with_worker(request.clone(), &mut slot, || {
            creates.set(creates.get() + 1);
            Ok(live_worker(seen.clone(), true))
        });
        assert_eq!(result.unwrap_err(), "worker response timed out");
        assert_eq!(creates.get(), 1);
        assert_eq!(seen.lock().unwrap().as_slice(), &[request]);
        assert!(slot.is_none());
    }

    #[test]
    fn closed_output_and_disconnected_channel_are_not_timeouts() {
        assert_eq!(
            read_response(&mut &b""[..]).unwrap_err(),
            "worker closed output"
        );
        let (tx, rx) = mpsc::channel::<Result<Value, String>>();
        assert_eq!(
            receive_response(&rx, Duration::ZERO, true).unwrap_err(),
            "worker warm-up timed out"
        );
        drop(tx);
        assert_eq!(
            receive_response(&rx, Duration::ZERO, true).unwrap_err(),
            "worker disconnected"
        );
    }

    #[test]
    fn response_requires_complete_bounded_json() {
        assert!(read_response(&mut &b"{\"ready\":true}\n"[..]).is_ok());
        assert!(read_response(&mut &b"{\"ready\":true}"[..]).is_err());
        assert!(read_response(&mut &b"garbage\n"[..]).is_err());
        assert!(read_response(&mut vec![b' '; 1024 * 1024 + 2].as_slice()).is_err());
    }
}
