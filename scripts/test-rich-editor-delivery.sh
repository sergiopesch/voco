#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ${1:-} != --inside && ${1:-} != --session ]]; then
  fixture=$(mktemp -d -t voco-rich-editor-XXXXXX)
  trap 'rm -rf "$fixture"' EXIT
  mkdir -p "$fixture"/{home,runtime,config,cache,data,state,evidence}
  chmod 700 "$fixture/runtime"
  deps=${VOCO_NATIVE_DEPS:-/usr}
  browsers=${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}
  node_binary=$(command -v node)
  status=0
  bwrap --die-with-parent --new-session --unshare-ipc --unshare-net --unshare-pid --unshare-uts \
    --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run/user --tmpfs /run/dbus \
    --bind "$fixture" "$fixture" --ro-bind "$deps" /tmp/native-deps \
    --setenv HOME "$fixture/home" --setenv XDG_RUNTIME_DIR "$fixture/runtime" \
    --setenv XDG_CONFIG_HOME "$fixture/config" --setenv XDG_CACHE_HOME "$fixture/cache" \
    --setenv XDG_DATA_HOME "$fixture/data" --setenv XDG_STATE_HOME "$fixture/state" \
    --setenv PLAYWRIGHT_BROWSERS_PATH "$browsers" \
    --setenv VOCO_RICH_EDITOR_NODE "$node_binary" \
    --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY --unsetenv DBUS_SESSION_BUS_ADDRESS \
    --unsetenv AT_SPI_BUS_ADDRESS --unsetenv IBUS_ADDRESS --unsetenv XAUTHORITY \
    bash "${BASH_SOURCE[0]}" --inside "$fixture" || status=$?
  if [[ -n ${VOCO_RICH_EDITOR_EVIDENCE_DIR:-} ]]; then
    mkdir -p "$VOCO_RICH_EDITOR_EVIDENCE_DIR"
    cp -a "$fixture/evidence/." "$VOCO_RICH_EDITOR_EVIDENCE_DIR/"
  fi
  exit "$status"
fi
fixture=${2:?}
if [[ ${1:-} == --session ]]; then
  case ${VOCO_RICH_EDITOR_PLATFORM:-x11} in
    x11) ;;
    wayland)
      [[ ! -e /dev/input && ! -e /dev/uinput && ! -e /dev/snd ]]
      export LIBGL_ALWAYS_SOFTWARE=1 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=ubuntu:GNOME
      export GNOME_SHELL_SESSION_MODE=user
      export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/system-test-bus"
      dbus-daemon --session --nofork --address="$DBUS_SYSTEM_BUS_ADDRESS" > "$fixture/evidence/system-bus.log" 2>&1 &
      for _ in {1..100}; do [[ -S "$XDG_RUNTIME_DIR/system-test-bus" ]] && break; sleep .02; done
      [[ -S "$XDG_RUNTIME_DIR/system-test-bus" ]]
      unset GSETTINGS_BACKEND
      gsettings set org.gnome.desktop.interface enable-animations false
      NO_AT_BRIDGE=1 gnome-shell --nested --wayland --wayland-display=voco-rich-editor --sm-disable > "$fixture/evidence/gnome-shell.log" 2>&1 &
      export VOCO_RICH_EDITOR_SHELL_PID=$!
      for _ in {1..200}; do
        kill -0 "$VOCO_RICH_EDITOR_SHELL_PID" || exit 1
        [[ -S "$XDG_RUNTIME_DIR/voco-rich-editor" ]] && break
        sleep .05
      done
      [[ -S "$XDG_RUNTIME_DIR/voco-rich-editor" ]]
      for _ in {1..100}; do
        while IFS= read -r line; do
          if [[ "$line" =~ Using\ public\ X11\ display\ (:[0-9]+), ]]; then
            export VOCO_RICH_EDITOR_CLIPBOARD_DISPLAY="${BASH_REMATCH[1]}"
          fi
        done < "$fixture/evidence/gnome-shell.log"
        [[ -n ${VOCO_RICH_EDITOR_CLIPBOARD_DISPLAY:-} ]] && break
        sleep .05
      done
      : "${VOCO_RICH_EDITOR_CLIPBOARD_DISPLAY:?Private public Xwayland display unavailable}"
      auth_files=("$XDG_RUNTIME_DIR"/.mutter-Xwaylandauth.*)
      [[ ${#auth_files[@]} == 1 && -f ${auth_files[0]} ]]
      export VOCO_RICH_EDITOR_CLIPBOARD_XAUTHORITY="${auth_files[0]}"
      export WAYLAND_DISPLAY=voco-rich-editor GDK_BACKEND=wayland
      dbus-update-activation-environment WAYLAND_DISPLAY GDK_BACKEND DBUS_SYSTEM_BUS_ADDRESS
      ;;
    *) echo 'Unsupported private browser platform' >&2; exit 1 ;;
  esac
  case ${VOCO_DELIVERY_SUITE:-browser} in
    browser) exec "$VOCO_RICH_EDITOR_NODE" "$ROOT_DIR/scripts/test-rich-editor-delivery.mjs" "$fixture/evidence" ;;
    applications)
      [[ ${VOCO_RICH_EDITOR_PLATFORM:-x11} == x11 ]]
      exec /usr/bin/python3 "$ROOT_DIR/scripts/test-application-delivery.py" "$fixture"
      ;;
    *) echo 'Unsupported delivery test suite' >&2; exit 1 ;;
  esac
fi
export PATH="/tmp/native-deps/bin:/usr/bin:/bin"
export LD_LIBRARY_PATH="/tmp/native-deps/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export DISPLAY=:0 XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 GSETTINGS_BACKEND=memory GIO_USE_VFS=local
export ACCESSIBILITY_ENABLED=1 GTK_MODULES=atk-bridge PYTHONDONTWRITEBYTECODE=1
export LC_ALL=C.UTF-8
Xvfb :0 -screen 0 1280x900x24 -nolisten tcp > "$fixture/evidence/xvfb.log" 2>&1 &
for _ in {1..100}; do [[ -S /tmp/.X11-unix/X0 ]] && break; sleep .02; done
[[ -S /tmp/.X11-unix/X0 ]] || { cat "$fixture/evidence/xvfb.log" >&2; exit 1; }
exec dbus-run-session -- bash "${BASH_SOURCE[0]}" --session "$fixture"
