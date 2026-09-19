<!-- markdownlint-disable MD031 MD032 MD060 -->
# Platform Support

## Supported Platforms

| Platform         | Status            | Notes                                        |
| ---------------- | ----------------- | -------------------------------------------- |
| Ubuntu (X11)     | Reference target  | Candidate-specific desktop evidence required |
| Ubuntu (Wayland) | Primary reference | Candidate-specific desktop evidence required |
| Debian-derived   | Best-effort       | Likely to work, not regularly tested         |
| Other Linux      | Experimental      | May work, not supported                      |
| macOS            | Not targeted      | Not in scope                                 |
| Windows          | Not targeted      | Not in scope                                 |

## Requirements

- Tauri runtime dependencies: libwebkit2gtk-4.1, libgtk-3, libayatana-appindicator3
- Node.js 20+ and Rust (for building from source)
- PulseAudio or PipeWire for microphone access
- Complete NVIDIA candidate for local CPU streaming; ordinary desktop output uses clipboard paste with best-effort focus guards
- Optional exact-field Chromium extension/native host provides a separate supported-field contract
- xdotool + xclip (X11); ydotool plus xclip on the GNOME XWayland bridge or wl-copy elsewhere (Wayland) for native desktop delivery
- No root privileges needed for normal operation

## Session Detection

The app detects session type via `XDG_SESSION_TYPE`. Native delivery uses the selected
desktop helpers and retains recovery on failure. Session type alone establishes no
target identity or delivery proof. Browser output has an independent exact-element
contract. Helper selection includes:

- `x11` -> use xdotool for native desktop insertion
- `wayland` -> use ydotool for native desktop insertion, including its clipboard paste gesture
- Desktop environment detected via `XDG_CURRENT_DESKTOP`

Hotkey backend selection:

- Selected, eligible IBus context -> consuming shortcut backend with expiring registration
- Wayland + `Alt+D` / `Alt+Shift+D` -> passive evdev fallback, suppressed while IBus is armed
- Other combinations -> Tauri global-shortcut fallback
- Runtime hotkey changes update backend preference immediately
- Settings -> Advanced shows the detected session and whether insertion helpers are currently available. Presence is a prerequisite, not proof of delivery to a target.
- The evdev fallback tracks left/right Alt, Shift, Control, and Super independently for each open keyboard. Extra Control/Super modifiers reject the default matches; repeats do not retrigger. Disconnect clears only that device's state, and reopening revalidates capabilities and the virtual-device exclusion before synchronizing currently held keys. Dropped kernel events suppress activation until the stream has been resynchronized; synthetic recovery never triggers a hotkey.
- Native IBus, global-shortcut, evdev and external socket triggers use the configured desktop output route.
  Protocol-v5 IBus text operations are disabled even for apparently safe metadata.
- The browser extension uses `Alt+Shift+V` after the user enables it in a tab. It addresses the
  captured plain-text DOM element; no global shortcut grab or IBus insertion is used for this route.
- Native GTK/WebKit tests demonstrated a shared-context wrong-target failure, including controls
  with identical cursor rectangles. Earlier successful GTK delivery tests do not authorize broad
  application support. IBus mutation-rejection tests still require zero toolkit mutations; the separately
  enabled native paste fixture asserts its own intended delivery.
- Physical-key matching does not establish support for desktop remapping, AltGr layouts, lock/unlock, or every compositor. These require candidate-specific desktop evidence.

## Compatibility Helper Caveats on Wayland

Native desktop paste needs working input/clipboard helpers; the exact-field browser
adapter and explicit Copy use different contracts. Do not add broad input privileges
merely to copy a transcript. Installed physical Wayland qualification remains pending.

- ydotool works via uinput (kernel-level, compositor-independent)
- Device/daemon access depends on host setup; evdev access commonly uses the `input` group. Membership grants broad keyboard-device access and is not required just for explicit Copy
- Explicit clipboard insertion uses wl-copy + ydotool Ctrl+V simulation. It replaces the clipboard with the transcript and leaves it there; helper APIs cannot safely restore clipboard ownership or all MIME formats.
- Behaviour may vary by compositor (GNOME, KDE, Sway)

### ydotoold (ydotool daemon)

VOCO requires a running `ydotoold` for automatic Wayland paste, including when
using the legacy 0.1.x client. The persistent virtual device avoids per-command
creation delays. Modern clients also require access to the daemon socket.

Ubuntu 24.04 provides the client and daemon separately:

```bash
sudo apt install ydotool ydotoold
```

This installs the tools; it does not guarantee an active service. Check without
injecting keys into the current application:

```bash
command -v ydotool ydotoold
pgrep -x ydotoold
systemctl --user status ydotoold
```

Use your distribution's packaged service when available and its documented socket
permissions. VOCO's session must be able to reach that socket; an arbitrary daemon
running as another user is not proof of access. Where no service exists, the daemon
needs narrowly scoped access to `/dev/uinput` and a service managed for your login.
Do not add it blindly to shell startup files or grant all keyboard-device access.
The package deliberately does not change system device permissions.

`Permission denied` indicates device/socket access needs configuration. `Socket
not found` indicates an unavailable daemon or a mismatched socket path. After
setup, use a disposable text field to verify actual delivery. Settings diagnostics
check prerequisites; only that destination test proves the complete path.

A failed or timed-out helper may already have typed a prefix. VOCO retains uncertain
output for explicit review and never retries the whole transcript automatically.

## Compatibility Helpers on X11

- xdotool works via X11 protocol (compositor-independent)
- No special group membership needed
- Explicit clipboard insertion uses xclip + xdotool Ctrl+V simulation, with the same no-restoration policy as Wayland.

## Known Limitations

- Native desktop paste and the separately authorized Chromium exact-field adapter have different target contracts; neither establishes support for every application
- Rich editors, password controls and recognized sensitive metadata, selected ranges and unsupported frames are not browser adapter targets
- Direct captured-element mutation may not participate in native browser undo history
- Native Wayland, broad browser/app compatibility and physical microphone journeys require their own current evidence; isolated X11 tests do not prove them
- Deadline checks assume a shared trustworthy host clock; arbitrary wall-clock rollback is outside their guarantee
- Flatpak may require portal permissions for mic access
- Some Wayland compositors block simulated input used by the compatibility helpers
- First launch requires internet for model download (~142 MB)
- AppImage publication is paused because Tauri/linuxdeploy still uses mutable helper downloads;
  local experiments require an explicitly supplied, checksum-verified final appimagetool

## Packaging

| Format   | Status         | Notes                                                                 |
| -------- | -------------- | --------------------------------------------------------------------- |
| .deb     | Development build plus existing release channel | Current candidate changes are not proof of installation/publication |
| .rpm     | Not configured | Can be added to tauri.conf.json targets                               |
| AppImage | Local experiment | Not published until the complete packaging toolchain is pinned      |

## Data Locations

| Data   | Path                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| Config | `~/.config/voco/config.json`                                                   |
| Models | `~/.local/share/voco/models/`                                                  |
| State  | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/`                                  |
| Socket | `$XDG_RUNTIME_DIR/voco.sock` or `${TMPDIR:-/tmp}/voco-$(id -u)/voco.sock`       |
| Browser broker | `$XDG_RUNTIME_DIR/voco-browser/exact-field.sock` |

## Helper delivery outcomes

The legacy `insert_text` command returns `outcome: dispatched` only after a helper exits successfully.
That confirms helper completion, not consumption by the intended application. Errors distinguish
`no-mutation` (helper did not start), `rejected` (input validation), and `uncertain` (a helper started
and delivery may have partially happened). Only `no-mutation` allows an automatic alternate route.
An error after a clipboard write is always uncertain and reports `clipboardChanged`.

Typing helpers have a length-adjusted deadline capped at three minutes. Clipboard write and paste
helpers each have a five-second deadline. Stdin writes are nonblocking under the same deadline;
failed supervision kills and reaps the helper process group. No transcript is written to diagnostic
output. The transcript stays recoverable in VOCO when the application cannot prove delivery.

Clipboard restoration is deliberately unavailable with the current command-line helpers. A fixed
sleep does not prove the target consumed the clipboard, and reading it before restoring cannot
atomically exclude a concurrent copy. Explicit clipboard use replaces existing text and non-text
formats; clipboard managers may retain the transcript under their own policies. VOCO never restores
an earlier snapshot over a newer selection.

## Browser integration packaging

The Debian candidate includes the native host, static Chrome/Chromium registration manifests,
and unpacked extension sources. It does not install or activate a browser extension in a profile.
See [installation](../install.md) for explicit setup. Native messaging uses a private same-user
Unix socket and no network service. The bounded protocol and acceptance limits are documented in
[broker acceptance](../testing/browser-broker.md); no best-in-world or universal app claim follows
from those tests.
