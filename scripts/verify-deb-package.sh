#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEB_PATH="${1:?usage: verify-deb-package.sh <package.deb> [expected-version]}"
EXPECTED_VERSION="${2:-$(node -p "require('${ROOT_DIR}/package.json').version")}"
DESKTOP_PATH="/usr/share/applications/VOCO.desktop"
METAINFO_PATH="/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
TAURI_DESKTOP_SOURCE="${ROOT_DIR}/packaging/tauri/VOCO.desktop"
TAURI_METAINFO_SOURCE="${ROOT_DIR}/packaging/tauri/com.sergiopesch.voco.metainfo.xml"

for command in dpkg-deb desktop-file-validate appstreamcli python3 rg; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required package verification command is unavailable: ${command}" >&2
    exit 1
  fi
done

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
assert_entry /usr/bin/voco -rwxr-xr-x
assert_entry "${DESKTOP_PATH}" -rw-r--r--
assert_entry "${METAINFO_PATH}" -rw-r--r--
assert_entry /usr/share/icons/hicolor/32x32/apps/voco.png -rw-r--r--
assert_entry /usr/share/icons/hicolor/128x128/apps/voco.png -rw-r--r--
assert_entry /usr/share/icons/hicolor/256x256@2/apps/voco.png -rw-r--r--

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

mapfile -t packaged_desktop_files < <(
  find "${EXTRACT_ROOT}/usr/share/applications" -maxdepth 1 -type f -name '*.desktop' -print
)
if [[ "${#packaged_desktop_files[@]}" -ne 1 \
  || "${packaged_desktop_files[0]}" != "${EXTRACT_ROOT}${DESKTOP_PATH}" ]]; then
  echo "Debian package must contain exactly one desktop file at ${DESKTOP_PATH}." >&2
  printf 'Found: %s\n' "${packaged_desktop_files[@]:-none}" >&2
  exit 1
fi

mapfile -t packaged_metainfo_files < <(
  find "${EXTRACT_ROOT}/usr/share/metainfo" -maxdepth 1 -type f \
    \( -name '*.metainfo.xml' -o -name '*.appdata.xml' \) -print
)
if [[ "${#packaged_metainfo_files[@]}" -ne 1 \
  || "${packaged_metainfo_files[0]}" != "${EXTRACT_ROOT}${METAINFO_PATH}" ]]; then
  echo "Debian package must contain exactly one AppStream file at ${METAINFO_PATH}." >&2
  printf 'Found: %s\n' "${packaged_metainfo_files[@]:-none}" >&2
  exit 1
fi

cmp "${ROOT_DIR}/packaging/ibus/voco.xml" \
  "${EXTRACT_ROOT}/usr/share/ibus/component/voco.xml"
cmp "${ROOT_DIR}/packaging/ibus/voco-ibus-engine" \
  "${EXTRACT_ROOT}/usr/libexec/voco-ibus-engine"
for module in voco_ibus_engine.py voco_ibus_ownership.py voco_ibus_protocol.py; do
  cmp "${ROOT_DIR}/apps/desktop/src-tauri/resources/${module}" \
    "${EXTRACT_ROOT}/usr/lib/voco/ibus/${module}"
done
cmp "${TAURI_DESKTOP_SOURCE}" "${EXTRACT_ROOT}${DESKTOP_PATH}"
cmp "${TAURI_METAINFO_SOURCE}" "${EXTRACT_ROOT}${METAINFO_PATH}"
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/32x32.png" \
  "${EXTRACT_ROOT}/usr/share/icons/hicolor/32x32/apps/voco.png"
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/128x128.png" \
  "${EXTRACT_ROOT}/usr/share/icons/hicolor/128x128/apps/voco.png"
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/128x128@2x.png" \
  "${EXTRACT_ROOT}/usr/share/icons/hicolor/256x256@2/apps/voco.png"

python3 - "${EXTRACT_ROOT}${METAINFO_PATH}" "${EXPECTED_VERSION}" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, expected_version = sys.argv[1:]
component = ET.parse(path).getroot()
if component.findtext("id") != "com.sergiopesch.voco":
    raise SystemExit("Packaged AppStream component ID is not com.sergiopesch.voco")
launchables = [
    node.text
    for node in component.findall("launchable")
    if node.attrib.get("type") == "desktop-id"
]
if launchables != ["VOCO.desktop"]:
    raise SystemExit(f"Unexpected packaged desktop launchables: {launchables!r}")
release = component.find("releases/release")
if release is None or release.attrib.get("version") != expected_version:
    actual = None if release is None else release.attrib.get("version")
    raise SystemExit(
        f"Packaged AppStream release version {actual!r} does not match {expected_version!r}"
    )
PY

desktop-file-validate "${EXTRACT_ROOT}${DESKTOP_PATH}"
appstreamcli validate "${EXTRACT_ROOT}${METAINFO_PATH}"
appstreamcli validate-tree "${EXTRACT_ROOT}"

[[ "$(stat -c '%a' "${EXTRACT_ROOT}/usr/libexec/voco-ibus-engine")" == "755" ]]
for path in \
  "${EXTRACT_ROOT}/usr/bin/voco" \
  "${EXTRACT_ROOT}${DESKTOP_PATH}" \
  "${EXTRACT_ROOT}${METAINFO_PATH}" \
  "${EXTRACT_ROOT}/usr/share/icons/hicolor/32x32/apps/voco.png" \
  "${EXTRACT_ROOT}/usr/share/icons/hicolor/128x128/apps/voco.png" \
  "${EXTRACT_ROOT}/usr/share/icons/hicolor/256x256@2/apps/voco.png" \
  "${EXTRACT_ROOT}/usr/share/ibus/component/voco.xml" \
  "${EXTRACT_ROOT}/usr/lib/voco/ibus/voco_ibus_engine.py" \
  "${EXTRACT_ROOT}/usr/lib/voco/ibus/voco_ibus_ownership.py" \
  "${EXTRACT_ROOT}/usr/lib/voco/ibus/voco_ibus_protocol.py"; do
  expected_mode=644
  if [[ "${path}" == "${EXTRACT_ROOT}/usr/bin/voco" ]]; then
    expected_mode=755
  fi
  [[ "$(stat -c '%a' "${path}")" == "${expected_mode}" ]]
done

echo "Verified VOCO ${PACKAGE_VERSION} Debian package, desktop/AppStream identity, icons, and persistent IBus payload."
