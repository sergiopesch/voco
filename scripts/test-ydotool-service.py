#!/usr/bin/env python3
"""Private selection/migration fixtures; no real service, socket or input access."""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import stat
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader('launcher', str(ROOT / 'packaging/ydotool/voco-ydotool-launcher'))
spec = importlib.util.spec_from_loader(loader.name, loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)
verify_spec = importlib.util.spec_from_file_location('verify_legacy', ROOT / 'scripts/verify-legacy-input-package.py')
verify = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verify)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.client = self.root / 'ydotool'
        self.daemon = self.root / 'system-ydotoold'
        self.private = self.root / 'private'
        self.private.mkdir()
        self.client.write_bytes(b'qualified-client')
        self.daemon.write_bytes(b'system-daemon')
        (self.private / 'ydotoold').write_bytes(b'patched-daemon')
        self.identity = {'package': 'ydotool', 'version': '0.1.8-3build1', 'architecture': 'amd64',
                         'path': str(self.client), 'sha256': launcher.digest(self.client)}
        (self.private / 'qualified-client.json').write_text(json.dumps(self.identity))
        (self.private / 'MANIFEST.json').write_text(json.dumps({'binary_sha256': launcher.digest(self.private / 'ydotoold')}))
        self.addCleanup(patch.stopall)
        patch.object(launcher, 'CLIENT', self.client).start()
        patch.object(launcher, 'SYSTEM_DAEMON', self.daemon).start()
        patch.object(launcher, 'PRIVATE', self.private).start()
        # Production trust checks are covered separately; test-owned fixtures
        # model package contents without requiring privilege or touching /usr.
        patch.object(launcher, 'trusted_file', side_effect=lambda path, **_: path).start()
        self.query = patch.object(launcher.subprocess, 'run', side_effect=[
            subprocess.CompletedProcess([], 0, 'ydotool\t0.1.8-3build1\tamd64\tinstalled', ''),
            subprocess.CompletedProcess([], 0, 'ydotool: ' + str(self.client) + '\n', '')]).start()

    def test_exact_authenticated_client_selects_private_without_help_or_socket(self):
        self.assertEqual(launcher.select_daemon(), self.private / 'ydotoold')
        self.assertEqual(len(self.query.call_args_list), 2)
        for call in self.query.call_args_list:
            self.assertEqual(call.args[0][0], '/usr/bin/dpkg-query')
            self.assertNotIn('--help', call.args[0])

    def test_modern_or_changed_client_uses_distribution_daemon(self):
        self.client.write_bytes(b'modern-client')
        self.assertEqual(launcher.select_daemon(), self.daemon)
        self.query.assert_not_called()

    def test_wrong_version_architecture_status_or_owner_falls_back(self):
        for query, owner in (
            ('ydotool\t1.0.4\tamd64\tinstalled', 'ydotool: ' + str(self.client)),
            ('ydotool\t0.1.8-3build1\tarm64\tinstalled', 'ydotool: ' + str(self.client)),
            ('ydotool\t0.1.8-3build1\tamd64\tunpacked', 'ydotool: ' + str(self.client)),
            ('ydotool\t0.1.8-3build1\tamd64\tinstalled', 'other-package: ' + str(self.client))):
            with self.subTest(query=query, owner=owner):
                self.query.side_effect = [subprocess.CompletedProcess([], 0, query, ''),
                                          subprocess.CompletedProcess([], 0, owner, '')]
                self.assertEqual(launcher.select_daemon(), self.daemon)

    def test_package_query_failure_uses_distribution(self):
        self.query.side_effect = subprocess.TimeoutExpired('dpkg-query', 0.5)
        self.assertEqual(launcher.select_daemon(), self.daemon)

    def test_corrupt_private_binary_never_silently_uses_leaking_daemon(self):
        (self.private / 'ydotoold').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'build manifest'):
            launcher.select_daemon()

    def test_missing_private_payload_fails_closed(self):
        (self.private / 'MANIFEST.json').unlink()
        with self.assertRaises(FileNotFoundError):
            launcher.select_daemon()


class TrustTests(unittest.TestCase):
    def test_trust_rejects_links_writable_files_and_nonroot_ownership(self):
        path = Path('/usr/libexec/voco/ydotool-legacy/ydotoold')
        def info(item, uid=0, mode=0o755):
            return os.stat_result(((stat.S_IFREG if item == path else stat.S_IFDIR) | mode,
                                   1, 1, 1, uid, 0, 10, 0, 0, 0))
        for leaf_mode, uid in ((0o777, 0), (0o4755, 0), (0o755, 1000)):
            with self.subTest(mode=leaf_mode, uid=uid), patch.object(Path, 'lstat', autospec=True,
                    side_effect=lambda item: info(item, uid if item == path else 0, leaf_mode if item == path else 0o755)):
                with self.assertRaisesRegex(ValueError, 'Untrusted'):
                    launcher.trusted_file(path)
        with patch.object(Path, 'lstat', return_value=os.stat_result((stat.S_IFLNK | 0o777, 1, 1, 1, 0, 0, 0, 0, 0, 0))):
            with self.assertRaisesRegex(ValueError, 'Untrusted'):
                launcher.trusted_file(path)

    def test_service_digest_tracks_reviewed_vendor_unit(self):
        self.assertEqual(launcher.UNIT_SHA256,
                         hashlib.sha256((ROOT / 'packaging/systemd/voco-ydotoold.service').read_bytes()).hexdigest())


class PackageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.private = self.root / 'usr/libexec/voco/ydotool-legacy'
        self.private.mkdir(parents=True)
        self.notices = self.root / 'usr/share/doc/voco/vendor/ydotool-legacy'
        self.notices.mkdir(parents=True)
        self.binary = self.private / 'ydotoold'; self.binary.write_bytes(b'isolated ELF fixture'); self.binary.chmod(0o755)
        (self.notices / 'LICENSE').write_text('fixture license')
        for source, target in (('qualified-client.json', self.private / 'qualified-client.json'),
                               ('voco-ydotool-launcher', self.private.parent / 'ydotool-launcher')):
            shutil.copyfile(ROOT / 'packaging/ydotool' / source, target)
        (self.private.parent / 'ydotool-launcher').chmod(0o755)
        self.manifest = {'format_version': 1, 'binary_sha256': verify.digest(self.binary),
                         'binary_bytes': self.binary.stat().st_size,
                         'source_provenance': {'manifest_sha256': verify.digest(ROOT / 'vendor/ydotool-legacy/SOURCE.json')},
                         'build': {'script_sha256': verify.digest(ROOT / 'scripts/build-legacy-ydotool.py')},
                         'elf': {'needed': ['libc.so.6', 'libgcc_s.so.1', 'libstdc++.so.6']},
                         'notices': {'LICENSE': verify.digest(self.notices / 'LICENSE')}}
        self.save()
        for path in self.root.rglob('*'):
            path.chmod(0o755 if path.is_dir() or path in (self.binary, self.private.parent / 'ydotool-launcher') else 0o644)
        self.addCleanup(patch.stopall)
        patch.object(verify.subprocess, 'check_output', return_value='\n'.join(
            '(NEEDED) Shared library: [' + name + ']' for name in self.manifest['elf']['needed'])).start()

    def save(self):
        (self.private / 'MANIFEST.json').write_text(json.dumps(self.manifest))

    def test_complete_private_payload_verifies_without_execution(self):
        self.assertEqual(verify.verify(self.root)['binary_sha256'], verify.digest(self.binary))

    def test_corrupt_binary_wrong_provenance_and_changed_gate_rejected(self):
        original = self.binary.read_bytes(); self.binary.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'build manifest'): verify.verify(self.root)
        self.binary.write_bytes(original)
        self.manifest['source_provenance']['manifest_sha256'] = 'wrong'; self.save()
        with self.assertRaisesRegex(ValueError, 'provenance'): verify.verify(self.root)
        self.manifest['source_provenance']['manifest_sha256'] = verify.digest(ROOT / 'vendor/ydotool-legacy/SOURCE.json'); self.save()
        (self.private / 'qualified-client.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'selection'): verify.verify(self.root)

    def test_missing_changed_or_linked_notice_is_rejected(self):
        notice = self.notices / 'LICENSE'; original = notice.read_bytes()
        notice.write_text('changed')
        with self.assertRaisesRegex(ValueError, 'inventory'): verify.verify(self.root)
        notice.unlink()
        with self.assertRaisesRegex(ValueError, 'Missing'): verify.verify(self.root)
        notice.symlink_to(self.binary)
        with self.assertRaisesRegex(ValueError, 'type/mode'): verify.verify(self.root)
        notice.unlink(); notice.write_bytes(original); notice.chmod(0o664)
        with self.assertRaisesRegex(ValueError, 'type/mode'): verify.verify(self.root)

    def test_special_objects_and_distribution_replacement_are_rejected(self):
        extra = self.private / 'unexpected'; os.mkfifo(extra)
        with self.assertRaisesRegex(ValueError, 'inventory'): verify.verify(self.root)
        extra.unlink()
        system = self.root / 'usr/bin'; system.mkdir(); (system / 'ydotoold').write_bytes(b'unexpected')
        with self.assertRaisesRegex(ValueError, 'replace distribution'): verify.verify(self.root)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.state = {'LoadState': 'loaded', 'ActiveState': 'active', 'FragmentPath': str(launcher.UNIT),
                      'DropInPaths': '', 'MainPID': '123', 'Transient': 'no', 'Job': '',
                      'ExecStart': '{ path=/usr/bin/ydotoold ; argv[]=/usr/bin/ydotoold ; ignore_errors=no ; }',
                      'ControlGroup': '/user.slice/user-1000.slice/user@1000.service/app.slice/voco-ydotoold.service'}
        self.new_state = dict(self.state, ExecStart='{ path=' + str(launcher.LAUNCHER) + ' ; argv[]=' + str(launcher.LAUNCHER) + ' ; ignore_errors=no ; }')
        self.current = patch.object(launcher, 'unit_state', side_effect=lambda _: dict(self.state)).start()
        self.systemctl = patch.object(launcher, 'systemctl', return_value='').start()
        self.process = patch.object(launcher, 'process_identity', return_value=(123, '/usr/bin/ydotoold', '100')).start()
        patch.object(launcher, 'trusted_file', side_effect=lambda path, **_: path).start()
        patch.object(launcher, 'digest', return_value=launcher.UNIT_SHA256).start()
        self.selection = patch.object(launcher, 'select_daemon', return_value=launcher.PRIVATE / 'ydotoold').start()
        self.others = patch.object(launcher, 'other_daemons', return_value=False).start()
        self.access = patch.object(launcher, 'device_access', return_value=True).start()

    def test_old_running_owned_unit_reloads_and_restarts_once(self):
        self.current.side_effect = [self.state, self.new_state, dict(self.new_state, MainPID='124')]
        self.process.side_effect = [(123, '/usr/bin/ydotoold', '100'), (123, '/usr/bin/ydotoold', '100'),
                                   (124, str(launcher.PRIVATE / 'ydotoold'), '101')]
        launcher.migrate()
        self.assertEqual([call.args[0] for call in self.systemctl.call_args_list],
                         [['daemon-reload'], ['restart', 'voco-ydotoold.service']])

    def test_current_exact_private_process_requires_no_restart(self):
        self.process.return_value = (123, str(launcher.PRIVATE / 'ydotoold'), '100')
        self.current.side_effect = None; self.current.return_value = self.new_state
        launcher.migrate()
        self.systemctl.assert_not_called()

    def test_correct_distribution_daemon_refreshes_cached_unit_without_restart(self):
        self.selection.return_value = launcher.SYSTEM_DAEMON
        self.current.side_effect = [self.state, self.new_state]
        launcher.migrate()
        self.assertEqual([call.args[0] for call in self.systemctl.call_args_list], [['daemon-reload']])

    def test_modern_client_can_migrate_private_process_back_to_distribution(self):
        self.selection.return_value = launcher.SYSTEM_DAEMON
        self.current.side_effect = [self.state, self.new_state, dict(self.new_state, MainPID='124')]
        self.process.side_effect = [(123, str(launcher.PRIVATE / 'ydotoold'), '100'),
                                   (123, str(launcher.PRIVATE / 'ydotoold'), '100'), (124, str(launcher.SYSTEM_DAEMON), '101')]
        launcher.migrate()
        self.assertEqual(self.systemctl.call_args_list[-1].args[0], ['restart', 'voco-ydotoold.service'])

    def test_missing_unit_is_not_enabled(self):
        self.current.side_effect = None; self.current.return_value = {'LoadState': 'not-found', 'Job': ''}
        launcher.migrate()
        self.systemctl.assert_not_called()

    def test_inactive_or_failed_old_unit_reloads_without_start_or_enable(self):
        for state in ('inactive', 'failed'):
            with self.subTest(state=state):
                self.systemctl.reset_mock()
                self.current.side_effect = [dict(self.state, ActiveState=state, MainPID='0'),
                                           dict(self.new_state, ActiveState=state, MainPID='0')]
                launcher.migrate()
                self.assertEqual([call.args[0] for call in self.systemctl.call_args_list], [['daemon-reload']])
                self.process.assert_not_called()

    def test_other_daemon_appearing_during_reload_prevents_restart(self):
        self.current.side_effect = [self.state, self.new_state]
        self.others.side_effect = [False, True]
        with self.assertRaisesRegex(ValueError, 'ownership changed'): launcher.migrate()
        self.assertEqual([call.args[0] for call in self.systemctl.call_args_list], [['daemon-reload']])

    def test_queued_job_or_transition_blocks_startup_retry(self):
        for state in (dict(self.state, Job='82'), dict(self.state, Job='0'), dict(self.state, Job=None), dict(self.state, ActiveState='deactivating'),
                      dict(self.state, ActiveState='activating'), dict(self.state, ActiveState='reloading')):
            with self.subTest(state=state):
                self.current.side_effect = None; self.current.return_value = state
                with self.assertRaises(launcher.MigrationInFlight): launcher.migrate()
                self.systemctl.assert_not_called()

    def test_timeout_after_restart_dispatch_is_not_a_safe_refusal(self):
        self.current.side_effect = [self.state, self.new_state]
        self.systemctl.side_effect = ['', subprocess.TimeoutExpired('systemctl', 2)]
        with self.assertRaises(launcher.MigrationInFlight): launcher.migrate()

    def test_admin_override_dropin_transient_and_custom_args_are_preserved(self):
        for field, value in (('FragmentPath', '/home/user/.config/systemd/user/voco-ydotoold.service'),
                             ('DropInPaths', '/etc/systemd/user/voco-ydotoold.service.d/admin.conf'),
                             ('Transient', 'yes'), ('ActiveState', 'activating'),
                             ('ExecStart', '{ path=/usr/bin/ydotoold ; argv[]=/usr/bin/ydotoold --custom ; }')):
            with self.subTest(field=field):
                self.current.side_effect = None; self.current.return_value = dict(self.state, **{field: value})
                with self.assertRaises(ValueError): launcher.migrate()
                self.systemctl.assert_not_called()

    def test_foreign_login_or_unowned_pid_cannot_restart(self):
        self.process.side_effect = ValueError('different login')
        with self.assertRaisesRegex(ValueError, 'different login'): launcher.migrate()
        self.systemctl.assert_not_called()

    def test_other_daemon_or_missing_device_access_cannot_restart(self):
        self.others.return_value = True
        with self.assertRaisesRegex(ValueError, 'Another input'): launcher.migrate()
        self.systemctl.assert_not_called()
        self.others.return_value = False; self.access.return_value = False
        with self.assertRaisesRegex(ValueError, 'device-permission'): launcher.migrate()
        self.systemctl.assert_not_called()

    def test_replaced_pid_after_reload_is_not_restarted(self):
        self.current.side_effect = [self.state, dict(self.new_state, MainPID='321')]
        with self.assertRaisesRegex(ValueError, 'ownership changed'): launcher.migrate()
        self.assertEqual([call.args[0] for call in self.systemctl.call_args_list], [['daemon-reload']])


if __name__ == '__main__':
    unittest.main()
