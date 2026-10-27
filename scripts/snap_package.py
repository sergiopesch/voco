"""Build and check VOCO's strict snap from the staged package tree.

`package-nvidia.py --snap` stages one tree and builds every package from it.
This module copies that tree's snap payload, leaving out what strict
confinement can't use, renders packaging/snap/snapcraft.yaml.in beside it,
runs snapcraft on the resulting project folder, and holds the checks
verify-snap-package.sh runs on the built snap.
"""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET

import rpm_package

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "packaging/snap/snapcraft.yaml.in"
WRAPPERS = ROOT / "packaging/snap/wrappers"
METAINFO = "usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
DESKTOP = "usr/share/applications/VOCO.desktop"
ICON = "usr/share/icons/hicolor/256x256@2/apps/voco.png"
ARCH = "amd64"

# What the packages stage and strict confinement can't use (AGENTS.md). Each
# path must exist in the staged tree, so this list can't silently go stale.
EXCLUDED = (
    "DEBIAN",
    # The snap has no /dev/uinput; on Wayland only the companion types for it.
    "usr/lib/udev/rules.d/70-voco-uinput.rules",
    "usr/lib/modules-load.d/voco-uinput.conf",
    # IBus can't start an engine from inside a snap.
    "usr/share/ibus/component/voco.xml",
    "usr/libexec/voco-ibus-engine",
    "usr/lib/voco/ibus",
    # The snap's companion comes from extensions.gnome.org.
    "usr/share/gnome-shell/extensions/voco-panel@sergiopesch.com",
    # Browsers can't start a native host inside a snap.
    "usr/bin/voco-browser-host",
    "usr/libexec/voco-browser-host",
    "etc/chromium/native-messaging-hosts/com.voco.exact_field.json",
    "etc/opt/chrome/native-messaging-hosts/com.voco.exact_field.json",
    "usr/share/voco/chromium",
)

# The Ubuntu programs the recipe stages, each in a private folder with its
# libraries, and the wrappers that run them (packaging/snap/wrappers).
PRIVATE = "usr/lib/voco/snap"
PYTHON = f"{PRIVATE}/python"
HELPERS = f"{PRIVATE}/helpers"
HELPER_NAMES = ("xclip", "xdotool", "notify-send")
WRAPPER_FILES = {f"{PRIVATE}/python3": "python3", f"{PRIVATE}/run-helper": "run-helper"}
# Paths only the snap has: snapcraft's metadata, the GNOME extension's launcher,
# its content mount points, the private programs and the helpers' names.
SNAP_ONLY = ("meta", "snap", PRIVATE, "gnome-platform", "gpu-2404", "data-dir",
             *(f"usr/bin/{name}" for name in HELPER_NAMES))

# The plugs and slots the snap may have: VOCO's own and the GNOME extension's.
VOCO_PLUGS = ("audio-playback", "audio-record", "login-session-observe")
EXTENSION_APP_PLUGS = ("desktop", "desktop-legacy", "gsettings", "opengl", "wayland", "x11")
EXTENSION_CONTENT_PLUGS = {"gtk-3-themes": "gtk-common-themes", "icon-themes": "gtk-common-themes",
                           "sound-themes": "gtk-common-themes", "gnome-46-2404": "gnome-46-2404",
                           "gpu-2404": "mesa-2404"}
SLOTS = {"panel": {"interface": "dbus", "bus": "session", "name": "org.voco.Panel"}}

# The metainfo's update item; the snap replaces it with the store's updates.
UPDATE_ITEM = "Update checks against GitHub Releases; VOCO never downloads or installs updates itself"
STORE_UPDATES = "The Snap Store keeps VOCO up to date"
# What App Center's listing says about where the snap types, and the license
# the license field can't name.
SNAP_TYPING = ("The snap types in GNOME on Wayland, through the VOCO panel from "
               "extensions.gnome.org, and in X11 sessions. On other Wayland desktops, "
               "use VOCO's .deb or RPM from its GitHub releases.")
MODEL_LICENSE = ("VOCO is MIT-licensed, and its speech runtime Apache-2.0. The speech model, "
                 "NVIDIA's Nemotron, comes under the NVIDIA Open Model License, and the snap "
                 "carries every license and notice.")
LICENSE = "MIT AND Apache-2.0"


# The template's reviewed lines (check-devops.sh): strict on core24 with the
# GNOME extension, VOCO's own plugs and the panel slot on the session bus.
RECIPE_LINES = ("base: core24", "confinement: strict", "grade: stable", "    extensions: [gnome]",
                f"    plugs: [{', '.join(VOCO_PLUGS)}]", "    slots: [panel]", "  panel:",
                "    interface: dbus", "    bus: session", "    name: org.voco.Panel")
# Plugs a reviewer would have to approve, which VOCO never needs.
UNREVIEWED_PLUGS = ("network", "network-bind", "home", "removable-media", "personal-files",
                    "system-files", "hardware-observe", "system-observe", "raw-usb", "uinput",
                    "unity7", "devmode", "classic")


def snap_name(version):
    return f"voco_{version}_{ARCH}.snap"


def check_recipe(text):
    """The recipe declares only the reviewed confinement, plugs and slot."""
    lines = text.splitlines()
    missing = [line for line in RECIPE_LINES if lines.count(line) != 1]
    if missing:
        raise ValueError(f"The snap recipe must declare each of these once: {missing}")
    declarations = [line.strip() for line in lines if re.match(r"\s*(plugs|slots):", line)]
    if declarations != ["slots:", "plugs: [" + ", ".join(VOCO_PLUGS) + "]", "slots: [panel]"]:
        raise ValueError(f"The snap recipe declares unreviewed plugs or slots: {declarations}")
    words = set(re.findall(r"[a-z0-9-]+", "\n".join(line.split("#")[0] for line in lines)))
    unreviewed = sorted(words & set(UNREVIEWED_PLUGS))
    if unreviewed:
        raise ValueError(f"The snap recipe names unreviewed plugs or modes: {unreviewed}")
    return len(RECIPE_LINES)


def validate_version(version):
    """snapd's version rule: up to 32 letters, digits and .+~- , starting and
    ending with a letter or digit."""
    if not re.fullmatch(r"[0-9A-Za-z](?:[0-9A-Za-z.+~-]{0,30}[0-9A-Za-z])?", version):
        raise ValueError(f"Not a valid snap version: {version}")
    return version


def _entries(root):
    """Every path below root, without following links."""
    for parent, directories, files in os.walk(root):
        for name in sorted(directories + files):
            yield Path(parent) / name


def _excluded(relative):
    return any(relative == path or relative.startswith(path + "/") for path in EXCLUDED)


def copy_payload(stage, payload):
    """Copy the staged tree's files and links into payload, without what the
    snap leaves out or the folders that would then be empty."""
    missing = [path for path in EXCLUDED
               if not (stage / path).exists() and not (stage / path).is_symlink()]
    if missing:
        raise ValueError(f"The staged tree no longer has {missing}; update EXCLUDED")
    payload.mkdir()
    count = 0
    for path in _entries(stage):
        relative = path.relative_to(stage).as_posix()
        mode = path.lstat().st_mode
        if _excluded(relative) or stat.S_ISDIR(mode):
            continue
        if not (stat.S_ISREG(mode) or stat.S_ISLNK(mode)):
            raise ValueError(f"Unsupported payload object: /{relative}")
        target = payload / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if stat.S_ISLNK(mode):
            target.symlink_to(os.readlink(path))
        else:
            shutil.copy2(path, target)
        count += 1
    for parent, directories, _ in os.walk(payload):
        for name in directories:
            Path(parent, name).chmod(0o755)
    return count


def _text(node):
    return " ".join("".join(node.itertext()).split())


def description(metainfo):
    """The store's summary and description, from the packages' AppStream
    metainfo: the snap's typing note added, and store updates for update checks."""
    component = ET.parse(metainfo).getroot()
    summary = _text(component.find("summary"))
    blocks = []
    for node in component.find("description"):
        if node.tag == "p":
            blocks.append(_text(node))
        elif node.tag == "ul":
            items = [_text(item) for item in node.findall("li")]
            if UPDATE_ITEM not in items:
                raise ValueError("The metainfo's update item changed; update snap_package.UPDATE_ITEM")
            items[items.index(UPDATE_ITEM)] = STORE_UPDATES
            blocks.append("\n".join(f"- {item}" for item in items))
        else:
            raise ValueError(f"Unexpected element in the metainfo description: {node.tag}")
    blocks += [SNAP_TYPING, MODEL_LICENSE]
    if not summary or len(summary) > 78:
        raise ValueError("The store summary must be one line of at most 78 characters")
    return summary, "\n\n".join(blocks)


def render_recipe(version, summary, text):
    lines = text.splitlines()
    if any(line != line.strip() for line in lines if line):
        raise ValueError("Description lines can't carry surrounding white space")
    values = {"VERSION": validate_version(version), "SUMMARY": json.dumps(summary),
              "DESCRIPTION": "\n".join(f"  {line}" if line else "" for line in lines)}
    return re.sub(r"@(VERSION|SUMMARY|DESCRIPTION)@", lambda match: values[match[1]],
                  TEMPLATE.read_text())


def write_project(stage, project, version):
    """The snapcraft project: the recipe, the store icon, the wrappers and the payload."""
    project.mkdir()
    gui = project / "snap/gui"
    gui.mkdir(parents=True)
    summary, text = description(stage / METAINFO)
    (project / "snap/snapcraft.yaml").write_text(render_recipe(version, summary, text))
    shutil.copy2(stage / ICON, gui / "voco.png")
    wrappers = project / "wrappers"
    wrappers.mkdir()
    for name in sorted(set(WRAPPER_FILES.values())):
        shutil.copy2(WRAPPERS / name, wrappers / name)
        (wrappers / name).chmod(0o755)
    return copy_payload(stage, project / "payload")


def build_snap(stage, work, version):
    """Build the snap in an LXD instance, or on this computer when
    VOCO_SNAP_BUILD=destructive, which needs Ubuntu 24.04 and root."""
    work.mkdir()
    project = work / "project"
    write_project(stage, project, version)
    built = work / snap_name(version)
    mode = os.environ.get("VOCO_SNAP_BUILD", "lxd")
    if mode not in ("lxd", "destructive"):
        raise ValueError("VOCO_SNAP_BUILD must be lxd or destructive")
    command = ["snapcraft", "pack", "--use-lxd" if mode == "lxd" else "--destructive-mode",
               "--output", str(built)]
    # The build manifest records every stage package's version in the snap.
    subprocess.run(command, cwd=project, check=True, env={**os.environ, "SNAPCRAFT_BUILD_INFO": "1"})
    produced = sorted(path for path in work.iterdir() if path.suffix == ".snap")
    if produced != [built]:
        raise ValueError(f"snapcraft produced {produced}, not {built.name}")
    return built


def verify_metadata(snap, version):
    """meta/snap.yaml, parsed: strict, core24, amd64, one app with the reviewed
    plugs, one slot, and no other plug."""
    expected = {"name": "voco", "version": version, "base": "core24", "confinement": "strict",
                "grade": "stable", "architectures": [ARCH], "license": LICENSE}
    for key, value in expected.items():
        if snap.get(key) != value:
            raise ValueError(f"Unexpected snap {key}: {snap.get(key)!r} (expected {value!r})")
    apps = snap.get("apps", {})
    if set(apps) != {"voco"}:
        raise ValueError(f"The snap must have exactly the voco app: {sorted(apps)}")
    app = apps["voco"]
    if app.get("command") != "usr/bin/voco" or app.get("common-id") != "com.sergiopesch.voco":
        raise ValueError("The voco app must run usr/bin/voco as com.sergiopesch.voco")
    if sorted(app.get("plugs", [])) != sorted(VOCO_PLUGS + EXTENSION_APP_PLUGS):
        raise ValueError(f"Unexpected app plugs: {sorted(app.get('plugs', []))}")
    if app.get("slots") != ["panel"]:
        raise ValueError(f"The voco app must have only the panel slot: {app.get('slots')}")
    environment = app.get("environment", {})
    for name, value in (("VOCO_STREAM_PYTHON", f"$SNAP/{PRIVATE}/python3"),
                        ("VOCO_STREAM_WORKER", "$SNAP/usr/lib/voco/speech/stream_worker.py")):
        if environment.get(name) != value:
            raise ValueError(f"Unexpected {name}: {environment.get(name)!r}")
    plugs = snap.get("plugs", {})
    if set(plugs) != set(EXTENSION_CONTENT_PLUGS) | {"desktop"}:
        raise ValueError(f"Unexpected top-level plugs: {sorted(plugs)}")
    for name, provider in EXTENSION_CONTENT_PLUGS.items():
        plug = plugs[name]
        if plug.get("interface") != "content" or plug.get("default-provider") != provider:
            raise ValueError(f"Unexpected content plug {name}: {plug}")
    if snap.get("slots") != SLOTS:
        raise ValueError(f"Unexpected slots: {snap.get('slots')}")
    hooks = snap.get("hooks", {})
    if set(hooks) - {"configure"} or any(set(hook.get("plugs", [])) - {"desktop"}
                                         for hook in hooks.values()):
        raise ValueError(f"Unexpected hooks: {hooks}")
    return len(VOCO_PLUGS) + len(EXTENSION_APP_PLUGS) + len(plugs)


def _snap_only(relative):
    return any(relative == path or relative.startswith(path + "/") for path in SNAP_ONLY)


def verify_payload(deb_root, snap_root):
    """The snap carries the Debian package's files, mode for mode and byte for
    byte, except the excluded ones, and nothing else outside its own paths."""
    inventory = rpm_package.payload_inventory(snap_root)
    leaked = sorted(name for name in inventory if _excluded(name))
    if leaked:
        raise ValueError(f"The snap carries what it should leave out: {leaked[:10]}")
    deb = {name: entry for name, entry in rpm_package.payload_inventory(deb_root).items()
           if not _excluded(name)}
    snap = {name: entry for name, entry in inventory.items() if not _snap_only(name)}
    if deb != snap:
        differing = sorted(name for name in deb.keys() | snap.keys() if deb.get(name) != snap.get(name))
        raise ValueError(f"The snap and Debian payloads differ: {differing[:10]}")
    return len(snap)


def verify_private(snap_root):
    """The wrappers are the reviewed ones, the helpers' names lead to them, and
    the worker's Python finds its standard library and NumPy inside the snap."""
    for relative, name in WRAPPER_FILES.items():
        path = snap_root / relative
        if path.is_symlink() or path.read_bytes() != (WRAPPERS / name).read_bytes():
            raise ValueError(f"/{relative} differs from packaging/snap/wrappers/{name}")
        if stat.S_IMODE(path.stat().st_mode) != 0o755:
            raise ValueError(f"/{relative} must be 0755")
    for name in HELPER_NAMES:
        link = snap_root / "usr/bin" / name
        if not link.is_symlink() or os.readlink(link) != "../lib/voco/snap/run-helper":
            raise ValueError(f"/usr/bin/{name} must link to the helper wrapper")
        if not (snap_root / HELPERS / "usr/bin" / name).is_file():
            raise ValueError(f"The snap is missing Ubuntu's {name}")
    required = ("usr/bin/python3.12", "usr/lib/python3.12/os.py",
                "usr/lib/python3/dist-packages/numpy/__init__.py",
                "usr/lib/x86_64-linux-gnu/blas/libblas.so.3",
                "usr/lib/x86_64-linux-gnu/lapack/liblapack.so.3",
                "usr/lib/x86_64-linux-gnu/libsentencepiece.so.0")
    missing = [path for path in required if not (snap_root / PYTHON / path).exists()]
    if missing:
        raise ValueError(f"The worker's Python is incomplete: {missing}")
    # Nothing staged from Ubuntu shadows the GNOME platform's libraries.
    shared = [path for path in ("lib", "usr/lib/x86_64-linux-gnu") if (snap_root / path).exists()]
    if shared:
        raise ValueError(f"The snap has libraries on the app's search path: {shared}")


def _elf_needs(path):
    output = subprocess.run(["readelf", "-dW", str(path)], check=True, capture_output=True,
                            text=True).stdout
    needed = re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", output)
    paths = re.findall(r"\((?:RPATH|RUNPATH)\)\s+Library (?:rpath|runpath): \[([^\]]+)\]", output)
    return needed, [entry for value in paths for entry in value.split(":") if entry]


def _is_elf(path):
    with path.open("rb") as stream:
        return stream.read(4) == b"\x7fELF"


def verify_libraries(snap_root, base_root):
    """Every library the worker's Python, the helpers and the speech runtime
    need is in their own folders, on their RUNPATH, or in the core24 base."""
    searches = {
        PYTHON: [f"{PYTHON}/usr/lib/x86_64-linux-gnu/blas", f"{PYTHON}/usr/lib/x86_64-linux-gnu/lapack",
                 f"{PYTHON}/usr/lib/x86_64-linux-gnu"],
        HELPERS: [f"{HELPERS}/usr/lib/x86_64-linux-gnu"],
        # The worker loads the runtime, so the worker's Python folders apply.
        "usr/lib/voco/speech": [f"{PYTHON}/usr/lib/x86_64-linux-gnu"],
    }
    base = [base_root / "usr/lib/x86_64-linux-gnu", base_root / "lib/x86_64-linux-gnu"]
    checked = 0
    for tree, folders in searches.items():
        for path in _entries(snap_root / tree):
            if path.is_symlink() or not path.is_file() or not _is_elf(path):
                continue
            needed, runpath = _elf_needs(path)
            directories = [snap_root / folder for folder in folders] + base + [
                Path(entry.replace("$ORIGIN", str(path.parent))) for entry in runpath]
            for library in needed:
                if not any((directory / library).exists() for directory in directories):
                    raise ValueError(f"{path.relative_to(snap_root)} needs {library}, "
                                     "which is neither in the snap's folders nor in core24")
            checked += 1
    return checked


if __name__ == "__main__":
    action, *arguments = sys.argv[1:]
    if action == "verify-snap" and len(arguments) == 4:
        snap_yaml, version, snap_root, deb_root = arguments
        import yaml
        metadata = yaml.safe_load(Path(snap_yaml).read_text())
        plugs = verify_metadata(metadata, version)
        verify_private(Path(snap_root))
        files = verify_payload(Path(deb_root), Path(snap_root))
        print(f"{plugs} reviewed plugs, one slot and {files} files and links identical to the "
              "Debian package's.")
    elif action == "verify-libraries" and len(arguments) == 2:
        print(f"{verify_libraries(Path(arguments[0]), Path(arguments[1]))} ELF files find every "
              "library they need inside the snap or core24.")
    else:
        raise SystemExit("usage: snap_package.py verify-snap SNAP_YAML VERSION SNAP_ROOT DEB_ROOT | "
                         "verify-libraries SNAP_ROOT CORE24_ROOT")
