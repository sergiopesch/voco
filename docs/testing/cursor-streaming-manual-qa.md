# Cursor Streaming Manual QA

Use this checklist when validating direct live words at the cursor.

This file defines the procedure; it does not claim that an installed desktop run was performed.
Record actual evidence and pending cases in the QA results document.

## Setup

- Ubuntu Wayland with IBus, `python3-gi`, and `gir1.2-ibus-1.0` installed.
- The current VOCO Debian package installed in the disposable VM.
- `VOCO Dictation` manually added and selected in the VM's Input Sources settings.
- Settings -> Advanced -> Automatic live cursor reports `Ready`.
- Settings -> Output & local model -> After transcription is `Type transcript at cursor`.
- Settings -> Output & local model -> Live cursor mode is `Live words at cursor (enhancement off)`.
- Settings -> Output & local model -> Transcript enhancement is `Off`.
- Use a GitHub Release `.deb` on Ubuntu for the primary owned-cursor matrix. A Debian-derived run may
  be recorded separately as best-effort evidence, but it does not replace the Ubuntu matrix. A
  local experimental AppImage may be checked separately for its documented preview-only behavior,
  but it is not currently published and does not install the host IBus component. Flatpak and Snap
  are not release channels for this matrix.

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
/usr/bin/voco
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
- Boundary dictations ending just before, at, and just after 30 seconds.
- Boundary dictations ending at 59 and 88 seconds.
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
- Focus a verified normal field, move focus away, then return to the same real input context without
  a fresh content-type callback; live cursor must remain unavailable. After the current focus reports
  fresh safe, non-sensitive metadata, a new owned-preedit lease may start.
- Focus a verified normal field, pass through a synthetic/global-engine proxy, then return to the
  same real context; the old content proof must not survive.
- Type a normal key while provisional text is visible; the key passes through and the lease ends.
- Attempt password, PIN, private, and hidden-text fields; stable cursor streaming remains unavailable.
- Attempt a terminal prompt and normal-looking fields with missing or ambiguous content metadata;
  stable cursor streaming remains unavailable and the VOCO preview is visible.
- Kill/restart only the disposable VM's VOCO app and IBus engine in separate cases.
- Reinstall a newer package while the old engine is running; protocol mismatch stays visibly
  preview-only. Confirm that switching input sources alone does not clear the mismatch. Then quit
  VOCO and run `ibus restart`, or sign out and back in, before reopening VOCO and rechecking `Ready`.

## Target Apps

- Text editor.
- Browser textarea.
- Chat input.
- Terminal prompt, as a negative live-cursor case: verify preview-only fallback and ordinary idle
  typing, not direct cursor streaming.

## Pass Criteria

- Existing target-app text outside VOCO's provisional composition range is not deleted.
- Provisional wording and punctuation can revise automatically without user editing.
- Preview agreement alone never turns provisional wording into normal target text.
- Authoritative canonical checkpoints become normal target text at complete 30-second ranges with
  one second of overlap: completion times 30, 59, 88 seconds, and subsequent 29-second strides.
- Each checkpoint is an exact extension of the previously acknowledged target prefix.
- No raw key codes or stray numbers appear.
- Live words continue appearing or VOCO explains that live cursor streaming paused.
- If ownership is unavailable when stable cursor mode is configured, the overlay becomes visible
  for that running session and labels delivery as preview-only.
- Every accepted owned-preedit lease follows a fresh safe content-type report for the exact current
  real focus. Same-context re-entry and synthetic/global proxy focus do not reuse earlier proof.
- Terminal, sensitive, missing-metadata, and ambiguous-metadata targets emit no owned-preedit start,
  update, checkpoint, or final command.
- Live words do not stop merely because the dictation has passed the first preview window.
- Finalization does not duplicate the transcript.
- The final cursor text contains every spoken phrase; `dictation_final_output_unreconciled` is not
  present in a passing direct-cursor run.
- Stop returns VOCO to idle quickly.
- If canonical delivery fails, VOCO preserves the last acknowledged canonical target prefix, clears
  only provisional preedit where it still has ownership, and marks the final as unreconciled. An
  uncertain mutation is never retried or redirected through global insertion.
- After an unreconciled final, the tray reports that the transcript needs attention and the popover
  shows the retained final with a working `Copy transcript` action.
- Cancellation after canonical checkpoints preserves acknowledged canonical target text and clears
  only VOCO's still-provisional preedit tail.
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
- `dictation_canonical_checkpoint_completed`
- `dictation_canonical_checkpoint_committed`
- `dictation_canonical_checkpoint_failed`
- `dictation_canonical_final_completed`
- `dictation_recording_limit_reached`
- `dictation_stop_to_final_transcript`
- `dictation_stop_to_idle`

For a summary with preview p50/p95 and stop timings, run:

```bash
npm run report:cursor-streaming
```

A passing direct-cursor report must not show `final-cursor-output-unreconciled`,
`cursor-streaming-stalled`, or `cursor-streaming-latency-above-target`. Window-advance events
describe provisional preview behavior only. Canonical checkpoint events prove authoritative
progress: cached exact chunks remain final truth, and finalization transcribes only deferred
complete ranges plus the remaining partial range. Preview hypotheses are never substituted for
canonical text.

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
- With Live words at cursor selected, enable transcript enhancement; preview remains in VOCO's
  overlay and only one enhanced final insertion occurs after stop. No canonical checkpoint event is
  emitted.
- Force an uncertain protocol-v3 mutation response in the disposable test environment; VOCO closes
  the private channel, does not retry the mutation, and does not use global insertion.
- With stable cursor mode still selected, make the private engine unavailable before starting. The
  status overlay must appear as soon as ownership fails even though the configured preference would
  normally suppress it. Continue speaking, stop, and verify that the complete final is retained in
  VOCO rather than inserted into whichever field is now focused.
- Open the popover after that unreconciled session, verify the exact retained final is selectable,
  press `Copy transcript`, and compare clipboard text byte-for-byte with the displayed transcript.
- Start a fresh session after recovery and verify the previous `unreconciled` delivery state and
  retained transcript do not contaminate the new recording.

## Tray, Popover, Realtime, and Settings Consistency

Run these cases only in the same disposable desktop environment:

- Verify the tray distinguishes microphone not ready, ready, live cursor needs setup, owned-cursor
  recording, preview-only recording, processing, transcript needs attention, and realtime
  connecting/listening/speaking/error states.
- While dictation is recording or processing, verify realtime start is disabled in the tray and
  rejected by its hotkey. While realtime is active, verify dictation start is disabled and rejected.
- During processing, verify the tray reads `Transcribing…` and does not accept another start.
- Open VOCO from the native menu twice and verify it remains shown. Click the tray icon to exercise
  its separate show/hide toggle.
- Open the popover and verify it does not offer a dictation start action. Confirm its instruction to
  focus a target and use the configured hotkey, then verify `Escape` and focus loss dismiss it.
- Change the dictation hotkey in the native tray menu while Settings is closed. Open Settings and
  verify the new authoritative value appears. Change an unrelated setting and verify it does not
  revert the tray hotkey.
- Issue several setting changes quickly. Reopen Settings and compare every value with
  `${XDG_CONFIG_HOME:-$HOME/.config}/voco/config.json`; final values must reflect issue order, with
  the last issued value for each field and no stale whole-config rollback.

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
  "$HOME/.local/state/voco/debug-captures/dictation-1784040735874.json" \
  "$HOME/.local/state/voco/debug-captures/dictation-1784040735874.wav" \
  "$HOME/.local/share/voco/models/ggml-base.en.bin"
```

Expected hashes, in the same order, are:

```text
8f3f9c3dfebdbeef83d82b54201bef2f479ee4cc7cbfb39843408c178071ef01
558deafbae26a23171d90bc37832b4c36e0f0c9eaac491288f58befc2c4713dd
a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002
```

Stop on any mismatch. Then set both paths explicitly; the replay derives the WAV path from the JSON:

```bash
VOCO_CAPTURE_TIMELINE="$HOME/.local/state/voco/debug-captures/dictation-1784040735874.json" \
VOCO_MODEL_PATH="$HOME/.local/share/voco/models/ggml-base.en.bin" \
npm run test:captured-dictation
```

This pinned 66.5339375-second replay must produce exactly two complete checkpoints plus one partial
final range: `[0, 480000]`, `[464000, 944000]`, and `[928000, 1064543]`. It is automated ASR and
boundary evidence, not a substitute for installed-package target-app QA.

Treat these files as sensitive voice data. Keep them outside Git, share them only with explicit
consent, and delete them after the regression has been reduced to non-audio fixtures:

```bash
rm -rf -- "${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures"
```
