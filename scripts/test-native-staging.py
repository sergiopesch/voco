import importlib.util
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_staging', Path(__file__).with_name('stage-native-packages.py'))
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'payload'
        self.root.mkdir()
        self.file = self.root / 'data'
        self.file.write_bytes(b'payload')
        self.file.chmod(0o644)

    def test_exact_bytes_and_modes_are_recorded(self):
        rows = staging.inventory(self.root)
        self.assertEqual(rows, [{'path':'/data', 'kind':'file', 'mode':0o644,
                                'sha256':staging.digest(self.file)}])

    def test_relative_loader_links_are_retained(self):
        (self.root / 'alias').symlink_to('data')
        rows = staging.inventory(self.root)
        self.assertEqual(rows[0]['kind'], 'symlink')
        self.assertEqual(rows[0]['target'], 'data')

    def test_absolute_broken_and_escaping_links_are_rejected(self):
        for target in ('missing', '../outside', str(self.file)):
            with self.subTest(target=target):
                link = self.root / 'alias'
                link.symlink_to(target)
                with self.assertRaisesRegex(ValueError, 'Unsafe package link'):
                    staging.inventory(self.root)
                link.unlink()

    def test_world_write_and_set_id_are_rejected(self):
        for mode in (0o646, 0o4755, 0o2755):
            self.file.chmod(mode)
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'Unsafe package permissions'):
                staging.inventory(self.root)

    def test_group_mode_is_preserved_for_pre_normalization_reference(self):
        self.file.chmod(0o664)
        self.assertEqual(staging.inventory(self.root)[0]['mode'], 0o664)

    def test_spec_and_shell_metacharacters_are_not_accepted_as_paths(self):
        for name in ('bad%macro', 'bad\nline', '$(unexpected)'):
            path = self.root / name
            path.write_text('fixture')
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsupported package pathname'):
                staging.inventory(self.root)
            path.unlink()


class DependencyTests(unittest.TestCase):
    def test_current_dependencies_have_explicit_mappings(self):
        staging.validate_debian_dependencies('python3, python3-numpy, at-spi2-core, ibus, '
                                             'libc6 (>= 2.39), libstdc++6 (>= 13.2.0)')

    def test_unknown_empty_alternative_and_versioned_dependencies_fail_closed(self):
        for value in ('', 'python3, new-runtime', 'python3 (>= 3.14)', 'python3 | pypy'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'requires review'):
                staging.validate_debian_dependencies(value)

    def test_missing_lower_or_stronger_runtime_floors_require_mapping_review(self):
        for value in ('libc6, libstdc++6', 'libc6 (>= 2.39)',
                      'libc6 (>= 2.38), libstdc++6 (>= 13.2.0)',
                      'libc6 (>= 2.40), libstdc++6 (>= 13.2.0)',
                      'libc6 (>= 2.39), libstdc++6 (>= 13.1.0)',
                      'libc6 (>= 2.39), libstdc++6 (>= 14)'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'requires review'):
                staging.validate_debian_dependencies(value)

    def test_generated_native_recipes_retain_reviewed_runtime_floors(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            control = root / 'payload/DEBIAN/control'
            control.parent.mkdir(parents=True)
            control.write_text('Package: voco\nVersion: 2026.0.39+local1\nArchitecture: amd64\n'
                               'Maintainer: Test <test@example.invalid>\nDescription: fixture\n'
                               'Depends: python3, libc6 (>= 2.39), libstdc++6 (>= 13.2.0)\n')
            data = root / 'payload/usr/share/voco/data'
            data.parent.mkdir(parents=True)
            data.write_text('package fixture')
            deb = root / 'fixture.deb'
            subprocess.run(['dpkg-deb', '--build', str(root / 'payload'), str(deb)],
                           check=True, capture_output=True)
            verifier = root / 'verifier.sh'
            verifier.write_text('# Fixture verifier; only recipe generation is tested here.\nexit 0\n')
            output = root / 'recipes'
            with patch.object(sys, 'argv', ['stage-native-packages.py', str(deb), str(output),
                                           '--sha256', staging.digest(deb), '--verifier', str(verifier)]):
                staging.main()
            rpm = (output / 'voco.spec').read_text()
            arch = (output / 'PKGBUILD').read_text()
            self.assertIn('Requires: glibc >= 2.39, libstdc++ >= 13.2.0, python3,', rpm)
            self.assertIn("depends=('glibc>=2.39' 'gcc-libs>=13.2.0' 'python'", arch)


if __name__ == '__main__':
    unittest.main()
