#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACE="${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl"
LOG="${TMPDIR:-/tmp}/voco-runtime-realtime-smoke.log"
HELPER="${TMPDIR:-/tmp}/voco-linux-uinput-hotkey"
SINK_NAME="voco_rt_app_$$"
APP_BIN="${VOCO_BIN:-$HOME/.local/bin/voco}"
SPEECH_RAW="${TMPDIR:-/tmp}/voco-runtime-speech-$$.raw"
REQUIRE_RESPONSE=0

if [ "${1:-}" = "--require-response" ]; then
  REQUIRE_RESPONSE=1
fi

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
module_id=""
record_module_id=""

cleanup() {
  pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true
  pactl set-default-source "$original_source" >/dev/null 2>&1 || true
  if [ -n "$record_module_id" ]; then
    pactl unload-module "$record_module_id" >/dev/null 2>&1 || true
  fi
  if [ -n "$module_id" ]; then
    pactl unload-module "$module_id" >/dev/null 2>&1 || true
  fi
  rm -f "$SPEECH_RAW" "$SPEECH_RAW.tmp"
}
trap cleanup EXIT

record_sink_name="voco_rt_record_$$"
record_module_id="$(pactl load-module module-null-sink "sink_name=$record_sink_name" "sink_properties=device.description=$record_sink_name")"
pactl set-default-sink "$record_sink_name"
parec --device="$record_sink_name.monitor" --format=s16le --rate=24000 --channels=1 >"$SPEECH_RAW.tmp" &
recorder_pid=$!
sleep 0.3
spd-say -w "give me one very short test reply"
sleep 0.7
kill -INT "$recorder_pid" >/dev/null 2>&1 || true
wait "$recorder_pid" >/dev/null 2>&1 || true
sox \
  -t raw -r 24000 -e signed-integer -b 16 -c 1 "$SPEECH_RAW.tmp" \
  -t raw -r 24000 -e signed-integer -b 16 -c 1 "$SPEECH_RAW" \
  gain -n -3 pad 0 0.9
pactl set-default-sink "$original_sink"
pactl unload-module "$record_module_id" >/dev/null 2>&1 || true
record_module_id=""

module_id="$(pactl load-module module-null-sink "sink_name=$SINK_NAME" "sink_properties=device.description=$SINK_NAME")"
pactl set-default-source "$SINK_NAME.monitor"

pkill -f "^$APP_BIN$" >/dev/null 2>&1 || true
rm -f "$TRACE"
nohup "$APP_BIN" >"$LOG" 2>&1 &

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
  echo "Realtime did not stop from the second Alt+R." >&2
  tail -n 240 "$TRACE" 2>/dev/null || true
  exit 5
}

if [ "$REQUIRE_RESPONSE" -eq 1 ] && [ "$response_seen" -ne 1 ]; then
  echo "Realtime did not receive assistant output audio." >&2
  tail -n 240 "$TRACE" 2>/dev/null || true
  exit 4
fi

if [ "$response_seen" -ne 1 ] && [ "$no_speech_seen" -ne 1 ]; then
  echo "Realtime produced neither assistant output nor a no-speech diagnostic." >&2
  tail -n 240 "$TRACE" 2>/dev/null || true
  exit 4
fi

tail -n 240 "$TRACE"
