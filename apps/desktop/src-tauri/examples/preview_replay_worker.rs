use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read, Write};
use voco_lib::transcribe::{default_model_path, DecodeDecision, WhisperState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayResponse<'a, T: Serialize> {
    #[serde(flatten)]
    result: &'a T,
    decode_decisions: Vec<DecodeDecision>,
}

fn write_response<T: Serialize>(
    writer: &mut impl Write,
    result: &T,
    whisper: &WhisperState,
) -> Result<(), String> {
    serde_json::to_writer(
        &mut *writer,
        &ReplayResponse {
            result,
            decode_decisions: whisper.decode_decisions(),
        },
    )
    .map_err(|error| format!("Failed to encode replay response: {error}"))?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Failed to write replay response: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewRequest {
    start_sample: usize,
    end_sample: usize,
    #[serde(default)]
    full_session: bool,
    #[serde(default)]
    desktop_preview: bool,
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
        if self.desktop_preview
            && (self.full_session || self.canonical || !self.previous_canonical_text.is_empty())
        {
            return Err("Desktop preview cannot be combined with final/canonical replay".into());
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

fn main() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let audio_path = args
        .next()
        .ok_or("Usage: preview_replay_worker <capture.wav>")?;
    let full_transcription = match args.next() {
        None => false,
        Some(arg) if arg == "--full" => true,
        Some(_) => return Err("Usage: preview_replay_worker <capture.wav> [--full]".to_string()),
    };
    if args.next().is_some() {
        return Err("Usage: preview_replay_worker <capture.wav> [--full]".to_string());
    }
    let samples = decode_capture_wav(&std::path::PathBuf::from(audio_path))?;
    let model_path = std::env::var_os("VOCO_MODEL_PATH")
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_model_path)?;
    let mut whisper = WhisperState::new();
    whisper.load_model(&model_path)?;

    if full_transcription {
        println!("{}", whisper.transcribe(&samples)?);
        return Ok(());
    }

    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    loop {
        let mut line = Vec::new();
        let count = Read::by_ref(&mut input)
            .take(MAX_REQUEST_BYTES + 1)
            .read_until(b'\n', &mut line)
            .map_err(|error| format!("Failed to read replay request: {error}"))?;
        if count == 0 {
            break;
        }
        if count as u64 > MAX_REQUEST_BYTES {
            return Err("Replay request exceeds the 1 MiB limit".to_string());
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }

        let request: PreviewRequest = serde_json::from_slice(&line)
            .map_err(|error| format!("Invalid replay request: {error}"))?;
        request.validate(samples.len())?;
        if request.desktop_preview {
            let output = whisper
                .transcribe_desktop_preview(&samples[request.start_sample..request.end_sample])?;
            let preview = output.unwrap_or(voco_lib::transcribe::PreviewTranscription {
                text: String::new(),
                segments: Vec::new(),
            });
            write_response(&mut stdout, &preview, &whisper)?;
            continue;
        }
        if request.full_session {
            let preview = voco_lib::transcribe::PreviewTranscription {
                text: whisper.transcribe(&samples)?,
                segments: Vec::new(),
            };
            write_response(&mut stdout, &preview, &whisper)?;
            continue;
        }
        let start = request.start_sample;
        let end = request.end_sample;
        if request.canonical {
            let canonical = whisper.transcribe_canonical_chunk(
                &samples[start..end],
                &request.previous_canonical_text,
            )?;
            write_response(&mut stdout, &canonical, &whisper)?;
            continue;
        }
        let preview = whisper.transcribe_preview(&samples[start..end])?;
        write_response(&mut stdout, &preview, &whisper)?;
    }

    Ok(())
}

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

    fn request(json: &str, samples: usize) -> Result<PreviewRequest, String> {
        let request: PreviewRequest = serde_json::from_str(json).map_err(|e| e.to_string())?;
        request.validate(samples)?;
        Ok(request)
    }

    #[test]
    fn valid_modes_and_prefix_are_preserved_exactly() {
        assert!(request(r#"{"startSample":2,"endSample":4}"#, 5).is_ok());
        assert!(request(r#"{"startSample":0,"endSample":5,"fullSession":true}"#, 5).is_ok());
        let r = request(r#"{"startSample":0,"endSample":5,"canonical":true,"previousCanonicalText":"Go. Go. 名\n"}"#, 5).unwrap();
        assert_eq!(r.previous_canonical_text, "Go. Go. 名\n");
    }

    #[test]
    fn reversed_empty_and_outside_ranges_are_not_clamped() {
        for (start, end, count) in [(3, 2, 5), (2, 2, 5), (0, 0, 0), (0, 6, 5), (6, 7, 5)] {
            let value = format!(r#"{{"startSample":{start},"endSample":{end}}}"#);
            assert!(request(&value, count).is_err(), "{value}");
        }
    }

    #[test]
    fn full_session_requires_exact_extent_and_exclusive_mode() {
        for value in [
            r#"{"startSample":1,"endSample":5,"fullSession":true}"#,
            r#"{"startSample":0,"endSample":4,"fullSession":true}"#,
            r#"{"startSample":0,"endSample":5,"fullSession":true,"canonical":true}"#,
            r#"{"startSample":0,"endSample":5,"fullSession":true,"previousCanonicalText":"old"}"#,
            r#"{"startSample":0,"endSample":5,"previousCanonicalText":"old"}"#,
        ] {
            assert!(request(value, 5).is_err(), "{value}");
        }
    }

    #[test]
    fn json_rejects_unknown_duplicate_missing_and_wrong_typed_fields() {
        for value in [
            r#"{"startSample":0,"endSample":5,"canonial":true}"#,
            r#"{"startSample":0,"startSample":1,"endSample":5}"#,
            r#"{"endSample":5}"#,
            r#"{"startSample":-1,"endSample":5}"#,
            r#"{"startSample":0.5,"endSample":5}"#,
            r#"{"startSample":true,"endSample":5}"#,
            r#"{"startSample":0,"endSample":5,"fullSession":1}"#,
            r#"{"startSample":0,"endSample":5,"canonical":null}"#,
            r#"{"startSample":0,"endSample":5,"previousCanonicalText":false}"#,
        ] {
            assert!(request(value, 5).is_err(), "{value}");
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
