#!/usr/bin/env python3
"""Installer concurrency, presentation and prompt regression tests; no host install."""
import fcntl
import http.server
import importlib.util
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREFIX = (ROOT / 'install').read_text().split('# ─── Header', 1)[0]
APT_UI = ROOT / 'scripts/lib/install-apt-ui.py'
# The wordmark's lit cell, drawn only while a shine passes.
GLOW = b'\x1b[38;2;255;255;255;48;2;238;241;245m'


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
    def test_early_background_exit_cannot_clean_up_the_parent_installer(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, 'TERM': 'xterm-256color', 'TMPDIR': folder}
            body = r'''
VOCO_DOWNLOAD_DIR="$TMPDIR/download"
VOCO_INSTALL_LOG="$TMPDIR/install.log"
mkdir "$VOCO_DOWNLOAD_DIR"
printf payload > "$VOCO_DOWNLOAD_DIR/data"
printf diagnostic > "$VOCO_INSTALL_LOG"
sleep 30 &
DOWNLOAD_PID=$!
printf '%s' "$DOWNLOAD_PID" > "$TMPDIR/tracked.pid"
# A fast download can terminate its observer before the observer clears EXIT.
( trap 'printf attempted > "$TMPDIR/child-cleanup"; voco_install_cleanup' EXIT
  trap 'exit 143' TERM; kill -TERM "$BASHPID" ) &
child=$!
wait "$child" || true
[[ "$(cat "$VOCO_DOWNLOAD_DIR/data")" == payload ]]
[[ "$(cat "$VOCO_INSTALL_LOG")" == diagnostic ]]
kill -0 "$DOWNLOAD_PID"
'''
            code, output = terminal(['bash', '-c', PREFIX + body], env)
            self.assertEqual(code, 0, output)
            self.assertEqual((Path(folder) / 'child-cleanup').read_text(), 'attempted')
            self.assertFalse((Path(folder) / 'download').exists(), 'Parent EXIT must still clean its files')
            self.assertFalse((Path(folder) / 'install.log').exists(), 'Parent EXIT must still clean its log')
            with self.assertRaises(ProcessLookupError):
                os.kill(int((Path(folder) / 'tracked.pid').read_text()), 0)

    def test_wordmark_fits_and_canvas_release_matches_its_height(self):
        # The card needs 24-bit colour and 23 rows; everything else gets the compact canvas.
        for columns, rows, colour, height in ((80, 24, 'truecolor', 21), (64, 23, '24bit', 21), (64, 22, 'truecolor', 10),
                                              (80, 30, '', 10), (80, 12, 'truecolor', 10)):
            with self.subTest(columns=columns, rows=rows, colour=colour), tempfile.TemporaryDirectory() as folder:
                env = {**os.environ, 'TERM': 'xterm-256color', 'TMPDIR': folder, 'VOCO_INSTALL_NO_MOTION': '1',
                       'COLORTERM': colour}
                env.pop('NO_COLOR', None)
                body = f'''
VOCO_DOWNLOAD_DIR=$(mktemp -d)
VOCO_TERMINAL_COLUMNS={columns}
VOCO_TERMINAL_ROWS={rows}
voco_ui_init
voco_ui_begin 'Checking your download.' 'Verifying the publisher signature.'
voco_ui_release
printf 'PROMPT REMAINS VISIBLE\\n'
'''
                code, output = terminal(['bash', '-c', PREFIX + body], env, columns=columns, rows=rows)
                self.assertEqual(code, 0, output)
                self.assertIn(f'\033[{height}A'.encode(), output)
                plain = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', output.decode())
                # The card's eleven rows and its lower edge use upper half blocks.
                self.assertEqual(sum('▀' in line for line in plain.splitlines()), 12 if height == 21 else 0)
                self.assertEqual(plain.count('V O C O'), 0 if height == 21 else 1)
                self.assertTrue(all(len(line) < columns for line in plain.splitlines()))
                self.assertIn(b'PROMPT REMAINS VISIBLE', output)
                self.assertNotIn(GLOW, output, 'Reduced motion must not light the wordmark')

    def test_apt_uses_the_same_static_canvas_and_releases_for_prompt(self):
        for lines in ('21', '10'):
            with self.subTest(lines=lines), tempfile.TemporaryDirectory() as folder:
                env = {**os.environ, 'TERM': 'xterm-256color'}
                (Path(folder) / 'apt.log').touch(mode=0o600)
                # Feed status separately from a delayed prompt, allowing the real
                # renderer to paint before it gives terminal output back.
                command = ['bash', '-c', '({ printf "pmstatus:voco:20:Unpacking\\n"; sleep .2; printf "Confirm package option: "; }) | /usr/bin/python3 "$1" "$2" true joined 2026.0.62 "$3"',
                           'fixture', str(APT_UI), str(Path(folder) / 'apt.log'), lines]
                code, output = terminal(command, env, columns=64, rows=24)
                self.assertEqual(code, 0, output)
                self.assertIn(f'\x1b[{lines}A'.encode(), output)
                plain = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', output.decode())
                if lines == '21':
                    self.assertIn('▗', plain)
                    self.assertIn('v2026.0.62', plain)
                else:
                    self.assertIn('V O C O', plain)
                self.assertIn(b'Confirm package option: ', output)
                self.assertNotIn(GLOW, output)

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
        start = source.index('if ! grep -F "  $(basename "$PACKAGE_FILE")"')
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
PACKAGE_FILE="$1/fixture.deb"
CHECKSUM_FILE="$1/checksums"
PACKAGE_CHECKSUM_FILE="$1/selected.sha256"
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
            env={**os.environ,'TERM':'xterm-256color','TMPDIR':folder,'VOCO_INSTALL_NO_MOTION':'1','COLORTERM':'truecolor'}
            env.pop('NO_COLOR',None)
            body='''
VOCO_DOWNLOAD_DIR=$(mktemp -d)
voco_ui_init
voco_ui_begin test detail
printf x > "$VOCO_DOWNLOAD_DIR/data"
voco_ui_download_observer "$VOCO_DOWNLOAD_DIR/data" "$SECONDS" &
VOCO_UI_PID=$!
sleep .3
voco_ui_pause
'''
            code,output=terminal(['bash','-c',PREFIX+body],env)
            self.assertEqual(code,0,output)
            self.assertIn('↓'.encode(),output)
            self.assertNotIn('▁'.encode(),output)
            self.assertNotIn(b'\x1b[37mV',output)
            self.assertNotIn(GLOW,output)

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


class InstallerArtTests(unittest.TestCase):
    """The art canvas: one card, drawn the same by bash and by the APT display."""

    def bash(self, body, motion=True, columns=80, rows=24):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, 'TERM': 'xterm-256color', 'TMPDIR': folder, 'COLORTERM': 'truecolor',
                   'VOCO_INSTALL_NO_MOTION': '0' if motion else '1'}
            env.pop('NO_COLOR', None)
            setup = f'VOCO_TERMINAL_COLUMNS={columns}\nVOCO_TERMINAL_ROWS={rows}\nvoco_ui_configure\n'
            code, output = terminal(['bash', '-c', PREFIX + setup + body], env, columns=columns, rows=rows)
            self.assertEqual(code, 0, output)
            return output.decode()

    def test_the_microphone_comes_from_the_symbol(self):
        if not shutil.which('ffmpeg'):
            self.skipTest('ffmpeg is unavailable, so the microphone was not redrawn from the symbol')
        subprocess.run([sys.executable, str(ROOT / 'scripts/generate-installer-art.py'), '--check'], check=True)

    def test_bash_and_the_apt_display_draw_the_same_card(self):
        drawn = self.bash('voco_ui_card\nprintf "%s" "$VOCO_UI_CARD_TEXT"\n', motion=False)
        spec = importlib.util.spec_from_file_location('apt_ui', APT_UI)
        apt_ui = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(apt_ui)
        version = re.search(r'^VERSION="([^"]+)"', (ROOT / 'install').read_text(), re.M).group(1)
        expected = ''.join('\r\x1b[K  ' + line + '\n' for line in apt_ui.card_lines(version))
        self.assertEqual(drawn.replace('\r\n', '\n'), expected)
        for shine in (0, 140, 279):
            with self.subTest(shine=shine):
                lit = self.bash(f'voco_ui_card_at "$VOCO_UI_INTRO_MS" {shine}\nprintf "%s" "$VOCO_UI_CARD_TEXT"\n')
                expected = ''.join('\r\x1b[K  ' + line + '\n' for line in apt_ui.card_lines(version, shine))
                self.assertEqual(lit.replace('\r\n', '\n'), expected)

    def test_every_intro_frame_keeps_the_card_inside_its_canvas(self):
        times = (0, 40, 120, 240, 330, 480, 600, 840, 900, 1000, 1100, 1200, 1300)
        body = ''.join(f'voco_ui_card_at {t} {s}\nprintf "%s@@\\n" "$VOCO_UI_CARD_TEXT"\n'
                       for t in times for s in (-1, 100))
        frames = self.bash(body).replace('\r\n', '\n').split('@@\n')[:-1]
        self.assertEqual(len(frames), len(times) * 2)
        for frame in frames:
            lines = frame.split('\n')[:-1]
            self.assertEqual(len(lines), 13)
            for line in lines:
                self.assertTrue(line.startswith('\r\x1b[K  ') and line.endswith('\x1b[0m'), repr(line))
                visible = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', line.replace('\r', ''))
                self.assertLessEqual(len(visible), 60, repr(visible))
        plain = [re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', frame) for frame in frames]
        # At the start only the sweep's leading edge shows; the microphone follows
        # it in, and the tagline writes itself in last.
        self.assertFalse(any('▀' in line for line in plain[0].split('\n')[1:12]), plain[0])
        self.assertTrue(all('▀' in line for line in plain[times.index(480) * 2].split('\n')[1:12]))
        self.assertNotIn('The voice', plain[times.index(840) * 2])
        self.assertIn('The voice layer for Linux.', plain[-2])
        self.assertIn('Today: private dictation.', plain[-2])

    def test_the_intro_ends_and_reduced_motion_never_starts_it(self):
        moving = self.bash('voco_ui_now_ms\nVOCO_UI_INTRO_START=$VOCO_UI_NOW\n'
                           'voco_ui_animating && printf moving\nsleep 1.4\nvoco_ui_animating || printf rested\n')
        self.assertIn('moving', moving)
        self.assertIn('rested', moving)
        still = self.bash('voco_ui_now_ms\nVOCO_UI_INTRO_START=$VOCO_UI_NOW\nVOCO_UI_SHINE_START=$VOCO_UI_NOW\n'
                          'voco_ui_animating || printf still\n', motion=False)
        self.assertIn('still', still)

    def test_interrupting_the_intro_leaves_a_clean_terminal(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, 'TERM': 'xterm-256color', 'TMPDIR': folder, 'COLORTERM': 'truecolor',
                   'VOCO_INSTALL_NO_MOTION': '0'}
            env.pop('NO_COLOR', None)
            body = ('VOCO_TERMINAL_COLUMNS=80\nVOCO_TERMINAL_ROWS=24\nvoco_ui_init\n'
                    'voco_ui_sweep First detail\nprintf "%s" "$VOCO_UI_PID" > "$TMPDIR/animator"\n'
                    'sleep .3\nkill -INT $$\nsleep 2\n')
            code, output = terminal(['bash', '-c', PREFIX + body], env)
            self.assertEqual(code, 130, output)
            # Every frame is whole, so the terminal is left with its own colours.
            sgr = re.findall(rb'\x1b\[[0-9;]*m', output)
            self.assertTrue(sgr and sgr[-1] == b'\x1b[0m', sgr[-3:])
            with self.assertRaises(ProcessLookupError):
                os.kill(int((Path(folder) / 'animator').read_text()), 0)

    def test_a_resting_card_is_not_drawn_again(self):
        output = self.bash('VOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_ui_init\nvoco_ui_begin test detail\n'
                           'voco_ui_frame test detail "—" progress\nvoco_ui_close\n', motion=False)
        # One full canvas, then only the eight progress lines.
        self.assertEqual(output.count('\x1b[21A'), 1)
        self.assertEqual(output.count('\x1b[8A'), 1)
        self.assertEqual(output.count('▗'), 1)


if __name__ == '__main__':
    unittest.main()
