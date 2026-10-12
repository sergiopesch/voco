#!/bin/bash
# Inside the privacy image: one case, offline or online. Starts VOCO under strace
# with a private X server, D-Bus session and PipeWire, captures packets, waits for
# the speech model, idles, dictates one public clip into the virtual microphone,
# idles again and stops. Everything it records goes to /ev.
set -u
CASE=$1; EV=/ev; CLIP=/fixtures/84-121123-0000.wav
UPDATES=false; IDLE=60; [ "$CASE" = online ] && { UPDATES=true; IDLE=40; }
export HOME=/home/test XDG_CONFIG_HOME=/home/test/.config XDG_RUNTIME_DIR=/run/xdg \
  XDG_CACHE_HOME=/home/test/.cache XDG_DATA_HOME=/home/test/.local/share XDG_STATE_HOME=/home/test/.local/state
mkdir -p "$XDG_CONFIG_HOME/voco" && chmod 700 "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME/voco"
printf '{"onboardingCompleted":true,"automaticUpdateChecks":%s}\n' "$UPDATES" > "$XDG_CONFIG_HOME/voco/config.json"
cp "$XDG_CONFIG_HOME/voco/config.json" "$EV/config.json"
Xvfb :0 -nolisten tcp -screen 0 1280x800x24 > "$EV/xvfb.log" 2>&1 &
for _ in $(seq 100); do [ -S /tmp/.X11-unix/X0 ] && break; sleep .05; done
[ -S /tmp/.X11-unix/X0 ] || { echo "Xvfb did not start"; exit 3; }
export DISPLAY=:0 XDG_SESSION_TYPE=x11 RUST_LOG=debug PULSE_SOURCE=voco_fixture VOCO_PERFORMANCE_LOG=1 \
  VOCO_STREAM_WORKER=/opt/speech/stream_worker.py \
  VOCO_NEMOTRON_MODEL=/opt/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf
tcpdump -Z root -i any -nn -U -w "$EV/capture.pcap" > "$EV/tcpdump.log" 2>&1 & TCPDUMP=$!
sleep 1
export EV CLIP IDLE
dbus-run-session -- bash -c '
mark() { echo "{\"t\":$(date +%s.%N),\"mark\":\"$1\"}" >> "$EV/marks.jsonl"; }
pipewire -c /privacy/pipewire.conf > "$EV/pipewire.log" 2>&1 &
for _ in $(seq 100); do [ -S "$XDG_RUNTIME_DIR/pulse/native" ] && break; sleep .05; done
[ -S "$XDG_RUNTIME_DIR/pulse/native" ] || { echo "PipeWire did not start"; exit 4; }
wireplumber > "$EV/wireplumber.log" 2>&1 &
sleep 2
python3 /privacy/streamlog.py "$EV/streams.jsonl" & LOGGER=$!
mark app_start
strace -f -tt -s 256 -e trace=network,%process -o "$EV/strace.txt" /opt/voco > "$EV/app.log" 2>&1 & TRACER=$!
for _ in $(seq 480); do grep -q "Bundled Nemotron streaming model ready" "$EV/app.log" && break; sleep .5; done
mark model_ready; sleep "$IDLE"
mark toggle_on; timeout 15 /opt/voco --toggle > "$EV/toggle-on.txt" 2>&1
sleep 1; timeout 90 pw-play --target fixture "$CLIP" > "$EV/pw-play.txt" 2>&1
sleep 2; mark toggle_off; timeout 15 /opt/voco --toggle > "$EV/toggle-off.txt" 2>&1
for _ in $(seq 120); do grep "Tray update" "$EV/app.log" | tail -1 | grep -q -E "Ready to listen|state=ready" && break; sleep .5; done
mark dictation_done
timeout 5 xclip -o -selection clipboard > "$EV/clipboard.txt" 2> "$EV/clipboard.err"
sleep $((IDLE / 2)); mark stopping
kill -TERM "$(pgrep -f "^/opt/voco$")" 2>/dev/null; sleep 3; kill "$TRACER" "$LOGGER" 2>/dev/null
# Timings and counters only, never words: proof the worker recognized speech.
cp "$XDG_STATE_HOME/voco/stream-performance/worker.jsonl" "$EV/worker-performance.jsonl" 2>/dev/null
'
kill "$TCPDUMP" 2>/dev/null; sleep 1
tcpdump -r "$EV/capture.pcap" -nn -v port 53 > "$EV/dns.txt" 2> "$EV/dns.err"
