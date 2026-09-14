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
fn exchange(request: Value) -> Result<Value, String> {
    let mut guard = WORKER.lock().map_err(|_| "worker lock failed")?;
    if guard.is_none() {
        if request["op"] != "warmup" && request["op"] != "start" {
            return Err("worker lost; recording retained for recovery".into());
        }
        *guard = Some(Worker::start()?);
    }
    if request["op"] == "warmup" {
        return Ok(serde_json::json!({"ready": true}));
    }
    let worker = guard.as_mut().ok_or("worker missing")?;
    let result: Result<Value, String> = (|| {
        worker
            .requests
            .as_ref()
            .ok_or("worker closed")?
            .try_send(request.clone())
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => "worker request channel full",
                mpsc::TrySendError::Disconnected(_) => "worker disconnected",
            })?;
        let response = receive_response(&worker.responses, Duration::from_secs(10), false)?;
        if response["session"] != request["session"] || response["seq"] != request["seq"] {
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
#[tauri::command]
pub async fn benchmark_stream(request: Value) -> Result<Value, String> {
    if request["op"] == "diagnostic" {
        crate::performance::speech_queue_failure(&request)?;
        return Ok(serde_json::json!({"logged":true}));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let result = exchange(request.clone());
        crate::performance::speech_exchange(&request, &result, started.elapsed());
        result
    })
    .await
    .map_err(|_| "worker task failed")?
}
#[cfg(test)]
mod tests {
    use super::*;
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
