use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

const PYTHON_PATH: &str = "/usr/bin/python3";
const IBUS_PATH: &str = "/usr/bin/ibus";
const ENGINE_SCRIPT: &str = include_str!("../resources/voco_ibus_engine.py");
const OWNERSHIP_SCRIPT: &str = include_str!("../resources/voco_ibus_ownership.py");
const ENGINE_START_TIMEOUT: Duration = Duration::from_millis(1_250);
const ENGINE_POLL_INTERVAL: Duration = Duration::from_millis(20);
const MAX_TEXT_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OwnedPreeditStatus {
    pub available: bool,
    pub ready: bool,
    pub session_id: Option<u64>,
    pub engine_active: bool,
    pub focus_lost: bool,
    pub switching: bool,
    pub progressive_commit_active: bool,
    pub committed_character_count: usize,
    pub ownership_intact: bool,
    pub finalization_outcome: Option<String>,
    pub current_engine: String,
    pub default_engine: String,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatus {
    ready: bool,
    session_id: Option<u64>,
    engine_active: bool,
    focus_lost: bool,
    switching: bool,
    #[serde(default)]
    progressive_commit_active: bool,
    #[serde(default)]
    committed_character_count: usize,
    #[serde(default)]
    ownership_intact: bool,
    #[serde(default)]
    finalization_outcome: Option<String>,
    #[serde(default)]
    current_engine: String,
    #[serde(default)]
    default_engine: String,
    #[serde(default)]
    error: String,
}

impl From<SidecarStatus> for OwnedPreeditStatus {
    fn from(status: SidecarStatus) -> Self {
        Self {
            available: true,
            ready: status.ready,
            session_id: status.session_id,
            engine_active: status.engine_active,
            focus_lost: status.focus_lost,
            switching: status.switching,
            progressive_commit_active: status.progressive_commit_active,
            committed_character_count: status.committed_character_count,
            ownership_intact: status.ownership_intact,
            finalization_outcome: status.finalization_outcome,
            current_engine: status.current_engine,
            default_engine: status.default_engine,
            error: (!status.error.is_empty()).then_some(status.error),
        }
    }
}

#[derive(Debug, Deserialize)]
struct StartupResponse {
    ok: bool,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Deserialize)]
struct ProtocolResponse {
    id: u64,
    ok: bool,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: String,
}

struct SidecarBridge {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    restore_engine: String,
}

impl SidecarBridge {
    fn spawn() -> Result<Self, String> {
        if !is_executable(Path::new(PYTHON_PATH)) {
            return Err(format!(
                "Owned cursor streaming requires the system Python runtime at {PYTHON_PATH}."
            ));
        }

        let script_path = materialize_engine_script()?;
        let mut child = Command::new(PYTHON_PATH)
            .args(["-u", script_path.to_string_lossy().as_ref()])
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to start the VOCO input method: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "VOCO input method stdin is unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "VOCO input method stdout is unavailable.".to_string())?;
        let mut stdout = BufReader::new(stdout);
        let mut startup_line = String::new();
        if let Err(error) = stdout.read_line(&mut startup_line) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Failed to read VOCO input method startup: {error}"));
        }
        if startup_line.is_empty() {
            let _ = child.kill();
            return Err("The VOCO input method exited before it reported readiness.".to_string());
        }

        let startup: StartupResponse = match serde_json::from_str(startup_line.trim_end()) {
            Ok(startup) => startup,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Invalid VOCO input method startup response: {error}"
                ));
            }
        };
        if !startup.ok {
            let _ = child.kill();
            return Err(if startup.error.is_empty() {
                "IBus is unavailable in this desktop session.".to_string()
            } else {
                startup.error
            });
        }

        Ok(Self {
            child,
            stdin,
            stdout,
            next_id: 1,
            restore_engine: String::new(),
        })
    }

    fn send_status(&mut self, mut command: Value) -> Result<OwnedPreeditStatus, String> {
        let result = self.send(&mut command)?;
        let status = serde_json::from_value::<SidecarStatus>(result)
            .map_err(|error| format!("Invalid VOCO input method status: {error}"))?;
        if !status.default_engine.is_empty() && status.default_engine != "voco" {
            self.restore_engine.clone_from(&status.default_engine);
        }
        Ok(OwnedPreeditStatus::from(status))
    }

    fn send(&mut self, command: &mut Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1).max(1);
        command["id"] = Value::from(id);

        serde_json::to_writer(&mut self.stdin, command)
            .map_err(|error| format!("Failed to encode VOCO input method command: {error}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Failed to send VOCO input method command: {error}"))?;

        let mut response_line = String::new();
        self.stdout
            .read_line(&mut response_line)
            .map_err(|error| format!("Failed to read VOCO input method response: {error}"))?;
        if response_line.is_empty() {
            return Err("The VOCO input method stopped unexpectedly.".to_string());
        }

        let response: ProtocolResponse = serde_json::from_str(response_line.trim_end())
            .map_err(|error| format!("Invalid VOCO input method response: {error}"))?;
        if response.id != id {
            return Err("VOCO input method response order was invalid.".to_string());
        }
        if !response.ok {
            return Err(if response.error.is_empty() {
                "The VOCO input method rejected the command.".to_string()
            } else {
                response.error
            });
        }

        Ok(response.result.unwrap_or(Value::Null))
    }

    fn shutdown(mut self) {
        let _ = self.send(&mut json!({ "operation": "shutdown" }));
        let deadline = Instant::now() + Duration::from_millis(750);
        let mut exited = false;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        if !exited {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        self.restore_desktop_engine();
    }

    fn restore_desktop_engine(&mut self) {
        if self.restore_engine.is_empty() || self.restore_engine == "voco" {
            return;
        }
        let engine = std::mem::take(&mut self.restore_engine);
        if is_executable(Path::new(IBUS_PATH)) {
            let _ = Command::new(IBUS_PATH)
                .args(["engine", &engine])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

impl Drop for SidecarBridge {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        self.restore_desktop_engine();
    }
}

pub struct OwnedPreeditService {
    bridge: Mutex<Option<SidecarBridge>>,
    next_session_id: AtomicU64,
}

impl Default for OwnedPreeditService {
    fn default() -> Self {
        Self {
            bridge: Mutex::new(None),
            next_session_id: AtomicU64::new(1),
        }
    }
}

impl OwnedPreeditService {
    pub fn status(&self) -> OwnedPreeditStatus {
        match self.with_bridge(|bridge| bridge.send_status(json!({ "operation": "status" }))) {
            Ok(status) => status,
            Err(error) => unavailable_status(error),
        }
    }

    pub fn start(&self, client_session_id: u64) -> Result<OwnedPreeditStatus, String> {
        validate_session_id(client_session_id)?;
        // The renderer's counter can restart after a reload. A service-issued
        // generation prevents a delayed command from acting on a later session
        // that happens to reuse the same renderer ID.
        let session_id = self.allocate_session_id()?;
        let initial = self.with_bridge(|bridge| {
            bridge.send_status(json!({
                "operation": "start",
                "sessionId": session_id,
            }))
        })?;
        if status_matches_session(&initial, session_id) && initial.engine_active {
            return Ok(initial);
        }

        let deadline = Instant::now() + ENGINE_START_TIMEOUT;
        while Instant::now() < deadline {
            std::thread::sleep(ENGINE_POLL_INTERVAL);
            let status =
                self.with_bridge(|bridge| bridge.send_status(json!({ "operation": "status" })))?;
            if !status_matches_session(&status, session_id) {
                return Err(
                    "VOCO input method startup was superseded by a newer session.".to_string(),
                );
            }
            if status.engine_active {
                return Ok(status);
            }
            if status.focus_lost {
                self.cancel_best_effort(session_id);
                return Err(
                    "The focused field stopped accepting VOCO input before dictation began."
                        .to_string(),
                );
            }
            if let Some(error) = status.error {
                self.cancel_best_effort(session_id);
                return Err(format!("VOCO could not activate its input method: {error}"));
            }
        }

        self.cancel_best_effort(session_id);
        Err("The focused field did not connect to the VOCO input method in time.".to_string())
    }

    pub fn update(
        &self,
        session_id: u64,
        confirmed_text: String,
        preedit_text: String,
        provisional_text: String,
    ) -> Result<OwnedPreeditStatus, String> {
        validate_session_id(session_id)?;
        validate_text(&confirmed_text)?;
        validate_text(&preedit_text)?;
        validate_text(&provisional_text)?;
        self.with_bridge(|bridge| {
            bridge.send_status(json!({
                "operation": "update",
                "sessionId": session_id,
                "confirmedText": confirmed_text,
                "preeditText": preedit_text,
                "provisionalText": provisional_text,
            }))
        })
    }

    pub fn commit(&self, session_id: u64, text: String) -> Result<OwnedPreeditStatus, String> {
        validate_session_id(session_id)?;
        validate_text(&text)?;
        // Finalization is one serialized sidecar transaction. It never releases
        // the bridge lock between a proof phase and a target mutation.
        self.with_bridge(|bridge| {
            bridge.send_status(json!({
                "operation": "commit",
                "sessionId": session_id,
                "text": text,
            }))
        })
    }

    pub fn cancel(&self, session_id: u64) -> Result<OwnedPreeditStatus, String> {
        validate_session_id(session_id)?;
        self.with_bridge(|bridge| {
            bridge.send_status(json!({
                "operation": "cancel",
                "sessionId": session_id,
            }))
        })
    }

    pub fn shutdown(&self) {
        let bridge = self.bridge.lock().ok().and_then(|mut guard| guard.take());
        if let Some(bridge) = bridge {
            bridge.shutdown();
        }
    }

    fn cancel_best_effort(&self, session_id: u64) {
        let _ = self.cancel(session_id);
    }

    fn allocate_session_id(&self) -> Result<u64, String> {
        self.next_session_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| "VOCO input method session counter was exhausted.".to_string())
    }

    fn with_bridge<T>(
        &self,
        operation: impl FnOnce(&mut SidecarBridge) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .bridge
            .lock()
            .map_err(|_| "VOCO input method state is unavailable.".to_string())?;
        if guard.is_none() {
            *guard = Some(SidecarBridge::spawn()?);
        }
        let result = operation(guard.as_mut().expect("bridge initialized above"));
        let sidecar_exited = guard
            .as_mut()
            .and_then(|bridge| bridge.child.try_wait().ok().flatten())
            .is_some();
        if result.is_err() && sidecar_exited {
            guard.take();
        }
        result
    }
}

fn validate_session_id(session_id: u64) -> Result<(), String> {
    if session_id == 0 {
        Err("sessionId must be a positive integer".to_string())
    } else {
        Ok(())
    }
}

fn status_matches_session(status: &OwnedPreeditStatus, session_id: u64) -> bool {
    status.session_id == Some(session_id)
}

fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_TEXT_BYTES {
        Err("text exceeds the VOCO preedit safety limit".to_string())
    } else {
        Ok(())
    }
}

fn unavailable_status(error: String) -> OwnedPreeditStatus {
    OwnedPreeditStatus {
        error: Some(error),
        ..OwnedPreeditStatus::default()
    }
}

fn materialize_engine_script() -> Result<PathBuf, String> {
    let root = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("voco")
        .join("runtime");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to prepare VOCO input method runtime: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("Failed to secure VOCO input method runtime directory: {error}")
        })?;
    }

    let ownership_path = root.join("voco_ibus_ownership.py");
    materialize_runtime_file(&ownership_path, OWNERSHIP_SCRIPT)?;
    let script_path = root.join("voco_ibus_engine.py");
    materialize_runtime_file(&script_path, ENGINE_SCRIPT)?;

    Ok(script_path)
}

fn materialize_runtime_file(path: &Path, contents: &str) -> Result<(), String> {
    let current = fs::read_to_string(path).ok();
    if current.as_deref() != Some(contents) {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(path)
            .map_err(|error| format!("Failed to install VOCO input method runtime: {error}"))?;
        file.write_all(contents.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Failed to update VOCO input method runtime: {error}"))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure VOCO input method runtime: {error}"))?;
    }

    Ok(())
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_sessions_and_oversized_text() {
        assert!(validate_session_id(0).is_err());
        assert!(validate_session_id(1).is_ok());
        assert!(validate_text("hello").is_ok());
        assert!(validate_text(&"x".repeat(MAX_TEXT_BYTES + 1)).is_err());
    }

    #[test]
    fn service_issues_unique_session_generations() {
        let service = OwnedPreeditService::default();
        let first = service.allocate_session_id().expect("first generation");
        let second = service.allocate_session_id().expect("second generation");
        assert_ne!(first, second);
    }

    #[test]
    fn status_matching_rejects_a_newer_session_generation() {
        let status = OwnedPreeditStatus {
            session_id: Some(2),
            engine_active: true,
            ..OwnedPreeditStatus::default()
        };
        assert!(!status_matches_session(&status, 1));
        assert!(status_matches_session(&status, 2));
    }

    #[test]
    fn converts_sidecar_status_without_exposing_empty_errors() {
        let status = OwnedPreeditStatus::from(SidecarStatus {
            ready: true,
            session_id: Some(7),
            engine_active: true,
            focus_lost: false,
            switching: false,
            progressive_commit_active: true,
            committed_character_count: 18,
            ownership_intact: true,
            finalization_outcome: None,
            current_engine: "voco".to_string(),
            default_engine: "xkb:us::eng".to_string(),
            error: String::new(),
        });

        assert!(status.available);
        assert!(status.ready);
        assert_eq!(status.session_id, Some(7));
        assert!(status.engine_active);
        assert!(status.progressive_commit_active);
        assert_eq!(status.committed_character_count, 18);
        assert!(status.ownership_intact);
        assert_eq!(status.current_engine, "voco");
        assert_eq!(status.default_engine, "xkb:us::eng");
        assert_eq!(status.error, None);
    }

    #[test]
    fn embedded_engine_uses_owned_preedit_and_commit_apis() {
        assert!(ENGINE_SCRIPT.contains("update_preedit_text_with_mode"));
        assert!(ENGINE_SCRIPT.contains("commit_text"));
        assert!(ENGINE_SCRIPT.contains("ownership_intact"));
        assert!(ENGINE_SCRIPT.contains("plan.commands()"));
        assert!(OWNERSHIP_SCRIPT.contains("cannot authorize destructive editing"));
        assert!(!ENGINE_SCRIPT.contains("delete_surrounding_text"));
        assert!(!OWNERSHIP_SCRIPT.contains("delete-surrounding-text"));
        assert!(!ENGINE_SCRIPT.contains("get_surrounding_text"));
        assert!(ENGINE_SCRIPT.contains("bus.set_global_engine(default_engine)"));
        assert!(ENGINE_SCRIPT.contains("IBus has no active desktop input engine"));
        assert!(ENGINE_SCRIPT.contains("register_context_reset"));
        assert!(!ENGINE_SCRIPT.contains("print(text"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a live IBus desktop session and focused input context"]
    fn desktop_sidecar_restores_the_previous_engine_on_shutdown() {
        let before = Command::new(IBUS_PATH)
            .arg("engine")
            .output()
            .expect("query the current IBus engine");
        assert!(before.status.success());
        let before = String::from_utf8(before.stdout)
            .expect("IBus engine name is UTF-8")
            .trim()
            .to_string();
        assert!(!before.is_empty());

        let service = OwnedPreeditService::default();
        let status = service.start(99_001).expect("activate the VOCO engine");
        assert!(status.engine_active);
        let session_id = status.session_id.expect("service-issued session ID");
        let status = service
            .update(
                session_id,
                String::new(),
                "VOCO provisional text".to_string(),
                "VOCO provisional text".to_string(),
            )
            .expect("publish provisional text");
        assert!(status.engine_active);
        let status = service
            .update(
                session_id,
                String::new(),
                "VOCO revised provisional text".to_string(),
                "VOCO revised provisional text".to_string(),
            )
            .expect("revise provisional text");
        assert!(status.engine_active);
        service.cancel(session_id).expect("cancel provisional text");
        service.shutdown();

        let after = Command::new(IBUS_PATH)
            .arg("engine")
            .output()
            .expect("query the restored IBus engine");
        assert!(after.status.success());
        let after = String::from_utf8(after.stdout)
            .expect("IBus engine name is UTF-8")
            .trim()
            .to_string();
        assert_eq!(after, before);
    }
}
