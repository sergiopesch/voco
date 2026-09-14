"""Package acceptance must reject corrupt files, missing models and escaped links."""
import importlib.util
import json
from pathlib import Path
import tempfile
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


if __name__ == "__main__":
    unittest.main()
