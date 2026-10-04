#!/usr/bin/env bash
# Check a complete VOCO RPM the way verify-deb-package.sh checks the Debian
# package. With a Debian package as the third argument, also prove that both
# carry the same staged files. Runs on the Ubuntu build host and on Fedora.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPM_PATH="${1:?usage: verify-rpm-package.sh <package.rpm> [expected-version] [complete.deb]}"
EXPECTED_VERSION="${2:-$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "${ROOT_DIR}/package.json")}"
DEB_PATH="${3:-}"
# Isolated package tests validate local metadata without conflating unavailable
# network with a malformed artifact. Release validation keeps URL checks enabled.
APPSTREAM_OPTIONS=()
if [[ "${VOCO_PACKAGE_VERIFY_OFFLINE:-0}" == 1 ]]; then
  APPSTREAM_OPTIONS+=(--no-net)
fi
DESKTOP_PATH="/usr/share/applications/VOCO.desktop"
METAINFO_PATH="/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
LICENSE_EXPRESSION="MIT AND Apache-2.0 AND LicenseRef-NVIDIA-Open-Model-License"
umask 022

required_commands=(rpm rpm2cpio cpio desktop-file-validate appstreamcli python3 readelf)
if [[ -n "${DEB_PATH}" ]]; then required_commands+=(dpkg-deb); fi
for command in "${required_commands[@]}"; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required package verification command is unavailable: ${command}" >&2
    exit 1
  fi
done

if [[ ! -f "${RPM_PATH}" ]]; then
  echo "RPM package not found: ${RPM_PATH}" >&2
  exit 1
fi
if [[ -n "${DEB_PATH}" && ! -f "${DEB_PATH}" ]]; then
  echo "Debian package not found: ${DEB_PATH}" >&2
  exit 1
fi

query() {
  LC_ALL=C rpm -qp --queryformat "$1" "${RPM_PATH}"
}
expect_field() {
  local name="$1" actual="$2" expected="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Unexpected RPM ${name}: ${actual} (expected ${expected})" >&2
    exit 1
  fi
}

expect_field name "$(query '%{NAME}')" voco
expect_field version "$(query '%{VERSION}')" "${EXPECTED_VERSION}"
expect_field release "$(query '%{RELEASE}')" 1
expect_field epoch "$(query '%{EPOCH}')" '(none)'
expect_field architecture "$(query '%{ARCH}')" x86_64
expect_field license "$(query '%{LICENSE}')" "${LICENSE_EXPRESSION}"
expect_field 'build host' "$(query '%{BUILDHOST}')" voco-release
expect_field 'payload compressor' "$(query '%{PAYLOADCOMPRESSOR}')" zstd
expect_field 'file name' "$(basename -- "${RPM_PATH}")" "voco-${EXPECTED_VERSION}-1.x86_64.rpm"

PACKAGE_REQUIRES="$(LC_ALL=C rpm -qp --requires "${RPM_PATH}")"
for floor in 'glibc >= 2.39' 'libstdc++ >= 13.2'; do
  if ! grep -Fxq -- "${floor}" <<<"${PACKAGE_REQUIRES}"; then
    echo "RPM is missing the verified ABI floor: ${floor}" >&2
    exit 1
  fi
done
for dependency in webkit2gtk4.1 gtk3 libayatana-appindicator-gtk3 pulseaudio-libs libnotify ibus \
  ibus-libs python3 python3-gobject python3-numpy python3-psutil procps-ng sentencepiece-libs xclip \
  xdotool wl-clipboard; do
  if ! grep -Fxq -- "${dependency}" <<<"${PACKAGE_REQUIRES}"; then
    echo "RPM is missing dependency: ${dependency}" >&2
    exit 1
  fi
done
for relation in recommends suggests supplements enhances conflicts obsoletes; do
  if [[ -n "$(LC_ALL=C rpm -qp "--${relation}" "${RPM_PATH}")" ]]; then
    echo "RPM must not declare ${relation}; VOCO pastes through its own virtual keyboard." >&2
    exit 1
  fi
done
if [[ -n "$(LC_ALL=C rpm -qp --configfiles "${RPM_PATH}")" ]]; then
  echo "RPM must not declare configuration files, like the Debian package." >&2
  exit 1
fi

PACKAGE_LISTING="$(query '[%{FILEMODES:perms} %{FILEUSERNAME}/%{FILEGROUPNAME} %{FILENAMES}\n]')"
assert_entry() {
  local path="$1"
  local mode="$2"
  local -a matches=()
  mapfile -t matches < <(awk -v expected="${path}" '$3 == expected { print $1, $2 }' <<<"${PACKAGE_LISTING}")
  if [[ "${#matches[@]}" -ne 1 ]]; then
    echo "Expected exactly one packaged entry for ${path}" >&2
    exit 1
  fi
  if [[ "${matches[0]}" != "${mode} root/root" ]]; then
    echo "Unexpected mode or owner for ${path}: ${matches[0]}" >&2
    exit 1
  fi
}

assert_entry /usr/share/ibus/component/voco.xml -rw-r--r--
assert_entry /usr/libexec/voco-ibus-engine -rwxr-xr-x
assert_entry /usr/lib/voco/ibus/voco_ibus_engine.py -rw-r--r--
assert_entry /usr/lib/voco/ibus/voco_ibus_protocol.py -rw-r--r--
assert_entry /usr/bin/voco -rwxr-xr-x
for file in metadata.json extension.js model.js stylesheet.css voco-symbol.png; do
  assert_entry "/usr/share/gnome-shell/extensions/voco-panel@voco.local/${file}" -rw-r--r--
done
assert_entry /usr/lib/udev/rules.d/70-voco-uinput.rules -rw-r--r--
assert_entry /usr/lib/modules-load.d/voco-uinput.conf -rw-r--r--
assert_entry /usr/share/doc/voco/THIRD-PARTY-NOTICES.txt -rw-r--r--
assert_entry /usr/share/doc/voco/copyright -rw-r--r--
assert_entry /usr/libexec/voco-browser-host -rwxr-xr-x
assert_entry /etc/opt/chrome/native-messaging-hosts/com.voco.exact_field.json -rw-r--r--
assert_entry /etc/chromium/native-messaging-hosts/com.voco.exact_field.json -rw-r--r--
for file in manifest.json background.js content.js; do
  assert_entry "/usr/share/voco/chromium/${file}" -rw-r--r--
done
assert_entry "${DESKTOP_PATH}" -rw-r--r--
assert_entry "${METAINFO_PATH}" -rw-r--r--
assert_entry /usr/share/icons/hicolor/32x32/apps/voco.png -rw-r--r--
assert_entry /usr/share/icons/hicolor/128x128/apps/voco.png -rw-r--r--
assert_entry /usr/share/icons/hicolor/256x256@2/apps/voco.png -rw-r--r--
assert_entry /usr/lib/voco/speech/MANIFEST.json -rw-r--r--

if awk '$NF ~ /(__pycache__|\.pyc$|_test\.py$|^\/usr\/lib\/\.build-id|^\/DEBIAN)/ { found = 1 } END { exit !found }' \
  <<<"${PACKAGE_LISTING}"; then
  echo "RPM contains a Python cache, test artifact, build-id link or Debian control file." >&2
  exit 1
fi
if awk '$NF ~ /^\/usr\/libexec\/voco(\/|$)|voco-ydotoold/ { found = 1 } END { exit !found }' <<<"${PACKAGE_LISTING}"; then
  echo "RPM still ships the retired ydotoold service or launcher." >&2
  exit 1
fi
for license in /usr/share/doc/voco/copyright /usr/share/doc/voco/THIRD-PARTY-NOTICES.txt \
  /usr/share/doc/voco/nvidia/NVIDIA-OPEN-MODEL-LICENSE.html /usr/share/doc/voco/nvidia/LICENSE; do
  if ! LC_ALL=C rpm -qpL "${RPM_PATH}" | grep -Fxq -- "${license}"; then
    echo "RPM does not mark ${license} as a license file." >&2
    exit 1
  fi
done

EXTRACT_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${EXTRACT_ROOT}"
}
trap cleanup EXIT INT TERM
mkdir "${EXTRACT_ROOT}/rpm"
rpm2cpio "${RPM_PATH}" | (cd "${EXTRACT_ROOT}/rpm" && cpio --quiet -idm --no-absolute-filenames)
PAYLOAD="${EXTRACT_ROOT}/rpm"
# The reviewed scriptlet, folder ownership, license marking and dependencies.
PYTHONDONTWRITEBYTECODE=1 python3 "${ROOT_DIR}/scripts/rpm_package.py" verify-package "${RPM_PATH}" "${PAYLOAD}"
if [[ -n "${DEB_PATH}" ]]; then
  # Built from one staged tree: the same files, and every Debian dependency
  # required under its Fedora name.
  dpkg-deb -x "${DEB_PATH}" "${EXTRACT_ROOT}/deb"
  PYTHONDONTWRITEBYTECODE=1 python3 "${ROOT_DIR}/scripts/rpm_package.py" same-package \
    "${DEB_PATH}" "${RPM_PATH}" "${EXTRACT_ROOT}/deb" "${PAYLOAD}"
fi

# A development binary may link Pulse directly; never rely on a desktop's
# incidental transitive installation to satisfy that runtime dependency.
for executable in /usr/bin/voco /usr/libexec/voco-browser-host; do
  if readelf -d "${PAYLOAD}${executable}" | grep -Eq 'NEEDED.*\[libpulse\.so\.0\]' \
    && ! grep -Fxq pulseaudio-libs <<<"${PACKAGE_REQUIRES}"; then
    echo "RPM links libpulse.so.0 but does not declare pulseaudio-libs." >&2
    exit 1
  fi
done

cmp "${ROOT_DIR}/vendor/THIRD-PARTY-NOTICES.txt" "${PAYLOAD}/usr/share/doc/voco/THIRD-PARTY-NOTICES.txt"
tail -n "$(wc -l < "${ROOT_DIR}/LICENSE")" "${PAYLOAD}/usr/share/doc/voco/copyright" \
  | cmp - "${ROOT_DIR}/LICENSE"
cmp "${ROOT_DIR}/packaging/udev/70-voco-uinput.rules" "${PAYLOAD}/usr/lib/udev/rules.d/70-voco-uinput.rules"
cmp "${ROOT_DIR}/packaging/udev/voco-uinput.conf" "${PAYLOAD}/usr/lib/modules-load.d/voco-uinput.conf"
if [[ -e "${PAYLOAD}/usr/libexec/voco" || -e "${PAYLOAD}/usr/lib/systemd/user/voco-ydotoold.service" ]]; then
  echo "RPM still ships the retired ydotoold service or launcher." >&2
  exit 1
fi

mapfile -t packaged_desktop_files < <(
  find "${PAYLOAD}/usr/share/applications" -maxdepth 1 -type f -name '*.desktop' -print
)
if [[ "${#packaged_desktop_files[@]}" -ne 1 || "${packaged_desktop_files[0]}" != "${PAYLOAD}${DESKTOP_PATH}" ]]; then
  echo "RPM must contain exactly one desktop file at ${DESKTOP_PATH}." >&2
  exit 1
fi
mapfile -t packaged_metainfo_files < <(
  find "${PAYLOAD}/usr/share/metainfo" -maxdepth 1 -type f \
    \( -name '*.metainfo.xml' -o -name '*.appdata.xml' \) -print
)
if [[ "${#packaged_metainfo_files[@]}" -ne 1 || "${packaged_metainfo_files[0]}" != "${PAYLOAD}${METAINFO_PATH}" ]]; then
  echo "RPM must contain exactly one AppStream file at ${METAINFO_PATH}." >&2
  exit 1
fi

cmp "${ROOT_DIR}/packaging/ibus/voco.xml" "${PAYLOAD}/usr/share/ibus/component/voco.xml"
cmp "${ROOT_DIR}/packaging/ibus/voco-ibus-engine" "${PAYLOAD}/usr/libexec/voco-ibus-engine"
for module in voco_ibus_engine.py voco_ibus_protocol.py; do
  cmp "${ROOT_DIR}/apps/desktop/src-tauri/resources/${module}" "${PAYLOAD}/usr/lib/voco/ibus/${module}"
done
for browser in opt/chrome chromium; do
  cmp "${ROOT_DIR}/packaging/chromium/com.voco.exact_field.json" \
    "${PAYLOAD}/etc/${browser}/native-messaging-hosts/com.voco.exact_field.json"
done
for file in manifest.json background.js content.js; do
  cmp "${ROOT_DIR}/integrations/chromium/${file}" "${PAYLOAD}/usr/share/voco/chromium/${file}"
done
for file in metadata.json extension.js model.js stylesheet.css voco-symbol.png; do
  cmp "${ROOT_DIR}/integrations/gnome/voco-panel@voco.local/${file}" \
    "${PAYLOAD}/usr/share/gnome-shell/extensions/voco-panel@voco.local/${file}"
done
python3 - "${PAYLOAD}" <<'BROWSER'
import base64, hashlib, json, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'usr/share/voco/chromium/manifest.json').read_text())
key_hash = hashlib.sha256(base64.b64decode(manifest['key'], validate=True)).hexdigest()[:32]
extension_id = ''.join(chr(ord('a') + int(char, 16)) for char in key_hash)
host = json.loads((root / 'etc/chromium/native-messaging-hosts/com.voco.exact_field.json').read_text())
assert host['name'] == 'com.voco.exact_field' and host['type'] == 'stdio'
assert host['path'] == '/usr/libexec/voco-browser-host'
assert host['allowed_origins'] == ['chrome-extension://' + extension_id + '/']
assert extension_id == 'dohnphckdenppjhdafmhefhomomodgcc'
# An unregistered origin must fail before opening any session transport.
result = subprocess.run([str(root / 'usr/libexec/voco-browser-host'), 'chrome-extension://untrusted/'], capture_output=True, timeout=5)
assert result.returncode == 1 and result.stdout == b''
BROWSER
cmp "${ROOT_DIR}/packaging/tauri/VOCO.desktop" "${PAYLOAD}${DESKTOP_PATH}"
cmp "${ROOT_DIR}/packaging/tauri/com.sergiopesch.voco.metainfo.xml" "${PAYLOAD}${METAINFO_PATH}"
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/32x32.png" "${PAYLOAD}/usr/share/icons/hicolor/32x32/apps/voco.png"
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/128x128.png" "${PAYLOAD}/usr/share/icons/hicolor/128x128/apps/voco.png"
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/128x128@2x.png" \
  "${PAYLOAD}/usr/share/icons/hicolor/256x256@2/apps/voco.png"

python3 - "${PAYLOAD}${METAINFO_PATH}" "${EXPECTED_VERSION%%+*}" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, expected_version = sys.argv[1:]
component = ET.parse(path).getroot()
if component.findtext("id") != "com.sergiopesch.voco":
    raise SystemExit("Packaged AppStream component ID is not com.sergiopesch.voco")
launchables = [node.text for node in component.findall("launchable")
               if node.attrib.get("type") == "desktop-id"]
if launchables != ["VOCO.desktop"]:
    raise SystemExit(f"Unexpected packaged desktop launchables: {launchables!r}")
release = component.find("releases/release")
if release is None or release.attrib.get("version") != expected_version:
    actual = None if release is None else release.attrib.get("version")
    raise SystemExit(f"Packaged AppStream release version {actual!r} does not match {expected_version!r}")
PY

PYTHONDONTWRITEBYTECODE=1 python3 "${ROOT_DIR}/scripts/verify-speech-payload.py" "${PAYLOAD}" "${EXPECTED_VERSION}"

desktop-file-validate "${PAYLOAD}${DESKTOP_PATH}"
appstreamcli validate "${APPSTREAM_OPTIONS[@]}" "${PAYLOAD}${METAINFO_PATH}"
appstreamcli validate-tree "${APPSTREAM_OPTIONS[@]}" "${PAYLOAD}"

echo "Verified VOCO ${EXPECTED_VERSION}-1 RPM: Fedora requirements, reviewed scriptlet and folders, desktop/AppStream identity, icons, IBus payload, exact-field browser integration and speech payload${DEB_PATH:+, identical to $(basename -- "${DEB_PATH}")}."
