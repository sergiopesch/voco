#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?usage: scripts/render-release-body.sh <version> <tag> [appimage-name]}"
TAG_NAME="${2:?usage: scripts/render-release-body.sh <version> <tag> [appimage-name]}"
APPIMAGE_NAME="${3:-}"

cat <<EOF
## Summary

Local-first Linux dictation with a persistent, explicitly user-enabled VOCO IBus input source and
fail-closed owned-preedit cursor streaming.

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
EOF
fi

cat <<'EOF'

**Requirements:** Ubuntu/Debian with `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `ibus`, `python3`, `gir1.2-ibus-1.0`, and `python3-gi`

**Live cursor setup:** After installing the Debian package, manually add and select `VOCO Dictation` in the desktop Input Sources settings. VOCO never changes the active source automatically.

**AppImage limitation:** The AppImage does not install the host IBus component, so it remains preview-only unless the matching Debian component is already installed.

**Wayland users:** `sudo apt install ydotool wl-clipboard && sudo usermod -aG input $USER`

**X11 users:** `sudo apt install xdotool xclip`

## Upgrade notes

- Existing `voice` config is migrated to `~/.config/voco`
- Existing local models are reused from the prior install when present
- Restart VOCO after upgrading if it is already running
- Switch away from and back to `VOCO Dictation` after an engine protocol upgrade

## Known issues

- First launch still downloads the speech model (~142 MB, one-time)
- Wayland text insertion depends on `ydotool` and compositor support
- Live cursor rendering and keyboard pass-through still require isolated desktop QA across target toolkits
EOF
