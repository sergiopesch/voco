# Benchmark ASR/Transcription Path

Analyse the local speech-to-text pipeline for performance characteristics.

## Steps
1. Read `apps/desktop/src/hooks/useDictation.ts` and `apps/desktop/src-tauri/src/transcribe.rs`
2. Identify the full latency path:
   - Audio capture stop to data transfer (WebView to Rust)
   - Audio format conversion (if any)
   - whisper.cpp model inference time
   - Text return to frontend
   - Text insertion via ydotool/xdotool/clipboard
3. Identify memory concerns:
   - Audio buffer accumulation during recording
   - whisper model memory footprint
   - Buffer cleanup between dictation sessions
4. Check for optimisation opportunities:
   - Is model loading lazy or eager?
   - Can audio be streamed to whisper incrementally?
   - Are there unnecessary copies in the audio pipeline?
5. Report findings with specific latency estimates and improvement suggestions
