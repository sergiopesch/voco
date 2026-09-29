"""Paste one synthetic chunk into whatever has focus on the private desktop.

With VOCO_FIXTURE_PASTE_BINARY this runs production desktop_paste through its
ignored insertion.rs test. Otherwise it replays the same X11 helper commands:
xclip on DISPLAY, which is XWayland on gnome-wayland, and xdotool keys on the
private Xvfb. Usage: python3 focused-paste.py TEXT
"""
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PRODUCTION_TEST = 'insertion::tests::paste_fixture_text_into_the_focused_application'
# insertion.rs waits this long before the next copy so the previous recipient
# can read its selection. Each fixture paste is a new process, so wait here.
PASTE_SETTLE_S = .15


def replica(text):
    # paste_text: ASCII controls, including line endings, become spaces.
    routed = re.sub('[\x00-\x1f\x7f]', ' ', text)
    # desktop_paste_payload: a single joining space is sent as its own key.
    leading = len(routed) > 1 and routed[0] == ' ' and not routed[1].isspace()
    payload = routed[1:] if leading else routed
    for selection in ('clipboard', 'primary'):
        # Without -quiet, xclip forks and serves the selection it now owns.
        subprocess.run(['xclip', '-selection', selection, '-in'], input=payload.encode(),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=5)
    keyboard = {name: value for name, value in os.environ.items() if name != 'XAUTHORITY'}
    keyboard['DISPLAY'] = os.environ['VOCO_DELIVERY_KEYBOARD_DISPLAY']
    subprocess.run(['xdotool', 'key', '--clearmodifiers', *(['space'] if leading else []), 'shift+Insert'],
                   env=keyboard, check=True, timeout=5)


def production(binary, text):
    result = subprocess.run([binary, '--ignored', '--exact', PRODUCTION_TEST],
                            env={**os.environ, 'VOCO_FIXTURE_PASTE_TEXT': text},
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
    # libtest also exits 0 when its filter matches nothing.
    if result.returncode or 'test result: ok. 1 passed' not in result.stdout:
        sys.exit(f'Production paste failed:\n{result.stdout}{result.stderr}')


def main():
    assert os.environ.get('VOCO_DELIVERY_KEYBOARD_DISPLAY') == ':0' and not any(
        Path(path).exists() for path in ('/dev/input', '/dev/uinput')), 'Private fixture display required'
    text = sys.argv[1]
    binary = os.environ.get('VOCO_FIXTURE_PASTE_BINARY')
    if binary:
        production(binary, text)
    else:
        replica(text)
    time.sleep(PASTE_SETTLE_S)


if __name__ == '__main__':
    main()
