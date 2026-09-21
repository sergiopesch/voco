#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USERNS_POLICY="/proc/sys/kernel/apparmor_restrict_unprivileged_userns"
ORIGINAL_USERNS_POLICY=""
case "${1:-}" in
  "") TEST_SCRIPT="test-private-ibus-engine.sh" ;;
  --rich-editor) TEST_SCRIPT="test-rich-editor-delivery.sh" ;;
  --native-desktop) TEST_SCRIPT="test-native-desktop.sh" ;;
  --native-wayland)
    : "${VOCO_WAYLAND_DEPS:?Set the installed or extracted Weston root/usr}"
    : "${VOCO_WAYLAND_EVIDENCE_DIR:?Set a directory for Wayland evidence}"
    TEST_SCRIPT="test-native-wayland.sh"
    ;;
  --browser-application)
    : "${VOCO_BROWSER_HOST_BINARY:?Set the packaged native host executable}"
    : "${VOCO_BROWSER_EXTENSION_DIR:?Set the packaged Chromium extension directory}"
    : "${VOCO_NATIVE_APP_BINARY:?Set the built candidate executable}"
    : "${VOCO_NATIVE_MODEL:?Set the pinned existing model}"
    : "${VOCO_BROWSER_EVIDENCE_DIR:?Set a directory for browser application evidence}"
    TEST_SCRIPT="test-browser-full-app.sh"
    ;;
  --full-application)
    : "${VOCO_NATIVE_APP_BINARY:?Set the built candidate executable}"
    : "${VOCO_NATIVE_MODEL:?Set the pinned existing model}"
    : "${VOCO_NATIVE_EVIDENCE_DIR:?Set a directory for native application evidence}"
    TEST_SCRIPT="test-native-desktop.sh"
    ;;
  *) echo "Unknown hosted IBus test selection: $1" >&2; exit 1 ;;
esac

if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "The hosted IBus wrapper may run only on an ephemeral GitHub Actions runner." >&2
  exit 1
fi

restore_userns_policy() {
  local status=$?
  trap - EXIT
  if [[ -n "${ORIGINAL_USERNS_POLICY}" ]]; then
    sudo -n sysctl -q -w \
      "kernel.apparmor_restrict_unprivileged_userns=${ORIGINAL_USERNS_POLICY}" \
      >/dev/null
  fi
  exit "${status}"
}
trap restore_userns_policy EXIT

# Ubuntu 24.04's hosted-runner AppArmor policy can deny Bubblewrap's
# loopback setup. Relax only that ephemeral policy for this test, then restore
# it even when the test fails. Bubblewrap still creates private user, network,
# mount, IPC, PID, and UTS namespaces in test-private-ibus-engine.sh.
if [[ -r "${USERNS_POLICY}" ]]; then
  current_userns_policy="$(<"${USERNS_POLICY}")"
  if [[ "${current_userns_policy}" == "1" ]]; then
    ORIGINAL_USERNS_POLICY="${current_userns_policy}"
    sudo -n sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0 \
      >/dev/null
  fi
fi

if [[ "${1:-}" == --browser-application ]]; then
  browser_evidence="${VOCO_BROWSER_EVIDENCE_DIR}"
  VOCO_NATIVE_OUTPUT_MODE=final-text-only VOCO_BROWSER_LONG_CAPTURE=0 \
    VOCO_BROWSER_EVIDENCE_DIR="${browser_evidence}/final-text-only" \
    bash "${ROOT_DIR}/scripts/${TEST_SCRIPT}"
  VOCO_NATIVE_OUTPUT_MODE=stable-cursor-streaming VOCO_BROWSER_LONG_CAPTURE=1 VOCO_BROWSER_DEBUG_CAPTURE=1 \
    VOCO_BROWSER_EVIDENCE_DIR="${browser_evidence}/canonical-checkpoint" \
    bash "${ROOT_DIR}/scripts/${TEST_SCRIPT}"
elif [[ "${1:-}" == --full-application ]]; then
  application_evidence="${VOCO_NATIVE_EVIDENCE_DIR}"
  for output_mode in final-text-only stable-cursor-streaming; do
    VOCO_NATIVE_APP_CASE=delivery VOCO_NATIVE_OUTPUT_MODE="${output_mode}" \
      VOCO_NATIVE_EVIDENCE_DIR="${application_evidence}/${output_mode}" \
      PYTHONDONTWRITEBYTECODE=1 bash "${ROOT_DIR}/scripts/${TEST_SCRIPT}"
  done
  VOCO_NATIVE_APP_CASE=focus-switch VOCO_NATIVE_OUTPUT_MODE=final-text-only \
    VOCO_NATIVE_EVIDENCE_DIR="${application_evidence}/focus-manual-copy" \
    PYTHONDONTWRITEBYTECODE=1 bash "${ROOT_DIR}/scripts/${TEST_SCRIPT}"
else
  PYTHONDONTWRITEBYTECODE=1 bash "${ROOT_DIR}/scripts/${TEST_SCRIPT}"
fi
