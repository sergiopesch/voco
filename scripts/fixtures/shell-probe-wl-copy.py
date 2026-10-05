#!/usr/bin/python3
"""Test-only /usr/bin/wl-copy for the private GNOME cursor suite, never installed.

GNOME has no data-control protocol, and wl-copy's focus-taking surface can stall
there, so this sets the selection through the private Shell probe instead.
"""
import json
import os
from pathlib import Path
import sys
import time

assert os.environ.get('VOCO_GNOME_CURSOR') == '1' and Path(sys.argv[0]).name == 'wl-copy', sys.argv
assert not any(Path(path).exists() for path in ('/dev/input', '/dev/snd'))
root = Path(os.environ['HOME']).parent
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
with (root / 'evidence/cursor-helper-calls.jsonl').open('a') as out:
    out.write(json.dumps({'time': time.monotonic(), 'program': 'wl-copy', 'args': sys.argv[1:]}) + '\n')

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

# VOCO fills both selections: GUI toolkits paste CLIPBOARD on Shift+Insert,
# terminals paste PRIMARY.
primary = '--primary' in sys.argv[1:]
assert [arg for arg in sys.argv[1:] if arg != '--primary'] == ['--type', 'text/plain;charset=utf-8'], sys.argv
text = sys.stdin.buffer.read(1024 * 1024 + 1).decode('utf-8')
assert len(text.encode('utf-8')) <= 1024 * 1024
Gio.bus_get_sync(Gio.BusType.SESSION, None).call_sync(
    'org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe',
    'SetPrimary' if primary else 'SetClipboard', GLib.Variant('(s)', (text,)), None,
    Gio.DBusCallFlags.NO_AUTO_START, 1500, None)
