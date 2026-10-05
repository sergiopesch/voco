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

# Wayland paste keys go through VOCO's own virtual keyboard on /dev/uinput.
detect_uinput_access() {
  if [[ ! -e /dev/uinput ]]; then
    echo "missing (uinput module not loaded)"
  elif [[ -r /dev/uinput && -w /dev/uinput ]]; then
    echo "read and write"
  else
    echo "no access for this login"
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
print_row "Automatic text delivery" "Shift+Insert paste into the focused app"
echo
echo "Desktop paste helpers (voco --check-desktop-input checks readiness):"
print_row "/dev/uinput" "$(detect_uinput_access)"
print_row "wl-copy" "$(command_path_or_missing wl-copy)"
print_row "wl-paste" "$(command_path_or_missing wl-paste)"
print_row "xdotool" "$(command_path_or_missing xdotool)"
print_row "xclip" "$(command_path_or_missing xclip)"
