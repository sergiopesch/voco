"""The code, the identity files and the shipped notice must name the same pins."""
import json
from pathlib import Path
import unittest
import adapters
import worker_main

ROOT = Path(__file__).resolve().parent


class ModelIdentityTests(unittest.TestCase):
    def test_integrity_gate_and_notice_name_the_pinned_model(self):
        identity = json.loads((ROOT / 'MODEL-IDENTITY.json').read_text())
        self.assertEqual(adapters.MODEL_SHA256, identity['model_sha256'])
        notice = (ROOT.parent / 'notices/NVIDIA-NOTICE.txt').read_text().splitlines()
        self.assertIn('Pinned revision: ' + identity['revision'], notice)
        self.assertIn('GGUF SHA-256: ' + identity['model_sha256'], notice)

    def test_worker_ready_names_the_pinned_native_revision(self):
        native = json.loads((ROOT / 'NATIVE-BUILD.json').read_text())
        self.assertEqual(worker_main.RUNTIME_REVISION.split('+')[0], native['revision'][:7])


if __name__ == '__main__':
    unittest.main()
