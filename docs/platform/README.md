<!-- markdownlint-disable MD031 MD032 MD060 -->
# Platform Support

## Supported Platforms

| Platform         | Status      | Notes                                            |
| ---------------- | ----------- | ------------------------------------------------ |
| Ubuntu (X11)     | Tested      | xdotool for text insertion                       |
| Ubuntu (Wayland) | Tested      | ydotool for text insertion, clipboard fallback   |
| Debian-derived   | Best-effort | Likely to work, not regularly tested             |
| Other Linux      | Experimental | May work, not supported                          |
| macOS            | Not targeted | Not in scope                                     |
| Windows          | Not targeted | Not in scope                                     |

## Requirements

- Tauri runtime dependencies: libwebkit2gtk-4.1, libgtk-3, libayatana-appindicator3
- Node.js 20+ and Rust (for building from source)
- PulseAudio or PipeWire for microphone access
- xdotool + xclip (X11) or ydotool + wl-clipboard (Wayland) for text insertion
- No root privileges needed for normal operation

## Session Detection

The app detects session type via `XDG_SESSION_TYPE`:

- `x11` -> use xdotool for text insertion
- `wayland` -> use ydotool, with clipboard insertion still relying on ydotool for the paste gesture
- Desktop environment detected via `XDG_CURRENT_DESKTOP`

Hotkey backend selection:

- Wayland + `Alt+D` / `Alt+Shift+D` -> evdev hotkey backend (preferred)
- Other combinations -> Tauri global-shortcut backend
- Runtime hotkey changes update backend preference immediately
- Settings -> Advanced shows the detected session and whether insertion helpers are currently available

## Wayland Caveats

- ydotool works via uinput (kernel-level, compositor-independent)
- Requires user in `input` group: `sudo usermod -aG input $USER` (then log out and back in)
- Clipboard fallback uses wl-copy + ydotool Ctrl+V simulation
- Behaviour may vary by compositor (GNOME, KDE, Sway)

### ydotoold (ydotool daemon)

ydotool v1.0+ requires the `ydotoold` daemon to be running. On older versions (0.x), ydotool communicates with uinput directly.

**Check if ydotoold is needed:**
```bash
ydotool type "test"  # If this errors with "socket not found", you need ydotoold
```

**Start ydotoold:**
```bash
# One-time (current session)
ydotoold &

# Persistent (systemd user service, if available)
systemctl --user enable --now ydotoold
```

**If ydotoold is not available as a service:**
```bash
# Add to ~/.bashrc or ~/.profile for auto-start
pgrep -x ydotoold > /dev/null || ydotoold &
```

**Troubleshooting:**
- `Permission denied`: ensure user is in `input` group and has uinput access
- `Socket not found`: ydotoold is not running — start it manually
- In `auto` mode, VOCO falls back to clipboard insertion if direct typing fails
- In strict `type-simulation` mode, VOCO reports the failure instead of touching the clipboard

## X11

- xdotool works via X11 protocol (compositor-independent)
- No special group membership needed
- Clipboard fallback uses xclip + xdotool Ctrl+V simulation

## Known Limitations

- Wayland text insertion depends on compositor support for uinput
- Flatpak may require portal permissions for mic access
- Some Wayland compositors block simulated input
- First launch requires internet for model download (~142 MB)
- AppImage bundling still depends on Tauri/linuxdeploy behaviour, though the repo now falls back to `scripts/package-appimage.sh` when `VOCO.AppDir` exists

## Packaging

| Format   | Status         | Notes                                                                 |
| -------- | -------------- | --------------------------------------------------------------------- |
| .deb     | Working        | Built via `./scripts/setup.sh --install` or GitHub Releases           |
| .rpm     | Not configured | Can be added to tauri.conf.json targets                               |
| AppImage | Working        | Release workflow attempts Tauri bundling and falls back to repo helper |

## Data Locations

| Data   | Path                             |
| ------ | -------------------------------- |
| Config | `~/.config/voco/config.json`     |
| Models | `~/.local/share/voco/models/`    |
| Socket | `$XDG_RUNTIME_DIR/voco.sock` or `${TMPDIR:-/tmp}/voco-$(id -u)/voco.sock` |
