#!/bin/bash
# Starts Xvfb on a display the server picks itself (-displayfd, so there is no
# race for a display number), then runs session.sh in its own D-Bus session.
# Run by run.sh inside the private mount namespace.
set -u
mkfifo "$FIELD_ACCESS_RUN/displayfd.fifo" || exit 70
exec 3<>"$FIELD_ACCESS_RUN/displayfd.fifo"
# -noreset: without it the server resets when its last client leaves (the
# readiness check below is one), and a client that connects meanwhile fails.
Xvfb -displayfd 3 -screen 0 1280x900x24 -nolisten tcp -noreset >"$FIELD_ACCESS_RUN/xvfb.log" 2>&1 &
XVFB=$!
if ! read -r -t 20 NUMBER <&3; then
  echo "Xvfb did not start" >&2
  kill "$XVFB" 2>/dev/null
  exit 70
fi
export DISPLAY=":$NUMBER"
dbus-run-session -- "$FIELD_ACCESS_HERE/session.sh" "$@"
STATUS=$?
kill "$XVFB" 2>/dev/null
wait "$XVFB" 2>/dev/null
exit $STATUS
