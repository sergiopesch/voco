#!/bin/bash
# The whole measurement:   ./run_all.sh          (REPS=3 P=3 by default)
#   REPS=1 ./run_all.sh     one repeat of everything
#   RESUME=1 ./run_all.sh   keep results/*.json and run only what is missing
#   ELECTRON=0 ./run_all.sh leave the Electron cases out
#   ./run_all.sh --list     print the jobs, run nothing
#   ./run_all.sh --trials DIR CASE...
#                           every DIR/*.json trial once on each named case;
#                           the matrix's results are kept
#
# The matrix is every case below x every scenario x REPS, each case under the
# one launch config that exposes it to AT-SPI here.
#
# Needs (Ubuntu 24.04, as root; apt and npm only):
#   apt-get install -y --no-install-recommends gnome-shell mutter xwayland \
#     wl-clipboard qtwayland5 at-spi2-core gir1.2-atspi-2.0 gir1.2-gtk-4.0 \
#     gir1.2-gtk-3.0 python3-gi xclip gnome-text-editor gedit featherpad \
#     qt5-gtk-platformtheme libreoffice-writer libreoffice-gtk3 gnome-terminal \
#     epiphany-browser fonts-dejavu-core gsettings-desktop-schemas libglib2.0-bin \
#     x11-utils dbus-daemon
#   Playwright's Chromium at /opt/pw-browsers/chromium
#   (cd electron-app && npm install electron && node node_modules/electron/install.js)
#
# Every run is one fresh session (run.sh). Results: results/*.json, then
# results/summary.md and results/summary.json. One run:
#   ./run.sh <case> <scenario> [--config NAME] [--rep N]
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 1
REPS="${REPS:-3}"; P="${P:-3}"
mkdir -p results work

CASES="gnome-text-editor gtk4-textview gtk4-entry gedit gtk3-textview gtk3-entry libreoffice-writer
  featherpad gnome-terminal chromium-textarea chromium-input chromium-contenteditable
  epiphany-textarea epiphany-input epiphany-contenteditable"
ELECTRON_CASES="electron-textarea electron-input electron-contenteditable"
SCENARIOS="plain home typed-after cleared other-field prefilled text-after other-unreadable
  twice two-lines selected-all emoji-before non-ascii"
if [ "${ELECTRON:-1}" = 1 ]; then
  if [ -x electron-app/node_modules/electron/dist/electron ]; then
    CASES="$CASES $ELECTRON_CASES"
  else
    echo "Electron is not installed in electron-app: its cases are left out" >&2
  fi
fi

# The launch config each case is exposed under.
config_of() {
  case "$1" in
    featherpad) echo xwayland-root-property ;;
    chromium-*) echo status-force-renderer ;;
    electron-*) echo status-a11y-api ;;
    *) echo plain ;;
  esac
}

all_jobs() {
  local rep s c
  for rep in $(seq "$REPS"); do
    for s in $SCENARIOS; do
      for c in $CASES; do echo "$c $s --config $(config_of "$c") --rep $rep"; done
    done
  done
}

trial_jobs() {
  local dir=$1 c t; shift
  for c in "$@"; do
    for t in "$dir"/*.json; do echo "$c plain --trial $t --config $(config_of "$c") --rep 1"; done
  done
}

# The result file a job line writes.
result_of() {
  local case=$1 name=$2 cfg=plain rep=1; shift 2
  while [ $# -gt 0 ]; do
    [ "$1" = --config ] && cfg=$2
    [ "$1" = --rep ] && rep=$2
    [ "$1" = --trial ] && name="trial-$(/usr/bin/python3.12 -c 'import json, sys; print(json.load(open(sys.argv[1]))["id"])' "$2")"
    shift
  done
  echo "results/$case.$name.$cfg.r$rep.json"
}

run_jobs() {
  while read -r line; do
    # shellcheck disable=SC2086
    [ "${RESUME:-0}" = 1 ] && [ -s "$(result_of $line)" ] && continue
    echo "$line"
  done | xargs -r -P "$P" -L 1 ./run.sh
}

if [ "${1:-}" = --list ]; then all_jobs; exit 0; fi
if [ "${1:-}" = --trials ]; then
  [ -d "${2:-}" ] && [ $# -ge 3 ] || { echo "usage: ./run_all.sh --trials DIR CASE..." >&2; exit 2; }
  DIR="$(readlink -f "$2")"; shift 2
  trial_jobs "$DIR" "$@" | run_jobs
  /usr/bin/python3.12 summarize.py
  exit
fi
if [ "${RESUME:-0}" != 1 ]; then
  rm -f results/*.json
  rm -rf work/run.* work/*.r*.log
fi

{
  dpkg-query -W -f='${Package} ${Version}\n' gnome-shell mutter xwayland wl-clipboard qtwayland5 \
    at-spi2-core libatspi2.0-0t64 libatk-bridge2.0-0t64 libgtk-3-0t64 libgtk-4-1 libqt5gui5t64 \
    qt5-gtk-platformtheme libvte-2.91-0 libwebkitgtk-6.0-4 gnome-text-editor gedit featherpad \
    libreoffice-writer libreoffice-gtk3 gnome-terminal epiphany-browser xclip bash python3-gi 2>&1
  "$(readlink -f /opt/pw-browsers/chromium 2>/dev/null || echo /nonexistent)" --version 2>&1
  echo "electron (npm) $(cat electron-app/node_modules/electron/dist/version 2>/dev/null || echo 'not installed')"
  echo "node $(node --version 2>/dev/null)"
  uname -sr
} >results/versions.txt

all_jobs | run_jobs
/usr/bin/python3.12 summarize.py
