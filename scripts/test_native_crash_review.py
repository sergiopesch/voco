"""Explicit crash review through the packaged app's real tray and accessibility tree."""
import json
import os
from pathlib import Path
import subprocess
import time


SYNTHETIC_TEXT = "\n\n".join(
    f"Paragraph {index}: This is public synthetic test text for VOCO crash recovery. "
    "Every word must remain available in the scrollable transcript without hiding the controls."
    for index in range(1, 41)
)


def seed_crash(root):
    (root / 'state').chmod(0o700)
    directory = root / 'state/voco/crash-recovery'
    directory.mkdir(parents=True, mode=0o700)
    directory.parent.chmod(0o700)
    directory.chmod(0o700)
    active = directory / 'active.json'
    active.write_text(json.dumps({'id': '11111111-1111-1111-1111-111111111111',
                                 'text': SYNTHETIC_TEXT, 'createdAt': 1790625600000}))
    active.chmod(0o600)


def run_review(root, app, pump, activate, native_windows, env, cycle):
    from gi.repository import Atspi
    assert not any(Path(path).exists() for path in ('/dev/input', '/dev/snd'))
    assert Path('/dev/uinput').is_char_device() == (os.environ.get('VOCO_GNOME_CURSOR') == '1')
    result = {'passed': False, 'cycle': cycle + 1, 'syntheticTranscript': True,
              'activation': 'registered DBusMenu Event; controls use actual AT-SPI actions'}
    result['renderingOverrides'] = {key: os.environ[key] for key in
        ('WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_DISABLE_COMPOSITING_MODE') if key in os.environ}

    def wait(predicate, label):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            assert app.poll() is None, 'App exited during ' + label
            pump(.05)
            value = predicate()
            if value:
                return value
        screenshot('failure')
        (root / 'evidence' / f'crash-review-{cycle + 1}-failure.json').write_text(json.dumps([
            {'role': node.get_role_name(), 'name': node.get_name(),
             'text': Atspi.Text.get_text(node, 0, min(180, Atspi.Text.get_character_count(node)))
             if any(interface.endswith('Text') for interface in node.get_interfaces()) else None}
            for node in nodes()], indent=2))
        raise AssertionError('Timed out: ' + label)

    def nodes():
        desktop = Atspi.get_desktop(0)
        pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
        pending = [node for node in pending if node is not None and node.get_process_id() == app.pid]
        found = []
        while pending and len(found) < 1000:
            node = pending.pop()
            if node is None:
                continue
            found.append(node)
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        return found

    def named(label, role=None):
        for node in nodes():
            if role is not None and node.get_role() != role:
                continue
            matches = node.get_name() == label
            if not matches and role is None and any(interface.endswith('Text') for interface in node.get_interfaces()):
                matches = Atspi.Text.get_character_count(node) == len(label) and Atspi.Text.get_text(node, 0, -1) == label
            if not matches:
                continue
            states = node.get_state_set()
            if states.contains(Atspi.StateType.VISIBLE) and states.contains(Atspi.StateType.SHOWING):
                return node
        return None

    def showing():
        return [window for window in native_windows() if window['pid'] == app.pid
                and window['visible'] and window['frame'][2] > 4 and window['frame'][3] > 4]

    def fits(node):
        windows = showing()
        assert len(windows) == 1, windows
        rect = node.get_extents(Atspi.CoordType.WINDOW)
        frame = windows[0]['frame']
        bounds = [rect.x, rect.y, rect.width, rect.height]
        assert rect.x >= 0 and rect.y >= 0 and rect.width > 0 and rect.height > 0, bounds
        assert rect.x + rect.width <= frame[2] + 1 and rect.y + rect.height <= frame[3] + 1, (bounds, frame)
        return bounds

    def press(label):
        node = wait(lambda: named(label, Atspi.Role.PUSH_BUTTON), label)
        result.setdefault('controls', []).append({'label': label, 'bounds': fits(node)})
        action = node.get_action_iface()
        assert action is not None and action.get_n_actions() > 0 and action.do_action(0), label
        pump(.2)

    def screenshot(label):
        pump(.3)
        code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
        subprocess.run(['/usr/bin/python3', '-c', code, str(root / 'evidence' / f'crash-review-{cycle + 1}-{label}.png')],
                       env={**env, 'DISPLAY': ':77', 'GDK_BACKEND': 'x11'}, check=True, timeout=10)

    pump(1)
    assert not showing(), 'Crash review must not open automatically at startup'
    result['startupHidden'] = True
    activate('Review')
    if cycle == 0:
        transcript = wait(lambda: named('Recovered transcript'), 'recovered transcript')
        result['transcriptBounds'] = fits(transcript)
        text = transcript.get_text_iface()
        assert text is not None and Atspi.Text.get_text(transcript, 0, -1) == SYNTHETIC_TEXT
        result['transcriptCharacters'] = Atspi.Text.get_character_count(transcript)
        for label in ('Settings', 'Hide to tray', 'Discard', 'Copy transcript'):
            button = wait(lambda label=label: named(label, Atspi.Role.PUSH_BUTTON), label)
            result.setdefault('visibleControls', []).append({'label': label, 'bounds': fits(button)})
        screenshot('long-transcript')
        last = Atspi.Text.get_character_count(transcript) - 1
        assert Atspi.Text.scroll_substring_to(transcript, last, last + 1, Atspi.ScrollType.ANYWHERE), 'Transcript must scroll to its final character'
        pump(.2)
        tail = Atspi.Text.get_character_extents(transcript, last, Atspi.CoordType.WINDOW)
        area = transcript.get_extents(Atspi.CoordType.WINDOW)
        assert tail.y >= area.y and tail.y + tail.height <= area.y + area.height + 1, 'Final text remains clipped'
        screenshot('transcript-end')
        result['finalCharacterReachable'] = True
        press('Copy transcript')
        copied = subprocess.run(['wl-paste', '--no-newline'], env=env, capture_output=True, text=True, timeout=5)
        assert copied.returncode == 0 and copied.stdout == SYNTHETIC_TEXT
        result['explicitCopyExact'] = True
        # Terminals paste PRIMARY with Shift+Insert, so Copy must set it too.
        primary = subprocess.run(['wl-paste', '--primary', '--no-newline'], env=env, capture_output=True, text=True, timeout=5)
        assert primary.returncode == 0 and primary.stdout == SYNTHETIC_TEXT, 'Copy did not set PRIMARY'
        result['explicitCopyPrimary'] = True
    else:
        wait(lambda: named('No interrupted dictation.'), 'empty review after explicit discard')
        screenshot('empty')
    press('Hide to tray')
    wait(lambda: not showing(), 'review hidden')
    activate('Settings')
    wait(lambda: named('Settings', Atspi.Role.HEADING), 'Settings heading')
    screenshot('settings')
    press('Hide to tray')
    wait(lambda: not showing(), 'settings hidden')
    result['settingsAccessible'] = True
    if cycle == 0:
        activate('Review')
        wait(lambda: named('Recovered transcript'), 'review preserved across settings')
        press('Discard')
        press('Discard transcript')
        wait(lambda: named('No interrupted dictation.'), 'explicitly discarded review')
        press('Hide to tray')
        wait(lambda: not showing(), 'empty review hidden')
        result['explicitDiscard'] = True
    assert not (root / 'state/voco/crash-recovery/active.json').exists()
    result['passed'] = True
    return result
