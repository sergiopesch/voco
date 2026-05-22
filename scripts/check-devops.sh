#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

npm run verify:versions
npm audit --audit-level=moderate

bash -n \
  install \
  scripts/install.sh \
  scripts/setup.sh \
  scripts/build-desktop.sh \
  scripts/package-appimage.sh \
  scripts/render-release-body.sh \
  scripts/rehearse-release.sh \
  scripts/lib/install-common.sh

python3 -m py_compile scripts/generate-icons.py
npm run rehearse:release
