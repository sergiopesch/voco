#!/usr/bin/env bash
# Actual KWin/Plasma on a private Xvfb seat; never attach to the host session.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} != --inside ]]; then
  : "${VOCO_NATIVE_DEPS:?Set extracted Xvfb root/usr}"
  : "${VOCO_KDE_DEPS:?Set extracted KDE root/usr}"
  : "${VOCO_KDE_EVIDENCE_DIR:?Set fresh evidence directory}"
  [[ ! -e "$VOCO_KDE_EVIDENCE_DIR" ]] || { echo 'Evidence directory must be fresh' >&2; exit 1; }
  if [[ ${VOCO_KDE_CAPTURE:-0} == 1 ]]; then
    : "${VOCO_KDE_APP_BINARY:?Capture requires app}"

    for helper in pulseaudio pactl paplay wl-copy wl-paste; do command -v "$helper" >/dev/null; done
    export VOCO_WAYLAND_PULSEAUDIO="$(command -v pulseaudio)"
    export VOCO_WAYLAND_PACTL="$(command -v pactl)"
    export VOCO_WAYLAND_PAPLAY="$(command -v paplay)"
  fi
  run=$(mktemp -d)
  mkdir -p "$run"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$run/runtime"
  cp -a "$VOCO_KDE_DEPS/../etc/xdg/." "$run/config/"
  mkdir -p "$run/evidence/sources"
  cp "$ROOT/scripts/test-native-kde.sh" "$ROOT/scripts/test-native-kde.py" "$ROOT/scripts/test-native-wayland.py" "$ROOT/scripts/test_native_wayland_capture.py" "$run/evidence/sources/"
  if [[ -n ${VOCO_KDE_APP_BINARY:-} ]]; then
    [[ -f "$VOCO_KDE_APP_BINARY" && -x "$VOCO_KDE_APP_BINARY" ]]
    cp "$VOCO_KDE_APP_BINARY" "$run/voco"
    source "$(dirname "${BASH_SOURCE[0]}")/lib/test-speech-runtime.sh"
    voco_stage_test_speech "$run"
    mkdir -p "$run/config/voco"
    printf '%s\n' '{"onboardingCompleted":true,"liveCursorMode":"final-text-only","transcriptTarget":"cursor","transcriptEnhancement":"off","hotkey":"Alt+D"}' > "$run/config/voco/config.json"
  fi
  trap 'status=$?; mkdir -p "$VOCO_KDE_EVIDENCE_DIR"; cp -a "$run/evidence/." "$VOCO_KDE_EVIDENCE_DIR/"; printf "%s\n" "$status" > "$VOCO_KDE_EVIDENCE_DIR/exit-code"; rm -rf "$run"; exit "$status"' EXIT
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$run" "$run" --ro-bind "$VOCO_NATIVE_DEPS" /tmp/native-deps --ro-bind "$VOCO_KDE_DEPS" /tmp/kde-deps \
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
export PATH=/tmp/kde-deps/bin:/usr/bin:/bin
export XDG_DATA_DIRS=/tmp/kde-deps/share:/usr/local/share:/usr/share
export LD_LIBRARY_PATH=/tmp/kde-deps/lib/x86_64-linux-gnu
export QT_PLUGIN_PATH=/tmp/kde-deps/lib/x86_64-linux-gnu/qt5/plugins:/usr/lib/x86_64-linux-gnu/qt5/plugins
export QML2_IMPORT_PATH=/tmp/kde-deps/lib/x86_64-linux-gnu/qt5/qml:/usr/lib/x86_64-linux-gnu/qt5/qml
export LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE
LD_LIBRARY_PATH=/tmp/native-deps/lib/x86_64-linux-gnu /tmp/native-deps/bin/Xvfb :77 -screen 0 1280x900x24 -nolisten tcp >"$run/evidence/xvfb.log" 2>&1 &
for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X77 ]] && break; sleep .05; done
[[ -S /tmp/.X11-unix/X77 ]]
/usr/bin/python3 - "$run" <<'SERVICES'
from pathlib import Path
import sys
root = Path(sys.argv[1])
dest = root / 'data/dbus-1/services'
dest.mkdir(parents=True, exist_ok=True)
for source in Path('/tmp/kde-deps/share/dbus-1/services').glob('*.service'):
    text = source.read_text()
    lines = []
    for line in text.splitlines():
        if line.startswith('Exec=/usr/'):
            executable = line[5:].split(' ', 1)[0]
            mapped = '/tmp/kde-deps/' + executable.removeprefix('/usr/')
            if Path(mapped).exists():
                line = line.replace(executable, mapped, 1)
        lines.append(line)
    (dest / source.name).write_text('\n'.join(lines) + '\n')
SERVICES
exec dbus-run-session -- /usr/bin/python3 "$ROOT/scripts/test-native-kde.py" "$run"
