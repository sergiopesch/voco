#!/usr/bin/env bash
# Actual GNOME Shell, synthetic app status, private D-Bus/XDG/display namespace.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${VOCO_PANEL_EVIDENCE_DIR:?Set a fresh evidence directory}"
if [[ ${1:-} != --inside ]]; then
  [[ ! -e "$VOCO_PANEL_EVIDENCE_DIR" ]] || { echo 'Evidence directory exists' >&2; exit 1; }
  # bridge skips the synthetic cases and checks only the app's tray bridge.
  suite=${VOCO_PANEL_SUITE:-full}
  [[ $suite == full || $suite == bridge ]] || { echo "Unknown VOCO_PANEL_SUITE: $suite" >&2; exit 1; }
  [[ $suite == full || -n ${VOCO_PANEL_APP_BINARY:-}${VOCO_PANEL_PACKAGE_ROOT:-} ]] \
    || { echo 'VOCO_PANEL_SUITE=bridge needs VOCO_PANEL_APP_BINARY or VOCO_PANEL_PACKAGE_ROOT' >&2; exit 1; }
  # GNOME 49 removed the nested backend. GNOME 46 and 48 nest in a private
  # Xvfb; later Shells run headless on a virtual monitor instead.
  shell_version=$(gnome-shell --version)
  shell_major=${shell_version##* }
  shell_major=${shell_major%%.*}
  [[ $shell_major =~ ^[0-9]+$ ]] || { echo "Unrecognised GNOME Shell version: $shell_version" >&2; exit 1; }
  shell_mode=nested
  (( shell_major < 49 )) || shell_mode=headless
  native_mounts=()
  if [[ $shell_mode == nested ]]; then
    : "${VOCO_NATIVE_DEPS:?Set extracted Xvfb root/usr}"
    native_mounts=(--ro-bind "$VOCO_NATIVE_DEPS" /tmp/native-deps)
  fi
  # Ubuntu 25.04 and later confine bwrap's children with AppArmor, so the
  # private dbus-daemon asks AppArmor about each peer through securityfs's
  # world-writable query file, which the read-only root would refuse. That
  # file answers policy questions and changes nothing.
  apparmor_mounts=()
  apparmor_query=/sys/kernel/security/apparmor/.access
  if [[ -e $apparmor_query && $(bwrap --ro-bind / / cat /proc/self/attr/current 2>/dev/null) != unconfined* ]]; then
    apparmor_mounts=(--bind "$apparmor_query" "$apparmor_query")
  fi
  run=$(mktemp -d)
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$run/runtime" "$run/state"
  if [[ -n ${VOCO_PANEL_APP_BINARY:-} ]]; then
    cp --reflink=auto "$VOCO_PANEL_APP_BINARY" "$run/voco"
  fi
  if [[ -n ${VOCO_PANEL_PACKAGE_ROOT:-} ]]; then
    cp --reflink=auto "$VOCO_PANEL_PACKAGE_ROOT/usr/bin/voco" "$run/voco"
    cp -a "$VOCO_PANEL_PACKAGE_ROOT/usr/share/gnome-shell/extensions/voco-panel@voco.local" "$run/panel-payload"
    mkdir -p "$run/system-extensions"
    cp -a /usr/share/gnome-shell/extensions/ubuntu-appindicators@ubuntu.com "$run/system-extensions/"
  fi
  mkdir -p "$run/data/gnome-shell/extensions"
  if [[ -z ${VOCO_PANEL_PACKAGE_ROOT:-} ]]; then
    cp -a "${VOCO_PANEL_SOURCE_DIR:-$ROOT/integrations/gnome/voco-panel@voco.local}" "$run/data/gnome-shell/extensions/voco-panel@voco.local"
  fi
  cp -a "$ROOT/scripts/fixtures/gnome-panel-probe" "$run/data/gnome-shell/extensions/voco-panel-probe@test.invalid"
  trap 'status=$?; mkdir -p "$VOCO_PANEL_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_PANEL_EVIDENCE_DIR/"; echo "$status" > "$VOCO_PANEL_EVIDENCE_DIR/exit-code"; rm -rf "$run"; exit "$status"' EXIT
  package_mounts=()
  if [[ -n ${VOCO_PANEL_PACKAGE_ROOT:-} ]]; then
    package_mounts=(--bind "$run/system-extensions" /usr/share/gnome-shell/extensions
      --ro-bind "$VOCO_PANEL_PACKAGE_ROOT/usr/lib/voco/speech" /usr/lib/voco/speech)
  fi
  source "$ROOT/scripts/lib/test-sandbox.sh"
  voco_bwrap "$run" "${native_mounts[@]}" "${apparmor_mounts[@]}" "${package_mounts[@]}" \
    --setenv VOCO_PANEL_SHELL_MODE "$shell_mode" --setenv VOCO_PANEL_SUITE "$suite" \
    -- bash "${BASH_SOURCE[0]}" --inside "$run"
  exit
fi
run=${2:?}
export PATH=/usr/bin:/bin LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=ubuntu:GNOME GNOME_SHELL_SESSION_MODE=user
if [[ $VOCO_PANEL_SHELL_MODE == nested ]]; then
  LD_LIBRARY_PATH=/tmp/native-deps/lib/x86_64-linux-gnu /tmp/native-deps/bin/Xvfb :77 -screen 0 1280x720x24 -nolisten tcp >"$run/evidence/xvfb.log" 2>&1 &
  for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X77 ]] && break; sleep .05; done
fi
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-gnome-panel.py" "$run"
