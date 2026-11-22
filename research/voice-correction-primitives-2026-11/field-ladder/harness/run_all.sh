#!/bin/bash
# The whole measurement:   ./run_all.sh          (REPS=3 P=3 by default)
#   REPS=1 ./run_all.sh     one repeat of everything
#   RESUME=1 ./run_all.sh   keep results/*.json and run only what is missing
#   ./run_all.sh --list     print the jobs, run nothing
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
# results/summary.md. One run:  ./run.sh <case> <scenario> [--config NAME] [--rep N]
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 1
REPS="${REPS:-3}"; P="${P:-3}"
mkdir -p results work

BASE="gnome-text-editor gtk4-textview gtk4-entry gedit gtk3-textview gtk3-entry libreoffice-writer gnome-terminal"
WEB="textarea input contenteditable"
FIRST="plain home typed-after other-field"
REST="cleared prefilled text-after"

jobs() {
  local rep=$1 s c f
  if [ "$rep" = 1 ]; then
    # What each app needs to be exposed: the plain scenario under other launch configs.
    for c in plain status force-renderer screen-reader status-screen-reader; do
      echo "chromium-textarea plain --config $c --rep 1"; done
    for c in plain status force-renderer a11y-api force-renderer-a11y-api screen-reader \
             screen-reader-a11y-api status-screen-reader; do
      echo "electron-textarea plain --config $c --rep 1"; done
    for c in status screen-reader qt-always-on qt-accessibility qt-no-desktop-env \
             qt-no-desktop-env-always-on qt-no-desktop-env-screen-reader qt-no-desktop-env-status \
             a11y-address-env root-property xwayland xwayland-qt-no-desktop-env \
             xwayland-qt-no-desktop-env-always-on; do
      echo "featherpad plain --config $c --rep 1"; done
    # More repeats of the configs whose answer matters most or varied between runs.
    for r in 2 3 4 5 6 7 8 9 10; do echo "featherpad plain --config status --rep $r"; done
    for r in 2 3 4 5; do
      echo "featherpad plain --config screen-reader --rep $r"
      echo "featherpad plain --config qt-always-on --rep $r"
    done
    for r in 2 3; do
      for c in status force-renderer; do echo "chromium-textarea plain --config $c --rep $r"; done
      for c in status force-renderer a11y-api; do echo "electron-textarea plain --config $c --rep $r"; done
    done
  fi
  for group in "$FIRST" "$REST"; do
    for s in $group; do
      for c in $BASE; do echo "$c $s --rep $rep"; done
      echo "featherpad $s --rep $rep"
      echo "featherpad $s --config xwayland-root-property --rep $rep"
      for f in $WEB; do
        echo "chromium-$f $s --config status-force-renderer --rep $rep"
        echo "epiphany-$f $s --rep $rep"
      done
    done
  done
  for s in $FIRST $REST; do
    for f in $WEB; do
      echo "electron-$f $s --config status-a11y-api --rep $rep"
      echo "electron-$f $s --config status-force-renderer --rep $rep"
    done
  done
  # Extra hazard, not in the brief's list: focus moves to a window AT-SPI does not expose.
  for c in $BASE; do echo "$c other-unreadable --rep $rep"; done
  echo "featherpad other-unreadable --config xwayland-root-property --rep $rep"
  for f in $WEB; do
    echo "chromium-$f other-unreadable --config status-force-renderer --rep $rep"
    echo "epiphany-$f other-unreadable --rep $rep"
    echo "electron-$f other-unreadable --config status-a11y-api --rep $rep"
  done
  # A variant, not the ladder as specified: refuse unless the field's own
  # top-level window is ACTIVE ("<config>+guard").
  for s in plain other-field other-unreadable; do
    for c in $BASE; do echo "$c $s --config plain+guard --rep $rep"; done
    echo "featherpad $s --config xwayland-root-property+guard --rep $rep"
    for f in $WEB; do
      echo "chromium-$f $s --config status-force-renderer+guard --rep $rep"
      echo "epiphany-$f $s --config plain+guard --rep $rep"
      echo "electron-$f $s --config status-a11y-api+guard --rep $rep"
    done
  done
}

all_jobs() { for rep in $(seq "$REPS"); do jobs "$rep"; done; }

if [ "${1:-}" = --list ]; then all_jobs; exit 0; fi
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

all_jobs | while read -r line; do
  set -- $line
  cfg=plain; rep=1
  while [ $# -gt 0 ]; do
    [ "$1" = --config ] && cfg=$2
    [ "$1" = --rep ] && rep=$2
    shift
  done
  set -- $line
  [ "${RESUME:-0}" = 1 ] && [ -s "results/$1.$2.$cfg.r$rep.json" ] && continue
  echo "$line"
done | xargs -P "$P" -L 1 ./run.sh

/usr/bin/python3.12 summarize.py
