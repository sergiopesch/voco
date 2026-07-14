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

PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile scripts/generate-icons.py
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import ast
from pathlib import Path

for path in (
    Path("apps/desktop/src-tauri/resources/voco_ibus_engine.py"),
    Path("apps/desktop/src-tauri/resources/voco_ibus_ownership.py"),
):
    ast.parse(path.read_text())
print("IBus Python syntax is valid.")
PY
npm run rehearse:release
