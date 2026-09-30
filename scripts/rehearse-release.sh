#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
TAG_NAME="voco.${VERSION}"
DEB_NAME="voco_${VERSION}_amd64.deb"
LATEST_DEB_NAME="voco_latest_amd64.deb"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Release rehearsal"
echo "  version: ${VERSION}"
echo "  tag: ${TAG_NAME}"
echo "  deb: ${DEB_NAME}"
echo "  latest deb: ${LATEST_DEB_NAME}"

(
  cd "${ROOT_DIR}"
  npm run verify:versions
  bash scripts/check-shell-syntax.sh install scripts/setup.sh scripts/build-desktop.sh \
    scripts/assemble-release.sh scripts/render-release-body.sh scripts/lib/install-common.sh \
    scripts/test-install-common.sh
  bash scripts/test-install-common.sh
  if grep -En 'Examples:.*Alt\+Shift\+R|Downloading VOCO.*~5 MB' install scripts/lib/install-common.sh; then
    echo "Installer still advertises a reserved hotkey or stale package size"
    exit 1
  fi
  if grep -RInE 'raw.githubusercontent.com/.*/master/install|bash <\(curl|curl -s .*install' README.md docs install; then
    echo "Unsafe installer reference found in docs or helper comments"
    exit 1
  fi
  grep -F 'sha256sum -c' docs/install.md > /dev/null
  grep -F 'wget "$BASE/$TAG/install" -O voco-install' docs/install.md > /dev/null
  grep -F "raw.githubusercontent.com/sergiopesch/voco/${TAG_NAME}/install" install > /dev/null
  # README installs the published release, not the version this source tree would release.
  PUBLISHED_VERSION="$(node -p "require('./packaging/published-release.json').version")"
  grep -Fx "wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.${PUBLISHED_VERSION}/install && bash voco-install" README.md > /dev/null
  grep -F 'sha256sum -c voco_latest_checksums.txt' docs/install.md > /dev/null
  grep -F 'gh release create ${TAG} --draft --verify-tag' scripts/assemble-release.sh > /dev/null
  bash ./scripts/render-release-body.sh "${VERSION}" "${TAG_NAME}" > "${TMP_DIR}/release-body.md"
  for expected in \
    'voco_checksums.txt' \
    "wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/${TAG_NAME}/install && bash voco-install" \
    "gpg --verify voco_${VERSION}_debian_checksums.txt.asc voco_${VERSION}_debian_checksums.txt && sha256sum --check --strict voco_${VERSION}_debian_checksums.txt"; do
    grep -F -- "${expected}" "${TMP_DIR}/release-body.md" > /dev/null
  done
)

echo
echo "Rendered release body preview:"
sed -n '1,80p' "${TMP_DIR}/release-body.md"
