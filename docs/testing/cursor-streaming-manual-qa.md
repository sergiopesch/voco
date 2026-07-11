# Cursor Streaming Manual QA

Use this checklist when validating direct live words at the cursor.

## Setup

- Ubuntu Wayland with `ydotool` installed.
- `ydotoold` is active when required by the installed `ydotool` version.
- Settings -> Output & local model -> After transcription is `Type transcript at cursor`.
- Settings -> Output & local model -> Live cursor mode is `Stable cursor streaming`.
- Settings -> Output & local model -> Transcript enhancement is `Off`.
- Settings -> Advanced -> Refresh runtime checks shows type simulation available.

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

## Target Apps

- Text editor.
- Browser textarea.
- Chat input.
- Terminal prompt where synthetic typing is safe.

## Pass Criteria

- Existing target-app text is not deleted.
- No raw key codes or stray numbers appear.
- Live words continue appearing or VOCO explains that live cursor streaming paused.
- Live words do not stop merely because the dictation has passed the first preview window.
- Finalization does not duplicate the transcript.
- Stop returns VOCO to idle quickly.
- The final transcript remains available in VOCO if it cannot be safely reconciled at the cursor.

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
- `dictation_stop_to_final_transcript`
- `dictation_stop_to_idle`

For a summary with preview p50/p95 and stop timings, run:

```bash
npm run report:cursor-streaming
```

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

- Switch Live cursor mode to `Preview overlay only`; live text appears only in VOCO UI and final
  insertion still runs after stop.
- Switch Live cursor mode to `Final text only`; no live preview ASR runs and final insertion still
  runs after stop.
