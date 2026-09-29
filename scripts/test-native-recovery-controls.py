#!/usr/bin/python3
"""Inspect the Ready popover after a pasted dictation in the private desktop accessibility tree."""
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
# Every idle popover presents these; the device picker is named "Microphone: <device>".
ANCHORS = ['Hide to tray', 'Help', 'Microphone']
# A pasted dictation leaves nothing to copy, review, discard or cancel.
FORBIDDEN_BUTTONS = {'Copy transcript', 'Discard', 'Discard transcript', 'Keep', 'Cancel dictation'}
FORBIDDEN_TEXT = ['Transcript ready to copy', 'Dictation saved', 'Transcript needs attention', 'Needs attention', 'Setup needed',
                  'Settings need attention', 'Text delivery needs setup', 'Microphone setup required', 'Microphone needs permission',
                  'Text delivery paused', 'Dictation interrupted', 'Interrupted dictation', 'Recovered transcript', 'Crash recovery',
                  'manual review', 'could not be confirmed', 'copied to clipboard']

# Only this disposable session's VOCO and harness exist here. The harness is this
# probe's parent; skip it so the text dictated into its fields is never read.
def inspect():
    pending = [Atspi.get_desktop(0)]
    count = 0
    names, texts, buttons, status, anchors = [], [], [], [], {}
    while pending and count < 500:
        node = pending.pop()
        count += 1
        try:
            role = node.get_role()
            if role == Atspi.Role.APPLICATION and node.get_process_id() == os.getppid():
                continue
            name = (node.get_name() or '').replace('\ufffc', '').strip()
            names.append(name)
            text = ''
            if any(interface.endswith('Text') for interface in node.get_interfaces()):
                text = Atspi.Text.get_text(node, 0, min(1000, Atspi.Text.get_character_count(node))).replace('\ufffc', '').strip()
                texts.append(text)
            if role == Atspi.Role.STATUS_BAR:
                status.append(text or name)
            if role == Atspi.Role.PUSH_BUTTON:
                buttons.append(name)
                key = 'Microphone' if name.startswith('Microphone:') else name
                if key in ANCHORS and key not in anchors:
                    bounds = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
                    state = node.get_state_set()
                    anchors[key] = dict(name=name, x=bounds.x, y=bounds.y, width=bounds.width, height=bounds.height,
                                        enabled=state.contains(Atspi.StateType.ENABLED), showing=state.contains(Atspi.StateType.SHOWING))
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        except Exception:
            continue
    shown = names + texts
    result = dict(anchors=anchors, status=status, ready=any(value.startswith('Ready') for value in shown),
                  forbidden=sorted({name for name in buttons if name in FORBIDDEN_BUTTONS}
                                   | {phrase for phrase in FORBIDDEN_TEXT for value in shown if phrase in value}))
    (root / 'evidence/popover-accessibility-probe.json').write_text(json.dumps(dict(names=names, texts=texts, buttons=buttons, result=result), indent=2))
    return result

for attempt in range(20):
    result = inspect()
    if result['ready'] and all(anchor in result['anchors'] for anchor in ANCHORS):
        break
    time.sleep(.2)
missing = [anchor for anchor in ANCHORS if anchor not in result['anchors']]
if missing:
    raise SystemExit('Popover controls were not accessible: ' + ', '.join(missing))
print(json.dumps(result))
