#!/usr/bin/python3
"""Activate the real recovery-clear button only in the private browser test desktop."""
import os
if not __debug__ or os.environ.get("PYTHONOPTIMIZE", "") not in ("", "0"):
    raise RuntimeError("Recovery qualification requires assertions and no Python optimization")
import json
from pathlib import Path
import time
import subprocess
import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

root = Path(os.environ['VOCO_BROWSER_TEST_ROOT'])
assert root.is_absolute() and root.is_dir()
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
assert os.environ['DISPLAY'] == ':0'
assert os.environ.get('DBUS_SESSION_BUS_ADDRESS'), 'Private accessibility bus is required'
Atspi.init()


def find_clear_button():
    desktop = Atspi.get_desktop(0)
    pending = []
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if (app.get_name() or '').lower() == 'voco':
            pending.append(app)
    count = 0
    fallback = None
    while pending and count < 500:
        node = pending.pop()
        count += 1
        try:
            name = node.get_name()
            state = node.get_state_set()
            if (node.get_role() == Atspi.Role.PUSH_BUTTON
                    and name in ['Discard recovery', 'Clear transcript']
                    and state.contains(Atspi.StateType.ENABLED)
                    and state.contains(Atspi.StateType.SHOWING)):
                if name == 'Discard recovery':
                    return node
                fallback = node
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        except Exception:
            continue
    return fallback


# Recovery stays in the tray until the user explicitly opens the existing app.
assert (root / 'runtime/voco.sock').is_socket(), 'Private app must already be running'
assert find_clear_button() is None, 'Recovery must not present itself automatically'
subprocess.run([str(root / 'voco')], check=True, timeout=10)

for attempt in range(50):
    button = find_clear_button()
    if button is not None:
        name = button.get_name()
        actions = [Atspi.Action.get_action_name(button, index)
                   for index in range(Atspi.Action.get_n_actions(button))]
        index = next((i for i, action in enumerate(actions) if action in ['click', 'press', 'activate']), None)
        if index is None:
            raise SystemExit('Recovery control exposes no activation action: ' + repr(actions))
        activated = Atspi.Action.do_action(button, index)
        result = dict(button=name, action=actions[index], activated=activated, explicitReview=True,
                      boundary='actual VOCO accessibility action in private browser-test desktop')
        (root / 'evidence/browser-clear-recovery.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
        if not activated:
            raise SystemExit('Recovery control activation was rejected')
        break
    time.sleep(.1)
else:
    raise SystemExit('Actual VOCO Discard recovery / Clear transcript button was not visible in private desktop')
