#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" != "--inside" ]]; then
  TEST_ROOT="$(mktemp -d)"
  chmod 0700 "${TEST_ROOT}"
  cleanup_outer() {
    rm -rf "${TEST_ROOT}"
  }
  trap cleanup_outer EXIT INT TERM

  /usr/bin/python3 "${ROOT_DIR}/scripts/test-private-ibus-engine.py" \
    --prepare-component \
    "${ROOT_DIR}/packaging/ibus/voco.xml" \
    "${TEST_ROOT}/component/voco.xml" \
    "${ROOT_DIR}/apps/desktop/src-tauri/resources/voco_ibus_engine.py"
  install -m 0644 /usr/share/ibus/component/simple.xml \
    "${TEST_ROOT}/component/simple.xml"

  bwrap \
    --die-with-parent \
    --new-session \
    --unshare-ipc \
    --unshare-net \
    --unshare-pid \
    --unshare-uts \
    --ro-bind / / \
    --dev-bind /dev /dev \
    --proc /proc \
    --bind "${TEST_ROOT}" "${TEST_ROOT}" \
    --ro-bind "${TEST_ROOT}/component" /usr/share/ibus/component \
    --unsetenv DISPLAY \
    --unsetenv WAYLAND_DISPLAY \
    --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv IBUS_ADDRESS \
    "${BASH_SOURCE[0]}" --inside "${TEST_ROOT}"
  exit
fi

TEST_ROOT="${2:?missing private test root}"
IBUS_PID=""

cleanup_inner() {
  local status=$?
  if [[ ${status} -ne 0 ]] && [[ -f "${TEST_ROOT}/ibus.log" ]]; then
    sed -n '1,160p' "${TEST_ROOT}/ibus.log" >&2
  fi
  if [[ -n "${IBUS_PID}" ]] && kill -0 "${IBUS_PID}" 2>/dev/null; then
    kill "${IBUS_PID}" 2>/dev/null || true
    wait "${IBUS_PID}" 2>/dev/null || true
  fi
}
trap cleanup_inner EXIT INT TERM

mkdir -p "${TEST_ROOT}/home" "${TEST_ROOT}/runtime" "${TEST_ROOT}/config" "${TEST_ROOT}/cache"
chmod 0700 "${TEST_ROOT}/home" "${TEST_ROOT}/runtime" "${TEST_ROOT}/config" "${TEST_ROOT}/cache"

export HOME="${TEST_ROOT}/home"
export XDG_RUNTIME_DIR="${TEST_ROOT}/runtime"
export XDG_CONFIG_HOME="${TEST_ROOT}/config"
export XDG_CACHE_HOME="${TEST_ROOT}/cache"
export IBUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/private-ibus.sock"
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS

ibus-daemon \
  --single \
  --panel=disable \
  --config=disable \
  --emoji-extension=disable \
  --address="${IBUS_ADDRESS}" \
  --cache=none \
  --verbose \
  >"${TEST_ROOT}/ibus.log" 2>&1 &
IBUS_PID=$!

for _attempt in $(seq 1 100); do
  [[ -S "${XDG_RUNTIME_DIR}/private-ibus.sock" ]] && break
  kill -0 "${IBUS_PID}" 2>/dev/null || exit 1
  sleep 0.02
done

[[ -S "${XDG_RUNTIME_DIR}/private-ibus.sock" ]] || {
  echo "Private IBus daemon did not create its isolated socket." >&2
  exit 1
}

/usr/bin/python3 "${ROOT_DIR}/scripts/test-private-ibus-engine.py"

if rg -q 'stable provisional|focus-owned tail|authoritative mismatch|exact authoritative final|delayed final|key-owned tail|reset-owned tail|selection-owned tail|destroy-owned tail|disconnect-owned tail|stale tail|canonical draft|canonical checkpoint|canonical final|wrong canonical prefix|forbidden append|canonical preserved|canonical canceled draft' \
  "${TEST_ROOT}/ibus.log"; then
  echo "Private IBus test log exposed transcript text." >&2
  exit 1
fi
