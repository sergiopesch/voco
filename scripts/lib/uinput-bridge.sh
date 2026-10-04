#!/usr/bin/env bash
# Sourced only by disposable desktop harnesses, outside their bwrap namespace.
# scripts/fixtures/uinput-bridge.py refuses to run unless VOCO_UINPUT_BRIDGE=1
# and no graphical session exists; it must be running before a namespace gets
# /dev/uinput, so that no VOCO keyboard ever goes ungrabbed.

# voco_start_uinput_bridge LOG BRIDGE-ARGUMENT...: start the bridge and wait
# until it is watching for VOCO keyboards.
voco_start_uinput_bridge() {
  local log=$1 attempt
  [[ -c /dev/uinput && -r /dev/uinput && -w /dev/uinput ]] || {
    echo 'Bridged suites need read and write access to /dev/uinput (sudo modprobe uinput, then an ACL for this user)' >&2
    return 1
  }
  /usr/bin/python3 -I "$(dirname "${BASH_SOURCE[0]}")/../fixtures/uinput-bridge.py" --log "$log" "${@:2}" &
  voco_uinput_bridge=$!
  for ((attempt = 0; attempt < 250; attempt++)); do
    grep -qs '"event": "ready"' "$log" && return 0
    kill -0 "$voco_uinput_bridge" 2> /dev/null || break
    sleep .02
  done
  echo 'The uinput bridge did not start' >&2
  return 1
}

# voco_stop_uinput_bridge: stop the bridge; fails if it rejected or lost a key.
voco_stop_uinput_bridge() {
  local status=0
  [[ -n ${voco_uinput_bridge:-} ]] || return 0
  kill -TERM "$voco_uinput_bridge" 2> /dev/null || true
  wait "$voco_uinput_bridge" || status=$?
  voco_uinput_bridge=
  return "$status"
}
