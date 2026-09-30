#!/usr/bin/env bash
# Render the GitHub release notes for one signed VOCO release.
set -euo pipefail
VERSION="${1:?usage: render-release-body.sh <version> <tag>}"
TAG_NAME="${2:?release tag required}"
SOURCE="https://github.com/sergiopesch/voco/blob/${TAG_NAME}"
cat <<EOF_BODY
# VOCO ${VERSION}

Private English dictation for Linux. Speak, and VOCO pastes your words into the
app you are typing in.

- Recognition runs on your computer with NVIDIA's Nemotron model. There is no
  account or cloud service, and nothing is downloaded after installation.
- Words arrive while you speak. VOCO puts each phrase on the clipboard and
  primary selection, then presses Shift+Insert. It never presses Enter.
- If pasting is interrupted, VOCO keeps listening and copies the remaining words
  to the clipboard at Stop. If that copy fails too, tray Review keeps them.
- Start and stop with your shortcut (Alt+D by default), the tray icon or the
  GNOME panel.

[What changed in ${VERSION}](${SOURCE}/docs/releases/${VERSION}.md).

## Install

Run the guided installer as your normal user. It checks the package's signature
and checksum before it installs anything:

\`\`\`bash
wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/${TAG_NAME}/install && bash voco-install
\`\`\`

To verify by hand, download \`KEYS\`, \`voco_${VERSION}_amd64.deb\`,
\`voco_${VERSION}_debian_checksums.txt\` and its \`.asc\` signature into one
folder. Confirm through a trusted independent channel that the key's fingerprint
is \`B33C7C6AAEC8C20433A7A837540796453D8E3865\`, then run:

\`\`\`bash
gpg --show-keys --fingerprint KEYS
gpg --import KEYS
gpg --verify voco_${VERSION}_debian_checksums.txt.asc voco_${VERSION}_debian_checksums.txt && sha256sum --check --strict voco_${VERSION}_debian_checksums.txt
\`\`\`

Install the package only after GnuPG reports a good signature from that exact
key and the package reports \`OK\`. \`voco_checksums.txt\` lists every file
attached to this release. [Install VOCO](${SOURCE}/docs/install.md) covers
desktop input, the GNOME panel, upgrades and removal.

## Scope

The package requires x86-64 with AVX2, FMA and F16C, and glibc 2.39 or later.
Pasting replaces the clipboard's text. The bundled model is English only.
Protected fields, custom editors, other compositors and physical microphones
need their own testing. The attached validation record lists exactly what was
tested and what remains unverified.
EOF_BODY
