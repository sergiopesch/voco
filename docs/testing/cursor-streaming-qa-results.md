# Cursor Streaming QA Results

Use this file to record the release-candidate evidence for
[cursor-streaming-manual-qa.md](./cursor-streaming-manual-qa.md).

## Build Under Test

- VOCO version: 2026.0.16
- Build source: local workspace release build
- Launcher path: `$HOME/.local/bin/voco`
- Binary path: `$HOME/.local/bin/voco-bin`
- Binary SHA-256: `90af41edea207d8cc233738c8ff9dba97e6060e62686d9ac552ce80ac5c57d3b`
- Date: 2026-06-08

Current build validation:

```text
npm run build -w apps/desktop
status: passed
detail: release binary built at apps/desktop/src-tauri/target/release/voco; Tauri linuxdeploy
bundle step failed, then scripts/package-appimage.sh produced
apps/desktop/src-tauri/target/release/bundle/appimage/VOCO-2026.0.16-x86_64.AppImage

sha256sum apps/desktop/src-tauri/target/release/voco
90af41edea207d8cc233738c8ff9dba97e6060e62686d9ac552ce80ac5c57d3b

sha256sum $HOME/.local/bin/voco-bin
90af41edea207d8cc233738c8ff9dba97e6060e62686d9ac552ce80ac5c57d3b

desktop-file-validate $HOME/.local/share/applications/VOCO.desktop
status: passed
```

## Runtime

Paste the output of:

```bash
npm run report:linux-runtime
```

Current evidence:

```text
VOCO Linux runtime report

Timestamp                2026-06-08T16:22:34+01:00
Distro                   Ubuntu 24.04.4 LTS
Kernel                   Linux 6.17.0-1025-oem x86_64 GNU/Linux
Desktop                  ubuntu:GNOME
Session                  wayland
Display server           wayland-0
Runtime dir              /run/user/1000
Socket path              /run/user/1000/voco.sock
Input group              yes

ydotool                  /usr/bin/ydotool
ydotoold                 active
wl-copy                  /usr/bin/wl-copy
wl-paste                 /usr/bin/wl-paste
xdotool                  missing
xclip                    missing
```

## Trace Reset

Current reset evidence:

```text
VOCO cursor streaming trace reset

Trace file: $HOME/.local/state/voco/hotkey-trace.jsonl
Archived previous trace: $HOME/.local/state/voco/hotkey-trace.2026-06-08T152359657Z.jsonl
status: reset-ready
```

## Baseline Config

Paste the output of:

```bash
npm run report:dictation-baseline
```

Current baseline evidence:

```text
VOCO dictation baseline config report

Config file: $HOME/.config/voco/config.json
status: baseline-ready
detail: cursor target, stable cursor streaming, and enhancement-off baseline are configured

Required baseline settings
transcriptTarget: ok (actual=cursor, expected=cursor)
liveCursorMode: ok (actual=stable-cursor-streaming, expected=stable-cursor-streaming)
transcriptEnhancement: ok (actual=off, expected=off)
```

## Automated Validation

Current evidence from 2026-06-08:

```text
npm run check
status: passed

npm test
status: passed
detail: report script tests passed; Vitest 14 test files, 99 tests passed

npm run lint
status: passed

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
status: passed
detail: 63 Rust tests passed

cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
status: passed

npm run verify:versions
status: passed
detail: version metadata is consistent at 2026.0.16
```

## Timing Report

Paste the output of:

```bash
npm run report:cursor-streaming
```

For each duration case, also paste the matching thresholded report:

```bash
npm run report:cursor-streaming -- --min-duration-ms 10000
npm run report:cursor-streaming -- --min-duration-ms 60000
npm run report:cursor-streaming -- --min-duration-ms 300000
npm run report:cursor-streaming -- --min-duration-ms 600000
```

For final-only long dictation, paste the matching final-only report:

```bash
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 60000
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 300000
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 600000
```

Current timing evidence:

```text
VOCO cursor streaming trace report

Trace file: $HOME/.local/state/voco/hotkey-trace.jsonl
Entries read: 174
Latest completed dictation session: 1
Reported dictation session scope: 1

Evidence status
status: dictation-session-observed
detail: 1 completed session(s), 1 final output event(s), 1 first live text event(s), 26 live cursor update event(s), 52 live preview event(s), 1 overlay fallback event(s), 0 live preview fallback event(s), 1 non-destructive final fallback event(s)

Timing events
event,count,min,p50,p95,max
dictation_recording_duration,1,123185ms,123185ms,123185ms,123185ms
dictation_first_live_text_visible,1,6665ms,6665ms,6665ms,6665ms
dictation_live_preview_completed,52,1023ms,1073ms,1311ms,2112ms
dictation_stop_to_final_transcript,1,9488ms,9488ms,9488ms,9488ms
dictation_stop_to_idle,1,9740ms,9740ms,9740ms,9740ms

Notable events
recording_get_user_media_constraints_fallback: 0
recording_get_user_media_default_fallback: 0
dictation_live_cursor_insert_updated: 26
dictation_live_cursor_insert_failed: 0
dictation_live_cursor_unsafe_rewrite_blocked: 1
dictation_live_cursor_overlay_fallback: 1
dictation_live_cursor_final_unreconciled: 1
dictation_final_output_completed: 1
dictation_final_insertion_failed: 0
dictation_live_preview_failed: 0
dictation_live_cursor_commit_waiting: 14
```

This trace contains one completed stable-cursor dictation session of about 123 seconds. It proves
privacy-safe timing, continued preview activity, continued cursor update activity, final output
completion, and return to idle. It does not by itself prove that every visible target-app case in
the manual matrix passed.

Current threshold evidence:

```text
npm run report:cursor-streaming -- --min-duration-ms 10000
status: dictation-session-observed
detail: 1 completed session(s), 1 final output event(s), 1 first live text event(s), 26 live cursor update event(s), 52 live preview event(s), 1 overlay fallback event(s), 0 live preview fallback event(s), 1 non-destructive final fallback event(s)

npm run report:cursor-streaming -- --min-duration-ms 60000
status: dictation-session-observed
detail: 1 completed session(s), 1 final output event(s), 1 first live text event(s), 26 live cursor update event(s), 52 live preview event(s), 1 overlay fallback event(s), 0 live preview fallback event(s), 1 non-destructive final fallback event(s)

npm run report:cursor-streaming -- --min-duration-ms 300000
status: recording-duration-too-short
detail: 1 completed session(s), but longest recording duration was 123185ms below required 300000ms
```

Current final-only threshold evidence:

```text
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 60000
status: final-only-live-events-observed
detail: 80 live preview/cursor/fallback event(s) observed during final-only validation
```

The current trace passes the 10-second and 1-minute stable-cursor streaming duration gates. It does
not prove the 5-minute or 10-minute gates yet. The final-only report fails correctly because this
trace contains live preview and cursor events; final-only validation must be run against a fresh
final-text-only trace. During manual QA, each duration case must pass with its own minimum-duration
threshold and expected mode before the result can be treated as proven.

## Manual Matrix

| Case | Target app | Result | Notes |
| --- | --- | --- | --- |
| Empty field, short sentence | Text editor | Pending | Requires visible target-app QA |
| Empty field, 20-30 second paragraph | Text editor | Pending | Requires visible target-app QA |
| Existing text before cursor | Text editor | Pending | Requires visible target-app QA |
| Existing text after cursor | Text editor | Pending | Requires visible target-app QA |
| Cursor in middle of paragraph | Text editor | Pending | Requires visible target-app QA |
| Double `Alt+D` | Text editor | Pending | Requires visible target-app QA |
| Stop while preview is in flight | Text editor | Pending | Requires visible target-app QA |
| Speak, pause, continue | Text editor | Pending | Requires visible target-app QA |
| Punctuation-heavy dictation | Text editor | Pending | Requires visible target-app QA |
| Whisper-revised phrase | Text editor | Pending | Requires visible target-app QA |
| Browser textarea | Browser | Pending | Requires visible target-app QA |
| Chat input | Chat app/input | Pending | Requires visible target-app QA |
| Terminal prompt where safe | Terminal | Pending | Requires visible target-app QA |

## Pass/Fail Summary

- Existing text deleted: Pending manual QA
- Raw key codes or stray numbers: Pending manual QA
- Duplicate final transcript: Pending manual QA
- Live words stopped without trace explanation: Pending manual QA
- Stop returned to idle quickly: Pending manual QA
- Final text acceptable: Pending manual QA
