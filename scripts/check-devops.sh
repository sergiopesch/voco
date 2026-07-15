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
  scripts/test-install-common.sh \
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

function_names = (
    "voco_escape_json_string",
    "voco_trim",
    "voco_canonical_hotkey_key",
    "voco_validate_hotkey",
    "voco_read_configured_hotkey",
    "voco_migrate_legacy_config",
    "voco_verify_installed_package",
    "voco_install_deb_package",
    "voco_write_default_config",
    "voco_merge_hotkey_into_existing_config",
    "voco_run_hotkey_setup",
)
functions = {name: [] for name in function_names}
for path in (Path("install"), Path("scripts/lib/install-common.sh")):
    contents = path.read_text()
    for name in function_names:
        match = re.search(rf"{name}\(\) \{{.*?^\}}", contents, re.S | re.M)
        if match is None:
            raise SystemExit(f"Missing {name} function in {path}")
        functions[name].append(match.group(0))
for name, copies in functions.items():
    if copies[0] != copies[1]:
        raise SystemExit(f"Standalone and source installer {name} function have drifted")
print("Standalone and source installer helpers are in sync.")
PY

bash scripts/test-install-common.sh

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

flatpak_metainfo_path = Path("packaging/flatpak/com.sergiopesch.voco.metainfo.xml")
tauri_metainfo_path = Path("packaging/tauri/com.sergiopesch.voco.metainfo.xml")
flatpak_metainfo = flatpak_metainfo_path.read_text()
tauri_metainfo = tauri_metainfo_path.read_text()
expected_tauri_metainfo = flatpak_metainfo.replace(
    ">com.sergiopesch.voco.desktop<",
    ">VOCO.desktop<",
    1,
)
if expected_tauri_metainfo == flatpak_metainfo:
    raise SystemExit("Flatpak AppStream metadata is missing its canonical desktop launchable")
if tauri_metainfo != expected_tauri_metainfo:
    raise SystemExit(
        "Tauri and Flatpak AppStream metadata must differ only by desktop launchable"
    )

for path, expected_launchable in (
    (flatpak_metainfo_path, "com.sergiopesch.voco.desktop"),
    (tauri_metainfo_path, "VOCO.desktop"),
):
    metadata = ET.parse(path).getroot()
    if metadata.findtext("id") != "com.sergiopesch.voco":
        raise SystemExit(f"Unexpected AppStream component ID in {path}")
    launchables = [
        node.text
        for node in metadata.findall("launchable")
        if node.attrib.get("type") == "desktop-id"
    ]
    if launchables != [expected_launchable]:
        raise SystemExit(f"Unexpected desktop launchable in {path}: {launchables!r}")

desktop_path = Path("packaging/tauri/VOCO.desktop")
desktop_fields = {}
for raw_line in desktop_path.read_text().splitlines():
    if not raw_line or raw_line.startswith("["):
        continue
    key, separator, value = raw_line.partition("=")
    if not separator:
        raise SystemExit(f"Malformed Tauri desktop entry line: {raw_line!r}")
    desktop_fields[key] = value
expected_desktop_fields = {
    "Type": "Application",
    "Name": "VOCO",
    "Exec": "voco",
    "Icon": "voco",
    "Terminal": "false",
}
for field, expected_value in expected_desktop_fields.items():
    if desktop_fields.get(field) != expected_value:
        raise SystemExit(
            f"Unexpected Tauri desktop entry {field}: {desktop_fields.get(field)!r}"
        )

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
if config["bundle"].get("targets") != ["deb"]:
    raise SystemExit("Default Tauri bundle targets must remain Debian-only")
linux_bundle = config["bundle"]["linux"]
deb = linux_bundle["deb"]
appimage = linux_bundle["appimage"]
tauri_metainfo_source = "../../../packaging/tauri/com.sergiopesch.voco.metainfo.xml"
if deb.get("desktopTemplate") != "../../../packaging/tauri/VOCO.desktop":
    raise SystemExit("Debian desktop template is not the Tauri channel template")
if deb.get("files", {}).get(
    "/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
) != tauri_metainfo_source:
    raise SystemExit("Debian AppStream metadata is not mapped from the Tauri variant")
if appimage.get("files", {}).get(
    "/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
) != tauri_metainfo_source:
    raise SystemExit("AppImage AppStream metadata is not mapped from the Tauri variant")
required_dependencies = {"ibus", "python3", "python3-gi", "gir1.2-ibus-1.0"}
if not required_dependencies.issubset(deb.get("depends", [])):
    raise SystemExit("Debian IBus runtime dependencies are incomplete")
required_files = {
    "/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml",
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

PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import re
from pathlib import Path

workflow = Path(".github/workflows/release.yml").read_text()
if "--bundles appimage" in workflow or "linuxdeploy" in workflow:
    raise SystemExit("Release workflow must not execute the unpinned AppImage toolchain")
if workflow.count("actions/checkout@") != 1 or workflow.count("persist-credentials: false") != 1:
    raise SystemExit("Release build must use one checkout with credential persistence disabled")
if "\n  create-draft:\n" not in workflow:
    raise SystemExit("Release workflow is missing the isolated draft-release job")
draft_job = workflow.split("\n  create-draft:\n", 1)[1]
if "actions/checkout@" in draft_job:
    raise SystemExit("Release-write job must not checkout or execute repository code")
if not re.search(r"actions/upload-artifact@[0-9a-f]{40}", workflow):
    raise SystemExit("Verified release payload upload action must be commit-pinned")
if not re.search(r"actions/download-artifact@[0-9a-f]{40}", workflow):
    raise SystemExit("Verified release payload download action must be commit-pinned")
print("Release workflow privilege and artifact boundaries are valid.")
PY

if rg -n 'set_global_engine|register_component|delete_surrounding_text|get_surrounding_text' \
  apps/desktop/src-tauri/resources/voco_ibus_engine.py; then
  echo "Persistent IBus engine contains a forbidden global or destructive API." >&2
  exit 1
fi

bash -n packaging/ibus/voco-ibus-engine
npm run rehearse:release
