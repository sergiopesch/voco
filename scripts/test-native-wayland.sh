#!/usr/bin/env bash
# Native Wayland toolkit/lifecycle smoke; no microphone or active desktop access.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} != --inside ]]; then
  : "${VOCO_WAYLAND_DEPS:?Set extracted Weston root/usr}"
  : "${VOCO_WAYLAND_EVIDENCE_DIR:?Set evidence directory}"
  backend=${VOCO_WAYLAND_BACKEND:-headless}
  case "$backend" in headless|nested-x11) ;; *) echo "Unsupported private Wayland backend" >&2; exit 1 ;; esac
  if [[ "$backend" == nested-x11 ]]; then
    : "${VOCO_NATIVE_DEPS:?Nested backend requires extracted Xvfb dependencies}"
  fi
  run=$(mktemp -d)
  trap 'status=$?; /usr/bin/python3 "$ROOT/scripts/test-native-wayland.py" "$run" --manifest "$status"; mkdir -p "$VOCO_WAYLAND_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_WAYLAND_EVIDENCE_DIR/"; rm -rf "$run"; exit "$status"' EXIT
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence,pulse}
  chmod 700 "$run/runtime" "$run/pulse"
  if [[ -n ${VOCO_WAYLAND_APP_BINARY:-} ]]; then
    [[ -f "$VOCO_WAYLAND_APP_BINARY" && -x "$VOCO_WAYLAND_APP_BINARY" ]] || { echo "App must be an executable file" >&2; exit 1; }
    cp "$VOCO_WAYLAND_APP_BINARY" "$run/voco"
    source "$(dirname "${BASH_SOURCE[0]}")/lib/test-speech-runtime.sh"
    voco_stage_test_speech "$run"
  fi
  source "$(dirname "${BASH_SOURCE[0]}")/lib/test-sandbox.sh"
  voco_bwrap "$run" --ro-bind "$VOCO_WAYLAND_DEPS" /tmp/wayland-deps \
    --ro-bind "${VOCO_NATIVE_DEPS:-/usr}" /tmp/native-deps \
    --dir "/run/user/$(id -u)" --bind "$run/pulse" "/run/user/$(id -u)/pulse" \
    -- bash "${BASH_SOURCE[0]}" --inside "$run"
  exit
fi
run=${2:?}
export PATH=/tmp/wayland-deps/bin:/usr/bin:/bin
export LD_LIBRARY_PATH=/tmp/wayland-deps/lib/x86_64-linux-gnu:/tmp/wayland-deps/lib/x86_64-linux-gnu/weston
export XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland WAYLAND_DISPLAY=voco-private
export LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo
export WESTON_MODULE_MAP="headless-backend.so=/tmp/wayland-deps/lib/x86_64-linux-gnu/libweston-13/headless-backend.so;kiosk-shell.so=/tmp/wayland-deps/lib/x86_64-linux-gnu/weston/kiosk-shell.so"
if [[ ${VOCO_WAYLAND_BACKEND:-headless} == nested-x11 ]]; then
  export WESTON_MODULE_MAP="$WESTON_MODULE_MAP;x11-backend.so=/tmp/wayland-deps/lib/x86_64-linux-gnu/libweston-13/x11-backend.so"
  LD_LIBRARY_PATH="/tmp/native-deps/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH" /tmp/native-deps/bin/Xvfb :77 -screen 0 1280x900x24 -nolisten tcp >"$run/evidence/nested-xvfb.log" 2>&1 &
  for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X77 ]] && break; sleep .05; done
  [[ -S /tmp/.X11-unix/X77 ]] || { cat "$run/evidence/nested-xvfb.log"; exit 1; }
  DISPLAY=:77 weston --backend=x11-backend.so --renderer=pixman --width=1280 --height=900 --shell=kiosk-shell.so --socket="$WAYLAND_DISPLAY" --idle-time=0 --no-config >"$run/evidence/weston.log" 2>&1 &
else
  weston --backend=headless-backend.so --renderer=pixman --shell=kiosk-shell.so --socket="$WAYLAND_DISPLAY" --idle-time=0 --no-config >"$run/evidence/weston.log" 2>&1 &
fi
weston_pid=$!
# The nested backend can take several seconds to load on a busy runner.
for _ in $(seq 1 600); do
  [[ -S $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY ]] && break
  kill -0 "$weston_pid" 2>/dev/null || break
  sleep .05
done
[[ -S $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY ]] || { cat "$run/evidence/weston.log"; exit 1; }
wayland-info >"$run/evidence/wayland-info.txt"
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-native-wayland.py" "$run"
