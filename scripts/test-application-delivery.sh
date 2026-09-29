#!/usr/bin/env bash
# Private desktop for the universal-paste suites. VOCO_DELIVERY_SUITE picks
# applications (default) or browser. VOCO_DELIVERY_PLATFORM picks x11 (default),
# the bare private Xvfb, or gnome-wayland, a nested GNOME Shell with XWayland on
# that Xvfb. VOCO_FIXTURE_PASTE_BINARY, when set, is the voco library test
# executable that pastes through production desktop_paste.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ${1:-} != --inside && ${1:-} != --session ]]; then
  export VOCO_DELIVERY_PLATFORM=${VOCO_DELIVERY_PLATFORM:-x11}
  case $VOCO_DELIVERY_PLATFORM in
    x11|gnome-wayland) ;;
    *) echo 'Unsupported delivery platform' >&2; exit 1 ;;
  esac
  fixture=$(mktemp -d -t voco-application-delivery-XXXXXX)
  trap 'rm -rf "$fixture"' EXIT
  mkdir -p "$fixture"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$fixture/runtime"
  deps=${VOCO_NATIVE_DEPS:-/usr}
  browsers=${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}
  node_binary=$(command -v node || true)
  production_paste=()
  if [[ -n ${VOCO_FIXTURE_PASTE_BINARY:-} ]]; then
    production_paste=(--ro-bind "$(realpath "$VOCO_FIXTURE_PASTE_BINARY")" /tmp/voco-fixture-paste
      --setenv VOCO_FIXTURE_PASTE_BINARY /tmp/voco-fixture-paste)
    if [[ $VOCO_DELIVERY_PLATFORM == gnome-wayland ]]; then
      # Production pastes on Wayland with /usr/bin/ydotool. The installed file
      # is only the mount point for the test-only adapter; no real daemon runs.
      [[ -f /usr/bin/ydotool ]] || { echo 'Install ydotool for the /usr/bin/ydotool mount point' >&2; exit 1; }
      production_paste+=(--ro-bind "$ROOT_DIR/scripts/fixtures/nested-ydotool.py" /usr/bin/ydotool)
    fi
  fi
  if [[ $VOCO_DELIVERY_PLATFORM == gnome-wayland ]]; then
    probe="$fixture/data/gnome-shell/extensions/voco-private-probe@test.invalid"
    mkdir -p "$probe"
    cp "$ROOT_DIR/scripts/fixtures/gnome-private-probe/"* "$probe/"
  fi
  status=0
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$fixture" "$fixture" --ro-bind "$deps" /tmp/native-deps "${production_paste[@]}" \
    --setenv HOME "$fixture/home" --setenv XDG_RUNTIME_DIR "$fixture/runtime" \
    --setenv XDG_CONFIG_HOME "$fixture/config" --setenv XDG_CACHE_HOME "$fixture/cache" \
    --setenv XDG_DATA_HOME "$fixture/data" --setenv XDG_STATE_HOME "$fixture/state" \
    --setenv PLAYWRIGHT_BROWSERS_PATH "$browsers" \
    --setenv VOCO_DELIVERY_NODE "$node_binary" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv AT_SPI_BUS_ADDRESS --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY \
    bash "${BASH_SOURCE[0]}" --inside "$fixture" || status=$?
  if [[ -n ${VOCO_DELIVERY_EVIDENCE_DIR:-} ]]; then
    mkdir -p "$VOCO_DELIVERY_EVIDENCE_DIR"
    cp -a "$fixture/evidence/." "$VOCO_DELIVERY_EVIDENCE_DIR/"
  fi
  exit "$status"
fi
fixture=${2:?}
if [[ ${1:-} == --session ]]; then
  if [[ $VOCO_DELIVERY_PLATFORM == gnome-wayland ]]; then
    [[ ! -e /dev/input && ! -e /dev/uinput ]]
    log=$fixture/evidence/gnome-shell.log
    export LIBGL_ALWAYS_SOFTWARE=1 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=ubuntu:GNOME
    export GNOME_SHELL_SESSION_MODE=user
    # The Shell's login manager needs a system bus; this private one has no services.
    export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/system-test-bus"
    dbus-daemon --session --nofork --address="$DBUS_SYSTEM_BUS_ADDRESS" > "$fixture/evidence/system-bus.log" 2>&1 &
    for _ in {1..100}; do [[ -S $XDG_RUNTIME_DIR/system-test-bus ]] && break; sleep .02; done
    [[ -S $XDG_RUNTIME_DIR/system-test-bus ]]
    (
      # The Shell reads these from the fixture's dconf; applications keep the memory backend.
      unset GSETTINGS_BACKEND
      gsettings set org.gnome.shell enabled-extensions "['voco-private-probe@test.invalid']"
      gsettings set org.gnome.shell disable-user-extensions false
      gsettings set org.gnome.shell welcome-dialog-last-shown-version "'999'"
      gsettings set org.gnome.desktop.interface enable-animations false
      gsettings set org.gnome.desktop.session idle-delay 'uint32 0'
      NO_AT_BRIDGE=1 exec gnome-shell --nested --wayland --wayland-display=voco-delivery --sm-disable
    ) > "$log" 2>&1 &
    shell=$!
    # until_ready ATTEMPTS COMMAND...: retry every 50 ms while the Shell runs.
    until_ready() {
      local attempt
      for ((attempt = 0; attempt < $1; attempt++)); do
        kill -0 "$shell" 2> /dev/null || break
        "${@:2}" > /dev/null 2>&1 && return
        sleep .05
      done
      echo "GNOME Shell was not ready: ${*:2}" >&2
      tail -n 40 "$log" >&2
      exit 1
    }
    xwayland_ready() {
      [[ $(<"$log") =~ Using\ public\ X11\ display\ (:[0-9]+) ]] || return
      xwayland=${BASH_REMATCH[1]}
      local files=("$XDG_RUNTIME_DIR"/.mutter-Xwaylandauth.*)
      [[ ${#files[@]} == 1 && -f ${files[0]} ]] && auth=${files[0]}
    }
    until_ready 600 test -S "$XDG_RUNTIME_DIR/voco-delivery"
    until_ready 600 xwayland_ready
    until_ready 900 dbus-send --session --print-reply --dest=org.gnome.Shell \
      /org/voco/PrivateShellProbe org.voco.PrivateShellProbe.GetWindows
    until_ready 900 grep -q 'GNOME Shell started' "$log"
    # The Shell opens its overview at startup. Escape on its stage window closes
    # it, and the stage keeps the Xvfb keyboard focus for every later key.
    stage=
    for window in $(xdotool search --pid "$shell"); do
      eval "$(xdotool getwindowgeometry --shell "$window")"
      (( WIDTH >= 600 && HEIGHT >= 400 )) && stage=$window
    done
    [[ -n $stage ]] || { echo 'The nested Shell window is unavailable' >&2; exit 1; }
    xdotool windowfocus --sync "$stage"
    overview() {
      gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.freedesktop.DBus.Properties.Get org.gnome.Shell OverviewActive
    }
    for _ in {1..20}; do
      [[ $(overview) == '(<false>,)' ]] && break
      xdotool key Escape
      sleep .5
    done
    [[ $(overview) == '(<false>,)' ]] || { echo 'The Shell overview stayed open' >&2; exit 1; }
    export WAYLAND_DISPLAY=voco-delivery GDK_BACKEND=wayland DISPLAY=$xwayland XAUTHORITY=$auth
    dbus-update-activation-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY GDK_BACKEND \
      XDG_SESSION_TYPE XDG_CURRENT_DESKTOP DBUS_SYSTEM_BUS_ADDRESS LIBGL_ALWAYS_SOFTWARE
    if [[ -n ${VOCO_FIXTURE_PASTE_BINARY:-} ]]; then
      # Production requires a running ydotoold; the adapter takes that name.
      /usr/bin/ydotool --fixture-daemon &
      until_ready 100 pgrep -x ydotoold
    fi
  fi
  case ${VOCO_DELIVERY_SUITE:-applications} in
    applications) exec /usr/bin/python3 "$ROOT_DIR/scripts/test-application-delivery.py" "$fixture" ;;
    browser) exec "${VOCO_DELIVERY_NODE:?Node.js is required for the browser suite}" \
      "$ROOT_DIR/scripts/test-browser-delivery.mjs" "$fixture/evidence" ;;
    *) echo 'Unsupported delivery test suite' >&2; exit 1 ;;
  esac
fi
export PATH="/tmp/native-deps/bin:/usr/bin:/bin"
export LD_LIBRARY_PATH="/tmp/native-deps/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# Every test key goes to the private Xvfb. On gnome-wayland the nested Shell
# forwards it to its focused client, and DISPLAY later names XWayland.
export DISPLAY=:0 VOCO_DELIVERY_KEYBOARD_DISPLAY=:0 XDG_SESSION_TYPE=x11 GDK_BACKEND=x11
export GSETTINGS_BACKEND=memory GIO_USE_VFS=local
# GPU-free Xvfb: keep GTK4 on Cairo instead of slow software GL.
export GSK_RENDERER=cairo
export PYTHONDONTWRITEBYTECODE=1 LC_ALL=C.UTF-8
Xvfb :0 -screen 0 1280x900x24 -nolisten tcp > "$fixture/evidence/xvfb.log" 2>&1 &
for _ in {1..100}; do [[ -S /tmp/.X11-unix/X0 ]] && break; sleep .02; done
[[ -S /tmp/.X11-unix/X0 ]] || { cat "$fixture/evidence/xvfb.log" >&2; exit 1; }
exec dbus-run-session -- bash "${BASH_SOURCE[0]}" --session "$fixture"
