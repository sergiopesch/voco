#!/usr/bin/python3
"""Observe only accessibility focus identities inside the native test sandbox."""
import json
import os
from pathlib import Path
import signal
import time
import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi, GLib

root = Path(os.environ['VOCO_NATIVE_TEST_ROOT'])
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
Atspi.init()
loop = GLib.MainLoop()

def focused(event, _data):
    if event.detail1 != 1:
        return
    source = event.source
    record = dict(t=time.monotonic(), type=event.type, path=source.path,
                  processId=source.get_process_id(), role=source.get_role_name(),
                  name=source.get_name(), accessibleId=source.get_accessible_id())
    with (root / 'evidence/atspi-focus.jsonl').open('a') as output:
        output.write(json.dumps(record) + '\n')

listener = Atspi.EventListener.new(focused, None)
assert listener.register('object:state-changed:focused')
(root / 'evidence/atspi-ready').write_text('ready\n')
signal.signal(signal.SIGTERM, lambda *_: loop.quit())
GLib.timeout_add_seconds(60, lambda: (loop.quit(), False)[1])
loop.run()
