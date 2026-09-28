#!/usr/bin/python3
"""Test-only helpers bound inside the private GNOME namespace, never installed."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time

assert os.environ.get('VOCO_GNOME_CURSOR') == '1'
assert not any(Path(path).exists() for path in ('/dev/input', '/dev/uinput', '/dev/snd'))
root = Path(os.environ['HOME']).parent
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
with (root / 'evidence/cursor-helper-calls.jsonl').open('a') as out:
    out.write(json.dumps({'time': time.monotonic(), 'program': Path(sys.argv[0]).name,
                          'args': sys.argv[1:]}) + '\n')

if sys.argv[1:] == ['--fixture-daemon']:
    ctypes.CDLL(None).prctl(15, b'ydotoold', 0, 0, 0)
    while True:
        time.sleep(1)

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

def call(method, params=None):
    return bus.call_sync('org.gnome.Shell', '/org/voco/PrivateShellProbe',
        'org.voco.PrivateShellProbe', method, params, None,
        Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()

if Path(sys.argv[0]).name == 'wl-copy':
    text = sys.stdin.buffer.read(1024 * 1024 + 1).decode('utf-8')
    assert len(text.encode('utf-8')) <= 1024 * 1024
    call('SetClipboard', GLib.Variant('(s)', (text,)))
    sys.exit(0)

assert Path(sys.argv[0]).name == 'ydotool', sys.argv
if sys.argv[1:] == ['key', '--help']:
    print('Each key sequence accepts ctrl+Backspace')
    sys.exit(0)
assert sys.argv[1:6] == ['key', '--delay', '24', '--key-delay', '12'], sys.argv
chords = sys.argv[6:]
assert chords in (['ctrl+v'], [' ', 'ctrl+v'], ['ctrl+shift+v'], [' ', 'ctrl+shift+v']), chords
state = json.loads(call('GetInputState')[0])
with (root / 'evidence/cursor-input-dispatch.jsonl').open('a') as out:
    out.write(json.dumps({'time': time.monotonic(), 'keys': chords, 'input': state}) + '\n')
# Preserve the ordered joining Space and paste chord; deliberately do not clear
# physical modifiers. The production guard must prevent their collision.
subprocess.run(['/usr/bin/xdotool', 'key', '--delay', '24',
    *('space' if chord == ' ' else chord for chord in chords)],
    env={**os.environ, 'DISPLAY': ':77'}, check=True, timeout=5)
with (root / 'evidence/cursor-input-completed.jsonl').open('a') as out:
    out.write(json.dumps({'time': time.monotonic(), 'keys': chords,
                          'input': json.loads(call('GetInputState')[0])}) + '\n')
