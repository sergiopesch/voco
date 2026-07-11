# Streaming ASR Feel Specification

This document defines the next latency improvement for normal dictation. It focuses on perceived
speed and responsiveness without replacing the current Whisper full-buffer path until benchmarks
justify doing so.

For the product hardening plan for direct cursor-visible live words, see
[cursor-streaming-dictation-hardening-spec.md](./cursor-streaming-dictation-hardening-spec.md).

## Scope

Streaming ASR feel is not a new assistant mode.

- Normal dictation still uses `Alt+D`.
- Whisper remains the primary ASR engine.
- The first build may use VAD, auto-stop, pre-processing, bounded preview windows, chunked final
  transcription, and better timing feedback.
- True streaming/windowed ASR is allowed only after measurement proves it improves latency without
  hurting accuracy.

The product promise is:

> VOCO should feel like it starts, stops, and types faster, from 10-second notes through 10-minute
> dictation, while preserving current reliability on Ubuntu/Debian, Wayland, and X11.

## User-Facing Requirements

### Faster Stop-To-Insert

Users should spend less time waiting after they stop speaking.

Acceptance criteria:

- VOCO records timing for recording stop, resample complete, ASR start, ASR complete, optional
  enhancement complete, and insertion requested.
- The UI distinguishes `Wrapping up`, `Transcribing`, optional `Polishing`, and `Typing` states.
- No new progress UI should require user action.
- If timing instrumentation fails, dictation still completes.

### Optional Auto-Stop

VOCO may stop recording automatically after speech ends only when the user enabled it.

Acceptance criteria:

- Auto-stop is off by default.
- Auto-stop uses local audio levels/VAD only.
- Auto-stop does not fire during short pauses below the configured silence threshold.
- The hotkey still manually stops recording at any time.
- If auto-stop misfires, the existing max-duration and manual hotkey behavior remain intact.

### No Accuracy Regression

Latency work must not degrade transcription quality.

Acceptance criteria:

- The final text for manual stop remains produced by the local Whisper ASR path unless an experiment
  is explicitly enabled.
- Long final transcription must use bounded chunks instead of one unbounded Whisper call.
- Any windowed/streaming ASR experiment must compare output against the chunked final path.
- Dictation should support recordings from roughly 10 seconds through 10 minutes.

## Technical Requirements

### Audio Pipeline

The existing WebView audio capture remains the source of truth.

Acceptance criteria:

- AudioWorklet remains preferred, ScriptProcessor remains fallback.
- Samples continue to be resampled to 16 kHz before Whisper.
- Live previews use a small rolling audio window and must not scale with total session duration.
- Final ASR work is chunked so each native transcription operation remains bounded.
- New VAD logic must not require cloud services, telemetry, or additional permissions.
- Audio graph teardown continues to stop tracks and disconnect nodes.

### Instrumentation

Latency metrics must be useful and privacy-safe.

Acceptance criteria:

- Timing logs include durations and phase names only.
- Logs do not include audio samples, transcript text, model output, or selected app contents.
- A future trace file extension must follow the same non-content rule as hotkey tracing.

## Validation

Before marking streaming feel complete:

- Unit tests cover VAD state transitions and silence threshold behavior.
- Frontend tests cover state changes for manual stop and auto-stop.
- Manual QA covers short phrase, long phrase, pause mid-sentence, silence, and background noise.
- Manual QA covers Wayland and X11 start/stop/insertion behavior.
- A before/after latency table is added to the PR or implementation notes.
