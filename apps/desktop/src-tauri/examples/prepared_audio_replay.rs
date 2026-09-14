//! Diagnostic only: replay already prepared mono16kHz headerless little-endian f32.
//! No PCM16 conversion, resampling, gain adjustment, or adapter-level retry.
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use voco_lib::transcribe::{default_model_path, DecodeDecision, WhisperState};

const MAX_SAMPLES: u64 = 9_600_000;
const MAX_BYTES: u64 = MAX_SAMPLES * 4;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayResponse<'a> {
    file: &'a str,
    samples: usize,
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    decode_decisions: Vec<DecodeDecision>,
}

fn main() -> Result<(), String> {
    let paths: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if paths.is_empty() {
        return Err("Usage: prepared_audio_replay <prepared.f32le> [prepared.f32le ...]".into());
    }
    let model = std::env::var_os("VOCO_MODEL_PATH")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_model_path)?;
    let mut whisper = WhisperState::new();
    let mut loaded = false;
    let mut failed = false;
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    for path in paths {
        let name = path
            .to_str()
            .ok_or("Input path must be valid UTF-8 for JSON provenance")?;
        let samples = read_prepared_audio(&path)?;
        if !loaded {
            whisper.load_model(&model)?;
            loaded = true;
        }
        let result = whisper.transcribe(&samples);
        let (text, error) = match result {
            Ok(text) => (Some(text), None),
            Err(error) => {
                failed = true;
                (None, Some(error))
            }
        };
        serde_json::to_writer(
            &mut output,
            &ReplayResponse {
                file: name,
                samples: samples.len(),
                text,
                error,
                decode_decisions: whisper.decode_decisions(),
            },
        )
        .map_err(|error| format!("Failed to serialize replay: {error}"))?;
        output
            .write_all(b"\n")
            .and_then(|_| output.flush())
            .map_err(|error| format!("Failed to write replay: {error}"))?;
    }
    if failed {
        Err("One or more transcriptions failed; see JSONL error records".into())
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
