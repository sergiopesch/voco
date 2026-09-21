#!/usr/bin/env bash
# Actual GNOME Shell, synthetic app status, private D-Bus/XDG/display namespace.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${VOCO_PANEL_EVIDENCE_DIR:?Set a fresh evidence directory}"
: "${VOCO_NATIVE_DEPS:?Set extracted Xvfb root/usr}"
if [[ ${1:-} != --inside ]]; then
  [[ ! -e "$VOCO_PANEL_EVIDENCE_DIR" ]] || { echo 'Evidence directory exists' >&2; exit 1; }
  run=$(mktemp -d)
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$run/runtime"
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
    cp -a "$ROOT/integrations/gnome/voco-panel@voco.local" "$run/data/gnome-shell/extensions/"
  fi
  cp -a "$ROOT/scripts/fixtures/gnome-panel-probe" "$run/data/gnome-shell/extensions/voco-panel-probe@test.invalid"
  trap 'status=$?; mkdir -p "$VOCO_PANEL_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_PANEL_EVIDENCE_DIR/"; echo "$status" > "$VOCO_PANEL_EVIDENCE_DIR/exit-code"; rm -rf "$run"; exit "$status"' EXIT
  package_mounts=()
  if [[ -n ${VOCO_PANEL_PACKAGE_ROOT:-} ]]; then
    package_mounts=(--bind "$run/system-extensions" /usr/share/gnome-shell/extensions
      --ro-bind "$VOCO_PANEL_PACKAGE_ROOT/usr/lib/voco/speech" /usr/lib/voco/speech)
  fi
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$run" "$run" --ro-bind "$VOCO_NATIVE_DEPS" /tmp/native-deps \
    "${package_mounts[@]}" \
    --setenv HOME "$run/home" --setenv XDG_RUNTIME_DIR "$run/runtime" \
    --setenv XDG_CONFIG_HOME "$run/config" --setenv XDG_CACHE_HOME "$run/cache" \
    --setenv XDG_DATA_HOME "$run/data" --setenv XDG_STATE_HOME "$run/state" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv DBUS_SYSTEM_BUS_ADDRESS --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY --unsetenv PULSE_SERVER \
    bash "${BASH_SOURCE[0]}" --inside "$run"
  exit
fi
run=${2:?}
export PATH=/usr/bin:/bin LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=ubuntu:GNOME GNOME_SHELL_SESSION_MODE=user
LD_LIBRARY_PATH=/tmp/native-deps/lib/x86_64-linux-gnu /tmp/native-deps/bin/Xvfb :77 -screen 0 1280x720x24 -nolisten tcp >"$run/evidence/xvfb.log" 2>&1 &
for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X77 ]] && break; sleep .05; done
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-gnome-panel.py" "$run"
