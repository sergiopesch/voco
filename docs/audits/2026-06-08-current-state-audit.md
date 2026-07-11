# VOCO Current State Audit - 2026-06-08

## Purpose

This audit records the current state after the live cursor streaming, local intelligence, realtime,
and long-dictation work. It is intended to stop ad hoc patching and give the next stabilization run a
grounded map of what exists, what has been proven, and what still fails.

## Product Target

VOCO should be a local-first Linux desktop dictation app that feels reliable enough for daily use:

- Press `Alt+D` in any ordinary text field.
- Speak for short notes or long dictation sessions.
- See text appear without corrupting existing target-app text.
- Stop with `Alt+D`.
- Get a clean final transcript inserted or safely available.
- Never require an account, telemetry, subscription, or cloud service for the core flow.

## Current Implementation Summary

The current implementation has four major product surfaces:

- Normal dictation with local Whisper transcription.
- Live cursor streaming using repeated local preview transcriptions.
- Optional local model transcript enhancement and local assistant output.
- Realtime/OpenClaw assistant experiments.

The highest-risk core files are:

- `apps/desktop/src/hooks/useDictation.ts` - capture, live preview, cursor commit policy, final
  transcription, enhancement, insertion, tracing, and state transitions.
- `apps/desktop/src/lib/dictationSession.ts` - dictation session state machine.
- `apps/desktop/src-tauri/src/lib.rs` - Tauri command boundary, hotkey tracing, local LLM,
  realtime/OpenClaw, and command registration.
- `apps/desktop/src-tauri/src/insertion.rs` - Wayland/X11 text insertion and diagnostics.
- `apps/desktop/src-tauri/src/transcribe.rs` - Whisper model loading and transcription.
- `apps/desktop/src/lib/audioInput.ts` - microphone selection and constraint fallback.
- `apps/desktop/public/audio-processor.js` - AudioWorklet capture batching.

## Changes Made During The Recent Session

The recent work added or changed:

- Append-only live cursor insertion.
- Session/generation gating for previews and finalization.
- Live ASR preview loop with a bounded rolling audio window.
- Stable prefix and rolling-overlap commit heuristics.
- 10-minute maximum final recording duration.
- Chunked final Whisper transcription in 30-second native ASR calls.
- Chunked frontend resampling for long recordings.
- Batched AudioWorklet messages.
- Tail-based preview audio collection using a running sample count.
- Microphone `OverconstrainedError` fallback.
- Local LLM enhancement and local assistant paths.
- Runtime diagnostics and manual QA docs.
- Clean installed launcher wrapper to avoid Limux WebKit/GStreamer environment leakage.

## Verified Evidence

Automated checks have passed after the latest changes:

- `npm run check`
- `npm test`
- `npm run lint`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`
- `npm run verify:versions`
- `npm run build -w apps/desktop`

Runtime checks on this machine have shown:

- Ubuntu 24.04 Wayland.
- `ydotool` installed.
- `ydotoold` active.
- `wl-copy` and `wl-paste` installed.
- User is in the `input` group.
- GStreamer elements `appsink`, `appsrc`, and `autoaudiosink` are available when VOCO is launched
  through the cleaned wrapper.

## Latest Failure Evidence

The most recent live test showed the critical failure clearly:

- Live preview ASR kept completing.
- Live cursor insertion stopped after early text.
- Trace had many `dictation_live_cursor_unsafe_rewrite_blocked` events.
- Trace had many `dictation_live_cursor_commit_waiting` events.
- Trace had no `dictation_live_cursor_insert_failed` events.

Interpretation:

The microphone, AudioWorklet, preview ASR, hotkey backend, and native insertion backend were alive.
The failure was the policy that decides whether preview text is safe to append at the cursor.

## Current Architectural Risk

`useDictation.ts` has become a broad orchestration file. It currently combines:

- Web audio setup and teardown.
- Sample buffering.
- Preview scheduling.
- Preview ASR calls.
- Live cursor commit heuristics.
- Native insertion.
- Session transitions.
- Final ASR.
- Optional local enhancement.
- Optional local assistant/OpenClaw handling.
- User-facing state.
- Trace events.

This makes the core dictation loop hard to reason about and easy to regress. The next goal should
reduce the number of responsibilities in this file before adding more behavior.

## What Is Not Yet Proven

The following are not proven, even if unit tests pass:

- Live words continue appearing for 1-minute, 5-minute, and 10-minute sessions.
- Live cursor streaming stays stable across real Whisper preview drift.
- Existing text before and after the cursor is never changed in real target apps.
- The final transcript remains acceptable after chunked 10-minute ASR.
- Conservative local model enhancement is fast and safe enough for long transcripts.
- The installed desktop app passes manual QA after every local build/reinstall.

## Audit Conclusion

The current app contains the pieces needed for a good local-first dictation product, but the live
cursor streaming path has accumulated too many heuristics without enough reproducible evidence.

The next stabilization effort should stop feature expansion and treat live dictation as a system
that must be measured, simplified, and proven end-to-end.
