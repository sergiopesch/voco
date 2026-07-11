# VOCO Stabilization Risk Register

## Severity Key

- `P0`: Blocks reliable core dictation.
- `P1`: Likely to cause user-visible failure or regression.
- `P2`: Maintainability, polish, or secondary workflow risk.

## Risks

### P0: Live Cursor Streaming Stalls During Long Dictation

Evidence:

- Trace shows preview ASR continues while cursor insertion stops.
- Many `dictation_live_cursor_unsafe_rewrite_blocked` and
  `dictation_live_cursor_commit_waiting` events.

Likely cause:

- Commit policy rejects normal rolling Whisper preview changes.

Required fix:

- Isolate and harden the live commit policy.
- Build regression fixtures from real trace shapes.
- Add manual QA for 30s, 1m, 5m, and 10m dictation.

Exit criteria:

- During a 1-minute continuous dictation, `dictation_live_cursor_insert_updated` continues after the
  first 10 seconds or the app explicitly switches to overlay-only with one notification.

### P0: Core Dictation File Has Too Many Responsibilities

Evidence:

- `apps/desktop/src/hooks/useDictation.ts` is roughly 1,500 lines.
- It mixes audio capture, ASR preview, insertion, finalization, local intelligence, and tracing.

Risk:

- Fixes in one area can silently break another.
- State transitions are difficult to reason about.

Required fix:

- Extract pure modules before adding more heuristics.
- Keep `useDictation` as orchestration only.

Exit criteria:

- Live commit policy, audio buffer, and finalization can be tested without React.

### P0: Manual QA Is Still The Source Of Truth For Cursor Safety

Evidence:

- Unit tests pass while live behavior still fails.

Risk:

- Automated tests are not yet modeling real Whisper preview drift or real Linux target apps.

Required fix:

- Treat manual QA as mandatory before "done".
- Add trace-report thresholds that fail when live insertion stalls.

Exit criteria:

- QA result docs record pass/fail for text editor, browser textarea, chat input, and safe terminal
  prompt.

### P1: Local Enhancement Can Hide Dictation Failures

Evidence:

- Config currently enables `transcriptEnhancement: "conservative"` on this machine.
- Long transcripts may be sent to a local model after final ASR.

Risk:

- Users may blame dictation for local model latency or text changes.

Required fix:

- During core dictation stabilization, test with enhancement off first.
- Then test commands-only.
- Then test conservative enhancement separately.

Exit criteria:

- Core dictation passes with enhancement off before enhancement is evaluated.

### P1: Installed App Can Inherit Bad Environment

Evidence:

- Limux environment variables caused WebKit/GStreamer lookup failures.

Current mitigation:

- `~/.local/bin/voco` wrapper unsets `LD_LIBRARY_PATH`, `WEBKIT_EXEC_PATH`,
  `WEBKIT_INJECTED_BUNDLE_PATH`, and related GStreamer variables before launching `voco-bin`.

Required fix:

- Document this local wrapper behavior if it becomes part of the development install flow.

Exit criteria:

- Installed app starts without GStreamer `appsink`, `appsrc`, or `autoaudiosink` errors.

### P1: 10-Minute Final Transcription Quality Is Not Proven

Evidence:

- Chunking exists, but real long audio QA is pending.

Risk:

- Chunk boundaries may cut phrases awkwardly.

Required fix:

- Test 1m, 5m, and 10m final transcripts.
- Consider silence-aware chunk boundaries after baseline evidence.

Exit criteria:

- Final transcript is complete enough and does not lose text at chunk boundaries.

### P2: Docs And Claims Can Drift Ahead Of Evidence

Evidence:

- Several specs describe intended behavior not yet proven by manual QA.

Required fix:

- Keep audit docs explicit about proven vs unproven behavior.
- Do not claim production readiness for live cursor streaming until the matrix passes.

Exit criteria:

- README and install docs distinguish stable core dictation from experimental live cursor streaming.
