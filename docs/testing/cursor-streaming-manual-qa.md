# Cursor Streaming Manual QA

Use this checklist when validating direct live words at the cursor.

## Setup

- Ubuntu Wayland with IBus, `python3-gi`, and `gir1.2-ibus-1.0` installed.
- The current VOCO Debian package installed in the disposable VM.
- `VOCO Dictation` manually added and selected in the VM's Input Sources settings.
- Settings -> Advanced -> Automatic live cursor reports `Ready`.
- Settings -> Output & local model -> After transcription is `Type transcript at cursor`.
- Settings -> Output & local model -> Live cursor mode is `Live words at cursor (recommended)`.
- Settings -> Output & local model -> Transcript enhancement is `Off`.

Confirm the baseline settings before testing:

```bash
npm run report:dictation-baseline
```

Reset the trace before each focused QA run so old startup or failed-session evidence cannot be
mixed with the current test:

```bash
npm run reset:cursor-streaming-trace
```

After resetting, restart VOCO through the installed launcher and confirm the trace window starts
cleanly:

```bash
"$HOME/.local/bin/voco"
npm run report:cursor-streaming
```

## Desktop Safety Boundary

Run automated VOCO + IBus + target-application tests only in a disposable remote VM or microVM. Do
not exercise input injection, virtual audio routing, or automated input-source changes on an active
workstation desktop. The no-deletion ownership and command-emission matrix is safe to run
headlessly:

```bash
npm run test:owned-preedit
```

That suite must pass before any isolated desktop run. A desktop run is not verified by the headless
suite or by a local-container smoke test; record the remote lease ID and preserve its logs, events,
screenshots, and recordings separately.

## Cases

- Empty text field, short sentence.
- 10-second dictation.
- 1-minute dictation.
- 5-minute dictation.
- 10-minute dictation.
- Empty text field, 20-30 second paragraph.
- Existing text before cursor.
- Existing text after cursor.
- Cursor in the middle of a paragraph.
- Press `Alt+D` twice quickly.
- Press stop while live words are appearing.
- Speak, pause, then continue.
- Dictate punctuation-heavy text.
- Dictate phrases that commonly get revised by Whisper.
- Repeat the same phrase twice.
- Switch away from `VOCO Dictation` during a provisional update; only preedit clears.
- Move focus, move the cursor, change selection, and close the target during dictation.
- Type a normal key while provisional text is visible; the key passes through and the lease ends.
- Attempt password, PIN, private, and hidden-text fields; stable cursor streaming remains unavailable.
- Kill/restart only the disposable VM's VOCO app and IBus engine in separate cases.
- Reinstall a newer package while the old engine is running; protocol mismatch stays preview-only.

## Target Apps

- Text editor.
- Browser textarea.
- Chat input.
- Terminal prompt where synthetic typing is safe.

## Pass Criteria

- Existing target-app text outside VOCO's provisional composition range is not deleted.
- Provisional wording and punctuation can revise automatically without user editing.
- Stable phrases wrap and lay out as native text inside the target field instead of extending as one
  unbounded composition line.
- No raw key codes or stray numbers appear.
- Live words continue appearing or VOCO explains that live cursor streaming paused.
- Live words do not stop merely because the dictation has passed the first preview window.
- Finalization does not duplicate the transcript.
- The final cursor text contains every spoken phrase; `dictation_final_output_unreconciled` is not
  present in a passing direct-cursor run.
- Stop returns VOCO to idle quickly.
- If reconciliation does fail, VOCO preserves the final transcript without deleting target-app
  text and the trace report marks the run as failed rather than calling it complete.
- Cancellation after progressive commits preserves those normal target-app commits and clears only
  VOCO's still-provisional preedit tail.
- Ordinary GB-layout typing, compose/dead keys, GTK, Qt, Electron, and terminal input continue to
  behave normally while the persistent source is selected and dictation is idle.

## Timing Evidence

Record the privacy-safe timing events from:

```bash
tail -n 200 "${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl"
```

Capture these events when present:

- `recording_state_active`
- `dictation_recording_duration`
- `dictation_first_live_text_visible`
- `dictation_live_preview_completed`
- `dictation_live_preview_confirmed`
- `dictation_live_preview_window_advanced`
- `dictation_owned_preedit_started`
- `dictation_owned_preedit_updated`
- `dictation_owned_preedit_progressive_commit`
- `dictation_owned_preedit_committed`
- `dictation_recording_limit_reached`
- `dictation_stop_to_final_transcript`
- `dictation_stop_to_idle`

For a summary with preview p50/p95 and stop timings, run:

```bash
npm run report:cursor-streaming
```

A passing direct-cursor report must not show `final-cursor-output-unreconciled`,
`cursor-streaming-stalled`, or `cursor-streaming-latency-above-target`. Window-advance events
demonstrate that long dictation continued from timestamped committed segments rather than dropping
the start of a rolling preview. Finalization always runs authoritative full-session ASR; preview or
tail hypotheses are never substituted for it.

For the duration-specific QA cases, require the trace to prove the intended minimum recording
length:

```bash
npm run report:cursor-streaming -- --min-duration-ms 10000
npm run report:cursor-streaming -- --min-duration-ms 60000
npm run report:cursor-streaming -- --min-duration-ms 300000
npm run report:cursor-streaming -- --min-duration-ms 600000
```

Use a fresh trace for each duration case. A passing status without the matching minimum-duration
check proves that a dictation session completed, but it does not prove that the target session
length was actually exercised.

For long final-dictation QA with Live cursor mode set to `Final text only`, use the same fresh-trace
flow and require final-only evidence instead of live cursor evidence:

```bash
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 60000
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 300000
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 600000
```

## Fallback Checks

- Switch Live cursor mode to `Live transcript panel`; live text appears only in VOCO UI and final
  insertion still runs after stop.
- Switch Live cursor mode to `Final text only`; no live preview ASR runs and final insertion still
  runs after stop.

## Isolated Audio Regression Capture

Do not capture from an active workstation. When a real voice/accent-specific cursor stall cannot be
reproduced with text fixtures, launch one development session inside the disposable remote desktop
with explicit one-shot capture enabled:

```bash
VOCO_DEBUG_CAPTURE_AUDIO=1 npm run dev
```

The first completed dictation saves a 16 kHz mono WAV and a JSON preview timeline under
`~/.local/state/voco/debug-captures/`. The directory is user-only (`0700`), files are user-only
(`0600`), and later dictations in that app process are not captured. This mode is disabled unless
the environment flag is exactly `1`. The independent full-audio reference is diagnostic background
work; it does not hold the final cursor insertion or the toggle in `processing`.

Before the pinned captured-session regression, verify the timeline, derived WAV, and model hashes:

```bash
sha256sum \
  /home/sergiopesch/.local/state/voco/debug-captures/dictation-1783960592019.json \
  /home/sergiopesch/.local/state/voco/debug-captures/dictation-1783960592019.wav \
  /home/sergiopesch/.local/share/voco/models/ggml-base.en.bin
```

Expected hashes, in the same order, are:

```text
48b15e6da51cc5bdeebfafa8a7e586e5e0bff05392ed2cb391244932006a0399
bd0d2512d96a0d2cf26bdfabc7f698bd28a6e931f21f0d08b3c5f7fd9f9a94c5
a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002
```

Stop on any mismatch. Then set both paths explicitly; the replay derives the WAV path from the JSON:

```bash
VOCO_CAPTURE_TIMELINE=/home/sergiopesch/.local/state/voco/debug-captures/dictation-1783960592019.json \
VOCO_MODEL_PATH=/home/sergiopesch/.local/share/voco/models/ggml-base.en.bin \
npm run test:captured-dictation
```

Treat these files as sensitive voice data. Keep them outside Git, share them only with explicit
consent, and delete them after the regression has been reduced to non-audio fixtures.
