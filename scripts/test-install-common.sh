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
  if ! voco_validate_hotkey "${hotkey}"; then
    fail "dictation alias '${hotkey}' was rejected"
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
unset XDG_CONFIG_HOME

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

export HOME="${TEST_ROOT}/config-directory-file-home"
mkdir -p "${HOME}/.config"
printf sentinel > "${HOME}/.config/voco"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/config-directory-file-output.txt"
[[ "$(cat "${HOME}/.config/voco")" == sentinel ]] ||
  fail "installer modified a regular file at the config directory path"

export HOME="${TEST_ROOT}/xdg-home"
export XDG_CONFIG_HOME="${TEST_ROOT}/xdg-config"
mkdir -p "${XDG_CONFIG_HOME}/voice"
printf '%s\n' '{"hotkey":"Super+F12","selectedMic":"xdg-device"}' > "${XDG_CONFIG_HOME}/voice/config.json"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/xdg-output.txt"
cmp "${XDG_CONFIG_HOME}/voice/config.json" "${XDG_CONFIG_HOME}/voco/config.json" >/dev/null ||
  fail "installer did not migrate legacy settings within XDG_CONFIG_HOME"
[[ "${VOCO_SELECTED_HOTKEY}" == "Super+F12" && "${VOCO_CONFIG_FILE}" == "${XDG_CONFIG_HOME}/voco/config.json" ]] ||
  fail "installer did not use the application's XDG config path"
[[ ! -e "${HOME}/.config/voco" ]] || fail "XDG setup wrote to the default config path"
export XDG_CONFIG_HOME="${TEST_ROOT}/xdg-fresh-config"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/xdg-fresh-output.txt"
[[ -f "${XDG_CONFIG_HOME}/voco/config.json" ]] || fail "fresh XDG setup did not create settings"
export XDG_CONFIG_HOME="relative-is-not-an-xdg-base"
voco_run_hotkey_setup "Alt+D" </dev/null > "${TEST_ROOT}/relative-xdg-output.txt"
[[ "${VOCO_CONFIG_FILE}" == "${HOME}/.config/voco/config.json" ]] ||
  fail "relative XDG_CONFIG_HOME was not ignored like the application"
unset XDG_CONFIG_HOME

# Inline Python may run from a download directory containing unrelated Python
# files. Neither the current directory nor PYTHONPATH can replace its stdlib.
mkdir "${TEST_ROOT}/python-shadow"
printf 'raise RuntimeError("untrusted json module loaded")\n' > "${TEST_ROOT}/python-shadow/json.py"
if ! hotkey="$(cd "${TEST_ROOT}/python-shadow" && PYTHONPATH=. voco_read_configured_hotkey "${HOME}/.config/voco/config.json")"; then
  fail "config reader imported Python code from the working directory or PYTHONPATH"
fi
[[ "$hotkey" == "Alt+D" ]] || fail "isolated config reader returned the wrong hotkey"

# Reproduce publication races at the helper boundary: a config or link appearing
# after the initial setup check must never be overwritten or chmodded.
config_file="${TEST_ROOT}/concurrent-config.json"
printf sentinel > "$config_file"
chmod 0640 "$config_file"
if voco_write_default_config "$config_file" "Alt+D"; then fail "fresh defaults replaced a concurrent config"; fi
[[ "$(cat "$config_file")" == sentinel && "$(stat -c '%a' "$config_file")" == 640 ]] ||
  fail "fresh defaults changed a concurrent config"
ln -s "$config_file" "${TEST_ROOT}/concurrent-link.json"
if voco_write_default_config "${TEST_ROOT}/concurrent-link.json" "Alt+D"; then fail "fresh defaults followed a concurrent symlink"; fi
[[ "$(cat "$config_file")" == sentinel ]] || fail "fresh defaults modified the symlink target"
mkdir "${TEST_ROOT}/concurrent-dir"
if voco_write_default_config "${TEST_ROOT}/concurrent-dir" "Alt+D"; then fail "fresh defaults wrote inside a concurrent directory"; fi
[[ -z "$(find "${TEST_ROOT}/concurrent-dir" -mindepth 1 -print -quit)" ]] ||
  fail "fresh defaults created a file inside a concurrent directory"
[[ -z "$(find "${TEST_ROOT}" -name '*.new.*' -print -quit)" ]] ||
  fail "default config publication left temporary files"

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

# APT must receive the local package and the Wayland helpers in one transaction,
# even when all hard package dependencies are already installed.
for session in x11 wayland; do
  reset_mock_package_case
  export XDG_SESSION_TYPE="$session"
  voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}" ||
    fail "APT install was rejected: ${VOCO_INSTALL_ERROR}"
  grep -Fq "install -y -- ${MOCK_DEB}" "${MOCK_PACKAGE_LOG}" ||
    fail "installer did not ask APT to resolve the local package through APT"
  if [[ "$session" == wayland ]]; then
    grep -Fq "${MOCK_DEB} ydotool ydotoold" "${MOCK_PACKAGE_LOG}" ||
      fail "Wayland helpers were not explicitly installed"
  elif grep -q 'ydotool' "${MOCK_PACKAGE_LOG}"; then
    fail "X11 installation required Wayland-only packages"
  fi
  if grep -q '^dpkg\s' "${MOCK_PACKAGE_LOG}"; then
    fail "installer bypassed APT dependency resolution"
  fi
done

for outcome in removed wrong-version wrong-architecture unpacked; do
  reset_mock_package_case
  export MOCK_APT_OUTCOME="$outcome"
  if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
    fail "APT result $outcome was incorrectly accepted"
  fi
  [[ -n "$VOCO_INSTALL_ERROR" ]] || fail "Missing package verification error"
done
reset_mock_package_case
export MOCK_APT_EXIT=100
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "Failed APT installation was accepted"
fi
[[ "$VOCO_INSTALL_ERROR" == *APT* ]] || fail "APT failure returned an unclear error"
cat > "${MOCK_BIN}/voco" <<'SH'
#!/usr/bin/env bash
[[ "$*" == --check-desktop-input ]] || exit 64
if [[ "${MOCK_INPUT_READY}" != true && ! -f "${MOCK_INPUT_READY_FILE:-/nonexistent}" ]]; then echo "Start ydotoold for this login." >&2; exit 1; fi
echo "Desktop input is ready."
SH
chmod 0700 "${MOCK_BIN}/voco"
# Shadow only the packaged command; a PATH-installed legacy VOCO must never run.
/usr/bin/voco() { "${MOCK_BIN}/voco" "$@"; }
voco() { fail "Readiness used a PATH VOCO instead of the verified package"; }
export MOCK_INPUT_READY=false
if voco_verify_desktop_input; then fail "Installer accepted incomplete desktop setup"; fi
[[ "$VOCO_INPUT_ERROR" == 'Start ydotoold for this login.' ]] || fail "Lost the actionable input error"
export MOCK_INPUT_READY=true
voco_verify_desktop_input || fail "Installer rejected repaired input setup"
export MOCK_INPUT_READY_FILE="${TEST_ROOT}/input-ready"
cat > "${MOCK_BIN}/systemctl" <<'SH'
#!/usr/bin/env bash
printf 'systemctl\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
[[ "${MOCK_SERVICE_FAIL:-false}" == false ]] || exit 1
touch "${MOCK_INPUT_READY_FILE}"
SH
cat > "${MOCK_BIN}/pgrep" <<'SH'
#!/usr/bin/env bash
[[ "${MOCK_DAEMON_RUNNING:-false}" == true ]]
SH
chmod 0700 "${MOCK_BIN}/systemctl" "${MOCK_BIN}/pgrep"
voco_wayland_device_access() { [[ "${MOCK_DEVICE_ACCESS:-false}" == true ]]; }
export XDG_SESSION_TYPE=wayland MOCK_INPUT_READY=false MOCK_DEVICE_ACCESS=false MOCK_DAEMON_RUNNING=false
: > "$MOCK_PACKAGE_LOG"
if voco_start_wayland_service; then fail "Service started without device access"; fi
[[ "$VOCO_INPUT_ERROR" == *'/dev/uinput'* ]] || fail "Missing device guidance"
[[ ! -s "$MOCK_PACKAGE_LOG" ]] || fail "Missing access changed services"
export MOCK_DEVICE_ACCESS=true MOCK_DAEMON_RUNNING=true
if voco_start_wayland_service; then fail "Replaced an inaccessible existing daemon"; fi
[[ ! -s "$MOCK_PACKAGE_LOG" ]] || fail "Existing daemon changed services"
export MOCK_DAEMON_RUNNING=false MOCK_SERVICE_FAIL=true
if voco_start_wayland_service; then fail "Accepted a failed service start"; fi
export MOCK_SERVICE_FAIL=false
voco_start_wayland_service || fail "Could not start service with existing device access"
grep -Fq 'enable --now voco-ydotoold.service' "$MOCK_PACKAGE_LOG" || fail "Wrong service activation"
: > "$MOCK_PACKAGE_LOG"
export MOCK_DEVICE_ACCESS=false
voco_start_wayland_service || fail "Working existing daemon was not reused"
[[ ! -s "$MOCK_PACKAGE_LOG" ]] || fail "Working daemon was reconfigured"
rm -f "$MOCK_INPUT_READY_FILE"
export XDG_SESSION_TYPE=x11
voco_start_wayland_service || fail "X11 tried to configure Wayland service"
[[ ! -s "$MOCK_PACKAGE_LOG" ]] || fail "X11 changed Wayland services"
export PATH="${ORIGINAL_PATH}"
echo "Installer helper behavior is valid."
