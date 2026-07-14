#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEB_PATH="${1:?usage: verify-deb-package.sh <package.deb> [expected-version]}"
EXPECTED_VERSION="${2:-$(node -p "require('${ROOT_DIR}/package.json').version")}"

if [[ ! -f "${DEB_PATH}" ]]; then
  echo "Debian package not found: ${DEB_PATH}" >&2
  exit 1
fi

PACKAGE_NAME="$(dpkg-deb -f "${DEB_PATH}" Package)"
PACKAGE_VERSION="$(dpkg-deb -f "${DEB_PATH}" Version)"
PACKAGE_ARCH="$(dpkg-deb -f "${DEB_PATH}" Architecture)"
PACKAGE_DEPENDS="$(dpkg-deb -f "${DEB_PATH}" Depends)"

[[ "${PACKAGE_NAME}" == "voco" ]] || {
  echo "Unexpected Debian package name: ${PACKAGE_NAME}" >&2
  exit 1
}
[[ "${PACKAGE_VERSION}" == "${EXPECTED_VERSION}" ]] || {
  echo "Unexpected Debian package version: ${PACKAGE_VERSION}" >&2
  exit 1
}
[[ "${PACKAGE_ARCH}" == "amd64" ]] || {
  echo "Unexpected Debian architecture: ${PACKAGE_ARCH}" >&2
  exit 1
}

for dependency in ibus python3 python3-gi gir1.2-ibus-1.0; do
  if ! grep -Eq "(^|, )${dependency}( \\([^)]*\\))?(,|$)" <<<"${PACKAGE_DEPENDS}"; then
    echo "Debian package is missing dependency: ${dependency}" >&2
    exit 1
  fi
done

PACKAGE_LISTING="$(dpkg-deb -c "${DEB_PATH}")"
assert_entry() {
  local path="$1"
  local mode="$2"
  local archive_path="${path#/}"
  local -a matches=()
  mapfile -t matches < <(
    awk -v expected="${archive_path}" '$NF == expected { print $1, $2 }' \
      <<<"${PACKAGE_LISTING}"
  )
  if [[ "${#matches[@]}" -ne 1 ]]; then
    echo "Expected exactly one packaged entry for ${path}" >&2
    exit 1
  fi
  if [[ "${matches[0]}" != "${mode} root/root" && "${matches[0]}" != "${mode} 0/0" ]]; then
    echo "Unexpected mode or owner for ${path}: ${matches[0]}" >&2
    exit 1
  fi
}

assert_entry /usr/share/ibus/component/voco.xml -rw-r--r--
assert_entry /usr/libexec/voco-ibus-engine -rwxr-xr-x
assert_entry /usr/lib/voco/ibus/voco_ibus_engine.py -rw-r--r--
assert_entry /usr/lib/voco/ibus/voco_ibus_ownership.py -rw-r--r--
assert_entry /usr/lib/voco/ibus/voco_ibus_protocol.py -rw-r--r--

if awk '{ print $NF }' <<<"${PACKAGE_LISTING}" | rg -q '(__pycache__|\.pyc$|_test\.py$)'; then
  echo "Debian package contains a Python cache or test artifact." >&2
  exit 1
fi

if dpkg-deb --ctrl-tarfile "${DEB_PATH}" | tar -tf - \
  | rg -q '(^|/)(preinst|postinst|prerm|postrm|config|triggers)$'; then
  echo "Debian package unexpectedly mutates installation state via maintainer scripts." >&2
  exit 1
fi

EXTRACT_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${EXTRACT_ROOT}"
}
trap cleanup EXIT INT TERM
dpkg-deb -x "${DEB_PATH}" "${EXTRACT_ROOT}"

cmp "${ROOT_DIR}/packaging/ibus/voco.xml" \
  "${EXTRACT_ROOT}/usr/share/ibus/component/voco.xml"
cmp "${ROOT_DIR}/packaging/ibus/voco-ibus-engine" \
  "${EXTRACT_ROOT}/usr/libexec/voco-ibus-engine"
for module in voco_ibus_engine.py voco_ibus_ownership.py voco_ibus_protocol.py; do
  cmp "${ROOT_DIR}/apps/desktop/src-tauri/resources/${module}" \
    "${EXTRACT_ROOT}/usr/lib/voco/ibus/${module}"
done

[[ "$(stat -c '%a' "${EXTRACT_ROOT}/usr/libexec/voco-ibus-engine")" == "755" ]]
for path in \
  "${EXTRACT_ROOT}/usr/share/ibus/component/voco.xml" \
  "${EXTRACT_ROOT}/usr/lib/voco/ibus/voco_ibus_engine.py" \
  "${EXTRACT_ROOT}/usr/lib/voco/ibus/voco_ibus_ownership.py" \
  "${EXTRACT_ROOT}/usr/lib/voco/ibus/voco_ibus_protocol.py"; do
  [[ "$(stat -c '%a' "${path}")" == "644" ]]
done

echo "Verified VOCO ${PACKAGE_VERSION} Debian package structure and persistent IBus payload."
