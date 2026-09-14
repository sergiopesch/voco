#!/usr/bin/env python3
"""Exercise the verifier's real CLI with optimized Python and mutated sources."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("verify.py")


class SourceVerifierTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        entries = []
        for name in ("whisper-rs", "whisper-rs-sys"):
            path = self.root / name / "src.rs"
            path.parent.mkdir()
            path.write_bytes(b"pinned source\n")
            path.chmod(0o644)
            entries.append({"path": f"{name}/src.rs", "bytes": path.stat().st_size,
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                            "executable": False})
        self.manifest = {"schemaVersion": 1, "roots": ["whisper-rs", "whisper-rs-sys"],
                         "files": entries}
        self.save_manifest()

    def save_manifest(self):
        (self.root / "OWNED-FILES.json").write_text(json.dumps(self.manifest))

    def run_cli(self, expected):
        result = subprocess.run([sys.executable, str(SCRIPT), "--vendor-root", str(self.root)],
                                env={**os.environ, "PYTHONOPTIMIZE": "1"},
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        if expected:
            self.assertIn("verification failed:", result.stderr)
            self.assertEqual(result.stdout, "")
        return result

    def test_exact_inventory_passes(self):
        self.assertEqual(json.loads(self.run_cli(0).stdout)["files"], 2)

    def test_modified_content_fails_under_optimized_python(self):
        (self.root / "whisper-rs/src.rs").write_bytes(b"altered source")
        self.run_cli(1)

    def test_missing_file_fails(self):
        (self.root / "whisper-rs/src.rs").unlink()
        self.run_cli(1)

    def test_extra_file_fails(self):
        (self.root / "whisper-rs/extra.rs").write_bytes(b"extra")
        self.run_cli(1)

    def test_permission_change_fails(self):
        (self.root / "whisper-rs/src.rs").chmod(0o755)
        self.run_cli(1)

    def test_symlink_to_identical_source_fails(self):
        path = self.root / "whisper-rs/src.rs"
        path.unlink()
        path.symlink_to(self.root / "whisper-rs-sys/src.rs")
        self.run_cli(1)

    def test_fifo_fails_without_blocking(self):
        os.mkfifo(self.root / "whisper-rs/fifo")
        self.run_cli(1)

    def test_inventory_fifo_fails_without_blocking(self):
        inventory = self.root / "OWNED-FILES.json"
        inventory.unlink()
        os.mkfifo(inventory)
        self.run_cli(1)

    def test_boolean_schema_fails(self):
        self.manifest["schemaVersion"] = True
        self.save_manifest()
        self.run_cli(1)

    def test_duplicate_inventory_path_fails(self):
        self.manifest["files"].append(self.manifest["files"][0])
        self.save_manifest()
        self.run_cli(1)

    def test_path_traversal_fails(self):
        self.manifest["files"][0]["path"] = "whisper-rs/../outside.rs"
        self.save_manifest()
        self.run_cli(1)

    def test_empty_inventory_fails(self):
        self.manifest["files"] = []
        self.save_manifest()
        self.run_cli(1)

    def test_invalid_json_fails_cleanly(self):
        (self.root / "OWNED-FILES.json").write_text("{")
        self.run_cli(1)


if __name__ == "__main__":
    unittest.main()
