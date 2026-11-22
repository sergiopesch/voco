#!/bin/bash
# The whole measurement, from scratch:   ./run_all.sh
#
# Needs (Ubuntu 24.04, as root, apt):
#   apt-get install -y --no-install-recommends at-spi2-core gir1.2-atspi-2.0 \
#     gir1.2-gtk-4.0 gir1.2-gtk-3.0 libgtk-4-1 openbox xdotool xclip xterm \
#     gnome-text-editor gedit mousepad featherpad libreoffice-writer \
#     libreoffice-gtk3 gnome-terminal xfce4-terminal epiphany-browser \
#     fonts-dejavu-core dbus-x11 gsettings-desktop-schemas libglib2.0-bin \
#     qt5-gtk-platformtheme x11-utils imagemagick xvfb
# and Playwright's Chromium at /opt/pw-browsers/chromium.
#
# Every run is one fresh session (Xvfb + dbus-run-session + openbox + a
# throwaway HOME under work/). Results: results/*.json, then results/summary.md.
# One case:      ./run_case.sh <case> [config] [scenario ...]
# One run:       ./run.sh <case> <scenario> [--config NAME]
# Lists:         /usr/bin/python3.12 measure.py --list
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 1
mkdir -p results work
rm -f results/*.json
rm -rf work/run.*

dpkg-query -W -f='${Package} ${Version}\n' at-spi2-core libatspi2.0-0t64 \
  libatk-bridge2.0-0t64 libgtk-3-0t64 libgtk-4-1 libqt5gui5t64 libvte-2.91-0 \
  libwebkitgtk-6.0-4 gnome-text-editor gedit mousepad featherpad \
  libreoffice-writer libreoffice-gtk3 gnome-terminal xfce4-terminal xterm \
  epiphany-browser openbox xdotool xclip xvfb bash python3-gi 2>&1 >results/versions.txt
"$(readlink -f /opt/pw-browsers/chromium 2>/dev/null || echo /nonexistent)" --version >>results/versions.txt 2>&1
uname -sr >>results/versions.txt

ALL="probe atspi atspi_settext atspi_selpaste blind hazard_atspi hazard_blind"

# Apps that needed nothing: every scenario under "plain", and two more probes
# for when the AT-SPI client connects only after the app is up.
for c in gnome-text-editor gtk4-textview gtk4-entry gedit mousepad gtk3-textview gtk3-entry \
         libreoffice-writer gnome-terminal xfce4-terminal xterm \
         epiphany-textarea epiphany-input epiphany-contenteditable; do
  ./run_case.sh "$c" plain $ALL
  ./run_case.sh "$c" bus-late-client probe
  ./run_case.sh "$c" late-client probe
done

# Qt.
./run_case.sh featherpad plain $ALL
for cfg in bus-late-client late-client late-client-qt-always-on bus-late-client-qt-always-on bus-late-client-status; do
  ./run_case.sh featherpad "$cfg" probe
done

# Chromium: what exposes the page, then every scenario under the one config that did.
for cfg in plain late-client bus-late-client force-renderer bus-late-client-force-renderer \
           status bus-late-client-status screen-reader status-screen-reader-after-launch \
           gnome-accessibility-env accessibility-enabled-env status-accessibility-enabled-env \
           status-force-renderer bus-late-client-status-force-renderer; do
  ./run_case.sh chromium-textarea "$cfg" probe
done
for c in chromium-textarea chromium-input chromium-contenteditable; do
  ./run_case.sh "$c" status-force-renderer atspi atspi_settext atspi_selpaste blind hazard_atspi hazard_blind
done
./run_case.sh chromium-input status-force-renderer probe
./run_case.sh chromium-contenteditable status-force-renderer probe
./run_case.sh chromium-input plain probe
./run_case.sh chromium-contenteditable plain probe

/usr/bin/python3.12 summarize.py
