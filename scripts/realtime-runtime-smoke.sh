#!/usr/bin/env bash
set -euo pipefail

if [[ "${VOCO_DISPOSABLE_DESKTOP:-}" != "1" ]]; then
  echo "Refusing to alter input/audio state outside an explicitly disposable desktop." >&2
  echo "Run this only in a remote VM or microVM with VOCO_DISPOSABLE_DESKTOP=1." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACE="${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl"
LOG="${TMPDIR:-/tmp}/voco-runtime-realtime-smoke.log"
HELPER="${TMPDIR:-/tmp}/voco-linux-uinput-hotkey"
SINK_NAME="voco_rt_sink_$$"
SOURCE_NAME="voco_rt_app_$$"
OUTPUT_SINK_NAME="voco_rt_output_$$"
APP_BIN="${VOCO_BIN:-$HOME/.local/bin/voco}"
SPEECH_RAW="${TMPDIR:-/tmp}/voco-runtime-speech-$$.raw"
INTERRUPT_RAW="${TMPDIR:-/tmp}/voco-runtime-interrupt-$$.raw"
OUTPUT_RAW="${TMPDIR:-/tmp}/voco-runtime-output-$$.raw"
APP_CONFIG_HOME="${TMPDIR:-/tmp}/voco-runtime-config-$$"
REQUIRE_RESPONSE=0
INTERRUPT=0

for arg in "$@"; do
  case "$arg" in
    --require-response)
      REQUIRE_RESPONSE=1
      ;;
    --interrupt)
      REQUIRE_RESPONSE=1
      INTERRUPT=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_trace() {
  local event="$1"
  local attempts="${2:-80}"
  for _ in $(seq 1 "$attempts"); do
    if [ -f "$TRACE" ] && rg -q "\"event\":\"$event\"" "$TRACE"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

need_command gcc
need_command node
need_command paplay
need_command pactl
need_command parec
need_command rg
need_command sox
need_command spd-say

if [ ! -w /dev/uinput ]; then
  echo "/dev/uinput is not writable. Add the user to the input group or adjust udev rules." >&2
  exit 1
fi

if [ ! -x "$APP_BIN" ]; then
  echo "VOCO binary not found or not executable: $APP_BIN" >&2
  exit 1
fi

gcc -O2 -Wall -Wextra "$ROOT_DIR/scripts/linux-uinput-hotkey.c" -o "$HELPER"

original_sink="$(pactl get-default-sink)"
original_source="$(pactl get-default-source)"
sink_module_id=""
source_module_id=""
output_sink_module_id=""
record_module_id=""
output_recorder_pid=""

cleanup() {
  if [ -n "$output_recorder_pid" ]; then
    kill -INT "$output_recorder_pid" >/dev/null 2>&1 || true
    wait "$output_recorder_pid" >/dev/null 2>&1 || true
  fi
  pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true
  pactl set-default-source "$original_source" >/dev/null 2>&1 || true
  if [ -n "$record_module_id" ]; then
    pactl unload-module "$record_module_id" >/dev/null 2>&1 || true
  fi
  if [ -n "$source_module_id" ]; then
    pactl unload-module "$source_module_id" >/dev/null 2>&1 || true
  fi
  if [ -n "$sink_module_id" ]; then
    pactl unload-module "$sink_module_id" >/dev/null 2>&1 || true
  fi
  if [ -n "$output_sink_module_id" ]; then
    pactl unload-module "$output_sink_module_id" >/dev/null 2>&1 || true
  fi
  rm -f "$SPEECH_RAW" "$SPEECH_RAW.tmp" "$INTERRUPT_RAW" "$INTERRUPT_RAW.tmp" "$OUTPUT_RAW"
  rm -rf "$APP_CONFIG_HOME"
}
trap cleanup EXIT

record_tts_sample() {
  local text="$1"
  local output="$2"
  local tmp="$output.tmp"

  rm -f "$tmp" "$output"
  pactl set-default-sink "$record_sink_name"
  parec --device="$record_sink_name.monitor" --format=s16le --rate=24000 --channels=1 >"$tmp" &
  local recorder_pid=$!
  sleep 0.3
  spd-say -w "$text"
  sleep 0.7
  kill -INT "$recorder_pid" >/dev/null 2>&1 || true
  wait "$recorder_pid" >/dev/null 2>&1 || true
  sox \
    -t raw -r 24000 -e signed-integer -b 16 -c 1 "$tmp" \
    -t raw -r 24000 -e signed-integer -b 16 -c 1 "$output" \
    gain -n -3 pad 0 0.9
}

stop_output_capture() {
  if [ -n "$output_recorder_pid" ]; then
    kill -INT "$output_recorder_pid" >/dev/null 2>&1 || true
    wait "$output_recorder_pid" >/dev/null 2>&1 || true
    output_recorder_pid=""
  fi
}

assert_output_capture() {
  node - "$OUTPUT_RAW" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const bytes = fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
let squared = 0;
let count = 0;
for (let index = 0; index + 1 < bytes.length; index += 2) {
  const sample = bytes.readInt16LE(index) / 32768;
  squared += sample * sample;
  count += 1;
}
const rms = count === 0 ? 0 : Math.sqrt(squared / count);
if (count < 2400 || rms <= 0.0005) {
  console.error(JSON.stringify({ outputSamples: count, outputRms: Number(rms.toFixed(6)) }));
  process.exit(1);
}
console.error(JSON.stringify({ outputSamples: count, outputRms: Number(rms.toFixed(6)) }));
NODE
}

record_sink_name="voco_rt_record_$$"
record_module_id="$(pactl load-module module-null-sink "sink_name=$record_sink_name" "sink_properties=device.description=$record_sink_name")"
if [ "$INTERRUPT" -eq 1 ]; then
  record_tts_sample "count slowly from one to one hundred until I interrupt you" "$SPEECH_RAW"
  record_tts_sample "stop and say interruption worked" "$INTERRUPT_RAW"
else
  record_tts_sample "give me one very short test reply" "$SPEECH_RAW"
fi
pactl set-default-sink "$original_sink"
pactl unload-module "$record_module_id" >/dev/null 2>&1 || true
record_module_id=""

sink_module_id="$(pactl load-module module-null-sink "sink_name=$SINK_NAME" "sink_properties=device.description=$SINK_NAME")"
source_module_id="$(pactl load-module module-remap-source "master=$SINK_NAME.monitor" "source_name=$SOURCE_NAME" "source_properties=device.description=$SOURCE_NAME")"
pactl set-default-source "$SOURCE_NAME"

output_sink_module_id="$(pactl load-module module-null-sink "sink_name=$OUTPUT_SINK_NAME" "sink_properties=device.description=$OUTPUT_SINK_NAME")"
pactl set-default-sink "$OUTPUT_SINK_NAME"
parec --device="$OUTPUT_SINK_NAME.monitor" --format=s16le --rate=24000 --channels=1 >"$OUTPUT_RAW" &
output_recorder_pid=$!

mkdir -p "$APP_CONFIG_HOME/voco"
printf '{\n  "selectedMic": "label:%s",\n  "onboardingCompleted": true\n}\n' "$SOURCE_NAME" >"$APP_CONFIG_HOME/voco/config.json"

pkill -f "^$APP_BIN$" >/dev/null 2>&1 || true
rm -f "$TRACE"
XDG_CONFIG_HOME="$APP_CONFIG_HOME" nohup "$APP_BIN" >"$LOG" 2>&1 &

wait_for_trace "frontend_realtime_hotkey_listener_registered" 100 || {
  echo "Realtime listener did not register." >&2
  tail -n 120 "$TRACE" 2>/dev/null || true
  exit 2
}
wait_for_trace "frontend_hotkey_handler_ready" 100 || {
  echo "Hotkey handler did not become ready." >&2
  tail -n 120 "$TRACE" 2>/dev/null || true
  exit 2
}

"$HELPER" 3500
wait_for_trace "realtime_audio_graph_connected" 100 || {
  echo "Realtime did not reach audio graph connection." >&2
  tail -n 160 "$TRACE" 2>/dev/null || true
  exit 3
}
wait_for_trace "realtime_microphone_track_started" 20 || {
  echo "Realtime did not trace microphone track startup." >&2
  tail -n 160 "$TRACE" 2>/dev/null || true
  exit 3
}
wait_for_trace "realtime_microphone_track_settings" 20 || {
  echo "Realtime did not trace microphone track settings." >&2
  tail -n 160 "$TRACE" 2>/dev/null || true
  exit 3
}

paplay --device="$SINK_NAME" --raw --format=s16le --rate=24000 --channels=1 "$SPEECH_RAW"

if [ "$INTERRUPT" -eq 1 ]; then
  first_delta_seen=0
  for _ in $(seq 1 120); do
    if [ -f "$TRACE" ] && rg -q '"event":"realtime_output_audio_delta"' "$TRACE"; then
      first_delta_seen=1
      break
    fi
    sleep 0.25
  done
  if [ "$first_delta_seen" -ne 1 ]; then
    echo "Realtime did not receive first assistant output audio before interruption." >&2
    tail -n 240 "$TRACE" 2>/dev/null || true
    exit 4
  fi

  paplay --device="$SINK_NAME" --raw --format=s16le --rate=24000 --channels=1 "$INTERRUPT_RAW"

  interrupt_ok=0
  for _ in $(seq 1 160); do
    cancel_count="$(rg -c '"event":"realtime_response_cancel_sent"' "$TRACE" 2>/dev/null || true)"
    response_created_count="$(rg -c '"event":"realtime_server_response_created"' "$TRACE" 2>/dev/null || true)"
    response_done_count="$(rg -c '"event":"realtime_server_response_done"' "$TRACE" 2>/dev/null || true)"
    if [ "${cancel_count:-0}" -ge 1 ] && [ "${response_created_count:-0}" -ge 2 ] && [ "${response_done_count:-0}" -ge 2 ]; then
      interrupt_ok=1
      break
    fi
    sleep 0.25
  done

  "$HELPER" 2500
  wait_for_trace "realtime_stop_requested" 80 || {
    echo "Realtime did not stop from the second Alt+Shift+R." >&2
    tail -n 280 "$TRACE" 2>/dev/null || true
    exit 5
  }

  if [ "$interrupt_ok" -ne 1 ]; then
    echo "Realtime interruption did not produce cancel plus a second completed response." >&2
    tail -n 280 "$TRACE" 2>/dev/null || true
    exit 4
  fi

  stop_output_capture
  assert_output_capture

  tail -n 280 "$TRACE"
  exit 0
fi

response_seen=0
no_speech_seen=0
for _ in $(seq 1 160); do
  if [ -f "$TRACE" ] && rg -q '"event":"realtime_output_audio_delta"' "$TRACE"; then
    response_seen=1
    break
  fi
  if [ -f "$TRACE" ] && rg -q '"event":"realtime_no_speech_timeout"' "$TRACE"; then
    no_speech_seen=1
    break
  fi
  sleep 0.25
done

"$HELPER" 2500
wait_for_trace "realtime_stop_requested" 80 || {
  echo "Realtime did not stop from the second Alt+Shift+R." >&2
  tail -n 240 "$TRACE" 2>/dev/null || true
  exit 5
}

if [ "$REQUIRE_RESPONSE" -eq 1 ] && [ "$response_seen" -ne 1 ]; then
  echo "Realtime did not receive assistant output audio." >&2
  tail -n 240 "$TRACE" 2>/dev/null || true
  exit 4
fi

if [ "$response_seen" -eq 1 ]; then
  stop_output_capture
  assert_output_capture
fi

if [ "$response_seen" -ne 1 ] && [ "$no_speech_seen" -ne 1 ]; then
  echo "Realtime produced neither assistant output nor a no-speech diagnostic." >&2
  tail -n 240 "$TRACE" 2>/dev/null || true
  exit 4
fi

tail -n 240 "$TRACE"
