//! Diagnostic comparison only; this does not alter application decoder settings.
use serde_json::json;
use std::path::Path;
use std::time::Instant;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let wav = std::fs::read(
        args.get(1)
            .ok_or("usage: token_timing_probe WAV START END")?,
    )?;
    if wav.len() < 44
        || &wav[..4] != b"RIFF"
        || &wav[8..16] != b"WAVEfmt "
        || &wav[36..40] != b"data"
        || u16::from_le_bytes(wav[20..22].try_into()?) != 1
        || u16::from_le_bytes(wav[22..24].try_into()?) != 1
        || u32::from_le_bytes(wav[24..28].try_into()?) != 16000
        || u16::from_le_bytes(wav[34..36].try_into()?) != 16
    {
        return Err("requires canonical mono PCM16 16kHz fixture WAV".into());
    }
    let data_bytes = u32::from_le_bytes(wav[40..44].try_into()?) as usize;
    if data_bytes != wav.len() - 44 || !data_bytes.is_multiple_of(2) {
        return Err("fixture WAV data length does not match its PCM payload".into());
    }
    let samples: Vec<f32> = wav[44..]
        .chunks_exact(2)
        .map(|x| i16::from_le_bytes([x[0], x[1]]) as f32 / i16::MAX as f32)
        .collect();
    let start: usize = args.get(2).ok_or("start sample missing")?.parse()?;
    let end: usize = args.get(3).ok_or("end sample missing")?.parse()?;
    let samples = samples
        .get(start..end)
        .ok_or("sample range outside audio")?;
    let model = match std::env::var("VOCO_MODEL_PATH") {
        Ok(path) => path,
        Err(_) => voco_lib::transcribe::default_model_path()
            .map_err(std::io::Error::other)?
            .to_string_lossy()
            .into_owned(),
    };
    let ctx = WhisperContext::new_with_params(
        Path::new(&model).to_str().ok_or("model path")?,
        WhisperContextParameters::default(),
    )?;
    for timestamps in [false, true] {
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
        params.set_n_threads(std::thread::available_parallelism()?.get().min(8) as i32);
        params.set_token_timestamps(timestamps);
        let mut state = ctx.create_state()?;
        let began = Instant::now();
        state.full(params, samples)?;
        let elapsed_ms = began.elapsed().as_millis();
        let mut text = String::new();
        let mut tokens = Vec::new();
        for segment in 0..state.full_n_segments()? {
            text.push_str(&state.full_get_segment_text(segment)?);
            for token in 0..state.full_n_tokens(segment)? {
                let data = state.full_get_token_data(segment, token)?;
                tokens.push(json!({"text":state.full_get_token_text_lossy(segment,token)?, "t0": data.t0, "t1":data.t1}));
            }
        }
        println!(
            "{}",
            json!({"tokenTimestamps":timestamps,"elapsedMs":elapsed_ms,"text":text.trim(),"tokens":tokens})
        );
    }
    Ok(())
}
