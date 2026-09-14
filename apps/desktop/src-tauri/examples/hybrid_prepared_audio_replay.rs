//! Diagnostic only: frozen hybrid planning over exact already-prepared LEf32 PCM.
#[path = "support/numerical_planner.rs"]
mod numerical_planner;
use numerical_planner::{plan_next, LeftJoin, PlannerState, Receipt, RightBoundary};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use voco_lib::transcribe::{
    default_model_path, CanonicalTranscription, DecodeDecision, WhisperState,
};
const MAX_SAMPLES: u64 = 9_600_000;
const MAX_BYTES: u64 = MAX_SAMPLES * 4;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NumericReceipt {
    sequence: u64,
    input_start: usize,
    input_end: usize,
    previous_decoded_end: usize,
    left_join_mode: &'static str,
    right_boundary_mode: &'static str,
    plateau_start: Option<usize>,
    plateau_end: Option<usize>,
    next_input_start: usize,
}
impl From<&Receipt> for NumericReceipt {
    fn from(r: &Receipt) -> Self {
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
struct WindowResponse {
    #[serde(flatten)]
    receipt: NumericReceipt,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    decode_decisions: Vec<DecodeDecision>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayResponse {
    file: String,
    samples: usize,
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    partial_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    completed_through: usize,
    next_input_start: usize,
    pending_range: Option<(usize, usize)>,
    unattempted_ranges: Vec<(usize, usize)>,
    windows: Vec<WindowResponse>,
}
struct WindowDecode {
    result: Result<CanonicalTranscription, String>,
    decisions: Vec<DecodeDecision>,
}
fn append_disjoint(output: &mut String, next: &str) {
    if next.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push(' ');
    }
    output.push_str(next);
}
fn drive<F>(file: &str, samples: &[f32], mut decode: F) -> ReplayResponse
where
    F: FnMut(&[f32], &str) -> WindowDecode,
{
    let mut state = PlannerState::new();
    let mut accumulated = String::new();
    let mut windows = Vec::new();
    let mut attempted_end = 0;
    let mut error = None;
    if samples.is_empty()
        || samples.len() as u64 > MAX_SAMPLES
        || samples.iter().any(|v| !v.is_finite())
    {
        error = Some("Input must contain 1..9600000 finite prepared samples".into());
    }
    while error.is_none() {
        let receipt = match plan_next(&state, &samples[state.next_input_start()..], true) {
            Ok(Some(receipt)) => receipt,
            Ok(None) => {
                if state.previous_decoded_end() != samples.len() {
                    error = Some("Planner did not cover the complete input".into());
                }
                break;
            }
            Err(e) => {
                error = Some(e.to_string());
                break;
            }
        };
        let prefix = if receipt.left_join() == LeftJoin::LegacyOverlap {
            accumulated.as_str()
        } else {
            ""
        };
        let attempt = decode(&samples[receipt.input_start()..receipt.input_end()], prefix);
        attempted_end = receipt.input_end();
        let outcome = attempt.result.and_then(|result| {
            if result.canonical_text.strip_prefix(prefix) != Some(result.append_text.as_str()) {
                return Err(
                    "Native canonical result did not preserve its exact input prefix and append"
                        .into(),
                );
            }
            if receipt.left_join() != LeftJoin::LegacyOverlap
                && (result.canonical_text != result.chunk_text
                    || result.append_text != result.chunk_text)
            {
                return Err(
                    "Empty-prefix canonical result must preserve its complete chunk text".into(),
                );
            }
            let mut next = accumulated.clone();
            if receipt.left_join() == LeftJoin::LegacyOverlap {
                next = result.canonical_text;
            } else {
                append_disjoint(&mut next, &result.canonical_text);
            }
            if !next.starts_with(&accumulated) {
                return Err("Hybrid join revised its completed prefix".into());
            }
            state.commit(&receipt).map_err(|e| e.to_string())?;
            Ok(next)
        });
        let (status, window_error) = match outcome {
            Ok(next) => {
                accumulated = next;
                ("completed", None)
            }
            Err(e) => {
                error = Some(e.clone());
                ("failed", Some(e))
            }
        };
        windows.push(WindowResponse {
            receipt: NumericReceipt::from(&receipt),
            status,
            error: window_error,
            decode_decisions: attempt.decisions,
        });
        if receipt.right_boundary() == RightBoundary::Final {
            break;
        }
    }
    let failed = error.is_some();
    ReplayResponse {
        file: file.into(),
        samples: samples.len(),
        text: if failed {
            None
        } else {
            Some(accumulated.clone())
        },
        partial_text: if failed { Some(accumulated) } else { None },
        error,
        completed_through: state.previous_decoded_end(),
        next_input_start: state.next_input_start(),
        pending_range: if failed {
            Some((state.next_input_start(), samples.len()))
        } else {
            None
        },
        unattempted_ranges: if failed && attempted_end < samples.len() {
            vec![(attempted_end, samples.len())]
        } else {
            Vec::new()
        },
        windows,
    }
}
fn main() -> Result<(), String> {
    let files: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if files.is_empty() {
        return Err(
            "Usage: hybrid_prepared_audio_replay <prepared.f32le> [prepared.f32le ...]".into(),
        );
    }
    let model = std::env::var_os("VOCO_MODEL_PATH")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_model_path)?;
    let mut whisper = WhisperState::new();
    let mut loaded = false;
    let mut failed = false;
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    for file in files {
        let name = file
            .to_str()
            .ok_or("Input path must be valid UTF-8 for JSON provenance")?;
        let samples = read_prepared_audio(&file)?;
        if !loaded {
            whisper.load_model(&model)?;
            loaded = true;
        }
        let result = drive(name, &samples, |audio, prefix| WindowDecode {
            result: whisper.transcribe_canonical_chunk(audio, prefix),
            decisions: whisper.decode_decisions(),
        });
        failed |= result.error.is_some();
        serde_json::to_writer(&mut output, &result)
            .map_err(|e| format!("Failed to serialize hybrid replay: {e}"))?;
        output
            .write_all(b"\n")
            .and_then(|_| output.flush())
            .map_err(|e| format!("Failed to write hybrid replay: {e}"))?;
    }
    if failed {
        Err(
            "One or more hybrid replays failed; see explicit JSONL errors and partial coverage"
                .into(),
        )
    } else {
        Ok(())
    }
}
fn validate_byte_length(length: u64) -> Result<(), String> {
    if length == 0 || length > MAX_BYTES || !length.is_multiple_of(4) {
        return Err(
            "Prepared audio must contain 1..9600000 complete little-endian f32 samples".into(),
        );
    }
    Ok(())
}

fn read_prepared_audio(path: &Path) -> Result<Vec<f32>, String> {
    #[cfg(not(target_os = "linux"))]
    return Err(format!(
        "This bounded diagnostic reader requires Linux: {}",
        path.display()
    ));
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|error| {
                format!("Failed to open prepared audio {}: {error}", path.display())
            })?;
        let metadata = file
            .metadata()
            .map_err(|error| format!("Failed to inspect prepared audio: {error}"))?;
        if !metadata.is_file() {
            return Err("Prepared audio must be a regular file".into());
        }
        validate_byte_length(metadata.len())?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Failed to read prepared audio: {error}"))?;
        if bytes.len() as u64 != metadata.len() {
            return Err("Prepared audio size changed while reading".into());
        }
        decode_prepared_bytes(&bytes)
    }
}

fn decode_prepared_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    validate_byte_length(bytes.len() as u64)?;
    bytes
        .chunks_exact(4)
        .enumerate()
        .map(|(index, chunk)| {
            let sample = f32::from_le_bytes(chunk.try_into().expect("four-byte chunk"));
            if sample.is_finite() {
                Ok(sample)
            } else {
                Err(format!(
                    "Prepared audio contains a nonfinite sample at index {index}"
                ))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use numerical_planner::HORIZON;
    fn varying(n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| if i % 2 == 0 { -0.01 } else { 0.01 })
            .collect()
    }
    fn success(prefix: &str, chunk: &str) -> WindowDecode {
        let append = if prefix.is_empty() {
            chunk.to_string()
        } else {
            format!(" {chunk}")
        };
        WindowDecode {
            result: Ok(CanonicalTranscription {
                canonical_text: format!("{prefix}{append}"),
                append_text: append,
                chunk_text: chunk.into(),
            }),
            decisions: Vec::new(),
        }
    }
    #[test]
    fn f32_bits_and_length_validation() {
        let values = [0.0f32, -0.0, f32::from_bits(1), 0.1234567, -1.25];
        let bytes: Vec<_> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(
            decode_prepared_bytes(&bytes)
                .unwrap()
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>(),
            values.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
        );
        for n in [0, 1, 3, MAX_BYTES + 4] {
            assert!(validate_byte_length(n).is_err());
        }
        assert!(validate_byte_length(MAX_BYTES).is_ok());
        assert!(decode_prepared_bytes(&f32::NAN.to_le_bytes()).is_err());
    }
    #[test]
    fn preserves_real_repetitions_across_disjoint_ranges() {
        let mut audio = varying(HORIZON);
        audio[400000..406400].fill(0.0);
        let mut prefixes = Vec::new();
        let r = drive("test", &audio, |_, prefix| {
            prefixes.push(prefix.to_string());
            success(prefix, "Go do you hear.")
        });
        assert!(r.error.is_none());
        assert_eq!(prefixes, vec!["", ""]);
        assert_eq!(r.text.as_deref(), Some("Go do you hear. Go do you hear."));
        assert_eq!(r.completed_through, HORIZON);
        assert!(r.unattempted_ranges.is_empty());
    }
    #[test]
    fn mixed_join_modes_pass_the_actual_accumulated_prefix() {
        let mut audio = varying(HORIZON * 3);
        audio[400000..406400].fill(0.0);
        audio[1100160..1106560].fill(0.0);
        let mut prefixes = Vec::new();
        let r = drive("test", &audio, |_, prefix| {
            prefixes.push(prefix.to_string());
            success(prefix, "Again.")
        });
        assert!(r.error.is_none());
        assert_eq!(
            prefixes,
            vec!["", "", "Again. Again.", "Again. Again. Again."]
        );
        assert_eq!(
            r.windows
                .iter()
                .map(|w| w.receipt.left_join_mode)
                .collect::<Vec<_>>(),
            vec!["initial", "disjoint", "legacyOverlap", "legacyOverlap"]
        );
        assert_eq!(r.text.as_deref(), Some("Again. Again. Again. Again."));
    }
    #[test]
    fn legacy_join_uses_native_result_instead_of_appending_raw_chunk() {
        let mut calls = 0;
        let r = drive("test", &varying(HORIZON + 16000), |_, prefix| {
            calls += 1;
            if calls == 1 {
                success(prefix, "One.")
            } else {
                WindowDecode {
                    result: Ok(CanonicalTranscription {
                        canonical_text: prefix.into(),
                        append_text: String::new(),
                        chunk_text: "One. One.".into(),
                    }),
                    decisions: Vec::new(),
                }
            }
        });
        assert_eq!(calls, 2);
        assert_eq!(r.text.as_deref(), Some("One."));
        assert!(r.error.is_none());
    }

    #[test]
    fn failed_window_never_advances_or_attempts_later_audio() {
        let audio = varying(HORIZON * 3);
        let mut calls = 0;
        let r = drive("test", &audio, |_, prefix| {
            calls += 1;
            if calls == 2 {
                WindowDecode {
                    result: Err("failed decode".into()),
                    decisions: Vec::new(),
                }
            } else {
                success(prefix, "First.")
            }
        });
        assert_eq!(calls, 2);
        assert!(r.text.is_none());
        assert_eq!(r.partial_text.as_deref(), Some("First."));
        assert_eq!(r.completed_through, HORIZON);
        assert_eq!(r.next_input_start, HORIZON - 16000);
        assert_eq!(r.pending_range, Some((HORIZON - 16000, audio.len())));
        assert_eq!(
            r.unattempted_ranges,
            vec![(2 * HORIZON - 16000, audio.len())]
        );
        assert_eq!(r.windows[1].status, "failed");
    }
    #[test]
    fn malformed_native_prefix_is_a_failure_without_commit() {
        let audio = varying(HORIZON + 1);
        let mut calls = 0;
        let r = drive("test", &audio, |_, prefix| {
            calls += 1;
            if calls == 1 {
                success(prefix, "Kept.")
            } else {
                success("wrong prefix", "Wrong.")
            }
        });
        assert!(r.error.as_deref().unwrap().contains("prefix"));
        assert_eq!(r.completed_through, HORIZON);
        assert_eq!(r.partial_text.as_deref(), Some("Kept."));
        assert_eq!(r.windows[1].status, "failed");
    }
    #[test]
    fn empty_prefix_cannot_discard_chunk_text_before_initial_or_disjoint_commit() {
        let mut audio = varying(HORIZON);
        audio[400000..406400].fill(0.0);
        for fail_at in [1, 2] {
            let mut calls = 0;
            let r = drive("test", &audio, |_, prefix| {
                calls += 1;
                assert!(prefix.is_empty());
                if calls == fail_at {
                    WindowDecode {
                        result: Ok(CanonicalTranscription {
                            canonical_text: "Kept.".into(),
                            append_text: "Kept.".into(),
                            chunk_text: "Kept. Missing.".into(),
                        }),
                        decisions: Vec::new(),
                    }
                } else {
                    success(prefix, "First.")
                }
            });
            assert_eq!(calls, fail_at);
            assert!(r.text.is_none());
            assert!(r.error.as_deref().unwrap().contains("complete chunk text"));
            assert_eq!(r.completed_through, if fail_at == 1 { 0 } else { 403200 });
            assert_eq!(r.next_input_start, if fail_at == 1 { 0 } else { 403200 });
            assert_eq!(
                r.partial_text.as_deref(),
                Some(if fail_at == 1 { "" } else { "First." })
            );
            assert_eq!(r.windows.last().unwrap().status, "failed");
        }
    }

    #[test]
    fn exact_horizon_does_not_decode_overlap_only_suffix() {
        let mut calls = 0;
        let r = drive("test", &varying(HORIZON), |_, p| {
            calls += 1;
            success(p, "")
        });
        assert_eq!(calls, 1);
        assert_eq!(r.text.as_deref(), Some(""));
        assert!(r.error.is_none());
        assert_eq!(r.completed_through, HORIZON);
        assert_eq!(r.next_input_start, HORIZON - 16000);
    }
    #[test]
    fn nonfinite_input_is_rejected_before_any_decode() {
        let r = drive("test", &[f32::INFINITY], |_, _| panic!("must not decode"));
        assert!(r.text.is_none());
        assert!(r.error.is_some());
        assert!(r.windows.is_empty());
        assert_eq!(r.completed_through, 0);
        assert_eq!(r.unattempted_ranges, vec![(0, 1)]);
    }
}
