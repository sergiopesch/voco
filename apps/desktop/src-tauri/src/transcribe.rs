use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Once;
use std::time::{Duration, Instant};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::config::{APP_DIR_NAME, LEGACY_APP_DIR_NAME};

#[path = "transcribe_corroboration.rs"]
mod corroboration;
#[path = "hybrid.rs"]
pub mod hybrid;
#[path = "numerical_planner.rs"]
pub mod numerical_planner;
#[path = "vca2.rs"]
pub mod vca2;

static INIT_LOG: Once = Once::new();

fn desktop_preview_budget(samples: usize) -> Duration {
    // Allow longer normal decoding as audio grows, while bounding speculative
    // retries. This is a scheduling policy, not a relaxed acceptance threshold.
    Duration::from_millis((500 + samples.min(480_000) as u64 / 400).clamp(600, 1700))
}

struct PreviewDeadlineScope<'a> {
    slot: &'a std::cell::Cell<Option<Instant>>,
    previous: Option<Instant>,
}

impl Drop for PreviewDeadlineScope<'_> {
    fn drop(&mut self) {
        self.slot.set(self.previous);
    }
}

unsafe extern "C" fn preview_deadline_expired(data: *mut std::ffi::c_void) -> bool {
    // SAFETY: installed only with the live, immutable Instant in decode_once_counted.
    !data.is_null() && Instant::now() >= unsafe { *data.cast::<Instant>() }
}
const LONG_TRANSCRIPTION_CHUNK_SECONDS: usize = 30;
const LONG_TRANSCRIPTION_CHUNK_SAMPLES: usize = 16_000 * LONG_TRANSCRIPTION_CHUNK_SECONDS;
const LONG_TRANSCRIPTION_CHUNK_OVERLAP_SAMPLES: usize = 16_000;
pub const CANONICAL_CHUNK_MAX_SAMPLES: usize = LONG_TRANSCRIPTION_CHUNK_SAMPLES;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTranscription {
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalTranscription {
    pub canonical_text: String,
    pub append_text: String,
    pub chunk_text: String,
}

/// No-op callback to suppress whisper.cpp's verbose C-level logging
unsafe extern "C" fn whisper_log_noop(
    _level: std::os::raw::c_uint,
    _text: *const std::ffi::c_char,
    _user_data: *mut std::ffi::c_void,
) {
}

fn suppress_whisper_logging() {
    INIT_LOG.call_once(|| {
        // SAFETY: Setting a no-op log callback to silence whisper.cpp debug output.
        // This is called once before any whisper context is created.
        unsafe {
            whisper_rs::set_log_callback(Some(whisper_log_noop), std::ptr::null_mut());
        }
    });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeDecision {
    input_samples: usize,
    native_low_confidence_rejection: bool,
    native_repetition_rejection_history: bool,
    native_terminal_failure: bool,
    near_end_completion_offset_frames: Option<usize>,
    retry_reason: Option<&'static str>,
    retried: bool,
    retry_ranges: Vec<(usize, usize)>,
    retry_audio_contexts: Vec<i32>,
    // Persist only timing metadata, never transcript text after a caller discards it.
    retry_segment_bounds_ms: Vec<(u64, u64)>,
    retry_native_rejections: usize,
    retry_terminal_failures: usize,
    retry_completed_windows: usize,
    retry_failed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    corroboration: Option<corroboration::Diagnostics>,
}

struct DecodeAttempt {
    output: PreviewTranscription,
    native_low_confidence_rejection: bool,
    native_repetition_rejection_history: bool,
    native_terminal_failure: bool,
    near_end_completion_offset_frames: Option<usize>,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct PreviewDiagnostics {
    pub initial_context_frames: i32,
    pub reduced_attempt_us: u64,
    pub fallback_us: Option<u64>,
}

pub struct WhisperState {
    preview_deadline: std::cell::Cell<Option<Instant>>,
    preview_diagnostics: std::cell::Cell<Option<PreviewDiagnostics>>,
    decisions: std::cell::RefCell<Vec<DecodeDecision>>,
    last_decoder_rejection: std::cell::Cell<bool>,
    ctx: Option<WhisperContext>,
    model_path: Option<PathBuf>,
}

impl Default for WhisperState {
    fn default() -> Self {
        Self::new()
    }
}

impl WhisperState {
    pub fn new() -> Self {
        Self {
            preview_deadline: std::cell::Cell::new(None),
            preview_diagnostics: std::cell::Cell::new(None),
            last_decoder_rejection: std::cell::Cell::new(false),
            decisions: std::cell::RefCell::new(Vec::new()),
            ctx: None,
            model_path: None,
        }
    }

    pub fn preview_diagnostics(&self) -> Option<PreviewDiagnostics> {
        self.preview_diagnostics.get()
    }

    pub fn decode_decisions(&self) -> Vec<DecodeDecision> {
        self.decisions.borrow().clone()
    }

    pub fn had_decoder_rejection(&self) -> bool {
        self.last_decoder_rejection.get()
    }

    pub fn load_model(&mut self, path: &std::path::Path) -> Result<(), String> {
        if self.model_path.as_deref() == Some(path) && self.ctx.is_some() {
            return Ok(());
        }

        suppress_whisper_logging();

        let ctx = WhisperContext::new_with_params(
            path.to_str().ok_or("Invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load whisper model: {e}"))?;

        self.ctx = Some(ctx);
        self.model_path = Some(path.to_path_buf());
        Ok(())
    }

    pub fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        self.last_decoder_rejection.set(false);
        self.decisions.borrow_mut().clear();
        if samples.len() > LONG_TRANSCRIPTION_CHUNK_SAMPLES {
            return self.transcribe_chunked(samples);
        }

        self.transcribe_single(samples)
    }

    pub fn transcribe_preview(&self, samples: &[f32]) -> Result<PreviewTranscription, String> {
        self.last_decoder_rejection.set(false);
        self.decisions.borrow_mut().clear();
        self.transcribe_single_with_segments(samples)
    }

    /// Supersedable desktop work must not spend seconds recovering an old snapshot.
    /// Expiration produces no text; final transcription retains its full policy.
    pub fn transcribe_desktop_preview(
        &self,
        samples: &[f32],
    ) -> Result<Option<PreviewTranscription>, String> {
        self.desktop_preview_with_budget(samples, desktop_preview_budget(samples.len()))
    }

    fn desktop_preview_with_budget(
        &self,
        samples: &[f32],
        budget: Duration,
    ) -> Result<Option<PreviewTranscription>, String> {
        let deadline = Instant::now() + budget;
        let _scope = PreviewDeadlineScope {
            previous: self.preview_deadline.replace(Some(deadline)),
            slot: &self.preview_deadline,
        };
        let result = self.transcribe_preview(samples);
        if Instant::now() >= deadline {
            Ok(None)
        } else {
            result.map(Some)
        }
    }

    pub fn transcribe_canonical_chunk(
        &self,
        samples: &[f32],
        previous_canonical_text: &str,
    ) -> Result<CanonicalTranscription, String> {
        self.last_decoder_rejection.set(false);
        self.decisions.borrow_mut().clear();
        self.transcribe_canonical_chunk_inner(samples, previous_canonical_text)
    }

    fn transcribe_canonical_chunk_inner(
        &self,
        samples: &[f32],
        previous_canonical_text: &str,
    ) -> Result<CanonicalTranscription, String> {
        validate_canonical_chunk_sample_count(samples.len())?;
        let chunk_text = self.transcribe_single(samples)?;
        canonical_transcription_from_chunk(previous_canonical_text, &chunk_text)
    }

    fn hybrid_decode_window(&self, samples: &[f32], prefix: &str) -> hybrid::WindowDecode {
        let first_decision = self.decisions.borrow().len();
        let result = self.transcribe_canonical_chunk_inner(samples, prefix);
        hybrid::WindowDecode {
            result,
            decisions: self.decisions.borrow()[first_decision..].to_vec(),
        }
    }

    /// Full and incremental hybrid routes share the same receipt executor. Reset
    /// request-local evidence once, never between full-session windows.
    pub fn transcribe_hybrid_full(&self, samples: &[f32]) -> hybrid::FullTranscription {
        self.last_decoder_rejection.set(false);
        self.decisions.borrow_mut().clear();
        hybrid::full_using(samples, |audio, prefix| {
            self.hybrid_decode_window(audio, prefix)
        })
    }

    pub fn transcribe_hybrid_request(
        &self,
        request: &vca2::ValidatedRequest,
    ) -> Result<hybrid::IncrementalResult, String> {
        self.last_decoder_rejection.set(false);
        self.decisions.borrow_mut().clear();
        let attempt = hybrid::execute_receipt(
            request.receipt(),
            request.decode_samples(),
            &request.metadata().previous_canonical_text,
            |audio, prefix| self.hybrid_decode_window(audio, prefix),
        );
        let result = attempt.result?;
        let response = vca2::response_after_success(
            request,
            result.chunk_text,
            result.canonical_text,
            result.append_text,
        )?;
        Ok(hybrid::IncrementalResult {
            response,
            decode_decisions: attempt.decisions,
        })
    }

    fn transcribe_chunked(&self, samples: &[f32]) -> Result<String, String> {
        let ranges = transcription_chunk_ranges(
            samples.len(),
            LONG_TRANSCRIPTION_CHUNK_SAMPLES,
            LONG_TRANSCRIPTION_CHUNK_OVERLAP_SAMPLES,
        );
        let mut segments = Vec::with_capacity(ranges.len());

        for range in ranges {
            let text = self.transcribe_single(&samples[range])?;
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                segments.push(trimmed.to_string());
            }
        }

        Ok(join_transcript_segments(&segments))
    }

    fn transcribe_single(&self, samples: &[f32]) -> Result<String, String> {
        let decision_index = self.decisions.borrow().len();
        let baseline = self.decode_with_one_retry(samples)?.text;
        let Some(mut decision) = self.decisions.borrow().get(decision_index).cloned() else {
            return Ok(baseline);
        };
        if !corroboration::healthy_route(samples.len(), &baseline, &decision) {
            return Ok(baseline);
        }
        let (text, diagnostics) = corroboration::run(self, samples, &baseline);
        decision.corroboration = Some(diagnostics);
        self.decisions.borrow_mut()[decision_index] = decision;
        Ok(text)
    }

    fn transcribe_single_with_segments(
        &self,
        samples: &[f32],
    ) -> Result<PreviewTranscription, String> {
        self.decode_preview_using(samples, |audio, context| self.decode_once(audio, context))
    }

    fn decode_preview_using<F>(
        &self,
        samples: &[f32],
        mut decode: F,
    ) -> Result<PreviewTranscription, String>
    where
        F: FnMut(&[f32], DecodeContext) -> Result<DecodeAttempt, String>,
    {
        self.preview_diagnostics.set(None);
        let context_frames = retry_audio_context(samples.len(), DecodeContext::Preview);
        if context_frames == 0 {
            return self.decode_with_one_retry_using(samples, decode);
        }
        let started = std::time::Instant::now();
        let preview = self.decode_with_one_retry_using(samples, |audio, context| {
            let context = match context {
                DecodeContext::Normal => DecodeContext::Preview,
                retry => retry,
            };
            decode(audio, context)
        });
        // An unfinished phrase can fail with less context. Retry once through
        // the original policy before disabling previews; never publish rejected
        // partial text or recursively retry the fallback. Keep both decisions.
        let reduced_attempt_us = started.elapsed().as_micros() as u64;
        let mut fallback_us = None;
        let result = preview.or_else(|_| {
            let started = std::time::Instant::now();
            let result = self.decode_with_one_retry_using(samples, decode);
            fallback_us = Some(started.elapsed().as_micros() as u64);
            result
        });
        self.preview_diagnostics.set(Some(PreviewDiagnostics {
            initial_context_frames: context_frames,
            reduced_attempt_us,
            fallback_us,
        }));
        result
    }

    // All public text/preview paths share this controller; retry calls decode_once
    // directly, so a failure inside a retry window cannot trigger recursion.
    fn decode_with_one_retry(&self, samples: &[f32]) -> Result<PreviewTranscription, String> {
        self.decode_with_one_retry_using(samples, |audio, context| self.decode_once(audio, context))
    }

    fn decode_with_one_retry_using<F>(
        &self,
        samples: &[f32],
        mut decode: F,
    ) -> Result<PreviewTranscription, String>
    where
        F: FnMut(&[f32], DecodeContext) -> Result<DecodeAttempt, String>,
    {
        let first = decode(samples, DecodeContext::Normal)?;
        let mut decision = DecodeDecision {
            input_samples: samples.len(),
            native_low_confidence_rejection: first.native_low_confidence_rejection,
            native_repetition_rejection_history: first.native_repetition_rejection_history,
            native_terminal_failure: first.native_terminal_failure,
            near_end_completion_offset_frames: first.near_end_completion_offset_frames,
            retry_reason: None,
            retried: false,
            retry_ranges: Vec::new(),
            retry_audio_contexts: Vec::new(),
            retry_segment_bounds_ms: Vec::new(),
            retry_native_rejections: 0,
            retry_terminal_failures: 0,
            retry_completed_windows: 0,
            retry_failed: false,
            corroboration: None,
        };
        let (mut ranges, mut reason, mut retry_context) = if first.native_low_confidence_rejection
            || first.native_terminal_failure
            || first.native_repetition_rejection_history
        {
            let ranges =
                decoder_failure_retry_ranges(samples, first.native_repetition_rejection_history);
            if ranges.len() >= 2 && ranges.len() <= CANONICAL_CHUNK_MAX_SAMPLES / 24_000 {
                (
                    ranges,
                    Some(if first.native_low_confidence_rejection {
                        "low-confidence-rejection"
                    } else if first.native_terminal_failure {
                        "terminal-decoder-failure"
                    } else {
                        "repetition-rejection-history"
                    }),
                    DecodeContext::DecoderFailureRetry,
                )
            } else {
                (Vec::new(), None, DecodeContext::Normal)
            }
        } else if let Some(range) =
            single_region_tail_retry(samples, first.near_end_completion_offset_frames)?
        {
            (
                vec![range],
                Some("near-end-single-region"),
                DecodeContext::TailRetry,
            )
        } else {
            (Vec::new(), None, DecodeContext::Normal)
        };
        if reason.is_none() {
            if let Some(mixed_ranges) = mixed_level_retry_ranges(samples)? {
                ranges = mixed_ranges;
                reason = Some("bracketed-mixed-level");
                retry_context = DecodeContext::MixedLevelRetry;
            }
        }
        if reason.is_none() {
            self.decisions.borrow_mut().push(decision);
            // A completed native output can still have rejection history that
            // this policy requires us to recover. Without a safe partition,
            // retain the caller-owned audio rather than publish that unverified
            // output or a native failure, including when the text is empty.
            if first.native_terminal_failure
                || first.native_low_confidence_rejection
                || first.native_repetition_rejection_history
            {
                return Err(
                    "Speech recognition could not be safely accepted and automatic recovery was unavailable. Please retry the recording."
                        .to_string(),
                );
            }
            return Ok(first.output);
        }
        decision.retry_reason = reason;
        decision.retried = true;
        decision.retry_ranges = ranges
            .iter()
            .map(|range| (range.start, range.end))
            .collect();
        let decision_index = self.decisions.borrow().len();
        self.decisions.borrow_mut().push(decision.clone());
        let mut output = PreviewTranscription {
            text: String::new(),
            segments: Vec::new(),
        };
        let mut previous_end_ms = 0;
        for range in ranges {
            decision
                .retry_audio_contexts
                .push(retry_audio_context(range.len(), retry_context));
            let attempt = match decode(&samples[range.clone()], retry_context) {
                Ok(attempt) => attempt,
                Err(error) => {
                    decision.retry_failed = true;
                    self.decisions.borrow_mut()[decision_index] = decision;
                    return Err(error);
                }
            };
            decision.retry_completed_windows += 1;
            decision.retry_terminal_failures += usize::from(attempt.native_terminal_failure);
            decision.retry_native_rejections +=
                usize::from(attempt.native_low_confidence_rejection);
            // A native call can return successfully while its selected decoder
            // still reports failure. Do not publish a partial recovered transcript;
            // the caller retains the original capture through its error path.
            if attempt.native_terminal_failure || attempt.native_low_confidence_rejection {
                decision.retry_failed = true;
                self.decisions.borrow_mut()[decision_index] = decision;
                return Err(
                    "Speech decoder recovery failed: a retry still reported incomplete decoding"
                        .to_string(),
                );
            }
            append_disjoint_text(&mut output.text, &attempt.output.text);
            for mut segment in attempt.output.segments {
                (segment.start_ms, segment.end_ms) = rebase_segment_times(
                    segment.start_ms,
                    segment.end_ms,
                    range.start,
                    range.end,
                    previous_end_ms,
                );
                previous_end_ms = segment.end_ms;
                decision
                    .retry_segment_bounds_ms
                    .push((segment.start_ms, segment.end_ms));
                output.segments.push(segment);
            }
            // Preserve completed-window evidence if a subsequent retry fails.
            self.decisions.borrow_mut()[decision_index] = decision.clone();
        }
        self.decisions.borrow_mut()[decision_index] = decision;
        Ok(output)
    }

    fn decode_once(
        &self,
        samples: &[f32],
        context: DecodeContext,
    ) -> Result<DecodeAttempt, String> {
        self.decode_once_counted(samples, context, None)
    }

    // Optional evidence must not mutate the original request's rejection status.
    fn decode_validation_once(
        &self,
        samples: &[f32],
        context: DecodeContext,
        native_calls: &std::cell::Cell<usize>,
    ) -> Result<DecodeAttempt, String> {
        self.preserve_rejection_using(|| {
            self.decode_once_counted(samples, context, Some(native_calls))
        })
    }

    fn preserve_rejection_using<F>(&self, decode: F) -> Result<DecodeAttempt, String>
    where
        F: FnOnce() -> Result<DecodeAttempt, String>,
    {
        let original_rejection = self.last_decoder_rejection.get();
        let result = decode();
        self.last_decoder_rejection.set(original_rejection);
        result
    }

    fn decode_once_counted(
        &self,
        samples: &[f32],
        context: DecodeContext,
        native_calls: Option<&std::cell::Cell<usize>>,
    ) -> Result<DecodeAttempt, String> {
        let deadline = self.preview_deadline.get();
        if deadline.is_some_and(|end| Instant::now() >= end) {
            return Err("Desktop preview budget expired".into());
        }
        if !has_signal(samples)? {
            return Ok(DecodeAttempt {
                output: PreviewTranscription {
                    text: String::new(),
                    segments: Vec::new(),
                },
                native_low_confidence_rejection: false,
                native_repetition_rejection_history: false,
                native_terminal_failure: false,
                near_end_completion_offset_frames: None,
            });
        }
        let ctx = self.ctx.as_ref().ok_or("Model not loaded")?;
        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create state: {e}"))?;
        let mut params = transcription_params();
        if let Some(ref deadline) = deadline {
            // SAFETY: the pointer refers to this immutable stack-local Instant.
            // full() executes synchronously and joins native computation before
            // returning; the callback never escapes this call or mutates data.
            unsafe {
                params.set_abort_callback(Some(preview_deadline_expired));
                params.set_abort_callback_user_data((deadline as *const Instant).cast_mut().cast());
            }
        }
        let audio_context = retry_audio_context(samples.len(), context);
        if audio_context != 0 {
            params.set_audio_ctx(audio_context);
        }
        if let Some(calls) = native_calls {
            calls.set(calls.get() + 1);
        }
        state
            .full(params, samples)
            .map_err(|e| format!("Transcription failed: {e}"))?;
        let repetition_history = state
            .had_repetition_rejection_history()
            .map_err(|e| format!("Failed to read repetition rejection history: {e}"))?;
        let rejected = state.had_low_confidence_decoder_rejection();
        let native_terminal_failure = state.had_terminal_decoder_failure();
        let near_end_completion_offset_frames = state.earliest_near_end_completion_offset_frames();
        self.last_decoder_rejection
            .set(self.last_decoder_rejection.get() || rejected);
        let count = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {e}"))?;
        let mut text = String::new();
        let mut segments = Vec::with_capacity(count.max(0) as usize);
        for index in 0..count {
            let raw = state
                .full_get_segment_text(index)
                .map_err(|e| format!("Failed to get segment text: {e}"))?;
            // Join native segments before cleanup so punctuation and spacing remain intact.
            text.push_str(&raw);
            let cleaned = clean_transcript_text(&raw);
            if cleaned.is_empty() {
                continue;
            }
            let start_tick = state
                .full_get_segment_t0(index)
                .map_err(|e| format!("Failed to get segment start timestamp: {e}"))?;
            let end_tick = state
                .full_get_segment_t1(index)
                .map_err(|e| format!("Failed to get segment end timestamp: {e}"))?;
            // Preserve native timestamps on ordinary decoding. Rebase and
            // clamp only when assembling explicitly retried windows.
            let start_ms = start_tick.max(0) as u64 * 10;
            let end_ms = (end_tick.max(0) as u64 * 10).max(start_ms);
            segments.push(TranscriptionSegment {
                text: cleaned,
                start_ms,
                end_ms,
            });
        }
        Ok(DecodeAttempt {
            output: PreviewTranscription {
                text: clean_transcript_text(&text),
                segments,
            },
            native_low_confidence_rejection: rejected,
            native_repetition_rejection_history: repetition_history,
            native_terminal_failure,
            near_end_completion_offset_frames,
        })
    }
}

/// Reject digital silence, constant DC, and sub-quantization numerical residue
/// before Whisper can hallucinate text. This is deliberately NOT a speech VAD:
/// quiet speech, transient consonants, noise, and music all pass to the existing
/// decoder. A broader speech gate needs a labeled sensitivity evaluation first.
fn has_signal(samples: &[f32]) -> Result<bool, String> {
    if samples.is_empty() {
        return Err("No audio samples provided".to_string());
    }
    let mut minimum = f32::INFINITY;
    let mut maximum = f32::NEG_INFINITY;
    for &sample in samples {
        if !sample.is_finite() {
            return Err("Audio contains non-finite samples".to_string());
        }
        minimum = minimum.min(sample);
        maximum = maximum.max(sample);
    }
    // About -140 dBFS, far below one PCM16 quantization step. Do not use an
    // average-energy threshold: a brief quiet word in a long pause must pass.
    Ok(maximum - minimum > 0.000_000_1)
}

fn validate_canonical_chunk_sample_count(sample_count: usize) -> Result<(), String> {
    if sample_count == 0 {
        return Err("No canonical chunk audio samples provided".to_string());
    }
    if sample_count > CANONICAL_CHUNK_MAX_SAMPLES {
        return Err("Canonical chunk audio too long (max 30 seconds)".to_string());
    }
    Ok(())
}

fn canonical_transcription_from_chunk(
    previous_canonical_text: &str,
    chunk_text: &str,
) -> Result<CanonicalTranscription, String> {
    let chunk_text = chunk_text.trim().to_string();
    let mut canonical_text = previous_canonical_text.to_string();
    if !chunk_text.is_empty() {
        append_transcript_segment(&mut canonical_text, &chunk_text);
    }

    let append_text = canonical_text
        .strip_prefix(previous_canonical_text)
        .ok_or_else(|| "Canonical transcription did not preserve its prior prefix.".to_string())?
        .to_string();

    Ok(CanonicalTranscription {
        canonical_text,
        append_text,
        chunk_text,
    })
}

fn transcription_params() -> FullParams<'static, 'static> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_print_special(false);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_no_speech_thold(0.6);
    params.set_single_segment(false);
    params.set_n_threads(num_cpus());
    params
}

fn clean_transcript_text(text: &str) -> String {
    // Filter out whisper hallucination artifacts on silence/noise.
    text.trim()
        .replace("[BLANK_AUDIO]", "")
        .replace("[Music]", "")
        .replace("(music)", "")
        .replace("[MUSIC]", "")
        .trim()
        .to_string()
}

fn transcription_chunk_ranges(
    sample_count: usize,
    chunk_samples: usize,
    overlap_samples: usize,
) -> Vec<std::ops::Range<usize>> {
    if sample_count == 0 || chunk_samples == 0 {
        return Vec::new();
    }

    let overlap_samples = overlap_samples.min(chunk_samples.saturating_sub(1));
    let step_samples = chunk_samples - overlap_samples;
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < sample_count {
        let end = (start + chunk_samples).min(sample_count);
        ranges.push(start..end);
        if end == sample_count {
            break;
        }
        start += step_samples;
    }
    ranges
}

fn join_transcript_segments(segments: &[String]) -> String {
    let mut output = String::new();
    for segment in segments {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }

        if output.is_empty() {
            output.push_str(trimmed);
            continue;
        }

        append_transcript_segment(&mut output, trimmed);
    }
    output
}

fn append_transcript_segment(output: &mut String, segment: &str) {
    let overlap_append_start = find_word_overlap_append_start(output, segment);
    let (append_text, removed_boundary) = match overlap_append_start {
        Some(append_start) => trim_redundant_overlap_boundary(output, &segment[append_start..]),
        None => (segment.trim_start(), false),
    };
    if append_text.is_empty() {
        return;
    }

    let (append_text, continues_boundary_token) = if overlap_append_start.is_some() {
        trim_duplicate_attached_boundary_mark(output, append_text)
    } else {
        (append_text, false)
    };
    if append_text.is_empty() {
        return;
    }

    let capitalized_append;
    let append_text = if removed_boundary && output_ends_with_terminal_punctuation(output) {
        capitalized_append = capitalize_first_alphabetic(append_text);
        capitalized_append.as_str()
    } else {
        append_text
    };

    let previous = output.chars().last().unwrap_or(' ');
    let next = append_text.chars().next().unwrap_or(' ');
    if !continues_boundary_token
        && !previous.is_whitespace()
        && !matches!(next, '.' | ',' | '!' | '?' | ';' | ':' | ')')
    {
        output.push(' ');
    }
    output.push_str(append_text);
}

fn trim_duplicate_attached_boundary_mark<'a>(
    output: &str,
    append_text: &'a str,
) -> (&'a str, bool) {
    let Some(mark) = append_text.chars().next() else {
        return (append_text, false);
    };
    if !matches!(mark, '.' | ',') || !output.ends_with(mark) {
        return (append_text, false);
    }

    let remainder = &append_text[mark.len_utf8()..];
    if remainder.chars().next().is_some_and(char::is_alphanumeric) {
        return (remainder, true);
    }

    (append_text, false)
}

fn trim_redundant_overlap_boundary<'a>(output: &str, overlap_suffix: &'a str) -> (&'a str, bool) {
    let trimmed = overlap_suffix.trim_start();
    if !output_ends_with_boundary_punctuation(output) {
        return (trimmed, false);
    }

    let mut punctuation_end = 0;
    for (index, char) in trimmed.char_indices() {
        if is_boundary_mark(char) || is_closing_delimiter(char) {
            punctuation_end = index + char.len_utf8();
        } else {
            break;
        }
    }

    if punctuation_end == 0 {
        return (trimmed, false);
    }

    let remainder = &trimmed[punctuation_end..];
    let punctuation_is_separate = remainder.chars().next().is_none_or(char::is_whitespace);
    if !punctuation_is_separate {
        return (trimmed, false);
    }

    (remainder.trim_start(), true)
}

fn output_ends_with_boundary_punctuation(output: &str) -> bool {
    for char in output.trim_end().chars().rev() {
        if is_boundary_mark(char) {
            return true;
        }
        if !is_closing_delimiter(char) {
            return false;
        }
    }
    false
}

fn output_ends_with_terminal_punctuation(output: &str) -> bool {
    for char in output.trim_end().chars().rev() {
        if matches!(char, '.' | '!' | '?' | '…') {
            return true;
        }
        if !is_closing_delimiter(char) {
            return false;
        }
    }
    false
}

fn capitalize_first_alphabetic(text: &str) -> String {
    for (index, char) in text.char_indices() {
        if !char.is_alphabetic() {
            continue;
        }
        if !char.is_lowercase() {
            return text.to_string();
        }

        let mut capitalized = String::with_capacity(text.len());
        capitalized.push_str(&text[..index]);
        capitalized.extend(char.to_uppercase());
        capitalized.push_str(&text[index + char.len_utf8()..]);
        return capitalized;
    }
    text.to_string()
}

fn is_boundary_mark(char: char) -> bool {
    matches!(char, '.' | ',' | '!' | '?' | ';' | ':' | '…')
}

fn is_closing_delimiter(char: char) -> bool {
    matches!(char, '\'' | '"' | '’' | '”' | ')' | ']' | '}')
}

fn find_word_overlap_append_start(output: &str, segment: &str) -> Option<usize> {
    let output_words = normalized_words(output);
    let segment_words = normalized_words_with_raw_ends(segment);
    let max_overlap = output_words.len().min(segment_words.len()).min(24);
    if max_overlap < 2 {
        return None;
    }

    // Repeated speech can produce several valid textual overlaps. Taking the
    // longest silently deletes new repetitions outside the shared audio window
    // (e.g. six repeated four-word phrases for a one-second audio overlap).
    // With no word-time proof, preserve the most content: choose the shortest
    // matching boundary. This remains a heuristic, not an audio alignment.
    for size in 2..=max_overlap {
        let output_suffix = &output_words[output_words.len() - size..];
        let segment_prefix = segment_words[..size]
            .iter()
            .map(|word| word.normalized.as_str())
            .collect::<Vec<_>>();
        if output_suffix
            .iter()
            .map(String::as_str)
            .eq(segment_prefix.iter().copied())
        {
            return segment_words.get(size - 1).map(|word| word.end);
        }
    }

    None
}

#[derive(Debug, PartialEq, Eq)]
struct NormalizedWord {
    normalized: String,
    end: usize,
}

fn normalized_words(text: &str) -> Vec<String> {
    normalized_words_with_raw_ends(text)
        .into_iter()
        .map(|word| word.normalized)
        .collect()
}

fn normalized_words_with_raw_ends(text: &str) -> Vec<NormalizedWord> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut current_end = 0;

    for (index, char) in text.char_indices() {
        if char.is_alphanumeric() {
            current.extend(char.to_lowercase());
            current_end = index + char.len_utf8();
        } else if !current.is_empty() {
            words.push(NormalizedWord {
                normalized: std::mem::take(&mut current),
                end: current_end,
            });
        }
    }

    if !current.is_empty() {
        words.push(NormalizedWord {
            normalized: current,
            end: current_end,
        });
    }

    words
}

fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8)
}

fn model_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir().ok_or("Cannot find data directory (XDG_DATA_HOME)")?;
    let data_dir = base_dir.join(APP_DIR_NAME).join("models");
    migrate_legacy_models(&base_dir, &data_dir)?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create model dir: {e}"))?;
    Ok(data_dir)
}

fn migrate_legacy_models(
    base_dir: &std::path::Path,
    new_model_dir: &std::path::Path,
) -> Result<(), String> {
    let old_model_dir = base_dir.join(LEGACY_APP_DIR_NAME).join("models");
    if new_model_dir.exists() || !old_model_dir.exists() {
        return Ok(());
    }

    let new_parent = new_model_dir
        .parent()
        .ok_or("Failed to determine model directory parent")?;
    std::fs::create_dir_all(new_parent).map_err(|e| format!("Failed to prepare model dir: {e}"))?;
    std::fs::rename(&old_model_dir, new_model_dir)
        .or_else(|_| copy_model_dir(&old_model_dir, new_model_dir))
        .map_err(|e| format!("Failed to migrate model dir: {e}"))?;
    Ok(())
}

fn copy_model_dir(
    old_model_dir: &std::path::Path,
    new_model_dir: &std::path::Path,
) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(new_model_dir)?;
    for entry in walkdir::WalkDir::new(old_model_dir) {
        let entry = entry.map_err(std::io::Error::other)?;
        let relative = entry.path().strip_prefix(old_model_dir).unwrap();
        let destination = new_model_dir.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&destination)?;
        } else {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(entry.path(), &destination)?;
        }
    }
    Ok(())
}

pub fn default_model_path() -> Result<PathBuf, String> {
    Ok(model_dir()?.join("ggml-base.en.bin"))
}

pub type WhisperMutex = Mutex<WhisperState>;

fn append_disjoint_text(output: &mut String, next: &str) {
    if next.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push(' ');
    }
    output.push_str(next);
}

fn rebase_segment_times(
    start_ms: u64,
    end_ms: u64,
    start_sample: usize,
    end_sample: usize,
    previous_end_ms: u64,
) -> (u64, u64) {
    let window_start = (start_sample as u64).saturating_mul(1000) / 16_000;
    let window_end = (end_sample as u64).saturating_mul(1000) / 16_000;
    let start = window_start
        .saturating_add(start_ms)
        .min(window_end)
        .max(previous_end_ms.min(window_end))
        .max(window_start);
    let end = window_start
        .saturating_add(end_ms)
        .min(window_end)
        .max(start);
    (start, end)
}

// Select quiet-boundary cuts while retaining every source sample in disjoint ranges.
fn utterance_ranges(samples: &[f32]) -> Vec<std::ops::Range<usize>> {
    if samples.is_empty() {
        return Vec::new();
    }
    let power: Vec<f64> = samples
        .chunks(320)
        .map(|frame| {
            frame.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / frame.len() as f64
        })
        .collect();
    let peak = power.iter().copied().fold(0.0_f64, f64::max);
    let mut low = None;
    let mut proposed = Vec::new();
    for (i, value) in power
        .iter()
        .copied()
        .chain(std::iter::once(peak + 1.0))
        .enumerate()
    {
        if value <= peak * 0.01 {
            if low.is_none() {
                low = Some(i);
            }
        } else if let Some(lo) = low.take() {
            if i - lo >= 10 {
                let start = lo * 320;
                let end = (i * 320).min(samples.len());
                if end - start > 16000 {
                    proposed.extend([start + 4000, end - 4000]);
                } else {
                    proposed.push((start + end) / 2);
                }
            }
        }
    }
    proposed.sort_unstable();
    proposed.dedup();
    let mut ranges = Vec::new();
    let mut start = 0;
    for cut in proposed {
        if cut - start >= 24000 && samples.len() - cut >= 24000 {
            ranges.push(start..cut);
            start = cut;
        }
    }
    ranges.push(start..samples.len());
    ranges
}

// A relative-energy dip can lie inside a quiet word. When a rejected decode
// has multiple unambiguous digital pauses, prefer their centers for recovery.
// This does not classify nonzero quiet speech as silence or alter capture PCM.
fn digital_silence_retry_ranges(samples: &[f32]) -> Option<Vec<std::ops::Range<usize>>> {
    const MIN_PAUSE_SAMPLES: usize = 3_200; // Existing 200 ms pause requirement.
    const MIN_RANGE_SAMPLES: usize = 24_000;
    let mut silence_start = None;
    let mut start = 0;
    let mut ranges = Vec::new();
    for (index, sample) in samples
        .iter()
        .copied()
        .chain(std::iter::once(1.0))
        .enumerate()
    {
        if sample == 0.0 {
            silence_start.get_or_insert(index);
        } else if let Some(low) = silence_start.take() {
            // Edge padding is not an interior utterance boundary.
            if low == 0 || index == samples.len() || index - low < MIN_PAUSE_SAMPLES {
                continue;
            }
            let cut = low + (index - low) / 2;
            if cut - start >= MIN_RANGE_SAMPLES && samples.len() - cut >= MIN_RANGE_SAMPLES {
                ranges.push(start..cut);
                start = cut;
            }
        }
    }
    // Count usable boundaries after minimum-size filtering, not raw zero runs.
    if ranges.len() < 2 {
        return None;
    }
    ranges.push(start..samples.len());
    Some(ranges)
}

fn decoder_failure_retry_ranges(
    samples: &[f32],
    repetition_history: bool,
) -> Vec<std::ops::Range<usize>> {
    if repetition_history {
        if let Some(ranges) = digital_silence_retry_ranges(samples) {
            // Recombining repeated utterances can reproduce the native repetition
            // failure. Keep safe pauses separate only within existing work bounds.
            if ranges.len() <= CANONICAL_CHUNK_MAX_SAMPLES / 24_000
                && ranges.iter().all(|range| range.len() <= 8 * 16_000)
            {
                return ranges;
            }
        }
    }
    coalesce_retry_ranges(utterance_ranges(samples))
}

// Bound encoder work by merging adjacent pause partitions up to eight seconds.
// A pre-existing longer range remains whole; no new acoustic cut is introduced.
fn coalesce_retry_ranges(ranges: Vec<std::ops::Range<usize>>) -> Vec<std::ops::Range<usize>> {
    const MAX_GROUP_SAMPLES: usize = 8 * 16_000;
    let mut grouped: Vec<std::ops::Range<usize>> = Vec::new();
    for range in ranges {
        if let Some(last) = grouped.last_mut() {
            if last.end == range.start && range.end - last.start <= MAX_GROUP_SAMPLES {
                last.end = range.end;
                continue;
            }
        }
        grouped.push(range);
    }
    grouped
}

// Borrow one complete original partition only when the native decoder reports
// a near-end completion and residual audio still varies. Never discard or alter
// stored capture samples; this is one bounded retry view, not a new segmentation.
fn single_region_tail_retry(
    samples: &[f32],
    offset_frames: Option<usize>,
) -> Result<Option<std::ops::Range<usize>>, String> {
    let Some(offset) = offset_frames.and_then(|frames| frames.checked_mul(160)) else {
        return Ok(None);
    };
    if offset >= samples.len() || !has_signal(&samples[offset..])? {
        return Ok(None);
    }
    let ranges = utterance_ranges(samples);
    if ranges.len() < 2 {
        return Ok(None);
    }
    let mut selected = None;
    for range in ranges {
        if has_signal(&samples[range.clone()])? {
            if selected.is_some() {
                return Ok(None);
            }
            selected = Some(range);
        }
    }
    Ok(selected)
}

#[derive(Clone, Copy)]
enum DecodeContext {
    Normal,
    Preview,
    DecoderFailureRetry,
    TailRetry,
    MixedLevelRetry,
}
fn retry_audio_context(sample_count: usize, context: DecodeContext) -> i32 {
    if matches!(context, DecodeContext::Preview) && sample_count > 0 {
        // Keep padding beyond the preview window; canonical and recovery passes
        // retain their independently validated context sizes.
        return match sample_count {
            1..=128_000 => 512,
            128_001..=256_000 => 1024,
            256_001..=320_000 => 1280,
            _ => 0,
        };
    }
    if matches!(context, DecodeContext::DecoderFailureRetry)
        && sample_count > 0
        && sample_count <= 128_000
    {
        512
    } else {
        0
    }
}

// Route long, quiet, varying audio bracketed by louder input to disjoint
// windows. This is not a speech/noise classifier: noise can also qualify.
// Measure 20 ms frames from each inspected slice, preserving the tested rule.
fn mixed_level_retry_ranges(
    samples: &[f32],
) -> Result<Option<Vec<std::ops::Range<usize>>>, String> {
    if samples.is_empty() || !has_signal(samples)? {
        return Ok(None);
    }
    fn peak_power(samples: &[f32]) -> f64 {
        samples
            .chunks(320)
            .map(|frame| {
                frame.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / frame.len() as f64
            })
            .fold(0.0, f64::max)
    }
    let threshold = peak_power(samples) * 0.01;
    let ranges = utterance_ranges(samples);
    if ranges.len() < 3 {
        return Ok(None);
    }
    for range in ranges.iter().skip(1).take(ranges.len() - 2) {
        if range.len() >= 128_000
            && has_signal(&samples[range.clone()])?
            && peak_power(&samples[range.clone()]) <= threshold
            && peak_power(&samples[..range.start]) > threshold
            && peak_power(&samples[range.end..]) > threshold
        {
            return Ok(Some(ranges));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_transcription_from_chunk, join_transcript_segments, transcription_chunk_ranges,
        validate_canonical_chunk_sample_count, CANONICAL_CHUNK_MAX_SAMPLES,
    };

    #[test]
    fn silent_capture_never_invokes_decoder_in_any_transcription_mode() {
        // Deliberately no loaded model: these paths must return before inference.
        let whisper = super::WhisperState::new();
        for seconds in [1, 10, 30, 600] {
            assert_eq!(
                whisper.transcribe(&vec![0.0; 16_000 * seconds]).unwrap(),
                ""
            );
        }
        assert!(whisper
            .transcribe_preview(&vec![0.0; 160_000])
            .unwrap()
            .segments
            .is_empty());
        let canonical = whisper
            .transcribe_canonical_chunk(&vec![0.0; 160_000], "Keep this.")
            .unwrap();
        assert_eq!(canonical.canonical_text, "Keep this.");
        assert_eq!(canonical.append_text, "");
        assert_eq!(canonical.chunk_text, "");
    }

    #[test]
    fn signal_gate_preserves_quiet_and_brief_input_without_classifying_speech() {
        assert!(!super::has_signal(&[0.5; 1000]).unwrap());
        assert!(!super::has_signal(&[0.0, 0.000_000_01, -0.000_000_01]).unwrap());
        assert!(super::has_signal(&[-0.000_001, 0.000_001]).unwrap());
        let mut brief = vec![0.0; 480_000];
        brief[240_000] = 0.000_001;
        assert!(super::has_signal(&brief).unwrap());
        assert!(super::has_signal(&[f32::NAN]).is_err());
        assert!(super::has_signal(&[f32::INFINITY]).is_err());
        assert!(super::has_signal(&[]).is_err());
    }

    #[test]
    fn transcription_chunk_ranges_bound_long_recordings() {
        let ranges = transcription_chunk_ranges(16_000 * 600, 16_000 * 30, 16_000);

        assert_eq!(ranges.len(), 21);
        assert_eq!(ranges.first().unwrap(), &(0..480_000));
        assert_eq!(ranges[1], 464_000..944_000);
        assert_eq!(ranges.last().unwrap(), &(9_280_000..9_600_000));
        assert!(ranges.iter().all(|range| range.len() <= 480_000));
    }

    #[test]
    fn transcription_chunk_ranges_include_partial_tail() {
        let ranges = transcription_chunk_ranges(1_001, 500, 100);

        assert_eq!(ranges, vec![0..500, 400..900, 800..1001]);
    }

    #[test]
    fn transcript_segments_join_without_content_rewrites() {
        assert_eq!(
            join_transcript_segments(&[
                "First sentence.".to_string(),
                "Second sentence".to_string(),
                ", with punctuation".to_string(),
            ]),
            "First sentence. Second sentence, with punctuation",
        );
    }

    #[test]
    fn transcript_segments_join_removes_overlapped_chunk_prefix() {
        assert_eq!(
            join_transcript_segments(&[
                "This is a long dictation with overlapping chunk text".to_string(),
                "overlapping chunk text continuing after the boundary".to_string(),
            ]),
            "This is a long dictation with overlapping chunk text continuing after the boundary",
        );
    }

    #[test]
    fn transcript_segments_join_does_not_delete_single_repeated_word() {
        assert_eq!(
            join_transcript_segments(&[
                "The first thought ends here".to_string(),
                "here is a different sentence".to_string(),
            ]),
            "The first thought ends here here is a different sentence",
        );
    }

    #[test]
    fn ambiguous_overlap_does_not_erase_intentional_repeated_phrases() {
        let previous = "Go. Do you hear? ".repeat(12);
        let next = "Do you hear? Go. Do you hear? Go. Do you hear?";
        let result = canonical_transcription_from_chunk(&previous, next).unwrap();
        assert_eq!(result.append_text, "Go. Do you hear? Go. Do you hear?");
        assert_eq!(
            result.canonical_text,
            format!("{previous}Go. Do you hear? Go. Do you hear?")
        );
        assert_eq!(super::normalized_words(&result.canonical_text).len(), 56);
    }

    #[test]
    fn overlap_matching_preserves_non_ascii_word_identity() {
        assert_eq!(
            join_transcript_segments(&[
                "Meet café déjà".to_string(),
                "caf d j arrived".to_string()
            ]),
            "Meet café déjà caf d j arrived"
        );
        assert_eq!(
            join_transcript_segments(&[
                "Meet café déjà".to_string(),
                "Café déjà arrived".to_string()
            ]),
            "Meet café déjà arrived"
        );
    }

    #[test]
    fn canonical_chunk_drops_conflicting_punctuation_after_an_overlap() {
        let previous = "Prior context ends with the first sentence.";
        let result = canonical_transcription_from_chunk(
            previous,
            "First sentence, and the next thought continues.",
        )
        .expect("canonical transcription");

        assert_eq!(
            result.canonical_text,
            "Prior context ends with the first sentence. And the next thought continues."
        );
        assert_eq!(result.append_text, " And the next thought continues.");
        assert!(!result.canonical_text.contains("sentence.,"));
        assert!(result.canonical_text.starts_with(previous));
    }

    #[test]
    fn canonical_chunk_drops_spaced_conflicting_punctuation_after_an_overlap() {
        let previous = "Prior context ends with the first sentence.";
        let result = canonical_transcription_from_chunk(
            previous,
            "First sentence , and the next thought continues.",
        )
        .expect("canonical transcription");

        assert_eq!(
            result.canonical_text,
            "Prior context ends with the first sentence. And the next thought continues."
        );
        assert_eq!(result.append_text, " And the next thought continues.");
        assert!(!result.canonical_text.contains("sentence.,"));
        assert!(result.canonical_text.starts_with(previous));
    }

    #[test]
    fn overlap_boundary_preserves_decimal_continuation_punctuation() {
        assert_eq!(
            super::trim_redundant_overlap_boundary(
                "The measured value was 3.",
                ".14 after calibration.",
            ),
            (".14 after calibration.", false),
        );
    }

    #[test]
    fn overlap_boundary_preserves_thousands_continuation_punctuation() {
        assert_eq!(
            super::trim_redundant_overlap_boundary(
                "The processed count reached 1,",
                ",000 records.",
            ),
            (",000 records.", false),
        );
    }

    #[test]
    fn canonical_chunk_reuses_boundary_period_for_decimal_continuation() {
        let previous = "The measured value was 3.";
        let result = canonical_transcription_from_chunk(
            previous,
            "Measured value was 3.14 after calibration.",
        )
        .expect("canonical transcription");

        assert_eq!(
            result.canonical_text,
            "The measured value was 3.14 after calibration."
        );
        assert_eq!(result.append_text, "14 after calibration.");
        assert!(result.canonical_text.starts_with(previous));
    }

    #[test]
    fn canonical_chunk_reuses_boundary_comma_for_thousands_continuation() {
        let previous = "The processed count reached 1,";
        let result =
            canonical_transcription_from_chunk(previous, "Processed count reached 1,000 records.")
                .expect("canonical transcription");

        assert_eq!(
            result.canonical_text,
            "The processed count reached 1,000 records."
        );
        assert_eq!(result.append_text, "000 records.");
        assert!(result.canonical_text.starts_with(previous));
    }

    #[test]
    fn overlap_boundary_still_drops_standalone_punctuation_and_closers() {
        assert_eq!(
            super::trim_redundant_overlap_boundary(
                "She called it \"the final answer.\"",
                ",\" and moved on.",
            ),
            ("and moved on.", true),
        );
    }

    #[test]
    fn transcript_segments_join_drops_quoted_overlap_punctuation() {
        assert_eq!(
            join_transcript_segments(&[
                "She called it \"the final answer.\"".to_string(),
                "\"The final answer,\" and moved on.".to_string(),
            ]),
            "She called it \"the final answer.\" And moved on.",
        );
    }

    #[test]
    fn overlap_boundary_capitalization_respects_non_terminal_punctuation() {
        assert_eq!(
            join_transcript_segments(&[
                "The list contains apples, bananas,".to_string(),
                "apples, bananas; and pears.".to_string(),
            ]),
            "The list contains apples, bananas, and pears.",
        );
    }

    #[test]
    fn overlap_boundary_capitalization_supports_unicode() {
        assert_eq!(
            join_transcript_segments(&[
                "The repeated boundary ends here.".to_string(),
                "Boundary ends here, élan follows.".to_string(),
            ]),
            "The repeated boundary ends here. Élan follows.",
        );
    }

    #[test]
    fn canonical_chunk_keeps_a_single_repeated_word_with_its_punctuation() {
        let result = canonical_transcription_from_chunk(
            "The first thought ends here.",
            "Here, a new thought begins.",
        )
        .expect("canonical transcription");

        assert_eq!(
            result.canonical_text,
            "The first thought ends here. Here, a new thought begins."
        );
        assert_eq!(result.append_text, " Here, a new thought begins.");
    }

    #[test]
    fn canonical_chunk_preserves_prior_text_and_returns_exact_suffix() {
        let previous = "This is a long dictation with overlapping chunk text";
        let result = canonical_transcription_from_chunk(
            previous,
            " overlapping chunk text continuing after the boundary ",
        )
        .expect("canonical transcription");

        assert_eq!(
            result.chunk_text,
            "overlapping chunk text continuing after the boundary"
        );
        assert_eq!(
            result.canonical_text,
            "This is a long dictation with overlapping chunk text continuing after the boundary"
        );
        assert_eq!(result.append_text, " continuing after the boundary");
        assert!(result.canonical_text.starts_with(previous));
        assert_eq!(
            result.canonical_text.strip_prefix(previous),
            Some(result.append_text.as_str())
        );
    }

    #[test]
    fn empty_canonical_chunk_keeps_the_prior_text_unchanged() {
        let result = canonical_transcription_from_chunk("Already committed.", "   ")
            .expect("empty canonical transcription");

        assert_eq!(result.canonical_text, "Already committed.");
        assert_eq!(result.append_text, "");
        assert_eq!(result.chunk_text, "");
    }

    #[test]
    fn canonical_chunk_audio_is_nonempty_and_bounded_to_thirty_seconds() {
        assert!(validate_canonical_chunk_sample_count(0).is_err());
        assert!(validate_canonical_chunk_sample_count(1).is_ok());
        assert!(validate_canonical_chunk_sample_count(CANONICAL_CHUNK_MAX_SAMPLES).is_ok());
        assert!(validate_canonical_chunk_sample_count(CANONICAL_CHUNK_MAX_SAMPLES + 1).is_err());
    }
}

#[cfg(test)]
mod conditional_retry_tests {
    use super::*;

    #[test]
    fn disjoint_partitions_preserve_every_sample_and_partial_final_frame() {
        for count in [1, 319, 320, 321, 23_999, 24_000, 48_001, 160_321, 480_000] {
            let samples: Vec<f32> = (0..count)
                .map(|i| {
                    if (i / 32_000) % 3 == 1 {
                        0.0
                    } else {
                        ((i % 101) as f32 + 1.0) / 101.0
                    }
                })
                .collect();
            let ranges = utterance_ranges(&samples);
            assert_eq!(ranges.first().unwrap().start, 0);
            assert_eq!(ranges.last().unwrap().end, count);
            assert!(ranges.windows(2).all(|pair| pair[0].end == pair[1].start));
            if ranges.len() > 1 {
                assert!(ranges.iter().all(|range| range.len() >= 24_000));
            }
            let restored: Vec<f32> = ranges
                .iter()
                .flat_map(|range| samples[range.clone()].iter().copied())
                .collect();
            assert_eq!(restored, samples);
        }
        assert!(utterance_ranges(&[]).is_empty());
    }

    #[test]
    fn long_silent_spans_and_short_speech_remain_in_partitioned_audio() {
        let mut samples = vec![0.0; 480_123];
        for (i, sample) in samples[32_000..64_000].iter_mut().enumerate() {
            *sample = if i % 2 == 0 { 0.1 } else { -0.1 };
        }
        samples[448_000..448_321].fill(0.025);
        let ranges = utterance_ranges(&samples);
        let restored: Vec<f32> = ranges
            .iter()
            .flat_map(|range| samples[range.clone()].iter().copied())
            .collect();
        assert_eq!(restored, samples);
        assert!(ranges.iter().all(|range| range.len() >= 24_000));
        assert!(ranges.len() > 1);
        assert_eq!(utterance_ranges(&vec![0.0; 480_123]), vec![0..480_123]);
    }

    #[test]
    fn disjoint_text_keeps_repeated_words_and_exact_spelling() {
        let mut text = String::new();
        for part in ["Go! Go!", "", "Go! Go!", "Don't change C++."] {
            append_disjoint_text(&mut text, part);
        }
        assert_eq!(text, "Go! Go! Go! Go! Don't change C++.");
    }

    #[test]
    fn retry_timestamps_rebase_nonmillisecond_cuts_and_clamp_monotonically() {
        assert_eq!(
            rebase_segment_times(0, 5_000, 24_001, 48_319, 0),
            (1_500, 3_019)
        );
        let first = rebase_segment_times(5, 10, 24_001, 48_319, 0);
        let second = rebase_segment_times(0, 1, 24_001, 48_319, first.1);
        assert_eq!(first, (1_505, 1_510));
        assert_eq!(second, (1_510, 1_510));
        let tail = rebase_segment_times(u64::MAX, u64::MAX, 48_319, 48_321, second.1);
        assert_eq!(tail, (3_020, 3_020));
        assert!(tail.0 >= second.1);
    }

    #[test]
    fn canonical_updates_preserve_committed_prefix_bytes_across_requests() {
        let prefix = "Committed café / cafe\u{301}: 001. ";
        let first = canonical_transcription_from_chunk(prefix, "Go! Go!").unwrap();
        assert_eq!(
            format!("{prefix}{}", first.append_text),
            first.canonical_text
        );
        let second =
            canonical_transcription_from_chunk(&first.canonical_text, "Do you hear?").unwrap();
        assert_eq!(
            format!("{}{}", first.canonical_text, second.append_text),
            second.canonical_text
        );
        assert!(second.canonical_text.starts_with(prefix));
        let empty = canonical_transcription_from_chunk(&second.canonical_text, "").unwrap();
        assert_eq!(empty.canonical_text, second.canonical_text);
        assert!(empty.append_text.is_empty());
    }
}

#[cfg(test)]
mod coalesced_retry_tests {
    use super::*;
    #[test]
    fn greedily_merges_only_existing_boundaries_at_inclusive_cap() {
        assert_eq!(
            coalesce_retry_ranges(vec![
                0..24_000,
                24_000..64_000,
                64_000..128_000,
                128_000..152_001
            ]),
            vec![0..128_000, 128_000..152_001]
        );
        assert_eq!(
            coalesce_retry_ranges(vec![0..64_001, 64_001..128_001]),
            vec![0..64_001, 64_001..128_001]
        );
        assert!(coalesce_retry_ranges(vec![]).is_empty());
    }
    #[test]
    fn original_long_range_is_never_split_or_combined_past_cap() {
        assert_eq!(
            coalesce_retry_ranges(vec![
                0..24_000,
                24_000..184_123,
                184_123..208_123,
                208_123..232_123
            ]),
            vec![0..24_000, 24_000..184_123, 184_123..232_123]
        );
    }
    #[test]
    fn all_samples_minimum_lengths_and_original_cut_positions_survive() {
        for count in [1, 319, 24_000, 48_321, 160_321, 480_123] {
            let samples: Vec<f32> = (0..count)
                .map(|i| {
                    if (i / 32_000) % 3 == 1 {
                        0.0
                    } else {
                        (i % 101) as f32 / 101.0
                    }
                })
                .collect();
            let original = utterance_ranges(&samples);
            let grouped = coalesce_retry_ranges(original.clone());
            let reconstructed: Vec<f32> = grouped
                .iter()
                .flat_map(|r| samples[r.clone()].iter().copied())
                .collect();
            assert_eq!(reconstructed, samples);
            assert!(grouped.windows(2).all(|p| p[0].end == p[1].start));
            for r in &grouped {
                assert!(original.iter().any(|o| o.start == r.start));
                assert!(original.iter().any(|o| o.end == r.end));
                assert!(r.len() <= 128_000 || original.contains(r));
                assert!(grouped.len() == 1 || r.len() >= 24_000);
            }
        }
    }
}

#[cfg(test)]
mod digital_silence_retry_tests {
    use super::*;

    fn voiced(count: usize) -> Vec<f32> {
        (0..count)
            .map(|i| if i % 2 == 0 { 0.1 } else { -0.1 })
            .collect()
    }

    #[test]
    fn interior_digital_pauses_preserve_exact_pcm_and_avoid_quiet_word_cuts() {
        let mut samples = voiced(240_123);
        // These nonzero dips satisfy the old energy threshold, but are not silence.
        for low in [30_000..34_000, 110_000..114_000, 190_000..194_000] {
            for sample in &mut samples[low] {
                *sample *= 0.0001;
            }
        }
        for pause in [70_000..74_000, 150_000..154_000] {
            for (i, sample) in samples[pause].iter_mut().enumerate() {
                *sample = if i % 2 == 0 { 0.0 } else { -0.0 };
            }
        }
        let ranges = digital_silence_retry_ranges(&samples).unwrap();
        assert_eq!(ranges, vec![0..72_000, 72_000..152_000, 152_000..240_123]);
        assert_eq!(decoder_failure_retry_ranges(&samples, true), ranges);
        let restored: Vec<u32> = ranges
            .iter()
            .flat_map(|range| samples[range.clone()].iter().map(|sample| sample.to_bits()))
            .collect();
        assert_eq!(
            restored,
            samples
                .iter()
                .map(|sample| sample.to_bits())
                .collect::<Vec<_>>()
        );
        assert!(ranges
            .iter()
            .all(|range| range.len() >= 24_000 && range.len() <= 128_000));
    }

    #[test]
    fn insufficient_or_nonzero_pause_candidates_keep_the_existing_fallback() {
        let mut cases = vec![vec![], vec![0.0; 160_000], voiced(160_000)];
        let mut quiet = voiced(160_000);
        quiet[40_000..44_000].fill(f32::MIN_POSITIVE);
        quiet[90_000..94_000].fill(-f32::MIN_POSITIVE);
        cases.push(quiet);
        let mut short = voiced(160_000);
        short[40_000..43_199].fill(0.0);
        short[90_000..93_199].fill(0.0);
        cases.push(short);
        let mut edges = voiced(160_000);
        edges[..32_000].fill(0.0);
        edges[128_000..].fill(0.0);
        cases.push(edges);
        let mut only_one_usable = voiced(100_000);
        for range in [4_000..8_000, 40_000..44_000, 88_000..92_000] {
            only_one_usable[range].fill(0.0);
        }
        cases.push(only_one_usable);
        for samples in cases {
            assert!(digital_silence_retry_ranges(&samples).is_none());
            assert_eq!(
                decoder_failure_retry_ranges(&samples, true),
                coalesce_retry_ranges(utterance_ranges(&samples))
            );
        }
    }

    #[test]
    fn only_repetition_history_keeps_safe_pauses_separate_within_inclusive_bounds() {
        let mut samples = voiced(152_000);
        for range in [22_400..25_600, 62_400..65_600, 126_400..129_600] {
            samples[range].fill(0.0);
        }
        assert_eq!(
            digital_silence_retry_ranges(&samples).unwrap(),
            vec![0..24_000, 24_000..64_000, 64_000..128_000, 128_000..152_000]
        );
        assert_eq!(
            decoder_failure_retry_ranges(&samples, true),
            vec![0..24_000, 24_000..64_000, 64_000..128_000, 128_000..152_000]
        );
        assert_eq!(
            decoder_failure_retry_ranges(&samples, false),
            vec![0..128_000, 128_000..152_000]
        );
    }

    #[test]
    fn oversized_or_excessive_separate_ranges_preserve_original_recovery() {
        let mut oversized = voiced(240_000);
        oversized[22_400..25_600].fill(0.0);
        oversized[46_400..49_600].fill(0.0);
        assert!(digital_silence_retry_ranges(&oversized)
            .unwrap()
            .iter()
            .any(|r| r.len() > 128_000));
        let mut excessive = voiced(528_000);
        for cut in (24_000..528_000).step_by(24_000) {
            excessive[cut - 1_600..cut + 1_600].fill(0.0);
        }
        assert!(digital_silence_retry_ranges(&excessive).unwrap().len() > 20);
        for samples in [oversized, excessive] {
            for history in [false, true] {
                assert_eq!(
                    decoder_failure_retry_ranges(&samples, history),
                    coalesce_retry_ranges(utterance_ranges(&samples))
                );
            }
        }
    }

    #[test]
    fn ordinary_terminal_failure_keeps_coalescing_despite_available_digital_pauses() {
        let mut samples = voiced(152_000);
        for range in [22_400..25_600, 62_400..65_600, 126_400..129_600] {
            samples[range].fill(0.0);
        }
        for history in [false, true] {
            let state = WhisperState::new();
            let mut lengths = Vec::new();
            state
                .decode_with_one_retry_using(&samples, |audio, _| {
                    let first = lengths.is_empty();
                    lengths.push(audio.len());
                    Ok(DecodeAttempt {
                        output: PreviewTranscription {
                            text: "Recovered".into(),
                            segments: Vec::new(),
                        },
                        native_low_confidence_rejection: false,
                        native_repetition_rejection_history: history,
                        native_terminal_failure: first,
                        near_end_completion_offset_frames: None,
                    })
                })
                .unwrap();
            assert_eq!(
                lengths,
                if history {
                    vec![152_000, 24_000, 40_000, 64_000, 24_000]
                } else {
                    vec![152_000, 128_000, 24_000]
                }
            );
        }
    }

    #[test]
    fn safe_boundaries_do_not_enable_recovery_on_healthy_decoding() {
        let mut samples = voiced(240_000);
        samples[70_000..74_000].fill(0.0);
        samples[150_000..154_000].fill(0.0);
        assert!(digital_silence_retry_ranges(&samples).is_some());
        let state = WhisperState::new();
        let mut calls = 0;
        let output = state
            .decode_with_one_retry_using(&samples, |_, _| {
                calls += 1;
                Ok(DecodeAttempt {
                    output: PreviewTranscription {
                        text: "Unchanged healthy output".into(),
                        segments: Vec::new(),
                    },
                    native_low_confidence_rejection: false,
                    native_repetition_rejection_history: false,
                    native_terminal_failure: false,
                    near_end_completion_offset_frames: None,
                })
            })
            .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(output.text, "Unchanged healthy output");
        assert!(!state.decode_decisions()[0].retried);
    }

    #[test]
    fn recovery_keeps_context_and_stops_at_the_first_failed_retry() {
        let mut samples = voiced(240_000);
        samples[70_000..74_000].fill(0.0);
        samples[150_000..154_000].fill(0.0);
        for retry_fails in [false, true] {
            let state = WhisperState::new();
            let mut ranges = Vec::new();
            let output = state.decode_with_one_retry_using(&samples, |audio, context| {
                let first = ranges.is_empty();
                ranges.push(audio.len());
                assert_eq!(
                    retry_audio_context(audio.len(), context),
                    if first { 0 } else { 512 }
                );
                Ok(DecodeAttempt {
                    output: PreviewTranscription {
                        text: "Recovered".into(),
                        segments: Vec::new(),
                    },
                    native_low_confidence_rejection: !first && retry_fails,
                    // Repetition history on a retry must not start recursive recovery.
                    native_repetition_rejection_history: true,
                    native_terminal_failure: false,
                    near_end_completion_offset_frames: None,
                })
            });
            if retry_fails {
                assert!(output
                    .unwrap_err()
                    .contains("retry still reported incomplete decoding"));
                assert_eq!(ranges, vec![240_000, 72_000]);
                assert!(state.decode_decisions()[0].retry_failed);
            } else {
                assert_eq!(output.unwrap().text, "Recovered Recovered Recovered");
                assert_eq!(ranges, vec![240_000, 72_000, 80_000, 88_000]);
                assert!(!state.decode_decisions()[0].retry_failed);
            }
        }
    }
}

#[cfg(test)]
mod single_region_tail_tests {
    use super::*;
    fn tail() -> Vec<f32> {
        let mut samples = vec![0.0; 480_123];
        for (i, v) in samples[456_000..].iter_mut().enumerate() {
            *v = if i % 2 == 0 { 0.01 } else { -0.01 };
        }
        samples
    }
    #[test]
    fn requires_verified_in_bounds_offset_and_varying_residual() {
        let samples = tail();
        for offset in [None, Some(usize::MAX), Some(3001)] {
            assert!(single_region_tail_retry(&samples, offset)
                .unwrap()
                .is_none());
        }
        let mut stopped = samples.clone();
        stopped[468_000..].fill(0.0);
        assert!(single_region_tail_retry(&stopped, Some(2925))
            .unwrap()
            .is_none());
    }
    #[test]
    fn preserves_every_nonconstant_tail_sample_and_original_boundaries() {
        let samples = tail();
        let range = single_region_tail_retry(&samples, Some(2928))
            .unwrap()
            .unwrap();
        assert!(utterance_ranges(&samples).contains(&range));
        assert!(range.start <= 456_000 && range.end == samples.len());
        assert!(samples[..range.start].iter().all(|v| *v == 0.0));
        assert!(range.len() >= 24_000);
    }
    #[test]
    fn refuses_multiple_regions_or_unsplit_audio() {
        let mut samples = tail();
        for (i, v) in samples[32_000..64_000].iter_mut().enumerate() {
            *v = if i % 2 == 0 { 0.1 } else { -0.1 };
        }
        assert!(single_region_tail_retry(&samples, Some(2928))
            .unwrap()
            .is_none());
        let constant_activity: Vec<f32> = (0..480_000)
            .map(|i| if i % 2 == 0 { 0.1 } else { -0.1 })
            .collect();
        assert!(single_region_tail_retry(&constant_activity, Some(2928))
            .unwrap()
            .is_none());
    }
}

#[cfg(test)]
mod audio_context_tests {
    use super::*;
    #[test]
    fn preview_context_keeps_padding_without_changing_canonical_or_recovery() {
        for (count, expected) in [
            (0, 0),
            (1, 512),
            (128_000, 512),
            (128_001, 1024),
            (256_000, 1024),
            (256_001, 1280),
            (320_000, 1280),
            (320_001, 0),
            (usize::MAX, 0),
        ] {
            assert_eq!(retry_audio_context(count, DecodeContext::Preview), expected);
            if expected > 0 {
                // Each context unit spans 20 ms at the model's 16 kHz input rate.
                assert!(expected as usize * 320 > count);
            }
            for context in [
                DecodeContext::Normal,
                DecodeContext::TailRetry,
                DecodeContext::MixedLevelRetry,
            ] {
                assert_eq!(retry_audio_context(count, context), 0);
            }
        }
    }
    #[test]
    fn preview_diagnostics_do_not_leak_into_the_next_request() {
        let state = WhisperState::new();
        let samples = vec![0.0; 32_000];
        let mut calls = 0;
        let result = state.decode_preview_using(&samples, |_, _| {
            calls += 1;
            Err("decoder unavailable".into())
        });
        assert!(result.is_err());
        assert_eq!(calls, 2);
        assert!(state.preview_diagnostics().unwrap().fallback_us.is_some());
        let result = state.decode_preview_using(&[], |_, _| Err("invalid input".into()));
        assert!(result.is_err());
        assert!(state.preview_diagnostics().is_none());
    }

    #[test]
    fn rejected_short_preview_uses_original_context_once_and_keeps_failure_evidence() {
        let samples: Vec<f32> = (0..32_000)
            .map(|i| if i % 2 == 0 { 0.01 } else { -0.01 })
            .collect();
        for fallback_fails in [false, true] {
            let state = WhisperState::new();
            let mut contexts = Vec::new();
            let result = state.decode_preview_using(&samples, |_, context| {
                contexts.push(retry_audio_context(samples.len(), context));
                let rejected = contexts.len() == 1 || fallback_fails;
                Ok(DecodeAttempt {
                    output: PreviewTranscription {
                        text: if rejected {
                            "Rejected partial"
                        } else {
                            "Verified preview"
                        }
                        .into(),
                        segments: Vec::new(),
                    },
                    native_low_confidence_rejection: rejected,
                    native_repetition_rejection_history: false,
                    native_terminal_failure: false,
                    near_end_completion_offset_frames: None,
                })
            });
            assert_eq!(contexts, vec![512, 0]);
            let diagnostics = state.preview_diagnostics().unwrap();
            assert_eq!(diagnostics.initial_context_frames, 512);
            assert!(diagnostics.fallback_us.is_some());
            assert_eq!(state.decode_decisions().len(), 2);
            assert!(state.decode_decisions()[0].native_low_confidence_rejection);
            if fallback_fails {
                assert!(result.is_err());
            } else {
                assert_eq!(result.unwrap().text, "Verified preview");
            }
        }
    }

    #[test]
    fn reduced_context_requires_low_confidence_retry_and_at_most_eight_seconds() {
        for count in [1, 16_000, 127_999, 128_000] {
            assert_eq!(
                retry_audio_context(count, DecodeContext::DecoderFailureRetry),
                512
            );
            assert_eq!(retry_audio_context(count, DecodeContext::Normal), 0);
            assert_eq!(retry_audio_context(count, DecodeContext::TailRetry), 0);
        }
        for count in [0, 128_001, 480_000, usize::MAX] {
            for context in [
                DecodeContext::DecoderFailureRetry,
                DecodeContext::Normal,
                DecodeContext::TailRetry,
            ] {
                assert_eq!(retry_audio_context(count, context), 0);
            }
        }
    }
}

#[cfg(test)]
mod terminal_retry_controller_tests {
    use super::*;
    fn audio() -> Vec<f32> {
        (0..480_000)
            .map(|i| {
                if (i / 32_000) % 2 == 0 {
                    if i % 2 == 0 {
                        0.01
                    } else {
                        -0.01
                    }
                } else {
                    0.0
                }
            })
            .collect()
    }
    fn attempt(terminal: bool) -> DecodeAttempt {
        DecodeAttempt {
            output: PreviewTranscription {
                text: "Go!".to_string(),
                segments: vec![TranscriptionSegment {
                    text: "Go!".to_string(),
                    start_ms: 0,
                    end_ms: 99_999,
                }],
            },
            native_low_confidence_rejection: false,
            native_repetition_rejection_history: false,
            native_terminal_failure: terminal,
            near_end_completion_offset_frames: None,
        }
    }
    #[test]
    fn incomplete_decode_without_a_safe_partition_never_publishes_output() {
        let secret = "A private partial transcript.";
        for sample_count in [24_000, 128_000, 480_000] {
            let samples: Vec<f32> = (0..sample_count)
                .map(|i| if i % 2 == 0 { 0.01 } else { -0.01 })
                .collect();
            assert_eq!(coalesce_retry_ranges(utterance_ranges(&samples)).len(), 1);
            for (terminal, rejected) in [(true, false), (false, true), (true, true)] {
                for empty in [false, true] {
                    let state = WhisperState::new();
                    let mut calls = 0;
                    let result = state.decode_with_one_retry_using(&samples, |_, context| {
                        calls += 1;
                        assert_eq!(retry_audio_context(sample_count, context), 0);
                        let mut decoded = attempt(terminal);
                        decoded.native_low_confidence_rejection = rejected;
                        decoded.output.text = if empty { "" } else { secret }.into();
                        decoded.output.segments[0].text = secret.into();
                        if empty {
                            decoded.output.segments.clear();
                        }
                        Ok(decoded)
                    });
                    assert_eq!(calls, 1, "An unavailable retry must stay bounded");
                    let error = result.unwrap_err();
                    assert!(error.contains("automatic recovery was unavailable"));
                    assert!(!error.contains(secret));
                    let decisions = state.decode_decisions();
                    assert_eq!(decisions.len(), 1);
                    assert_eq!(decisions[0].native_terminal_failure, terminal);
                    assert_eq!(decisions[0].native_low_confidence_rejection, rejected);
                    assert!(!decisions[0].retried);
                    assert!(!decisions[0].retry_failed);
                    assert!(decisions[0].retry_ranges.is_empty());
                    assert_eq!(decisions[0].retry_completed_windows, 0);
                    assert!(!serde_json::to_string(&decisions).unwrap().contains(secret));

                    // The next public request clears the failed decision; actual
                    // digital silence stays a successful empty result.
                    assert!(state
                        .transcribe_preview(&vec![0.0; 16_000])
                        .unwrap()
                        .text
                        .is_empty());
                    let next = state.decode_decisions();
                    assert_eq!(next.len(), 1);
                    assert!(!next[0].native_terminal_failure);
                    assert!(!next[0].native_low_confidence_rejection);
                }
            }
        }
    }

    #[test]
    fn unflagged_empty_and_nonempty_decodes_without_partitions_are_unchanged() {
        let samples: Vec<f32> = (0..32_000)
            .map(|i| if i % 2 == 0 { 0.01 } else { -0.01 })
            .collect();
        for empty in [false, true] {
            let state = WhisperState::new();
            let mut calls = 0;
            let output = state
                .decode_with_one_retry_using(&samples, |_, _| {
                    calls += 1;
                    let mut decoded = attempt(false);
                    if empty {
                        decoded.output.text.clear();
                        decoded.output.segments.clear();
                    }
                    Ok(decoded)
                })
                .unwrap();
            assert_eq!(calls, 1);
            assert_eq!(output.text, if empty { "" } else { "Go!" });
            assert_eq!(output.segments.len(), usize::from(!empty));
            assert!(!state.decode_decisions()[0].retried);
        }
    }
    #[test]
    fn healthy_selected_decoder_with_history_uses_one_nonrecursive_recovery_pass() {
        let state = WhisperState::new();
        let samples = audio();
        let ranges = vec![
            0..48_000,
            48_000..112_000,
            112_000..176_000,
            176_000..240_000,
            240_000..304_000,
            304_000..368_000,
            368_000..432_000,
            432_000..480_000,
        ];
        assert_eq!(decoder_failure_retry_ranges(&samples, true), ranges);
        let mut calls = 0;
        let output = state
            .decode_with_one_retry_using(&samples, |_, context| {
                calls += 1;
                assert_eq!(
                    retry_audio_context(24_000, context),
                    if calls == 1 { 0 } else { 512 }
                );
                let mut value = attempt(false);
                // History on retry calls is deliberately not a new recursive trigger or
                // stricter health rule. Existing terminal/low-confidence rules still apply.
                value.native_repetition_rejection_history = true;
                Ok(value)
            })
            .unwrap();
        assert_eq!(calls, 1 + ranges.len());
        assert_eq!(output.text, vec!["Go!"; ranges.len()].join(" "));
        let d = state.decode_decisions();
        assert!(d[0].native_repetition_rejection_history);
        assert!(!d[0].native_low_confidence_rejection);
        assert!(!d[0].native_terminal_failure);
        assert_eq!(d[0].retry_reason, Some("repetition-rejection-history"));
        assert_eq!(d[0].retry_completed_windows, ranges.len());
        assert_eq!(d[0].retry_native_rejections, 0);
        assert!(!corroboration::healthy_route(
            samples.len(),
            &output.text,
            &d[0]
        ));
        state.transcribe_preview(&vec![0.0; 16_000]).unwrap();
        assert!(!state.decode_decisions()[0].native_repetition_rejection_history);
    }
    #[test]
    fn history_without_safe_partition_preserves_failure_for_empty_and_nonempty_output() {
        let samples: Vec<f32> = (0..32_000)
            .map(|i| if i % 2 == 0 { 0.01 } else { -0.01 })
            .collect();
        assert_eq!(coalesce_retry_ranges(utterance_ranges(&samples)).len(), 1);
        for empty in [false, true] {
            let state = WhisperState::new();
            let mut calls = 0;
            let result = state.decode_with_one_retry_using(&samples, |_, _| {
                calls += 1;
                let mut value = attempt(false);
                value.native_repetition_rejection_history = true;
                if empty {
                    value.output.text.clear();
                    value.output.segments.clear();
                }
                Ok(value)
            });
            assert_eq!(calls, 1);
            let error = result.unwrap_err();
            assert!(error.contains("automatic recovery was unavailable"));
            assert!(!error.contains("did not finish"));
            let d = state.decode_decisions();
            assert!(d[0].native_repetition_rejection_history);
            assert!(!d[0].native_low_confidence_rejection);
            assert!(!d[0].retried);
        }
    }
    #[test]
    fn terminal_failure_routes_to_exactly_one_successful_recovery_pass() {
        let state = WhisperState::new();
        let samples = audio();
        let ranges = coalesce_retry_ranges(utterance_ranges(&samples));
        assert!(ranges.len() > 1);
        let mut calls = 0;
        let output = state
            .decode_with_one_retry_using(&samples, |_, context| {
                calls += 1;
                assert_eq!(
                    retry_audio_context(24_000, context),
                    if calls == 1 { 0 } else { 512 }
                );
                Ok(attempt(calls == 1))
            })
            .unwrap();
        assert_eq!(calls, ranges.len() + 1);
        assert_eq!(output.text, vec!["Go!"; ranges.len()].join(" "));
        let d = state.decode_decisions();
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].retry_reason, Some("terminal-decoder-failure"));
        assert_eq!(d[0].retry_terminal_failures, 0);
        assert!(output
            .segments
            .windows(2)
            .all(|p| p[0].end_ms <= p[1].start_ms));
        assert!(output
            .segments
            .iter()
            .all(|s| s.start_ms <= s.end_ms && s.end_ms <= 30_000));
    }
    #[test]
    fn retry_error_propagates_without_partial_output_or_further_decode() {
        let state = WhisperState::new();
        let mut calls = 0;
        let result = state.decode_with_one_retry_using(&audio(), |_, _| {
            calls += 1;
            if calls == 1 {
                Ok(attempt(true))
            } else {
                Err("injected native decode failure".to_string())
            }
        });
        assert_eq!(
            result.err().as_deref(),
            Some("injected native decode failure")
        );
        assert_eq!(calls, 2);
        let d = state.decode_decisions();
        assert!(d[0].retry_failed);
        assert_eq!(d[0].retry_completed_windows, 0);
    }
    #[test]
    fn public_request_clears_prior_terminal_decision_and_failure_state() {
        let state = WhisperState::new();
        let mut calls = 0;
        state
            .decode_with_one_retry_using(&audio(), |_, _| {
                calls += 1;
                Ok(attempt(calls == 1))
            })
            .unwrap();
        assert!(state.decode_decisions()[0].native_terminal_failure);
        let result = state.transcribe_preview(&vec![0.0; 16_000]).unwrap();
        assert!(result.text.is_empty());
        let d = state.decode_decisions();
        assert_eq!(d.len(), 1);
        assert!(!d[0].native_terminal_failure);
        assert!(!d[0].retried);
        assert!(!d[0].retry_failed);
    }
    #[test]
    fn rejected_empty_and_nonempty_retries_fail_without_partial_success() {
        for terminal in [false, true] {
            for empty in [false, true] {
                let state = WhisperState::new();
                let mut calls = 0;
                let result = state.decode_with_one_retry_using(&audio(), |_, _| {
                    calls += 1;
                    if calls == 1 {
                        return Ok(attempt(true));
                    }
                    if calls == 2 {
                        return Ok(attempt(false));
                    }
                    let mut rejected = attempt(terminal);
                    rejected.native_low_confidence_rejection = !terminal;
                    if empty {
                        rejected.output.text.clear();
                        rejected.output.segments.clear();
                    }
                    Ok(rejected)
                });
                assert_eq!(calls, 3);
                assert!(result
                    .err()
                    .unwrap()
                    .contains("retry still reported incomplete decoding"));
                let d = state.decode_decisions();
                assert_eq!(d.len(), 1);
                assert!(d[0].retry_failed);
                assert_eq!(d[0].retry_completed_windows, 2);
                assert_eq!(d[0].retry_terminal_failures, usize::from(terminal));
                assert_eq!(d[0].retry_native_rejections, usize::from(!terminal));
                assert_eq!(d[0].retry_segment_bounds_ms.len(), 1);
                assert!(d[0].retry_segment_bounds_ms[0].0 <= d[0].retry_segment_bounds_ms[0].1);
                state.transcribe_preview(&vec![0.0; 16_000]).unwrap();
                assert!(!state.decode_decisions()[0].retry_failed);
                assert!(state.decode_decisions()[0]
                    .retry_segment_bounds_ms
                    .is_empty());
            }
        }
    }
    #[test]
    fn native_api_error_keeps_its_message_and_prior_window_evidence() {
        let state = WhisperState::new();
        let mut calls = 0;
        let result = state.decode_with_one_retry_using(&audio(), |_, _| {
            calls += 1;
            match calls {
                1 => Ok(attempt(true)),
                2 => Ok(attempt(false)),
                _ => Err("original native API error".to_string()),
            }
        });
        assert_eq!(result.err().as_deref(), Some("original native API error"));
        assert_eq!(calls, 3);
        let d = state.decode_decisions();
        assert!(d[0].retry_failed);
        assert_eq!(d[0].retry_completed_windows, 1);
        assert_eq!(d[0].retry_segment_bounds_ms.len(), 1);
    }

    #[test]
    fn diagnostics_retain_no_transcript_after_success_or_failure() {
        let secret = "Private fixture words that must not remain in diagnostic state.";
        for fail_later in [false, true] {
            let state = WhisperState::new();
            let mut calls = 0;
            let result = state.decode_with_one_retry_using(&audio(), |_, _| {
                calls += 1;
                let mut output = attempt(calls == 1 || (fail_later && calls == 3));
                output.output.text = secret.into();
                output.output.segments[0].text = secret.into();
                Ok(output)
            });
            assert_eq!(result.is_err(), fail_later);
            if let Ok(output) = &result {
                assert!(output.text.contains(secret));
            }
            drop(result);
            let decisions = state.decode_decisions();
            assert!(!decisions[0].retry_segment_bounds_ms.is_empty());
            assert!(!format!("{decisions:?}").contains(secret));
            let encoded = serde_json::to_string(&decisions).unwrap();
            assert!(!encoded.contains(secret));
            assert!(!encoded.contains("retryPreviewSegments"));
        }
    }
}

#[cfg(test)]
mod mixed_level_retry_tests {
    use super::*;
    fn bracketed(middle: usize) -> Vec<f32> {
        (0..middle + 64_000)
            .map(|i| {
                let gain = if i < 32_000 || i >= middle + 32_000 {
                    0.5
                } else {
                    0.001
                };
                if i % 2 == 0 {
                    gain
                } else {
                    -gain
                }
            })
            .collect()
    }
    #[test]
    fn varying_low_energy_is_not_a_vad_and_uses_original_ranges() {
        let a = bracketed(160_000);
        assert_eq!(
            mixed_level_retry_ranges(&a).unwrap(),
            Some(utterance_ranges(&a))
        );
        assert!(mixed_level_retry_ranges(&bracketed(64_000))
            .unwrap()
            .is_none());
        let mut absent = a.clone();
        absent[..32_000].fill(0.0);
        assert!(mixed_level_retry_ranges(&absent).unwrap().is_none());
        let mut absent = a.clone();
        absent[192_000..].fill(0.0);
        assert!(mixed_level_retry_ranges(&absent).unwrap().is_none());
        let mut dc = a.clone();
        dc[32_000..192_000].fill(0.001);
        assert!(mixed_level_retry_ranges(&dc).unwrap().is_none());
        assert!(mixed_level_retry_ranges(&[]).unwrap().is_none());
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut bad = a.clone();
            bad[45_000] = value;
            assert!(mixed_level_retry_ranges(&bad).is_err());
        }
    }
    #[test]
    fn matched_rms_noise_also_qualifies_and_one_loud_frame_vetoes() {
        let mut noise = bracketed(160_000);
        let mut seed = 379810_u64;
        for v in &mut noise[32_000..192_000] {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            *v = ((seed >> 32) as u32 as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32;
        }
        let rms = (noise[32_000..192_000]
            .iter()
            .map(|&v| f64::from(v).powi(2))
            .sum::<f64>()
            / 160_000.0)
            .sqrt();
        for v in &mut noise[32_000..192_000] {
            *v *= (21.894193298037298 / 32767.0 / rms) as f32;
        }
        assert!(mixed_level_retry_ranges(&noise).unwrap().is_some());
        noise[111_680..112_000].fill(0.5);
        assert!(mixed_level_retry_ranges(&noise).unwrap().is_none());
    }
    #[test]
    fn mixed_controller_preserves_every_sample_once_and_full_context() {
        let a = bracketed(160_000);
        let state = WhisperState::new();
        let mut calls = 0;
        let mut replay = Vec::new();
        let result = state
            .decode_with_one_retry_using(&a, |audio, context| {
                assert_eq!(retry_audio_context(audio.len(), context), 0);
                if calls > 0 {
                    replay.extend_from_slice(audio);
                }
                calls += 1;
                Ok(DecodeAttempt {
                    output: PreviewTranscription {
                        text: "word".into(),
                        segments: vec![TranscriptionSegment {
                            text: "word".into(),
                            start_ms: 0,
                            end_ms: 99_999,
                        }],
                    },
                    native_low_confidence_rejection: false,
                    native_repetition_rejection_history: false,
                    native_terminal_failure: false,
                    near_end_completion_offset_frames: None,
                })
            })
            .unwrap();
        assert_eq!(replay, a);
        assert_eq!(calls, utterance_ranges(&a).len() + 1);
        assert!(result
            .segments
            .windows(2)
            .all(|s| s[0].end_ms <= s[1].start_ms));
        assert!(result.segments.iter().all(|s| s.end_ms <= 14_000));
        assert_eq!(
            state.decode_decisions()[0].retry_reason,
            Some("bracketed-mixed-level")
        );
    }
    #[test]
    fn mixed_retry_native_failure_aborts_without_publishing_partial_text() {
        for terminal in [false, true] {
            let state = WhisperState::new();
            let mut calls = 0;
            let result =
                state.decode_with_one_retry_using(&bracketed(160_000), |audio, context| {
                    calls += 1;
                    assert_eq!(retry_audio_context(audio.len(), context), 0);
                    Ok(DecodeAttempt {
                        output: PreviewTranscription {
                            text: "partial".into(),
                            segments: Vec::new(),
                        },
                        native_low_confidence_rejection: calls == 2 && !terminal,
                        native_repetition_rejection_history: false,
                        native_terminal_failure: calls == 2 && terminal,
                        near_end_completion_offset_frames: None,
                    })
                });
            assert!(result.is_err());
            assert_eq!(calls, 2);
            let decisions = state.decode_decisions();
            assert_eq!(decisions[0].retry_reason, Some("bracketed-mixed-level"));
            assert!(decisions[0].retry_failed);
            assert!(decisions[0].retry_segment_bounds_ms.is_empty());
        }
    }
}

#[cfg(test)]
mod hybrid_evidence_tests {
    use super::*;

    #[test]
    fn full_silent_windows_accumulate_ordered_decisions_and_reset_next_request() {
        let state = WhisperState::new();
        let full = state.transcribe_hybrid_full(&vec![0.0; 480_001]);
        assert_eq!(full.text.as_deref(), Some(""));
        assert_eq!(full.windows.len(), 2);
        assert_eq!(
            state
                .decode_decisions()
                .iter()
                .map(|d| d.input_samples)
                .collect::<Vec<_>>(),
            vec![480_000, 16_001]
        );
        for (window, decision) in full.windows.iter().zip(state.decode_decisions()) {
            assert_eq!(window.decode_decisions.len(), 1);
            assert_eq!(
                window.decode_decisions[0].input_samples,
                decision.input_samples
            );
        }
        state.transcribe_hybrid_full(&[0.0]);
        assert_eq!(state.decode_decisions().len(), 1);
        assert_eq!(state.decode_decisions()[0].input_samples, 1);
    }

    #[test]
    fn internal_window_does_not_clear_prior_decisions_or_rejection() {
        let state = WhisperState::new();
        state.hybrid_decode_window(&[0.0], "").result.unwrap();
        state.last_decoder_rejection.set(true);
        let next = state.hybrid_decode_window(&[0.0, 0.0], "Kept.");
        assert_eq!(next.result.unwrap().canonical_text, "Kept.");
        assert_eq!(next.decisions.len(), 1);
        assert_eq!(state.decode_decisions().len(), 2);
        assert!(state.had_decoder_rejection());
    }

    #[test]
    fn full_second_window_error_preserves_first_window_evidence() {
        let state = WhisperState::new();
        let mut samples = vec![0.0; 500_000];
        for (i, v) in samples[480_000..].iter_mut().enumerate() {
            *v = if i % 2 == 0 { 0.1 } else { -0.1 };
        }
        // First silent full horizon succeeds without a model; second needs one.
        let full = state.transcribe_hybrid_full(&samples);
        assert!(full.error.is_some());
        assert_eq!(full.completed_through, 480_000);
        assert_eq!(full.windows.len(), 2);
        assert_eq!(full.windows[0].decode_decisions.len(), 1);
        assert_eq!(full.windows[1].status, "failed");
        assert_eq!(state.decode_decisions().len(), 1);
    }
    #[test]
    fn desktop_preview_budget_scales_but_remains_bounded() {
        for (samples, millis) in [
            (0, 600),
            (32_000, 600),
            (128_000, 820),
            (320_000, 1300),
            (480_000, 1700),
            (usize::MAX, 1700),
        ] {
            assert_eq!(
                desktop_preview_budget(samples),
                Duration::from_millis(millis)
            );
        }
    }

    #[test]
    fn desktop_budget_expires_without_decode_and_is_cleared_before_final_work() {
        let state = WhisperState::new();
        let audio = [0.1, -0.1, 0.1, -0.1];
        assert!(state
            .desktop_preview_with_budget(&audio, Duration::ZERO)
            .unwrap()
            .is_none());
        assert!(state.preview_deadline.get().is_none());
        assert!(state
            .transcribe(&audio)
            .unwrap_err()
            .contains("Model not loaded"));
        assert!(state
            .desktop_preview_with_budget(&audio, Duration::from_secs(2))
            .is_err());
        assert!(state.preview_deadline.get().is_none());
    }

    #[test]
    fn preview_deadline_scope_restores_after_unwind_and_callback_checks_its_own_clock() {
        let slot = std::cell::Cell::new(None);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _scope = PreviewDeadlineScope {
                previous: slot.replace(Some(Instant::now())),
                slot: &slot,
            };
            panic!("test unwind");
        }));
        assert!(result.is_err());
        assert!(slot.get().is_none());
        let past = Instant::now() - Duration::from_millis(1);
        let future = Instant::now() + Duration::from_secs(5);
        unsafe {
            assert!(preview_deadline_expired(
                (&past as *const Instant).cast_mut().cast()
            ));
            assert!(!preview_deadline_expired(
                (&future as *const Instant).cast_mut().cast()
            ));
        }
    }
}
