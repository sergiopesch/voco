#!/usr/bin/python3 -IS
"""Test-only /usr/bin/ydotool for the private GNOME Wayland delivery suites, never installed.

It answers the ydotool 1.x key interface. The keycode events of the one paste
gesture become the same ordered XTest events on the private Xvfb, which the
nested GNOME Shell forwards to its focused client. Held modifiers are not
cleared. --fixture-daemon names a process ydotoold for production's pgrep.
"""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time

started = time.monotonic()
assert not any(Path(path).exists() for path in ('/dev/input', '/dev/uinput', '/dev/snd'))
root = Path(os.environ['HOME']).parent
assert os.environ['XDG_RUNTIME_DIR'] == str(root/'runtime')
args = sys.argv[1:]
PASTE = ['key', '42:1', '110:1', '110:0', '42:0']
# Xvfb keycodes are the evdev codes plus 8, so each code has its X keysym.
KEYSYMS = {'42': 'Shift_L', '57': 'space', '110': 'Insert'}
HELP = """Usage: key [OPTION]... [KEYCODE:PRESSED]...
Emit key events.

Options:
  -d, --key-delay=N          Delay N milliseconds between key events
  -h, --help                 Display this help and exit

Each key event consists of a keycode and a key state (1 for pressed, 0 for released).
Syntax: <keycode>:<pressed>
"""


def log(**fields):
    with (root/'evidence/ydotool-calls.jsonl').open('a') as out:
        out.write(json.dumps({'start': started, 'args': args, **fields}) + '\n')


if args == ['--fixture-daemon']:
    log()
    ctypes.CDLL(None).prctl(15, b'ydotoold', 0, 0, 0)
    while True:
        time.sleep(1)
if args == ['key', '--help']:
    print(HELP, end='')
    log(end=time.monotonic(), status=0)
    sys.exit(0)
# Only the paste gesture, optionally led by the joining Space.
assert args in (PASTE, PASTE[:1] + ['57:1', '57:0'] + PASTE[1:]), args
chain = []
for event in args[1:]:
    code, pressed = event.split(':')
    # ydotool 1.x waits its 12 ms key delay after every event.
    chain += ['keydown' if pressed == '1' else 'keyup', '--delay', '0', KEYSYMS[code], 'sleep', '0.012']
keyboard = {name: value for name, value in os.environ.items() if name != 'XAUTHORITY'}
keyboard['DISPLAY'] = os.environ['VOCO_DELIVERY_KEYBOARD_DISPLAY']
sent = time.monotonic()
result = subprocess.run(['/usr/bin/xdotool', *chain], env=keyboard, stdin=subprocess.DEVNULL,
                        capture_output=True, text=True, timeout=5)
log(sent=sent, end=time.monotonic(), status=result.returncode, stderr=result.stderr[-2000:])
sys.exit(result.returncode)
