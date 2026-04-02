# Troubleshooting

## VOCO does not type text on Wayland

Check that `ydotool` and `wl-clipboard` are installed and that your user is in the `input` group.

```bash
sudo apt install ydotool wl-clipboard
sudo usermod -aG input "$USER"
```

Then log out and back in.

## VOCO does not type text on X11

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
socat - UNIX-CONNECT:$XDG_RUNTIME_DIR/voco.sock < /dev/null
```
