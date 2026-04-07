#!/usr/bin/env bash
set -euo pipefail

socket_dir="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}/voco-$(id -u)}"
socket_path="${socket_dir}/voco.sock"

print_row() {
  printf '%-24s %s\n' "$1" "$2"
}

command_path_or_missing() {
  local name="$1"
  if command -v "${name}" >/dev/null 2>&1; then
    command -v "${name}"
  else
    echo "missing"
  fi
}

detect_distro() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${PRETTY_NAME:-${NAME:-unknown}}"
    return
  fi

  echo "unknown"
}

detect_input_group() {
  if id -nG | tr ' ' '\n' | grep -qx 'input'; then
    echo "yes"
  else
    echo "no"
  fi
}

detect_ydotoold_status() {
  if ! command -v ydotoold >/dev/null 2>&1; then
    if command -v ydotool >/dev/null 2>&1; then
      echo "not installed (only required for ydotool v1.x)"
    else
      echo "not installed"
    fi
    return
  fi

  if command -v systemctl >/dev/null 2>&1; then
    local unit_state
    unit_state="$(systemctl --user is-active ydotoold 2>/dev/null || true)"
    if [[ -n "${unit_state}" ]]; then
      echo "${unit_state}"
      return
    fi
  fi

  if pgrep -x ydotoold >/dev/null 2>&1; then
    echo "running"
  else
    echo "installed, not detected"
  fi
}

echo "VOCO Linux runtime report"
echo
print_row "Timestamp" "$(date -Is)"
print_row "Distro" "$(detect_distro)"
print_row "Kernel" "$(uname -srmo)"
print_row "Desktop" "${XDG_CURRENT_DESKTOP:-unknown}"
print_row "Session" "${XDG_SESSION_TYPE:-unknown}"
print_row "Display server" "${WAYLAND_DISPLAY:-${DISPLAY:-unavailable}}"
print_row "Runtime dir" "${XDG_RUNTIME_DIR:-unset (using private tmp fallback)}"
print_row "Socket path" "${socket_path}"
print_row "Input group" "$(detect_input_group)"
echo
print_row "ydotool" "$(command_path_or_missing ydotool)"
print_row "ydotoold" "$(detect_ydotoold_status)"
print_row "wl-copy" "$(command_path_or_missing wl-copy)"
print_row "wl-paste" "$(command_path_or_missing wl-paste)"
print_row "xdotool" "$(command_path_or_missing xdotool)"
print_row "xclip" "$(command_path_or_missing xclip)"
