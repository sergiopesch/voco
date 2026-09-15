# Troubleshooting

## VOCO records but does not type into the active application

The current candidate normally streams NVIDIA recognition through desktop paste.
First verify the complete package and worker identity: a base Tauri package lacks the
NVIDIA payload. Inspect old launcher overrides, especially `VOCO_STREAM_WORKER`,
`VOCO_DESKTOP_PASTE=0` and `VOCO_DESKTOP_STREAM=0`. Keep the intended editable field
focused, check helper availability, and review local app/worker diagnostics.

A successful recognizer response or key dispatch does not prove that the target accepted
text. Open VOCO recovery and inspect the destination before copying: some words may
already have arrived. Do not repeatedly replay an uncertain insertion. The optional
Chromium exact-field adapter uses a separate contract; IBus remains shortcut-only.

## Spaces appear as the letter S

The .37+local2 candidate used the wrong separator name for legacy ydotool 0.1.x.
The fixed revision passes a literal space; modern ydotool uses keycode 57 and
xdotool uses its `space` keysym. Verify the installed and running revision before
testing. Do not remap S or change recipient-app shortcuts to work around this bug.

## Final words or punctuation need review

Stop must drain the captured tail before the worker finishes. The final candidate
regressions cover this ordering. Normal dictation remains append-only: it does not
rewrite previously inserted sentences after Stop. A good transcript in one test
does not establish punctuation quality across voices and speaking styles. Keep
recognition accuracy, exact delivery and whole-message refinement separate.

## The tray says Review Transcript instead of Start Dictation

A manual transcript is still pending. Choose `Review Transcript` to open it, then use
`Copy transcript` and paste your text where you need it. Copying keeps the transcript in VOCO;
choose `Clear transcript` when you are ready for another recording. A failed clipboard write
leaves the transcript available and displays the error. Clearing VOCO's transcript does not
clear the clipboard.

If a cancelled or failed recording has recovery available, the tray instead offers
`Review Recording`. Open it to retry transcription or explicitly discard that recovery.

The review action opens the panel without starting or stopping capture. It remains available
if microphone access becomes unavailable or settings need repair. Switching to another app
hides the popover but retains the text; `Review Transcript` opens it again. A pending focus
query from an older event cannot dismiss a panel after a newer focus observation.

## Set up exact-field Chromium dictation

The development Debian candidate includes a native host and unpacked extension files. Follow
[installation](install.md) for explicit browser setup; building the package does not activate an
extension in the current profile. Once enabled, click the extension action to authorize the tab,
focus an eligible plain-text input or textarea, and use `Alt+Shift+V` to start and stop. The ordinary
VOCO hotkey uses the separate native desktop-paste route.

The extension requires a collapsed selection and a supported editable control. Password/recognized-sensitive
controls, rich editors, unsupported frames, disabled/read-only inputs and fields marked private
are unavailable. Switching fields, leaving and returning, navigation, element replacement, user
edits or selection changes revoke the current authorization. Enable/start a new session deliberately;
the old token cannot authorize a different field.

If the extension cannot connect, check that the native host is present and the packaged manifest
matches the installed extension identity. Chrome and Chromium use different native-host manifest
locations. A missing private `XDG_RUNTIME_DIR`, wrong ownership or public socket permissions causes
the broker to reject the connection. Do not weaken permissions to bypass this check. See
[broker acceptance](testing/browser-broker.md) for paths and protocol details.

A cold or blocked browser/app can outlast the two-second trigger or request deadline. The result
then stays in VOCO. Requests have a short recipient-side expiry checked after page hooks, so delayed
work is rejected under the shared host clock assumption; arbitrary wall-clock rollback is not
covered. No automatic retry is performed after an uncertain result. Review any text already in the
field before copying a retained transcript, because uncertainty does not prove that nothing landed.

The adapter uses direct mutation of the captured element. Browser native undo may not include these
writes; do not assume undo support or rich-editor compatibility from a successful plain-text test.

## Live preview appears only in VOCO

Check whether the active session has desktop streaming enabled and transcript enhancement
off. Stop-only delivery may reflect configuration or an unavailable streaming worker.
Use `report-speech-performance.py` for recognition/startup timing and worker failure
stages. A `first_hypothesis` event is not a visible-field receipt. Whole-message
post-Stop rewrite is not implemented by the generic desktop route.

For exact-field Chromium sessions, invalidated ownership retains recovery without
retargeting or automatic fallback. Do not confuse those recipient receipts with native
paste-dispatch success.

For a controlled development reproduction, use:

```bash
npm run reset:cursor-streaming-trace
npm run report:cursor-streaming
```

A trace without a validated recipient receipt is not proof of exact-field delivery. Short final
fixtures do not establish sustained rolling checkpoint coverage. Keep audio/transcript diagnostics
private and distinguish synthetic isolated tests from physical microphone acceptance.

## IBus shortcut source is missing or outdated

The optional `VOCO Dictation` source can supply consuming recording shortcuts. It is not an
insertion prerequisite. Native/engine protocol v5 rejects all legacy composition and text mutation
operations. An older resident engine cannot be made safe merely by changing output mode; use the
matching updated application and engine package.

If you explicitly use the source and have installed a protocol upgrade, quit VOCO and restart IBus
or sign out and back in before reopening. Switching sources alone does not reliably reload the
resident engine. VOCO itself never changes or restarts the active source. No desktop service restart
is needed just to copy a transcript or refresh VOCO's panel.

Legacy ydotool/xdotool/clipboard helper setup is documented separately in
[platform support](platform/README.md). The native desktop route uses these helpers; the separate explicit Copy path does
not require input injection. Do not change input-group membership without understanding
the broader keyboard-device access it grants.

## Tray, popover, dictation, and realtime controls disagree

The tray is derived from one runtime snapshot containing runtime initialization, microphone
readiness and permission, dictation phase, live-cursor delivery/setup, realtime phase, and mute
state. Expected behavior includes:

- `Transcribing…` is disabled while a final is processing.
- `Review Transcript` replaces `Start Dictation` while an idle manual transcript is pending.
  Reviewing text does not require microphone permission and never starts a recording.
- `Review Recording` opens retained recovery after cancellation or failure, including recordings
  that have no completed transcript yet.
- Realtime cannot start during recording or processing, and dictation cannot start while realtime
  is connecting, listening, or speaking.
- A muted realtime session uses the neutral graphite icon and an explicit `Realtime voice muted`
  label. It remains active, and `Stop Realtime Voice` remains available.
- Known-denied microphone permission is a needs-attention state. New dictation and realtime starts
  stay disabled until microphone access is retried from Settings.
- During initialization or a blocking configuration error, the command popover cannot open or
  start a new realtime session. An already-active realtime session can still open the popover to
  stop safely, and retained transcripts or recordings remain available for review after initialization.
  Settings remains available after initialization so configuration can be repaired.
- `Open VOCO` shows the popover; clicking the tray icon again may hide it.
- The popover deliberately has no dictation start button. Opening a focusable panel would move focus
  away from the target, so focus the text field and use the configured hotkey.
- `Escape` or focus loss hides the popover.

If stale state remains after an operation has completed, reopen Settings and press `Refresh runtime
checks`. Do not restart desktop services solely to refresh the panel; reserve `ibus restart` or a
sign-out/in for an actual engine protocol upgrade.

## A hotkey or setting changes back unexpectedly

Settings and native-tray hotkey changes use the same serialized field-patch writer. The backend
reloads the latest config for every patch, saves it atomically, and returns and broadcasts the
authoritative result to the frontend. Opening Settings or the popover refreshes that state again.
This prevents an older full settings object from overwriting an independent tray change.

If the persisted value is still wrong, close any external editor that is writing the file while
VOCO is running, make the change once in VOCO, and inspect:

```bash
sed -n '1,240p' "${XDG_CONFIG_HOME:-$HOME/.config}/voco/config.json"
```

Do not include that file in a public bug report without reviewing it for local endpoints, model
names, agent names, and other personal configuration.

Custom dictation shortcuts must include Alt, Control, or Super plus a main key. Bare keys and
Shift-only combinations are rejected because they would turn ordinary typing into a dictation
control event. `Alt+Shift+R` remains reserved for realtime voice.

## VOCO says local settings need attention

VOCO pauses dictation when `config.json` cannot be parsed or cannot pass its ownership, file-type,
or permission checks. The recovery panel offers three explicit choices:

- correct the file and choose `Retry loading settings`; VOCO validates and applies the repaired
  hotkey before accepting the new configuration
- choose `Open config directory` to inspect the local entry
- choose `Reset to defaults`, then confirm; VOCO preserves the previous entry as a uniquely named
  `config.recovery-backup-*.json` item before writing private defaults

Do not replace the VOCO config directory with a symlink. If the directory itself fails the safety
check, repair `${XDG_CONFIG_HOME:-$HOME/.config}/voco` as a real directory owned by your user with
mode `0700`, then retry. Config files are normalized to mode `0600`.

## Missing X11 insertion helpers

Missing `xdotool` or `xclip` can block the native X11 desktop route before capture.
Check the selected helper and runtime report. Explicit Copy and exact-field browser
delivery are separate paths; installing a helper does not prove target consumption.

## VOCO says the microphone is not ready

- confirm your microphone is available in the system sound settings
- confirm PipeWire or PulseAudio is running
- restart VOCO after granting microphone access

## VOCO shows a microphone level that feels too high or too low

- treat the onboarding meter as a visual confidence check, not a calibrated input meter
- test at silence first, then while speaking at a normal distance from the microphone
- if the bar stays high at rest, reopen the setup flow after confirming the correct input device is selected
- if the bar barely moves while speaking, check system input gain in your desktop sound settings before retesting

## VOCO says complete audio capture cannot be confirmed

VOCO keeps the audio it received and stops automatic output. Choose **Retry
transcription** to review that audio locally, then copy the result explicitly, or
choose **Discard recovery**. Retrying cannot reconstruct missing audio; check the
ending and any interrupted words before using the transcript. The notice remains
after Retry so that a readable result is not mistaken for confirmed capture.

This can occur when the audio engine does not acknowledge its final samples or
when AudioWorklet initialization fails and the compatibility capture path is
used. The latter always requires manual review because its callback API cannot
confirm a complete recording. Discarding recovery and starting again resets the
session; a healthy AudioWorklet session resumes normal operation. Neither action
changes your selected microphone or input settings.

## Old Voice install settings did not appear

VOCO attempts to migrate:

- `~/.config/voice/config.json`
- `~/.local/share/voice/models/`

If the migration did not happen automatically, copy those files into the `voco` paths manually and restart the app.

## Trigger VOCO manually through the socket

```bash
SOCKET_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}/voco-$(id -u)}"
socat - UNIX-CONNECT:"${SOCKET_DIR}/voco.sock" < /dev/null
```

## Capture Linux runtime details for a bug report or release check

```bash
npm run report:linux-runtime
```

## Supported release channels

The published binary artifact is the GitHub Release `.deb`. Ubuntu is the primary reference
environment; Debian-derived distributions are best-effort. AppImage publication is paused until its
complete packaging toolchain is pinned; local experimental AppImages do not install desktop/browser
registration files. The private NVIDIA candidate is `2026.0.37+local6`; the owner
still has `+local3` installed. Check [current candidate gates](release-candidate.md)
and the exact artifact's external receipts before testing; this documentation does
not authorize installation or publication. Flatpak, Flathub, Snap, and Ubuntu App Center are not published VOCO release channels.
