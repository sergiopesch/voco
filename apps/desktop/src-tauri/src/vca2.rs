//! Strict binary VCA2 transport and owned planning receipts.
use super::numerical_planner::{plan_next, PlannerState, Receipt};
use serde::{Deserialize, Serialize};

const MAX_METADATA_BYTES: usize = 1024 * 1024;
const MAX_SESSION_SAMPLES: u64 = 9_600_000;
const JS_SAFE: u64 = 9_007_199_254_740_991;
const HORIZON: usize = 480_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub protocol_version: u64,
    pub session_id: u64,
    pub request_sequence: u64,
    pub generation: u64,
    pub planner_sequence: u64,
    pub previous_decoded_end: u64,
    pub next_input_start: u64,
    pub planner_finalized: bool,
    pub payload_samples: u64,
    pub finalizing: bool,
    pub previous_canonical_text: String,
}

/// Construction is private: consumers cannot substitute unvalidated metadata,
/// samples, or a receipt after the numerical validation boundary.
pub struct ValidatedRequest {
    metadata: Metadata,
    samples: Vec<f32>,
    state: PlannerState,
    receipt: Receipt,
}
impl ValidatedRequest {
    pub fn metadata(&self) -> &Metadata {
        &self.metadata
    }
    pub fn receipt(&self) -> &Receipt {
        &self.receipt
    }
    pub fn decode_samples(&self) -> &[f32] {
        &self.samples[..self.receipt.input_end() - self.receipt.input_start()]
    }
    pub fn proposed_state_after_success(&self) -> Result<PlannerState, String> {
        let mut state = self.state.clone();
        state.commit(&self.receipt).map_err(|e| e.to_string())?;
        Ok(state)
    }
}

pub fn decode_packet(bytes: &[u8]) -> Result<ValidatedRequest, String> {
    if bytes.len() < 8 || &bytes[..4] != b"VCA2" {
        return Err("Invalid VCA2 header".into());
    }
    let metadata_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if metadata_len > MAX_METADATA_BYTES || metadata_len > bytes.len() - 8 {
        return Err("Invalid metadata size".into());
    }
    let payload = &bytes[8 + metadata_len..];
    if payload.is_empty() || !payload.len().is_multiple_of(4) || payload.len() / 4 > HORIZON {
        return Err("Invalid PCM payload size".into());
    }
    let metadata: Metadata = serde_json::from_slice(&bytes[8..8 + metadata_len])
        .map_err(|_| "Invalid strict VCA2 metadata")?;
    if metadata.protocol_version != 2 {
        return Err("Unsupported metadata version".into());
    }
    if metadata.session_id == 0 || metadata.request_sequence == 0 {
        return Err("Session and request sequence must be positive".into());
    }
    for value in [
        metadata.session_id,
        metadata.request_sequence,
        metadata.generation,
        metadata.planner_sequence,
        metadata.previous_decoded_end,
        metadata.next_input_start,
        metadata.payload_samples,
    ] {
        if value > JS_SAFE {
            return Err("Integer exceeds JavaScript safe range".into());
        }
    }
    if metadata.payload_samples != (payload.len() / 4) as u64 {
        return Err("PCM sample count mismatch".into());
    }
    let end = metadata
        .next_input_start
        .checked_add(metadata.payload_samples)
        .ok_or("Capture index overflow")?;
    if end > MAX_SESSION_SAMPLES || metadata.previous_decoded_end > MAX_SESSION_SAMPLES {
        return Err("Capture exceeds session limit".into());
    }
    if metadata.payload_samples < HORIZON as u64 && !metadata.finalizing {
        return Err("Partial horizon requires finalizing".into());
    }
    if metadata.planner_sequence == 0 && !metadata.previous_canonical_text.is_empty() {
        return Err("Initial planner requires empty canonical prefix".into());
    }
    let state = PlannerState::from_progress(
        metadata.next_input_start as usize,
        metadata.previous_decoded_end as usize,
        metadata.planner_sequence,
        metadata.planner_finalized,
    )
    .map_err(|e| e.to_string())?;
    // The actual planner rejects finalized reuse, including an empty payload.
    let samples = payload
        .chunks_exact(4)
        .map(|b| {
            let value = f32::from_le_bytes(b.try_into().unwrap());
            if value.is_finite() {
                Ok(value)
            } else {
                Err("Non-finite PCM".to_string())
            }
        })
        .collect::<Result<Vec<_>, String>>()?;
    let receipt = plan_next(&state, &samples, metadata.finalizing)
        .map_err(|e| e.to_string())?
        .ok_or("No new audio to decode")?;
    Ok(ValidatedRequest {
        metadata,
        samples,
        state,
        receipt,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumericReceipt {
    pub sequence: u64,
    pub input_start: usize,
    pub input_end: usize,
    pub previous_decoded_end: usize,
    pub left_join_mode: &'static str,
    pub right_boundary_mode: &'static str,
    pub plateau_start: Option<usize>,
    pub plateau_end: Option<usize>,
    pub next_input_start: usize,
}
impl From<&Receipt> for NumericReceipt {
    fn from(r: &Receipt) -> Self {
        use super::numerical_planner::{LeftJoin, RightBoundary};
        Self {
            sequence: r.sequence(),
            input_start: r.input_start(),
            input_end: r.input_end(),
            previous_decoded_end: r.previous_decoded_end(),
            left_join_mode: match r.left_join() {
                LeftJoin::Initial => "initial",
                LeftJoin::Disjoint => "disjoint",
                LeftJoin::LegacyOverlap => "legacyOverlap",
            },
            right_boundary_mode: match r.right_boundary() {
                RightBoundary::NumericalPlateau => "numericalPlateau",
                RightBoundary::LegacyStride => "legacyStride",
                RightBoundary::Final => "final",
            },
            plateau_start: r.plateau().map(|p| p.start),
            plateau_end: r.plateau().map(|p| p.end),
            next_input_start: r.next_input_start(),
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol_version: u64,
    pub session_id: u64,
    pub request_sequence: u64,
    pub generation: u64,
    pub receipt: NumericReceipt,
    pub chunk_text: String,
    pub canonical_text: String,
    pub append_text: String,
}
/// The application supplies actual existing native join outputs. This only
/// binds an owned receipt/identity and verifies exact append-prefix accounting;
/// it cannot prove model text correctness or authorize target delivery.
pub fn response_after_success(
    request: &ValidatedRequest,
    chunk_text: String,
    canonical_text: String,
    append_text: String,
) -> Result<Response, String> {
    let prefix = &request.metadata.previous_canonical_text;
    if !canonical_text.starts_with(prefix) || canonical_text[prefix.len()..] != append_text {
        return Err("Canonical append does not preserve pending prefix".into());
    }
    request.proposed_state_after_success()?;
    Ok(Response {
        protocol_version: 2,
        session_id: request.metadata.session_id,
        request_sequence: request.metadata.request_sequence,
        generation: request.metadata.generation,
        receipt: NumericReceipt::from(&request.receipt),
        chunk_text,
        canonical_text,
        append_text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn metadata() -> serde_json::Value {
        serde_json::json!({"protocolVersion":2,"sessionId":1,"requestSequence":1,"generation":0,
            "plannerSequence":0,"previousDecodedEnd":0,"nextInputStart":0,
            "plannerFinalized":false,"payloadSamples":1,"finalizing":true,
            "previousCanonicalText":""})
    }
    fn packet(m: &serde_json::Value, samples: &[f32]) -> Vec<u8> {
        let json = serde_json::to_vec(m).unwrap();
        let mut bytes = b"VCA2".to_vec();
        bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&json);
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn strict_metadata_and_safe_integer_bounds() {
        for (key, value) in [
            ("protocolVersion", serde_json::json!(1)),
            ("sessionId", serde_json::json!(0)),
            ("requestSequence", serde_json::json!(0)),
            ("generation", serde_json::json!(-1)),
            ("sessionId", serde_json::json!(9007199254740992_u64)),
            ("generation", serde_json::json!(1.5)),
            ("unknown", serde_json::json!(1)),
        ] {
            let mut m = metadata();
            m[key] = value;
            assert!(decode_packet(&packet(&m, &[0.0])).is_err());
        }
        let mut m = metadata();
        m["sessionId"] = serde_json::json!(JS_SAFE);
        m["requestSequence"] = serde_json::json!(JS_SAFE);
        assert!(decode_packet(&packet(&m, &[0.0])).is_ok());
    }
    #[test]
    fn finite_count_and_initial_prefix_validation() {
        let mut m = metadata();
        m["payloadSamples"] = serde_json::json!(1);
        assert!(decode_packet(&packet(&m, &[])).is_err());
        for sample in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(decode_packet(&packet(&m, &[sample])).is_err());
        }
        m["previousCanonicalText"] = serde_json::json!("old");
        assert!(decode_packet(&packet(&m, &[0.0])).is_err());
    }
    #[test]
    fn short_final_and_attempt_sequence_are_separate() {
        let mut m = metadata();
        m["payloadSamples"] = serde_json::json!(1);
        m["requestSequence"] = serde_json::json!(88);
        m["finalizing"] = serde_json::json!(false);
        assert!(decode_packet(&packet(&m, &[0.0])).is_err());
        m["finalizing"] = serde_json::json!(true);
        let request = decode_packet(&packet(&m, &[0.0])).unwrap();
        assert_eq!(request.receipt().sequence(), 0);
        assert_eq!(
            request
                .proposed_state_after_success()
                .unwrap()
                .successful_sequence(),
            1
        );
        assert_eq!(request.metadata().request_sequence, 88);
    }
    #[test]
    fn exact_horizon_and_overlap_only_never_add_tail_decode() {
        let mut m = metadata();
        m["payloadSamples"] = serde_json::json!(HORIZON);
        let samples = vec![0.0; HORIZON];
        let first = decode_packet(&packet(&m, &samples)).unwrap();
        let state = first.proposed_state_after_success().unwrap();
        assert_eq!(state.next_input_start(), 464000);
        assert_eq!(state.previous_decoded_end(), 480000);
        m["plannerSequence"] = serde_json::json!(1);
        m["nextInputStart"] = serde_json::json!(464000);
        m["previousDecodedEnd"] = serde_json::json!(480000);
        m["payloadSamples"] = serde_json::json!(16000);
        assert!(decode_packet(&packet(&m, &samples[..16000])).is_err());
    }
    #[test]
    fn impossible_restoration_and_finalized_reuse_rejected() {
        let mut m = metadata();
        m["plannerSequence"] = serde_json::json!(2);
        m["nextInputStart"] = serde_json::json!(920000);
        m["previousDecodedEnd"] = serde_json::json!(920000);
        assert!(decode_packet(&packet(&m, &[0.0])).is_err());
        m["plannerSequence"] = serde_json::json!(1);
        m["nextInputStart"] = serde_json::json!(1);
        m["previousDecodedEnd"] = serde_json::json!(1);
        m["plannerFinalized"] = serde_json::json!(true);
        assert!(decode_packet(&packet(&m, &[0.0])).is_err());
    }
    #[test]
    fn framing_unknown_duplicate_and_integer_encoding_are_strict() {
        let mut bytes = packet(&metadata(), &[0.0]);
        bytes[0] = b'X';
        assert!(decode_packet(&bytes).is_err());
        let mut bytes = packet(&metadata(), &[0.0]);
        bytes.push(0);
        assert!(decode_packet(&bytes).is_err());
        let mut bytes = b"VCA2".to_vec();
        bytes.extend_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode_packet(&bytes).is_err());
        let json = serde_json::to_string(&metadata()).unwrap();
        let duplicate = json.replacen('{', "{\"protocolVersion\":2,", 1);
        let decimal = json.replace("\"generation\":0", "\"generation\":0.0");
        for text in [duplicate, decimal] {
            let mut bytes = b"VCA2".to_vec();
            bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
            bytes.extend_from_slice(text.as_bytes());
            bytes.extend_from_slice(&0.0_f32.to_le_bytes());
            assert!(decode_packet(&bytes).is_err());
        }
    }
    #[test]
    fn response_identity_and_receipt_are_owned_not_caller_fabricated() {
        let request = decode_packet(&packet(&metadata(), &[0.0])).unwrap();
        let response =
            response_after_success(&request, "Hi.".into(), "Hi.".into(), "Hi.".into()).unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 8);
        assert_eq!(value["protocolVersion"], 2);
        assert_eq!(value["receipt"]["sequence"], 0);
        assert_eq!(value["receipt"]["inputEnd"], 1);
        assert_eq!(value["receipt"]["rightBoundaryMode"], "final");
        assert_eq!(value["receipt"].as_object().unwrap().len(), 9);
        assert!(
            response_after_success(&request, "Hi.".into(), "Hi.".into(), "Wrong".into()).is_err()
        );
    }

    #[test]
    fn exact_horizon_safe_cut_uses_planner_even_when_finalizing() {
        let mut m = metadata();
        m["payloadSamples"] = serde_json::json!(HORIZON);
        let mut samples: Vec<f32> = (0..HORIZON)
            .map(|i| if i % 2 == 0 { 0.1 } else { -0.1 })
            .collect();
        samples[400000..406400].fill(0.0);
        let request = decode_packet(&packet(&m, &samples)).unwrap();
        assert_eq!(request.receipt().input_end(), 403200);
        assert_eq!(request.decode_samples().len(), 403200);
        assert!(!request
            .proposed_state_after_success()
            .unwrap()
            .is_finalized());
    }
    #[test]
    fn payload_metadata_and_absolute_capture_bounds() {
        let mut m = metadata();
        m["payloadSamples"] = serde_json::json!(HORIZON + 1);
        assert!(decode_packet(&packet(&m, &vec![0.0; HORIZON + 1])).is_err());
        m = metadata();
        m["previousCanonicalText"] = serde_json::json!("x".repeat(MAX_METADATA_BYTES));
        assert!(decode_packet(&packet(&m, &[0.0])).is_err());
        m = metadata();
        m["nextInputStart"] = serde_json::json!(MAX_SESSION_SAMPLES);
        m["previousDecodedEnd"] = serde_json::json!(MAX_SESSION_SAMPLES);
        assert!(decode_packet(&packet(&m, &[0.0])).is_err());
    }
}
