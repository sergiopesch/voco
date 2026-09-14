#!/usr/bin/python3
"""Inspect normal manual-Copy controls in the private desktop accessibility tree."""
import json
import os
from pathlib import Path
import time
import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
root = Path(os.environ['VOCO_NATIVE_TEST_ROOT'])
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
Atspi.init()

# Only this disposable session's own synthetic application/fixture exists here.
# Production focus-witness design does not authorize accessible-name reads.
def find_button():
    pending = [Atspi.get_desktop(0)]
    count = 0
    result = None
    names = []
    texts = []
    buttons = []
    while pending and count < 500:
        node = pending.pop()
        count += 1
        try:
            name = node.get_name()
            names.append(name or '')
            if any(name.endswith('Text') for name in node.get_interfaces()):
                texts.append(Atspi.Text.get_text(node, 0, min(1000, Atspi.Text.get_character_count(node))))
            if node.get_role() == Atspi.Role.PUSH_BUTTON:
                buttons.append(name)
            if name == 'Copy transcript' and node.get_role() == Atspi.Role.PUSH_BUTTON:
                bounds = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
                state = node.get_state_set()
                result = dict(name='Copy transcript', x=bounds.x, y=bounds.y, width=bounds.width, height=bounds.height,
                            enabled=state.contains(Atspi.StateType.ENABLED), showing=state.contains(Atspi.StateType.SHOWING))
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        except Exception:
            continue
    if result:
        result.update(manualReady=any('Transcript ready to copy' in name for name in names + texts),
                      clearTranscriptAvailable='Clear transcript' in buttons,
                      recoveryActions=[name for name in buttons if name in ['Discard recovery', 'Retry transcription']])
    (root / 'evidence/manual-accessibility-probe.json').write_text(json.dumps(dict(names=names, texts=texts, buttons=buttons, result=result), indent=2))
    return result

for attempt in range(20):
    result = find_button()
    if result and result['manualReady'] and result['clearTranscriptAvailable']:
        print(json.dumps(result))
        break
    time.sleep(.1)
else:
    raise SystemExit('Normal Transcript ready to copy / Clear transcript controls were not accessible')
