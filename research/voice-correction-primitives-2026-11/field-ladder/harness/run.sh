#!/bin/bash
# One field + one scenario in one fresh, isolated session: a headless GNOME
# Shell on Wayland with its own D-Bus session (and so its own AT-SPI bus), a
# throwaway HOME and a short XDG_RUNTIME_DIR. Writes one JSON under results/.
#
#   ./run.sh <case> <scenario> [--config NAME] [--rep N]
#
# Cases, scenarios and configs:  /usr/bin/python3.12 ladder.py --list
#
# XDG_RUNTIME_DIR must be short (sockets under it must fit in 108 bytes), so
# the run's own folder is bind-mounted on /run/user inside a private mount
# namespace. /tmp is a private tmpfs there too, with only this folder bound
# back in: XWayland's lock files and sockets stay the run's own, so runs can
# go side by side. A private PID namespace ends every process of the session
# with the run. Nothing outside this folder changes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/work"
mkdir -p "$WORK" "$HERE/results"
RUN="$(mktemp -d "$WORK/run.XXXXXX")"
mkdir -p "$RUN/home/.config" "$RUN/home/.cache" "$RUN/home/.local/share" "$RUN/xdg"
chmod 700 "$RUN/xdg"
CASE="${1:-}"; SCEN="${2:-plain}"; CONFIG=plain; REP=1
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  [ "${ARGS[i]}" = --config ] && CONFIG="${ARGS[i+1]}"
  [ "${ARGS[i]}" = --rep ] && REP="${ARGS[i+1]}"
done
LOG="$WORK/$CASE.$SCEN.$CONFIG.r$REP.log"

env -i \
  PATH=/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME="$RUN/home" \
  XDG_RUNTIME_DIR=/run/user \
  XDG_CONFIG_HOME="$RUN/home/.config" \
  XDG_CACHE_HOME="$RUN/home/.cache" \
  XDG_DATA_HOME="$RUN/home/.local/share" \
  XDG_SESSION_TYPE=wayland \
  XDG_CURRENT_DESKTOP=ubuntu:GNOME \
  GNOME_SHELL_SESSION_MODE=user \
  LIBGL_ALWAYS_SOFTWARE=1 \
  LANG=C.UTF-8 \
  FIELD_LADDER_RUN="$RUN" \
  FIELD_LADDER_HERE="$HERE" \
  FIELD_LADDER_DEBUG="${FIELD_LADDER_DEBUG:-}" \
  unshare --mount --pid --fork --kill-child --mount-proc --propagation private \
  sh -c 'mount --bind "$FIELD_LADDER_HERE" /mnt && mount -t tmpfs tmpfs /tmp && mkdir -p "$FIELD_LADDER_HERE" \
    && mount --bind /mnt "$FIELD_LADDER_HERE" && mount --bind "$FIELD_LADDER_RUN/xdg" /run/user && exec "$@"' sh \
  timeout --kill-after=10 "${FIELD_LADDER_TIMEOUT:-240}" \
  dbus-run-session -- /usr/bin/python3.12 "$HERE/ladder.py" "$@" >"$LOG" 2>&1
STATUS=$?
# Keep the run's logs and screenshots; drop the throwaway profiles.
[ "${FIELD_LADDER_KEEP:-0}" = 1 ] || rm -rf "$RUN/home" "$RUN/chrome-profile" "$RUN/electron-profile" "$RUN/lo-profile" "$RUN/xdg"
echo "$CASE $SCEN $CONFIG r$REP -> exit $STATUS ($(tail -n 1 "$LOG" | cut -c1-160))"
exit $STATUS
