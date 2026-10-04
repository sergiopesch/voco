"""Panel setup must distinguish installation, activation and session restart."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('panel_setup', ROOT / 'apps/desktop/src-tauri/resources/voco_gnome_panel.py')
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)


class PanelSetupTests(unittest.TestCase):
    def test_supported_fresh_install_can_be_enabled(self):
        for version in ['46.0', '48.7', '50.1', '50.5']:
            self.assertEqual(panel.classify(version, True, {}, False, False)['canEnable'], True, version)

    def test_supported_majors_match_the_companion_metadata(self):
        import json
        metadata = json.loads((ROOT / 'integrations/gnome' / panel.UUID / 'metadata.json').read_text())
        self.assertEqual(tuple(metadata['shell-version']), panel.SUPPORTED_SHELLS)

    def test_saved_activation_is_not_claimed_as_active_until_shell_loads_it(self):
        self.assertEqual(panel.classify('46.0', True, {}, True, False)['status'], 'restart')
        self.assertEqual(panel.classify('46.0', True, {'state': 1, 'version': panel.COMPANION_VERSION}, True, False)['status'], 'active')

    def test_loaded_old_or_unknown_companion_requires_session_restart(self):
        for version in [None, panel.COMPANION_VERSION - 1, panel.COMPANION_VERSION + 1, str(panel.COMPANION_VERSION)]:
            status = panel.classify('46.0', True, {'state': 1, 'version': version}, True, False)
            self.assertEqual(status['status'], 'restart')
            self.assertFalse(status['canEnable'])
        import json
        metadata = json.loads((ROOT / 'integrations/gnome' / panel.UUID / 'metadata.json').read_text())
        self.assertEqual(metadata['version'], panel.COMPANION_VERSION)

    def test_missing_package_and_shell_errors_do_not_offer_false_activation(self):
        for installed, state, expected in [(False, 1, 'missing'), (True, 3, 'error'), (True, 4, 'error')]:
            result = panel.classify('46.0', installed, {'state': state}, False, False)
            self.assertEqual(result['status'], expected)
            self.assertFalse(result['canEnable'])

    def test_global_policy_and_unsupported_shell_are_preserved(self):
        self.assertEqual(panel.classify('46.0', True, {'state': 1}, True, True)['status'], 'blocked')
        for version in ['45.9', '47.0', '49.2', '51.0']:
            status = panel.classify(version, True, {}, False, False)
            self.assertEqual(status['status'], 'unsupported')
            self.assertFalse(status['canEnable'])
            self.assertIn('Dictation still works', status['detail'])
            self.assertIn('configure it in your desktop to run voco --toggle', status['detail'])

    def test_debian_maps_every_runtime_extension_file(self):
        import json
        import subprocess
        source = f'integrations/gnome/{panel.UUID}/'
        tracked = subprocess.check_output(['git', 'ls-files', '-z', '--', source], cwd=ROOT).decode()
        self.assertEqual(sorted(name.removeprefix(source) for name in tracked.split('\0') if name), sorted(panel.FILES))
        config = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text())
        files = config['bundle']['linux']['deb']['files']
        installed = f'/usr/share/gnome-shell/extensions/{panel.UUID}/'
        self.assertEqual(sorted(target.removeprefix(installed) for target in files if target.startswith(installed)),
                         sorted(panel.FILES))
        for name in panel.FILES:
            self.assertEqual((ROOT / 'apps/desktop/src-tauri' / files[installed + name]).resolve(),
                             ROOT / 'integrations/gnome' / panel.UUID / name)


if __name__ == '__main__':
    unittest.main()
