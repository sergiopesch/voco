#!/bin/bash
# Runs inside Xvfb and dbus-run-session (see run.sh).
set -u
if ! xdpyinfo >/dev/null 2>&1; then
  echo "display $DISPLAY is not reachable" >&2
  exit 71
fi
openbox >"$FIELD_ACCESS_RUN/openbox.log" 2>&1 &
WM=$!
# Wait for the window manager to own the display's WM selection.
for _ in $(seq 50); do
  xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id" && break
  sleep 0.1
done
/usr/bin/python3.12 "$FIELD_ACCESS_HERE/measure.py" "$@"
STATUS=$?
kill "$WM" 2>/dev/null
exit $STATUS
