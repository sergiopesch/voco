use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const PROTOCOL_VERSION: u32 = 6;
const COMPONENT_PATH: &str = "/usr/share/ibus/component/voco.xml";
const SOCKET_DIRECTORY_NAME: &str = "voco";
const SOCKET_FILE_NAME: &str = "ibus-engine.sock";
const IPC_TIMEOUT: Duration = Duration::from_millis(1_000);
const MAX_REQUEST_BYTES: usize = 4_000_000;
const MAX_RESPONSE_BYTES: usize = 64_000;
const CONNECTED_DETAIL: &str = "The VOCO Dictation input source is running. It takes the dictation shortcut in IBus-aware fields; dictation does not need it.";

/// The optional IBus input source only takes the dictation shortcut. VOCO
/// never asks it to change text.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IbusShortcutStatus {
    pub available: bool,
    pub setup_state: String,
    pub detail: String,
    pub error: Option<String>,
}

impl IbusShortcutStatus {
    fn connected() -> Self {
        Self {
            available: true,
            setup_state: "ready".to_string(),
            detail: CONNECTED_DETAIL.to_string(),
            error: None,
        }
    }
}

/// Protocol 6 engines still send the text-insertion status fields, reporting
/// "safety-disabled", so that earlier apps can decode them. A well-formed
/// reply only proves that the shortcut route is connected.
#[derive(Debug, Deserialize)]
struct EngineStatus {
    #[serde(rename = "ready")]
    _ready: bool,
}

#[derive(Debug)]
pub(crate) struct ShortcutPollFailure {
    pub may_have_armed: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ShortcutPoll {
    pub armed: bool,
    pub trigger: Option<ShortcutTrigger>,
}

/// VOCO toggles the same way for every route, so it never reads the engine's
/// trigger ID; the field stays declared because unknown fields are refused.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ShortcutTrigger {
    #[serde(rename = "triggerId")]
    _trigger_id: String,
    pub mode: String,
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
    ) -> Result<IbusShortcutStatus, BridgeCommandError> {
        let result = self.send(&mut command)?;
        serde_json::from_value::<EngineStatus>(result).map_err(|error| {
            BridgeCommandError::Uncertain(format!("Invalid VOCO input method status: {error}"))
        })?;
        Ok(IbusShortcutStatus::connected())
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

#[derive(Default)]
pub struct IbusShortcutService {
    bridge: Mutex<Option<SocketBridge>>,
}

impl IbusShortcutService {
    pub fn status(&self) -> IbusShortcutStatus {
        match self.with_bridge(|bridge| bridge.send_status(json!({ "operation": "status" }))) {
            Ok(status) => status,
            Err(error) => unavailable_status(error),
        }
    }

    /// `sending` runs just before the poll-trigger request goes out. Only that
    /// request can arm the engine, so a failed connect or hello never calls it.
    pub fn poll_trigger(
        &self,
        hotkey: &str,
        sending: impl FnOnce(),
    ) -> Result<ShortcutPoll, ShortcutPollFailure> {
        self.poll_trigger_from(SocketBridge::connect, hotkey, sending)
    }

    fn poll_trigger_from(
        &self,
        connect: impl FnOnce() -> Result<SocketBridge, String>,
        hotkey: &str,
        sending: impl FnOnce(),
    ) -> Result<ShortcutPoll, ShortcutPollFailure> {
        let mut may_have_armed = false;
        self.with_bridge_from(connect, |bridge| {
            may_have_armed = true;
            sending();
            let result = bridge.send(&mut json!({"operation": "poll-trigger", "hotkey": hotkey}));
            if matches!(result, Err(BridgeCommandError::Rejected(_))) {
                may_have_armed = false;
            }
            serde_json::from_value(result?).map_err(|error| {
                BridgeCommandError::Uncertain(format!("Invalid shortcut proof: {error}"))
            })
        })
        .map_err(|_| ShortcutPollFailure { may_have_armed })
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.bridge.lock() {
            guard.take();
        }
    }

    fn with_bridge<T>(
        &self,
        operation: impl FnOnce(&mut SocketBridge) -> Result<T, BridgeCommandError>,
    ) -> Result<T, String> {
        self.with_bridge_from(SocketBridge::connect, operation)
    }

    /// Tests pass their own connector, so they never reach the session's engine.
    fn with_bridge_from<T>(
        &self,
        connect: impl FnOnce() -> Result<SocketBridge, String>,
        operation: impl FnOnce(&mut SocketBridge) -> Result<T, BridgeCommandError>,
    ) -> Result<T, String> {
        let mut guard = self
            .bridge
            .lock()
            .map_err(|_| "VOCO input method state is unavailable.".to_string())?;
        if guard.is_none() {
            *guard = Some(connect()?);
        }
        match operation(guard.as_mut().expect("bridge initialized above")) {
            Ok(result) => Ok(result),
            Err(BridgeCommandError::Rejected(error)) => Err(error),
            Err(BridgeCommandError::Uncertain(error)) => {
                // Drop an uncertain connection rather than reuse it. Closing
                // the socket makes the engine disarm the shortcut and drop a
                // pending trigger. An ordered engine rejection is safe to keep.
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

fn unavailable_status(error: String) -> IbusShortcutStatus {
    let component_installed = Path::new(COMPONENT_PATH).is_file();
    let (setup_state, detail) = classify_unavailable_status(&error, component_installed);
    IbusShortcutStatus {
        setup_state: setup_state.to_string(),
        detail: detail.to_string(),
        error: Some(error),
        ..IbusShortcutStatus::default()
    }
}

fn classify_unavailable_status(
    error: &str,
    component_installed: bool,
) -> (&'static str, &'static str) {
    if error.contains("protocol version") {
        (
            "incompatible",
            "The app and VOCO input source have different protocol versions. Reinstall the current package, quit VOCO, then run `ibus restart` or sign out and back in before reopening VOCO. Switching input sources is not sufficient.",
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
            "Optional: add VOCO Dictation in the desktop Input Sources settings to use it as a shortcut route. Dictation does not need it.",
        )
    } else if !component_installed {
        (
            "not-installed",
            "The optional VOCO Dictation input source comes with the VOCO Debian package. Dictation does not need it.",
        )
    } else {
        (
            "error",
            "The optional VOCO input source failed a private IPC safety check. Reinstall the current package to use it; dictation does not need it.",
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
    const COMPONENT_XML: &str = include_str!("../../../../packaging/ibus/voco.xml");

    #[test]
    fn decodes_the_protocol_status_and_rejects_malformed_replies() {
        let reply = engine_status_response(1, PROTOCOL_VERSION)["result"].clone();
        assert!(serde_json::from_value::<EngineStatus>(reply).is_ok());
        for malformed in [Value::Null, json!({}), json!({ "ready": "yes" })] {
            assert!(serde_json::from_value::<EngineStatus>(malformed).is_err());
        }
    }

    #[test]
    fn decodes_the_engine_trigger_and_rejects_unknown_trigger_fields() {
        let trigger = json!({ "triggerId": "0123abcd", "mode": "dictation" });
        let poll: ShortcutPoll =
            serde_json::from_value(json!({ "armed": true, "trigger": trigger })).unwrap();
        assert!(poll.armed);
        assert_eq!(poll.trigger.unwrap().mode, "dictation");
        let idle: ShortcutPoll =
            serde_json::from_value(json!({ "armed": false, "trigger": null })).unwrap();
        assert!(idle.trigger.is_none());
        let extended = json!({ "triggerId": "0123abcd", "mode": "dictation", "text": "x" });
        assert!(serde_json::from_value::<ShortcutPoll>(
            json!({ "armed": true, "trigger": extended })
        )
        .is_err());
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
        assert!(
            classify_unavailable_status("protocol version mismatch", true)
                .1
                .contains("ibus restart")
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
        assert!(!ENGINE_SCRIPT.contains("self.update_preedit_text"));
        assert!(!ENGINE_SCRIPT.contains("self.commit_text("));
        assert!(ENGINE_SCRIPT.contains("return False"));
        assert!(PROTOCOL_SCRIPT.contains("SO_PEERCRED"));
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
            "voco-ibus-shortcut-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&directory).expect("create private test directory");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .expect("secure test directory");
        directory.join("ibus-engine.sock")
    }

    /// What a protocol 6 engine replies to hello and status.
    fn engine_status_response(id: u64, protocol_version: u32) -> Value {
        json!({
            "version": protocol_version,
            "id": id,
            "ok": true,
            "result": {
                "ready": false,
                "setupState": "safety-disabled",
                "sessionId": null,
                "engineActive": false,
                "focusLost": false,
                "progressiveCommitActive": false,
                "committedCharacterCount": 0,
                "ownershipIntact": false,
                "finalizationOutcome": null,
                "error": "Automatic IBus delivery is disabled."
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
                write_response(&mut writer, &engine_status_response(id, PROTOCOL_VERSION));
            }
        });

        let mut bridge = SocketBridge::connect_to(&socket_path).expect("connect fake engine");
        let status = bridge
            .send_status(json!({ "operation": "status" }))
            .expect("read fake status");
        assert_eq!(status, IbusShortcutStatus::connected());
        drop(bridge);
        server.join().expect("fake server completed");
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn connected_engine_reports_a_ready_shortcut_route_without_text_operations() {
        let socket_path = temporary_socket_path("shortcut-only");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)).unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut writer = stream;
            // The service may only negotiate and read status before it disconnects.
            for expected in ["hello", "status"] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["operation"], expected);
                write_response(
                    &mut writer,
                    &engine_status_response(request["id"].as_u64().unwrap(), PROTOCOL_VERSION),
                );
            }
            let mut byte = [0_u8; 1];
            assert_eq!(reader.read(&mut byte).unwrap(), 0);
        });
        let bridge = SocketBridge::connect_to(&socket_path).unwrap();
        let service = IbusShortcutService {
            bridge: Mutex::new(Some(bridge)),
        };
        let status = service.status();
        assert!(status.available);
        assert_eq!(status.setup_state, "ready");
        assert!(status.detail.contains("takes the dictation shortcut"));
        assert_eq!(status.error, None);
        service.shutdown();
        server.join().unwrap();
        fs::remove_file(&socket_path).unwrap();
        fs::remove_dir(socket_path.parent().unwrap()).unwrap();
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
            write_response(
                &mut stream,
                &engine_status_response(id, PROTOCOL_VERSION + 1),
            );
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
            write_response(&mut writer, &engine_status_response(id, PROTOCOL_VERSION));
            let mut byte = [0_u8; 1];
            assert_eq!(reader.read(&mut byte).expect("read client close"), 0);
        });

        let bridge = SocketBridge::connect_to(&socket_path).expect("connect fake engine");
        let service = IbusShortcutService {
            bridge: Mutex::new(Some(bridge)),
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
                &engine_status_response(hello["id"].as_u64().expect("hello id"), PROTOCOL_VERSION),
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
                &engine_status_response(
                    status["id"].as_u64().expect("status id"),
                    PROTOCOL_VERSION,
                ),
            );
        });

        let bridge = SocketBridge::connect_to(&socket_path).expect("connect fake engine");
        let service = IbusShortcutService {
            bridge: Mutex::new(Some(bridge)),
        };
        // Drive the bridge directly: the app itself never sends a text operation.
        let error = service
            .with_bridge(|bridge| {
                bridge.send_status(json!({
                    "operation": "update", "sessionId": 99,
                    "confirmedText": "", "preeditText": "tail", "provisionalText": "tail"
                }))
            })
            .expect_err("stale update rejected");
        assert_eq!(error, "stale or inactive session");
        assert!(service.status().available);

        service.shutdown();
        server.join().expect("fake server completed");
        fs::remove_file(&socket_path).expect("remove fake socket");
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn an_unreachable_engine_is_never_polled() {
        let socket_path = temporary_socket_path("absent");
        let service = IbusShortcutService::default();
        let failure = service
            .poll_trigger_from(
                || SocketBridge::connect_to(&socket_path),
                "Alt+D",
                || panic!("no poll-trigger was sent"),
            )
            .expect_err("no engine is listening");
        assert!(!failure.may_have_armed);
        fs::remove_dir(socket_path.parent().expect("socket parent"))
            .expect("remove fake directory");
    }

    #[test]
    fn only_a_poll_trigger_request_is_announced_as_sending() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let socket_path = temporary_socket_path("poll-window");
        let listener = UnixListener::bind(&socket_path).expect("bind fake engine");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)).unwrap();
        let sent = Arc::new(AtomicUsize::new(0));
        let engine_view = Arc::clone(&sent);
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut writer = stream;
            // The client waits for each reply, so the count shows what it announced first.
            for (announced, operation, accept) in [
                (0, "hello", true),
                (1, "poll-trigger", true),
                (2, "poll-trigger", false),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["operation"], operation);
                assert_eq!(engine_view.load(Ordering::SeqCst), announced, "{operation}");
                let id = request["id"].as_u64().unwrap();
                let reply = match (operation, accept) {
                    ("hello", _) => engine_status_response(id, PROTOCOL_VERSION),
                    (_, true) => json!({
                        "version": PROTOCOL_VERSION, "id": id, "ok": true,
                        "result": { "armed": false, "trigger": null }
                    }),
                    _ => json!({
                        "version": PROTOCOL_VERSION, "id": id, "ok": false,
                        "error": "a valid modified dictation hotkey is required"
                    }),
                };
                write_response(&mut writer, &reply);
            }
        });
        let service = IbusShortcutService::default();
        let connect = || SocketBridge::connect_to(&socket_path);
        let announce = || {
            sent.fetch_add(1, Ordering::SeqCst);
        };
        let disarmed = service.poll_trigger_from(connect, "Alt+D", announce);
        let rejected = service.poll_trigger_from(connect, "Alt+D", announce);
        server
            .join()
            .expect("each request was announced at the right time");
        assert!(!disarmed.expect("the engine replied").armed);
        // An ordered rejection means the engine did not arm the shortcut.
        assert!(!rejected.expect_err("the engine refused").may_have_armed);
        service.shutdown();
        fs::remove_file(&socket_path).unwrap();
        fs::remove_dir(socket_path.parent().unwrap()).unwrap();
    }
}
