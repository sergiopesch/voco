#!/bin/bash
# One measurement in an isolated session: Xvfb display + its own D-Bus session
# (and so its own AT-SPI bus) + openbox + a throwaway HOME.
#
#   ./run.sh <case> <scenario> [--config NAME] [--out FILE]
#
# Cases, scenarios and configs:  /usr/bin/python3.12 measure.py --list
#
# XDG_RUNTIME_DIR must be short: atk-bridge puts a Unix socket under it, and a
# path past 108 bytes fails ("Socket name too long"), which leaves GTK3 apps
# without their direct connection. The run's own folder is too long, so it is
# bind-mounted on /run/user inside a private mount namespace: the files stay
# in this folder and nothing outside it changes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/work"
mkdir -p "$WORK" "$HERE/results"
RUN="$(mktemp -d "$WORK/run.XXXXXX")"
mkdir -p "$RUN/home/.config" "$RUN/home/.cache" "$RUN/home/.local/share" "$RUN/xdg"
chmod 700 "$RUN/xdg"

# A clean environment: nothing of the caller's session, bus or toolkits.
exec env -i \
  PATH=/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME="$RUN/home" \
  XDG_RUNTIME_DIR=/run/user \
  XDG_CONFIG_HOME="$RUN/home/.config" \
  XDG_CACHE_HOME="$RUN/home/.cache" \
  XDG_DATA_HOME="$RUN/home/.local/share" \
  XDG_SESSION_TYPE=x11 \
  LANG=C.UTF-8 \
  FIELD_ACCESS_RUN="$RUN" \
  FIELD_ACCESS_HERE="$HERE" \
  unshare -m --propagation private \
  sh -c 'mount --bind "$FIELD_ACCESS_RUN/xdg" /run/user && exec "$@"' sh \
  timeout --kill-after=10 "${FIELD_ACCESS_TIMEOUT:-240}" \
  "$HERE/xsession.sh" "$@"
