#!/usr/bin/python3
"""Test-only relay of the private Shell's input state, never installed.

The uinput bridge runs outside the private GNOME namespace and can't reach its
session bus. Before a paste gesture's first key and after its last, it connects
to SOCKET and gets one JSON line: the probe's GetInputState, the modifiers the
Shell sees and whether its window menu is open.

Usage: shell-probe-input-state.py SOCKET
"""
import os
from pathlib import Path
import socket
import sys

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

assert os.environ.get('VOCO_GNOME_CURSOR') == '1'
path = Path(sys.argv[1])
assert path.parent == Path(os.environ['XDG_RUNTIME_DIR']), path
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
path.unlink(missing_ok=True)
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
    server.bind(str(path))
    server.listen()
    while True:
        connection, _ = server.accept()
        with connection:
            connection.settimeout(2)
            try:
                if connection.recv(64) != b'GetInputState\n':
                    continue
                state = bus.call_sync('org.gnome.Shell', '/org/voco/PrivateShellProbe',
                                      'org.voco.PrivateShellProbe', 'GetInputState', None, None,
                                      Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()[0]
                connection.sendall(state.encode() + b'\n')
            except (OSError, GLib.Error) as error:
                # The bridge records the missing state as its own failure.
                print(f'shell-probe-input-state: {error}', file=sys.stderr, flush=True)
