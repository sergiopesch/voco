#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USERNS_POLICY="/proc/sys/kernel/apparmor_restrict_unprivileged_userns"
ORIGINAL_USERNS_POLICY=""

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

PYTHONDONTWRITEBYTECODE=1 bash "${ROOT_DIR}/scripts/test-private-ibus-engine.sh"
