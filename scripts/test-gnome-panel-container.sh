#!/usr/bin/env bash
# The GNOME companion suite on another distribution's GNOME Shell, for a major
# that no hosted runner ships. An unprivileged build installs Shell; the suite
# then runs as you in a rootless, privileged Podman container, where
# Bubblewrap can create its private namespaces. Nothing is installed on the
# host, and the checkout is mounted read-only.
#
#   VOCO_PANEL_IMAGE=registry.fedoraproject.org/fedora:45@sha256:… \
#   VOCO_PANEL_EVIDENCE_DIR=/new/dir bash scripts/test-gnome-panel-container.sh
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${VOCO_PANEL_IMAGE:?Set a Fedora image, pinned by digest}"
: "${VOCO_PANEL_EVIDENCE_DIR:?Set a fresh evidence directory}"
[[ ! -e $VOCO_PANEL_EVIDENCE_DIR ]] || { echo 'Evidence directory exists' >&2; exit 1; }
evidence_parent=$(dirname "$VOCO_PANEL_EVIDENCE_DIR")
mkdir -p "$evidence_parent"
tag=localhost/voco-gnome-panel:$$
context=$(mktemp -d)
trap 'podman rmi --force "$tag" >/dev/null 2>&1 || true; rm -rf "$context"' EXIT
# Package scripts in a privileged container can reach the host's udev; build
# unprivileged, where they can't.
podman build --quiet --tag "$tag" --file - "$context" <<EOF >/dev/null
FROM $VOCO_PANEL_IMAGE
RUN dnf install -y -q --setopt=install_weak_deps=False gnome-shell bubblewrap \
      dbus-daemon dbus-tools glib2 python3 python3-gobject gtk3 && dnf clean all
EOF
# The suite's sandbox mounts tmpfs on /run/dbus and /run/user, which a fresh
# container lacks.
podman run --rm --privileged --userns=keep-id --user "$(id -u):$(id -g)" \
  --tmpfs /run/dbus --tmpfs /run/user \
  --volume "$ROOT:/src:ro" --volume "$evidence_parent:/out" \
  --env VOCO_PANEL_EVIDENCE_DIR="/out/$(basename "$VOCO_PANEL_EVIDENCE_DIR")" \
  --env VOCO_PANEL_SUITE="${VOCO_PANEL_SUITE:-full}" \
  "$tag" bash /src/scripts/test-gnome-panel.sh
