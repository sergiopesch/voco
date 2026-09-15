import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('privacy', Path(__file__).with_name('check-release-privacy.py'))
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class ReleasePrivacyTests(unittest.TestCase):
    def test_binary_paths_are_rejected_without_printing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'binary').write_bytes(b'\0' + b'/home/' + b'private-person/project/source.cpp\0')
            result = privacy.inspect(root)
            self.assertEqual(result['findings'], [{'file': 'binary', 'categories': ['personal-home-path']}])
            self.assertNotIn('private-person', str(result))

    def test_neutral_build_paths_and_license_urls_are_allowed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'binary').write_bytes(b'/usr/src/voco/native/file.cpp\0')
            (root / 'notice').write_text('https://investor.nvidia.com/home/default.aspx')
            self.assertEqual(privacy.inspect(root)['findings'], [])

    def test_empty_files_and_symlinks_are_safe_to_inspect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'empty').touch()
            (root / 'link').symlink_to('empty')
            self.assertEqual(privacy.inspect(root), {'checked_files': 1, 'findings': []})


if __name__ == '__main__':
    unittest.main()
