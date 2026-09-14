#!/usr/bin/env bash
# Actual GNOME Shell on a private Xvfb seat; never attach to the host session.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} != --inside ]]; then
  : "${VOCO_NATIVE_DEPS:?Set extracted Xvfb root/usr}"
  : "${VOCO_GNOME_EVIDENCE_DIR:?Set fresh evidence directory}"
  [[ ! -e "$VOCO_GNOME_EVIDENCE_DIR" ]] || { echo 'Evidence directory must be fresh' >&2; exit 1; }
  if [[ ${VOCO_GNOME_CAPTURE:-0} == 1 ]]; then
    : "${VOCO_GNOME_APP_BINARY:?Capture requires app}"
    : "${VOCO_GNOME_MODEL:?Capture requires model}"
    for helper in pulseaudio pactl paplay wl-copy wl-paste; do command -v "$helper" >/dev/null; done
    export VOCO_WAYLAND_PULSEAUDIO="$(command -v pulseaudio)"
    export VOCO_WAYLAND_PACTL="$(command -v pactl)"
    export VOCO_WAYLAND_PAPLAY="$(command -v paplay)"
  fi
  run=$(mktemp -d)
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$run/runtime"
  mkdir -p "$run/evidence/sources"
  cp "$ROOT/scripts/test-native-gnome.sh" "$ROOT/scripts/test-native-gnome.py" "$ROOT/scripts/test-native-wayland.py" "$ROOT/scripts/test_native_wayland_capture.py" "$run/evidence/sources/"
  mkdir -p "$run/data/gnome-shell/extensions/voco-private-probe@test.invalid"
  cp "$ROOT/scripts/fixtures/gnome-private-probe/"* "$run/data/gnome-shell/extensions/voco-private-probe@test.invalid/"
  cp -a "$ROOT/scripts/fixtures/gnome-private-probe" "$run/evidence/sources/"
  if [[ -n ${VOCO_GNOME_APP_BINARY:-} ]]; then
    [[ -f "$VOCO_GNOME_APP_BINARY" && -x "$VOCO_GNOME_APP_BINARY" ]]
    cp "$VOCO_GNOME_APP_BINARY" "$run/voco"
    mkdir -p "$run/config/voco"
    printf '%s\n' '{"onboardingCompleted":true,"liveCursorMode":"final-text-only","transcriptTarget":"cursor","transcriptEnhancement":"off","hotkey":"Alt+D"}' > "$run/config/voco/config.json"
  fi
  if [[ -n ${VOCO_GNOME_MODEL:-} ]]; then
    [[ -f "$run/voco" ]]
    mkdir -p "$run/data/voco/models"
    cp --reflink=auto "$VOCO_GNOME_MODEL" "$run/data/voco/models/ggml-base.en.bin"
    chmod 755 "$run/data/voco" "$run/data/voco/models"
    chmod 644 "$run/data/voco/models/ggml-base.en.bin"
  fi
  trap 'status=$?; mkdir -p "$VOCO_GNOME_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_GNOME_EVIDENCE_DIR/"; printf "%s\n" "$status" > "$VOCO_GNOME_EVIDENCE_DIR/exit-code"; rm -rf "$run"; exit "$status"' EXIT
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$run" "$run" --ro-bind "$VOCO_NATIVE_DEPS" /tmp/native-deps \
    --setenv HOME "$run/home" --setenv XDG_RUNTIME_DIR "$run/runtime" \
    --setenv XDG_CONFIG_HOME "$run/config" --setenv XDG_CACHE_HOME "$run/cache" \
    --setenv XDG_DATA_HOME "$run/data" --setenv XDG_STATE_HOME "$run/state" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv DBUS_SYSTEM_BUS_ADDRESS --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY --unsetenv PULSE_SERVER \
    --unsetenv PYTHONOPTIMIZE \
    bash "${BASH_SOURCE[0]}" --inside "$run"
  exit
fi
run=${2:?}
export PATH=/usr/bin:/bin
export LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=ubuntu:GNOME GNOME_SHELL_SESSION_MODE=user
LD_LIBRARY_PATH=/tmp/native-deps/lib/x86_64-linux-gnu /tmp/native-deps/bin/Xvfb :77 -screen 0 1280x900x24 -nolisten tcp >"$run/evidence/xvfb.log" 2>&1 &
for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X77 ]] && break; sleep .05; done
[[ -S /tmp/.X11-unix/X77 ]]
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-native-gnome.py" "$run"
