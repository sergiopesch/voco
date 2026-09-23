# Troubleshooting

## Voice test works, but dictation does not start

On Wayland, the .45 guided installer could skip `ydotool` and `ydotoold` even
though microphone recognition worked. A banner naming `ydotool` is a desktop
input setup failure. Installing the binaries alone is insufficient: the daemon
must run with accessible device and socket permissions for your login. Follow
[Wayland helper setup](platform/README.md#ydotoold-ydotool-daemon).

The .47 installer installs the helpers explicitly and checks desktop input before
saving onboarding completion. After repairing setup, click **Check desktop setup**
and **Done**; the voice test does not need an external text field.
With .47 you can also run `voco --check-desktop-input`. It checks prerequisites
without launching VOCO, recording speech, copying text or sending keystrokes.
A passing check still requires a real dictation trial in your intended application.

**No text cursor available** has a different meaning: click in an accessible text
field before pressing your shortcut. Password fields and unsupported custom editors
remain excluded. VOCO must not record and paste blindly when the target is unknown.

### Ghostty stops before listening

Ghostty 1.3.1 on Linux exposes a focused graphical terminal pane without an accessible
text caret. VOCO .55 rejects that pane before recording; repeating onboarding or
granting microphone access again does not repair this compatibility issue.
The [.56 candidate](releases/2026.0.56.md) adds a distinct focused-pane route and
preserves microphone readiness after a destination rejection. It retains pane
identity and focus-change checks without requiring Ghostty to expose a text caret.
Terminal delivery remains dispatch-only: read-only terminal mode can reject paste,
and VOCO cannot identify every shell password prompt or terminal application mode.

## VOCO records but does not type into the active application

VOCO normally streams NVIDIA recognition through desktop paste.
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

Stop must drain the captured tail before the worker finishes. Regression tests cover this ordering. Normal dictation remains append-only: it does not
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

The Debian package includes a native host and unpacked extension files. Follow
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

## Tray and panel controls disagree

The tray and panel use the same runtime state: microphone readiness, model readiness,
recording, processing and recovery. A recording can always be stopped; a new
recording waits for capture/processing to finish. Retained transcripts remain
available for review. Settings stays available to resolve a configuration problem.

If the two surfaces disagree, collect local diagnostics with the exact package
version and test time. Do not assume a successful key dispatch proves editor delivery.

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
control event. Alt+Shift+R is no longer reserved for a conversation mode.

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

The published Ubuntu/Debian artifact is the GitHub Release `.deb`. Ubuntu is the
primary reference environment; Debian-derived distributions are best-effort.
Fedora, openSUSE and Arch/Omarchy use their separately qualified native packages.
Check [release status](release-candidate.md) and the exact artifact's verification
records for current versions and limits. AppImage, Flatpak, Flathub, Snap and
Ubuntu App Center are not published VOCO release channels.

## No live bars or Listening in the top panel

Run `voco --check-panel`. If disabled, use **Enable live panel** in Help or
run `voco --setup-panel`. If enabled but waiting for a new session, save your work,
sign out and back in. A global Extensions switch or administrator policy is not
changed by VOCO. GNOME versions other than 46 use the native tray fallback.
The fallback menu always contains the current status; adjacent labels depend on
the desktop. Disabling the companion restores the native tray.

## Opening VOCO again does nothing

The launcher asks the existing app to present its current idle window. It does
not launch another recognizer or interrupt a recording. Finish dictation first if
VOCO is Listening or Finishing. After upgrading while an older app is still
running, quit that app through its tray and reopen VOCO once. Do not kill an app
that has an unfinished recording or recovery you need.

Completing onboarding leaves Ready visible. The worker from your voice
test remains warm; completing setup does not start a second model process.
