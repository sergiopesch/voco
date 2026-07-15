#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/install-common.sh"

fail() {
  printf 'Installer helper test failed: %s\n' "$*" >&2
  exit 1
}

for hotkey in \
  "Alt+D" \
  "Ctrl+Shift+V" \
  "Option+Shift+T" \
  "commandorctrl + keyv" \
  "Command+D" \
  "Super+F24" \
  "Alt+MediaTrackPrevious" \
  "Ctrl+Shift+Equal" \
  "Ctrl+\\"
do
  if ! voco_validate_hotkey "${hotkey}"; then
    fail "valid hotkey '${hotkey}' was rejected: ${VOCO_HOTKEY_VALIDATION_ERROR}"
  fi
done

for hotkey in \
  "Alt+Shift+R" \
  "shift + alt + keyr" \
  "OPTION+SHIFT+R" \
  "Alt+Alt+Shift+R"
do
  if voco_validate_hotkey "${hotkey}"; then
    fail "reserved realtime alias '${hotkey}' was accepted"
  fi
  if [[ "${VOCO_HOTKEY_VALIDATION_ERROR}" != *"reserved"* ]]; then
    fail "reserved realtime alias '${hotkey}' returned the wrong error"
  fi
done

for hotkey in \
  "" \
  "Alt+" \
  "Ctrl++V" \
  "Ctrl+V+Shift" \
  "Ctrl+NotAKey" \
  "Ctrl+Shift"
do
  if voco_validate_hotkey "${hotkey}"; then
    fail "invalid hotkey '${hotkey}' was accepted"
  fi
done

for hotkey in \
  "D" \
  "Shift+D" \
  "F24" \
  "MediaTrackPrevious" \
  "Shift+Equal"
do
  if voco_validate_hotkey "${hotkey}"; then
    fail "unsafe modifierless hotkey '${hotkey}' was accepted"
  fi
  if [[ "${VOCO_HOTKEY_VALIDATION_ERROR}" != *"must include Alt, Control, or Super"* ]]; then
    fail "unsafe modifierless hotkey '${hotkey}' returned the wrong error"
  fi
done

TEST_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

BOLD=""
DIM=""
GRAPHITE=""
GREEN=""
YELLOW=""
RED=""
WHITE=""
NC=""
ok() { :; }
warn() { :; }
dim() { :; }

export HOME="${TEST_ROOT}/existing-home"
mkdir -p "${HOME}/.config/voco"
cat > "${HOME}/.config/voco/config.json" <<'JSON'
{
  "hotkey": "Ctrl+Shift+V",
  "selectedMic": "custom-device",
  "showHud": false
}
JSON
cp "${HOME}/.config/voco/config.json" "${TEST_ROOT}/expected-config.json"

voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/existing-output.txt"
cmp "${TEST_ROOT}/expected-config.json" "${HOME}/.config/voco/config.json" >/dev/null ||
  fail "non-interactive upgrade rewrote the existing config"
[[ "${VOCO_SELECTED_HOTKEY}" == "Ctrl+Shift+V" ]] ||
  fail "non-interactive upgrade did not retain the configured hotkey"

export HOME="${TEST_ROOT}/new-home"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/new-output.txt"
python3 - "${HOME}/.config/voco/config.json" <<'PY'
import json
import pathlib
import sys

config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if config.get("hotkey") != "Alt+D":
    raise SystemExit("fresh non-interactive install did not write the default hotkey")
PY
[[ "$(stat -c '%a' "${HOME}/.config/voco")" == "700" ]] ||
  fail "fresh config directory is not private"
[[ "$(stat -c '%a' "${HOME}/.config/voco/config.json")" == "600" ]] ||
  fail "fresh config file is not private"

export HOME="${TEST_ROOT}/legacy-home"
mkdir -p "${HOME}/.config/voice"
cat > "${HOME}/.config/voice/config.json" <<'JSON'
{
  "hotkey": "Super+F12",
  "selectedMic": "legacy-device",
  "showHud": false,
  "legacyOnlySetting": "preserve-me"
}
JSON
cp "${HOME}/.config/voice/config.json" "${TEST_ROOT}/expected-legacy-config.json"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/legacy-output.txt"
cmp "${TEST_ROOT}/expected-legacy-config.json" "${HOME}/.config/voice/config.json" >/dev/null ||
  fail "legacy-only migration modified the source config"
cmp "${TEST_ROOT}/expected-legacy-config.json" "${HOME}/.config/voco/config.json" >/dev/null ||
  fail "legacy-only migration did not preserve the complete config"
[[ "${VOCO_SELECTED_HOTKEY}" == "Super+F12" ]] ||
  fail "legacy-only migration did not retain the configured hotkey"
[[ "$(stat -c '%a' "${HOME}/.config/voco")" == "700" ]] ||
  fail "migrated config directory is not private"
[[ "$(stat -c '%a:%h' "${HOME}/.config/voco/config.json")" == "600:1" ]] ||
  fail "migrated config file is not private or has unexpected hard links"
if find "${HOME}/.config/voco" -maxdepth 1 -name '.config.json.migrate.*' -print -quit | grep -q .; then
  fail "legacy-only migration left a temporary config file behind"
fi

export HOME="${TEST_ROOT}/collision-home"
mkdir -p "${HOME}/.config/voco" "${HOME}/.config/voice"
cat > "${HOME}/.config/voco/config.json" <<'JSON'
{
  "hotkey": "Ctrl+Shift+V",
  "selectedMic": "modern-device"
}
JSON
cat > "${HOME}/.config/voice/config.json" <<'JSON'
{
  "hotkey": "Super+F12",
  "selectedMic": "legacy-device"
}
JSON
cp "${HOME}/.config/voco/config.json" "${TEST_ROOT}/expected-modern-collision.json"
cp "${HOME}/.config/voice/config.json" "${TEST_ROOT}/expected-legacy-collision.json"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/collision-output.txt"
cmp "${TEST_ROOT}/expected-modern-collision.json" "${HOME}/.config/voco/config.json" >/dev/null ||
  fail "modern config did not win a legacy migration collision"
cmp "${TEST_ROOT}/expected-legacy-collision.json" "${HOME}/.config/voice/config.json" >/dev/null ||
  fail "legacy config was modified during a migration collision"
[[ "${VOCO_SELECTED_HOTKEY}" == "Ctrl+Shift+V" ]] ||
  fail "migration collision did not retain the modern hotkey"

export HOME="${TEST_ROOT}/legacy-dir-symlink-home"
mkdir -p "${HOME}/.config" "${TEST_ROOT}/legacy-dir-target"
printf '%s\n' '{"hotkey":"Super+F12","sentinel":"untouched"}' > "${TEST_ROOT}/legacy-dir-target/config.json"
cp "${TEST_ROOT}/legacy-dir-target/config.json" "${TEST_ROOT}/expected-legacy-dir-target.json"
ln -s "${TEST_ROOT}/legacy-dir-target" "${HOME}/.config/voice"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/legacy-dir-symlink-output.txt"
cmp "${TEST_ROOT}/expected-legacy-dir-target.json" "${TEST_ROOT}/legacy-dir-target/config.json" >/dev/null ||
  fail "installer modified a config behind a symlinked legacy directory"
python3 - "${HOME}/.config/voco/config.json" <<'PY'
import json
import pathlib
import sys

config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if config.get("hotkey") != "Alt+D" or "sentinel" in config:
    raise SystemExit("installer followed a symlinked legacy directory")
PY

export HOME="${TEST_ROOT}/legacy-file-symlink-home"
mkdir -p "${HOME}/.config/voice"
printf '%s\n' '{"hotkey":"Super+F12","sentinel":"untouched"}' > "${TEST_ROOT}/legacy-file-target.json"
cp "${TEST_ROOT}/legacy-file-target.json" "${TEST_ROOT}/expected-legacy-file-target.json"
ln -s "${TEST_ROOT}/legacy-file-target.json" "${HOME}/.config/voice/config.json"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/legacy-file-symlink-output.txt"
cmp "${TEST_ROOT}/expected-legacy-file-target.json" "${TEST_ROOT}/legacy-file-target.json" >/dev/null ||
  fail "installer modified a config behind a symlinked legacy file"
python3 - "${HOME}/.config/voco/config.json" <<'PY'
import json
import pathlib
import sys

config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if config.get("hotkey") != "Alt+D" or "sentinel" in config:
    raise SystemExit("installer followed a symlinked legacy file")
PY

export HOME="${TEST_ROOT}/legacy-fifo-home"
mkdir -p "${HOME}/.config/voice"
mkfifo "${HOME}/.config/voice/config.json"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/legacy-fifo-output.txt"
[[ -p "${HOME}/.config/voice/config.json" ]] ||
  fail "installer modified a non-regular legacy config"
python3 - "${HOME}/.config/voco/config.json" <<'PY'
import json
import pathlib
import sys

config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if config.get("hotkey") != "Alt+D":
    raise SystemExit("installer did not fall back safely for a non-regular legacy config")
PY

export HOME="${TEST_ROOT}/invalid-home"
mkdir -p "${HOME}/.config/voco"
printf '%s\n' '{not valid json' > "${HOME}/.config/voco/config.json"
cp "${HOME}/.config/voco/config.json" "${TEST_ROOT}/expected-invalid-config"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/invalid-output.txt"
cmp "${TEST_ROOT}/expected-invalid-config" "${HOME}/.config/voco/config.json" >/dev/null ||
  fail "non-interactive upgrade overwrote an unreadable existing config"

export HOME="${TEST_ROOT}/symlink-home"
mkdir -p "${HOME}/.config" "${TEST_ROOT}/symlink-target"
ln -s "${TEST_ROOT}/symlink-target" "${HOME}/.config/voco"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/symlink-output.txt"
[[ ! -e "${TEST_ROOT}/symlink-target/config.json" ]] ||
  fail "installer followed a symlinked config directory"

export HOME="${TEST_ROOT}/config-file-symlink-home"
mkdir -p "${HOME}/.config/voco"
printf '%s\n' '{"sentinel":"untouched"}' > "${TEST_ROOT}/config-file-symlink-target.json"
cp "${TEST_ROOT}/config-file-symlink-target.json" "${TEST_ROOT}/expected-config-file-symlink-target.json"
ln -s "${TEST_ROOT}/config-file-symlink-target.json" "${HOME}/.config/voco/config.json"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/config-file-symlink-output.txt"
cmp "${TEST_ROOT}/expected-config-file-symlink-target.json" "${TEST_ROOT}/config-file-symlink-target.json" >/dev/null ||
  fail "installer followed a symlinked modern config file"
[[ -L "${HOME}/.config/voco/config.json" ]] ||
  fail "installer replaced a symlinked modern config file"

MOCK_BIN="${TEST_ROOT}/mock-package-bin"
MOCK_PACKAGE_STATE="${TEST_ROOT}/mock-voco-package-state"
MOCK_PACKAGE_LOG="${TEST_ROOT}/mock-package.log"
MOCK_DEB="${TEST_ROOT}/voco-test.deb"
ORIGINAL_PATH="${PATH}"
mkdir -p "${MOCK_BIN}"
: > "${MOCK_DEB}"

cat > "${MOCK_BIN}/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
exec "$@"
SH

cat > "${MOCK_BIN}/dpkg" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'dpkg\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
[[ "${1:-}" == "-i" ]] || exit 64
if [[ "${MOCK_DPKG_INSTALL_EXIT:-0}" == "0" ]]; then
  printf 'install ok installed\t%s\t%s\n' \
    "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
  exit 0
fi
printf 'install ok unpacked\t%s\t%s\n' \
  "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
exit "${MOCK_DPKG_INSTALL_EXIT}"
SH

cat > "${MOCK_BIN}/apt-get" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'apt-get\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
if [[ "${MOCK_APT_EXIT:-0}" != "0" ]]; then
  exit "${MOCK_APT_EXIT}"
fi
case "${MOCK_APT_OUTCOME:-installed}" in
  installed)
    printf 'install ok installed\t%s\t%s\n' \
      "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  removed)
    rm -f -- "${MOCK_PACKAGE_STATE:?}"
    ;;
  wrong-version)
    printf 'install ok installed\t2026.0.20\t%s\n' \
      "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  wrong-architecture)
    printf 'install ok installed\t%s\tarm64\n' \
      "${MOCK_EXPECTED_VERSION:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  unpacked)
    printf 'install ok unpacked\t%s\t%s\n' \
      "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  *)
    exit 65
    ;;
esac
SH

cat > "${MOCK_BIN}/dpkg-query" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'dpkg-query\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
[[ -f "${MOCK_PACKAGE_STATE:?}" ]] || exit 1
cat -- "${MOCK_PACKAGE_STATE}"
SH

chmod 0700 "${MOCK_BIN}/sudo" "${MOCK_BIN}/dpkg" "${MOCK_BIN}/apt-get" "${MOCK_BIN}/dpkg-query"
export PATH="${MOCK_BIN}:${ORIGINAL_PATH}"
export MOCK_PACKAGE_STATE MOCK_PACKAGE_LOG
export MOCK_EXPECTED_VERSION="2026.0.21"
export MOCK_EXPECTED_ARCHITECTURE="amd64"

reset_mock_package_case() {
  rm -f -- "${MOCK_PACKAGE_STATE}" "${MOCK_PACKAGE_LOG}"
  export MOCK_DPKG_INSTALL_EXIT=0
  export MOCK_APT_EXIT=0
  export MOCK_APT_OUTCOME=installed
}

reset_mock_package_case
voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}" ||
  fail "verified direct dpkg install was rejected: ${VOCO_INSTALL_ERROR}"
[[ "${VOCO_INSTALL_USED_APT_FIX}" == false ]] ||
  fail "direct dpkg install incorrectly reported dependency repair"
if grep -q '^apt-get' "${MOCK_PACKAGE_LOG}"; then
  fail "direct dpkg success unexpectedly invoked apt dependency repair"
fi

reset_mock_package_case
export MOCK_DPKG_INSTALL_EXIT=1
voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}" ||
  fail "verified apt-repaired install was rejected: ${VOCO_INSTALL_ERROR}"
[[ "${VOCO_INSTALL_USED_APT_FIX}" == true ]] ||
  fail "apt-repaired install did not report dependency repair"
grep -q $'^apt-get\tinstall -f -y -qq$' "${MOCK_PACKAGE_LOG}" ||
  fail "dependency repair did not use the expected apt-get invocation"
grep -q $'^dpkg-query\t-W ' "${MOCK_PACKAGE_LOG}" ||
  fail "apt-repaired install was not verified with dpkg-query"

reset_mock_package_case
export MOCK_DPKG_INSTALL_EXIT=1
export MOCK_APT_OUTCOME=removed
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "apt repair that removed VOCO was accepted"
fi
[[ "${VOCO_INSTALL_ERROR}" == *"is not installed"* ]] ||
  fail "removed VOCO returned an unclear verification error: ${VOCO_INSTALL_ERROR}"

reset_mock_package_case
export MOCK_DPKG_INSTALL_EXIT=1
export MOCK_APT_OUTCOME=wrong-version
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "apt repair that installed the wrong VOCO version was accepted"
fi
[[ "${VOCO_INSTALL_ERROR}" == *"version is 2026.0.20; expected 2026.0.21"* ]] ||
  fail "wrong VOCO version returned an unclear verification error: ${VOCO_INSTALL_ERROR}"

reset_mock_package_case
export MOCK_DPKG_INSTALL_EXIT=1
export MOCK_APT_OUTCOME=wrong-architecture
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "apt repair that installed the wrong VOCO architecture was accepted"
fi
[[ "${VOCO_INSTALL_ERROR}" == *"architecture is arm64; expected amd64"* ]] ||
  fail "wrong VOCO architecture returned an unclear verification error: ${VOCO_INSTALL_ERROR}"

reset_mock_package_case
export MOCK_DPKG_INSTALL_EXIT=1
export MOCK_APT_OUTCOME=unpacked
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "apt repair that left VOCO unpacked was accepted"
fi
[[ "${VOCO_INSTALL_ERROR}" == *"not fully installed"* ]] ||
  fail "unpacked VOCO returned an unclear verification error: ${VOCO_INSTALL_ERROR}"

reset_mock_package_case
export MOCK_DPKG_INSTALL_EXIT=1
export MOCK_APT_EXIT=100
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "failed apt dependency repair was accepted"
fi
[[ "${VOCO_INSTALL_ERROR}" == *"apt could not resolve"* ]] ||
  fail "failed apt repair returned an unclear error: ${VOCO_INSTALL_ERROR}"

export PATH="${ORIGINAL_PATH}"

echo "Installer helper behavior is valid."
