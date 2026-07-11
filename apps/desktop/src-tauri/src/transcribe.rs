use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Once;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::config::{APP_DIR_NAME, LEGACY_APP_DIR_NAME};

static INIT_LOG: Once = Once::new();
const LONG_TRANSCRIPTION_CHUNK_SECONDS: usize = 30;
const LONG_TRANSCRIPTION_CHUNK_SAMPLES: usize = 16_000 * LONG_TRANSCRIPTION_CHUNK_SECONDS;
const LONG_TRANSCRIPTION_CHUNK_OVERLAP_SAMPLES: usize = 16_000;

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

        state
            .full(params, samples)
            .map_err(|e| format!("Transcription failed: {e}"))?;

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {e}"))?;
        let mut text = String::new();
        for i in 0..num_segments {
            if let Ok(segment) = state.full_get_segment_text(i) {
                text.push_str(&segment);
            }
        }

        let trimmed = text.trim();

        // Filter out whisper hallucination artifacts on silence/noise
        let cleaned = trimmed
            .replace("[BLANK_AUDIO]", "")
            .replace("[Music]", "")
            .replace("(music)", "")
            .replace("[MUSIC]", "");
        let cleaned = cleaned.trim();

        Ok(cleaned.to_string())
    }
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
    let append_start = find_word_overlap_append_start(output, segment).unwrap_or(0);
    let append_text = segment[append_start..].trim_start();
    if append_text.is_empty() {
        return;
    }

    let previous = output.chars().last().unwrap_or(' ');
    let next = append_text.chars().next().unwrap_or(' ');
    if !previous.is_whitespace() && !matches!(next, '.' | ',' | '!' | '?' | ';' | ':' | ')') {
        output.push(' ');
    }
    output.push_str(append_text);
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
    use super::{join_transcript_segments, transcription_chunk_ranges};

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
}
