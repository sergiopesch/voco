#!/usr/bin/env bash
# CI's portal suite (AGENTS.md, Delivery): VOCO's own portal code, through the
# lib test binary's portal fixture, against an actual headless GNOME Shell with
# PipeWire, xdg-desktop-portal and its GNOME backend, in a private D-Bus, XDG
# and display namespace.
#   VOCO_PORTAL_TEST_BINARY  the lib test binary (cargo test --lib --no-run)
#   VOCO_PORTAL_EVIDENCE_DIR a fresh directory for logs, screenshots and results
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${VOCO_PORTAL_EVIDENCE_DIR:?Set a fresh evidence directory}"
if [[ ${1:-} != --inside ]]; then
  : "${VOCO_PORTAL_TEST_BINARY:?Set the lib test binary that cargo test --lib --no-run built}"
  [[ -x $VOCO_PORTAL_TEST_BINARY ]] || { echo "Not an executable: $VOCO_PORTAL_TEST_BINARY" >&2; exit 1; }
  [[ ! -e "$VOCO_PORTAL_EVIDENCE_DIR" ]] || { echo 'Evidence directory exists' >&2; exit 1; }
  # The suite runs GNOME 50's portals: GlobalShortcuts came in its GNOME
  # backend's 48, and Shells from 49 on run headless.
  shell_version=$(gnome-shell --version)
  shell_major=${shell_version##* }
  shell_major=${shell_major%%.*}
  [[ $shell_major == 50 ]] || { echo "The portal suite needs GNOME Shell 50: $shell_version" >&2; exit 1; }
  # As in test-gnome-panel.sh: the private dbus-daemon asks AppArmor about each
  # peer through securityfs's query file, which answers and changes nothing.
  apparmor_mounts=()
  apparmor_query=/sys/kernel/security/apparmor/.access
  if [[ -e $apparmor_query && $(bwrap --ro-bind / / cat /proc/self/attr/current 2>/dev/null) != unconfined* ]]; then
    apparmor_mounts=(--bind "$apparmor_query" "$apparmor_query")
  fi
  run=$(mktemp -d)
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$run/runtime" "$run/state"
  cp --reflink=auto "$VOCO_PORTAL_TEST_BINARY" "$run/portal-test"
  mkdir -p "$run/data/gnome-shell/extensions"
  cp -a "$ROOT/scripts/fixtures/gnome-portal-probe" "$run/data/gnome-shell/extensions/voco-portal-probe@test.invalid"
  trap 'status=$?; mkdir -p "$VOCO_PORTAL_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_PORTAL_EVIDENCE_DIR/"; echo "$status" > "$VOCO_PORTAL_EVIDENCE_DIR/exit-code"; rm -rf "$run"; exit "$status"' EXIT
  source "$ROOT/scripts/lib/test-sandbox.sh"
  voco_bwrap "$run" "${apparmor_mounts[@]}" -- bash "${BASH_SOURCE[0]}" --inside "$run"
  exit
fi
run=${2:?}
# VOCO runs as the snap here (SNAP_NAME=voco) without snapd, so it asks this
# stand-in whether its plugs are connected: the store auto-connects both, and a
# host's real snapctl, as on GitHub's runners, would answer for no snap at all.
mkdir -p "$run/bin"
printf '%s\n' '#!/bin/sh' 'case "$1 $2" in "is-connected login-session-observe"|"is-connected audio-record") exit 0 ;; esac' 'exit 1' > "$run/bin/snapctl"
chmod 755 "$run/bin/snapctl"
export PATH="$run/bin:/usr/bin:/bin" LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=ubuntu:GNOME GNOME_SHELL_SESSION_MODE=user
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-gnome-portals.py" "$run"
