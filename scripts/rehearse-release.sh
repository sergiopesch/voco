#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
TAG_NAME="voco.${VERSION}"
DEB_NAME="voco_${VERSION}_amd64.deb"
LATEST_DEB_NAME="voco_latest_amd64.deb"
RPM_NAME="voco-${VERSION}-1.x86_64.rpm"
LATEST_RPM_NAME="voco_latest_x86_64.rpm"
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
echo "  rpm: ${RPM_NAME}"
echo "  latest rpm: ${LATEST_RPM_NAME}"

# Name the missing text instead of failing with grep's silent status.
contains() {
  local file="$1" text="$2"
  shift 2
  grep -Fq "$@" -- "${text}" "${file}" || { echo "${file} must contain: ${text}" >&2; exit 1; }
}

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
  contains docs/install.md 'sha256sum -c'
  contains docs/install.md 'wget "$BASE/$TAG/install" -O voco-install'
  # README installs the published release, not the version this source tree would release.
  PUBLISHED_VERSION="$(node -p "require('./packaging/published-release.json').version")"
  contains README.md "wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.${PUBLISHED_VERSION}/install && bash voco-install" -x
  contains docs/install.md 'sha256sum -c voco_latest_checksums.txt'
  contains scripts/assemble-release.sh 'gh release create ${TAG} --draft --verify-tag'
  # Both packages come from one staged tree, and the RPM is verified against the .deb.
  contains scripts/assemble-release.sh '--rpm "${ASSETS}/${RPM}"'
  contains scripts/assemble-release.sh 'bash scripts/verify-rpm-package.sh "${ASSETS}/${RPM}" "${VERSION}" "${ASSETS}/${DEB}"'
  bash ./scripts/render-release-body.sh "${VERSION}" "${TAG_NAME}" > "${TMP_DIR}/release-body.md"
  for expected in \
    'voco_checksums.txt' \
    "wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/${TAG_NAME}/install && bash voco-install" \
    "gpg --verify voco_${VERSION}_debian_checksums.txt.asc voco_${VERSION}_debian_checksums.txt && sha256sum --check --strict voco_${VERSION}_debian_checksums.txt" \
    "gpg --verify voco_${VERSION}_rpm_checksums.txt.asc voco_${VERSION}_rpm_checksums.txt && sha256sum --check --strict voco_${VERSION}_rpm_checksums.txt" \
    "sudo dnf install ./${RPM_NAME}"; do
    contains "${TMP_DIR}/release-body.md" "${expected}"
  done
)

echo
echo "Rendered release body preview:"
sed -n '1,80p' "${TMP_DIR}/release-body.md"
