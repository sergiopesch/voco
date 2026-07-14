use serde::Deserialize;
use std::io::{BufRead, Write};
use voco_lib::transcribe::{default_model_path, WhisperState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequest {
    start_sample: usize,
    end_sample: usize,
    #[serde(default)]
    full_session: bool,
}

fn main() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let audio_path = args
        .next()
        .ok_or("Usage: preview_replay_worker <capture.wav>")?;
    let full_transcription = args.any(|arg| arg == "--full");
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
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| format!("Failed to read replay request: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }

        let request: PreviewRequest = serde_json::from_str(&line)
            .map_err(|error| format!("Invalid replay request: {error}"))?;
        if request.full_session {
            let preview = voco_lib::transcribe::PreviewTranscription {
                text: whisper.transcribe(&samples)?,
                segments: Vec::new(),
            };
            serde_json::to_writer(&mut stdout, &preview)
                .map_err(|error| format!("Failed to encode replay response: {error}"))?;
            stdout
                .write_all(b"\n")
                .and_then(|_| stdout.flush())
                .map_err(|error| format!("Failed to write replay response: {error}"))?;
            continue;
        }
        let start = request.start_sample.min(samples.len());
        let end = request.end_sample.min(samples.len()).max(start);
        let preview = whisper.transcribe_preview(&samples[start..end])?;
        serde_json::to_writer(&mut stdout, &preview)
            .map_err(|error| format!("Failed to encode replay response: {error}"))?;
        stdout
            .write_all(b"\n")
            .map_err(|error| format!("Failed to write replay response: {error}"))?;
        stdout
            .flush()
            .map_err(|error| format!("Failed to flush replay response: {error}"))?;
    }

    Ok(())
}

fn decode_capture_wav(path: &std::path::Path) -> Result<Vec<f32>, String> {
    let wav = std::fs::read(path)
        .map_err(|error| format!("Failed to read capture WAV {}: {error}", path.display()))?;
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("Capture is not a RIFF/WAVE file".to_string());
    }
    if &wav[12..16] != b"fmt " || &wav[36..40] != b"data" {
        return Err("Capture WAV does not use the expected PCM layout".to_string());
    }
    let audio_format = u16::from_le_bytes([wav[20], wav[21]]);
    let channels = u16::from_le_bytes([wav[22], wav[23]]);
    let sample_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
    let bits_per_sample = u16::from_le_bytes([wav[34], wav[35]]);
    if audio_format != 1 || channels != 1 || sample_rate != 16_000 || bits_per_sample != 16 {
        return Err("Capture WAV must be mono 16 kHz PCM16".to_string());
    }

    let declared_size = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]) as usize;
    let data_end = 44usize.saturating_add(declared_size).min(wav.len());
    if (data_end - 44) % 2 != 0 {
        return Err("Capture WAV has an incomplete PCM16 sample".to_string());
    }

    Ok(wav[44..data_end]
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / i16::MAX as f32)
        .collect())
}
