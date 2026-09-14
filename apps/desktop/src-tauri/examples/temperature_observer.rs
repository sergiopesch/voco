//! Evidence only: direct initial native full call, original timestamped parameters.
//! Never runs the application controller, recovery, or corroboration.
#[path = "support/temperature_log.rs"]
mod temperature_log;
use std::ffi::{c_char, c_void, CStr};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use temperature_log::Collector;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
const MAX_SAMPLES: u64 = 9_600_000;
const MAX_BYTES: u64 = MAX_SAMPLES * 4;

unsafe extern "C" fn discard_log(_: u32, _: *const c_char, _: *mut c_void) {}
unsafe extern "C" fn collect_log(level: u32, text: *const c_char, user_data: *mut c_void) {
    if level != 1 || text.is_null() || user_data.is_null() {
        return;
    }
    // The guard owns this stable allocation until all synchronous native calls finish.
    let collector = unsafe { &*(user_data as *const Mutex<Collector>) };
    if let Ok(mut collector) = collector.lock() {
        collector.accept(unsafe { CStr::from_ptr(text) }.to_bytes());
    }
}
struct LogGuard {
    collector: Box<Mutex<Collector>>,
}
impl LogGuard {
    fn new() -> Self {
        let mut result = Self {
            collector: Box::new(Mutex::new(Collector::default())),
        };
        unsafe {
            whisper_rs::set_log_callback(
                Some(collect_log),
                (&mut *result.collector as *mut Mutex<Collector>).cast(),
            );
        }
        result
    }
    fn take(&self) -> Result<Collector, String> {
        self.collector
            .lock()
            .map(|mut c| std::mem::take(&mut *c))
            .map_err(|_| "Numeric log collector poisoned".into())
    }
}
impl Drop for LogGuard {
    fn drop(&mut self) {
        unsafe {
            whisper_rs::set_log_callback(Some(discard_log), std::ptr::null_mut());
        }
    }
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
fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8)
}
fn temperature_ladder() -> Vec<f32> {
    let mut result = Vec::new();
    let mut t = 0.0_f32;
    while t <= 1.0_f32 + 1e-6_f32 {
        result.push(t);
        t += 0.2_f32;
    }
    result
}
fn main() -> Result<(), String> {
    let paths: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if paths.is_empty() {
        return Err("Usage: temperature_observer <prepared.f32le> [prepared.f32le ...]".into());
    }
    let model = std::env::var_os("VOCO_MODEL_PATH")
        .map(PathBuf::from)
        .ok_or("VOCO_MODEL_PATH is required for frozen model provenance")?;
    // Installed before model construction; no native text logs reach stderr. Declaration
    // order ensures the context and states are destroyed before callback userdata.
    let logger = LogGuard::new();
    let context = WhisperContext::new_with_params(
        model.to_str().ok_or("Model path is not UTF-8")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| e.to_string())?;
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    let mut failed = false;
    for path in paths {
        let samples = read_prepared_audio(&path)?;
        let mut state = context.create_state().map_err(|e| e.to_string())?;
        let _ = logger.take()?;
        let start = std::time::Instant::now();
        let result = state.full(transcription_params(), &samples);
        let elapsed = start.elapsed().as_secs_f64();
        let logs = logger.take()?;
        let error = result.err().map(|e| e.to_string());
        failed |= error.is_some();
        let evidence = state.selected_window_evidence();
        let evidence_error = evidence.as_ref().err().map(|e| e.to_string());
        let rows = evidence.unwrap_or_default();
        let groups = logs.groups(&rows.iter().map(|r| r.seek).collect::<Vec<_>>());
        let observation_error = if error.is_some() {
            Some("nativeFullError")
        } else if evidence_error.is_some() {
            Some("selectedEvidenceUnavailable")
        } else {
            groups.as_ref().err().copied()
        };
        let mut segments = Vec::new();
        let mut raw_text = String::new();
        if error.is_none() {
            for index in 0..state.full_n_segments().map_err(|e| e.to_string())? {
                let text = state
                    .full_get_segment_text(index)
                    .map_err(|e| e.to_string())?;
                raw_text.push_str(&text);
                segments.push(serde_json::json!({"text":text,"t0":state.full_get_segment_t0(index).map_err(|e|e.to_string())?,"t1":state.full_get_segment_t1(index).map_err(|e|e.to_string())?}));
            }
        }
        let selected:Vec<_>=rows.iter().map(|r|serde_json::json!({"seek":r.seek,"structural":r.structural,"actualEot":r.actual_eot,"entropyRejected":r.entropy_rejected,"nativeFailed":r.native_failed,"completed":r.completed,"avgLogprob":r.avg_logprob,"avgLogprobNonfinite":if r.avg_logprob.is_finite(){None}else if r.avg_logprob.is_nan(){Some("nan")}else if r.avg_logprob.is_sign_negative(){Some("negativeInfinity")}else{Some("positiveInfinity")},"originalNoSpeech":r.original_no_speech,"lexicalNoSpeech":r.lexical_no_speech,"textTokens":r.text_tokens})).collect();
        serde_json::to_writer(&mut output,&serde_json::json!({"schema":1,"file":path.to_str().ok_or("Input path is not UTF-8")?,"samples":samples.len(),"nativeCalls":1,"threads":num_cpus(),"temperatureIncrement":0.2_f32,"temperatureLadderBits":temperature_ladder().iter().map(|t|t.to_bits()).collect::<Vec<_>>(),"rawText":if error.is_none(){Some(raw_text)}else{None},"segments":segments,"error":error,"selectedEvidence":selected,"selectedEvidenceError":evidence_error,"lowConfidence":state.had_low_confidence_decoder_rejection(),"terminalFailure":state.had_terminal_decoder_failure(),"nearEndCompletionOffsetFrames":state.earliest_near_end_completion_offset_frames(),"numericLog":logs,"observationAvailable":observation_error.is_none(),"observationError":observation_error,"seekGroups":groups.ok(),"fullSeconds":elapsed})).map_err(|e|e.to_string())?;
        output
            .write_all(b"\n")
            .and_then(|_| output.flush())
            .map_err(|e| e.to_string())?;
    }
    if failed {
        Err("One or more native full calls failed; see JSONL".into())
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

    #[test]
    fn preserves_float_bits_without_quantization() {
        let values = [
            0.0_f32,
            -0.0,
            f32::from_bits(1),
            0.000012345,
            -0.23456789,
            1.25,
        ];
        let bytes: Vec<_> = values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        let decoded = decode_prepared_bytes(&bytes).unwrap();
        assert_eq!(
            decoded.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
            values.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn rejects_empty_partial_oversize_and_nonfinite() {
        for length in [0, 1, 3, 5, MAX_BYTES + 4] {
            assert!(validate_byte_length(length).is_err());
        }
        assert!(validate_byte_length(MAX_BYTES).is_ok());
        for sample in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(decode_prepared_bytes(&sample.to_le_bytes()).is_err());
        }
        assert!(decode_prepared_bytes(&[0, 0, 0]).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_symlink_directory_fifo_and_oversized_regular_file() {
        use std::os::unix::ffi::OsStrExt;
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        struct Temp(PathBuf);
        impl Drop for Temp {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let path = std::env::temp_dir().join(format!(
            "voco-prepared-reader-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        let temp = Temp(path);
        let regular = temp.0.join("regular");
        std::fs::write(&regular, 0.123456_f32.to_le_bytes()).unwrap();
        assert_eq!(
            read_prepared_audio(&regular).unwrap()[0].to_bits(),
            0.123456_f32.to_bits()
        );
        let link = temp.0.join("link");
        std::os::unix::fs::symlink(&regular, &link).unwrap();
        assert!(read_prepared_audio(&link).is_err());
        assert!(read_prepared_audio(&temp.0).is_err());
        let fifo = temp.0.join("fifo");
        let fifo_c = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) }, 0);
        assert!(read_prepared_audio(&fifo).is_err());
        std::fs::OpenOptions::new()
            .write(true)
            .open(&regular)
            .unwrap()
            .set_len(MAX_BYTES + 4)
            .unwrap();
        assert!(read_prepared_audio(&regular).is_err());
    }
}
