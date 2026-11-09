#!/usr/bin/env bash
# Install update end to end in the real app, on a disposable Ubuntu machine run
# as root (VOCO_DISPOSABLE_MACHINE=1): it installs packages and replaces the
# system's voco package.
#
# It builds this checkout one version below a published release (VOCO_UPDATE_TARGET,
# default packaging/published-release.json), installs that build as the voco package,
# then scripts/test-install-update-app.py starts it in a private X11 session, opens
# Settings from its tray menu, chooses Install update, and checks that the release
# downloads from GitHub, verifies, installs through pkexec and APT, and that VOCO
# restarts as that release. Root's pkexec needs no password; the prompt itself
# needs a desktop session. VOCO starts with umask 0002, as in an Ubuntu or Fedora
# desktop session. pkexec 126 and later pass it on to the helper; Ubuntu 24.04's
# pkexec 124 resets it, so only a newer guest, such as Ubuntu 26.04, catches a
# helper that relies on it. The build's own version and the version check in
# verify:versions are untouched: the build happens in a temporary worktree.
#
# Usage: VOCO_DISPOSABLE_MACHINE=1 scripts/test-install-update-app.sh [EVIDENCE_DIR]
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ ${VOCO_DISPOSABLE_MACHINE:-} == 1 && $EUID == 0 ]] \
  || { echo 'Run as root on a disposable machine, with VOCO_DISPOSABLE_MACHINE=1' >&2; exit 2; }
command -v apt-get >/dev/null && command -v dpkg-query >/dev/null \
  || { echo 'Needs APT: the RPM path is the same code with DNF' >&2; exit 2; }
PYTHON=${VOCO_PYTHON:-/usr/bin/python3}
TARGET=${VOCO_UPDATE_TARGET:-$("$PYTHON" -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$ROOT/packaging/published-release.json")}
[[ $TARGET =~ ^([0-9]{4})\.0\.([1-9][0-9]*)$ ]] || { echo "Not a release version: $TARGET" >&2; exit 2; }
FROM="${BASH_REMATCH[1]}.0.$((BASH_REMATCH[2] - 1))"
EVIDENCE=$(realpath -m "${1:-${TMPDIR:-/tmp}/voco-install-update-$(date -u +%Y%m%dT%H%M%SZ)}")
mkdir -p "$EVIDENCE"
WORK=$(mktemp -d -t voco-install-update-XXXXXX)
cleanup() {
  pkill -x voco || true
  git -C "$ROOT" worktree remove --force "$WORK/tree" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
echo "Install update from a $FROM build of this checkout to the published $TARGET"

DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
  polkitd pkexec dbus xvfb at-spi2-core gir1.2-atspi-2.0 python3-gi >"$EVIDENCE/apt.log"

# This checkout, versioned one below the target, in a temporary worktree, unless
# VOCO_UPDATE_TEST_PACKAGE names a .deb already built that way.
PACKAGE=${VOCO_UPDATE_TEST_PACKAGE:-}
if [[ -z $PACKAGE ]]; then
git -C "$ROOT" worktree add -q --detach "$WORK/tree" HEAD
ln -s "$ROOT/node_modules" "$WORK/tree/node_modules"
(cd "$WORK/tree" && "$PYTHON" - "$FROM" <<'PY'
import json, re, sys
version = sys.argv[1]
for path in ('package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json'):
    data = json.load(open(path))
    data['version'] = version
    open(path, 'w').write(json.dumps(data, indent=2) + '\n')
for path, pattern in (('apps/desktop/src-tauri/Cargo.toml', r'(?m)^(version = )"[^"]+"'),
                      ('apps/desktop/src-tauri/Cargo.lock', r'(name = "voco"\nversion = )"[^"]+"')):
    text = open(path).read()
    changed, count = re.subn(pattern, r'\g<1>"%s"' % version, text, count=1)
    assert count == 1, path
    open(path, 'w').write(changed)
PY
)
(cd "$WORK/tree" && CARGO_TARGET_DIR="$WORK/target" npm run build) >"$EVIDENCE/build.log" 2>&1
PACKAGE="$WORK/target/release/bundle/deb/VOCO_${FROM}_amd64.deb"
fi
dpkg -i "$PACKAGE" >"$EVIDENCE/dpkg.log" 2>&1
[[ $(dpkg-query -W -f='${Version}' voco) == "$FROM" ]] || { echo "The $FROM build didn't install" >&2; exit 1; }

# The system bus and polkit, as a desktop has them.
if [[ ! -S /run/dbus/system_bus_socket ]]; then mkdir -p /run/dbus && dbus-daemon --system --fork; fi
pgrep -x polkitd >/dev/null || { /usr/lib/polkit-1/polkitd --no-debug >"$EVIDENCE/polkitd.log" 2>&1 & }
for _ in $(seq 1 40); do pkaction --action-id com.sergiopesch.voco.update >/dev/null 2>&1 && break; sleep 0.25; done
pkaction --action-id com.sergiopesch.voco.update --verbose >"$EVIDENCE/polkit-action.txt"

# A private session: its own home, settings with setup done, display and buses.
SESSION=$WORK/session
export HOME=$SESSION/home XDG_CONFIG_HOME=$SESSION/home/.config XDG_STATE_HOME=$SESSION/home/.local/state \
  XDG_DATA_HOME=$SESSION/home/.local/share XDG_CACHE_HOME=$SESSION/home/.cache XDG_RUNTIME_DIR=$SESSION/run
mkdir -p "$XDG_CONFIG_HOME/voco" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR" "$HOME"
printf '%s\n' '{"hotkey":"Alt+D","onboardingCompleted":true,"updateChannel":"stable","automaticUpdateChecks":true,"installChannel":"github-release","englishSpelling":"british"}' \
  >"$XDG_CONFIG_HOME/voco/config.json"
chmod 600 "$XDG_CONFIG_HOME/voco/config.json"
export DISPLAY=:91 GDK_BACKEND=x11 XDG_SESSION_TYPE=x11 GTK_A11Y=atspi
unset NO_AT_BRIDGE WAYLAND_DISPLAY
Xvfb :91 -screen 0 1280x900x24 -nolisten tcp >"$EVIDENCE/xvfb.log" 2>&1 &
XVFB=$!
trap 'kill $XVFB 2>/dev/null || true; cleanup' EXIT
sleep 1
umask 0002
dbus-run-session -- bash -c '/usr/libexec/at-spi-bus-launcher --launch-immediately >"$1/atspi.log" 2>&1 & sleep 1; exec "$2" "$3" "$1" "$4" "$5"' \
  _ "$EVIDENCE" "$PYTHON" "$ROOT/scripts/test-install-update-app.py" "$FROM" "$TARGET"
echo "Passed. Evidence: $EVIDENCE"
