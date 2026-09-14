# Architecture

This describes the 2026.0.35 application testing candidate. Package revision and
release gates are recorded in [candidate status](../release-candidate.md).

## Current dictation path

1. The Tauri/React frontend owns microphone capture and dictation state. AudioWorklet
   capture supplies ordered audio; interruption and recovery are explicit states.
2. `apps/desktop/src/lib/benchmarkPhraseQueue.ts` transports bounded streaming audio
   and session/sequence metadata to the Rust `benchmark_stream` command.
3. `apps/desktop/src-tauri/src/benchmark_stream.rs` serializes worker access, starts
   an explicit local Python entrypoint, validates bounded newline-delimited JSON
   responses and session identity, and reaps failed workers. It is production
   candidate code despite its historical module name.
4. `runtime/speech/stream_worker.py` starts `worker_main.py`. The worker owns a
   reusable local Nemotron recognizer, validates requests and drains hypotheses.
   `streaming.py` handles warmup, silence gating, sample accounting and metrics;
   `adapters.py` bridges the packaged CPU native library. The default is the Q8
   English 0.6B model, context 1, four CPU threads and the pool backend.
5. The frontend appends accepted live words through `insertion.rs`. `focus_probe.rs`
   checks the current destination and terminal category. Clipboard and key helpers
   perform paste; they do not return recipient text/paint acknowledgements.
6. Stop flushes the stream and remaining suffix. Focus loss, revised already-delivered
   text or uncertain delivery preserves recovery instead of blindly replaying text.

The candidate batches released silence-preroll frames into at most one second per
native call, preserving every released sample and its order. This reduces call
count; the benchmark did not demonstrate a material first-word latency improvement.
The zero gate detects digital silence, not speech onset or arbitrary background noise.

## Delivery contracts

Desktop paste/streaming are enabled unless their launcher overrides are `0`.
Live streaming also depends on the session's output/enhancement configuration.
Desktop paste replaces clipboard text and leaves it there; a leading join space can
be typed separately to preserve address-bar separators. Known terminals use their
paste chord. VOCO does not submit Enter or rewrite arbitrary editor text after Stop.
Focus metadata is a best-effort guard, not exact per-widget ownership or protection
from every sensitive field. See [delivery policy](../testing/desktop-paste.md).

The explicitly enabled Chromium adapter is a separate, stronger exact-element
contract: element/document identity, caret and acknowledged prefix are checked
before edits. Password fields, rich editors and unsupported fields are rejected.
IBus remains shortcut-only; protocol 5 rejects text mutation. Neither integration
establishes universal desktop or Wayland qualification.

Legacy Whisper preview/final and hybrid recognition remain in `transcribe.rs` and
the [hybrid planner](hybrid-recognition.md). They are not the streaming NVIDIA
candidate benchmark path. Optional local-model processing, OpenClaw and Realtime
retain distinct configuration and network boundaries; see [security](../security/README.md).

## State, UI and lifecycle

`useDictation.ts` coordinates capture, delivery and recovery; `config.rs` serializes
field-level settings updates and writes private atomic configuration. Single-instance
ownership prevents two VOCO processes from competing for sockets or shortcuts.
The backend tray reducer combines microphone, model, dictation and realtime states.
Normal dictation stays out of the way without opening a transcript preview. The
Crystal Sidebar and rounded glass controls retain OS accessibility preferences.
A hotkey should be used with the intended destination focused.

## Diagnostics and package identity

`performance.rs` records bounded application timing/resource metadata;
`runtime/speech/streaming.py` records worker stages. Both are opt-in through
`VOCO_PERFORMANCE_LOG=1`. Session hashes correlate app IPC and worker requests;
this is not yet an end-to-end cursor paint clock. See
[measurement scope and retention](../testing/laptop-performance.md).

The complete Debian package combines Tauri's base package with `runtime/speech`,
model, native libraries and notices through `scripts/package-nvidia.py`.
It installs `/usr/lib/voco/speech/stream_worker.py`, which is the default worker
entrypoint, and retains a payload manifest. Runtime path overrides are development
controls; installing an old binary with a new worker does not establish a new
whole-app candidate identity.

## Navigation

- [Current candidate and release gates](../release-candidate.md)
- [Local comparison and limitations](../testing/model-comparison-2026-09-14.md)
- [Testing](../testing/README.md)
- [Historical foundations architecture](foundations-history.md)
- [Speech recovery](speech-recovery.md)
- [Browser broker acceptance](../testing/browser-broker.md)
