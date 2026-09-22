#!/usr/bin/env python3
"""Render the real installer journey in a PTY with disposable package/desktop fixtures."""
import importlib.util
import os
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('performance', ROOT / 'scripts/test-install-performance.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def visible_terminal(data, width=80):
    """Small VT screen reader for the CSI sequences emitted by this installer.

    Keep scrollback: a stale frame is a failure even above the visible viewport.
    This does not discard earlier output when a later progress frame appears.
    """
    rows = [[]]
    row = column = 0
    tokens = re.split(r'(\x1b\[[0-9;?]*[A-Za-z])', data.decode('utf-8', 'replace'))
    for token in tokens:
        if token.startswith('\x1b['):
            command, amount = token[-1], token[2:-1]
            if command == 'm':
                continue
            if command == 'A':
                row = max(0, row - int(amount or '1'))
            elif command == 'K':
                if amount == '2':
                    rows[row] = []
                else:
                    rows[row] = rows[row][:column]
            else:
                raise AssertionError(f'Unsupported terminal operation: {token!r}')
            continue
        for char in token:
            if char == '\r':
                column = 0
            elif char == '\n':
                row += 1
                if row == len(rows):
                    rows.append([])
            elif char >= ' ':
                if column >= width:
                    row += 1
                    column = 0
                    if row == len(rows):
                        rows.append([])
                while len(rows[row]) <= column:
                    rows[row].append(' ')
                rows[row][column] = char
                column += 1
    return '\n'.join(''.join(line).rstrip() for line in rows)


class InstallerJourneyTests(unittest.TestCase):
    def run_journey(self, mode):
        source = (ROOT / 'install').read_text()
        prefix, body = source.split('# ─── Header', 1)
        with tempfile.TemporaryDirectory(prefix='voco-journey-') as folder:
            root = Path(folder)
            (root / 'sudo').write_text('#!/bin/bash\n[[ "$1" == -v || "$1" == -n ]] && exit 0\nexec "$@"\n')
            (root / 'apt-get').write_text('#!/bin/bash\nprintf "pmstatus:voco:80:Setting up\\n" >&3\nprintf "Setting up voco (fixture) ...\\n"\nsleep .15\n')
            if mode == 'password':
                (root / 'sudo').write_text('#!/bin/bash\nif [[ "$1" == -n && "$2" == -v ]]; then exit 1; fi\nif [[ "$1" == -v ]]; then printf "Fixture password: "; read -r answer; [[ "$answer" == fixture ]]; exit $?; fi\n[[ "$1" == -n ]] && exit 0\nexec "$@"\n')
            if mode == 'prompt':
                with (root / 'apt-get').open('a') as script:
                    script.write('printf "Fixture choice [y/N]: "\nread -r answer\n[[ "$answer" == yes ]] || exit 55\nprintf "\\nChoice accepted\\n"\n')
            for path in root.iterdir():
                path.chmod(0o755)
            stubs = r'''
            wget() {
              local target
              while (( $# )); do
                if [[ "$1" == -O ]]; then target="$2"; shift; fi
                shift
              done
              if [[ "$target" == *checksums.txt ]]; then
                printf fixture | sha256sum | sed "s/  -/  voco_${VERSION}_amd64.deb/" > "$target"
              else
                printf fixture > "$target"
              fi
            }
            voco_verify_installed_package() { return 0; }
            voco_start_helper_prefetch() { :; }
            voco_verify_desktop_input() { (( fixture_checks++ > 0 )); }
            fixture_checks=0
            voco_wayland_device_access() { return 0; }
            pgrep() { return 1; }
            systemctl() { printf 'Created symlink /synthetic/voco-ydotoold.service\n'; }
            fixture_panel() { printf 'Panel enabled. Sign out and back in to load it; saving your work first is recommended.\n'; return 1; }
            '''
            # All package, input and panel mutations terminate at synthetic seams.
            body = body.replace('/usr/bin/voco --setup-panel', 'fixture_panel')
            env = {**os.environ, 'TERM': 'xterm-256color', 'PATH': folder + ':' + os.environ['PATH'],
                   'TMPDIR': folder, 'HOME': str(root / 'home'), 'XDG_CONFIG_HOME': str(root / 'config'),
                   'XDG_SESSION_TYPE': 'wayland', 'XDG_CURRENT_DESKTOP': '', 'VOCO_INSTALL_NO_MOTION': '0' if mode == 'animated' else '1'}
            env.pop('NO_COLOR', None)
            if mode == 'plain':
                env['VOCO_INSTALL_PLAIN'] = '1'
            code, raw = fixture.terminal(['bash', '-c', prefix + stubs + '# ─── Header' + body], env, columns=40 if mode == 'narrow' else 80, rows=8 if mode == 'short' else 24, reply={'prompt': (b'Fixture choice [y/N]: ', b'yes\n'), 'password': (b'Fixture password: ', b'fixture\n')}.get(mode))
            self.assertEqual(code, 0, raw.decode(errors='replace'))
            screen = visible_terminal(raw, width=40 if mode == 'narrow' else 80)
            if directory := os.environ.get('VOCO_JOURNEY_EVIDENCE_DIR'):
                directory = str(Path(directory) / mode)
                Path(directory).mkdir(parents=True, exist_ok=True)
                (Path(directory) / 'journey.ansi').write_bytes(raw)
                (Path(directory) / 'journey.txt').write_text(screen)
            self.assertEqual(screen.count('V O C O' if mode not in ('plain', 'narrow', 'short') else 'VOCO · v'), 1, screen)
            if mode == 'password':
                self.assertIn('Fixture password: fixture', screen)
            if mode == 'prompt':
                self.assertIn('Fixture choice [y/N]: yes', screen)
                self.assertIn('Choice accepted', screen)
            self.assertNotIn('Created symlink', screen)
            self.assertNotIn('80%', screen)
            self.assertNotIn('[1/3]', screen)
            self.assertNotIn('██', screen)
            self.assertIn("Installed. Let's try your voice.", screen)
            self.assertIn('sign out', screen.lower())
            self.assertIn('Alt+D', screen)

    def test_complete_journey_has_one_final_canvas(self):
        for mode in ('animated', 'no-motion', 'password', 'prompt', 'plain', 'narrow', 'short'):
            with self.subTest(mode=mode):
                self.run_journey(mode)


if __name__ == '__main__':
    unittest.main()
