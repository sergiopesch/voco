"""Exercise the actual watcher identity predicate without launching a desktop."""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).with_name('test-native-kde.py')
node = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'validate_watcher_identity')
space = {}
exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), space)
validate = space['validate_watcher_identity']

class Tests(unittest.TestCase):
    def row(self):
        return {'uniqueName': ':1.15', 'pid': 418, 'uid': 1000, 'exe': '/tmp/kde-deps/bin/kded5', 'exeSha256': 'pinned-hash', 'pidNamespace': 'private-pid'}
    def check(self, watcher, kded=None):
        validate(kded or self.row(), watcher, '/tmp/kde-deps/bin/kded5', 'pinned-hash', 1000, 'private-pid')
    def test_verified_activated_owner_does_not_require_unrelated_popen_pid(self):
        self.check(self.row())
    def test_fake_binary_or_modified_bytes_rejected(self):
        for key, value in [('exe', '/tmp/fake-watcher'), ('exeSha256', 'different')]:
            row = self.row(); row[key] = value
            with self.assertRaises(AssertionError): self.check(row)
    def test_different_owner_pid_or_name_rejected(self):
        for key, value in [('uniqueName', ':1.16'), ('pid', 419), ('pid', True)]:
            row = self.row(); row[key] = value
            with self.assertRaises(AssertionError): self.check(row)
    def test_outside_namespace_or_user_rejected(self):
        for key, value in [('uid', 1001), ('pidNamespace', 'host-pid')]:
            row = self.row(); row[key] = value
            with self.assertRaises(AssertionError): self.check(row)

if __name__ == '__main__': unittest.main()
