#!/usr/bin/env bash
# Full Chromium recipient + real VOCO capture/inference, inside private X11/Pulse.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo"
if [[ ${1:-} != --inside ]]; then
  : "${VOCO_NATIVE_APP_BINARY:?Set the compiled VOCO GUI binary}"

  test_root=$(mktemp -d)
  cleanup() {
    status=$?
    /usr/bin/python3 - "$test_root/evidence" "$status" <<'MANIFEST'
import datetime, hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
files = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}
(root / 'execution.json').write_text(json.dumps({'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': int(sys.argv[2]), 'files': files}, indent=2) + '\n')
MANIFEST
    if [[ -n ${VOCO_BROWSER_EVIDENCE_DIR:-} ]]; then mkdir -p "$VOCO_BROWSER_EVIDENCE_DIR"; cp -a "$test_root/evidence/." "$VOCO_BROWSER_EVIDENCE_DIR/"; fi
    rm -rf "$test_root"
    exit "$status"
  }
  trap cleanup EXIT
  mkdir -p "$test_root"/{home,runtime,config/voco,data/voco/models,cache,state,evidence}
  chmod 700 "$test_root/runtime"
  cp --reflink=auto "$VOCO_NATIVE_APP_BINARY" "$test_root/voco"
  source "$(dirname "${BASH_SOURCE[0]}")/lib/test-speech-runtime.sh"
  voco_stage_test_speech "$test_root"
  cp --reflink=auto "${VOCO_BROWSER_HOST_BINARY:-${CARGO_TARGET_DIR:-$repo/apps/desktop/src-tauri/target}/debug/voco-browser-host}" "$test_root/voco-browser-host"

  chmod 755 "$test_root/data/voco/models"

  output_mode=${VOCO_NATIVE_OUTPUT_MODE:-stable-cursor-streaming}
  case "$output_mode" in final-text-only|stable-cursor-streaming) ;; *) echo 'Unsupported browser output mode' >&2; exit 1;; esac
  printf '{"onboardingCompleted":true,"liveCursorMode":"%s","transcriptTarget":"cursor","transcriptEnhancement":"off","hotkey":"Alt+D"}\n' "$output_mode" > "$test_root/config/voco/config.json"
  if [[ ${VOCO_BROWSER_LONG_CAPTURE:-0} == 1 ]]; then
    /usr/bin/python3 - "$repo/tests/fixtures/speech/manifest.json" "$test_root/long.wav" "$test_root/evidence/playback-manifest.json" "${VOCO_BROWSER_LONG_FIXTURE:-natural}" <<'PYWAV'
import hashlib, json, pathlib, sys, wave
manifest_path, output, report = map(pathlib.Path, sys.argv[1:4])
mode = sys.argv[4]
assert mode in ['natural', 'repeated']
manifest = json.loads(manifest_path.read_text())
rows = manifest['fixtures'] if mode == 'natural' else [manifest['fixtures'][0]] * 16
parts, selected, frames_total, params = [], [], 0, None
for row in rows:
    source_path = manifest_path.parent / row['file']
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == row['sha256']
    with wave.open(str(source_path), 'rb') as source:
        current = source.getparams()
        assert current.nchannels == 1 and current.sampwidth == 2 and current.framerate == 16000
        params = current
        frames = source.readframes(source.getnframes())
    silence = bytes(4000 * 2)
    parts.append(frames + silence)
    selected.append({'id':row['id'], 'sha256':row['sha256'], 'reference':row['reference']})
    frames_total += len(frames) // 2 + 4000
    if mode == 'natural' and frames_total >= 37 * 16000:
        break
assert frames_total >= 37 * 16000
with wave.open(str(output), 'wb') as target:
    target.setparams(params)
    target.writeframes(b''.join(parts))
report.write_text(json.dumps({'mode':mode, 'selection':'Manifest order until at least 37 seconds, with 250ms after each fixture' if mode == 'natural' else 'First fixture repeated 16 times with 250ms after each', 'selectedBeforeInference':True, 'fixtures':selected, 'durationSeconds':frames_total/16000, 'wavSha256':hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2) + '\n')
PYWAV
  fi
  export VOCO_BROWSER_NODE=$(command -v node)
  export VOCO_BROWSER_PULSE=$(command -v pulseaudio) VOCO_BROWSER_PLAY=$(command -v paplay)
  browser_binary=${CHROMIUM_PATH:-$(node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())')}
  browser_dir=$(dirname "$browser_binary")
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$test_root" "$test_root" --ro-bind "$browser_dir" /tmp/browser \
    --ro-bind "$(readlink -f "$VOCO_BROWSER_NODE")" /tmp/voco-node \
    --ro-bind "${VOCO_NATIVE_DEPS:-/usr}" /tmp/native-deps \
    --setenv HOME "$test_root/home" --setenv XDG_RUNTIME_DIR "$test_root/runtime" \
    --setenv XDG_CONFIG_HOME "$test_root/config" --setenv XDG_DATA_HOME "$test_root/data" \
    --setenv XDG_CACHE_HOME "$test_root/cache" --setenv XDG_STATE_HOME "$test_root/state" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY \
    bash "$0" --inside "$test_root"
  exit
fi
export VOCO_BROWSER_TEST_ROOT=${2:?}
export PATH="/tmp/native-deps/bin:/usr/bin:/bin" LD_LIBRARY_PATH=/tmp/native-deps/lib/x86_64-linux-gnu
export XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 GTK_IM_MODULE=gtk-im-context-simple
Xvfb :0 -screen 0 1280x900x24 -nolisten tcp > "$VOCO_BROWSER_TEST_ROOT/evidence/xvfb.log" 2>&1 &
export DISPLAY=:0
for _ in $(seq 1 100); do [[ -S /tmp/.X11-unix/X0 ]] && break; sleep .02; done
exec dbus-run-session -- bash -c '
  export PULSE_SERVER="unix:$XDG_RUNTIME_DIR/pulse.sock" PULSE_SOURCE=voco_fixture PULSE_SINK=fixture
  "$VOCO_BROWSER_PULSE" --daemonize=no --use-pid-file=no --exit-idle-time=-1 --disable-shm=true -n \
    --log-target="file:$VOCO_BROWSER_TEST_ROOT/evidence/pulse.log" \
    -L "module-native-protocol-unix socket=$XDG_RUNTIME_DIR/pulse.sock auth-anonymous=1" \
    -L "module-null-sink sink_name=fixture rate=48000" \
    -L "module-remap-source master=fixture.monitor source_name=voco_fixture" &
  for _ in $(seq 1 100); do [[ -S "$XDG_RUNTIME_DIR/pulse.sock" ]] && break; sleep .02; done
  /tmp/voco-node "$1/scripts/test-browser-full-app.mjs"
' _ "$repo"
