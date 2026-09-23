import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

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
    def test_rpm_licenses_survive_nodocs_policy(self):
        for path in ['/usr/share/doc/voco/nvidia/NVIDIA-OPEN-MODEL-LICENSE.html',
                     '/usr/share/doc/voco/vendor/glib/COPYRIGHT',
                     '/usr/share/doc/voco/vendor/global-hotkey/LICENSE-MIT',
                     '/usr/share/doc/voco/vendor/ydotool-legacy/notices/gcc-runtime-copyright',
                     '/usr/share/doc/voco/vendor/ydotool-legacy/notices/GPL-3',
                     '/usr/share/doc/voco/vendor/ydotool-legacy/notices/ydotool-LICENSE']:
            self.assertEqual(staging.rpm_file_entry(path), '%license ' + path)
        path = '/usr/share/doc/voco/README.md'
        self.assertEqual(staging.rpm_file_entry(path), path)

    def test_private_daemon_directories_are_owned_for_removal(self):
        self.assertIn('/usr/libexec/voco', staging.OWNED_ROOTS)
        self.assertNotIn('/usr/libexec', staging.OWNED_ROOTS)

    def test_rpm_profiles_preserve_native_names_and_abi_floors(self):
        fedora = staging.rpm_dependencies('fedora')
        suse = staging.rpm_dependencies('opensuse')
        self.assertIn('pulseaudio-libs', fedora)
        self.assertIn('libpulse0', suse)
        self.assertIn('libnotify-tools', suse)
        self.assertIn('procps', suse)
        self.assertIn('procps-ng', staging.rpm_dependencies('fedora'))
        self.assertIn('libnotify', staging.rpm_dependencies('fedora'))
        self.assertIn('sentencepiece-libs', fedora)
        self.assertNotIn('sentencepiece-libs', suse)
        self.assertIn('libsentencepiece0', suse)
        self.assertIn('libstdc++ >= 13.2.0', fedora)
        self.assertIn('libstdc++6 >= 13.2.0', suse)
        for profile in (fedora, suse):
            self.assertIn('glibc >= 2.39', profile)
            self.assertIn('python3-numpy', profile)
            self.assertEqual(len(profile), len(set(profile)))

    def test_unknown_rpm_distribution_fails_closed(self):
        with self.assertRaises(ValueError):
            staging.rpm_dependencies('unknown')

    def test_current_dependencies_have_explicit_mappings(self):
        config = json.loads((Path(__file__).resolve().parents[1] /
            'apps/desktop/src-tauri/tauri.conf.json').read_text())
        staging.validate_debian_dependencies(', '.join(config['bundle']['linux']['deb']['depends']))

    def test_unknown_empty_alternative_and_versioned_dependencies_fail_closed(self):
        for value in ('', 'python3, new-runtime', 'python3 (>= 3.14)', 'python3 | pypy'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'requires review'):
                staging.validate_debian_dependencies(value)


class VersionTests(unittest.TestCase):
    def test_final_release_and_package_revision(self):
        self.assertEqual(staging.package_version('2026.0.42'), ('2026.0.42', '1', False))
        self.assertEqual(staging.package_version('2026.0.42', '2'), ('2026.0.42', '2', False))

    def test_local_candidate_is_preserved(self):
        self.assertEqual(staging.package_version('2026.0.40+local5'), ('2026.0.40', '5', True))

    def test_invalid_versions_and_revision_overrides_fail(self):
        for version, revision in [('2026.0.42;bad', None), ('2026.0.42+local0', None),
                                  ('2026.0.42', '0'), ('2026.0.42', '1;bad'),
                                  ('2026.0.42+local5', '2')]:
            with self.subTest(version=version, revision=revision), self.assertRaises(ValueError):
                staging.package_version(version, revision)

    def test_reviewed_abi_floors_and_new_helpers(self):
        staging.validate_debian_dependencies('libc6 (>= 2.39), libstdc++6 (>= 13.2.0), xdotool, wl-clipboard, procps')
        with self.assertRaises(ValueError):
            staging.validate_debian_dependencies('libc6 (>= 2.44)')


if __name__ == '__main__':
    unittest.main()
