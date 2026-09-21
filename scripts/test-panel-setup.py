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
        self.assertEqual(panel.classify('46.0', True, {}, False, False)['canEnable'], True)

    def test_saved_activation_is_not_claimed_as_active_until_shell_loads_it(self):
        self.assertEqual(panel.classify('46.0', True, {}, True, False)['status'], 'restart')
        self.assertEqual(panel.classify('46.0', True, {'state': 1}, True, False)['status'], 'active')

    def test_missing_package_and_shell_errors_do_not_offer_false_activation(self):
        for installed, state, expected in [(False, 1, 'missing'), (True, 3, 'error'), (True, 4, 'error')]:
            result = panel.classify('46.0', installed, {'state': state}, False, False)
            self.assertEqual(result['status'], expected)
            self.assertFalse(result['canEnable'])

    def test_global_policy_and_unsupported_shell_are_preserved(self):
        self.assertEqual(panel.classify('46.0', True, {'state': 1}, True, True)['status'], 'blocked')
        for version in ['45.9', '47.0', '50.0']:
            self.assertEqual(panel.classify(version, True, {}, False, False)['status'], 'unsupported')

    def test_debian_maps_every_runtime_extension_file(self):
        import json
        config = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text())
        files = config['bundle']['linux']['deb']['files']
        for name in ['extension.js', 'metadata.json', 'model.js', 'stylesheet.css', 'voco-symbol.png']:
            target = f'/usr/share/gnome-shell/extensions/{panel.UUID}/{name}'
            self.assertEqual((ROOT / 'apps/desktop/src-tauri' / files[target]).resolve(),
                             ROOT / 'integrations/gnome' / panel.UUID / name)


if __name__ == '__main__':
    unittest.main()
