#!/usr/bin/env python3
"""Render the real installer journey in a PTY with disposable package/desktop fixtures."""
import importlib.util
import base64
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SIGNED_MANIFEST = ROOT / 'tests/fixtures/installer/voco.2026.0.54_checksums.txt'
SIGNED_SIGNATURE = ROOT / 'tests/fixtures/installer/voco.2026.0.54_checksums.txt.asc'
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
    def run_journey(self, mode, signature_case='valid', install_case='ready', launch_case='started'):
        source = (ROOT / 'install').read_text()
        prefix, body = source.split('# ─── Header', 1)
        # The signed .54 manifest includes KEYS. Use that small real release asset
        # as the synthetic package to exercise the production signature and hash gate.
        package_assignment = 'DEB_FILE="${VOCO_DOWNLOAD_DIR}/voco_${VERSION}_amd64.deb"'
        self.assertIn(package_assignment, body)
        body = body.replace(package_assignment, 'DEB_FILE="${VOCO_DOWNLOAD_DIR}/KEYS"', 1)
        with tempfile.TemporaryDirectory(prefix='voco-journey-') as folder:
            root = Path(folder)
            (root / 'sudo').write_text('#!/bin/bash\n[[ "$1" == -v || "$1" == -n ]] && exit 0\nexec "$@"\n')
            (root / 'apt-get').write_text('#!/bin/bash\nprintf called > "$FIXTURE_APT_CALL"\n[[ "$FIXTURE_INSTALL_CASE" == package-failure ]] && exit 42\nprintf "pmstatus:voco:80:Setting up\\n" >&3\nprintf "Setting up voco (fixture) ...\\n"\nsleep .15\n')
            if mode == 'password':
                (root / 'sudo').write_text('#!/bin/bash\nif [[ "$1" == -n && "$2" == -v ]]; then exit 1; fi\nif [[ "$1" == -v ]]; then printf "Fixture password: "; read -r answer; [[ "$answer" == fixture ]]; exit $?; fi\n[[ "$1" == -n ]] && exit 0\nexec "$@"\n')
            if mode == 'prompt':
                with (root / 'apt-get').open('a') as script:
                    script.write('printf "Fixture choice [y/N]: "\nread -r answer\n[[ "$answer" == yes ]] || exit 55\nprintf "\\nChoice accepted\\n"\n')
            for path in root.iterdir():
                path.chmod(0o755)
            stubs = r'''
            if [[ "$FIXTURE_SIGNATURE_CASE" == wrong-fingerprint ]]; then
              VOCO_RELEASE_KEY_FINGERPRINT=0000000000000000000000000000000000000000
            fi
            wget() {
              local target
              while (( $# )); do
                if [[ "$1" == -O ]]; then target="$2"; shift; fi
                shift
              done
              case "$target" in
                *checksums.txt.asc)
                  case "$FIXTURE_SIGNATURE_CASE" in
                    missing) return 8 ;;
                    invalid) printf invalid > "$target" ;;
                    *) cp "$FIXTURE_SIGNATURE" "$target" ;;
                  esac
                  ;;
                *checksums.txt)
                  if [[ "$FIXTURE_SIGNATURE_CASE" == swapped ]]; then
                    printf replacement | sha256sum | sed 's/  -/  KEYS/' > "$target"
                  else
                    cp "$FIXTURE_MANIFEST" "$target"
                  fi
                  ;;
                *)
                  if [[ "$FIXTURE_SIGNATURE_CASE" == swapped || "$FIXTURE_SIGNATURE_CASE" == checksum-mismatch ]]; then
                    printf replacement > "$target"
                  else
                    cp "$FIXTURE_PACKAGE" "$target"
                  fi
                  ;;
              esac
            }
            voco_verify_installed_package() { return 0; }
            /usr/bin/voco() { [[ "$*" == --setup-desktop-input ]]; }
            voco_start_helper_prefetch() { :; }
            voco_verify_desktop_input() {
              [[ "$FIXTURE_INSTALL_CASE" != readiness-failure ]] && (( fixture_checks++ > 0 ))
            }
            fixture_checks=0
            voco_wayland_device_access() { return 0; }
            pgrep() { return 1; }
            systemctl() { printf 'Created symlink /synthetic/voco-ydotoold.service\n'; }
            fixture_panel() { printf 'Panel enabled. Sign out and back in to load it; saving your work first is recommended.\n'; return 1; }
            voco_launch_installed_app() {
              printf 'launch\n' >> "$FIXTURE_LAUNCH_CALL"
              case "$FIXTURE_LAUNCH_CASE" in
                skipped) printf 'Open VOCO from your desktop session.\n'; return 2 ;;
                failed) printf 'VOCO did not open automatically. Run /usr/bin/voco from your desktop.\n'; return 1 ;;
              esac
            }
            '''
            # Package, input, panel and app activation terminate at synthetic seams.
            body = body.replace('/usr/bin/voco --setup-panel', 'fixture_panel')
            env = {**os.environ, 'TERM': 'xterm-256color', 'PATH': folder + ':' + os.environ['PATH'],
                   'TMPDIR': folder, 'HOME': str(root / 'home'), 'XDG_CONFIG_HOME': str(root / 'config'),
                   'XDG_SESSION_TYPE': 'wayland', 'XDG_CURRENT_DESKTOP': '', 'VOCO_INSTALL_NO_MOTION': '0' if mode == 'animated' else '1',
                   'FIXTURE_SIGNATURE_CASE': signature_case, 'FIXTURE_SIGNATURE': str(SIGNED_SIGNATURE),
                   'FIXTURE_INSTALL_CASE': install_case, 'FIXTURE_LAUNCH_CASE': launch_case,
                   'FIXTURE_MANIFEST': str(SIGNED_MANIFEST), 'FIXTURE_PACKAGE': str(ROOT / 'KEYS'),
                   'FIXTURE_APT_CALL': str(root / 'apt-called'), 'FIXTURE_LAUNCH_CALL': str(root / 'launch-called')}
            env.pop('NO_COLOR', None)
            if mode == 'plain':
                env['VOCO_INSTALL_PLAIN'] = '1'
            code, raw = fixture.terminal(['bash', '-c', prefix + stubs + '# ─── Header' + body], env, columns=40 if mode == 'narrow' else 80, rows=8 if mode == 'short' else 24, reply={'prompt': (b'Fixture choice [y/N]: ', b'yes\n'), 'password': (b'Fixture password: ', b'fixture\n')}.get(mode))
            expected_code = 1 if signature_case != 'valid' or install_case == 'package-failure' else 2 if install_case == 'readiness-failure' else 0
            self.assertEqual(code, expected_code, raw.decode(errors='replace'))
            self.assertEqual((root / 'apt-called').exists(), signature_case == 'valid')
            launched = root / 'launch-called'
            self.assertEqual(launched.read_text() if launched.exists() else '', 'launch\n' if expected_code == 0 else '')
            if signature_case != 'valid':
                self.assertIn('nothing was installed', raw.decode(errors='replace').lower())
                return
            if install_case != 'ready':
                self.assertNotIn('Opening VOCO', raw.decode(errors='replace'))
                return
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
            if launch_case == 'started':
                self.assertIn('Opening VOCO', screen)
                self.assertNotIn('Open VOCO →', screen)
            else:
                self.assertNotIn('Opening VOCO', screen)
                self.assertIn('desktop', screen)

    def test_package_and_readiness_failures_never_launch(self):
        for case in ('package-failure', 'readiness-failure'):
            with self.subTest(case=case):
                self.run_journey('plain', install_case=case)

    def test_skipped_or_failed_launch_keeps_successful_installation(self):
        for mode in ('animated', 'plain'):
            for case in ('skipped', 'failed'):
                with self.subTest(mode=mode, case=case):
                    self.run_journey(mode, launch_case=case)

    def test_pinned_key_verifies_published_release_manifest(self):
        source = (ROOT / 'install').read_text()
        encoded = re.search(r"^VOCO_RELEASE_KEY_BASE64='([^']+)'$", source, re.M)
        self.assertIsNotNone(encoded)
        key = base64.b64decode(encoded.group(1), validate=True)
        self.assertEqual(hashlib.sha256(SIGNED_MANIFEST.read_bytes()).hexdigest(),
                         'e83a9179db79e31c596fa5d29bbcf53e10ad97925a7ddd65f5d8b96f578b189a')
        self.assertEqual(hashlib.sha256(SIGNED_SIGNATURE.read_bytes()).hexdigest(),
                         '3cdeafa1bee0278d32ac20c9e20490793282a7f5075dbc6a72aefe55d0a2470a')
        self.assertEqual(hashlib.sha256((ROOT / 'KEYS').read_bytes()).hexdigest(),
                         '07508ad865b366b25577b1ba3be3741017ec12f1c5e6e0a26455c777956a28a9')
        dearmored = subprocess.run(['gpg', '--dearmor'], input=(ROOT / 'KEYS').read_bytes(),
                                   capture_output=True, check=True).stdout
        self.assertEqual(key, dearmored)
        with tempfile.TemporaryDirectory(prefix='voco-release-key-test-') as folder:
            keyring = Path(folder) / 'release-keyring.gpg'
            keyring.write_bytes(key)
            result = subprocess.run(['gpgv', '--keyring', str(keyring), str(SIGNED_SIGNATURE), str(SIGNED_MANIFEST)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('B33C7C6AAEC8C20433A7A837540796453D8E3865', result.stderr)

    def test_invalid_release_metadata_never_reaches_apt(self):
        for signature_case in ('swapped', 'missing', 'invalid', 'wrong-fingerprint', 'checksum-mismatch'):
            with self.subTest(signature_case=signature_case):
                self.run_journey('plain', signature_case)

    def test_complete_journey_has_one_final_canvas(self):
        for mode in ('animated', 'no-motion', 'password', 'prompt', 'plain', 'narrow', 'short'):
            with self.subTest(mode=mode):
                self.run_journey(mode)


if __name__ == '__main__':
    unittest.main()
