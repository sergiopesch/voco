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
different protocol versions; switch away and back after reinstalling the current package.

One-shot insertion in `Final text only` mode can use `ydotool` or `wl-copy`. Stable cursor mode does
not fall back to these global insertion tools when IBus or preedit support is unavailable; it keeps
the final transcript in VOCO instead.

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
(recommended)`, `Live transcript panel`, and `Final text only`. Cursor mode progressively commits
stable phrases as normal target text so the target field wraps them, while keeping the changing tail
in an engine-owned preedit range. VOCO never reads or deletes surrounding target text: IBus exposes a
cache without a target-bound revision, which is not sufficient proof for destructive replacement.
At stop, VOCO can commit a wholly owned preedit or acknowledge an exact final that needs no target
mutation. If progressively committed text would need revision or a final suffix, or if the session,
focus, cursor context, or ownership changes, VOCO preserves the target and keeps the full-session
final transcript in its UI. Use the transcript panel if a target app does not support input-method
preedit, or final-text-only mode to disable preview transcription.

If words appear initially and then stop, reset the trace, reproduce one dictation, and run:

```bash
npm run reset:cursor-streaming-trace
npm run report:cursor-streaming
```

`cursor-streaming-stalled` means previews continued without safe cursor commits.
`final-cursor-output-unreconciled` means the complete final transcript was preserved in VOCO, but
the normal target-app commits could not be reconciled without rewriting them. Neither status is a
passing cursor run.
A healthy preferred-path trace contains `dictation_owned_preedit_started`, one or more
`dictation_owned_preedit_updated` events, and `dictation_owned_preedit_committed` when final ASR
exactly agrees with the progressively committed text.

Password, PIN, private, and hidden-text fields, clients without preedit support, source changes,
focus changes, cursor context resets, ordinary key input, stale sessions, renderer reloads, target
closure, and app/engine disconnects all invalidate live cursor ownership. VOCO then clears only its
preedit, preserves normal target text, and keeps the authoritative transcript in VOCO.

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
