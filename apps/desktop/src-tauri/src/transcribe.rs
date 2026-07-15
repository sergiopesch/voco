use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Once;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::config::{APP_DIR_NAME, LEGACY_APP_DIR_NAME};

static INIT_LOG: Once = Once::new();
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

pub struct WhisperState {
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
            ctx: None,
            model_path: None,
        }
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
        if samples.len() > LONG_TRANSCRIPTION_CHUNK_SAMPLES {
            return self.transcribe_chunked(samples);
        }

        self.transcribe_single(samples)
    }

    pub fn transcribe_preview(&self, samples: &[f32]) -> Result<PreviewTranscription, String> {
        self.transcribe_single_with_segments(samples)
    }

    pub fn transcribe_canonical_chunk(
        &self,
        samples: &[f32],
        previous_canonical_text: &str,
    ) -> Result<CanonicalTranscription, String> {
        validate_canonical_chunk_sample_count(samples.len())?;
        let chunk_text = self.transcribe_single(samples)?;
        canonical_transcription_from_chunk(previous_canonical_text, &chunk_text)
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
        let ctx = self.ctx.as_ref().ok_or("Model not loaded")?;
        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create state: {e}"))?;
        state
            .full(transcription_params(), samples)
            .map_err(|e| format!("Transcription failed: {e}"))?;

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {e}"))?;
        let mut text = String::new();
        for i in 0..num_segments {
            text.push_str(
                &state
                    .full_get_segment_text(i)
                    .map_err(|e| format!("Failed to get segment text: {e}"))?,
            );
        }
        Ok(clean_transcript_text(&text))
    }

    fn transcribe_single_with_segments(
        &self,
        samples: &[f32],
    ) -> Result<PreviewTranscription, String> {
        let ctx = self.ctx.as_ref().ok_or("Model not loaded")?;

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create state: {e}"))?;

        state
            .full(transcription_params(), samples)
            .map_err(|e| format!("Transcription failed: {e}"))?;

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {e}"))?;
        let mut text = String::new();
        let mut segments = Vec::with_capacity(num_segments.max(0) as usize);
        for i in 0..num_segments {
            let segment_text = state
                .full_get_segment_text(i)
                .map_err(|e| format!("Failed to get segment text: {e}"))?;
            text.push_str(&segment_text);

            let cleaned_segment = clean_transcript_text(&segment_text);
            if cleaned_segment.is_empty() {
                continue;
            }

            // whisper.cpp timestamps use 10 ms ticks relative to this audio window.
            let start_ms = state
                .full_get_segment_t0(i)
                .map_err(|e| format!("Failed to get segment start timestamp: {e}"))?
                .max(0) as u64
                * 10;
            let end_ms = state
                .full_get_segment_t1(i)
                .map_err(|e| format!("Failed to get segment end timestamp: {e}"))?
                .max(0) as u64
                * 10;
            segments.push(TranscriptionSegment {
                text: cleaned_segment,
                start_ms,
                end_ms: end_ms.max(start_ms),
            });
        }

        Ok(PreviewTranscription {
            text: clean_transcript_text(&text),
            segments,
        })
    }
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

    for size in (2..=max_overlap).rev() {
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
        if char.is_ascii_alphanumeric() {
            current.push(char.to_ascii_lowercase());
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

#[cfg(test)]
mod tests {
    use super::{
        canonical_transcription_from_chunk, join_transcript_segments, transcription_chunk_ranges,
        validate_canonical_chunk_sample_count, CANONICAL_CHUNK_MAX_SAMPLES,
    };

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
