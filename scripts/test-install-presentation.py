#!/usr/bin/env python3
"""Exercise the real download UI against localhost; never install a package."""
import fcntl
import hashlib
import http.server
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import threading
import time

PAYLOAD = bytes(range(256)) * 8192
ranges = []


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/missing':
            self.send_error(404)
            return
        offset = int(self.headers.get('Range', 'bytes=0-')[6:].split('-')[0])
        ranges.append(offset)
        self.send_response(206 if offset else 200)
        if offset:
            self.send_header('Content-Range', f'bytes {offset}-{len(PAYLOAD)-1}/{len(PAYLOAD)}')
        self.send_header('Content-Length', str(len(PAYLOAD) - offset))
        self.end_headers()
        try:
            for start in range(offset, len(PAYLOAD), 131072):
                self.wfile.write(PAYLOAD[start:start+131072])
                self.wfile.flush()
                time.sleep(.09)
        except (BrokenPipeError, ConnectionResetError):
            pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
source = (Path(__file__).resolve().parent.parent / 'install').read_text()
prefix = source.split('# ─── Header', 1)[0]
body = '''
VOCO_TERMINAL_COLUMNS="$3"
VOCO_DOWNLOAD_DIR=$(mktemp -d)
if [[ "$4" == resume ]]; then head -c 262144 "$5" > "$VOCO_DOWNLOAD_DIR/package"; fi
voco_download "VOCO download" "$VOCO_DOWNLOAD_DIR/package" "$1"
sha256sum "$VOCO_DOWNLOAD_DIR/package"
'''

try:
    with tempfile.TemporaryDirectory(prefix='voco-presentation-test-') as folder:
        root = Path(folder)
        payload = root / 'payload'
        payload.write_bytes(PAYLOAD)
        for case in ['tty', 'narrow', 'redirected', 'no-color', 'dumb', 'failure', 'connection-failure', 'resume', 'cancel']:
            case_dir = root / case
            case_dir.mkdir()
            env = {**os.environ, 'TMPDIR': str(case_dir), 'TERM': 'xterm-256color'}
            env.pop('NO_COLOR', None)
            if case == 'no-color':
                env['NO_COLOR'] = ''
            if case == 'dumb':
                env['TERM'] = 'dumb'
            url = f'http://127.0.0.1:{server.server_port}/' + ('missing' if case == 'failure' else 'package')
            if case == 'connection-failure':
                url = 'http://127.0.0.1:1/package'
            width = 40 if case == 'narrow' else 100
            cmd = ['bash', '-c', prefix + body, 'fixture', url, '', str(width), case, str(payload)]
            if case == 'redirected':
                result = subprocess.run(cmd, env=env, capture_output=True, timeout=15)
                data, code = result.stdout + result.stderr, result.returncode
            else:
                master, slave = pty.openpty()
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, width, 0, 0))
                process = subprocess.Popen(cmd, env=env, stdin=slave, stdout=slave, stderr=slave)
                os.close(slave)
                data = b''
                cancelled = False
                deadline = time.monotonic() + 15
                try:
                    while True:
                        if time.monotonic() > deadline:
                            raise TimeoutError(case)
                        if select.select([master], [], [], .05)[0]:
                            try:
                                chunk = os.read(master, 65536)
                            except OSError:
                                break
                            if not chunk:
                                break
                            data += chunk
                            if case == 'cancel' and b'received' in data and not cancelled:
                                process.send_signal(signal.SIGINT)
                                cancelled = True
                        elif process.poll() is not None:
                            break
                    code = process.wait(timeout=5)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    os.close(master)
            expected = 8 if case == 'failure' else 4 if case == 'connection-failure' else 130 if case == 'cancel' else 0
            assert code == expected, (case, code, data.decode(errors='replace'))
            if case not in ['failure', 'connection-failure', 'cancel']:
                assert hashlib.sha256(PAYLOAD).hexdigest().encode() in data, case
                assert re.search(rb'2\.0 MiB received .* \d+s', data), case
            if case in ['redirected', 'no-color', 'dumb']:
                assert b'\x1b' not in data, case
            if case == 'tty':
                assert b'MiB/s avg' in data and data.count(b'received') > 2, case
            if case == 'narrow':
                for frame in data.split(b'\r'):
                    if frame.startswith(b'\x1b[K'):
                        line = re.sub(rb'\x1b\[[0-9;]*[A-Za-z]', b'', frame).split(b'\n')[0]
                        assert len(line.decode()) < width, line
            if case == 'resume':
                assert 262144 in ranges, ranges
            files = list(case_dir.iterdir())
            if case in ['failure', 'connection-failure']:
                assert (b'This release file is unavailable.' if case == 'failure' else b'Check your connection and run the installer again.') in data
                assert len(files) == 1 and files[0].suffix == '.log', files
                assert files[0].stat().st_mode & 0o777 == 0o600
                if case == 'failure': assert '404' in files[0].read_text()
            else:
                assert not files, (case, files)
            print(f'PASS {case}', flush=True)
finally:
    server.shutdown()
    server.server_close()
