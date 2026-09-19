#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?usage: render-release-body.sh <version> <tag> [appimage-name]}"
TAG_NAME="${2:?release tag required}"
APPIMAGE_NAME="${3:-}"
cat <<EOF_BODY
# VOCO ${VERSION}

Local English dictation for Linux. Speak and your words appear at the cursor.

- Local NVIDIA CPU recognition; no account or cloud transcription.
- Live words and punctuation, with explicit recovery after interrupted dictation.
- Native Wayland capture with source selection and permission for the app session.
- Separate Debian, Fedora, openSUSE and Arch dependency profiles; documented Omarchy setup.
- Microphone and shortcut preferences preserved on upgrade.

[Changes and measured limits](https://github.com/sergiopesch/voco/blob/${TAG_NAME}/docs/releases/${VERSION}.md).

## Install

Choose the native package for your distribution and download its platform checksum
manifest, matching signature and public \`KEYS\` asset. Verify the publisher key
fingerprint through a trusted independent channel. The source verification script
checks every listed file and its signature in an isolated keyring:

\`\`\`bash
bash scripts/verify-release.sh --keys KEYS PLATFORM_checksums.txt
\`\`\`

The complete \`voco_checksums.txt\` covers the release assets; platform manifests
avoid requiring unrelated packages. Continue only after signature and checksum
verification succeeds. Quit VOCO before upgrading and copy needed recovery text.

[Package selection, native install commands and desktop setup](https://github.com/sergiopesch/voco/blob/${TAG_NAME}/docs/install-native.md).
[General setup and troubleshooting](https://github.com/sergiopesch/voco/blob/${TAG_NAME}/docs/install.md).

## Scope

Prebuilt packages require x86-64 with AVX2/FMA/F16C and glibc 2.39+. Text delivery uses clipboard paste,
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
