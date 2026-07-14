#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

npm run verify:versions

bash -n \
  install \
  scripts/install.sh \
  scripts/setup.sh \
  scripts/build-desktop.sh \
  scripts/package-appimage.sh \
  scripts/render-release-body.sh \
  scripts/rehearse-release.sh \
  scripts/test-private-ibus-engine.sh \
  scripts/verify-deb-package.sh \
  scripts/lib/install-common.sh

for installer in install scripts/lib/install-common.sh; do
  rg -q 'local session_type="\$\{XDG_SESSION_TYPE:-x11\}"' "${installer}"
  rg -q 'local alternate_wayland_hotkey="Alt\+Shift\+D"' "${installer}"
done
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import re
from pathlib import Path

functions = []
for path in (Path("install"), Path("scripts/lib/install-common.sh")):
    match = re.search(r"voco_run_hotkey_setup\(\) \{.*?^\}", path.read_text(), re.S | re.M)
    if match is None:
        raise SystemExit(f"Missing hotkey setup function in {path}")
    functions.append(match.group(0))
if functions[0] != functions[1]:
    raise SystemExit("Standalone and source installer hotkey setup have drifted")
print("Installer hotkey setup is in sync.")
PY

PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import ast
from pathlib import Path

for path in (
    Path("scripts/generate-icons.py"),
    Path("scripts/test-private-ibus-engine.py"),
):
    ast.parse(path.read_text())
print("Repository Python helper syntax is valid.")
PY
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import ast
from pathlib import Path

for path in (
    Path("apps/desktop/src-tauri/resources/voco_ibus_engine.py"),
    Path("apps/desktop/src-tauri/resources/voco_ibus_ownership.py"),
    Path("apps/desktop/src-tauri/resources/voco_ibus_protocol.py"),
):
    ast.parse(path.read_text())
print("IBus Python syntax is valid.")
PY

PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import json
import os
import xml.etree.ElementTree as ET
from pathlib import Path

component_path = Path("packaging/ibus/voco.xml")
component = ET.parse(component_path).getroot()
expected = {
    "name": "org.freedesktop.IBus.Voco",
    "exec": "/usr/libexec/voco-ibus-engine",
    "engines/engine/name": "voco",
    "engines/engine/rank": "0",
}
for field, value in expected.items():
    actual = component.findtext(field)
    if actual != value:
        raise SystemExit(f"Unexpected IBus component {field}: {actual!r}")

launcher = Path("packaging/ibus/voco-ibus-engine")
if not os.access(launcher, os.X_OK):
    raise SystemExit("IBus launcher must be executable")

config = json.loads(Path("apps/desktop/src-tauri/tauri.conf.json").read_text())
deb = config["bundle"]["linux"]["deb"]
required_dependencies = {"ibus", "python3", "python3-gi", "gir1.2-ibus-1.0"}
if not required_dependencies.issubset(deb.get("depends", [])):
    raise SystemExit("Debian IBus runtime dependencies are incomplete")
required_files = {
    "/usr/share/ibus/component/voco.xml",
    "/usr/libexec/voco-ibus-engine",
    "/usr/lib/voco/ibus/voco_ibus_engine.py",
    "/usr/lib/voco/ibus/voco_ibus_ownership.py",
    "/usr/lib/voco/ibus/voco_ibus_protocol.py",
}
if not required_files.issubset(deb.get("files", {})):
    raise SystemExit("Debian IBus package mappings are incomplete")
print("Persistent IBus package metadata is valid.")
PY

if rg -n 'set_global_engine|register_component|delete_surrounding_text|get_surrounding_text' \
  apps/desktop/src-tauri/resources/voco_ibus_engine.py; then
  echo "Persistent IBus engine contains a forbidden global or destructive API." >&2
  exit 1
fi

bash -n packaging/ibus/voco-ibus-engine
npm run rehearse:release
