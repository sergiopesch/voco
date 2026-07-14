use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;

const PROTOCOL_VERSION: u32 = 1;
const COMPONENT_PATH: &str = "/usr/share/ibus/component/voco.xml";
const SOCKET_DIRECTORY_NAME: &str = "voco";
const SOCKET_FILE_NAME: &str = "ibus-engine.sock";
const IPC_TIMEOUT: Duration = Duration::from_millis(1_000);
const MAX_TEXT_BYTES: usize = 1_000_000;
const MAX_REQUEST_BYTES: usize = 4_000_000;
const MAX_RESPONSE_BYTES: usize = 64_000;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OwnedPreeditStatus {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    ready: bool,
    #[serde(default = "ready_setup_state")]
    setup_state: String,
    session_id: Option<u64>,
    engine_active: bool,
    focus_lost: bool,
    #[serde(default)]
    progressive_commit_active: bool,
    #[serde(default)]
    committed_character_count: usize,
    #[serde(default)]
    ownership_intact: bool,
    #[serde(default)]
    finalization_outcome: Option<String>,
    #[serde(default)]
    error: String,
}

fn ready_setup_state() -> String {
    "ready".to_string()
}

impl From<EngineStatus> for OwnedPreeditStatus {
    fn from(status: EngineStatus) -> Self {
        Self {
            available: true,
            ready: status.ready,
            setup_state: status.setup_state,
            detail: "VOCO Dictation is enabled and its private input channel is ready.".to_string(),
            session_id: status.session_id,
            engine_active: status.engine_active,
            focus_lost: status.focus_lost,
            progressive_commit_active: status.progressive_commit_active,
            committed_character_count: status.committed_character_count,
            ownership_intact: status.ownership_intact,
            finalization_outcome: status.finalization_outcome,
            error: (!status.error.is_empty()).then_some(status.error),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ProtocolResponse {
    version: u32,
    id: Option<u64>,
    ok: bool,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: String,
}

#[derive(Debug)]
enum BridgeCommandError {
    Rejected(String),
    Uncertain(String),
}

impl BridgeCommandError {
    fn message(self) -> String {
        match self {
            Self::Rejected(message) | Self::Uncertain(message) => message,
        }
    }
}

struct SocketBridge {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
    next_id: u64,
}

impl SocketBridge {
    fn connect() -> Result<Self, String> {
        let socket_path = runtime_socket_path()?;
        Self::connect_to(&socket_path)
    }

    fn connect_to(socket_path: &Path) -> Result<Self, String> {
        validate_socket_path(socket_path)?;
        let writer = UnixStream::connect(socket_path).map_err(|error| {
            format!(
                "VOCO Dictation is not active at {}: {error}",
                socket_path.display()
            )
        })?;
        validate_peer(&writer)?;
        writer
            .set_read_timeout(Some(IPC_TIMEOUT))
            .and_then(|_| writer.set_write_timeout(Some(IPC_TIMEOUT)))
            .map_err(|error| format!("Failed to bound VOCO input method IPC: {error}"))?;
        let reader = BufReader::new(
            writer
                .try_clone()
                .map_err(|error| format!("Failed to open VOCO input method IPC: {error}"))?,
        );
        let mut bridge = Self {
            writer,
            reader,
            next_id: 1,
        };
        bridge
            .send_status(json!({ "operation": "hello" }))
            .map_err(BridgeCommandError::message)?;
        Ok(bridge)
    }

    fn send_status(
        &mut self,
        mut command: Value,
    ) -> Result<OwnedPreeditStatus, BridgeCommandError> {
        let result = self.send(&mut command)?;
        let status = serde_json::from_value::<EngineStatus>(result).map_err(|error| {
            BridgeCommandError::Uncertain(format!("Invalid VOCO input method status: {error}"))
        })?;
        Ok(OwnedPreeditStatus::from(status))
    }

    fn send(&mut self, command: &mut Value) -> Result<Value, BridgeCommandError> {
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).ok_or_else(|| {
            BridgeCommandError::Uncertain(
                "VOCO input method request counter was exhausted.".to_string(),
            )
        })?;
        command["version"] = Value::from(PROTOCOL_VERSION);
        command["id"] = Value::from(id);

        let mut encoded = serde_json::to_vec(command).map_err(|error| {
            BridgeCommandError::Uncertain(format!(
                "Failed to encode VOCO input method command: {error}"
            ))
        })?;
        encoded.push(b'\n');
        if encoded.len() > MAX_REQUEST_BYTES {
            return Err(BridgeCommandError::Uncertain(
                "VOCO input method command exceeds the safety limit.".to_string(),
            ));
        }
        self.writer
            .write_all(&encoded)
            .and_then(|_| self.writer.flush())
            .map_err(|error| {
                BridgeCommandError::Uncertain(format!(
                    "Failed to send VOCO input method command: {error}"
                ))
            })?;

        let mut response_line = Vec::new();
        let bytes_read = (&mut self.reader)
            .take((MAX_RESPONSE_BYTES + 1) as u64)
            .read_until(b'\n', &mut response_line)
            .map_err(|error| {
                BridgeCommandError::Uncertain(format!(
                    "Failed to read VOCO input method response: {error}"
                ))
            })?;
        if bytes_read == 0 {
            return Err(BridgeCommandError::Uncertain(
                "The VOCO input method disconnected unexpectedly.".to_string(),
            ));
        }
        if response_line.len() > MAX_RESPONSE_BYTES || !response_line.ends_with(b"\n") {
            return Err(BridgeCommandError::Uncertain(
                "VOCO input method response exceeds the safety limit.".to_string(),
            ));
        }
        response_line.pop();

        let response: ProtocolResponse =
            serde_json::from_slice(&response_line).map_err(|error| {
                BridgeCommandError::Uncertain(format!(
                    "Invalid VOCO input method response: {error}"
                ))
            })?;
        if response.version != PROTOCOL_VERSION {
            return Err(BridgeCommandError::Uncertain(format!(
                "VOCO input method protocol version {} is incompatible with app version {}.",
                response.version, PROTOCOL_VERSION
            )));
        }
        if !response.ok && response.id.is_none() {
            return Err(BridgeCommandError::Uncertain(
                if response.error.is_empty() {
                    "The VOCO input method rejected the connection.".to_string()
                } else {
                    response.error
                },
            ));
        }
        if response.id != Some(id) {
            return Err(BridgeCommandError::Uncertain(
                "VOCO input method response order was invalid.".to_string(),
            ));
        }
        if !response.ok {
            return Err(BridgeCommandError::Rejected(if response.error.is_empty() {
                "The VOCO input method rejected the command.".to_string()
            } else {
                response.error
            }));
        }

        Ok(response.result.unwrap_or(Value::Null))
    }
}

pub struct OwnedPreeditService {
    bridge: Mutex<Option<SocketBridge>>,
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
        // Renderer counters can restart after a reload. A backend generation
        // prevents delayed renderer commands from acting on a later session.
        let session_id = self.allocate_session_id()?;
        let status = self.with_bridge(|bridge| {
            bridge.send_status(json!({
                "operation": "start",
                "clientSessionId": session_id,
            }))
        })?;
        if !status_matches_session(&status, session_id) {
            self.cancel_best_effort(status.session_id);
            return Err("VOCO input method returned an invalid session lease.".to_string());
        }
        if !status.engine_active || status.focus_lost {
            self.cancel_best_effort(status.session_id);
            return Err(
                "Enable VOCO Dictation as the active input source and focus a text field first."
                    .to_string(),
            );
        }
        Ok(status)
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
        if let Ok(mut guard) = self.bridge.lock() {
            guard.take();
        }
    }

    fn cancel_best_effort(&self, session_id: Option<u64>) {
        if let Some(session_id) = session_id {
            let _ = self.cancel(session_id);
        }
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
        operation: impl FnOnce(&mut SocketBridge) -> Result<T, BridgeCommandError>,
    ) -> Result<T, String> {
        let mut guard = self
            .bridge
            .lock()
            .map_err(|_| "VOCO input method state is unavailable.".to_string())?;
        if guard.is_none() {
            *guard = Some(SocketBridge::connect()?);
        }
        match operation(guard.as_mut().expect("bridge initialized above")) {
            Ok(result) => Ok(result),
            Err(BridgeCommandError::Rejected(error)) => Err(error),
            Err(BridgeCommandError::Uncertain(error)) => {
                // Never retry a mutation across an uncertain connection.
                // Closing the socket makes the engine discard only VOCO's
                // active preedit. An ordered engine rejection is safe to keep.
                guard.take();
                Err(error)
            }
        }
    }
}

fn runtime_socket_path() -> Result<PathBuf, String> {
    let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "XDG_RUNTIME_DIR is unavailable in this desktop session.".to_string())?;
    if !runtime_dir.is_absolute() {
        return Err("XDG_RUNTIME_DIR must be an absolute path.".to_string());
    }
    validate_private_directory(&runtime_dir, "XDG_RUNTIME_DIR")?;
    Ok(runtime_dir
        .join(SOCKET_DIRECTORY_NAME)
        .join(SOCKET_FILE_NAME))
}

fn validate_socket_path(socket_path: &Path) -> Result<(), String> {
    let parent = socket_path
        .parent()
        .ok_or_else(|| "VOCO input method socket has no parent directory.".to_string())?;
    validate_private_directory(parent, "VOCO runtime socket directory")?;
    let metadata = fs::symlink_metadata(socket_path)
        .map_err(|error| format!("VOCO Dictation input source is not active: {error}"))?;
    if !metadata.file_type().is_socket() {
        return Err("VOCO input method path is not a Unix socket.".to_string());
    }
    if metadata.uid() != current_euid() {
        return Err("VOCO input method socket is owned by another user.".to_string());
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err("VOCO input method socket permissions are not private.".to_string());
    }
    Ok(())
}

fn validate_private_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("{label} is unavailable: {error}"))?;
    if !metadata.file_type().is_dir() {
        return Err(format!("{label} is not a directory."));
    }
    if metadata.uid() != current_euid() {
        return Err(format!("{label} is owned by another user."));
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err(format!("{label} permissions are not private."));
    }
    Ok(())
}

fn validate_peer(stream: &UnixStream) -> Result<(), String> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: `credentials` and `length` are valid writable buffers for the
    // kernel's fixed-size SO_PEERCRED result, and the stream fd stays open.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut length,
        )
    };
    if result != 0 || length as usize != std::mem::size_of::<libc::ucred>() {
        return Err("Could not verify the VOCO input method peer.".to_string());
    }
    if credentials.uid != current_euid() {
        return Err("VOCO input method peer is owned by another user.".to_string());
    }
    Ok(())
}

fn current_euid() -> u32 {
    // SAFETY: geteuid has no preconditions or failure mode.
    unsafe { libc::geteuid() }
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
    let component_installed = Path::new(COMPONENT_PATH).is_file();
    let (setup_state, detail) = classify_unavailable_status(&error, component_installed);
    OwnedPreeditStatus {
        setup_state: setup_state.to_string(),
        detail: detail.to_string(),
        error: Some(error),
        ..OwnedPreeditStatus::default()
    }
}

fn classify_unavailable_status(
    error: &str,
    component_installed: bool,
) -> (&'static str, &'static str) {
    if error.contains("protocol version") {
        (
            "incompatible",
            "The app and VOCO input source have different protocol versions. Reinstall the current package, then switch the input source away and back.",
        )
    } else if error.contains("XDG_RUNTIME_DIR is unavailable")
        || error.contains("XDG_RUNTIME_DIR must be an absolute path")
    {
        (
            "runtime-unavailable",
            "The desktop runtime directory is unavailable. Sign out and back in before retrying.",
        )
    } else if error.contains("already connected") {
        (
            "error",
            "Another VOCO app process already controls the input source. Close the older process before retrying.",
        )
    } else if component_installed
        && (error.contains("not active")
            || error.contains("No such file")
            || error.contains("Connection refused"))
    {
        (
            "not-enabled",
            "Add VOCO Dictation in the desktop Input Sources settings, select it, and focus the target text field.",
        )
    } else if !component_installed {
        (
            "not-installed",
            "Install the VOCO Debian package to add the VOCO Dictation input source. Source and AppImage builds remain preview-only.",
        )
    } else {
        (
            "error",
            "The VOCO input source failed a private IPC safety check. Keep stable cursor mode preview-only and reinstall the current package before retrying.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    const ENGINE_SCRIPT: &str = include_str!("../resources/voco_ibus_engine.py");
    const PROTOCOL_SCRIPT: &str = include_str!("../resources/voco_ibus_protocol.py");
    const OWNERSHIP_SCRIPT: &str = include_str!("../resources/voco_ibus_ownership.py");
    const COMPONENT_XML: &str = include_str!("../../../../packaging/ibus/voco.xml");

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
    fn converts_engine_status_without_exposing_empty_errors() {
        let status = OwnedPreeditStatus::from(EngineStatus {
            ready: true,
            setup_state: "ready".to_string(),
            session_id: Some(7),
            engine_active: true,
            focus_lost: false,
            progressive_commit_active: true,
            committed_character_count: 18,
            ownership_intact: true,
            finalization_outcome: None,
            error: String::new(),
        });

        assert!(status.available);
        assert!(status.ready);
        assert_eq!(status.setup_state, "ready");
        assert_eq!(status.session_id, Some(7));
        assert!(status.engine_active);
        assert!(status.progressive_commit_active);
        assert_eq!(status.committed_character_count, 18);
        assert!(status.ownership_intact);
        assert_eq!(status.error, None);
    }

    #[test]
    fn classifies_only_absent_or_refused_installed_sockets_as_not_enabled() {
        for error in [
            "VOCO Dictation is not active at /run/user/1/voco/ibus-engine.sock",
            "VOCO Dictation input source is not active: No such file or directory",
            "VOCO Dictation is not active: Connection refused",
        ] {
            assert_eq!(classify_unavailable_status(error, true).0, "not-enabled");
        }
        for error in [
            "VOCO input method socket permissions are not private",
            "Could not verify the VOCO input method peer",
            "Invalid VOCO input method response",
            "Failed to read VOCO input method response: timed out",
            "VOCO input method response order was invalid",
            "XDG_RUNTIME_DIR permissions are not private",
        ] {
            assert_eq!(classify_unavailable_status(error, true).0, "error");
        }
    }

    #[test]
    fn classifies_setup_and_protocol_failures_actionably() {
        assert_eq!(
            classify_unavailable_status("protocol version mismatch", true).0,
            "incompatible"
        );
        assert_eq!(
            classify_unavailable_status("XDG_RUNTIME_DIR is unavailable", true).0,
            "runtime-unavailable"
        );
        assert_eq!(
            classify_unavailable_status("input method is already connected", true).0,
            "error"
        );
        assert_eq!(
            classify_unavailable_status("No such file or directory", false).0,
            "not-installed"
        );
    }

    #[test]
    fn production_engine_has_no_global_switch_or_destructive_api() {
        for forbidden in [
            "set_global_engine",
            "register_component",
            "delete_surrounding_text",
            "get_surrounding_text",
        ] {
            assert!(!ENGINE_SCRIPT.contains(forbidden), "found {forbidden}");
        }
        assert!(ENGINE_SCRIPT.contains("update_preedit_text_with_mode"));
        assert!(ENGINE_SCRIPT.contains("commit_text"));
        assert!(ENGINE_SCRIPT.contains("return False"));
        assert!(ENGINE_SCRIPT.contains("clientSessionId"));
        assert!(PROTOCOL_SCRIPT.contains("SO_PEERCRED"));
        assert!(OWNERSHIP_SCRIPT.contains("cannot authorize destructive editing"));
        assert!(!ENGINE_SCRIPT.contains("print(text"));
    }

    #[test]
    fn packaged_component_is_explicit_and_not_preferred() {
        assert!(COMPONENT_XML.contains("<name>org.freedesktop.IBus.Voco</name>"));
        assert!(COMPONENT_XML.contains("<exec>/usr/libexec/voco-ibus-engine</exec>"));
        assert!(COMPONENT_XML.contains("<name>voco</name>"));
        assert!(COMPONENT_XML.contains("<rank>0</rank>"));
    }

    fn temporary_socket_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "voco-owned-preedit-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&directory).expect("create private test directory");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .expect("secure test directory");
        directory.join("ibus-engine.sock")
    }

    fn ready_response(id: u64, protocol_version: u32) -> Value {
        json!({
            "version": protocol_version,
            "id": id,
            "ok": true,
            "result": {
                "ready": true,
                "setupState": "ready",
                "sessionId": null,
                "engineActive": false,
                "focusLost": false,
                "progressiveCommitActive": false,
                "committedCharacterCount": 0,
                "ownershipIntact": true,
                "finalizationOutcome": null,
                "error": ""
            }
        })
    }

    fn write_response(stream: &mut UnixStream, value: &Value) {
        serde_json::to_writer(&mut *stream, value).expect("encode fake response");
        stream.write_all(b"\n").expect("terminate fake response");
        stream.flush().expect("flush fake response");
    }

    #[test]
    fn private_socket_client_negotiates_and_preserves_request_order() {
        let socket_path = temporary_socket_path("round-trip");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
            .expect("secure fake engine socket");
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept app client");
            let mut reader = BufReader::new(stream.try_clone().expect("clone fake stream"));
            let mut writer = stream;
            for expected_operation in ["hello", "status"] {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read request");
                let request: Value = serde_json::from_str(&line).expect("decode request");
                assert_eq!(request["version"], PROTOCOL_VERSION);
                assert_eq!(request["operation"], expected_operation);
                let id = request["id"].as_u64().expect("request id");
                write_response(&mut writer, &ready_response(id, PROTOCOL_VERSION));
            }
        });

        let mut bridge = SocketBridge::connect_to(&socket_path).expect("connect fake engine");
        let status = bridge
            .send_status(json!({ "operation": "status" }))
            .expect("read fake status");
        assert!(status.available);
        assert_eq!(status.setup_state, "ready");
        drop(bridge);
        server.join().expect("fake server completed");
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn private_socket_client_rejects_protocol_version_mismatch() {
        let socket_path = temporary_socket_path("version");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
            .expect("secure fake engine socket");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept app client");
            let mut line = String::new();
            BufReader::new(stream.try_clone().expect("clone fake stream"))
                .read_line(&mut line)
                .expect("read hello");
            let request: Value = serde_json::from_str(&line).expect("decode hello");
            let id = request["id"].as_u64().expect("request id");
            write_response(&mut stream, &ready_response(id, PROTOCOL_VERSION + 1));
        });

        let error = match SocketBridge::connect_to(&socket_path) {
            Ok(_) => panic!("protocol mismatch should fail"),
            Err(error) => error,
        };
        assert!(error.contains("protocol version"));
        server.join().expect("fake server completed");
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn private_socket_client_rejects_permissive_socket_mode() {
        let socket_path = temporary_socket_path("mode");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o666))
            .expect("make fake socket unsafe");
        let error = validate_socket_path(&socket_path).expect_err("unsafe mode rejected");
        assert!(error.contains("permissions are not private"));
        drop(listener);
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn shutdown_drops_the_renderer_connection() {
        let socket_path = temporary_socket_path("renderer-reload");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
            .expect("secure fake engine socket");
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept app client");
            let mut reader = BufReader::new(stream.try_clone().expect("clone fake stream"));
            let mut writer = stream;
            let mut line = String::new();
            reader.read_line(&mut line).expect("read hello");
            let request: Value = serde_json::from_str(&line).expect("decode hello");
            let id = request["id"].as_u64().expect("request id");
            write_response(&mut writer, &ready_response(id, PROTOCOL_VERSION));
            let mut byte = [0_u8; 1];
            assert_eq!(reader.read(&mut byte).expect("read client close"), 0);
        });

        let bridge = SocketBridge::connect_to(&socket_path).expect("connect fake engine");
        let service = OwnedPreeditService {
            bridge: Mutex::new(Some(bridge)),
            next_session_id: AtomicU64::new(1),
        };
        service.shutdown();

        server.join().expect("fake server completed");
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn ordered_stale_rejection_keeps_the_current_connection() {
        let socket_path = temporary_socket_path("stale-rejection");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
            .expect("secure fake engine socket");
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept app client");
            let mut reader = BufReader::new(stream.try_clone().expect("clone fake stream"));
            let mut writer = stream;

            let mut hello_line = String::new();
            reader.read_line(&mut hello_line).expect("read hello");
            let hello: Value = serde_json::from_str(&hello_line).expect("decode hello");
            write_response(
                &mut writer,
                &ready_response(hello["id"].as_u64().expect("hello id"), PROTOCOL_VERSION),
            );

            let mut stale_line = String::new();
            reader
                .read_line(&mut stale_line)
                .expect("read stale update");
            let stale: Value = serde_json::from_str(&stale_line).expect("decode stale update");
            assert_eq!(stale["operation"], "update");
            write_response(
                &mut writer,
                &json!({
                    "version": PROTOCOL_VERSION,
                    "id": stale["id"],
                    "ok": false,
                    "error": "stale or inactive session"
                }),
            );

            let mut status_line = String::new();
            reader
                .read_line(&mut status_line)
                .expect("read status after rejection");
            let status: Value = serde_json::from_str(&status_line).expect("decode status");
            assert_eq!(status["operation"], "status");
            write_response(
                &mut writer,
                &ready_response(status["id"].as_u64().expect("status id"), PROTOCOL_VERSION),
            );
        });

        let bridge = SocketBridge::connect_to(&socket_path).expect("connect fake engine");
        let service = OwnedPreeditService {
            bridge: Mutex::new(Some(bridge)),
            next_session_id: AtomicU64::new(1),
        };
        let error = service
            .update(99, String::new(), "tail".to_string(), "tail".to_string())
            .expect_err("stale update rejected");
        assert_eq!(error, "stale or inactive session");
        assert!(service.status().available);

        service.shutdown();
        server.join().expect("fake server completed");
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }
}
