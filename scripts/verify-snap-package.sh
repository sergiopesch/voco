#!/usr/bin/env bash
# Check VOCO's strict snap the way verify-deb-package.sh checks the Debian
# package, and prove it carries the Debian package's files except those strict
# confinement can't use. Runs on the Ubuntu 24.04 build computer, which needs
# squashfs-tools, python3-yaml and the core24 snap.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_PATH="${1:?usage: verify-snap-package.sh <voco.snap> <expected-version> <complete.deb>}"
EXPECTED_VERSION="${2:?usage: verify-snap-package.sh <voco.snap> <expected-version> <complete.deb>}"
DEB_PATH="${3:?usage: verify-snap-package.sh <voco.snap> <expected-version> <complete.deb>}"
CORE24="${VOCO_CORE24_ROOT:-/snap/core24/current}"
umask 022

fail() {
  echo "$*" >&2
  exit 1
}

for command in unsquashfs dpkg-deb python3 readelf cmp; do
  command -v "${command}" >/dev/null 2>&1 || fail "Required snap verification command is unavailable: ${command}"
done
python3 -c 'import yaml' 2>/dev/null || fail "Reading the snap's metadata needs PyYAML: sudo apt install python3-yaml"
[[ -d "${CORE24}/usr/lib/x86_64-linux-gnu" ]] \
  || fail "The library check needs the core24 base at ${CORE24}: sudo snap install core24"
[[ -f "${SNAP_PATH}" ]] || fail "Snap not found: ${SNAP_PATH}"
[[ -f "${DEB_PATH}" ]] || fail "Debian package not found: ${DEB_PATH}"
[[ "$(basename -- "${SNAP_PATH}")" == "voco_${EXPECTED_VERSION}_amd64.snap" ]] \
  || fail "Unexpected snap file name: $(basename -- "${SNAP_PATH}")"

EXTRACT_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${EXTRACT_ROOT}"
}
trap cleanup EXIT INT TERM
unsquashfs -no-progress -quiet -dest "${EXTRACT_ROOT}/snap" "${SNAP_PATH}" >/dev/null
dpkg-deb -x "${DEB_PATH}" "${EXTRACT_ROOT}/deb"
SNAP_ROOT="${EXTRACT_ROOT}/snap"
export PYTHONDONTWRITEBYTECODE=1

# Strict on core24 with only the reviewed plugs and the panel slot; the
# reviewed wrappers; and the Debian package's files, without the exclusions.
python3 "${ROOT_DIR}/scripts/snap_package.py" verify-snap \
  "${SNAP_ROOT}/meta/snap.yaml" "${EXPECTED_VERSION}" "${SNAP_ROOT}" "${EXTRACT_ROOT}/deb"
# Every library the private programs and the speech runtime load is in the
# snap's own folders or the core24 base.
python3 "${ROOT_DIR}/scripts/snap_package.py" verify-libraries "${SNAP_ROOT}" "${CORE24}"

# The snap was built from this checkout's recipe, and its launcher entry is
# the packages' with snapcraft's icon.
python3 - "${ROOT_DIR}" "${SNAP_ROOT}" "${EXPECTED_VERSION}" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / "scripts"))
import snap_package
root, snap_root, version = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
summary, text = snap_package.description(snap_root / snap_package.METAINFO)
if (snap_root / "snap/snapcraft.yaml").read_text() != snap_package.render_recipe(version, summary, text):
    raise SystemExit("The snap's snapcraft.yaml isn't this checkout's recipe")
expected = (root / "packaging/tauri/VOCO.desktop").read_text().replace(
    "Icon=voco\n", "Icon=${SNAP}/meta/gui/icon.png\n")
actual = (snap_root / "meta/gui/voco.desktop").read_text()
if [line for line in actual.splitlines() if line] != [line for line in expected.splitlines() if line]:
    raise SystemExit("The snap's launcher entry isn't the packages' with the snap's icon")
PY
cmp "${ROOT_DIR}/apps/desktop/src-tauri/icons/128x128@2x.png" "${SNAP_ROOT}/meta/gui/icon.png"
[[ -f "${SNAP_ROOT}/snap/manifest.yaml" ]] || fail "The snap has no build manifest of its stage packages."

python3 "${ROOT_DIR}/scripts/verify-speech-payload.py" "${SNAP_ROOT}" "${EXPECTED_VERSION}"
for receipt in MODEL-IDENTITY.json NATIVE-BUILD.json; do
  cmp "${ROOT_DIR}/runtime/speech/${receipt}" "${SNAP_ROOT}/usr/lib/voco/speech/${receipt}"
done

echo "Verified VOCO ${EXPECTED_VERSION} snap: strict on core24, the reviewed plugs and panel slot, private Ubuntu programs whose libraries resolve, and the speech payload, with the files of $(basename -- "${DEB_PATH}") except those strict confinement can't use."
