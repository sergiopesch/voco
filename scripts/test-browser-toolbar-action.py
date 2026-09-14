#!/usr/bin/python3
"""Inspect/click real Chromium toolbar controls only in the disposable X11 seat."""
import os
if not __debug__ or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise RuntimeError('Toolbar qualification requires assertions and no Python optimization')
import argparse
import json
from pathlib import Path
import subprocess
import time
import gi

gi.require_version('Atspi', '2.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Atspi, Gdk
parser = argparse.ArgumentParser()
parser.add_argument('--stage', required=True)
parser.add_argument('--action')
args = parser.parse_args()
root = Path(os.environ['VOCO_BROWSER_TEST_ROOT'])
assert root.is_absolute() and root.is_dir()
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
assert os.environ['DISPLAY'] == ':0' and os.environ.get('DBUS_SESSION_BUS_ADDRESS')
assert not Path('/dev/input').exists() and not Path('/dev/snd').exists()
assert args.stage.isdigit()
Atspi.init()
Gdk.init([])

def snapshot():
    desktop = Atspi.get_desktop(0)
    roots = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
    applications = [{'name': node.get_name(), 'pid': node.get_process_id()} for node in roots]
    pending = [node for node in roots if 'chrom' in (node.get_name() or '').lower()]
    nodes, candidates, physical_controls = [], [], set()
    for _ in range(4000):
        if not pending:
            break
        node = pending.pop()
        try:
            name = node.get_name() or ''
            role = node.get_role()
            states = node.get_state_set()
            actionable = role in (Atspi.Role.PUSH_BUTTON, Atspi.Role.MENU_ITEM, Atspi.Role.CHECK_MENU_ITEM, Atspi.Role.TOGGLE_BUTTON) and all(states.contains(state) for state in [Atspi.StateType.ENABLED, Atspi.StateType.SHOWING, Atspi.StateType.VISIBLE])
            component = node.get_component_iface()
            bounds = component.get_extents(Atspi.CoordType.SCREEN) if component is not None else None
            row = dict(name=name,role=node.get_role_name(),actionable=actionable,bounds=[bounds.x,bounds.y,bounds.width,bounds.height] if bounds is not None else None)
            key = (name, row['role'], tuple(row['bounds'] or []))
            if key not in physical_controls:
                nodes.append(row)
                if actionable and args.action == name:
                    candidates.append(row)
                physical_controls.add(key)
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 200)))
        except Exception:
            continue
    return dict(applications=applications,nodes=nodes),candidates

end = time.monotonic() + 10
while True:
    result,candidates = snapshot()
    if (args.action is None and result['nodes']) or (args.action and len(candidates) == 1) or time.monotonic() >= end:
        break
    time.sleep(.05)
stamp = time.monotonic_ns()
base = root / f'evidence/toolbar-{args.stage}-{stamp}'
base.with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
image = Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900)
assert image is not None
image.savev(str(base.with_suffix('.png')),'png',[],[])
if args.action:
    assert len(candidates) == 1, f'Expected exactly one visible browser control {args.action!r}; inspect {base.name}.json'
    x,y,width,height = candidates[0]['bounds']
    assert 0 <= x < x + width <= 1280 and 0 <= y < y + height <= 900
    subprocess.run(['xdotool','mousemove','--sync',str(x+width//2),str(y+height//2),'click','1'],check=True,timeout=3)
    result['clicked'] = candidates[0]
    base.with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
