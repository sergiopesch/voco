"""Package acceptance must reject corrupt files, missing models and escaped links."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
from unittest.mock import patch
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


package = load("package_nvidia", "package-nvidia.py")
validator = load("verify_speech", "verify-speech-payload.py")


class SpeechPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.speech = self.root / "usr/lib/voco/speech"
        (self.speech / "models").mkdir(parents=True)
        for name in ("stream_worker.py", "worker_main.py", "streaming.py", "adapters.py",
                     "libbench_nemo_pool.so", "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"):
            (self.speech / name).write_bytes(b"fixture")
        (self.speech / "MODEL-IDENTITY.json").write_text(json.dumps({"model_sha256":
            package.digest(self.speech / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf")}))
        (self.speech / "alias.so").symlink_to("libbench_nemo_pool.so")
        (self.speech / "lib").mkdir()
        for name in validator.NATIVE_FILES:
            (self.speech / name).write_bytes(b"native fixture")
        for name, target in validator.NATIVE_LINKS.items():
            (self.speech / name).symlink_to(target)
        self.save_manifest()

    def save_manifest(self):
        (self.speech / "MANIFEST.json").write_text(json.dumps(
            {"version": "2026.0.34+rc1", **package.payload_inventory(self.speech)}))

    def verify(self):
        return validator.verify(self.root, "2026.0.34+rc1")

    def test_complete_payload(self):
        self.assertEqual(self.verify()["symlinks"], 1 + len(validator.NATIVE_LINKS))

    def test_missing_native_payload_even_with_new_manifest(self):
        (self.speech / "lib/libnemo_speech_asr.so").unlink()
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            self.verify()

    def test_missing_loader_alias_even_with_new_manifest(self):
        (self.speech / "lib/libggml.so").unlink()
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "link closure"):
            self.verify()

    def test_corrupt_worker(self):
        (self.speech / "worker_main.py").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.verify()

    def test_missing_model(self):
        (self.speech / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf").unlink()
        with self.assertRaisesRegex(ValueError, "inventory"):
            self.verify()

    def test_extra_file(self):
        (self.speech / "extra.py").write_text("unexpected")
        with self.assertRaisesRegex(ValueError, "manifest"):
            self.verify()

    def test_broken_link(self):
        (self.speech / "alias.so").unlink()
        (self.speech / "alias.so").symlink_to("absent.so")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.verify()
        with self.assertRaisesRegex(ValueError, "broken"):
            package.payload_inventory(self.speech)

    def test_escaped_link(self):
        (self.root / "outside").write_text("outside")
        (self.speech / "alias.so").unlink()
        (self.speech / "alias.so").symlink_to(self.root / "outside")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.verify()
        with self.assertRaisesRegex(ValueError, "escapes"):
            package.payload_inventory(self.speech)

    def test_version_mismatch(self):
        with self.assertRaisesRegex(ValueError, "version"):
            validator.verify(self.root, "2026.0.34")

    def test_model_identity_mismatch(self):
        (self.speech / "MODEL-IDENTITY.json").write_text('{"model_sha256":"incorrect"}')
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Model identity"):
            self.verify()


class VendoredNoticeTests(unittest.TestCase):
    def test_ships_exact_notice_bytes_and_preserves_document_link_layout(self):
        with tempfile.TemporaryDirectory() as temporary:
            doc = Path(temporary) / "usr/share/doc/voco"
            package.copy_vendored_notices(package.ROOT, doc)
            for crate, names in package.VENDORED_NOTICES.items():
                copied = doc / "vendor" / crate
                self.assertEqual({path.name for path in copied.iterdir()}, set(names))
                for name in names:
                    self.assertEqual((copied / name).read_bytes(),
                                     (package.ROOT / "vendor" / crate / name).read_bytes())
                nested = doc / "docs/security"
                nested.mkdir(parents=True, exist_ok=True)
                self.assertEqual((nested / "../../vendor" / crate / "VOCO-PATCH.md").resolve(),
                                 (copied / "VOCO-PATCH.md").resolve())
                self.assertFalse((copied / "src").exists())
            provenance = json.loads((doc / "vendor/glib/VOCO-UPSTREAM.json").read_text())
            self.assertEqual(provenance["version"], "0.18.5")
            self.assertEqual(provenance["fix_commit"], "b5a4071e439bef2b5eea76c3aa25e5ae84839e34")

    def test_missing_or_linked_notice_fails_before_any_notice_copy(self):
        for crate, names in package.VENDORED_NOTICES.items():
            for replacement in ("missing", "symlink"):
                with self.subTest(crate=crate, replacement=replacement), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    for dependency, files in package.VENDORED_NOTICES.items():
                        source = root / "vendor" / dependency
                        source.mkdir(parents=True)
                        for name in files:
                            (source / name).write_text("notice fixture")
                    target = root / "vendor" / crate / names[0]
                    target.unlink()
                    if replacement == "symlink":
                        target.symlink_to(names[1])
                    doc = root / "out"
                    with self.assertRaisesRegex(ValueError, "regular vendored notice"):
                        package.copy_vendored_notices(root, doc)
                    self.assertFalse(doc.exists())


class PayloadModeTests(unittest.TestCase):
    def test_modes_are_independent_of_checkout_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "payload"
            root.mkdir(mode=0o777)
            child = root / "nested"
            child.mkdir(mode=0o700)
            data, executable = child / "model", child / "worker"
            data.write_bytes(b"model fixture")
            executable.write_bytes(b"worker fixture")
            data.chmod(0o666)
            executable.chmod(0o6777)
            package.normalize_payload_modes(root)
            self.assertEqual(root.stat().st_mode & 0o7777, 0o755)
            self.assertEqual(child.stat().st_mode & 0o7777, 0o755)
            self.assertEqual(data.stat().st_mode & 0o7777, 0o644)
            self.assertEqual(executable.stat().st_mode & 0o7777, 0o755)
            self.assertEqual(data.read_bytes(), b"model fixture")
            self.assertEqual(executable.read_bytes(), b"worker fixture")

    def test_file_and_directory_symlinks_are_not_followed(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root, outside = base / "payload", base / "outside"
            root.mkdir(); outside.mkdir()
            file = outside / "data"
            file.write_bytes(b"outside")
            file.chmod(0o666); outside.chmod(0o777)
            (root / "dir-link").symlink_to(outside, target_is_directory=True)
            (root / "file-link").symlink_to(file)
            package.normalize_payload_modes(root)
            self.assertEqual(file.stat().st_mode & 0o777, 0o666)
            self.assertEqual(outside.stat().st_mode & 0o777, 0o777)
            self.assertEqual((root / "file-link").readlink(), file)
            self.assertEqual((root / "dir-link").readlink(), outside)

    def test_symlink_root_is_rejected_without_changing_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            target = base / "target"; target.mkdir(); target.chmod(0o777)
            link = base / "link"; link.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "regular directory"):
                package.normalize_payload_modes(link)
            self.assertEqual(target.stat().st_mode & 0o777, 0o777)

    def test_special_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            os.mkfifo(root / "pipe")
            with self.assertRaisesRegex(ValueError, "Unsupported payload object"):
                package.normalize_payload_modes(root)


class BasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "base"
        for name in ("usr/bin/voco", "usr/libexec/voco-browser-host"):
            path = self.stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture executable")
            path.chmod(0o755)

    def test_wrapper_executables_are_required(self):
        package.validate_base_executables(self.stage)

    def test_missing_app_or_browser_host(self):
        for name in ("usr/bin/voco", "usr/libexec/voco-browser-host"):
            with self.subTest(name=name):
                path = self.stage / name
                path.rename(path.with_suffix(".saved"))
                with self.assertRaisesRegex(ValueError, "run npm run build"):
                    package.validate_base_executables(self.stage)
                path.with_suffix(".saved").rename(path)

    def test_nonexecutable_and_symlink_are_rejected(self):
        host = self.stage / "usr/libexec/voco-browser-host"
        host.chmod(0o644)
        with self.assertRaises(ValueError):
            package.validate_base_executables(self.stage)
        host.unlink()
        host.symlink_to("../bin/voco")
        with self.assertRaises(ValueError):
            package.validate_base_executables(self.stage)

    def test_actual_incomplete_deb_fails_before_runtime_copy_or_publication(self):
        (self.stage / "usr/libexec/voco-browser-host").unlink()
        control = self.stage / "DEBIAN/control"
        control.parent.mkdir()
        control.write_text("Package: voco\nVersion: 2026.0.37\nArchitecture: amd64\n"
                           "Maintainer: Test <test@example.invalid>\nDescription: test fixture\n")
        base = self.root / "base.deb"
        subprocess.run(["dpkg-deb", "--build", str(self.stage), str(base)],
                       check=True, capture_output=True)
        (self.root / "package.json").write_text('{"version":"2026.0.37"}')
        output = self.root / "candidate.deb"
        with patch.object(package, "ROOT", self.root), patch.object(sys, "argv", [
            "package-nvidia.py", str(base), str(output),
        ]), patch.object(package.shutil, "copy2") as copy:
            with self.assertRaisesRegex(ValueError, "browser-host"):
                package.main()
            copy.assert_not_called()
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
