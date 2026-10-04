"""The Fedora package lists every staged path once, owns only reviewed folders
and runs only the reviewed scriptlet."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import rpm_package as rpm

CONTROL = """Package: voco
Version: 2026.0.60
Architecture: amd64
Maintainer: VOCO Contributors
Depends: libc6 (>= 2.39)
Description: Turn speech into text at your cursor with local dictation
 Your voice, typed. Speech stays on this computer at 100% local.
 .
 A second paragraph.
"""


def make_stage(root):
    """A small tree shaped like the staged package, with every reviewed folder."""
    files = {
        "DEBIAN/control": CONTROL,
        "etc/chromium/native-messaging-hosts/com.voco.exact_field.json": "{}",
        "etc/opt/chrome/native-messaging-hosts/com.voco.exact_field.json": "{}",
        "usr/lib/udev/rules.d/70-voco-uinput.rules": "rule",
        "usr/lib/modules-load.d/voco-uinput.conf": "uinput",
        "usr/lib/voco/ibus/voco_ibus_engine.py": "engine",
        "usr/lib/voco/speech/MANIFEST.json": "{}",
        "usr/lib/voco/speech/lib/libfixture.so.1.0": "native",
        "usr/share/applications/VOCO.desktop": "[Desktop Entry]",
        "usr/share/doc/voco/copyright": "MIT",
        "usr/share/doc/voco/THIRD-PARTY-NOTICES.txt": "notices",
        "usr/share/doc/voco/nvidia/LICENSE": "Apache",
        "usr/share/doc/voco/vendor/glib/LICENSE": "MIT",
        "usr/share/doc/voco/README.md": "readme",
        "usr/share/doc/voco/docs/install.md": "install",
        "usr/share/gnome-shell/extensions/voco-panel@voco.local/metadata.json": "{}",
        "usr/share/icons/hicolor/256x256@2/apps/voco.png": "png",
        "usr/share/ibus/component/voco.xml": "<component/>",
        "usr/share/metainfo/com.sergiopesch.voco.metainfo.xml": "<component/>",
        "usr/share/voco/chromium/manifest.json": "{}",
    }
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o644)
    for name in ("usr/bin/voco", "usr/bin/voco-browser-host", "usr/libexec/voco-browser-host",
                 "usr/libexec/voco-ibus-engine"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile("/usr/bin/true", path)
        path.chmod(0o755)
    (root / "usr/lib/voco/speech/lib/libfixture.so.1").symlink_to("libfixture.so.1.0")
    for parent, directories, _ in os.walk(root):
        for name in directories:
            (Path(parent) / name).chmod(0o755)


class FileListTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.stage = Path(self.temp.name) / "stage"
        make_stage(self.stage)

    def test_lists_owned_trees_shared_folders_and_loose_files_once(self):
        lines = rpm.file_list(self.stage)
        self.assertEqual(lines, sorted(lines, key=lambda line: line.split()[-1]))
        for tree in ("/usr/lib/voco", "/usr/share/voco",
                     "/usr/share/gnome-shell/extensions/voco-panel@voco.local"):
            self.assertIn(tree, lines)
        for directory in rpm.SHARED_DIRECTORIES:
            self.assertIn("%dir /" + directory, lines)
        self.assertIn("%dir /usr/share/doc/voco", lines)
        for entry in rpm.LICENSE_ENTRIES:
            self.assertIn(f"%license /usr/share/doc/voco/{entry}", lines)
        self.assertIn("%doc /usr/share/doc/voco/README.md", lines)
        self.assertIn("%doc /usr/share/doc/voco/docs", lines)
        self.assertIn("/usr/lib/udev/rules.d/70-voco-uinput.rules", lines)
        listed = [line.split()[-1] for line in lines]
        self.assertEqual(len(listed), len(set(listed)))
        # Nothing inside an owned tree is listed twice, no Debian control file
        # is packaged, and the system's folders are never claimed.
        self.assertFalse([path for path in listed if path.startswith("/usr/lib/voco/")])
        self.assertFalse([path for path in listed if path.startswith("/DEBIAN")])
        for directory in ("/usr", "/usr/bin", "/etc", "/usr/share/icons/hicolor"):
            self.assertNotIn(directory, listed)

    def test_an_unreviewed_folder_stops_the_build(self):
        (self.stage / "usr/share/unreviewed").mkdir()
        with self.assertRaisesRegex(ValueError, "Unreviewed folder"):
            rpm.file_list(self.stage)

    def test_paths_rpm_would_expand_are_refused(self):
        for name in ("with space.txt", "macro%{name}", "glob[1]", "star*"):
            with self.subTest(name=name):
                path = self.stage / "usr/share/applications" / name
                path.write_text("x")
                with self.assertRaisesRegex(ValueError, "cannot be listed"):
                    rpm.file_list(self.stage)
                path.unlink()

    def test_missing_license_or_owned_tree_stops_the_build(self):
        shutil.rmtree(self.stage / "usr/share/doc/voco/nvidia")
        with self.assertRaisesRegex(ValueError, "License notices are missing"):
            rpm.file_list(self.stage)
        shutil.rmtree(self.stage / "usr/share/voco")
        with self.assertRaisesRegex(ValueError, "missing VOCO's folder"):
            rpm.file_list(self.stage)

    def test_special_files_are_refused(self):
        os.mkfifo(self.stage / "usr/share/applications/pipe")
        with self.assertRaisesRegex(ValueError, "Unsupported payload object"):
            rpm.file_list(self.stage)


class SpecTests(unittest.TestCase):
    def test_description_comes_from_the_staged_control_file(self):
        with tempfile.TemporaryDirectory() as folder:
            control = Path(folder) / "control"
            control.write_text(CONTROL)
            summary, description = rpm.control_description(control)
        self.assertEqual(summary, "Turn speech into text at your cursor with local dictation")
        self.assertEqual(description.split("\n\n"), [
            "Your voice, typed. Speech stays on this computer at 100% local.", "A second paragraph."])

    def test_render_fills_every_placeholder_and_escapes_macros(self):
        with tempfile.TemporaryDirectory() as folder:
            stage = Path(folder)
            make_stage(stage)
            spec = rpm.render_spec(stage, "2026.0.60+local1", "Summary 100%", "Body 100%")
        self.assertNotRegex(spec, r"@[A-Z]+@")
        self.assertIn("Version:        2026.0.60+local1\n", spec)
        self.assertIn("Release:        1\n", spec)
        self.assertIn("Summary:        Summary 100%%\n", spec)
        self.assertIn("\nBody 100%%\n", spec)
        self.assertIn("%post\n" + rpm.POST_SCRIPT.read_text().rstrip("\n") + "\n\n%files\n", spec)
        for requirement in rpm.FEDORA_REQUIRES:
            self.assertRegex(spec, rf"\nRequires: +{requirement.replace('+', '[+]')}\n")
        self.assertNotRegex(spec, r"\n(Recommends|Suggests|Supplements|Enhances):")

    def test_reviewed_scriptlet_cannot_carry_macros(self):
        with tempfile.TemporaryDirectory() as folder:
            stage, post = Path(folder) / "stage", Path(folder) / "post.sh"
            make_stage(stage)
            post.write_text("echo %{_bindir}\n")
            with patch.object(rpm, "POST_SCRIPT", post):
                with self.assertRaisesRegex(ValueError, "macros"):
                    rpm.render_spec(stage, "2026.0.60", "s", "d")

    def test_versions_and_names(self):
        for version in ("2026.0.60", "2026.0.60+local1"):
            self.assertEqual(rpm.validate_version(version), version)
        for version in ("2026.0.60-1", "", "v2026", "2026.0.60 1"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                rpm.validate_version(version)
        self.assertEqual(rpm.package_name("2026.0.60"), "voco-2026.0.60-1.x86_64.rpm")


class HeaderPolicyTests(unittest.TestCase):
    def entries(self):
        entries = {"/" + directory: ("drwxr-xr-x", "root", "root", "")
                   for directory in rpm.SHARED_DIRECTORIES + rpm.OWNED_TREES}
        entries.update({
            "/usr/bin/voco": ("-rwxr-xr-x", "root", "root", ""),
            "/usr/share/doc/voco/copyright": ("-rw-r--r--", "root", "root", "dl"),
            "/usr/share/doc/voco/README.md": ("-rw-r--r--", "root", "root", "d"),
            "/usr/share/doc/voco/nvidia": ("drwxr-xr-x", "root", "root", ""),
            "/usr/share/doc/voco/nvidia/LICENSE": ("-rw-r--r--", "root", "root", "dl"),
            "/usr/lib/voco/speech": ("drwxr-xr-x", "root", "root", ""),
            "/usr/lib/voco/speech/lib.so": ("lrwxrwxrwx", "root", "root", ""),
        })
        return entries

    def check(self, entries):
        with patch.object(rpm, "header_files", return_value=entries):
            return rpm.verify_files(Path("fixture.rpm"))

    def test_reviewed_layout_passes(self):
        self.assertEqual(self.check(self.entries()), len(self.entries()))

    def test_policy_violations(self):
        cases = {
            "owns a folder it shares": {"/usr/bin": ("drwxr-xr-x", "root", "root", "")},
            "Not owned by root": {"/usr/bin/voco": ("-rwxr-xr-x", "sergio", "root", "")},
            "Unexpected mode": {"/usr/bin/voco": ("-rwxrwxr-x", "root", "root", "")},
            "unowned folder": {"/usr/share/other/file": ("-rw-r--r--", "root", "root", "")},
            "file flags": {"/usr/share/doc/voco/copyright": ("-rw-r--r--", "root", "root", "d")},
            "does not own": {"/etc/opt/chrome/native-messaging-hosts": None},
        }
        for message, change in cases.items():
            with self.subTest(message=message):
                entries = self.entries()
                for name, value in change.items():
                    if value is None:
                        entries.pop(name)
                    else:
                        entries[name] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.check(entries)


class DependencyParityTests(unittest.TestCase):
    DEPENDS = ("libpulse0, libnotify-bin, ibus, python3, gir1.2-ibus-1.0, python3-gi, xclip, "
               "python3-numpy, python3-psutil, procps, libsentencepiece0, xdotool, wl-clipboard, "
               "libc6 (>= 2.39), libstdc++6 (>= 13.2.0), libayatana-appindicator3-1, "
               "libwebkit2gtk-4.1-0, libgtk-3-0")

    def test_the_real_debian_dependencies_map_to_the_rpm_requirements(self):
        self.assertEqual(rpm.verify_same_dependencies(self.DEPENDS, set(rpm.FEDORA_REQUIRES)), 18)

    def test_a_new_or_dropped_dependency_is_named(self):
        with self.assertRaisesRegex(ValueError, "without a reviewed Fedora name.*libnew0"):
            rpm.verify_same_dependencies(self.DEPENDS + ", libnew0", set(rpm.FEDORA_REQUIRES))
        with self.assertRaisesRegex(ValueError, "lacks the Fedora names.*libstdc"):
            rpm.verify_same_dependencies(self.DEPENDS, set(rpm.FEDORA_REQUIRES) - {"libstdc++ >= 13.2"})

    def test_the_spec_requires_exactly_the_mapped_names(self):
        spec = rpm.TEMPLATE.read_text()
        self.assertEqual(tuple(line.split(None, 1)[1] for line in spec.splitlines()
                               if line.startswith("Requires:")), rpm.FEDORA_REQUIRES)


class PayloadParityTests(unittest.TestCase):
    def test_identical_trees_pass_and_any_difference_is_named(self):
        with tempfile.TemporaryDirectory() as folder:
            deb, rpm_root = Path(folder) / "deb", Path(folder) / "rpm"
            make_stage(deb)
            shutil.copytree(deb, rpm_root, symlinks=True)
            shutil.rmtree(rpm_root / "DEBIAN")
            self.assertGreater(rpm.verify_same_payload(deb, rpm_root), 10)
            (rpm_root / "usr/share/voco/chromium/manifest.json").write_text("changed")
            with self.assertRaisesRegex(ValueError, "manifest.json"):
                rpm.verify_same_payload(deb, rpm_root)


TOOLS = ("rpmbuild", "rpm", "rpm2cpio", "cpio", "readelf", "ldd")


def system_library():
    """The C library /usr/bin/true links, as a real ELF shared object."""
    linked = subprocess.run(["ldd", "/usr/bin/true"], check=True, capture_output=True, text=True).stdout
    return next(line.split("=>")[1].split()[0] for line in linked.splitlines() if "libc.so" in line)


@unittest.skipUnless(all(shutil.which(tool) for tool in TOOLS),
                     "rpmbuild, rpm, rpm2cpio, cpio, readelf or ldd is unavailable")
class RpmbuildTests(unittest.TestCase):
    def test_built_package_matches_the_reviewed_policy(self):
        with tempfile.TemporaryDirectory() as folder:
            stage = Path(folder) / "stage"
            make_stage(stage)
            # A real shared library stands in for the private speech runtime.
            library = (stage / "usr/lib/voco/speech/lib/libfixture.so.1.0")
            library.unlink()
            shutil.copyfile(system_library(), library)
            library.chmod(0o755)
            built = rpm.build_rpm(stage, Path(folder) / "work", "2026.0.60")
            self.assertEqual(built.name, "voco-2026.0.60-1.x86_64.rpm")
            self.assertTrue((stage / "DEBIAN/control").exists(), "The staged tree must survive rpmbuild")
            rpm.verify_scriptlets(built)
            rpm.verify_files(built)
            provides = subprocess.run(["rpm", "-qp", "--provides", str(built)], check=True,
                                      capture_output=True, text=True).stdout
            self.assertNotIn(".so", provides, "Private libraries must not be provided")
            provided = provides.splitlines()
            self.assertIn("voco = 2026.0.60-1", provided)
            self.assertIn("voco(x86-64) = 2026.0.60-1", provided)
            self.assertFalse([name for name in provided
                              if not name.startswith(("voco", "application(", "metainfo("))], provided)
            requires = subprocess.run(["rpm", "-qp", "--requires", str(built)], check=True,
                                      capture_output=True, text=True).stdout.splitlines()
            for requirement in rpm.FEDORA_REQUIRES:
                self.assertIn(requirement, requires)
            self.assertTrue([line for line in requires if line.startswith("libc.so.6(")],
                            "The app binaries keep their generated requirements")
            header = subprocess.run(["rpm", "-qp", "--qf", "%{BUILDHOST} %{PAYLOADCOMPRESSOR}",
                                     str(built)], check=True, capture_output=True, text=True).stdout
            self.assertEqual(header, "voco-release zstd")
            extracted = Path(folder) / "extracted"
            extracted.mkdir()
            payload = subprocess.run(["rpm2cpio", str(built)], check=True, capture_output=True).stdout
            subprocess.run(["cpio", "--quiet", "-idm", "--no-absolute-filenames"], cwd=extracted,
                           input=payload, check=True)
            self.assertGreater(rpm.verify_same_payload(stage, extracted), 10)

    def test_an_existing_work_folder_is_never_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "work").mkdir()
            with self.assertRaises(FileExistsError):
                rpm.build_rpm(Path(folder), Path(folder) / "work", "2026.0.60")


if __name__ == "__main__":
    unittest.main()
