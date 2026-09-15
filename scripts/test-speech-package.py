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
        source = self.root / "source"
        for name in ("runtime/NATIVE-SOURCE.json", "runtime/speech/nemo_bridge.cpp",
                     "runtime/speech/cpu_check.c", "runtime/speech/MODEL-IDENTITY.json"):
            copied = source / name
            copied.parent.mkdir(parents=True, exist_ok=True)
            copied.write_bytes((validator.SOURCE_ROOT / name).read_bytes())
        source_patch = patch.object(validator, "SOURCE_ROOT", source)
        source_patch.start()
        self.addCleanup(source_patch.stop)
        self.speech = self.root / "usr/lib/voco/speech"
        (self.speech / "models").mkdir(parents=True)
        for name in ("stream_worker.py", "worker_main.py", "streaming.py", "adapters.py",
                     "libbench_nemo_pool.so", "voco-cpu-check",
                     "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"):
            (self.speech / name).write_bytes(b"fixture")
        (self.speech / "voco-cpu-check").chmod(0o755)
        source_model_identity = source / "runtime/speech/MODEL-IDENTITY.json"
        model_identity = json.loads(source_model_identity.read_text())
        model_identity["model_sha256"] = package.digest(
            self.speech / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf")
        source_model_identity.write_text(json.dumps(model_identity))
        (self.speech / "MODEL-IDENTITY.json").write_bytes(source_model_identity.read_bytes())
        (self.speech / "lib").mkdir()
        for name in validator.NATIVE_FILES:
            (self.speech / name).write_bytes(b"native fixture")
        for name, target in validator.NATIVE_LINKS.items():
            (self.speech / name).symlink_to(target)
        self.build_identity = {
            "schema": 1,
            "source": json.loads((validator.SOURCE_ROOT / "runtime/NATIVE-SOURCE.json").read_text()),
            "bridge_sha256": package.digest(validator.SOURCE_ROOT / "runtime/speech/nemo_bridge.cpp"),
            "cpu_check_sha256": package.digest(validator.SOURCE_ROOT / "runtime/speech/cpu_check.c"),
            "files": {name: package.digest(self.speech / name) for name in validator.COMPILED_FILES},
            "symlinks": validator.NATIVE_LINKS,
        }
        self.save_build_identity()
        self.save_manifest()

    def save_build_identity(self):
        (self.speech / "BUILD-IDENTITY.json").write_text(json.dumps(self.build_identity))

    def save_manifest(self):
        (self.speech / "MANIFEST.json").write_text(json.dumps(
            {"version": "2026.0.34+rc1", **package.payload_inventory(self.speech)}))

    def verify(self):
        return validator.verify(self.root, "2026.0.34+rc1")

    def test_complete_payload(self):
        self.assertEqual(self.verify()["symlinks"], len(validator.NATIVE_LINKS))
        self.assertEqual(set(package.SPEECH_FILES), validator.REQUIRED_FILES)

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
        (self.speech / "lib/libggml.so").unlink()
        (self.speech / "lib/libggml.so").symlink_to("absent.so")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.verify()
        with self.assertRaisesRegex(ValueError, "broken"):
            package.payload_inventory(self.speech)

    def test_escaped_link(self):
        (self.root / "outside").write_text("outside")
        (self.speech / "lib/libggml.so").unlink()
        (self.speech / "lib/libggml.so").symlink_to(self.root / "outside")
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

    def test_coherently_replaced_model_and_identity_still_fail_source_pin(self):
        model = self.speech / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"
        model.write_bytes(b"replacement model fixture")
        identity_path = self.speech / "MODEL-IDENTITY.json"
        identity = json.loads(identity_path.read_text())
        identity["model_sha256"] = package.digest(model)
        identity_path.write_text(json.dumps(identity))
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Model identity differs from the current source pin"):
            self.verify()

    def test_model_provenance_fields_must_match_source_even_with_same_weights(self):
        identity_path = self.speech / "MODEL-IDENTITY.json"
        identity = json.loads(identity_path.read_text())
        identity["revision"] = "0" * 40
        identity_path.write_text(json.dumps(identity))
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Model identity differs from the current source pin"):
            self.verify()

    def test_missing_guard_or_build_identity_even_with_new_manifest(self):
        for name in ("voco-cpu-check", "BUILD-IDENTITY.json"):
            with self.subTest(name=name):
                path = self.speech / name
                content = path.read_bytes()
                path.unlink()
                self.save_manifest()
                with self.assertRaisesRegex(ValueError, "Incomplete"):
                    self.verify()
                path.write_bytes(content)
                path.chmod(0o755 if name == "voco-cpu-check" else 0o644)

    def test_nonexecutable_guard_is_rejected(self):
        (self.speech / "voco-cpu-check").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "guard must be executable"):
            self.verify()

    def test_guard_and_receipt_symlinks_are_rejected(self):
        for name in ("voco-cpu-check", "BUILD-IDENTITY.json", "MANIFEST.json"):
            with self.subTest(name=name):
                path = self.speech / name
                saved = self.root / name
                path.rename(saved)
                path.symlink_to(saved)
                with self.assertRaises(ValueError):
                    self.verify()
                path.unlink()
                saved.rename(path)

    def test_extra_file_or_alias_even_with_new_manifest_is_rejected(self):
        for name in ("private.wav", "alias.so"):
            with self.subTest(name=name):
                path = self.speech / name
                if name.endswith(".so"):
                    path.symlink_to("libbench_nemo_pool.so")
                else:
                    path.write_text("private fixture")
                self.save_manifest()
                with self.assertRaisesRegex(ValueError, "unexpected"):
                    self.verify()
                path.unlink()

    def test_rehashed_native_bridge_or_guard_requires_matching_build_receipt(self):
        for name in validator.COMPILED_FILES:
            with self.subTest(name=name):
                path = self.speech / name
                original = path.read_bytes()
                path.write_bytes(b"changed binary fixture")
                self.save_manifest()
                with self.assertRaisesRegex(ValueError, "binary checksums"):
                    self.verify()
                path.write_bytes(original)

    def test_build_receipt_source_and_hash_tampering_is_rejected(self):
        changes = {"schema": 2, "source": {}, "bridge_sha256": "0" * 64,
                   "cpu_check_sha256": "0" * 64, "files": {}, "symlinks": {}}
        for key, replacement in changes.items():
            with self.subTest(key=key):
                original = self.build_identity[key]
                self.build_identity[key] = replacement
                self.save_build_identity()
                self.save_manifest()
                with self.assertRaises(ValueError):
                    self.verify()
                self.build_identity[key] = original

    def test_build_receipt_notices_need_not_be_packaged_under_speech(self):
        self.build_identity["files"]["notices/NATIVE-SOURCE.json"] = "a" * 64
        self.save_build_identity()
        self.save_manifest()
        self.verify()

    def test_unexpected_directory_or_special_file_is_rejected(self):
        extra = self.speech / "private"
        extra.mkdir()
        with self.assertRaisesRegex(ValueError, "directory"):
            self.verify()
        extra.rmdir()
        os.mkfifo(extra)
        with self.assertRaisesRegex(ValueError, "object"):
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


class PublicPayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.destination = self.root / "out"
        for name in ("docs/guide/README.md", "README.md", "AGENTS.md", "SECURITY.md",
                     "scripts/report-performance.py", "scripts/report-speech-performance.py"):
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("public fixture")
        self.manifest = self.source / "packaging/public-docs.json"
        self.manifest.parent.mkdir()
        self.manifest.write_text(json.dumps(["docs/guide/README.md"]))

    def test_archive_without_git_excludes_unlisted_private_documents(self):
        (self.source / "docs/private-recording.txt").write_text("private fixture")
        (self.source / "docs/guide/local-notes.json").write_text("private fixture")
        package.copy_public_documents(self.source, self.destination)
        self.assertEqual((self.destination / "docs/guide/README.md").read_text(), "public fixture")
        self.assertEqual({str(p.relative_to(self.destination / "docs"))
                          for p in (self.destination / "docs").rglob("*") if p.is_file()},
                         {"guide/README.md"})
        self.assertFalse((self.source / ".git").exists())

    def test_document_and_parent_symlinks_fail_before_any_copy(self):
        for linked in ("docs/guide/README.md", "docs/guide"):
            with self.subTest(linked=linked):
                path = self.source / linked
                saved = path.with_name(path.name + ".saved")
                path.rename(saved)
                path.symlink_to(saved, target_is_directory=saved.is_dir())
                with self.assertRaisesRegex(ValueError, "real directory|regular file"):
                    package.copy_public_documents(self.source, self.destination)
                self.assertFalse(self.destination.exists())
                path.unlink()
                saved.rename(path)

    def test_invalid_or_escaping_document_manifest_is_rejected(self):
        for names in (["../private.txt"], ["/tmp/private.txt"], ["docs/../private.txt"],
                      ["docs//guide/README.md"], ["docs/guide/README.md"] * 2,
                      ["runtime/private.txt"], [], {}, [None]):
            with self.subTest(names=names):
                self.manifest.write_text(json.dumps(names))
                with self.assertRaises(ValueError):
                    package.copy_public_documents(self.source, self.destination)
                self.assertFalse(self.destination.exists())

    def test_linked_manifest_is_rejected(self):
        saved = self.manifest.with_suffix(".saved")
        self.manifest.rename(saved)
        self.manifest.symlink_to(saved)
        with self.assertRaisesRegex(ValueError, "regular file"):
            package.copy_public_documents(self.source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_destination_symlink_does_not_overwrite_its_target(self):
        self.destination.mkdir()
        outside = self.root / "outside"
        outside.write_text("private fixture")
        (self.destination / "README.md").symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "destination must be a regular file"):
            package.copy_public_documents(self.source, self.destination)
        self.assertEqual(outside.read_text(), "private fixture")

    def stage_runtime(self):
        for name in package.SPEECH_FILES:
            path = self.source / "runtime/speech" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"runtime fixture")
        for name, target in package.SPEECH_LINKS.items():
            (self.source / "runtime/speech" / name).symlink_to(target)

    def test_runtime_copies_exact_inventory_and_excludes_private_extras(self):
        self.stage_runtime()
        for name in ("models/private.wav", "lib/private-notes.txt"):
            (self.source / "runtime/speech" / name).write_text("private fixture")
        package.copy_speech_payload(self.source, self.destination)
        inventory = package.payload_inventory(self.destination)
        self.assertEqual(set(inventory["files"]), set(package.SPEECH_FILES))
        self.assertEqual(inventory["symlinks"], package.SPEECH_LINKS)
        self.assertTrue(validator.NATIVE_FILES.issubset(package.SPEECH_FILES))
        self.assertEqual(package.SPEECH_LINKS, validator.NATIVE_LINKS)

    def test_runtime_rejects_replaced_model_and_wrong_loader_alias(self):
        self.stage_runtime()
        for name in ("models/nemotron-speech-streaming-en-0.6b.q8_0.gguf", "lib/libggml.so"):
            with self.subTest(name=name):
                path = self.source / "runtime/speech" / name
                saved = path.with_name(path.name + ".saved")
                path.rename(saved)
                path.symlink_to(saved)
                with self.assertRaises(ValueError):
                    package.copy_speech_payload(self.source, self.destination)
                self.assertFalse(self.destination.exists())
                path.unlink()
                saved.rename(path)

    def test_notices_copy_exact_bytes_without_local_extras(self):
        notices = self.source / "runtime/notices"
        notices.mkdir(parents=True)
        for name in package.NVIDIA_NOTICES:
            (notices / name).write_text("license fixture " + name)
        (notices / "private.txt").write_text("private fixture")
        package.copy_nvidia_notices(self.source, self.destination)
        copied = self.destination / "nvidia"
        self.assertEqual({path.name for path in copied.iterdir()}, set(package.NVIDIA_NOTICES))
        for name in package.NVIDIA_NOTICES:
            self.assertEqual((copied / name).read_bytes(), (notices / name).read_bytes())

    def test_linked_notice_is_rejected_before_any_copy(self):
        notices = self.source / "runtime/notices"
        notices.mkdir(parents=True)
        for name in package.NVIDIA_NOTICES:
            (notices / name).write_text("license fixture")
        notice = notices / package.NVIDIA_NOTICES[0]
        notice.unlink()
        notice.symlink_to(package.NVIDIA_NOTICES[1])
        with self.assertRaisesRegex(ValueError, "regular file"):
            package.copy_nvidia_notices(self.source, self.destination)
        self.assertFalse(self.destination.exists())


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
