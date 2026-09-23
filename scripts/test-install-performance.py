#!/usr/bin/env python3
"""Installer concurrency, presentation and prompt regression tests; no host install."""
import fcntl
import http.server
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREFIX = (ROOT / 'install').read_text().split('# ─── Header', 1)[0]
APT_UI = ROOT / 'scripts/lib/install-apt-ui.py'


def terminal(command, env, reply=None, timeout=10, columns=80, rows=24):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
    def own_terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, env=env, preexec_fn=own_terminal)
    os.close(slave)
    output = bytearray()
    deadline = time.monotonic() + timeout
    replied = False
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], .02)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                output.extend(chunk)
                if reply and reply[0] in output and not replied:
                    os.write(master, reply[1])
                    replied = True
            elif process.poll() is not None:
                break
        else:
            raise TimeoutError(output.decode(errors='replace'))
        return process.wait(timeout=2), bytes(output)
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        os.close(master)


class InstallerPerformanceTests(unittest.TestCase):
    def test_embedded_apt_ui_ignores_untrusted_python_import_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'shutil.py').write_text('raise RuntimeError("untrusted shutil module loaded")\n')
            log = root / 'apt.log'
            log.touch(mode=0o600)
            run = subprocess.run(
                ['bash', '-c', PREFIX + '\nvoco_apt_display "$1" true\n', 'test', str(log)],
                cwd=root, env={**os.environ, 'PYTHONPATH': folder},
                input=b'Unfamiliar package message\n', capture_output=True, timeout=3,
            )
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn(b'Unfamiliar package message', run.stdout)
            self.assertNotIn(b'untrusted', run.stderr)

    def test_real_verification_gate_rejects_missing_or_corrupt_checksum(self):
        source = (ROOT / 'install').read_text()
        start = source.index('if ! grep -F "  $(basename "$DEB_FILE")"')
        verification = source[start:source.index('# ─── Install', start)]
        for case in ('valid', 'corrupt', 'missing'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                payload = root / 'fixture.deb'
                payload.write_bytes(b'public package fixture')
                checksum = subprocess.check_output(['sha256sum', payload.name], cwd=root)
                if case == 'corrupt':
                    payload.write_bytes(b'corrupt package fixture')
                (root / 'checksums').write_bytes(checksum if case != 'missing' else b'')
                body = '''
VOCO_DOWNLOAD_DIR="$1"
DEB_FILE="$1/fixture.deb"
CHECKSUM_FILE="$1/checksums"
DEB_CHECKSUM_FILE="$1/selected.sha256"
'''
                run = subprocess.run(
                    ['bash', '-c', PREFIX + body + verification + '\nprintf "PASSED INSTALL GATE\\n"', 'test', folder],
                    env={**os.environ, 'NO_COLOR': '1'}, capture_output=True, timeout=3,
                )
                self.assertEqual(run.returncode, 0 if case == 'valid' else 1, run.stdout + run.stderr)
                self.assertEqual(b'PASSED INSTALL GATE' in run.stdout, case == 'valid')

    def test_metadata_overlaps_payload_and_is_required(self):
        arrivals = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                arrivals[self.path] = time.monotonic()
                time.sleep(.15)
                if self.path == '/bad':
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Length', '8')
                self.end_headers()
                self.wfile.write(b'fixture\n')

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for checksum_path, signature_path in (('checksums', 'signature'), ('bad', 'signature'), ('checksums', 'bad')):
                with self.subTest(checksum=checksum_path, signature=signature_path), tempfile.TemporaryDirectory() as folder:
                    env = {**os.environ, 'NO_COLOR': '1', 'TMPDIR': folder}
                    url = f'http://127.0.0.1:{server.server_port}'
                    body = '''
VOCO_DOWNLOAD_DIR=$(mktemp -d)
CHECKSUM_FILE="$VOCO_DOWNLOAD_DIR/checksums"
SIGNATURE_FILE="$VOCO_DOWNLOAD_DIR/checksums.asc"
CHECKSUMS_URL="$1/$2"
SIGNATURE_URL="$1/$3"
voco_start_release_metadata_downloads
voco_download payload "$VOCO_DOWNLOAD_DIR/payload" "$1/payload"
voco_finish_release_metadata_downloads
'''
                    run = subprocess.run(['bash', '-c', PREFIX + body, 'test', url, checksum_path, signature_path], env=env, capture_output=True, timeout=5)
                    self.assertEqual(run.returncode, 0 if checksum_path == 'checksums' and signature_path == 'signature' else 1, run.stdout + run.stderr)
                    self.assertLess(abs(arrivals['/'+checksum_path] - arrivals['/payload']), .12)
                    self.assertLess(abs(arrivals['/'+signature_path] - arrivals['/payload']), .12)
                    if 'bad' in (checksum_path, signature_path):
                        self.assertIn(b'Nothing was installed', run.stdout)
                        logs = list(Path(folder).glob('*.log'))
                        self.assertEqual(len(logs), 1)
                        self.assertEqual(logs[0].stat().st_mode & 0o777, 0o600)
        finally:
            server.shutdown()
            server.server_close()

    def test_slow_optional_prefetch_does_not_hold_up_install(self):
        with tempfile.TemporaryDirectory() as folder:
            body = '''
VOCO_DOWNLOAD_DIR=$(mktemp -d)
sleep 20 &
HELPER_DOWNLOAD_PID=$!
pid=$HELPER_DOWNLOAD_PID
voco_finish_helper_prefetch
[[ -z "$HELPER_DOWNLOAD_READY" && -z "$HELPER_DOWNLOAD_PID" ]]
! kill -0 "$pid" 2>/dev/null
'''
            start = time.monotonic()
            run = subprocess.run(['bash', '-c', PREFIX + body], env={**os.environ, 'TMPDIR': folder}, capture_output=True, timeout=2)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertLess(time.monotonic() - start, .5)

    def test_apt_keeps_stdin_prompts_and_failure_status(self):
        for outcome in (0, 100):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root/'sudo').write_text('#!/bin/bash\nif [[ "$1" == -v || "$1" == -n ]]; then exit 0; fi\nexec "$@"\n')
                (root/'apt-get').write_text('''#!/bin/bash
printf 'pmstatus:voco:20:Unpacking voco\n' >&3
printf 'Unpacking voco (test) ...\n'
printf 'Fixture choice [y/N]: '
read -r answer
[[ "$answer" == yes ]] || exit 55
printf '\nChoice accepted\n'
exit "$FIXTURE_EXIT"
''')
                for path in root.iterdir():
                    path.chmod(0o755)
                env = {**os.environ, 'TMPDIR': folder, 'PATH': folder+':'+os.environ['PATH'], 'TERM':'xterm-256color', 'FIXTURE_EXIT':str(outcome)}
                env.pop('NO_COLOR', None)
                body = '\nVOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_run_apt /synthetic.deb\n'
                code, output = terminal(['bash','-c',PREFIX+body], env, reply=(b'Fixture choice [y/N]: ', b'yes\n'))
                self.assertEqual(code, outcome, output.decode(errors='replace'))
                self.assertIn(b'Choice accepted', output)
                self.assertNotIn(b'Unpacking voco (test)', output)
                self.assertNotIn(b'pmstatus:', output)
                logs=list(root.glob('*.log'))
                self.assertEqual(len(logs), 1 if outcome else 0)
                if logs:
                    self.assertIn('Unpacking voco', logs[0].read_text())

    def test_unknown_lines_and_non_newline_prompts_are_never_hidden(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder)/'apt.log'
            log.touch(mode=0o600)
            process = subprocess.Popen(['/usr/bin/python3',str(APT_UI),str(log),'true'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                process.stdin.write(b'pmstatus:voco:25:Unpacking\nChoose a value: ')
                process.stdin.flush()
                deadline=time.monotonic()+1
                data=b''
                while b'Choose a value: ' not in data and time.monotonic()<deadline:
                    if select.select([process.stdout],[],[],.1)[0]:
                        data+=os.read(process.stdout.fileno(),65536)
                self.assertIn(b'Choose a value: ',data)
                process.stdin.write(b'answer accepted\nE: fixture error\n')
                process.stdin.close()
                data+=process.stdout.read()
                self.assertEqual(process.wait(timeout=2),0,process.stderr.read())
                self.assertIn(b'E: fixture error',data)
                self.assertNotIn(b'pmstatus:',data)
            finally:
                if process.poll() is None:
                    process.kill(); process.wait()
                process.stdout.close(); process.stderr.close()

    def test_no_motion_has_no_signal_history_or_sweep(self):
        with tempfile.TemporaryDirectory() as folder:
            env={**os.environ,'TERM':'xterm-256color','TMPDIR':folder,'VOCO_INSTALL_NO_MOTION':'1'}
            env.pop('NO_COLOR',None)
            body='''
VOCO_DOWNLOAD_DIR=$(mktemp -d)
voco_ui_init
voco_ui_begin test detail
printf x > "$VOCO_DOWNLOAD_DIR/data"
voco_ui_download_observer "$VOCO_DOWNLOAD_DIR/data" 0 "$SECONDS" &
VOCO_UI_PID=$!
sleep .3
voco_ui_pause
'''
            code,output=terminal(['bash','-c',PREFIX+body],env)
            self.assertEqual(code,0,output)
            self.assertIn('↓'.encode(),output)
            self.assertNotIn('▁'.encode(),output)
            self.assertNotIn(b'\x1b[37mV',output)

    def test_restricted_sudo_policy_uses_ordinary_apt(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            sudo=root/'sudo'
            sudo.write_text('#!/bin/bash\n[[ "$1" == -v ]] && exit 0\n[[ "$1" == -n ]] && exit 1\nprintf "ORDINARY APT: %s\\n" "$*"\n[[ "$1" == apt-get ]]\n')
            sudo.chmod(0o755)
            env={**os.environ,'PATH':folder+':'+os.environ['PATH'],'TMPDIR':folder,'TERM':'xterm-256color'}
            env.pop('NO_COLOR',None)
            code,output=terminal(['bash','-c',PREFIX+'\nVOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_run_apt /synthetic.deb\n'],env)
            self.assertEqual(code,0,output)
            self.assertIn(b'ORDINARY APT: apt-get install -y -- /synthetic.deb',output)

    def test_logging_failure_does_not_break_output_or_process_status(self):
        with tempfile.TemporaryDirectory() as folder:
            run=subprocess.run(['/usr/bin/python3',str(APT_UI),str(Path(folder)/'missing/log'),'true'],input=b'Unfamiliar package message\n',capture_output=True,timeout=2)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertIn(b'Could not save installation details',run.stdout)
            self.assertIn(b'Unfamiliar package message',run.stdout)


if __name__ == '__main__':
    unittest.main()
