#!/usr/bin/env bash
# Sourced only by disposable desktop harnesses.
# voco_bwrap ROOT [BWRAP-ARG...] -- COMMAND [ARG...] runs COMMAND in private IPC,
# network, PID and UTS namespaces: / read-only, ROOT writable, fresh /tmp,
# /run/user and /run/dbus, HOME and the XDG directories inside ROOT, and none of
# the caller's display, bus, input method, audio or Python optimisation settings.
# The BWRAP-ARGs, the suite's own mounts and settings, come after all of that.
voco_bwrap() {
  local root=$1
  local extra=()
  shift
  while [[ $1 != -- ]]; do extra+=("$1"); shift; done
  shift
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$root" "$root" \
    --setenv HOME "$root/home" --setenv XDG_RUNTIME_DIR "$root/runtime" \
    --setenv XDG_CONFIG_HOME "$root/config" --setenv XDG_CACHE_HOME "$root/cache" \
    --setenv XDG_DATA_HOME "$root/data" --setenv XDG_STATE_HOME "$root/state" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv XAUTHORITY \
    --unsetenv DBUS_SESSION_BUS_ADDRESS --unsetenv DBUS_SYSTEM_BUS_ADDRESS --unsetenv AT_SPI_BUS_ADDRESS \
    --unsetenv IBUS_ADDRESS --unsetenv PULSE_SERVER --unsetenv PYTHONOPTIMIZE \
    "${extra[@]}" "$@"
}
