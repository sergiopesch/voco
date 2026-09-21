"""Exercise helper download overlap, fallback and cancellation without installing."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREFIX = (ROOT / 'install').read_text().split('# ─── Header', 1)[0]


class HelperPrefetchTests(unittest.TestCase):
    def run_case(self, case, session='wayland', installed=False):
        with tempfile.TemporaryDirectory(prefix='voco-prefetch-test-') as folder:
            root = Path(folder)
            (root / 'bin').mkdir()
            query = root / 'bin/dpkg-query'
            query.write_text('#!/bin/sh\n' + ('printf "install ok installed"\n' if installed else 'exit 1\n'))
            query.chmod(0o755)
            apt = root / 'bin/apt-get'
            apt.write_text('''#!/usr/bin/python3
import json,os,time
from pathlib import Path
root=Path(os.environ['PREFETCH_TEST_ROOT'])
(root/'started.json').write_text(json.dumps({'pid':os.getpid(),'time':time.time()}))
time.sleep(.5 if os.environ['PREFETCH_CASE']!='cancel' else 20)
Path('ydotool_1_amd64.deb').write_bytes(b'synthetic package')
(root/'finished.json').write_text(json.dumps({'time':time.time()}))
raise SystemExit(1 if os.environ['PREFETCH_CASE']=='failure' else 0)
''')
            apt.chmod(0o755)
            body = '''
VOCO_DOWNLOAD_DIR=$(mktemp -d)
voco_start_helper_prefetch
if [[ "$PREFETCH_CASE" == cancel ]]; then
  for attempt in {1..100}; do [[ -f "$PREFETCH_TEST_ROOT/started.json" ]] && break; sleep .02; done
  exit 130
fi
date +%s%N > "$PREFETCH_TEST_ROOT/main-start"
sleep .8
date +%s%N > "$PREFETCH_TEST_ROOT/main-end"
voco_finish_helper_prefetch
printf '%s' "$HELPER_DOWNLOAD_READY" > "$PREFETCH_TEST_ROOT/ready"
if [[ -n "$HELPER_DOWNLOAD_READY" ]]; then
  [[ -f "$HELPER_DOWNLOAD_READY/ydotool_1_amd64.deb" ]]
  sudo() { printf '%s\\n' "$@" > "$PREFETCH_TEST_ROOT/install-args"; }
  voco_verify_installed_package() { return 0; }
  touch "$VOCO_DOWNLOAD_DIR/voco.deb"
  voco_install_deb_package "$VOCO_DOWNLOAD_DIR/voco.deb" 2026.0.48 amd64 "$HELPER_DOWNLOAD_READY"
fi
'''
            env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
                   'TMPDIR': str(root), 'PREFETCH_TEST_ROOT': str(root),
                   'PREFETCH_CASE': case, 'XDG_SESSION_TYPE': session, 'NO_COLOR': '1'}
            run = subprocess.run(['bash', '-c', PREFIX + body], env=env,
                                 capture_output=True, text=True, timeout=8)
            self.assertEqual(run.returncode, 130 if case == 'cancel' else 0, run.stdout + run.stderr)
            started = root / 'started.json'
            if session != 'wayland' or installed:
                self.assertFalse(started.exists())
                self.assertEqual((root / 'ready').read_text(), '')
            elif case == 'cancel':
                pid = json.loads(started.read_text())['pid']
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
            elif case == 'failure':
                self.assertEqual((root / 'ready').read_text(), '')
                self.assertFalse((root / 'install-args').exists())
                self.assertIn('APT will fetch', run.stdout)
            else:
                self.assertIn('Desktop helpers downloaded', run.stdout)
                self.assertIn('/helpers/ydotool_1_amd64.deb', (root / 'install-args').read_text())
                first = json.loads(started.read_text())['time']
                last = json.loads((root / 'finished.json').read_text())['time']
                self.assertLess(first, int((root / 'main-end').read_text()) / 1e9)
                self.assertGreater(last, int((root / 'main-start').read_text()) / 1e9)
            self.assertFalse(any(p.is_dir() and p.name.startswith('tmp.') for p in root.iterdir()))

    def test_download_can_run_during_other_install_work(self):
        self.run_case('success')

    def test_failure_falls_back_without_passing_partial_archives(self):
        self.run_case('failure')

    def test_cancellation_reaps_downloader(self):
        self.run_case('cancel')

    def test_x11_does_not_download_wayland_helpers(self):
        self.run_case('success', session='x11')

    def test_installed_helpers_are_not_downloaded_again(self):
        self.run_case('success', installed=True)


if __name__ == '__main__':
    unittest.main()
