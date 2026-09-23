#!/usr/bin/env python3
"""Exercise the installer spawn boundary with private sockets and a disposable app."""
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class InstallerLaunchTests(unittest.TestCase):
    def run_launch(self, case='wayland'):
        source = (ROOT / 'install').read_text()
        match = re.search(r'^voco_launch_installed_app\(\) \{\n.*?^\}', source, re.M | re.S)
        self.assertIsNotNone(match, 'Installer must have a post-success launch boundary')
        helper = match.group()
        with tempfile.TemporaryDirectory(prefix='voco-installer-launch-') as folder:
            root = Path(folder)
            runtime = root / 'runtime'
            runtime.mkdir(mode=0o700)
            x11 = root / 'x11'
            x11.mkdir()
            marker = root / 'launched.json'
            app = root / 'fixture-app'
            app.write_text('''#!/usr/bin/python3 -I
import json, os, pathlib, sys, time
with pathlib.Path(os.environ['FIXTURE_LAUNCH_MARKER'] + '.attempts').open('a') as attempts:
    attempts.write(str(os.getpid()) + '\\n')
marker = pathlib.Path(os.environ['FIXTURE_LAUNCH_MARKER'])
temporary = marker.with_suffix('.tmp')
temporary.write_text(json.dumps({
    'pid': os.getpid(), 'sid': os.getsid(0), 'uid': os.getuid(), 'euid': os.geteuid(),
    'argv': sys.argv, 'stdin': os.read(0, 1).hex(),
    'fds': [os.readlink('/proc/self/fd/' + str(n)) for n in range(3)],
    'environment': {key: os.environ.get(key) for key in (
        'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
        'XAUTHORITY', 'XDG_SESSION_TYPE', 'GDK_BACKEND', 'PULSE_SERVER')},
}))
os.replace(temporary, marker)
print('Fixture stdout must never reach the installer', flush=True)
print('Fixture stderr must never reach the installer', file=sys.stderr, flush=True)
mode = os.environ.get('FIXTURE_APP_MODE', '')
if mode == 'exit-success': sys.exit(0)
if mode == 'exit-failure': sys.exit(23)
time.sleep(15)
''')
            app.chmod(0o700)
            self.assertIn('app = "/usr/bin/voco"', helper)
            self.assertIn('x11_root = Path("/tmp/.X11-unix")', helper)
            # Replace only the installed executable and X11 socket root in this
            # private copy. Popen, detachment, guards and environment stay real.
            helper = helper.replace('app = "/usr/bin/voco"', f'app = {str(app)!r}', 1)
            helper = helper.replace('x11_root = Path("/tmp/.X11-unix")', f'x11_root = Path({str(x11)!r})', 1)
            env = {**os.environ, 'XDG_RUNTIME_DIR': str(runtime), 'WAYLAND_DISPLAY': 'wayland-fixture',
                   'DISPLAY': ':97.0', 'XDG_SESSION_TYPE': 'wayland', 'GDK_BACKEND': 'wayland',
                   'DBUS_SESSION_BUS_ADDRESS': f'unix:path={runtime}/bus', 'XAUTHORITY': str(root / 'authority'),
            'PULSE_SERVER': f'unix:{runtime}/pulse', 'FIXTURE_LAUNCH_MARKER': str(marker)}
            for key in ('SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY'):
                env.pop(key, None)
            mode = case if case.startswith('exit-') else ''
            env['FIXTURE_APP_MODE'] = mode
            if case == 'root':
                helper = helper.replace('owner = os.getuid()', 'owner = 0', 1)
            if case == 'ssh':
                env['SSH_CONNECTION'] = '192.0.2.1 123 192.0.2.2 22'
            if case == 'headless':
                for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE'):
                    env.pop(key, None)
            if case in ('x11', 'remote-x11'):
                env.pop('WAYLAND_DISPLAY')
                env['XDG_SESSION_TYPE'] = 'x11'
                env['GDK_BACKEND'] = 'x11'
            if case == 'remote-x11':
                env['DISPLAY'] = 'other-host:97.0'
            if case == 'runtime-permissions':
                runtime.chmod(0o755)
            if case == 'missing-app':
                app.unlink()
            if case == 'tty-session':
                env['XDG_SESSION_TYPE'] = 'tty'
            sockets = []
            for path in (runtime / 'wayland-fixture', x11 / 'X97'):
                channel = socket.socket(socket.AF_UNIX)
                channel.bind(str(path))
                sockets.append(channel)
            if case == 'missing-display':
                (runtime / 'wayland-fixture').unlink()
            started = time.monotonic()
            record = None
            try:
                result = subprocess.run(['bash', '-c', helper + '\nvoco_launch_installed_app\n'],
                                        env=env, capture_output=True, text=True, timeout=4)
                elapsed = time.monotonic() - started
                expected = 2 if case in ('root', 'ssh', 'headless', 'remote-x11', 'runtime-permissions',
                                         'tty-session', 'missing-display') else 1 if case in (
                                             'exit-failure', 'missing-app') else 0
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                self.assertLess(elapsed, 2, 'Installer waited for the application lifetime')
                if expected != 2 and case != 'missing-app':
                    # The launch request may return before a scheduled child has
                    # started Python. This observer wait is outside installer time.
                    deadline = time.monotonic() + 2
                    while not marker.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                if marker.exists():
                    record = json.loads(marker.read_text())
                    self.assertEqual(len(Path(str(marker) + '.attempts').read_text().splitlines()), 1)
                if expected == 2 or case == 'missing-app':
                    self.assertIsNone(record, 'Skipped/failed preflight must not execute an application')
                    self.assertIn('desktop', result.stdout.lower())
                else:
                    self.assertIsNotNone(record)
                    self.assertEqual(record['uid'], os.getuid())
                    self.assertEqual(record['euid'], os.geteuid())
                    self.assertEqual(record['sid'], record['pid'])
                    self.assertEqual(record['argv'], [str(app)])
                    self.assertEqual(record['stdin'], '')
                    self.assertEqual(record['fds'], ['/dev/null'] * 3)
                    self.assertEqual(record['environment'], {key: env.get(key) for key in record['environment']})
                    self.assertNotIn('Fixture stdout', result.stdout)
                    self.assertNotIn('Fixture stderr', result.stderr)
                    if case not in ('exit-success', 'exit-failure'):
                        os.kill(record['pid'], 0)  # The child outlives the installer shell.
                if expected == 1:
                    self.assertIn('automatically', result.stdout)
                return {'case': case, 'exit': result.returncode, 'elapsed': elapsed, 'record': record}
            finally:
                if marker.exists():
                    record = json.loads(marker.read_text())
                    try:
                        args = Path(f"/proc/{record['pid']}/cmdline").read_bytes()
                        if os.fsencode(str(app)) in args.split(b'\0'):
                            os.kill(record['pid'], signal.SIGTERM)
                    except (FileNotFoundError, ProcessLookupError):
                        pass
                for channel in sockets:
                    channel.close()

    def test_detached_launch_preserves_wayland_and_x11_environment(self):
        for case in ('wayland', 'x11'):
            with self.subTest(case=case):
                self.run_launch(case)

    def test_root_remote_headless_and_untrusted_contexts_never_launch(self):
        for case in ('root', 'ssh', 'headless', 'remote-x11', 'runtime-permissions', 'tty-session', 'missing-display'):
            with self.subTest(case=case):
                self.run_launch(case)

    def test_successful_early_exit_is_an_accepted_activation_request(self):
        self.run_launch('exit-success')

    def test_failed_launch_has_manual_remedy_without_retry(self):
        for case in ('exit-failure', 'missing-app'):
            with self.subTest(case=case):
                self.run_launch(case)


if __name__ == '__main__':
    unittest.main()
