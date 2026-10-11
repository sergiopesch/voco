#!/usr/bin/env python3
"""Installer concurrency, presentation and prompt regression tests; no host install."""
import base64
import fcntl
import http.server
import importlib.util
import json
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
# The card's top edge, which nothing else draws.
TOP_EDGE = '▗' + '▄' * 56 + '▖'
# The probe's kitty graphics query, and a terminal's answers to the probe.
QUERY = b'\x1b_Gi=8626,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\'
GHOSTTY = b'\x1b_Gi=8626;OK\x1b\\\x1b[6;38;18t\x1b[4;912;1440t\x1b[?62;22c'
VTE = b'\x1b[?65;1;9c'
# Who the installer may think it is talking to, which the tests choose themselves.
TERMINAL_HINTS = ('VOCO_INSTALL_ART', 'SSH_CONNECTION', 'SSH_TTY', 'TMUX', 'STY', 'VTE_VERSION', 'TERM_PROGRAM',
                  'NO_COLOR', 'VOCO_INSTALL_PLAIN')


# The card as one whole redraw, every line from its start, as a fresh canvas
# shows it: in Bash from the card's parts, and from the APT display's rows.
CARD_TEXT = r'''card_text() {
  local r
  printf '\r\e[K  %s\e[0m\n' "$VOCO_UI_CARD_TOP"
  for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
    printf '\r\e[K  %s%s\e[0m\n' "${VOCO_UI_CARD_LEFT[r]}" "${VOCO_UI_CARD_RIGHT[r]}"
  done
  printf '\r\e[K  %s\e[0m\n' "$VOCO_UI_CARD_BOTTOM"
}
'''


def card_text(rows):
    return ''.join('\r\033[K  ' + (row if isinstance(row, str) else ''.join(row)) + '\033[0m\n' for row in rows)


def apt_card(art='quadrant'):
    """The card and shine arguments install-ui.sh passes the APT display."""
    with tempfile.TemporaryDirectory() as folder:
        run = subprocess.run(['bash', '-c', PREFIX + 'VOCO_TERMINAL_MOTION=true\nvoco_ui_configure\nvoco_ui_apt_card\n'
                              'printf "\\0%s\\0%s" "$VOCO_UI_APT_CARD" "$VOCO_UI_APT_SHINE"\n'],
                             env=art_env(folder, VOCO_INSTALL_ART=art), capture_output=True, timeout=10, check=True)
    # Configuring the kitty card sends the image first.
    _, card, shine = run.stdout.decode().split('\0')
    return card, shine


def art_env(folder, **extra):
    """A truecolor terminal environment with no hints about which terminal it is."""
    env = {key: value for key, value in os.environ.items() if key not in TERMINAL_HINTS}
    env.update({'TERM': 'xterm-256color', 'TMPDIR': folder, 'COLORTERM': 'truecolor', 'VOCO_INSTALL_NO_MOTION': '1'})
    env.update(extra)
    return env


class Screen:
    """A small VT model of what the installer draws: each cell's character and
    its foreground and background colours, kitty image placements, and only the
    sequences the installer sends. Erasing fills with the current background,
    as terminals do. It takes the PTY's output with CR LF already turned to LF."""
    TOKENS = re.compile(r'(\x1b\[[0-9;?]*[A-Za-z]|\x1b_[^\x1b]*\x1b\\|\x1b[78\\])')

    def __init__(self, rows=60, columns=80):
        self.rows = [[(' ', None, None)] * columns for _ in range(rows)]
        self.row = self.column = 0
        self.fg = self.bg = None
        self.saved = (0, 0)
        self.images = {}

    def feed(self, text):
        for token in self.TOKENS.split(text):
            if token.startswith('\x1b_G'):
                keys = dict(item.split('=', 1) for item in token[3:-2].split(';', 1)[0].split(',') if '=' in item)
                if keys.get('a') == 'p':
                    self.images[keys['i'], keys['p']] = (self.row, self.column, keys['c'], keys['r'], keys.get('w'))
                elif keys.get('a') == 'd':
                    self.images.pop((keys['i'], keys.get('p')), None)
            elif token in ('\x1b7', '\x1b8'):
                if token == '\x1b7':
                    self.saved = (self.row, self.column)
                else:
                    self.row, self.column = self.saved
            elif token.startswith('\x1b['):
                command, values = token[-1], [int(v) for v in token[2:-1].split(';') if v.isdigit()]
                if command == 'm':
                    values = values or [0]
                    while values:
                        value = values.pop(0)
                        if value == 0:
                            self.fg = self.bg = None
                        elif value in (38, 48):
                            colour = tuple(values[1:4])
                            del values[:4]
                            if value == 38:
                                self.fg = colour
                            else:
                                self.bg = colour
                        elif value == 39:
                            self.fg = None
                        elif value == 49:
                            self.bg = None
                elif command == 'A':
                    self.row = max(0, self.row - (values[0] if values else 1))
                elif command == 'G':
                    self.column = (values[0] if values else 1) - 1
                elif command == 'K':
                    line = self.rows[self.row]
                    line[self.column:] = [(' ', None, self.bg)] * (len(line) - self.column)
                elif command not in 'tc':
                    raise AssertionError(f'Unsupported terminal operation: {token!r}')
            elif token != '\x1b\\':
                for char in token:
                    if char == '\r':
                        self.column = 0
                    elif char == '\n':
                        # The PTY turns a newline into CR LF.
                        self.row += 1
                        self.column = 0
                    else:
                        self.rows[self.row][self.column] = (char, self.fg if char != ' ' else None, self.bg)
                        self.column += 1

    def cells(self):
        return [list(row) for row in self.rows], dict(self.images), (self.row, self.column)


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
                # A reply is (what to wait for, what to type), or a function of
                # the output so far that returns what to type, if anything.
                if callable(reply):
                    answer = reply(bytes(output))
                    if answer:
                        os.write(master, answer)
                elif reply and reply[0] in output and not replied:
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
                env = art_env(folder, COLORTERM=colour, VOCO_INSTALL_ART='quadrant')
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
                self.assertEqual(plain.count(TOP_EDGE), 1 if height == 21 else 0)
                self.assertEqual(plain.count('V O C O'), 0 if height == 21 else 1)
                self.assertTrue(all(len(line) < columns for line in plain.splitlines()))
                self.assertIn(b'PROMPT REMAINS VISIBLE', output)
                self.assertNotIn(GLOW, output, 'Reduced motion must not light the wordmark')

    def test_apt_uses_the_same_static_canvas_and_releases_for_prompt(self):
        card, shine = apt_card()
        for lines in ('21', '10'):
            with self.subTest(lines=lines), tempfile.TemporaryDirectory() as folder:
                env = {**os.environ, 'TERM': 'xterm-256color'}
                (Path(folder) / 'apt.log').touch(mode=0o600)
                # Feed status separately from a delayed prompt, allowing the real
                # renderer to paint before it gives terminal output back.
                command = ['bash', '-c', '({ printf "pmstatus:voco:20:Unpacking\\n"; sleep .2; printf "Confirm package option: "; }) | /usr/bin/python3 "$1" "$2" true joined 2026.0.62 "$3" "$4" "$5" "" ""',
                           'fixture', str(APT_UI), str(Path(folder) / 'apt.log'), lines, card, shine]
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
            env=art_env(folder,VOCO_INSTALL_ART='quadrant')
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
            # The progress mark is a still arrow, never the moving meter. The card's
            # microphone may use block symbols of its own.
            marks=set(re.findall(rb'\r\x1b\[K  \x1b\[38;2;199;204;212m([^\x1b]*)\x1b\[0m',output))
            self.assertIn('↓'.encode(),marks)
            self.assertLessEqual(marks,{'↓'.encode(),'—'.encode()},marks)
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


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def visible(text):
    """TEXT without its escape sequences: colours, cursor moves and saves, kitty commands."""
    return re.sub(r'\x1b(?:\[[0-9;?]*[A-Za-z]|_[^\x1b]*\x1b\\|[78\\])', '', text)


def kitty_commands(text):
    """Each kitty graphics command in TEXT, as its keys and its payload."""
    return [(dict(item.split('=', 1) for item in keys.split(',') if item), payload)
            for keys, payload in re.findall(r'\x1b_G([^;\x1b]*);?([^\x1b]*)\x1b\\', text)]


class InstallerArtTests(unittest.TestCase):
    """The art canvas: one card, drawn the same by bash and by the APT display,
    with its microphone as an image or as a mosaic the terminal draws itself."""

    MODES = ('octant', 'sextant', 'quadrant', 'kitty')

    def bash(self, body, motion=True, columns=80, rows=24, art='quadrant', reply=None, **extra):
        """Output after the canvas is configured, with the PTY's CR LF as LF."""
        with tempfile.TemporaryDirectory() as folder:
            env = art_env(folder, VOCO_INSTALL_NO_MOTION='0' if motion else '1', **extra)
            if art:
                env['VOCO_INSTALL_ART'] = art
            setup = f'VOCO_TERMINAL_COLUMNS={columns}\nVOCO_TERMINAL_ROWS={rows}\nvoco_ui_configure\nprintf "@@CONFIGURED@@\\n"\n'
            code, output = terminal(['bash', '-c', PREFIX + setup + body], env, reply=reply, columns=columns, rows=rows)
            self.assertEqual(code, 0, output)
            return output.decode().replace('\r\n', '\n')

    def drawn(self, body, art, motion=False, **extra):
        """What BODY printed, then each row's left part (its padding and the
        microphone) and the full placement."""
        output = self.bash(body + 'IFS=$\'\\n\'\nprintf "@@%s@@%s" "${VOCO_UI_LEFT[*]}" "${VOCO_UI_PLACE[14]:-}"\n',
                           motion=motion, art=art, **extra)
        text, rows, place = output.split('@@CONFIGURED@@\n', 1)[1].rsplit('@@', 2)
        return text, rows.split('\n'), place

    def probe(self, reply=None, body='', **extra):
        """Configure the canvas in a terminal that answers REPLY to the probe."""
        script = ('before=$(stty -g < /dev/tty)\nvoco_ui_now_ms\nstarted=$VOCO_UI_NOW\n'
                  'VOCO_TERMINAL_COLUMNS=80\nVOCO_TERMINAL_ROWS=24\nvoco_ui_configure\nvoco_ui_now_ms\n'
                  'after=$(stty -g < /dev/tty)\n'
                  'printf "\\nPROBED %s %s %sx%s %d %s\\n" "${VOCO_UI_MIC_MODE:-none}" "${VOCO_UI_GRAPHICS:-none}" '
                  '"$VOCO_UI_CELL_WIDTH" "$VOCO_UI_CELL_HEIGHT" $((VOCO_UI_NOW - started)) '
                  '"$([[ "$before" == "$after" ]] && printf same || printf changed)"\n' + body)
        with tempfile.TemporaryDirectory() as folder:
            code, output = terminal(['bash', '-c', PREFIX + script], art_env(folder, **extra),
                                    reply=(b'\x1b[c', reply) if reply else None)
        self.assertEqual(code, 0, output)
        found = re.search(rb'PROBED (\S+) (\S+) (\d+)x(\d+) (\d+) (\S+)', output)
        self.assertIsNotNone(found, output)
        mode, graphics, width, height, elapsed, state = found.groups()
        return {'mode': mode.decode(), 'graphics': graphics.decode(), 'cell': (int(width), int(height)),
                'ms': int(elapsed), 'terminal': state.decode()}, output

    def test_the_microphone_comes_from_the_symbol(self):
        if not shutil.which('ffmpeg'):
            self.skipTest('ffmpeg is unavailable, so the microphone was not redrawn from the symbol')
        subprocess.run([sys.executable, str(ROOT / 'scripts/generate-installer-art.py'), '--check'], check=True)

    def test_the_freshness_check_covers_the_image_and_every_mosaic(self):
        if not shutil.which('ffmpeg'):
            self.skipTest('ffmpeg is unavailable, so the microphone was not redrawn from the symbol')
        generator = load('installer_art', ROOT / 'scripts/generate-installer-art.py')
        brand = json.loads((ROOT / 'scripts/lib/install-brand.json').read_text())
        drawn, pixels, samples = generator.draw(shutil.which('ffmpeg'), brand['card'])
        stored = brand['art']
        self.assertTrue(generator.fresh(stored, drawn, pixels, samples))

        def upside_down(art):
            width, height, palette, shown = generator.decode_png(base64.b64decode(art['image']['png']))
            indices = [palette.index(rgb) for rgb in shown]
            flipped = [index for y in reversed(range(height)) for index in indices[y * width:(y + 1) * width]]
            art['image']['png'] = base64.b64encode(generator.png(width, height, palette, flipped)).decode()

        def moved(art):
            art['image']['mic'][0] += 1

        def brighter(art):
            art['palette'] = ['%02x%02x%02x' % tuple(min(255, value + 40) for value in bytes.fromhex(colour))
                              for colour in art['palette']]

        changes = {'image upside down': upside_down, 'microphone moved': moved, 'palette brighter': brighter,
                   'cell count': lambda art: art.update(columns=13)}
        # An octant where only quadrants or sextants are drawn, and a shade in no set.
        foreign = {'octant': '░', 'sextant': '\U0001cd00', 'quadrant': '\U0001cd00'}
        for kind, symbol in foreign.items():
            changes[f'{kind} row blanked'] = lambda art, kind=kind: art['mosaic'][kind].__setitem__(5, [' 0000'] * 14)
            changes[f'{kind} foreign symbol'] = lambda art, kind=kind, symbol=symbol: art['mosaic'][kind][5].__setitem__(
                7, symbol + art['mosaic'][kind][5][7][-4:])
        for name, change in changes.items():
            with self.subTest(change=name):
                art = json.loads(json.dumps(stored))
                change(art)
                self.assertFalse(generator.fresh(art, drawn, pixels, samples))

    def test_the_card_is_the_same_in_any_locale(self):
        # Bash slices strings by character only in a UTF-8 locale, so nothing
        # that draws the card may slice a string holding block symbols.
        body = CARD_TEXT + ''.join(f'voco_ui_card_at {t} {s}\ncard_text\n' for t, s in
                                   ((0, -1), (330, -1), (600, -1), (1300, -1), (1300, 140)))
        for mode in self.MODES:
            with self.subTest(mode=mode):
                drawn = [self.drawn(body, mode, motion=True, LC_ALL=locale)[0] for locale in ('C', 'C.UTF-8')]
                self.assertEqual(drawn[0], drawn[1])
                self.assertIn('▀', drawn[0])

    def test_bash_and_the_apt_display_draw_the_same_card(self):
        apt_ui = load('apt_ui', APT_UI)
        for mode in self.MODES:
            with self.subTest(mode=mode):
                card, shine = apt_card(mode)
                drawn, left, place = self.drawn(CARD_TEXT + 'voco_ui_card\ncard_text\n', mode)
                self.assertEqual(len(left), 11)
                self.assertEqual(drawn, card_text(apt_ui.card_rows(card, shine)))
                self.assertEqual(bool(place), mode == 'kitty')
                for moment in (0, 140, 279):
                    lit, _, _ = self.drawn(CARD_TEXT + f'voco_ui_card_at "$VOCO_UI_INTRO_MS" {moment}\ncard_text\n',
                                           mode, motion=True)
                    self.assertEqual(lit, card_text(apt_ui.card_rows(card, shine, moment)))

    def test_every_intro_frame_keeps_the_card_inside_its_canvas(self):
        times = (0, 40, 120, 240, 330, 480, 600, 840, 900, 1000, 1100, 1200, 1300)
        body = CARD_TEXT + ''.join(f'voco_ui_card_at {t} {s}\ncard_text\n'
                                   f'printf "%s##\\n" "${{VOCO_UI_PLACE[VOCO_UI_CARD_REVEAL]:-}}"\n'
                                   for t in times for s in (-1, 100))
        for mode in self.MODES:
            with self.subTest(mode=mode):
                text, mic, _ = self.drawn(body, mode, motion=True)
                frames = text.split('##\n')[:-1]
                self.assertEqual(len(frames), len(times) * 2)
                for index, frame in enumerate(frames):
                    t = times[index // 2]
                    *lines, after = frame.split('\n')
                    self.assertEqual(len(lines), 13)
                    for line in lines:
                        self.assertTrue(line.startswith('\r\x1b[K  ') and line.endswith('\x1b[0m'), repr(line))
                        self.assertLessEqual(len(visible(line.replace('\r', ''))), 60, repr(line))
                    # The sweep reveals the microphone cell by cell: a mosaic's
                    # cells, or the image placed over just the cells it passed.
                    swept = 14 if t >= 480 else max(0, min(14, t * 59 // 480 - 3))
                    commands = kitty_commands(after)
                    self.assertEqual(visible(after), '')
                    if mode == 'kitty':
                        self.assertEqual(int(commands[0][0]['c']) if commands else 0, swept, t)
                        self.assertLessEqual(len(commands), 1)
                    else:
                        self.assertEqual(commands, [])
                        self.assertEqual(all(mic[r] in lines[r + 1] for r in range(11)), swept == 14, t)
                plain = [visible(frame) for frame in frames]
                self.assertNotIn('The voice', plain[times.index(840) * 2])
                self.assertIn('The voice layer for Linux.', plain[-2])
                self.assertIn('Today: private dictation.', plain[-2])

    def frames(self, mode, times, whole, extra=''):
        """Canvas frames at each of TIMES into the intro, on a steady clock, each
        drawn in full when WHOLE or else redrawing only what changed."""
        body = ('printf -v reserve "%*s" 21 ""\nprintf "%s" "${reserve// /$\'\\n\'}"\n'
                'voco_ui_now_ms() { VOCO_UI_NOW=$FAKE_NOW; }\nVOCO_UI_INTRO_START=1000\n' + extra +
                ''.join(f'FAKE_NOW={1000 + t}\n{"voco_ui_forget" if whole else ":"}\n'
                        "voco_ui_frame 'Getting your desktop ready.' 'Checking your system.' '—'\nprintf '@@'\n"
                        for t in times))
        output = self.bash(body, art=mode).split('@@CONFIGURED@@\n', 1)[1]
        return output.split('@@')[:-1]

    def test_redrawing_only_what_changed_leaves_the_same_screen(self):
        times = list(range(0, 1500, 33)) + [1500, 1500]
        for mode in ('octant', 'kitty'):
            with self.subTest(mode=mode):
                changed, whole = self.frames(mode, times, False), self.frames(mode, times, True)
                self.assertEqual(len(changed), len(times))
                left, right = Screen(), Screen()
                for t, a, b in zip(times, changed, whole):
                    left.feed(a)
                    right.feed(b)
                    self.assertEqual(left.cells(), right.cells(), f'{mode} at {t} ms')
                self.assertLess(sum(map(len, changed)), sum(map(len, whole)) / 2)
                # At rest the card isn't built again, and nothing else changed, so
                # the frame only moves the cursor past the progress lines.
                self.assertEqual(changed[-1], '\x1b[8A' + '\n' * 8)

    def test_once_the_microphone_shows_only_the_rest_of_its_rows_is_drawn(self):
        times = [0, 33, 66, 100, 133, 166, 200, 300, 400, 600, 900]
        frames = self.frames('kitty', times, False)
        for t, frame in zip(times, frames):
            placed = [keys for keys, _ in kitty_commands(frame) if keys.get('a') == 'p']
            rows = frame.split('\n')[1:12]
            if t >= 200:
                # By 166 ms the sweep is past it: its cells and the image over
                # them stay as they are.
                self.assertEqual(placed, [], t)
                self.assertFalse(any(row.startswith('\r\x1b[K') for row in rows), t)
            else:
                self.assertEqual(len(placed), 1 if t >= 33 else 0, t)

    def test_after_another_process_drew_the_next_frame_is_whole(self):
        output = self.bash('VOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_ui_init\nvoco_ui_settle\nvoco_ui_begin first detail\n'
                           'voco_ui_sweep second detail\nsleep .1\nvoco_ui_pause\nprintf "@@AFTER@@"\n'
                           "voco_ui_frame second detail '—'\nvoco_ui_close\n").split('@@AFTER@@')[1]
        self.assertEqual(output.count('\r\x1b[K'), 21, repr(output[:200]))

    def test_the_intro_ends_and_reduced_motion_never_starts_it(self):
        moving = self.bash('voco_ui_now_ms\nVOCO_UI_INTRO_START=$VOCO_UI_NOW\n'
                           'voco_ui_animating && printf moving\nsleep 1.4\nvoco_ui_animating || printf rested\n')
        self.assertIn('moving', moving)
        self.assertIn('rested', moving)
        still = self.bash('voco_ui_now_ms\nVOCO_UI_INTRO_START=$VOCO_UI_NOW\nVOCO_UI_SHINE_START=$VOCO_UI_NOW\n'
                          'voco_ui_animating || printf still\n', motion=False)
        self.assertIn('still', still)

    def test_interrupting_the_intro_leaves_a_clean_terminal(self):
        for mode in ('quadrant', 'kitty'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as folder:
                env = art_env(folder, VOCO_INSTALL_NO_MOTION='0', VOCO_INSTALL_ART=mode)
                body = ('VOCO_TERMINAL_COLUMNS=80\nVOCO_TERMINAL_ROWS=24\nvoco_ui_init\n'
                        'voco_ui_sweep First detail\nprintf "%s" "$VOCO_UI_PID" > "$TMPDIR/animator"\n'
                        'sleep .3\nkill -INT $$\nsleep 2\n')
                code, output = terminal(['bash', '-c', PREFIX + body], env)
                self.assertEqual(code, 130, output)
                # Every frame is whole, so the terminal is left with its own colours,
                # and no kitty command is left open.
                sgr = re.findall(rb'\x1b\[[0-9;]*m', output)
                self.assertTrue(sgr and sgr[-1] == b'\x1b[0m', sgr[-3:])
                for command in output.split(b'\x1b_G')[1:]:
                    self.assertIn(b'\x1b\\', command)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int((Path(folder) / 'animator').read_text()), 0)

    def test_a_resting_card_is_not_drawn_again(self):
        for mode in ('quadrant', 'kitty'):
            with self.subTest(mode=mode):
                output = self.bash('VOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_ui_init\nvoco_ui_begin test detail\n'
                                   'printf "@@PROGRESS@@"\nvoco_ui_frame test detail "—" progress\nvoco_ui_close\n',
                                   motion=False, art=mode).split('@@CONFIGURED@@\n', 1)[1]
                # One full canvas, then only the eight progress lines.
                self.assertEqual(output.count('\x1b[21A'), 1)
                self.assertEqual(output.count('\x1b[8A'), 1)
                self.assertEqual(visible(output).count(TOP_EDGE), 1)
                full, progress = output.split('@@PROGRESS@@')
                placed = [keys for keys, _ in kitty_commands(full) if keys.get('a') == 'p']
                self.assertEqual(len(placed), 1 if mode == 'kitty' else 0)
                self.assertEqual(kitty_commands(progress), [])

    def test_each_mosaic_uses_only_the_symbols_its_terminals_draw(self):
        generator = load('installer_art', ROOT / 'scripts/generate-installer-art.py')
        for mode in ('octant', 'sextant', 'quadrant'):
            with self.subTest(mode=mode):
                text, mic, place = self.drawn(CARD_TEXT + 'voco_ui_card\ncard_text\n', mode)
                self.assertEqual(place, '')
                self.assertNotIn('\x1b_G', text)
                symbols = set(generator.symbols(mode)) | {' '}
                for row in mic:
                    cells = visible(row)[2:]
                    self.assertEqual(len(cells), 14, repr(row))
                    self.assertLessEqual(set(cells), symbols)
                for line in text.split('\n')[:-1]:
                    self.assertEqual(len(visible(line.replace('\r', ''))), 60)
                if mode == 'quadrant':
                    # Block elements only, which every terminal font has.
                    self.assertTrue(all(char == ' ' or '▀' <= char <= '▟' for row in mic for char in visible(row)))

    def test_the_image_is_sent_once_in_quiet_chunks(self):
        output = self.bash('printf "@@DONE@@"\n', art='kitty', motion=False)
        sent, after = output.split('@@CONFIGURED@@\n', 1)
        commands = kitty_commands(sent)
        self.assertEqual(kitty_commands(after), [])
        self.assertEqual([keys.get('a') for keys, _ in commands], ['t'] + [None] * (len(commands) - 1))
        first = commands[0][0]
        self.assertEqual({key: first[key] for key in ('a', 't', 'f', 'i', 'q')},
                         {'a': 't', 't': 'd', 'f': '100', 'i': '8626', 'q': '2'})
        self.assertTrue(all(keys.get('q') == '2' for keys, _ in commands))
        self.assertEqual([keys['m'] for keys, _ in commands], ['1'] * (len(commands) - 1) + ['0'])
        self.assertTrue(all(len(payload) <= 4096 for _, payload in commands))
        stored = json.loads((ROOT / 'scripts/lib/install-brand.json').read_text())['art']['image']['png']
        self.assertEqual(''.join(payload for _, payload in commands), stored)
        self.assertTrue(base64.b64decode(stored).startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertEqual(visible(sent).strip(), '')

    def test_the_image_fills_the_microphone_cells_without_stretching(self):
        image = json.loads((ROOT / 'scripts/lib/install-brand.json').read_text())['art']['image']
        left, top, width, height = image['mic']
        # Unknown cells, then HiDPI, ordinary, small, narrow and wide fonts.
        for cell in (None, (18, 38), (10, 21), (9, 17), (8, 20), (12, 20)):
            with self.subTest(cell=cell):
                answer = b'\x1b_Gi=8626;OK\x1b\\' + (b'\x1b[6;%d;%dt' % (cell[1], cell[0]) if cell else b'') + b'\x1b[?62;22c'
                output = self.bash('printf "@@%s@@" "${VOCO_UI_PLACE[*]:1}"\n', art=None, motion=False,
                                   reply=(b'\x1b[c', answer))
                places = output.split('@@CONFIGURED@@\n', 1)[1].split('@@')[1]
                commands = [keys for keys, _ in kitty_commands(places)]
                self.assertEqual(len(commands), 14)
                self.assertEqual([int(keys['c']) for keys in commands], list(range(1, 15)))
                for keys in commands:
                    self.assertEqual({key: keys[key] for key in ('a', 'i', 'p', 'r', 'C', 'q')},
                                     {'a': 'p', 'i': '8626', 'p': '1', 'r': '11', 'C': '1', 'q': '2'})
                full = {key: int(commands[-1][key]) for key in 'xywh'}
                cw, ch = cell or (1, 2)
                # The crop has the shape of 14 × 11 cells, within a pixel.
                self.assertLessEqual(abs(full['w'] - full['h'] * 14 * cw / (11 * ch)), 1.0, full)
                self.assertTrue(full['x'] <= left and full['y'] <= top and full['x'] + full['w'] >= left + width
                                and full['y'] + full['h'] >= top + height, full)
                self.assertTrue(full['x'] >= 0 and full['y'] >= 0 and full['x'] + full['w'] <= image['width']
                                and full['y'] + full['h'] <= image['height'], full)
                # Partly revealed, it keeps the same scale.
                for keys in commands:
                    self.assertLessEqual(abs(int(keys['w']) - full['w'] * int(keys['c']) / 14), 1.0)
                self.assertIn('\x1b7\x1b[12A\x1b[5G', places)
                self.assertTrue(places.endswith('\x1b\\\x1b8'))

    def test_releasing_the_canvas_takes_the_image_away_first(self):
        output = self.bash('VOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_ui_init\nvoco_ui_begin test detail\nvoco_ui_release\n',
                           art='kitty', motion=False).split('@@CONFIGURED@@\n', 1)[1]
        removal = '\x1b_Ga=d,d=i,i=8626,p=1,q=2\x1b\\'
        self.assertEqual(output.count(removal), 1)
        before, after = output.split(removal)
        self.assertIn('a=p,i=8626,p=1', before)
        self.assertTrue(after.startswith('\x1b[21A' + '\r\x1b[K\n' * 21), repr(after[:40]))

    def test_the_apt_display_places_and_removes_the_image(self):
        card, shine = apt_card('kitty')
        lines = card.split('\n')
        # Rows marked M, so the test can find them.
        card = '\n'.join(lines[:1] + [line.replace(' ', 'M', 16) if r < 11 else line for r, line in enumerate(lines[1:])])
        place = '\x1b7\x1b[12A\x1b[5G\x1b_Ga=p,i=8626,p=1,c=14,r=11,C=1,q=2\x1b\\\x1b8'
        removal = '\x1b_Ga=d,d=i,i=8626,p=1,q=2\x1b\\'
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'apt.log').touch(mode=0o600)
            command = ['bash', '-c', '({ printf "pmstatus:voco:20:Unpacking\\n"; sleep .2; printf "Confirm package option: "; }) | '
                       '/usr/bin/python3 "$1" "$2" true joined 2026.0.62 21 "$3" "$4" "$5" "$6"',
                       'fixture', str(APT_UI), str(Path(folder) / 'apt.log'), card, shine, place, removal]
            code, output = terminal(command, {**os.environ, 'TERM': 'xterm-256color'}, columns=64, rows=24)
        self.assertEqual(code, 0, output)
        text = output.decode().replace('\r\n', '\n')
        card = text.index('\x1b[21A')
        # The image follows the card's thirteen lines and comes off before the canvas does.
        lines = text[card:].split('\n')
        self.assertTrue(lines[13].startswith(place), repr(lines[13][:80]))
        self.assertTrue(all('M' * 14 in visible(lines[r]) for r in range(1, 12)))
        # The next frame changes the mark and the detail, so it redraws only those lines.
        later = text[card + 1:].split('\x1b[8A', 1)[1].split('\x1b_Ga=d', 1)[0]
        self.assertEqual(later.count('\r\x1b[K'), 2, repr(later))
        self.assertNotIn(place, later)
        self.assertIn(removal + '\x1b[21A' + '\r\x1b[K\n' * 21, text)
        self.assertIn('Confirm package option: ', text)

    def test_the_probe_reads_answers_without_echoing_them(self):
        cases = {
            'ghostty': (GHOSTTY, {}, ('kitty', 'kitty', (18, 38))),
            'vte 0.84': (VTE, {'VTE_VERSION': '8402'}, ('octant', 'none', (0, 0))),
            'vte 0.76': (VTE, {'VTE_VERSION': '7602'}, ('sextant', 'none', (0, 0))),
            'text area only': (b'\x1b[4;912;1440t\x1b[?62;4c', {}, ('quadrant', 'none', (18, 38))),
            'kitty error': (b'\x1b_Gi=8626;ENOTSUPPORTED:no\x1b\\\x1b[?62;22c', {}, ('quadrant', 'none', (0, 0))),
        }
        for name, (answer, extra, expected) in cases.items():
            with self.subTest(terminal=name):
                result, output = self.probe(answer, **extra)
                self.assertEqual((result['mode'], result['graphics'], result['cell']), expected)
                self.assertEqual(result['terminal'], 'same')
                self.assertLess(result['ms'], 150)
                self.assertIn(QUERY, output)
                # Echo would show the answers, their escapes as ^[.
                self.assertNotIn(b'^[', output)
                for part in ('62;22c', '65;1;9c', ';OK', 'ENOTSUPPORTED', '912;1440'):
                    self.assertNotIn(part, visible(output.decode()))

    def test_the_probe_gives_up_quickly_without_an_answer(self):
        for name, answer in (('silent', None), ('endless', b'x' * 4000)):
            with self.subTest(terminal=name):
                result, _ = self.probe(answer)
                self.assertEqual((result['mode'], result['graphics']), ('quadrant', 'none'))
                self.assertEqual(result['terminal'], 'same')
                self.assertGreaterEqual(result['ms'], 150 if name == 'silent' else 0)
                self.assertLess(result['ms'], 700)

    def test_the_probe_only_asks_for_the_card(self):
        cases = {'plain': {'VOCO_INSTALL_PLAIN': '1'}, 'no colour': {'NO_COLOR': '1'}, 'dumb': {'TERM': 'dumb'},
                 'no truecolor': {'COLORTERM': ''}, 'ssh': {'SSH_CONNECTION': '192.0.2.1 50000 192.0.2.2 22'},
                 'forced mosaic': {'VOCO_INSTALL_ART': 'quadrant'}, 'text': {'VOCO_INSTALL_ART': 'text'}}
        for name, extra in cases.items():
            with self.subTest(case=name):
                result, output = self.probe(GHOSTTY, **extra)
                self.assertNotIn(QUERY, output)
                self.assertNotEqual(result['mode'], 'kitty')
        with tempfile.TemporaryDirectory() as folder:
            with self.subTest(case='short terminal'):
                code, output = terminal(['bash', '-c', PREFIX + 'VOCO_TERMINAL_COLUMNS=80\nVOCO_TERMINAL_ROWS=22\n'
                                         'voco_ui_configure\nprintf "LINES=%s\\n" "$VOCO_UI_LINES"\n'],
                                        art_env(folder), reply=(b'\x1b[c', GHOSTTY), rows=22)
                self.assertEqual(code, 0, output)
                self.assertIn(b'LINES=10', output)
                self.assertNotIn(QUERY, output)
            with self.subTest(case='background job'):
                start = time.monotonic()
                code, output = terminal(['bash', '-c', PREFIX + 'set -m\n(VOCO_TERMINAL_COLUMNS=80 VOCO_TERMINAL_ROWS=24 '
                                         'voco_ui_configure; printf "BACKGROUND %s\\n" "$VOCO_UI_MIC_MODE") &\nwait $!\n'],
                                        art_env(folder), reply=(b'\x1b[c', GHOSTTY))
                self.assertEqual(code, 0, output)
                self.assertIn(b'BACKGROUND quadrant', output)
                self.assertNotIn(QUERY, output)
                self.assertLess(time.monotonic() - start, 3)
            with self.subTest(case='no terminal'):
                run = subprocess.run(['bash', '-c', PREFIX + 'VOCO_TERMINAL_COLUMNS=80 VOCO_TERMINAL_ROWS=24\n'
                                      'voco_ui_configure\nprintf "MODE=%s" "$VOCO_UI_MIC_MODE"\n'],
                                     env=art_env(folder), capture_output=True, start_new_session=True, timeout=5)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual(run.stdout, b'MODE=')

    def test_inside_tmux_or_screen_only_an_answer_brings_the_image(self):
        for name, extra in (('tmux', {'TMUX': '/tmp/tmux-1000/default,4242,0'}), ('screen', {'STY': '4242.pts-0.host'}),
                            ('screen term', {'TERM': 'screen-256color'})):
            with self.subTest(multiplexer=name):
                result, _ = self.probe(VTE, VTE_VERSION='8402', **extra)
                self.assertEqual(result['mode'], 'quadrant')
                result, _ = self.probe(GHOSTTY, **extra)
                self.assertEqual(result['mode'], 'kitty')

    def test_the_mosaic_follows_what_the_terminal_draws(self):
        # VTE draws sextants from 0.64 and octants from 0.78.
        cases = [({'VTE_VERSION': '8402'}, 'octant'), ({'VTE_VERSION': '7800'}, 'octant'),
                 ({'VTE_VERSION': '7602'}, 'sextant'), ({'VTE_VERSION': '6400'}, 'sextant'),
                 ({'VTE_VERSION': '6200'}, 'quadrant'), ({'VTE_VERSION': 'unknown'}, 'quadrant'),
                 ({'TERM_PROGRAM': 'ghostty'}, 'sextant'), ({'TERM_PROGRAM': 'WezTerm'}, 'sextant'),
                 ({'TERM': 'xterm-kitty'}, 'sextant'), ({'TERM': 'foot'}, 'sextant'),
                 ({'VTE_VERSION': '8402', 'TMUX': '/tmp/tmux-1000/default,1,0'}, 'quadrant'),
                 ({'VTE_VERSION': '8402', 'TERM': 'tmux-256color'}, 'quadrant'), ({}, 'quadrant')]
        with tempfile.TemporaryDirectory() as folder:
            for hints, expected in cases:
                with self.subTest(hints=hints):
                    run = subprocess.run(['bash', '-c', PREFIX + 'voco_ui_mosaic\nprintf "%s" "$VOCO_UI_MIC_MODE"\n'],
                                         env=art_env(folder, **hints), capture_output=True, timeout=5)
                    self.assertEqual(run.stdout.decode(), expected, run.stderr)

    def test_an_interrupted_probe_gives_the_terminal_its_settings_back(self):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))

        def own_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        with tempfile.TemporaryDirectory() as folder:
            body = '(sleep .08; kill -INT $$) &\nVOCO_TERMINAL_COLUMNS=80\nVOCO_TERMINAL_ROWS=24\nvoco_ui_configure\nprintf "NOT REACHED\\n"\n'
            process = subprocess.Popen(['bash', '-c', PREFIX + body], stdin=slave, stdout=slave, stderr=slave,
                                       env=art_env(folder), preexec_fn=own_terminal)
            output = bytearray()
            try:
                deadline = time.monotonic() + 5
                while process.poll() is None and time.monotonic() < deadline:
                    if select.select([master], [], [], .02)[0]:
                        output += os.read(master, 65536)
                self.assertEqual(process.wait(timeout=2), 130, output)
                flags = termios.tcgetattr(slave)[3]
                self.assertTrue(flags & termios.ECHO and flags & termios.ICANON)
                self.assertIn(QUERY, output)
                self.assertNotIn(b'NOT REACHED', output)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                os.close(master)
                os.close(slave)


if __name__ == '__main__':
    unittest.main()
