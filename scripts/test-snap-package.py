"""The snap carries the staged tree without what strict confinement can't use,
lists it in the store from the packages' metainfo, and passes its checks only
with the reviewed plugs, slot, wrappers and payload."""
import copy
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import snap_package as snap

ROOT = Path(__file__).resolve().parents[1]
METAINFO = ROOT / "packaging/tauri/com.sergiopesch.voco.metainfo.xml"


def write(root, name, content="", mode=0o644):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(mode)
    return path


def make_stage(root):
    """A small tree shaped like the staged package, with every excluded path."""
    for name in ("DEBIAN/control", *snap.EXCLUDED[1:]):
        if name in ("usr/lib/voco/ibus", "usr/share/voco/chromium",
                    "usr/share/gnome-shell/extensions/voco-panel@sergiopesch.com"):
            write(root, f"{name}/file", "excluded")
        else:
            write(root, name, "excluded")
    for name, content in {"usr/lib/voco/speech/MANIFEST.json": "{}",
                          "usr/lib/voco/speech/lib/libfixture.so.1.0": "native",
                          snap.DESKTOP: "[Desktop Entry]\nExec=voco\nIcon=voco\n",
                          "usr/share/doc/voco/copyright": "MIT",
                          snap.ICON: "png"}.items():
        write(root, name, content)
    write(root, snap.METAINFO, METAINFO.read_text())
    write(root, "usr/bin/voco", "binary", 0o755)
    (root / "usr/lib/voco/speech/lib/libfixture.so.1").symlink_to("libfixture.so.1.0")


def metadata(version="2026.0.64"):
    """snap.yaml as snapcraft writes it for the recipe, parsed."""
    return {
        "name": "voco", "version": version, "base": "core24", "confinement": "strict",
        "grade": "stable", "architectures": ["amd64"],
        "apps": {"voco": {
            "command": "usr/bin/voco", "common-id": "com.sergiopesch.voco",
            "command-chain": ["snap/command-chain/gpu-2404-wrapper", "snap/command-chain/desktop-launch"],
            "plugs": [*snap.VOCO_PLUGS, *snap.EXTENSION_APP_PLUGS], "slots": ["panel"],
            "environment": {"VOCO_STREAM_PYTHON": "$SNAP/usr/lib/voco/snap/python3",
                            "VOCO_STREAM_WORKER": "$SNAP/usr/lib/voco/speech/stream_worker.py"}}},
        "plugs": {"desktop": {"mount-host-font-cache": False},
                  **{name: {"interface": "content", "target": f"$SNAP/{name}", "default-provider": provider}
                     for name, provider in snap.EXTENSION_CONTENT_PLUGS.items()}},
        "slots": copy.deepcopy(snap.SLOTS),
        "hooks": {"configure": {"plugs": ["desktop"], "command-chain": ["snap/command-chain/hooks-configure-fonts"]}},
    }


def make_snap_root(root, deb_root):
    """What snapcraft primes: the Debian payload without the exclusions, the
    private programs, their wrappers and snapcraft's own paths."""
    for path in snap._entries(deb_root):
        relative = path.relative_to(deb_root).as_posix()
        if snap._excluded(relative) or path.is_dir():
            continue
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            target.symlink_to(os.readlink(path))
        else:
            shutil.copy2(path, target)
    for relative, name in snap.WRAPPER_FILES.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snap.WRAPPERS / name, target)
        target.chmod(0o755)
    for name in snap.HELPER_NAMES:
        write(root, f"{snap.HELPERS}/usr/bin/{name}", "helper", 0o755)
        (root / "usr/bin" / name).symlink_to("../lib/voco/snap/run-helper")
    for name in ("usr/bin/python3.12", "usr/lib/python3.12/os.py",
                 "usr/lib/python3/dist-packages/numpy/__init__.py",
                 "usr/lib/x86_64-linux-gnu/blas/libblas.so.3",
                 "usr/lib/x86_64-linux-gnu/lapack/liblapack.so.3",
                 "usr/lib/x86_64-linux-gnu/libsentencepiece.so.0"):
        write(root, f"{snap.PYTHON}/{name}", "python")
    write(root, "meta/snap.yaml", "name: voco")
    write(root, "meta/gui/voco.desktop", "[Desktop Entry]")
    write(root, "snap/command-chain/desktop-launch", "launch", 0o755)
    (root / "gnome-platform").mkdir()
    (root / "gpu-2404").mkdir()


class SnapPackageTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.stage = self.root / "stage"
        make_stage(self.stage)

    def tearDown(self):
        self.temporary.cleanup()

    def test_the_payload_leaves_out_what_confinement_cannot_use(self):
        payload = self.root / "payload"
        count = snap.copy_payload(self.stage, payload)
        self.assertEqual(count, 8)
        for name in snap.EXCLUDED:
            self.assertFalse((payload / name).exists(), name)
        # No folder survives that only held excluded files.
        for folder in ("etc", "usr/libexec", "usr/share/ibus", "usr/share/gnome-shell",
                       "usr/share/voco", "usr/lib/udev", "usr/lib/modules-load.d"):
            self.assertFalse((payload / folder).exists(), folder)
        self.assertEqual(os.readlink(payload / "usr/lib/voco/speech/lib/libfixture.so.1"),
                         "libfixture.so.1.0")
        self.assertEqual((payload / "usr/bin/voco").stat().st_mode & 0o777, 0o755)
        self.assertEqual((payload / snap.DESKTOP).read_text(), (self.stage / snap.DESKTOP).read_text())

    def test_an_exclusion_the_stage_no_longer_has_stops_the_build(self):
        shutil.rmtree(self.stage / "usr/share/voco/chromium")
        with self.assertRaisesRegex(ValueError, "update EXCLUDED"):
            snap.copy_payload(self.stage, self.root / "payload")

    def test_the_store_listing_comes_from_the_metainfo(self):
        summary, text = snap.description(METAINFO)
        self.assertEqual(summary, "The voice layer for Linux, starting with dictation")
        self.assertTrue(text.startswith("Dictation is the first step."))
        self.assertIn("- Local English speech recognition with NVIDIA Nemotron", text)
        self.assertIn(f"- {snap.STORE_UPDATES}", text)
        self.assertNotIn("GitHub Releases", text)
        self.assertTrue(text.endswith(snap.SNAP_TYPING))
        self.assertEqual(text.count("\n\n"), 3, "two paragraphs, the list and the snap's note")

    def test_a_changed_update_item_stops_the_build(self):
        changed = self.root / "metainfo.xml"
        changed.write_text(METAINFO.read_text().replace("Update checks against", "Checks against"))
        with self.assertRaisesRegex(ValueError, "update item changed"):
            snap.description(changed)

    def test_the_recipe_fills_every_placeholder(self):
        recipe = snap.render_recipe("2026.0.64", 'A "quoted" summary', "First line.\n\n- An item")
        self.assertIn("version: '2026.0.64'\n", recipe)
        self.assertIn('summary: "A \\"quoted\\" summary"\n', recipe)
        self.assertIn("description: |\n  First line.\n\n  - An item\n", recipe)
        self.assertNotRegex(recipe, r"@[A-Z]+@")
        for line in ("confinement: strict", "base: core24", "compression: lzo",
                     "    plugs: [audio-playback, audio-record, login-session-observe]"):
            self.assertIn(line + "\n", recipe)
        with self.assertRaisesRegex(ValueError, "white space"):
            snap.render_recipe("2026.0.64", "Summary", " indented")

    def test_the_recipe_declares_only_the_reviewed_confinement_plugs_and_slot(self):
        template = snap.TEMPLATE.read_text()
        self.assertEqual(snap.check_recipe(template), len(snap.RECIPE_LINES))
        changes = {
            "the network": ("plugs: [audio-playback, audio-record, login-session-observe]",
                            "plugs: [audio-playback, audio-record, login-session-observe, network]"),
            "devmode": ("confinement: strict", "confinement: devmode"),
            "another base": ("base: core24", "base: core22"),
            "no GNOME extension": ("    extensions: [gnome]\n", ""),
            "a top-level plug": ("slots:\n  panel:", "plugs:\n  home:\nslots:\n  panel:"),
            "the system bus": ("    bus: session", "    bus: system"),
            "a second slot": ("    slots: [panel]", "    slots: [panel, spare]"),
        }
        for name, (old, new) in changes.items():
            self.assertIn(old, template, name)
            with self.assertRaises(ValueError, msg=name):
                snap.check_recipe(template.replace(old, new, 1))

    def test_snap_versions_follow_snapd(self):
        for version in ("2026.0.64", "2026.0.64+local1", "1"):
            self.assertEqual(snap.validate_version(version), version)
        for version in ("", "-1", "2026.0.64+", "a'b", "1" * 33, "2026.0.64 local"):
            with self.assertRaises(ValueError, msg=version):
                snap.validate_version(version)

    def test_the_project_holds_the_recipe_icon_wrappers_and_payload(self):
        project = self.root / "project"
        snap.write_project(self.stage, project, "2026.0.64")
        recipe = (project / "snap/snapcraft.yaml").read_text()
        self.assertIn("version: '2026.0.64'", recipe)
        self.assertIn("  - " + snap.STORE_UPDATES, recipe)
        self.assertEqual((project / "snap/gui/voco.png").read_text(), "png")
        for name in ("python3", "run-helper"):
            wrapper = project / "wrappers" / name
            self.assertEqual(wrapper.read_bytes(), (snap.WRAPPERS / name).read_bytes())
            self.assertEqual(wrapper.stat().st_mode & 0o777, 0o755)
        self.assertTrue((project / "payload/usr/bin/voco").is_file())
        self.assertFalse((project / "payload/DEBIAN").exists())

    def test_the_build_asks_snapcraft_for_one_snap_with_its_manifest(self):
        work = self.root / "work"
        calls = []

        def run(command, cwd, check, env):
            calls.append((command, cwd, env))
            Path(command[command.index("--output") + 1]).write_text("snap")

        for mode, flag in ((None, "--use-lxd"), ("destructive", "--destructive-mode")):
            environment = {key: value for key, value in os.environ.items() if key != "VOCO_SNAP_BUILD"}
            if mode:
                environment["VOCO_SNAP_BUILD"] = mode
            shutil.rmtree(work, ignore_errors=True)
            with patch.dict(os.environ, environment, clear=True), patch.object(snap.subprocess, "run", run):
                built = snap.build_snap(self.stage, work, "2026.0.64")
            command, cwd, env = calls[-1]
            self.assertEqual(built, work / "voco_2026.0.64_amd64.snap")
            self.assertEqual(command[:3], ["snapcraft", "pack", flag])
            self.assertEqual(cwd, work / "project")
            self.assertEqual(env["SNAPCRAFT_BUILD_INFO"], "1")
        shutil.rmtree(work)
        with patch.dict(os.environ, {"VOCO_SNAP_BUILD": "multipass"}), \
                self.assertRaisesRegex(ValueError, "lxd or destructive"):
            snap.build_snap(self.stage, work, "2026.0.64")

    def test_only_the_reviewed_plugs_and_slot_pass(self):
        self.assertEqual(snap.verify_metadata(metadata(), "2026.0.64"), 15)
        changes = {
            "another version": lambda data: data.update(version="2026.0.63"),
            "devmode": lambda data: data.update(confinement="devmode"),
            "another base": lambda data: data.update(base="core22"),
            "a second app": lambda data: data["apps"].update(helper={"command": "usr/bin/voco"}),
            "the network": lambda data: data["apps"]["voco"]["plugs"].append("network"),
            "a missing plug": lambda data: data["apps"]["voco"]["plugs"].remove("audio-record"),
            "home everywhere": lambda data: data["plugs"].update(home={}),
            "another provider": lambda data: data["plugs"]["gnome-46-2404"].update({"default-provider": "evil"}),
            "another slot": lambda data: data["slots"].update(spare={"interface": "dbus"}),
            "another bus name": lambda data: data["slots"]["panel"].update(name="org.voco.Other"),
            "the system bus": lambda data: data["slots"]["panel"].update(bus="system"),
            "another worker": lambda data: data["apps"]["voco"]["environment"].update(
                VOCO_STREAM_PYTHON="/usr/bin/python3"),
            "a hook with plugs": lambda data: data["hooks"]["configure"].update(plugs=["desktop", "home"]),
        }
        for name, change in changes.items():
            data = metadata()
            change(data)
            with self.assertRaises(ValueError, msg=name):
                snap.verify_metadata(data, "2026.0.64")

    def test_the_payload_check_finds_any_difference(self):
        deb, root = self.root / "deb", self.root / "snap"
        shutil.copytree(self.stage, deb, symlinks=True)
        make_snap_root(root, deb)
        self.assertEqual(snap.verify_payload(deb, root), 8)
        snap.verify_private(root)
        (root / "usr/share/doc/voco/copyright").write_text("changed")
        with self.assertRaisesRegex(ValueError, "payloads differ"):
            snap.verify_payload(deb, root)
        (root / "usr/share/doc/voco/copyright").write_text("MIT")
        (root / "usr/bin/voco").chmod(0o700)
        with self.assertRaisesRegex(ValueError, "payloads differ"):
            snap.verify_payload(deb, root)
        (root / "usr/bin/voco").chmod(0o755)
        write(root, "usr/share/voco/stray", "stray")
        with self.assertRaisesRegex(ValueError, "payloads differ"):
            snap.verify_payload(deb, root)
        (root / "usr/share/voco/stray").unlink()
        write(root, "usr/lib/udev/rules.d/70-voco-uinput.rules", "excluded")
        with self.assertRaisesRegex(ValueError, "leave out"):
            snap.verify_payload(deb, root)

    def test_private_programs_stay_private_and_reviewed(self):
        deb, root = self.root / "deb", self.root / "snap"
        shutil.copytree(self.stage, deb, symlinks=True)
        make_snap_root(root, deb)
        snap.verify_private(root)
        checks = {
            "a changed wrapper": (lambda: (root / snap.PRIVATE / "python3").write_text("#!/bin/sh\n"),
                                  "differs"),
            "a helper outside the wrapper": (lambda: ((root / "usr/bin/xclip").unlink(),
                                                      write(root, "usr/bin/xclip", "", 0o755)),
                                             "must link"),
            "Python without its library": (lambda: (root / snap.PYTHON / "usr/lib/python3.12/os.py").unlink(),
                                           "incomplete"),
            "a shared library folder": (lambda: write(root, "usr/lib/x86_64-linux-gnu/libX11.so.6"),
                                        "search path"),
        }
        for name, (change, message) in checks.items():
            shutil.rmtree(root)
            make_snap_root(root, deb)
            change()
            with self.assertRaisesRegex(ValueError, message, msg=name):
                snap.verify_private(root)

    @unittest.skipUnless(sys.platform == "linux" and shutil.which("readelf"), "readelf and an ELF host")
    def test_every_private_library_resolves_inside_the_snap_or_core24(self):
        root, base = self.root / "snap", self.root / "core24"
        program = root / snap.HELPERS / "usr/bin/xclip"
        program.parent.mkdir(parents=True)
        shutil.copy("/usr/bin/true", program)
        needed = snap._elf_needs(program)[0]
        self.assertIn("libc.so.6", needed)
        with self.assertRaisesRegex(ValueError, "libc.so.6"):
            snap.verify_libraries(root, base)
        for library in needed:
            write(base, f"usr/lib/x86_64-linux-gnu/{library}", "library")
        self.assertEqual(snap.verify_libraries(root, base), 1)


if __name__ == "__main__":
    unittest.main()
