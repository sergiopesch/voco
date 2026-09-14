#!/usr/bin/env bash
# Actual GTK/WebKit widgets in private X11, D-Bus and IBus namespaces.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" != --inside ]]; then
  TEST_ROOT=$(mktemp -d)
  cleanup() {
    status=$?
    /usr/bin/python3 - "${TEST_ROOT}/evidence" "$status" <<'MANIFEST'
import datetime, hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
files = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
         for path in sorted(root.rglob('*')) if path.is_file()}
(root / 'execution.json').write_text(json.dumps({
    'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'exitCode': int(sys.argv[2]), 'files': files,
}, indent=2) + '\n')
MANIFEST
    if [[ -n "${VOCO_NATIVE_EVIDENCE_DIR:-}" ]]; then
      mkdir -p "${VOCO_NATIVE_EVIDENCE_DIR}"
      cp -a "${TEST_ROOT}/evidence/." "${VOCO_NATIVE_EVIDENCE_DIR}/"
    fi
    rm -rf "${TEST_ROOT}"
    exit "$status"
  }
  trap cleanup EXIT
  mkdir -p "${TEST_ROOT}"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "${TEST_ROOT}/runtime"
  cp "${ROOT_DIR}"/apps/desktop/src-tauri/resources/voco_ibus_{engine,ownership,protocol}.py "${TEST_ROOT}/"
  if [[ "${VOCO_NATIVE_TRACE:-}" == 1 ]]; then
    /usr/bin/python3 - "${TEST_ROOT}/voco_ibus_engine.py" <<'TRACE'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
for name, args in [('do_focus_in_id', 'object_path, client'), ('do_set_capabilities', 'capabilities'), ('do_set_content_type', 'purpose, hints'), ('do_focus_out_id', '_object_path')]:
    lines = s.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith('    def ' + name + '('):
            lines.insert(i+1, '        print("CALL", ' + repr(name) + ', ' + args + ', "prior", self.focus_identity, self.context_revision, self._voco_target_capabilities, file=open(os.environ["VOCO_NATIVE_TEST_ROOT"] + "/evidence/callbacks.log", "a"), flush=True)\n')
            break
    s = ''.join(lines)
s = s.replace('    def poll_trigger(self, hotkey: Any) -> dict[str, Any]:\n', '    def poll_trigger(self, hotkey: Any) -> dict[str, Any]:\n        print("POLL", hotkey, bool(self.focused_engine and self.focused_engine.can_accept_preedit), file=open(os.environ["VOCO_NATIVE_TEST_ROOT"] + "/evidence/callbacks.log", "a"), flush=True)\n')
s = s.replace('class VocoEngine(IBus.Engine):\n', 'class VocoEngine(IBus.Engine):\n    def do_set_cursor_location(self, x, y, width, height):\n        print("CURSOR", x, y, width, height, "context", self.focus_identity, file=open(os.environ["VOCO_NATIVE_TEST_ROOT"] + "/evidence/callbacks.log", "a"), flush=True)\n\n')
p.write_text(s)
TRACE
  fi
  /usr/bin/python3 "${ROOT_DIR}/scripts/test-private-ibus-engine.py" --prepare-component \
    "${ROOT_DIR}/packaging/ibus/voco.xml" "${TEST_ROOT}/component/voco.xml" \
    "${TEST_ROOT}/voco_ibus_engine.py"
  cp /usr/share/ibus/component/simple.xml "${TEST_ROOT}/component/"
  if [[ -n "${VOCO_NATIVE_APP_BINARY:-}" ]]; then
    : "${VOCO_NATIVE_MODEL:?Set the existing pinned model path}"
    cp --reflink=auto "${VOCO_NATIVE_APP_BINARY}" "${TEST_ROOT}/voco"
    mkdir -p "${TEST_ROOT}/data/voco/models" "${TEST_ROOT}/config/voco"
    cp --reflink=auto "${VOCO_NATIVE_MODEL}" "${TEST_ROOT}/data/voco/models/ggml-base.en.bin"
    chmod 755 "${TEST_ROOT}/data/voco/models"
    chmod 644 "${TEST_ROOT}/data/voco/models/ggml-base.en.bin"
    output_mode=${VOCO_NATIVE_OUTPUT_MODE:-final-text-only}
    case "$output_mode" in
      final-text-only|stable-cursor-streaming|preview-overlay-only) ;;
      *) echo "Unsupported native test output mode: $output_mode" >&2; exit 1 ;;
    esac
    printf '{"onboardingCompleted":true,"liveCursorMode":"%s","transcriptTarget":"cursor","transcriptEnhancement":"off","hotkey":"Alt+D"}\n' "$output_mode" >"${TEST_ROOT}/config/voco/config.json"
    export VOCO_NATIVE_AUDIO=1
  fi
  if [[ "${VOCO_NATIVE_AUDIO:-}" == 1 ]]; then
    export VOCO_NATIVE_PULSEAUDIO="$(command -v pulseaudio)"
    export VOCO_NATIVE_PACTL="$(command -v pactl)"
    export VOCO_NATIVE_PAPLAY="$(command -v paplay)"
  fi
  deps=${VOCO_NATIVE_DEPS:-/usr}
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "${TEST_ROOT}" "${TEST_ROOT}" --ro-bind "${deps}" /tmp/native-deps \
    --ro-bind "${TEST_ROOT}/component" /usr/share/ibus/component \
    --setenv HOME "${TEST_ROOT}/home" --setenv XDG_RUNTIME_DIR "${TEST_ROOT}/runtime" \
    --setenv XDG_CONFIG_HOME "${TEST_ROOT}/config" --setenv XDG_CACHE_HOME "${TEST_ROOT}/cache" \
    --setenv XDG_DATA_HOME "${TEST_ROOT}/data" --setenv XDG_STATE_HOME "${TEST_ROOT}/state" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY \
    bash "${BASH_SOURCE[0]}" --inside "${TEST_ROOT}"
  exit
fi
TEST_ROOT=${2:?}
export PATH="/tmp/native-deps/bin:/usr/bin:/bin"
export LD_LIBRARY_PATH="/tmp/native-deps/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export XDG_SESSION_TYPE=x11
export GDK_BACKEND=x11 GTK_IM_MODULE=ibus QT_IM_MODULE=ibus XMODIFIERS=@im=ibus
export IBUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/private-ibus.sock"
export VOCO_NATIVE_TEST_ROOT="${TEST_ROOT}" PYTHONDONTWRITEBYTECODE=1
Xvfb :0 -screen 0 1280x900x24 -nolisten tcp >"${TEST_ROOT}/evidence/xvfb.log" 2>&1 &
export DISPLAY=:0
for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X0 ]] && break; sleep .02; done
[[ -S /tmp/.X11-unix/X0 ]] || { cat "${TEST_ROOT}/evidence/xvfb.log" >&2; echo "Private Xvfb did not start." >&2; exit 1; }
exec dbus-run-session -- bash -c '
  ibus-daemon --single --panel=disable --config=disable --emoji-extension=disable --address="$IBUS_ADDRESS" --cache=none >"$VOCO_NATIVE_TEST_ROOT/evidence/ibus.log" 2>&1 &
  for _ in $(seq 1 100); do [[ -S "$XDG_RUNTIME_DIR/private-ibus.sock" ]] && break; sleep .02; done
  [[ -S "$XDG_RUNTIME_DIR/private-ibus.sock" ]] || { cat "$VOCO_NATIVE_TEST_ROOT/evidence/ibus.log" >&2; exit 1; }
  if [[ "${VOCO_NATIVE_AUDIO:-}" == 1 ]]; then
    export PULSE_SERVER="unix:$XDG_RUNTIME_DIR/pulse.sock"
    export PULSE_SOURCE=voco_fixture PULSE_SINK=fixture
    "$VOCO_NATIVE_PULSEAUDIO" --daemonize=no --use-pid-file=no --exit-idle-time=-1 --disable-shm=true -n \
      --log-target="file:$VOCO_NATIVE_TEST_ROOT/evidence/pulse.log" \
      -L "module-native-protocol-unix socket=$XDG_RUNTIME_DIR/pulse.sock auth-anonymous=1" \
      -L "module-null-sink sink_name=fixture rate=48000" \
      -L "module-remap-source master=fixture.monitor source_name=voco_fixture" &
    for _ in $(seq 1 100); do [[ -S "$XDG_RUNTIME_DIR/pulse.sock" ]] && break; sleep .02; done
    [[ -S "$XDG_RUNTIME_DIR/pulse.sock" ]] || { cat "$VOCO_NATIVE_TEST_ROOT/evidence/pulse.log" >&2; exit 1; }
    "$VOCO_NATIVE_PACTL" set-default-source voco_fixture
    "$VOCO_NATIVE_PACTL" list short sources >"$VOCO_NATIVE_TEST_ROOT/evidence/pulse-sources.txt"
  fi
  if [[ -n "${VOCO_NATIVE_APP_BINARY:-}" ]]; then
    /usr/bin/python3 "$1/scripts/test-native-full-app.py"
  else
    /usr/bin/python3 "$1/scripts/test-native-desktop.py"
  fi
' _ "${ROOT_DIR}"
