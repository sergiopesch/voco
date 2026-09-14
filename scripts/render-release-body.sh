#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?usage: scripts/render-release-body.sh <version> <tag> [appimage-name]}"
TAG_NAME="${2:?usage: scripts/render-release-body.sh <version> <tag> [appimage-name]}"
APPIMAGE_NAME="${3:-}"

cat <<EOF
## Summary

Local Linux dictation with CPU-local NVIDIA Nemotron English streaming and the Crystal Sidebar interface.

Rendering this document does not publish a release or establish installation/test status.
Use these download commands only after the exact tag and complete verified assets exist.

## Highlights

- Bundles the pinned NVIDIA Nemotron English Q8 model and native CPU runtime in the complete Debian package
- Appends live words through desktop clipboard paste; Stop flushes the tail without an automatic preview window
- Uses terminal paste chords without changing target application keybindings; never sends Enter
- Preserves recovery after capture, recognition or uncertain delivery failures instead of blindly replaying text
- Retains a separate explicitly enabled Chromium exact-field adapter and shortcut-only IBus integration
- Adds bounded local app/worker diagnostics with fixed error stages and numeric timing/resource metadata
- Keeps optional localhost processing, OpenClaw and voice-only OpenAI Realtime separate from local dictation

## Install

### Guided installer

\`\`\`bash
wget https://raw.githubusercontent.com/sergiopesch/voco/${TAG_NAME}/install -O voco-install
chmod +x voco-install
./voco-install
\`\`\`

Optional trust step before running it:

\`\`\`bash
less ./voco-install
\`\`\`

### Manual Debian / Ubuntu fallback

\`\`\`bash
wget -O voco_${VERSION}_amd64.deb https://github.com/sergiopesch/voco/releases/download/${TAG_NAME}/voco_${VERSION}_amd64.deb
wget https://github.com/sergiopesch/voco/releases/download/${TAG_NAME}/voco_checksums.txt
grep " voco_${VERSION}_amd64.deb\$" voco_checksums.txt | sha256sum --check -
sudo apt install ./voco_${VERSION}_amd64.deb
\`\`\`
EOF

if [[ -n "${APPIMAGE_NAME}" ]]; then
  cat <<EOF

### Portable AppImage

\`\`\`bash
wget https://github.com/sergiopesch/voco/releases/download/${TAG_NAME}/${APPIMAGE_NAME}
wget https://github.com/sergiopesch/voco/releases/download/${TAG_NAME}/voco_checksums.txt
grep " ${APPIMAGE_NAME}\$" voco_checksums.txt | sha256sum --check -
chmod +x ${APPIMAGE_NAME}
./${APPIMAGE_NAME}
\`\`\`

**AppImage limitation:** This experimental artifact is not a qualified NVIDIA package. It does not install desktop/browser registrations or establish bundled model/runtime readiness; the verified complete Debian package is the candidate path.
EOF
fi

cat <<'EOF'

**Requirements:** Ubuntu 24.04 is the primary reference environment and requires `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `ibus`, `python3`, `gir1.2-ibus-1.0`, `python3-gi`, `python3-numpy`, `python3-psutil`, `gir1.2-atspi-2.0`, `libsentencepiece0`, and `xclip`. Debian-derived systems are best-effort rather than part of the regular desktop matrix.

**Optional Chromium delivery:** Load the packaged `/usr/share/voco/chromium` extension as unpacked, enable the current tab from its toolbar button, focus a supported plain text field and use `Alt+Shift+V`. The ordinary native hotkey uses the configured native desktop route. Browser access is never enabled by the package installer.

**Wayland hotkeys:** The evdev fallback needs keyboard-device access, commonly membership in the `input` group. The installer documents the required access; it is separate from IBus text delivery.

**Desktop delivery:** X11 uses `xdotool`/`xclip`. Wayland needs working `ydotool`; GNOME can use the XWayland `xclip` bridge, while other environments use `wl-copy`. The route performs best-effort focus checks, replaces clipboard text and cannot prove target consumption. Helper availability is not universal application qualification.

## Upgrade notes

- Existing `voice` config is migrated to `~/.config/voco`
- The complete Debian package supplies the pinned NVIDIA model; existing legacy Whisper caches remain separate
- Restart VOCO after upgrading if it is already running
- After an input-engine upgrade, quit VOCO and run `ibus restart` or sign out and back in before reopening it; switching input sources alone does not reload the resident engine
- IBus protocol 5 supports consuming shortcuts but rejects text mutation; native desktop paste and exact-field Chromium delivery are separate contracts
- Voice commands must be standalone sentences or use an explicit inline prefix, such as `command new paragraph`. Use quotes or `literal new paragraph` to dictate command words literally
- Copy completed text, then clear it before another recording. Failed recordings have explicit retry/discard recovery; audio stays in memory only and is not restored after VOCO closes
- Desktop delivery leaves dictated text in the clipboard; no delayed restoration can overwrite a newer copy

## Known issues

- Generic desktop paste cannot safely rewrite the entire delivered message after Stop or guarantee exact-widget ownership
- The Chromium development integration supports top-frame textarea and text/search/url/tel input
  fields with a collapsed caret. Rich editors, iframes, passwords and browser-native undo history
  are not supported; confined browser packages are not verified
- A page can read text deliberately inserted into its own field; the extension does not classify
  every private use case. Enable only a tab where you intend to dictate
- Exact-field browser ownership is revoked by focus changes, edits, timeouts or disconnection; generic desktop focus guards provide a weaker guarantee
- Physical-device and installed-session GNOME/KDE/browser qualification and broader application QA remain pending

EOF
