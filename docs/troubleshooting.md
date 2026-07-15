# Troubleshooting

## VOCO does not type text on Wayland

Open Settings -> Advanced and press `Refresh runtime checks` first. VOCO should report a Wayland
session and show whether Automatic live cursor is ready. Its preferred path requires the Debian
package's persistent IBus component and the system Python GI bindings:

```bash
sudo apt install ibus gir1.2-ibus-1.0 python3-gi
dpkg-query -W voco
```

Open the desktop Keyboard or Region & Language settings, add `VOCO Dictation` under Input Sources,
and select it before focusing the target text field. Sign out and back in if the source is not
listed immediately after package installation. VOCO never changes the active source itself. Its
persistent engine passes normal keys through while idle and accepts dictation only through an
owner-only runtime socket from the VOCO app.

`Input source not installed` means the system component is absent (including an AppImage-only or
uninstalled source run). `Input source not enabled` means the package is present but the engine is
not selected/running. `Package refresh required` means the app and still-running engine use
different private protocol versions. Canonical checkpoints require protocol v3 on both sides. To
load the upgraded engine:

1. Quit VOCO.
2. Run `ibus restart` and reopen VOCO, or sign out and back in and then reopen VOCO.
3. Select `VOCO Dictation`, focus a normal text field, and try again.

Switching away from and back to the input source alone is insufficient because it does not reliably
replace the resident IBus engine process.

One-shot insertion in `Final text only` mode can use `ydotool` or `wl-copy`. Stable cursor mode does
not fall back to these global insertion tools when IBus or preedit support is unavailable. Instead,
the current session becomes a visible preview in VOCO's overlay. On stop, VOCO leaves unverified
target text unchanged, retains the final transcript, marks the tray as needing attention, and offers
`Copy transcript` in the popover.

Check that `ydotool` and `wl-clipboard` are installed and that your user is in the `input` group.

```bash
sudo apt install ydotool wl-clipboard
sudo usermod -aG input "$USER"
```

Then log out and back in.

If `ydotool` v1.x reports a missing socket, start `ydotoold` and refresh runtime checks:

```bash
systemctl --user enable --now ydotoold
```

Open Settings -> Output & local model -> Live cursor mode to switch between `Live words at cursor
(enhancement off)`, `Live transcript panel`, and `Final text only`. With transcript enhancement off,
cursor mode keeps rolling preview wording inside an engine-owned, revisable preedit. Preview phrases
do not become normal target text merely because repeated previews agree. Separate authoritative
30-second chunks overlap by one second and checkpoint exact canonical suffixes at 30, 59, 88
seconds, and so on. At stop, cached exact chunks remain final truth and VOCO transcribes only
deferred complete work plus the remaining canonical range.

VOCO never reads or deletes surrounding target text. Each protocol-v3 checkpoint verifies the exact
previously acknowledged canonical prefix before appending. If the session, focus, cursor context, or
ownership changed, the command is rejected. If a mutating IPC result is uncertain, VOCO closes the
channel and never retries or switches to global insertion because it cannot know whether the first
command landed.

When transcript enhancement is enabled, live preview stays in VOCO's overlay and the enhanced final
is inserted once after stop. This avoids mixing an enhanced final with unenhanced canonical
checkpoints. Use `Live transcript panel` when a target app does not support input-method preedit, or
`Final text only` to disable preview transcription.

If words appear initially and then stop, reset the trace, reproduce one dictation, and run:

```bash
npm run reset:cursor-streaming-trace
npm run report:cursor-streaming
```

`cursor-streaming-stalled` means previews continued without canonical target checkpoints.
`final-cursor-output-unreconciled` means VOCO could not prove exact canonical delivery to the owned
target. Neither status is a passing cursor run.
A healthy preferred-path trace contains `dictation_owned_preedit_started`, one or more
`dictation_owned_preedit_updated` events, `dictation_canonical_checkpoint_completed` and
`dictation_canonical_checkpoint_committed` for every complete boundary reached, and
`dictation_canonical_final_completed` after the stop-time remainder.

Terminals, password/PIN fields, private or hidden-text fields, clients without preedit support, and
targets with missing or ambiguous content metadata are never eligible for live cursor streaming.
Source changes, focus changes, cursor context resets, ordinary key input, stale sessions, renderer
reloads, target closure, and app/engine disconnects also invalidate live cursor ownership. VOCO then
clears only its preedit, preserves acknowledged canonical target text, and reports the canonical
final as unreconciled. It does not retry the failed checkpoint in another field. Open VOCO from the
tray and use `Copy transcript` to recover the retained final safely.

Each real focus entry must freshly establish safe, non-sensitive content metadata for that exact
input context. Focus loss clears the proof even if the same app or context identity returns, and a
synthetic global-engine proxy cannot establish or renew it. Some toolkits report only ambiguous
`FREE_FORM`/no-purpose metadata or do not send a fresh content-type callback after focus; those
contexts deliberately remain preview-only. This is a fail-closed limitation rather than a hidden
mode change.

IBus 1.5 global-engine mode suppresses a repeated content tuple. As a result, two consecutive
focuses with the same purpose and hints do not provide fresh proof to VOCO, even if both are normal
fields; the later focus is preview-only until it reports a changed, explicit safe tuple. A generic
`FREE_FORM`/no-hint field is ambiguous from its first report and remains preview-only. Use the
visible VOCO preview, then `Copy transcript`, or choose `Live transcript panel`/`Final text only`
before the next dictation when that application does not expose usable metadata.

## Live words are configured but only the VOCO overlay appears

This is the intentional runtime-owned fallback, not a silent mode change. The saved setting still
describes the preferred mode, while the overlay describes what this session can safely deliver. It
appears when VOCO cannot establish or keep a verified lease on the focused target, including when:

- `VOCO Dictation` is missing, inactive, or running an incompatible protocol version
- the exact current focus has not freshly established a safe, non-sensitive input-method preedit
- the target is a terminal, sensitive field, or reports missing/ambiguous content metadata
- focus, selection, cursor context, or ordinary key input invalidates the lease
- the app and engine disconnect or a mutating response becomes uncertain

Continue speaking if you want the transcript. After stop, the tray reports `Transcript needs
attention`; open the popover and choose `Copy transcript`. VOCO does not redirect the result to the
currently focused app because that could be a different field. For intentional one-shot insertion,
choose `Live transcript panel` or `Final text only` before starting the next dictation.

## Tray, popover, dictation, and realtime controls disagree

The tray is derived from one runtime snapshot containing runtime initialization, microphone
readiness and permission, dictation phase, live-cursor delivery/setup, realtime phase, and mute
state. Expected behavior includes:

- `Transcribing…` is disabled while a final is processing.
- Realtime cannot start during recording or processing, and dictation cannot start while realtime
  is connecting, listening, or speaking.
- A muted realtime session uses the neutral graphite icon and an explicit `Realtime voice muted`
  label. It remains active, and `Stop Realtime Voice` remains available.
- Known-denied microphone permission is a needs-attention state. New dictation and realtime starts
  stay disabled until microphone access is retried from Settings.
- During initialization or a blocking configuration error, the command popover cannot open or
  start a new realtime session. An already-active realtime session can still open the popover to
  stop safely. Settings remains available after initialization so configuration can be repaired.
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

## VOCO does not type text on X11

Open Settings -> Advanced and press `Refresh runtime checks` first. VOCO should report `X11 or other` and show whether `xdotool` or `xclip` are missing.

Install the X11 helpers:

```bash
sudo apt install xdotool xclip
```

## VOCO says the microphone is not ready

- confirm your microphone is available in the system sound settings
- confirm PipeWire or PulseAudio is running
- restart VOCO after granting microphone access

## VOCO shows a microphone level that feels too high or too low

- treat the onboarding meter as a visual confidence check, not a calibrated input meter
- test at silence first, then while speaking at a normal distance from the microphone
- if the bar stays high at rest, reopen the setup flow after confirming the correct input device is selected
- if the bar barely moves while speaking, check system input gain in your desktop sound settings before retesting

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
complete packaging toolchain is pinned; local experimental AppImages do not install the host IBus
component. Flatpak, Flathub, Snap, and Ubuntu App Center are not published VOCO release channels.
