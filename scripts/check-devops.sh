#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

for command in git node npm python3; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required DevOps preflight command is unavailable: ${command}" >&2
    exit 1
  fi
done

npm run verify:versions

node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = createRequire(path.resolve('package.json'));
const desktop = createRequire(path.resolve('apps/desktop/package.json'));
assert.equal(root.resolve('vite'), desktop.resolve('vite'),
  'Root renderer fixtures and the desktop must resolve the same Vite build');
console.log('Renderer fixtures and desktop share the Vite build tool.');
JS

PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-check-shell-syntax.py

# Every tracked shell script, including the extensionless installer and IBus launcher.
git ls-files -z -- install packaging/ibus/voco-ibus-engine '*.sh' \
  | xargs -0 bash scripts/check-shell-syntax.sh

python3 scripts/sync-installer-ui.py --check

bash scripts/test-verify-release.sh

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
    "voco_detect_package_manager",
    "voco_verify_installed_rpm",
    "voco_install_rpm_package",
    "voco_verify_desktop_input",
    "voco_write_default_config",
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

PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-install-presentation.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-install-performance.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-install-launch.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-install-journey.py

node --check scripts/comparative-dictation.mjs
node --check scripts/comparative-dictation.test.mjs
node --check scripts/test-browser-delivery.mjs
node --test scripts/comparative-dictation.test.mjs

PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import ast
import subprocess

tracked = subprocess.run(
    ["git", "ls-files", "-z", "--", "*.py"],
    check=True, capture_output=True, text=True,
).stdout.split("\0")
paths = [path for path in tracked if path]
for path in paths:
    with open(path, encoding="utf-8") as source:
        ast.parse(source.read(), filename=path)
print(f"Python syntax is valid in {len(paths)} tracked files.")
PY

PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import json
import os
import xml.etree.ElementTree as ET
from pathlib import Path

metainfo_path = Path("packaging/tauri/com.sergiopesch.voco.metainfo.xml")
metadata = ET.parse(metainfo_path).getroot()
if metadata.findtext("id") != "com.sergiopesch.voco":
    raise SystemExit(f"Unexpected AppStream component ID in {metainfo_path}")
launchables = [
    node.text
    for node in metadata.findall("launchable")
    if node.attrib.get("type") == "desktop-id"
]
if launchables != ["VOCO.desktop"]:
    raise SystemExit(f"Unexpected desktop launchable in {metainfo_path}: {launchables!r}")

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
if set(linux_bundle) != {"deb"}:
    raise SystemExit("The Debian package is the only Linux bundle")
if deb.get("desktopTemplate") != "../../../packaging/tauri/VOCO.desktop":
    raise SystemExit("Debian desktop template is not packaging/tauri/VOCO.desktop")
if deb.get("files", {}).get(
    "/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
) != "../../../packaging/tauri/com.sergiopesch.voco.metainfo.xml":
    raise SystemExit("Debian AppStream metadata is not mapped from packaging/tauri")
required_dependencies = {"ibus", "python3", "python3-gi", "gir1.2-ibus-1.0",
                         "xdotool", "xclip", "wl-clipboard", "libnotify-bin",
                         "libc6 (>= 2.39)", "libstdc++6 (>= 13.2.0)"}
if not required_dependencies.issubset(deb.get("depends", [])):
    raise SystemExit("Debian IBus runtime dependencies are incomplete")
if "recommends" in deb:
    raise SystemExit("VOCO pastes through its own virtual keyboard; the package recommends nothing")
if deb.get("files", {}).get("/usr/lib/udev/rules.d/70-voco-uinput.rules") != "../../../packaging/udev/70-voco-uinput.rules":
    raise SystemExit("The package must ship the /dev/uinput access rule")
required_files = {
    "/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml",
    "/usr/share/ibus/component/voco.xml",
    "/usr/libexec/voco-ibus-engine",
    "/usr/lib/voco/ibus/voco_ibus_engine.py",
    "/usr/lib/voco/ibus/voco_ibus_protocol.py",
}
if not required_files.issubset(deb.get("files", {})):
    raise SystemExit("Debian IBus package mappings are incomplete")
print("Persistent IBus package metadata is valid.")
PY

# The Fedora RPM is built from the Debian package's staged tree, so Tauri keeps
# bundling only the .deb; these are the RPM's own source gates.
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "scripts")
import rpm_package

spec_path = Path("packaging/rpm/voco.spec.in")
spec = spec_path.read_text()
depends = json.loads(Path("apps/desktop/src-tauri/tauri.conf.json").read_text())["bundle"]["linux"]["deb"]["depends"]
if set(depends) | set(rpm_package.TAURI_IMPLIED_DEPENDS) != set(rpm_package.DEBIAN_TO_FEDORA):
    raise SystemExit("Every Debian dependency needs its Fedora name in scripts/rpm_package.py DEBIAN_TO_FEDORA")
requires = tuple(re.findall(r"^Requires:\s+(.+?)\s*$", spec, re.M))
if requires != rpm_package.FEDORA_REQUIRES:
    raise SystemExit(f"{spec_path} must require exactly the mapped Fedora names: {requires}")
for floor in ("glibc >= 2.39", "libstdc++ >= 13.2"):
    if floor not in requires:
        raise SystemExit(f"{spec_path} is missing the verified ABI floor {floor}")
extra = re.findall(r"^(Recommends|Suggests|Supplements|Enhances|Conflicts|Obsoletes|Provides|"
                   r"BuildRequires|Source\d*|Patch\d*|Epoch|BuildArch):", spec, re.M | re.I)
if extra:
    raise SystemExit(f"{spec_path} declares {extra}; VOCO's RPM recommends, provides and downloads nothing")
sections = {"prep", "build", "install", "check", "clean", "conf", "generate_buildrequires", "pre",
            "post", "preun", "postun", "pretrans", "posttrans", "preuntrans", "postuntrans",
            "verifyscript", "triggerprein", "triggerin", "triggerun", "triggerpostun",
            "filetriggerin", "filetriggerun", "filetriggerpostun", "transfiletriggerin",
            "transfiletriggerun", "transfiletriggerpostun"}
if [name for name in re.findall(r"^%(\w+)", spec, re.M) if name in sections] != ["post"] \
        or "\n%post\n@POST@\n\n%files\n" not in spec:
    raise SystemExit(f"{spec_path} may run only packaging/rpm/post.sh, and it builds nothing")
if not re.search(r"^ExclusiveArch:\s+x86_64$", spec, re.M) or rpm_package.RELEASE != "1":
    raise SystemExit(f"{spec_path} must stay x86_64 release 1, the installer's voco-<version>-1.x86_64.rpm")
if "%" in Path("packaging/rpm/post.sh").read_text():
    raise SystemExit("packaging/rpm/post.sh must not contain rpm macros")
for macro in ("__provides_exclude_from ^/usr/lib/voco/speech/", "_build_id_links none", "__os_install_post %{nil}"):
    if f"%global {macro}" not in spec:
        raise SystemExit(f"{spec_path} must keep %global {macro}")
print("Fedora RPM packaging metadata is valid.")
PY

PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import re
from pathlib import Path

workflow_path = Path(".github/workflows/ci.yml")
workflow = workflow_path.read_text()
commands = [line.strip() for line in workflow.splitlines()]
if sorted(path.name for path in Path(".github/workflows").iterdir()) != ["ci.yml"]:
    raise SystemExit("CI is the only workflow; releases are assembled locally")
if "\npermissions:\n  contents: read\n" not in workflow or "checks: write" in workflow:
    raise SystemExit(f"{workflow_path} must stay read-only")
unpinned = [action for action in re.findall(r"uses: (\S+)", workflow)
            if not re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", action)]
if unpinned:
    raise SystemExit(f"{workflow_path} actions must be pinned to full commit SHAs: {unpinned}")
if workflow.count("actions/checkout@") != workflow.count("persist-credentials: false"):
    raise SystemExit(f"{workflow_path} checkouts must not persist credentials")
steps = "\n".join(line for line in workflow.splitlines() if not line.lstrip().startswith("#"))
for forbidden in ("package-nvidia.py", "sign-release-checksums", "assemble-release", "secrets."):
    if forbidden in steps:
        raise SystemExit(f"Hosted CI must not assemble or sign releases: {forbidden}")
hosted = "run: bash scripts/test-private-ibus-engine-hosted.sh"
for suite in ("", " --native-desktop", " --full-application", " --browser-application", " --browser-toolbar"):
    if commands.count(hosted + suite) != 1:
        raise SystemExit(f"{workflow_path} must run the isolated gate `{hosted}{suite}` exactly once")
if "\n  application:\n" not in workflow:
    raise SystemExit(f"{workflow_path} is missing the release-build application job")
application = workflow.split("\n  application:\n", 1)[1]
release_build = "cargo build --locked --release --features custom-protocol --bin voco --bin voco-browser-host"
if release_build not in application or application.index(release_build) > application.index("--full-application"):
    raise SystemExit("The application job must test the release build of both executables")
if commands.count("run: npm run test:chromium-exact-field") != 1:
    raise SystemExit(f"{workflow_path} must run the Chromium recipient and background lifecycle gates")
if not all(re.search(rf"\s{helper}\s", workflow) for helper in ("xdotool", "xclip")):
    raise SystemExit(f"{workflow_path} must install the X11 paste helpers its desktop gates use")
if "run: npm run test:private-ibus" in workflow:
    raise SystemExit(f"{workflow_path} bypasses the hosted IBus namespace wrapper")
if "rustsec/audit-check@" in workflow:
    raise SystemExit(f"{workflow_path} uses the non-reproducible Node audit action")
if workflow.count('cargo install cargo-audit --version "0.22.2" --locked') != 1:
    raise SystemExit(f"{workflow_path} must install one lockfile-pinned cargo-audit tool")
if workflow.count("\n          cargo audit\n") != 1:
    raise SystemExit(f"{workflow_path} must run one Rust dependency audit")
rust_version = re.search(r'^rust-version = "([^"]+)"$',
                         Path("apps/desktop/src-tauri/Cargo.toml").read_text(), re.M)
toolchains = set(re.findall(r"^\s+toolchain: (\S+)$", workflow, re.M))
if not rust_version or toolchains != {rust_version[1]}:
    raise SystemExit(f"{workflow_path} Rust toolchains {sorted(toolchains)} must match Cargo.toml rust-version")
print("CI workflow gates, pins and permissions are valid.")
PY

if grep -En 'set_global_engine|register_component|delete_surrounding_text|get_surrounding_text' \
  apps/desktop/src-tauri/resources/voco_ibus_engine.py; then
  echo "Persistent IBus engine contains a forbidden global or destructive API." >&2
  exit 1
fi

bash -n packaging/ibus/voco-ibus-engine
npm run rehearse:release
