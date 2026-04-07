#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
TAG_NAME="voco.${VERSION}"
DEB_NAME="voco_${VERSION}_amd64.deb"
APPIMAGE_NAME="VOCO-${VERSION}-x86_64.AppImage"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Release rehearsal"
echo "  version: ${VERSION}"
echo "  tag: ${TAG_NAME}"
echo "  deb: ${DEB_NAME}"
echo "  appimage: ${APPIMAGE_NAME}"

(
  cd "${ROOT_DIR}"
  npm run verify:versions
  bash -n install scripts/install.sh scripts/setup.sh scripts/build-desktop.sh scripts/package-appimage.sh scripts/render-release-body.sh scripts/lib/install-common.sh
  bash ./scripts/render-release-body.sh "${VERSION}" "${TAG_NAME}" > "${TMP_DIR}/release-body-no-appimage.md"
  bash ./scripts/render-release-body.sh "${VERSION}" "${TAG_NAME}" "${APPIMAGE_NAME}" > "${TMP_DIR}/release-body-with-appimage.md"
)

echo
echo "Rendered release body preview:"
sed -n '1,80p' "${TMP_DIR}/release-body-with-appimage.md"
