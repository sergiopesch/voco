"""Offline integrity, privacy and no-overwrite contracts for model provisioning."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "provision_model", Path(__file__).with_name("provision-nvidia-model.py"))
provisioner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provisioner)


class ModelProvisionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.output = self.root / "models" / provisioner.FILENAME
        self.content = b"pinned model fixture"
        self.identity = {
            "source": provisioner.SOURCE,
            "revision": "e" * 40,
            "model_sha256": hashlib.sha256(self.content).hexdigest(),
        }
        self.identity_file = self.root / "identity.json"
        self.identity_file.write_text(json.dumps(self.identity))
        for name, value in (("IDENTITY_PATH", self.identity_file), ("MODEL_BYTES", len(self.content))):
            mocked = patch.object(provisioner, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.curl = patch.object(provisioner.subprocess, "run")
        self.run = self.curl.start()
        self.addCleanup(self.curl.stop)

    def download(self, command, **kwargs):
        target = Path(command[command.index("--output") + 1])
        self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        target.write_bytes(self.content)

    def assert_clean_failure(self, exception):
        with self.assertRaises(exception):
            provisioner.provision(self.output)
        self.assertFalse(self.output.exists())
        if self.output.parent.exists():
            self.assertEqual(list(self.output.parent.iterdir()), [])

    def test_download_is_pinned_private_and_verified(self):
        self.run.side_effect = self.download
        result = provisioner.provision(self.output)
        self.assertEqual(result["status"], "downloaded")
        self.assertEqual(self.output.read_bytes(), self.content)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])
        command = self.run.call_args.args[0]
        self.assertEqual(command[:2], ["curl", "--disable"])
        self.assertEqual(command[-1], f"{provisioner.SOURCE}/resolve/{'e' * 40}/{provisioner.FILENAME}")
        for option, value in (("--proto", "=https"), ("--proto-redir", "=https"),
                              ("--max-filesize", str(len(self.content))),
                              ("--retry", "3"), ("--retry-max-time", "900"),
                              ("--max-time", "900"), ("--connect-timeout", "30")):
            self.assertEqual(command[command.index(option) + 1], value)
        self.assertTrue(self.run.call_args.kwargs["check"])
        self.assertEqual(self.run.call_args.kwargs["timeout"], 960)

    def test_existing_verified_file_needs_no_download(self):
        self.output.parent.mkdir()
        self.output.write_bytes(self.content)
        inode = self.output.stat().st_ino
        self.assertEqual(provisioner.provision(self.output)["status"], "reused")
        self.assertEqual(self.output.stat().st_ino, inode)
        self.run.assert_not_called()

    def test_existing_corruption_is_preserved_and_rejected(self):
        self.output.parent.mkdir()
        corrupt = b"x" * len(self.content)
        self.output.write_bytes(corrupt)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            provisioner.provision(self.output)
        self.assertEqual(self.output.read_bytes(), corrupt)
        self.run.assert_not_called()

    def test_existing_symlinks_are_rejected_even_when_target_valid_or_absent(self):
        self.output.parent.mkdir()
        target = self.root / "target"
        for present in (False, True):
            if present:
                target.write_bytes(self.content)
            self.output.symlink_to(target)
            with self.assertRaises(OSError):
                provisioner.provision(self.output)
            self.assertTrue(self.output.is_symlink())
            self.output.unlink()
        self.run.assert_not_called()

    def test_existing_fifo_is_rejected_without_blocking(self):
        self.output.parent.mkdir()
        os.mkfifo(self.output)
        with self.assertRaisesRegex(ValueError, "regular"):
            provisioner.provision(self.output)
        self.run.assert_not_called()

    def test_network_failure_leaves_no_output_or_staging(self):
        self.run.side_effect = subprocess.CalledProcessError(22, "curl")
        self.assert_clean_failure(subprocess.CalledProcessError)

    def test_timeout_leaves_no_output_or_staging(self):
        self.run.side_effect = subprocess.TimeoutExpired("curl", 960)
        self.assert_clean_failure(subprocess.TimeoutExpired)

    def test_short_and_oversized_downloads_are_rejected(self):
        for content in (b"short", self.content + b"long"):
            with self.subTest(size=len(content)):
                def download(command, **kwargs):
                    Path(command[command.index("--output") + 1]).write_bytes(content)
                self.run.side_effect = download
                self.assert_clean_failure(ValueError)

    def test_same_size_digest_mismatch_is_rejected(self):
        def download(command, **kwargs):
            Path(command[command.index("--output") + 1]).write_bytes(b"x" * len(self.content))
        self.run.side_effect = download
        self.assert_clean_failure(ValueError)

    def test_concurrent_destination_creation_is_never_overwritten(self):
        def download(command, **kwargs):
            self.download(command, **kwargs)
            self.output.write_bytes(b"concurrent output")
        self.run.side_effect = download
        with self.assertRaises(FileExistsError):
            provisioner.provision(self.output)
        self.assertEqual(self.output.read_bytes(), b"concurrent output")
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])

    def test_unpinned_or_wrong_source_identity_is_rejected_before_download(self):
        for key, value in (("source", "http://huggingface.co/nvidia/other"),
                           ("source", provisioner.SOURCE + "@evil.example"),
                           ("revision", "main"), ("model_sha256", "invalid")):
            with self.subTest(key=key, value=value):
                identity = {**self.identity, key: value}
                self.identity_file.write_text(json.dumps(identity))
                self.assert_clean_failure(ValueError)
        self.run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
