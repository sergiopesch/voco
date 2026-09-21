#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ${1:-} != --inside ]]; then
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
export PATH="/tmp/native-deps/bin:/usr/bin:/bin"
export LD_LIBRARY_PATH="/tmp/native-deps/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export DISPLAY=:0 XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 GSETTINGS_BACKEND=memory GIO_USE_VFS=local
export ACCESSIBILITY_ENABLED=1 GTK_MODULES=atk-bridge PYTHONDONTWRITEBYTECODE=1
Xvfb :0 -screen 0 1280x900x24 -nolisten tcp > "$fixture/evidence/xvfb.log" 2>&1 &
for _ in {1..100}; do [[ -S /tmp/.X11-unix/X0 ]] && break; sleep .02; done
[[ -S /tmp/.X11-unix/X0 ]] || { cat "$fixture/evidence/xvfb.log" >&2; exit 1; }
exec dbus-run-session -- "$VOCO_RICH_EDITOR_NODE" "$ROOT_DIR/scripts/test-rich-editor-delivery.mjs" "$fixture/evidence"
