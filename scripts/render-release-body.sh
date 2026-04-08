#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?usage: scripts/render-release-body.sh <version> <tag> [appimage-name]}"
TAG_NAME="${2:?usage: scripts/render-release-body.sh <version> <tag> [appimage-name]}"
APPIMAGE_NAME="${3:-}"

cat <<EOF
## Summary

Voice-native interface layer for Linux, shipped as a local-first desktop install.

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
sha256sum --check voco_checksums.txt
sudo dpkg -i voco_${VERSION}_amd64.deb
\`\`\`
EOF

if [[ -n "${APPIMAGE_NAME}" ]]; then
  cat <<EOF

### Portable AppImage

\`\`\`bash
wget https://github.com/sergiopesch/voco/releases/download/${TAG_NAME}/${APPIMAGE_NAME}
chmod +x ${APPIMAGE_NAME}
./${APPIMAGE_NAME}
\`\`\`
EOF
fi

cat <<'EOF'

**Requirements:** Ubuntu/Debian with `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`

**Wayland users:** `sudo apt install ydotool wl-clipboard && sudo usermod -aG input $USER`

**X11 users:** `sudo apt install xdotool xclip`

## Upgrade notes

- Existing `voice` config is migrated to `~/.config/voco`
- Existing local models are reused from the prior install when present
- Restart VOCO after upgrading if it is already running

## Known issues

- First launch still downloads the speech model (~142 MB, one-time)
- Wayland text insertion depends on `ydotool` and compositor support
EOF
