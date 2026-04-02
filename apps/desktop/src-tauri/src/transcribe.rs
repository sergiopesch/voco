use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Once;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::config::{APP_DIR_NAME, LEGACY_APP_DIR_NAME};

static INIT_LOG: Once = Once::new();

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
