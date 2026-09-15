"""Native builder boundaries; optional pinned-source reconstruction without compiling."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('build-nvidia-runtime.py')
spec = importlib.util.spec_from_file_location('native_builder', SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class NativeBuilderTests(unittest.TestCase):
    def test_patches_match_committed_identity(self):
        identity = json.loads(builder.PIN.read_text())
        self.assertEqual(len(identity['patched_files']), 4)
        for item in identity['patches']:
            self.assertEqual(builder.digest(builder.ROOT / 'runtime' / item['path']),
                             item['sha256'])

    def test_existing_and_dangling_destinations_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'existing'):
                builder.fresh(root)
            link = root / 'dangling'
            link.symlink_to('absent')
            with self.assertRaisesRegex(ValueError, 'existing'):
                builder.fresh(link)

    def test_invalid_jobs_fails_without_creating_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory) / 'work'
            output = Path(directory) / 'output'
            result = subprocess.run([sys.executable, str(SCRIPT), '--jobs', '0',
                                     '--work-dir', str(work), '--output', str(output)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('--jobs must', result.stderr)
            self.assertFalse(work.exists())
            self.assertFalse(output.exists())

    def test_staged_link_closure_and_regular_libraries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'build/bin').mkdir(parents=True)
            for name in builder.REAL_LIBRARIES:
                (root / 'build/bin' / name).write_bytes(b'fixture')
            builder.stage_libraries(root / 'build', root / 'payload')
            for name, target in builder.LINKS.items():
                link = root / 'payload/lib' / name
                self.assertEqual(os.readlink(link), target)
                self.assertTrue(link.resolve().is_relative_to(root / 'payload'))
                self.assertEqual(link.read_bytes(), b'fixture')

    def test_private_path_rejected_even_with_safe_runpath(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'libbench_nemo_pool.so').write_bytes(b'assert /home/private/source.cpp')
            with patch.object(builder, 'output', return_value='RUNPATH [$ORIGIN/lib]'):
                with self.assertRaisesRegex(ValueError, 'Private build path'):
                    builder.audit_libraries(root, root / 'work')

    def test_neutral_mapping_is_not_mistaken_for_src_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            (stage / 'lib').mkdir()
            binaries = [stage / 'libbench_nemo_pool.so',
                        *[stage / 'lib' / name for name in builder.REAL_LIBRARIES]]
            for binary in binaries:
                binary.write_bytes(b'assert /usr/src/voco/native/source/ggml.c')

            def dynamic(*args):
                return ('RUNPATH [$ORIGIN/lib]' if args[-1].parent == stage
                        else 'RUNPATH [$ORIGIN:$ORIGIN/../lib]')

            with patch.object(builder, 'ROOT', Path('/src')):
                with patch.object(builder, 'output', side_effect=dynamic):
                    builder.audit_libraries(stage, Path('/work/native-build'))

    def test_patch_tampering_rejected_before_git_apply(self):
        identity = json.loads(builder.PIN.read_text())
        identity['patches'][0]['sha256'] = '0' * 64
        with patch.object(builder, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Patch checksum mismatch'):
                builder.apply_patches(Path('/unused'), identity)
            run.assert_not_called()

    @unittest.skipUnless(os.environ.get('VOCO_NEMO_SOURCE'), 'Set VOCO_NEMO_SOURCE for offline pinned-source proof')
    def test_pinned_patches_reconstruct_retained_runtime(self):
        identity = json.loads(builder.PIN.read_text())
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            builder.checkout(identity['upstream'], source, os.environ['VOCO_NEMO_SOURCE'])
            builder.apply_patches(source, identity)
            for name, expected in identity['patched_files'].items():
                self.assertEqual(builder.digest(source / name), expected)


if __name__ == '__main__':
    unittest.main()
