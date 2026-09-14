//! Offline benchmark aid. Whisper token times are estimates, not annotated word boundaries.
use std::{env, fs};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        return Err("usage: word_boundary_estimate <model> <mono-16k-f32le>".into());
    }
    let bytes = fs::read(&args[2])?;
    if bytes.is_empty() || bytes.len() % 4 != 0 || bytes.len() > 16_000 * 4 * 60 {
        return Err("expected at most 60 seconds of mono 16 kHz float32 audio".into());
    }
    let audio: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    if audio.iter().any(|x| !x.is_finite()) {
        return Err("nonfinite samples".into());
    }
    let context = WhisperContext::new_with_params(&args[1], WhisperContextParameters::default())?;
    let mut state = context.create_state()?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_n_threads(4);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);
    state.full(params, &audio)?;
    let mut tokens = Vec::new();
    for i in 0..state.full_n_segments()? {
        for j in 0..state.full_n_tokens(i)? {
            let data = state.full_get_token_data(i, j)?;
            let text = state.full_get_token_text_lossy(i, j)?;
            if data.id >= context.token_eot() {
                continue;
            }
            tokens.push(serde_json::json!({"text":text,"start_s":data.t0 as f64/100.,"end_s":data.t1 as f64/100.,"probability":data.p}));
        }
    }
    println!(
        "{}",
        serde_json::json!({"method":"Whisper base.en token timestamp estimate; not ground truth","tokens":tokens})
    );
    Ok(())
}
