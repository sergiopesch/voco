//! Diagnostic-only completed-request pacing over the unchanged latched hybrid driver.
#[path = "support/numerical_planner.rs"]
mod numerical_planner;
use numerical_planner::{plan_next, LeftJoin, PlannerState, Receipt, RightBoundary};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use voco_lib::transcribe::{
    default_model_path, CanonicalTranscription, DecodeDecision, WhisperState,
};
const MAX_SAMPLES: u64 = 9_600_000;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewRequest {
    start_sample: usize,
    end_sample: usize,
    #[serde(default)]
    full_session: bool,
    #[serde(default)]
    canonical: bool,
    #[serde(default)]
    previous_canonical_text: String,
}

impl PreviewRequest {
    fn validate(&self, sample_count: usize) -> Result<(), String> {
        if self.start_sample >= self.end_sample || self.end_sample > sample_count {
            return Err("Replay range must be nonempty and entirely inside the WAV".to_string());
        }
        if self.full_session
            && (self.canonical || self.start_sample != 0 || self.end_sample != sample_count)
        {
            return Err(
                "Full-session replay must select the complete WAV without canonical mode"
                    .to_string(),
            );
        }
        if !self.canonical && !self.previous_canonical_text.is_empty() {
            return Err("A canonical prefix requires canonical replay mode".to_string());
        }
        Ok(())
    }
}

const MAX_REQUEST_BYTES: u64 = 1024 * 1024;
// Combined diagnostic corpora can exceed one recording's ten-minute limit.
const MAX_CAPTURE_BYTES: u64 = 512 * 1024 * 1024 + 44;

fn decode_capture_wav(path: &std::path::Path) -> Result<Vec<f32>, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("Failed to read capture WAV {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect capture WAV: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_CAPTURE_BYTES {
        return Err("Capture WAV must be a regular file within the 512 MiB PCM limit".to_string());
    }
    let mut wav = Vec::new();
    file.take(MAX_CAPTURE_BYTES + 1)
        .read_to_end(&mut wav)
        .map_err(|error| format!("Failed to read capture WAV: {error}"))?;
    if wav.len() as u64 > MAX_CAPTURE_BYTES {
        return Err("Capture WAV grew beyond the size limit".to_string());
    }
    decode_capture_wav_bytes(&wav)
}

fn decode_capture_wav_bytes(wav: &[u8]) -> Result<Vec<f32>, String> {
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("Capture is not a RIFF/WAVE file".to_string());
    }
    if &wav[12..16] != b"fmt "
        || &wav[36..40] != b"data"
        || u32::from_le_bytes(wav[16..20].try_into().unwrap()) != 16
    {
        return Err("Capture WAV does not use the expected PCM layout".to_string());
    }
    let audio_format = u16::from_le_bytes([wav[20], wav[21]]);
    let channels = u16::from_le_bytes([wav[22], wav[23]]);
    let sample_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
    let bits_per_sample = u16::from_le_bytes([wav[34], wav[35]]);
    let byte_rate = u32::from_le_bytes(wav[28..32].try_into().unwrap());
    let block_align = u16::from_le_bytes(wav[32..34].try_into().unwrap());
    if audio_format != 1
        || channels != 1
        || sample_rate != 16_000
        || bits_per_sample != 16
        || byte_rate != 32_000
        || block_align != 2
    {
        return Err("Capture WAV must be mono 16 kHz PCM16".to_string());
    }

    let declared_size = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]) as usize;
    let riff_size = u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize;
    if riff_size != wav.len() - 8 || declared_size != wav.len() - 44 {
        return Err("Capture WAV lengths do not match the complete file".to_string());
    }
    if declared_size == 0 || !declared_size.is_multiple_of(2) {
        return Err("Capture WAV must contain complete, nonempty PCM16 samples".to_string());
    }

    Ok(wav[44..]
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / i16::MAX as f32)
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PacedResponse<'a> {
    start_sample: usize,
    end_sample: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    canonical_text: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk_text: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    append_text: Option<&'a str>,
    #[serde(flatten)]
    result: &'a ReplayResponse,
}

fn validate_paced(request: &PreviewRequest, sample_count: usize) -> Result<(), String> {
    request.validate(sample_count)?;
    if !request.canonical
        || request.full_session
        || !request.previous_canonical_text.is_empty()
        || request.end_sample - request.start_sample > numerical_planner::HORIZON
    {
        return Err(
            "Paced hybrid requires an empty-prefix canonical range of 1..480000 samples".into(),
        );
    }
    Ok(())
}

fn serve<F>(
    file: &str,
    samples: &[f32],
    input: &mut impl BufRead,
    output: &mut impl Write,
    mut decode: F,
) -> Result<(), String>
where
    F: FnMut(&[f32], &str) -> WindowDecode,
{
    let mut failed = false;
    loop {
        let mut line = Vec::new();
        let count = Read::by_ref(&mut *input)
            .take(MAX_REQUEST_BYTES + 1)
            .read_until(b'\n', &mut line)
            .map_err(|error| format!("Failed to read replay request: {error}"))?;
        if count == 0 {
            break;
        }
        if count as u64 > MAX_REQUEST_BYTES {
            return Err("Replay request exceeds the 1 MiB limit".to_string());
        }
        if line.last() != Some(&b'\n') {
            return Err("Replay request must end with a complete newline".into());
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let request: PreviewRequest = serde_json::from_slice(&line)
            .map_err(|error| format!("Invalid replay request: {error}"))?;
        validate_paced(&request, samples.len())?;
        let result = drive(
            file,
            &samples[request.start_sample..request.end_sample],
            &mut decode,
        );
        failed |= result.error.is_some();
        let complete_text = result.text.as_deref();
        serde_json::to_writer(
            &mut *output,
            &PacedResponse {
                start_sample: request.start_sample,
                end_sample: request.end_sample,
                canonical_text: complete_text,
                chunk_text: complete_text,
                append_text: complete_text,
                result: &result,
            },
        )
        .map_err(|error| format!("Failed to encode paced response: {error}"))?;
        output
            .write_all(b"\n")
            .and_then(|_| output.flush())
            .map_err(|error| format!("Failed to write paced response: {error}"))?;
    }
    if failed {
        Err("One or more complete requests failed; explicit errors and partial coverage were returned".into())
    } else {
        Ok(())
    }
}

fn main() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let file = PathBuf::from(
        args.next()
            .ok_or("Usage: paced_hybrid_replay <capture.wav>")?,
    );
    if args.next().is_some() {
        return Err("Usage: paced_hybrid_replay <capture.wav>".into());
    }
    let name = file
        .to_str()
        .ok_or("Capture path must be UTF-8 for provenance")?;
    let samples = decode_capture_wav(&file)?;
    let model = std::env::var_os("VOCO_MODEL_PATH")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_model_path)?;
    let mut whisper = WhisperState::new();
    whisper.load_model(&model)?;
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    serve(
        name,
        &samples,
        &mut stdin.lock(),
        &mut std::io::BufWriter::new(stdout.lock()),
        |audio, prefix| WindowDecode {
            result: whisper.transcribe_canonical_chunk(audio, prefix),
            decisions: whisper.decode_decisions(),
        },
    )
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

#[cfg(test)]
mod input_tests {
    use super::*;

    fn wav(samples: &[i16]) -> Vec<u8> {
        let bytes = (samples.len() * 2) as u32;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + bytes).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&16000u32.to_le_bytes());
        out.extend_from_slice(&32000u32.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&bytes.to_le_bytes());
        for sample in samples {
            out.extend_from_slice(&sample.to_le_bytes());
        }
        out
    }

    #[test]
    fn valid_pcm_preserves_every_sample_and_existing_scaling() {
        let samples = [i16::MIN, -231, -1, 0, 1, 999, i16::MAX];
        let decoded = decode_capture_wav_bytes(&wav(&samples)).unwrap();
        assert_eq!(decoded.len(), samples.len());
        for (actual, source) in decoded.iter().zip(samples) {
            assert_eq!(
                actual.to_bits(),
                (source as f32 / i16::MAX as f32).to_bits()
            );
        }
    }

    #[test]
    fn missing_declared_tail_never_becomes_short_success() {
        let source = wav(&[12, 34, 56]);
        for length in 0..source.len() {
            assert!(
                decode_capture_wav_bytes(&source[..length]).is_err(),
                "length {length}"
            );
        }
    }

    #[test]
    fn rejects_inconsistent_riff_data_and_trailing_bytes() {
        for offset in [4usize, 40] {
            for value in [0u32, 1, u32::MAX] {
                let mut bytes = wav(&[1, 2]);
                bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
                assert!(decode_capture_wav_bytes(&bytes).is_err());
            }
        }
        let mut bytes = wav(&[1, 2]);
        bytes.extend_from_slice(&[0, 0]);
        assert!(decode_capture_wav_bytes(&bytes).is_err());
    }

    #[test]
    fn rejects_empty_and_odd_pcm_even_with_consistent_lengths() {
        assert!(decode_capture_wav_bytes(&wav(&[])).is_err());
        let mut bytes = wav(&[1]);
        bytes.pop();
        bytes[4..8].copy_from_slice(&37u32.to_le_bytes());
        bytes[40..44].copy_from_slice(&1u32.to_le_bytes());
        assert!(decode_capture_wav_bytes(&bytes).is_err());
    }

    #[test]
    fn rejects_each_noncanonical_header_field() {
        // Chunk IDs/layout, codec, channels, rate, byte rate, alignment and width.
        for offset in [0usize, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36] {
            let mut bytes = wav(&[5, 6]);
            bytes[offset] ^= 0x40;
            assert!(decode_capture_wav_bytes(&bytes).is_err(), "offset {offset}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn file_reader_accepts_regular_pcm_and_rejects_symlink_fifo_and_sparse_oversize() {
        use std::os::unix::fs::{symlink, DirBuilderExt};
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        struct Directory(std::path::PathBuf);
        impl Drop for Directory {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let root = std::env::temp_dir().join(format!(
            "voco-worker-input-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .unwrap();
        let root = Directory(root);
        let regular = root.0.join("valid.wav");
        std::fs::write(&regular, wav(&[0, 17, -19])).unwrap();
        assert_eq!(
            decode_capture_wav(&regular).unwrap(),
            vec![0.0, 17.0 / 32767.0, -19.0 / 32767.0]
        );
        let link = root.0.join("link.wav");
        symlink(&regular, &link).unwrap();
        assert!(decode_capture_wav(&link).is_err());
        assert!(decode_capture_wav(&root.0).is_err());
        let fifo = root.0.join("fifo.wav");
        let c_path = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
        // Private test directory; no device or model is opened.
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        assert!(decode_capture_wav(&fifo).is_err());
        let huge = root.0.join("sparse.wav");
        std::fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_CAPTURE_BYTES + 1)
            .unwrap();
        assert!(decode_capture_wav(&huge).is_err());
    }
}

#[cfg(test)]
mod paced_tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;
    fn varying(n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| if i % 2 == 0 { -0.01 } else { 0.01 })
            .collect()
    }
    fn request(start: usize, end: usize) -> String {
        format!("{{\"startSample\":{start},\"endSample\":{end},\"canonical\":true,\"previousCanonicalText\":\"\"}}\n")
    }
    fn success(prefix: &str, text: &str) -> WindowDecode {
        let append = if prefix.is_empty() {
            text.into()
        } else {
            format!(" {text}")
        };
        WindowDecode {
            result: Ok(CanonicalTranscription {
                canonical_text: format!("{prefix}{append}"),
                chunk_text: text.into(),
                append_text: append,
            }),
            decisions: Vec::new(),
        }
    }
    #[test]
    fn all_twenty_eight_exact_bound_ranges_are_dispatched() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("support/paced_requests.json")).unwrap();
        let requests = fixture["requests"].as_array().unwrap();
        assert_eq!(requests.len(), 28);
        let end = requests
            .iter()
            .map(|r| r["endSample"].as_u64().unwrap() as usize)
            .max()
            .unwrap();
        let audio = varying(end);
        for value in requests {
            let r: PreviewRequest = serde_json::from_value(value.clone()).unwrap();
            validate_paced(&r, audio.len()).unwrap();
            let mut output = Vec::new();
            let input = request(r.start_sample, r.end_sample);
            let mut calls = 0;
            serve(
                "bound",
                &audio,
                &mut input.as_bytes(),
                &mut output,
                |piece, prefix| {
                    calls += 1;
                    assert!(prefix.is_empty());
                    assert_eq!(piece.len(), r.end_sample - r.start_sample);
                    assert_eq!(piece.as_ptr(), audio[r.start_sample..].as_ptr());
                    success(prefix, "Speech.")
                },
            )
            .unwrap();
            assert_eq!(calls, 1);
            let response: serde_json::Value = serde_json::from_slice(&output).unwrap();
            assert_eq!(response["startSample"], r.start_sample);
            assert_eq!(response["endSample"], r.end_sample);
        }
    }
    struct CountedWriter {
        bytes: Vec<u8>,
        written: Rc<Cell<usize>>,
    }
    impl Write for CountedWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(buf);
            self.written.set(self.bytes.len());
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    #[test]
    fn complete_multiwindow_response_then_fresh_request() {
        let mut audio = varying(numerical_planner::HORIZON);
        audio[400000..406400].fill(0.0);
        let input = request(0, audio.len()) + &request(0, 20000);
        let written = Rc::new(Cell::new(0));
        let mut writer = CountedWriter {
            bytes: Vec::new(),
            written: written.clone(),
        };
        let mut calls = 0;
        serve(
            "test",
            &audio,
            &mut input.as_bytes(),
            &mut writer,
            |_, prefix| {
                calls += 1;
                if calls <= 2 {
                    assert_eq!(written.get(), 0);
                } else {
                    assert!(written.get() > 0);
                }
                assert!(prefix.is_empty());
                success(prefix, "Go.")
            },
        )
        .unwrap();
        assert_eq!(calls, 3);
        let rows: Vec<serde_json::Value> = writer
            .bytes
            .split(|b| *b == b'\n')
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_slice(l).unwrap())
            .collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["canonicalText"], "Go. Go.");
        assert_eq!(rows[0]["windows"].as_array().unwrap().len(), 2);
        assert_eq!(rows[1]["canonicalText"], "Go.");
        assert_eq!(rows[1]["windows"].as_array().unwrap().len(), 1);
        assert_eq!(rows[1]["windows"][0]["sequence"], 0);
        assert!(rows[1]["windows"][0]["decodeDecisions"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    #[test]
    fn late_failure_has_partial_coverage_but_no_success_fields() {
        let mut audio = varying(numerical_planner::HORIZON);
        audio[400000..406400].fill(0.0);
        let input = request(0, audio.len());
        let mut output = Vec::new();
        let mut calls = 0;
        let result = serve(
            "test",
            &audio,
            &mut input.as_bytes(),
            &mut output,
            |_, prefix| {
                calls += 1;
                if calls == 1 {
                    success(prefix, "Kept.")
                } else {
                    WindowDecode {
                        result: Err("failure".into()),
                        decisions: Vec::new(),
                    }
                }
            },
        );
        assert!(result.is_err());
        assert_eq!(calls, 2);
        let row: serde_json::Value = serde_json::from_slice(&output).unwrap();
        assert!(row.get("canonicalText").is_none());
        assert!(row.get("chunkText").is_none());
        assert!(row.get("appendText").is_none());
        assert_eq!(row["partialText"], "Kept.");
        assert_eq!(row["error"], "failure");
        assert!(row["completedThrough"].as_u64().unwrap() < audio.len() as u64);
        assert!(row["pendingRange"].is_array());
    }
    #[test]
    fn invalid_requests_never_decode_or_emit_success() {
        let mut invalid = vec![request(0, 480001), request(2, 2), request(5, 4), request(0, 600001),
            "{\"startSample\":0,\"endSample\":5}\n".into(),
            "{\"startSample\":0,\"endSample\":5,\"canonical\":true,\"previousCanonicalText\":\"old\"}\n".into(),
            "{\"startSample\":0,\"endSample\":5,\"canonical\":true,\"fullSession\":true}\n".into(),
            "{\"startSample\":0,\"endSample\":5,\"canonical\":true,\"unknown\":1}\n".into(),
            "{\"startSample\":0,\"startSample\":1,\"endSample\":5,\"canonical\":true}\n".into(),
            "{\"startSample\":0.5,\"endSample\":5,\"canonical\":true}\n".into(),
            request(0, 5).trim_end().into()];
        invalid.push(" ".repeat(MAX_REQUEST_BYTES as usize + 1));
        let audio = varying(600000);
        for input in invalid {
            let mut output = Vec::new();
            assert!(serve(
                "test",
                &audio,
                &mut input.as_bytes(),
                &mut output,
                |_, _| panic!("Invalid request decoded")
            )
            .is_err());
            assert!(output.is_empty());
        }
    }
    #[test]
    fn empty_stream_and_whitespace_have_no_output() {
        for input in ["", " \n\t\n"] {
            let mut output = Vec::new();
            serve(
                "test",
                &[0.0],
                &mut input.as_bytes(),
                &mut output,
                |_, _| panic!("No request"),
            )
            .unwrap();
            assert!(output.is_empty());
        }
    }
}
