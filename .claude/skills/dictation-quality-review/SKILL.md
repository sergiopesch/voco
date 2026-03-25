# Dictation Quality Review

## When to use
Invoke when changes touch audio capture, whisper.cpp parameters, transcription flow, sample rate handling, silence detection, or any code in `transcribe.rs` or `useDictation.ts`.

## What to review

### Audio capture
- Is the sample rate correct for whisper.cpp (16kHz mono)?
- Is audio data properly converted from WebView format to whisper-rs input?
- Are buffer sizes appropriate for dictation latency?
- Is the ScriptProcessorNode (or AudioWorklet) handling audio without dropped frames?

### Transcription quality
- Have whisper parameters (beam size, language, task) been changed? If so, justify against quality and latency.
- Is the model path resolved correctly on first run and subsequent runs?
- Does the transcription handle silence, short utterances, and long dictation reasonably?
- Are any preprocessing steps (gain normalisation, noise reduction, resampling) safe and justified?

### Latency
- What is the estimated end-to-end latency from stop-recording to text insertion?
- Are there unnecessary copies, conversions, or blocking operations in the path?
- Is model loading lazy or eager, and is the tradeoff documented?

### Reliability
- What happens when the model file is missing or corrupted?
- What happens when audio capture fails mid-dictation?
- Are errors propagated clearly to the user?

## Output format
| Area | Severity | Issue | File:line | Impact on dictation | Recommendation |
|------|----------|-------|-----------|---------------------|----------------|
