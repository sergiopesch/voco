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
  if [[ ${VOCO_WAYLAND_CAPTURE:-0} == 1 ]]; then
    [[ "$backend" == nested-x11 ]] || { echo "Capture-to-Copy requires the private nested seat" >&2; exit 1; }
    : "${VOCO_WAYLAND_APP_BINARY:?Capture requires an application}"
    : "${VOCO_WAYLAND_MODEL:?Capture requires the pinned model}"
    for helper in pulseaudio pactl paplay wl-copy wl-paste; do command -v "$helper" >/dev/null; done
    export VOCO_WAYLAND_PULSEAUDIO="$(command -v pulseaudio)"
    export VOCO_WAYLAND_PACTL="$(command -v pactl)"
    export VOCO_WAYLAND_PAPLAY="$(command -v paplay)"
  fi
  run=$(mktemp -d)
  trap 'status=$?; /usr/bin/python3 "$ROOT/scripts/test-native-wayland.py" "$run" --manifest "$status"; mkdir -p "$VOCO_WAYLAND_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_WAYLAND_EVIDENCE_DIR/"; rm -rf "$run"; exit "$status"' EXIT
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$run/runtime"
  mkdir -p "$run/data/voco/models"
  chmod 755 "$run/data/voco" "$run/data/voco/models"
  if [[ ${VOCO_WAYLAND_CAPTURE:-0} == 1 ]]; then
    mkdir -p "$run/config/voco"
    printf '%s\n' '{"onboardingCompleted":true,"liveCursorMode":"final-text-only","transcriptTarget":"cursor","transcriptEnhancement":"off","hotkey":"Alt+D"}' >"$run/config/voco/config.json"
  fi
  if [[ -n ${VOCO_WAYLAND_APP_BINARY:-} ]]; then
    [[ -f "$VOCO_WAYLAND_APP_BINARY" && -x "$VOCO_WAYLAND_APP_BINARY" ]] || { echo "App must be an executable file" >&2; exit 1; }
    cp "$VOCO_WAYLAND_APP_BINARY" "$run/voco"
  fi
  if [[ -n ${VOCO_WAYLAND_MODEL:-} ]]; then
    [[ -n ${VOCO_WAYLAND_APP_BINARY:-} ]] || { echo "Model requires application binary" >&2; exit 1; }
    cp --reflink=auto "$VOCO_WAYLAND_MODEL" "$run/data/voco/models/ggml-base.en.bin"
    chmod 644 "$run/data/voco/models/ggml-base.en.bin"
    /usr/bin/python3 - "$run/data/voco/models/ggml-base.en.bin" <<'MODEL'
import hashlib, pathlib, sys
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() == 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', 'Pinned model checksum mismatch'
MODEL
  fi
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$run" "$run" --ro-bind "$VOCO_WAYLAND_DEPS" /tmp/wayland-deps \
    --ro-bind "${VOCO_NATIVE_DEPS:-/usr}" /tmp/native-deps \
    --setenv HOME "$run/home" --setenv XDG_RUNTIME_DIR "$run/runtime" \
    --setenv XDG_CONFIG_HOME "$run/config" --setenv XDG_CACHE_HOME "$run/cache" \
    --setenv XDG_DATA_HOME "$run/data" --setenv XDG_STATE_HOME "$run/state" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY --unsetenv PULSE_SERVER \
    bash "${BASH_SOURCE[0]}" --inside "$run"
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
for _ in $(seq 1 100); do [[ -S $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY ]] && break; sleep .05; done
[[ -S $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY ]] || { cat "$run/evidence/weston.log"; exit 1; }
wayland-info >"$run/evidence/wayland-info.txt"
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-native-wayland.py" "$run"
