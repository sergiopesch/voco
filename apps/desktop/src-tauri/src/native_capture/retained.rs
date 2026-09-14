//! Independent renderer-retention witness, explicitly enabled and one-shot.
use super::{private_bundle, protocol::Identity};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::InvokeBody;

const MAX_HEADER: usize = 65_536;
const MAX_PCM: usize = 26_460_000 * 4;
static ATTEMPTED: AtomicBool = AtomicBool::new(false);

fn flags_enabled(native: Option<&str>, prepared: Option<&str>, raw: Option<&str>) -> bool {
    native == Some("1") && prepared == Some("1") && raw == Some("1")
}

pub(crate) fn enabled() -> bool {
    flags_enabled(
        std::env::var("VOCO_DEV_NATIVE_CAPTURE").ok().as_deref(),
        std::env::var("VOCO_DEBUG_CAPTURE_AUDIO").ok().as_deref(),
        std::env::var("VOCO_DEBUG_NATIVE_CAPTURE").ok().as_deref(),
    ) && !ATTEMPTED.load(Ordering::SeqCst)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    backend: String,
    session_id: u64,
    generation: u64,
    source_sample_rate: u32,
    source_channels: u8,
    delivered_channels: u8,
    source_identity: String,
    conversion: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceIdentity {
    selection_token: String,
    name: String,
    label: String,
    index: u32,
    object_serial: String,
    is_monitor: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    schema_version: u8,
    native_capture_identity: Identity,
    capture_descriptor: Descriptor,
    stage: String,
    sample_format: String,
    sample_count: u64,
    byte_length: u64,
    terminal_outcome: String,
}

fn parse(body: &InvokeBody) -> Result<(Metadata, &[u8]), String> {
    let InvokeBody::Raw(bytes) = body else {
        return Err("Native retained-source evidence requires binary transport".into());
    };
    if bytes.len() < 4 || bytes.len() > 4 + MAX_HEADER + MAX_PCM {
        return Err("Native retained-source packet size is invalid".into());
    }
    let header = u32::from_le_bytes(bytes[..4].try_into().expect("checked header")) as usize;
    if header == 0 || header > MAX_HEADER || header > bytes.len() - 4 {
        return Err("Native retained-source header size is invalid".into());
    }
    let metadata: Metadata = serde_json::from_slice(&bytes[4..4 + header])
        .map_err(|e| format!("Invalid native retained-source metadata: {e}"))?;
    let pcm = &bytes[4 + header..];
    let identity = &metadata.native_capture_identity;
    let descriptor = &metadata.capture_descriptor;
    let source: SourceIdentity = serde_json::from_str(&descriptor.source_identity)
        .map_err(|_| "Native source identity is invalid")?;
    if metadata.schema_version != 1
        || identity.capture_id.is_empty()
        || identity.capture_id.len() > 256
        || identity.session_id == 0
        || identity.session_id > super::protocol::MAX_SAFE_INTEGER
        || identity.generation > super::protocol::MAX_SAFE_INTEGER
        || descriptor.backend != "native"
        || descriptor.session_id != identity.session_id
        || descriptor.generation != identity.generation
        || descriptor.source_sample_rate != 44_100
        || descriptor.source_channels != 2
        || descriptor.delivered_channels != 1
        || descriptor.conversion != "s16le-stereo-average"
        || source.selection_token.is_empty()
        || source.name.is_empty()
        || source.object_serial.is_empty()
        || metadata.stage != "renderer-retained-source-before-dc-resample"
        || metadata.sample_format != "f32le"
        || !matches!(
            metadata.terminal_outcome.as_str(),
            "healthy-stop" | "interrupted" | "cancelled"
        )
        || pcm.len() > MAX_PCM
        || pcm.len() % 4 != 0
        || metadata.sample_count != (pcm.len() / 4) as u64
        || metadata.byte_length != pcm.len() as u64
    {
        return Err("Native retained-source identity, format or coverage is invalid".into());
    }
    // Full source fields are type-checked here and matched to the native witness offline.
    let _ = (source.index, source.label, source.is_monitor);
    if pcm
        .chunks_exact(4)
        .any(|bytes| !f32::from_le_bytes(bytes.try_into().expect("exact float bytes")).is_finite())
    {
        return Err("Native retained-source evidence contains non-finite samples".into());
    }
    Ok((metadata, pcm))
}

pub(crate) fn save(
    body: &InvokeBody,
    verify_stopped: impl FnOnce(Identity) -> Result<(), String>,
) -> Result<Option<String>, String> {
    if !enabled() || ATTEMPTED.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    // Failed validation, stopped-state verification or persistence never rearms the latch.
    let (metadata, pcm) = parse(body)?;
    verify_stopped(metadata.native_capture_identity.clone())?;
    let commit = json!({
        "complete": metadata.terminal_outcome == "healthy-stop",
        "guiPid": std::process::id(),
        "identity": metadata.native_capture_identity,
        "terminalOutcome": metadata.terminal_outcome,
    });
    let mut envelope = serde_json::to_value(&metadata).map_err(|e| e.to_string())?;
    envelope["guiPid"] = json!(std::process::id());
    envelope["optIn"] =
        json!({"nativeCaptureDev":true,"debugCaptureAudio":true,"debugNativeCapture":true});
    let encoded = serde_json::to_vec_pretty(&envelope).map_err(|e| e.to_string())?;
    let path = private_bundle::write_bundle(
        "renderer",
        &[("source.f32le", pcm), ("renderer.json", encoded.as_slice())],
        commit,
    )?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn metadata() -> serde_json::Value {
        json!({"schemaVersion":1,"nativeCaptureIdentity":{"captureId":"native-1-1","sessionId":1,"generation":2},
            "captureDescriptor":{"backend":"native","sessionId":1,"generation":2,"sourceSampleRate":44100,
              "sourceChannels":2,"deliveredChannels":1,"sourceIdentity":json!({"selectionToken":"chosen","name":"source","label":"Public fixture","index":62,"objectSerial":"62","isMonitor":false}).to_string(),"conversion":"s16le-stereo-average"},
            "stage":"renderer-retained-source-before-dc-resample","sampleFormat":"f32le","sampleCount":2,"byteLength":8,"terminalOutcome":"healthy-stop"})
    }
    fn packet(metadata: serde_json::Value, pcm: &[u8]) -> InvokeBody {
        let header = serde_json::to_vec(&metadata).unwrap();
        let mut bytes = (header.len() as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(&header);
        bytes.extend_from_slice(pcm);
        InvokeBody::Raw(bytes)
    }
    #[test]
    fn requires_every_exact_opt_in_flag() {
        assert!(flags_enabled(Some("1"), Some("1"), Some("1")));
        for bad in [None, Some(""), Some("true"), Some("0"), Some(" 1")] {
            assert!(!flags_enabled(bad, Some("1"), Some("1")));
            assert!(!flags_enabled(Some("1"), bad, Some("1")));
            assert!(!flags_enabled(Some("1"), Some("1"), bad));
        }
    }
    #[test]
    fn retains_exact_finite_source_bytes_without_audio_conversion() {
        let bytes = [0.25_f32.to_le_bytes(), (-0.125_f32).to_le_bytes()].concat();
        let body = packet(metadata(), &bytes);
        let (decoded, actual) = parse(&body).unwrap();
        assert_eq!(decoded.native_capture_identity.capture_id, "native-1-1");
        assert_eq!(actual, bytes);
    }
    #[test]
    fn rejects_bad_identity_format_coverage_unknown_fields_and_nonfinite_samples() {
        let bytes = [0.25_f32.to_le_bytes(), (-0.125_f32).to_le_bytes()].concat();
        for (pointer, value) in [
            ("/nativeCaptureIdentity/sessionId", json!(0)),
            ("/captureDescriptor/generation", json!(3)),
            ("/captureDescriptor/sourceSampleRate", json!(48000)),
            ("/sampleCount", json!(1)),
            ("/byteLength", json!(4)),
            ("/stage", json!("prepared-audio")),
            ("/sampleFormat", json!("pcm16")),
            ("/terminalOutcome", json!("recording")),
        ] {
            let mut value_metadata = metadata();
            *value_metadata.pointer_mut(pointer).unwrap() = value;
            assert!(parse(&packet(value_metadata, &bytes)).is_err(), "{pointer}");
        }
        let mut extra = metadata();
        extra["unexpected"] = json!(true);
        assert!(parse(&packet(extra, &bytes)).is_err());
        assert!(parse(&packet(metadata(), &bytes[..7])).is_err());
        assert!(parse(&packet(
            metadata(),
            &[f32::NAN.to_le_bytes(), 0_f32.to_le_bytes()].concat()
        ))
        .is_err());
        assert!(parse(&InvokeBody::Json(metadata())).is_err());
        assert!(parse(&InvokeBody::Raw(u32::MAX.to_le_bytes().to_vec())).is_err());
    }
}
