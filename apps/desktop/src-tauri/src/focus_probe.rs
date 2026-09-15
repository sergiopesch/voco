//! Reuse the interpreter, never the focus result. Every request is a fresh query.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Stdio},
    sync::{mpsc, LazyLock, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};

struct Probe {
    child: Child,
    requests: Option<mpsc::SyncSender<Value>>,
    responses: mpsc::Receiver<Result<Value, ()>>,
    reader: Option<JoinHandle<()>>,
    sequence: u64,
}
impl Drop for Probe {
    fn drop(&mut self) {
        self.requests.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}
fn response(output: &mut impl BufRead, sequence: u64) -> Result<Value, ()> {
    let mut line = String::new();
    output.take(4097).read_line(&mut line).map_err(|_| ())?;
    if line.len() > 4096 || !line.ends_with('\n') {
        return Err(());
    }
    let value: Value = serde_json::from_str(&line).map_err(|_| ())?;
    if value["seq"].as_u64() != Some(sequence) {
        return Err(());
    }
    if !matches!(value["shortcut"].as_str(), Some("ctrl+v" | "ctrl+shift+v")) {
        return Err(());
    }
    if !value["token"].is_null()
        && !value["token"]
            .as_str()
            .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
    {
        return Err(());
    }
    Ok(value)
}
impl Probe {
    fn start(script: &str) -> Result<Self, ()> {
        let mut child = crate::process_runner::command("/usr/bin/python3")
            .args(["-u", "-c", script, "--serve"])
            .stdin(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| ())?;
        let mut input = child.stdin.take().ok_or(())?;
        let mut output = BufReader::new(child.stdout.take().ok_or(())?);
        let (tx, rx) = mpsc::sync_channel::<Value>(1);
        let (result_tx, result_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            for request in rx {
                let seq = request["seq"].as_u64().unwrap_or(0);
                let result = (|| {
                    serde_json::to_writer(&mut input, &request).map_err(|_| ())?;
                    input
                        .write_all(b"\n")
                        .and_then(|_| input.flush())
                        .map_err(|_| ())?;
                    response(&mut output, seq)
                })();
                let failed = result.is_err();
                if result_tx.send(result).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            requests: Some(tx),
            responses: result_rx,
            reader: Some(reader),
            sequence: 0,
        })
    }
    #[cfg(test)]
    fn request(&mut self, timeout: Duration) -> Result<Value, ()> {
        self.request_with(json!({}), timeout)
    }
    fn request_with(&mut self, mut request: Value, timeout: Duration) -> Result<Value, ()> {
        self.sequence = self.sequence.checked_add(1).ok_or(())?;
        self.requests
            .as_ref()
            .ok_or(())?
            .send({
                request["seq"] = json!(self.sequence);
                request
            })
            .map_err(|_| ())?;
        self.responses.recv_timeout(timeout).map_err(|_| ())?
    }
}
static PROBE: LazyLock<Mutex<Option<Probe>>> = LazyLock::new(|| Mutex::new(None));
pub(crate) fn probe() -> Result<Value, ()> {
    probe_with(json!({"op":"probe"}))
}

pub(crate) fn probe_with(request: Value) -> Result<Value, ()> {
    probe_with_timeout(request, Duration::from_millis(800))
}

pub(crate) fn probe_with_timeout(request: Value, timeout: Duration) -> Result<Value, ()> {
    let mut guard = PROBE.lock().map_err(|_| ())?;
    if guard.is_none() {
        *guard = Some(Probe::start(include_str!(
            "../resources/voco_desktop_target.py"
        ))?);
    }
    let result = guard
        .as_mut()
        .ok_or(())?
        .request_with(request, timeout.min(Duration::from_millis(800)));
    if result.is_err() {
        guard.take();
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_truncated_and_oversized_results_reject() {
        assert!(response(
            &mut &b"{\"seq\":1,\"shortcut\":\"ctrl+v\",\"token\":null}\n"[..],
            1
        )
        .is_ok());
        assert!(response(&mut &b"{\"seq\":0}\n"[..], 1).is_err());
        assert!(response(&mut &b"{}"[..], 1).is_err());
        assert!(response(&mut vec![b' '; 4098].as_slice(), 1).is_err());
    }
    #[test]
    fn persistent_requests_are_fresh_and_child_is_reaped() {
        let script = "import sys,json\nfor line in sys.stdin:\n r=json.loads(line);print(json.dumps(dict(seq=r['seq'],shortcut='ctrl+v',token=format(r['seq'],'064x'))),flush=True)";
        let mut probe = Probe::start(script).unwrap();
        let pid = probe.child.id();
        let a = probe.request(Duration::from_millis(800)).unwrap();
        let b = probe.request(Duration::from_millis(800)).unwrap();
        assert_ne!(a["token"], b["token"]);
        drop(probe);
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
    }
    #[test]
    fn hung_helper_times_out_and_is_reaped() {
        let mut probe = Probe::start("import time;time.sleep(30)").unwrap();
        let pid = probe.child.id();
        assert!(probe.request(Duration::from_millis(50)).is_err());
        drop(probe);
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
    }
}
