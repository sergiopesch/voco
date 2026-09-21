#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?usage: render-release-body.sh <version> <tag> [appimage-name]}"
TAG_NAME="${2:?release tag required}"
APPIMAGE_NAME="${3:-}"
PLATFORMS=(debian)
if [[ "$VERSION" == "2026.0.43" ]]; then PLATFORMS+=(fedora opensuse arch); fi
cat <<EOF_BODY
# VOCO ${VERSION}

Local English dictation for Linux. Speak and your words appear at the cursor.

- Local NVIDIA CPU recognition; no account or cloud transcription.
- Live words and punctuation, with explicit recovery after interrupted dictation.
- A live voice test with microphone selection inside the same setup canvas.
- Volume-responsive tray bars while listening; Ready returns after Stop.
- One bundled Nemotron recognizer for desktop, browser delivery and recovery.
- Clear feedback when no editable text cursor is available.
- Microphone and shortcut preferences preserved on upgrade.

[Changes and measured limits](https://github.com/sergiopesch/voco/blob/${TAG_NAME}/docs/releases/${VERSION}.md).

## Install

Download the package and any companion listed in the
[native installation guide](https://github.com/sergiopesch/voco/blob/${TAG_NAME}/docs/install-native.md),
plus \`KEYS\` and the matching checksum manifest and \`.asc\` signature:

This release updates the Ubuntu/Debian package. Other native channels remain at
[2026.0.43](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.43).
Use \`voco_${VERSION}_debian_checksums.txt\` for the Debian package.

First check that the public key's fingerprint is
\`B33C7C6AAEC8C20433A7A837540796453D8E3865\`, confirming it through a trusted
independent channel. These commands use GnuPG and coreutils; no repository checkout
or downloaded verification script is required. Run them in the download folder.

For Debian, Ubuntu or Mint:

\`\`\`bash
gpg --show-keys --fingerprint KEYS
gpg --import KEYS
gpg --verify voco_${VERSION}_debian_checksums.txt.asc voco_${VERSION}_debian_checksums.txt && sha256sum --check --strict voco_${VERSION}_debian_checksums.txt
\`\`\`

EOF_BODY
if [[ "${#PLATFORMS[@]}" -gt 1 ]]; then
  for platform in "${PLATFORMS[@]:1}"; do
    cat <<EOF_PLATFORM

For ${platform}:

\`\`\`bash
gpg --verify voco_${VERSION}_${platform}_checksums.txt.asc voco_${VERSION}_${platform}_checksums.txt && sha256sum --check --strict voco_${VERSION}_${platform}_checksums.txt
\`\`\`
EOF_PLATFORM
  done
fi
cat <<EOF_BODY

Read the fingerprint and import the checked public key once before running your
platform command. Continue to installation only after GnuPG reports a good
signature from that exact key and every listed file reports \`OK\`.

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
