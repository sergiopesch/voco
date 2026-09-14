//! Diagnostic adapter for actual production full/VCA2 entry points. No decoder,
//! acoustic planner, restoration rule or transcript join is implemented here.
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use voco_lib::transcribe::{default_model_path, WhisperState};
use voco_lib::vca2;
const HORIZON: usize = 480_000;
const PREPARED_STEP: usize = 464_000;
const MAX_SAMPLES: usize = 9_600_000;
const MAX_BYTES: usize = MAX_SAMPLES * 4;
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn pcm_bytes(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}
fn number(value: &Value, key: &str) -> Result<usize, String> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
        .ok_or_else(|| format!("Missing integer {key}"))
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing text {key}"))
}
#[derive(Default, Clone, Debug, PartialEq)]
struct Cursor {
    sequence: usize,
    completed: usize,
    next: usize,
    finalized: bool,
    prefix: String,
}
impl Cursor {
    fn metadata(&self, session: u64, request: u64, count: usize, finalizing: bool) -> Value {
        json!({"protocolVersion":2,"sessionId":session,"requestSequence":request,"generation":0,
            "plannerSequence":self.sequence,"previousDecodedEnd":self.completed,"nextInputStart":self.next,
            "plannerFinalized":self.finalized,"payloadSamples":count,"finalizing":finalizing,
            "previousCanonicalText":self.prefix})
    }
    fn accept(
        &mut self,
        metadata: &Value,
        response: &Value,
        offered_end: usize,
    ) -> Result<(), String> {
        for key in [
            "protocolVersion",
            "sessionId",
            "requestSequence",
            "generation",
        ] {
            if response.get(key) != metadata.get(key) {
                return Err(format!("Response identity mismatch: {key}"));
            }
        }
        let receipt = response
            .get("receipt")
            .ok_or("Missing production receipt")?;
        let sequence = number(receipt, "sequence")?;
        let start = number(receipt, "inputStart")?;
        let end = number(receipt, "inputEnd")?;
        let previous = number(receipt, "previousDecodedEnd")?;
        let next = number(receipt, "nextInputStart")?;
        if sequence != self.sequence
            || start != self.next
            || previous != self.completed
            || end <= self.completed
            || end > offered_end
            || next < start
            || next > end
        {
            return Err("Production receipt does not match pending offered progress".into());
        }
        let canonical = text(response, "canonicalText")?;
        let append = text(response, "appendText")?;
        text(response, "chunkText")?;
        if canonical.strip_prefix(&self.prefix) != Some(append) {
            return Err("Production response changed committed prefix/append".into());
        }
        let final_boundary = match text(receipt, "rightBoundaryMode")? {
            "final" => true,
            "numericalPlateau" | "legacyStride" => false,
            _ => return Err("Unknown production boundary mode".into()),
        };
        let next_sequence = self.sequence.checked_add(1).ok_or("Sequence overflow")?;
        // Commit only after every validation; a rejected response leaves this intact.
        *self = Self {
            sequence: next_sequence,
            completed: end,
            next,
            finalized: final_boundary,
            prefix: canonical.into(),
        };
        Ok(())
    }
}
fn packet(metadata: &Value, samples: &[f32]) -> Result<Vec<u8>, String> {
    let encoded = serde_json::to_vec(metadata).map_err(|e| e.to_string())?;
    let length = u32::try_from(encoded.len()).map_err(|_| "Metadata too long")?;
    let mut bytes = Vec::with_capacity(8 + encoded.len() + samples.len() * 4);
    bytes.extend_from_slice(b"VCA2");
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend(encoded);
    bytes.extend(pcm_bytes(samples));
    Ok(bytes)
}
struct Attempt {
    result: Result<Value, String>,
    decisions: Value,
    production_invoked: bool,
    receipt: Option<Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestEvidence {
    metadata: Value,
    offered_start: usize,
    offered_end: usize,
    payload_sha256: String,
    packet_sha256: String,
    response: Option<Value>,
    planned_receipt: Option<Value>,
    decode_decisions: Value,
    production_invoked: bool,
    error: Option<String>,
}
fn sequential<F>(samples: &[f32], session: u64, mut invoke: F) -> Value
where
    F: FnMut(&[u8]) -> Attempt,
{
    let mut cursor = Cursor::default();
    let mut available = samples.len().min(HORIZON);
    let mut requests = Vec::new();
    let mut windows = Vec::new();
    let mut error = None;
    let mut attempted_end = 0;
    if samples.is_empty() || samples.len() > MAX_SAMPLES || samples.iter().any(|s| !s.is_finite()) {
        error = Some("Expected finite complete prepared audio".to_string());
    }
    while error.is_none() && cursor.completed < samples.len() {
        if available - cursor.next < HORIZON && available < samples.len() {
            available = (available + PREPARED_STEP).min(samples.len());
            continue;
        }
        let offered_end = (cursor.next + HORIZON).min(available);
        let audio = &samples[cursor.next..offered_end];
        let metadata = cursor.metadata(
            session,
            requests.len() as u64 + 1,
            audio.len(),
            available == samples.len(),
        );
        let bytes = match packet(&metadata, audio) {
            Ok(b) => b,
            Err(e) => {
                error = Some(e);
                break;
            }
        };
        let attempt = invoke(&bytes);
        if attempt.production_invoked {
            if let Some(r) = &attempt.receipt {
                attempted_end = number(r, "inputEnd").unwrap_or(attempted_end);
            }
        }
        let mut record = RequestEvidence {
            metadata: metadata.clone(),
            offered_start: cursor.next,
            offered_end,
            payload_sha256: sha(&pcm_bytes(audio)),
            packet_sha256: sha(&bytes),
            response: None,
            planned_receipt: attempt.receipt.clone(),
            decode_decisions: attempt.decisions.clone(),
            production_invoked: attempt.production_invoked,
            error: None,
        };
        match attempt.result {
            Ok(response) => {
                let outcome = if response.get("receipt") != attempt.receipt.as_ref()
                    || attempt.receipt.is_none()
                {
                    Err(
                        "Response receipt differs from actual production-planned receipt"
                            .to_string(),
                    )
                } else {
                    cursor.accept(&metadata, &response, offered_end)
                };
                if outcome.is_ok() {
                    let mut w = response["receipt"].clone();
                    w["status"] = json!("completed");
                    w["decodeDecisions"] = attempt.decisions.clone();
                    windows.push(w);
                }
                if let Err(e) = outcome {
                    if let Some(mut w) = attempt.receipt {
                        w["status"] = json!("failed");
                        w["error"] = json!(e);
                        w["decodeDecisions"] = attempt.decisions;
                        windows.push(w);
                    }
                    record.error = Some(e.clone());
                    error = Some(e);
                }
                record.response = Some(response);
            }
            Err(e) => {
                if let Some(mut w) = attempt.receipt {
                    w["status"] = json!("failed");
                    w["error"] = json!(e);
                    w["decodeDecisions"] = attempt.decisions;
                    windows.push(w);
                }
                record.error = Some(e.clone());
                error = Some(e);
            }
        }
        requests.push(record);
    }
    let failed = error.is_some();
    let mut output = json!({"samples":samples.len(),"text":if failed {None}else{Some(cursor.prefix.clone())},"partialText":if failed {Some(cursor.prefix)}else{None},"error":error,
        "completedThrough":cursor.completed,"nextInputStart":cursor.next,"pendingRange":if failed {Some((cursor.next,samples.len()))}else{None},
        "unattemptedRanges":if failed&&attempted_end<samples.len(){vec![(attempted_end,samples.len())]}else{vec![]},"windows":windows,"requests":requests});
    if !failed {
        let fields = output.as_object_mut().expect("constructed object");
        fields.remove("error");
        fields.remove("partialText");
    }
    output
}
fn validate_byte_length(length: u64) -> Result<(), String> {
    if length == 0 || length > MAX_BYTES as u64 || !length.is_multiple_of(4) {
        return Err("Expected 1..9600000 complete LEf32 samples".into());
    }
    Ok(())
}
fn decode_prepared_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    validate_byte_length(bytes.len() as u64)?;
    bytes
        .chunks_exact(4)
        .map(|b| {
            let v = f32::from_le_bytes(b.try_into().map_err(|_| "Partial f32")?);
            if v.is_finite() {
                Ok(v)
            } else {
                Err("Nonfinite prepared sample".into())
            }
        })
        .collect()
}
fn read_prepared_audio(path: &Path) -> Result<Vec<f32>, String> {
    use std::os::unix::fs::OpenOptionsExt;
    let f = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|e| e.to_string())?;
    let m = f.metadata().map_err(|e| e.to_string())?;
    if !m.is_file() {
        return Err("Prepared input must be a regular file".into());
    }
    validate_byte_length(m.len())?;
    let mut bytes = Vec::with_capacity(m.len() as usize);
    f.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 != m.len() {
        return Err("Prepared input changed size while reading".into());
    }
    decode_prepared_bytes(&bytes)
}
fn main() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--mode")) {
        return Err("Usage: application_hybrid_replay --mode full|vca2 <prepared.f32le>...".into());
    }
    let mode = args
        .next()
        .and_then(|s| s.into_string().ok())
        .ok_or("Missing mode")?;
    if mode != "full" && mode != "vca2" {
        return Err("Unknown mode".into());
    }
    let files: Vec<PathBuf> = args.map(PathBuf::from).collect();
    if files.is_empty() {
        return Err("No input files".into());
    }
    let model = std::env::var_os("VOCO_MODEL_PATH")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_model_path)?;
    let mut whisper = WhisperState::new();
    whisper.load_model(&model)?;
    let mut failed = false;
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    for (index, file) in files.iter().enumerate() {
        let name = file.to_str().ok_or("Input path must be UTF-8")?;
        let record = match read_prepared_audio(file) {
            Ok(samples) => {
                let result = if mode == "full" {
                    serde_json::to_value(whisper.transcribe_hybrid_full(&samples))
                        .map_err(|e| e.to_string())?
                } else {
                    sequential(&samples, index as u64 + 1, |bytes| {
                        let request = match vca2::decode_packet(bytes) {
                            Ok(r) => r,
                            Err(e) => {
                                return Attempt {
                                    result: Err(e),
                                    decisions: json!([]),
                                    production_invoked: false,
                                    receipt: None,
                                }
                            }
                        };
                        let receipt =
                            serde_json::to_value(vca2::NumericReceipt::from(request.receipt()))
                                .ok();
                        match whisper.transcribe_hybrid_request(&request) {
                            Ok(value) => Attempt {
                                result: serde_json::to_value(value.response)
                                    .map_err(|e| e.to_string()),
                                decisions: serde_json::to_value(value.decode_decisions)
                                    .unwrap_or(Value::Null),
                                production_invoked: true,
                                receipt,
                            },
                            Err(e) => Attempt {
                                result: Err(e),
                                decisions: serde_json::to_value(whisper.decode_decisions())
                                    .unwrap_or(Value::Null),
                                production_invoked: true,
                                receipt,
                            },
                        }
                    })
                };
                failed |= result.get("error").is_some_and(|e| !e.is_null());
                json!({"file":name,"samples":samples.len(),"pcmSha256":sha(&pcm_bytes(&samples)),"mode":mode,"result":result})
            }
            Err(e) => {
                failed = true;
                json!({"file":name,"mode":mode,"error":e})
            }
        };
        serde_json::to_writer(&mut out, &record).map_err(|e| e.to_string())?;
        out.write_all(b"\n")
            .and_then(|_| out.flush())
            .map_err(|e| e.to_string())?;
    }
    if failed {
        Err("One or more application replays failed; retained JSONL evidence".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn varying(n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| if i % 2 == 0 { -0.01 } else { 0.01 })
            .collect()
    }
    fn fake(bytes: &[u8], fail: bool) -> Attempt {
        let request = vca2::decode_packet(bytes).expect("actual production packet validation");
        let metadata = serde_json::to_value(request.metadata()).unwrap();
        let receipt = serde_json::to_value(vca2::NumericReceipt::from(request.receipt())).unwrap();
        let result = if fail {
            Err("injected decode failure".into())
        } else {
            let prefix = metadata["previousCanonicalText"].as_str().unwrap();
            let append = if prefix.is_empty() { "Go." } else { " Go." };
            Ok(
                json!({"protocolVersion":2,"sessionId":metadata["sessionId"],"requestSequence":metadata["requestSequence"],"generation":0,"receipt":receipt,"chunkText":"Go.","canonicalText":format!("{prefix}{append}"),"appendText":append}),
            )
        };
        Attempt {
            result,
            decisions: json!([]),
            production_invoked: true,
            receipt: Some(receipt),
        }
    }
    #[test]
    fn preserves_f32_bits_and_rejects_bad_lengths_or_nonfinite() {
        let samples = [0.0, -0.0, f32::from_bits(1), 0.12345679, -1.0];
        let bytes = pcm_bytes(&samples);
        assert_eq!(pcm_bytes(&decode_prepared_bytes(&bytes).unwrap()), bytes);
        for n in [0, 1, 3, MAX_BYTES as u64 + 4] {
            assert!(validate_byte_length(n).is_err());
        }
        assert!(decode_prepared_bytes(&f32::NAN.to_le_bytes()).is_err());
        assert!(decode_prepared_bytes(&f32::INFINITY.to_le_bytes()).is_err());
    }
    #[test]
    fn actual_packet_parser_preserves_exact_pcm() {
        let audio = varying(77);
        let metadata = Cursor::default().metadata(1, 1, audio.len(), true);
        let bytes = packet(&metadata, &audio).unwrap();
        let request = vca2::decode_packet(&bytes).unwrap();
        assert_eq!(pcm_bytes(request.decode_samples()), pcm_bytes(&audio));
    }
    #[test]
    fn exact_thirty_seconds_stops_without_overlap_only_packet() {
        let mut calls = 0;
        let output = sequential(&varying(HORIZON), 1, |b| {
            calls += 1;
            fake(b, false)
        });
        assert_eq!(calls, 1);
        assert!(output["error"].is_null());
        assert_eq!(output["completedThrough"], HORIZON);
        assert_eq!(output["nextInputStart"], HORIZON - 16_000);
        assert_eq!(output["windows"][0]["rightBoundaryMode"], "legacyStride");
    }
    #[test]
    fn one_new_sample_offers_real_overlap_tail() {
        let output = sequential(&varying(HORIZON + 1), 1, |b| fake(b, false));
        assert!(output["error"].is_null());
        assert_eq!(output["requests"].as_array().unwrap().len(), 2);
        assert_eq!(output["requests"][1]["metadata"]["payloadSamples"], 16_001);
        assert_eq!(output["completedThrough"], HORIZON + 1);
    }
    #[test]
    fn second_failure_keeps_prefix_and_uncommitted_receipt_evidence() {
        let mut calls = 0;
        let output = sequential(&varying(HORIZON + 100), 1, |b| {
            calls += 1;
            fake(b, calls == 2)
        });
        assert_eq!(calls, 2);
        assert_eq!(output["partialText"], "Go.");
        assert!(output["text"].is_null());
        assert_eq!(output["completedThrough"], HORIZON);
        assert_eq!(output["nextInputStart"], HORIZON - 16_000);
        assert_eq!(output["windows"][1]["status"], "failed");
        assert_eq!(
            output["pendingRange"],
            json!([HORIZON - 16_000, HORIZON + 100])
        );
        assert_eq!(output["unattemptedRanges"], json!([]));
    }
    #[test]
    fn mismatched_identity_or_prefix_cannot_mutate_cursor() {
        let mut cursor = Cursor::default();
        let audio = varying(100);
        let metadata = cursor.metadata(1, 1, 100, true);
        let result = fake(&packet(&metadata, &audio).unwrap(), false)
            .result
            .unwrap();
        for key in ["sessionId", "requestSequence", "generation"] {
            let mut bad = result.clone();
            bad[key] = json!(999);
            let before = cursor.clone();
            assert!(cursor.accept(&metadata, &bad, 100).is_err());
            assert_eq!(cursor, before);
        }
        cursor.accept(&metadata, &result, 100).unwrap();
        let before = cursor.clone();
        assert!(cursor.accept(&metadata, &result, 100).is_err());
        assert_eq!(cursor, before);
    }
    #[test]
    fn response_cannot_rewrite_a_successful_prefix() {
        let audio = varying(HORIZON + 1);
        let output = sequential(&audio, 1, |b| {
            let mut attempt = fake(b, false);
            if let Ok(response) = &mut attempt.result {
                if response["requestSequence"] == 2 {
                    response["canonicalText"] = json!("Rewritten.");
                }
            }
            attempt
        });
        assert_eq!(output["partialText"], "Go.");
        assert_eq!(output["completedThrough"], HORIZON);
        assert!(output["error"].is_string());
    }
    #[test]
    fn repeated_disjoint_responses_are_retained_without_a_harness_join() {
        let mut audio = varying(HORIZON + 100);
        audio[200_000..220_000].fill(0.0);
        let output = sequential(&audio, 1, |b| fake(b, false));
        assert!(output["error"].is_null());
        assert_eq!(
            output["windows"][0]["rightBoundaryMode"],
            "numericalPlateau"
        );
        assert_eq!(output["windows"][1]["leftJoinMode"], "disjoint");
        assert_eq!(output["text"], "Go. Go.");
    }
    #[test]
    fn altered_response_receipt_is_rejected_before_progress_commit() {
        let output = sequential(&varying(100), 1, |bytes| {
            let mut attempt = fake(bytes, false);
            if let Ok(response) = &mut attempt.result {
                response["receipt"]["plateauStart"] = json!(1);
            }
            attempt
        });
        assert_eq!(output["completedThrough"], 0);
        assert!(output["text"].is_null());
        assert_eq!(
            output["requests"][0]["plannedReceipt"]["plateauStart"],
            Value::Null
        );
        assert_eq!(output["windows"][0]["status"], "failed");
    }
}
