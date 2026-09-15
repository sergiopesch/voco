#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?usage: render-release-body.sh <version> <tag> [appimage-name]}"
TAG_NAME="${2:?release tag required}"
APPIMAGE_NAME="${3:-}"
cat <<EOF_BODY
# VOCO ${VERSION}

Local English dictation for Linux. Speak and your words appear at the cursor.

- One direct delivery path with live words and punctuation.
- Minimal settings and a draggable window header.
- Assistant, conversation, enhancement and appearance controls removed.
- Microphone and shortcut preferences preserved on upgrade.
- Local NVIDIA CPU recognition; no account or cloud transcription.

## Install

Download the Debian package and checksum file attached to this release. Then:

\`\`\`bash
grep " voco_${VERSION}_amd64.deb\$" voco_checksums.txt | sha256sum --check -
sudo apt install ./voco_${VERSION}_amd64.deb
\`\`\`

Continue only if checksum verification succeeds. Quit VOCO before upgrading;
copy any needed recovery text first. Restart the input engine after upgrading
if diagnostics report an older helper. IBus protocol 6 is dictation-shortcut-only.

[Setup and troubleshooting](https://github.com/sergiopesch/voco/blob/${TAG_NAME}/docs/install.md).

## Scope

Ubuntu x86_64 is the reference platform. Text delivery uses clipboard paste,
replaces clipboard text and never presses Enter. Protected or custom editors,
other compositors and physical audio need their own testing. Generic desktop
paste cannot safely rewrite an entire message after Stop. The bundled model is
English; automatic language switching is not supported.

A draft is not a public download. See the attached validation record for exact
artifact identity, test results and remaining limitations. Source checks alone
do not qualify every Linux distribution or application.
EOF_BODY
if [[ -n "${APPIMAGE_NAME}" ]]; then
  cat <<EOF_BODY

## Experimental AppImage

This is not a qualified NVIDIA installation channel. If supplied for research:

\`\`\`bash
grep " ${APPIMAGE_NAME}\$" voco_checksums.txt | sha256sum --check -
\`\`\`
EOF_BODY
fi
