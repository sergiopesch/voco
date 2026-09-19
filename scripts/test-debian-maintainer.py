"""Regression coverage for the narrowly scoped legacy directory-mode repair."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import debian_maintainer as maintainer


class DirectoryMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.payload = self.root / 'usr/lib/voco/speech'
        self.payload.mkdir(parents=True)
        self.payload.chmod(0o775)
        self.hook = self.root / 'postinst.py'
        self.hook.write_text(maintainer.render_postinst(self.root))
        spec = importlib.util.spec_from_file_location('postinst', self.hook)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        original = os.fstat
        # The test tree belongs to the test runner; model root ownership without
        # needing elevated permissions. Other checks run against real descriptors.
        def root_owned(fd):
            fields = list(original(fd)); fields[4] = fields[5] = 0
            return os.stat_result(fields)
        self.addCleanup(patch.stopall)
        patch.object(self.module.os, 'fstat', side_effect=root_owned).start()

    def repair(self, overrides=frozenset()):
        with self.module.root_directory(str(self.root)) as fd:
            self.module.repair_directories(fd, self.module.DIRECTORIES, overrides)

    def test_upgrade_and_reconfigure_preserve_unlisted_paths_and_files(self):
        unrelated = self.payload / 'local-admin-directory'
        unrelated.mkdir(); unrelated.chmod(0o775)
        user_file = self.payload / 'local-file'
        user_file.write_text('preserve'); user_file.chmod(0o664)
        self.repair(); self.repair()
        self.assertEqual(self.payload.stat().st_mode & 0o7777, 0o755)
        self.assertEqual(unrelated.stat().st_mode & 0o7777, 0o775)
        self.assertEqual(user_file.stat().st_mode & 0o7777, 0o664)
        self.assertEqual(user_file.read_text(), 'preserve')

    def test_admin_modes_and_dpkg_statoverrides_are_preserved(self):
        self.repair({'/usr/lib/voco/speech'})
        self.assertEqual(self.payload.stat().st_mode & 0o7777, 0o775)
        self.payload.chmod(0o750)
        self.repair()
        self.assertEqual(self.payload.stat().st_mode & 0o7777, 0o750)

    def test_missing_filtered_docs_are_allowed(self):
        self.module.DIRECTORIES += ('/usr/share/doc/voco',)
        self.repair()

    def test_symlink_leaf_and_ancestor_are_never_followed(self):
        outside = self.root / 'outside'; outside.mkdir(); outside.chmod(0o775)
        self.payload.rmdir(); self.payload.symlink_to(outside)
        with self.assertRaises(OSError):
            self.repair()
        self.assertEqual(outside.stat().st_mode & 0o7777, 0o775)
        self.payload.unlink(); self.payload.parent.rmdir()
        self.payload.parent.symlink_to(outside)
        with self.assertRaises(OSError):
            self.repair()
        self.assertEqual(outside.stat().st_mode & 0o7777, 0o775)

    def test_nonroot_owned_directory_is_rejected(self):
        original = os.stat(self.payload)
        fields = list(original); fields[4] = 12345
        with patch.object(self.module.os, 'fstat', return_value=os.stat_result(fields)):
            with self.assertRaisesRegex(ValueError, 'root-owned'):
                self.repair()
        self.assertEqual(self.payload.stat().st_mode & 0o7777, 0o775)

    def test_verifier_rejects_changed_hook_and_extra_maintainer_action(self):
        control = self.root / 'DEBIAN'; control.mkdir()
        hook = control / 'postinst'; hook.write_bytes(self.hook.read_bytes()); hook.chmod(0o755)
        maintainer.verify_control(control, self.root)
        hook.write_text(hook.read_text() + '\n# unreviewed\n')
        with self.assertRaisesRegex(ValueError, 'postinst'):
            maintainer.verify_control(control, self.root)
        hook.write_bytes(self.hook.read_bytes())
        (control / 'preinst').write_text('#!/bin/sh\n')
        with self.assertRaisesRegex(ValueError, 'maintainer'):
            maintainer.verify_control(control, self.root)


if __name__ == '__main__':
    unittest.main()
