//! Evidence only: fixed same-state full-call reset sequence; no application routing.
use std::ffi::{c_char, c_void};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
const MAX_SAMPLES: u64 = 9_600_000;
const MAX_BYTES: u64 = MAX_SAMPLES * 4;
unsafe extern "C" fn discard_log(_: u32, _: *const c_char, _: *mut c_void) {}
fn main() -> Result<(), String> {
    let paths: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if paths.len() != 2 {
        return Err(
            "Usage: repetition_history_reset <known-history.f32> <complete-clean.f32>".into(),
        );
    }
    let history = read_prepared_audio(&paths[0])?;
    let clean = read_prepared_audio(&paths[1])?;
    let model = std::env::var_os("VOCO_MODEL_PATH")
        .map(PathBuf::from)
        .ok_or("VOCO_MODEL_PATH required")?;
    unsafe {
        whisper_rs::set_log_callback(Some(discard_log), std::ptr::null_mut());
    }
    let ctx = WhisperContext::new_with_params(
        model.to_str().ok_or("Non-UTF8 model path")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| e.to_string())?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let initial_unavailable = state.had_repetition_rejection_history().is_err();
    let mut passed = initial_unavailable;
    let mut records = Vec::new();
    let mut native_calls = 0;
    for (index, id) in [
        "history1",
        "clean1",
        "history2",
        "wrapperEmpty",
        "nativeEarlyError",
        "clean2",
    ]
    .iter()
    .enumerate()
    {
        let audio: &[f32] = match index {
            0 | 2 => &history,
            3 => &[],
            _ => &clean,
        };
        let mut params = transcription_params();
        if index == 4 {
            params.set_audio_ctx(ctx.n_audio_ctx() + 1);
        }
        if index != 3 {
            native_calls += 1;
        }
        let result = state.full(params, audio);
        let native_history = state.had_repetition_rejection_history();
        let selected = state.selected_window_evidence();
        let error = result.as_ref().err().map(|e| e.to_string());
        let mut text = String::new();
        if result.is_ok() {
            for i in 0..state.full_n_segments().map_err(|e| e.to_string())? {
                text.push_str(&state.full_get_segment_text(i).map_err(|e| e.to_string())?);
            }
        }
        let step_passed = match index {
            0 | 2 => result.is_ok() && native_history.as_ref().is_ok_and(|v| *v),
            1 | 5 => {
                result.is_ok()
                    && native_history.as_ref().is_ok_and(|v| !*v)
                    && selected.as_ref().is_ok_and(|rows| !rows.is_empty())
            }
            3 => {
                matches!(result, Err(whisper_rs::WhisperError::NoSamples))
                    && native_history.is_err()
                    && selected.is_err()
            }
            4 => {
                matches!(result, Err(whisper_rs::WhisperError::GenericError(-5)))
                    && !state.had_low_confidence_decoder_rejection()
                    && !state.had_terminal_decoder_failure()
                    && native_history.as_ref().is_ok_and(|v| !*v)
                    && selected.as_ref().is_ok_and(|rows| rows.is_empty())
            }
            _ => false,
        };
        passed &= step_passed;
        records.push(serde_json::json!({"step":id,"samples":audio.len(),"invokedNative":index!=3,"resultError":error,"history":native_history.as_ref().ok(),"historyError":native_history.as_ref().err().map(|e|e.to_string()),"selectedRows":selected.as_ref().ok().map(|rows|rows.len()),"selectedError":selected.as_ref().err().map(|e|e.to_string()),"lowConfidence":state.had_low_confidence_decoder_rejection(),"terminalFailure":state.had_terminal_decoder_failure(),"rawText":if result.is_ok(){Some(text)}else{None},"passed":step_passed}));
    }
    let record = serde_json::json!({"schema":1,"historyFile":paths[0].to_str().ok_or("Non-UTF8 input")?,"cleanFile":paths[1].to_str().ok_or("Non-UTF8 input")?,"nativeCalls":native_calls,"sameNativeState":true,"initialHistoryUnavailable":initial_unavailable,"steps":records,"passed":passed});
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    serde_json::to_writer(&mut output, &record).map_err(|e| e.to_string())?;
    output
        .write_all(b"\n")
        .and_then(|_| output.flush())
        .map_err(|e| e.to_string())?;
    if passed {
        Ok(())
    } else {
        Err("Frozen reset sequence failed; retained every planned step".into())
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
