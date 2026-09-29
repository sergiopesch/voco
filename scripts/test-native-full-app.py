#!/usr/bin/python3
"""Full native capture/IPC/inference, pasted into the focused GTK field of a private X11 session.

A private PulseAudio fixture feeds the real app, which copies each recognized chunk to
CLIPBOARD and PRIMARY with xclip, then sends xdotool [Space] Shift+Insert to whatever has
keyboard focus. Final-text-only streams exactly like stable-cursor-streaming: desktop paste
sessions pin that legacy snapshot and the phrase queue pastes each appended suffix as it
arrives; Stop pastes only what remains, into the field focused at that moment.

delivery: A keeps focus and receives the fixture words exactly once; B stays empty.
focus-switch: the fixture plays with A focused; once A's streamed text settles, focus moves
to B and the fixture plays again, all in one recording. A keeps only text pasted while it
had focus; B receives the rest, including whatever Stop flushes.
Both cases fail on IBus preedit or commit, a non-append field change, paste refusal or
failure, a copied remainder, recovery or fallback capture, then check the real tray menu and
the Ready popover through AT-SPI.
"""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('IBus', '1.0')
from gi.repository import Gtk, Gdk, GLib, IBus, Gio

root = Path(os.environ['VOCO_NATIVE_TEST_ROOT'])
repo = Path(__file__).resolve().parent.parent
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
assert os.environ['PULSE_SERVER'] == 'unix:' + str(root / 'runtime/pulse.sock')
assert os.environ['DISPLAY'] == ':0'
case = os.environ.get('VOCO_NATIVE_APP_CASE', 'delivery')
assert case in ['delivery', 'focus-switch'], 'Unsupported native application case'
trace_path = root / 'state/voco/hotkey-trace.jsonl'
model = root / 'speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'
assert hashlib.sha256(model.read_bytes()).hexdigest() == 'd9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d'
sound = repo / 'tests/fixtures/speech/84-121123-0000.wav'
EXPECTED = ['go', 'do', 'you', 'hear']
# focus-switch speaks the fixture once per field.
expected = EXPECTED * (2 if case == 'focus-switch' else 1)
# Every successful paste session traces these. Trace writes are unordered IPC: count, never order.
REQUIRED = ['dictation_desktop_paste_session_started', 'dictation_desktop_stream_started', 'recording_state_active',
            'dictation_desktop_paste_requested', 'dictation_desktop_paste_dispatched', 'dictation_desktop_live_prefix_dispatched',
            'dictation_recording_stopped', 'dictation_desktop_stream_flush_completed', 'dictation_stop_to_final_transcript',
            'dictation_stop_to_idle']
# Automatic paste was refused or stopped, the recognizer revised pasted text, or capture fell back to recovery.
FATAL = {'dictation_desktop_paste_unavailable', 'dictation_desktop_stream_failed', 'dictation_desktop_remainder_copied',
         'dictation_desktop_remainder_kept', 'dictation_desktop_snapshot_revised', 'recording_script_processor_connected',
         'dictation_capture_health_interrupted', 'dictation_recovery_retained'}
t0 = time.monotonic()

def pump(duration=.05):
    until = time.monotonic() + duration
    context = GLib.MainContext.default()
    while time.monotonic() < until:
        while context.pending():
            context.iteration(False)
        time.sleep(.005)

def traces():
    if not trace_path.exists():
        return []
    records = []
    for line in trace_path.read_text().splitlines():
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            pass # the writer may be appending the final line
    return records

def counts():
    return collections.Counter(x['event'] for x in traces() if isinstance(x, dict) and x.get('event'))

def words(text):
    return re.findall('[a-z]+', (text or '').lower())

def wait_for(predicate, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        if app.poll() is not None:
            raise RuntimeError('VOCO exited before ' + description)
        stopped = sorted(FATAL.intersection(counts()))
        if stopped:
            raise AssertionError('Automatic paste stopped before %s: %s' % (description, ', '.join(stopped)))
        pump(.05)
    raise AssertionError('Timed out waiting for %s; last trace events: %s' % (description, [x.get('event') for x in traces()[-8:]]))

def play(description):
    player = subprocess.Popen([os.environ['VOCO_NATIVE_PAPLAY'], '--device=fixture', str(sound)])
    wait_for(lambda: player.poll() is not None, description)
    assert player.returncode == 0, 'paplay failed during ' + description

paste_activity = dict(counts=None, t=t0)
def quiet(seconds):
    """No paste requested, in flight or landing: paste counts and fields unchanged for `seconds`."""
    c = counts()
    now = time.monotonic()
    observed = (c['dictation_desktop_paste_requested'], c['dictation_desktop_paste_dispatched'], c['dictation_desktop_paste_deferred'])
    if observed != paste_activity['counts']:
        paste_activity.update(counts=observed, t=now)
    latest = max([paste_activity['t']] + [m['t'] for m in mutations])
    return observed[0] <= observed[1] + observed[2] and now - latest >= seconds

focus_log = []
def note_focus(moment):
    # Diagnostics only: without a window manager, GTK activity flags may lag X focus.
    focused = subprocess.run(['xdotool', 'getwindowfocus'], capture_output=True, text=True).stdout.strip()
    focus_log.append(dict(t=round(time.monotonic() - t0, 3), moment=moment, xFocus=focused, harnessWindow=window_id,
                          harnessActive=window.is_active(), fieldAFocused=field.has_focus(), fieldBFocused=other.has_focus()))

def app_windows(*flags):
    found = []
    for xid in subprocess.run(['xdotool', 'search', *flags, '--pid', str(app.pid)], capture_output=True, text=True).stdout.split():
        shell = subprocess.run(['xdotool', 'getwindowgeometry', '--shell', xid], capture_output=True, text=True).stdout
        values = dict(line.split('=', 1) for line in shell.splitlines() if '=' in line)
        if {'X', 'Y', 'WIDTH', 'HEIGHT'} <= values.keys():
            found.append(dict(window=xid, x=int(values['X']), y=int(values['Y']), width=int(values['WIDTH']), height=int(values['HEIGHT'])))
    return found

def popover_shown():
    # WebKit capture keeps the hidden window mapped at 1x1 off-screen; the popover is far larger.
    return any(w['width'] * w['height'] >= 40000 for w in app_windows('--onlyvisible'))

def inside(bounds):
    return any(bounds['x'] >= m['workarea'][0] and bounds['y'] >= m['workarea'][1]
               and bounds['x'] + bounds['width'] <= m['workarea'][0] + m['workarea'][2]
               and bounds['y'] + bounds['height'] <= m['workarea'][1] + m['workarea'][3] for m in monitors)

def call(name, path, interface, method, values=None):
    return tray_bus.call_sync(name, path, interface, method, values, None, Gio.DBusCallFlags.NONE, 2000, None).unpack()

def tray_menus():
    """Label -> item of the app's exported dbusmenu; an absent 'enabled' property means enabled."""
    items = {}
    for name, item_path in tray_items:
        try:
            menu = call(name, item_path, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierItem', 'Menu')))[0]
            pending = [call(name, menu, 'com.canonical.dbusmenu', 'GetLayout', GLib.Variant('(iias)', (0, -1, ['label', 'enabled'])))[1]]
        except GLib.Error as error:
            if str(error) not in diagnostic_errors:
                diagnostic_errors.append(str(error))
            continue
        while pending:
            node_id, props, children = pending.pop()
            if props.get('label'):
                items.setdefault(props['label'], dict(name=name, menu=menu, id=node_id, enabled=props.get('enabled', True)))
            pending.extend(children)
    return items

def tray_click(label):
    item = tray_menus()[label]
    call(item['name'], item['menu'], 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (item['id'], 'clicked', GLib.Variant('s', ''), 0)))

def screenshot(name):
    Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), 0, 0, 1280, 900).savev(str(root / 'evidence' / name), 'png', [], [])

IBus.init()
bus = IBus.Bus()
assert bus.is_connected() and bus.preload_engines(['voco'])
pump(.3)
assert bus.set_global_engine('voco')
window = Gtk.Window(title='VOCO private full application acceptance')
window.set_default_size(1100, 220)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
window.add(box)
field = Gtk.Entry()
field.set_placeholder_text('A: focused for the first utterance' if case == 'focus-switch' else 'A: focused for the dictation')
field.set_input_hints(Gtk.InputHints.SPELLCHECK)
other = Gtk.Entry()
other.set_placeholder_text('B: focused for the second utterance' if case == 'focus-switch' else 'B: must remain empty')
other.set_input_hints(Gtk.InputHints.WORD_COMPLETION)
box.pack_start(field, False, False, 0)
box.pack_start(other, False, False, 0)
mutations, preedits = [], []
for entry, label in [(field, 'A'), (other, 'B')]:
    entry.connect('changed', lambda widget, label=label: mutations.append(dict(t=time.monotonic(), field=label, text=widget.get_text())))
    entry.connect('preedit-changed', lambda widget, preedit, label=label: preedits.append(dict(t=time.monotonic(), field=label, text=preedit)))
window.show_all()
display = Gdk.Display.get_default()
monitors = []
for index in range(display.get_n_monitors()):
    monitor = display.get_monitor(index)
    rect, work = monitor.get_geometry(), monitor.get_workarea()
    monitors.append(dict(x=rect.x, y=rect.y, width=rect.width, height=rect.height, workarea=[work.x, work.y, work.width, work.height], primary=monitor.is_primary()))
# Supply the standard tray-host discovery service absent from bare Xvfb.
# The app still exports its real menu; no app command or capture API is mocked.
tray_items = []
tray_bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
tray_xml = """<node><interface name="org.kde.StatusNotifierWatcher"><method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method><method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method><property name="RegisteredStatusNotifierItems" type="as" access="read"/><property name="IsStatusNotifierHostRegistered" type="b" access="read"/><property name="ProtocolVersion" type="i" access="read"/></interface></node>"""
def tray_method(connection, sender, path, interface, method, values, invocation):
    if method == 'RegisterStatusNotifierItem':
        service = values.unpack()[0]
        tray_items.append((sender, service) if service.startswith('/') else (service, '/StatusNotifierItem'))
    invocation.return_value(None)
def tray_property(connection, sender, path, interface, name):
    if name == 'RegisteredStatusNotifierItems':
        return GLib.Variant('as', [name + path for name, path in tray_items])
    if name == 'IsStatusNotifierHostRegistered':
        return GLib.Variant('b', True)
    return GLib.Variant('i', 0)
tray_bus.register_object('/StatusNotifierWatcher', Gio.DBusNodeInfo.new_for_xml(tray_xml).interfaces[0], tray_method, tray_property, None)
Gio.bus_own_name_on_connection(tray_bus, 'org.kde.StatusNotifierWatcher', Gio.BusNameOwnerFlags.NONE, None, None)
pump(.1)
log = (root / 'evidence/full-app.log').open('w')
app_hash = hashlib.sha256((root / 'voco').read_bytes()).hexdigest()
app = subprocess.Popen([str(root / 'voco')], stdout=log, stderr=subprocess.STDOUT, env={**os.environ, 'RUST_LOG': 'info', 'VOCO_HOTKEY_TRACE': '1'})
passed, failure, window_id, before_switch = False, None, None, None
selections, tray_state, popup, popover, diagnostic_errors = {}, None, None, None, []
try:
    assert shutil.which('xclip') and shutil.which('xdotool'), 'X11 paste needs xclip and xdotool on PATH'
    wait_for(lambda: (root / 'runtime/voco.sock').exists(), 'application control socket')
    pump(6)
    window.present()
    window_id = subprocess.check_output(['xdotool', 'search', '--name', '^VOCO private full application acceptance$'], text=True).strip().splitlines()[0]
    subprocess.run(['xdotool', 'windowfocus', '--sync', window_id], check=True)
    pump(.2)
    other.grab_focus()
    pump(.5)
    field.grab_focus()
    field.set_position(-1)
    pump(1)
    assert not mutations and field.get_text() == other.get_text() == '', 'A GTK field changed before dictation'
    note_focus('before-start')
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
    wait_for(lambda: counts()['recording_state_active'] > 0, 'actual capture')
    note_focus('recording')
    pulse_outputs = subprocess.check_output([os.environ['VOCO_NATIVE_PACTL'], 'list', 'source-outputs'], text=True)
    observable_fields = ('Source Output #', 'Driver:', 'Source:', 'Sample Specification:', 'Corked:', 'Mute:', 'application.name =', 'application.process.binary =')
    (root / 'evidence/pulse-source-outputs.txt').write_text('\n'.join(line for line in pulse_outputs.splitlines() if line.strip().startswith(observable_fields)) + '\n')
    pump(.5)
    play('fixture playback')
    if case == 'focus-switch':
        # Streaming pastes A's text before Stop. Switch only after it settles, with no
        # paste requested, in flight or landing, so each chunk has one recipient; the
        # second utterance cannot be recognized before the switch, so B must get text.
        wait_for(lambda: quiet(.5) and bool(field.get_text()), 'streamed text to settle in field A', timeout=15)
        before_switch = field.get_text()
        mutations.append(dict(t=time.monotonic(), field='switch', text=None))
        other.grab_focus()
        other.set_position(-1)
        note_focus('after-switch')
        pump(.3)
        play('second fixture playback after the focus switch')
    pump(.6)
    note_focus('before-stop')
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
    wait_for(lambda: counts()['dictation_stop_to_idle'] > 0, 'successful recording returned to idle', timeout=35)
    wait_for(lambda: quiet(.5), 'the last paste to land', timeout=5)
    note_focus('delivered')
    screenshot('delivered.png')
    c = counts()
    text, other_text = field.get_text(), other.get_text()
    missing = [event for event in REQUIRED if not c[event]]
    assert not missing, 'Paste session trace lacks ' + ', '.join(missing)
    assert not FATAL.intersection(c), 'Automatic paste stopped: ' + ', '.join(sorted(FATAL.intersection(c)))
    assert not any(p['text'] for p in preedits), 'A GTK field showed IBus preedit text'
    changes = [m for m in mutations if m['field'] in ('A', 'B')]
    for label in ('A', 'B'):
        history = [''] + [m['text'] for m in changes if m['field'] == label]
        assert all(after.startswith(before) and len(after) > len(before) for before, after in zip(history, history[1:])), 'Field %s changed other than by appended paste' % label
    # xdotool sends at most one joining Space and one Shift+Insert per dispatched chunk.
    assert len(changes) <= 2 * c['dictation_desktop_paste_dispatched'], 'Fields changed more often than VOCO dispatched pastes'
    if case == 'delivery':
        assert other_text == '' and not any(m['field'] == 'B' for m in changes), 'Unfocused field B received text'
        assert words(text) == expected, 'Focused field A did not receive the dictation exactly once: %r' % text
    else:
        switch = next(index for index, m in enumerate(mutations) if m['field'] == 'switch')
        assert text == before_switch and all(index < switch for index, m in enumerate(mutations) if m['field'] == 'A'), 'Field A changed after focus moved to B'
        assert all(index > switch for index, m in enumerate(mutations) if m['field'] == 'B'), 'Field B changed before it had focus'
        assert other_text, 'Nothing was pasted into B after focus moved to it'
        # Concatenate unseparated: a chunk boundary may fall inside a word.
        assert words(text + other_text) == expected, 'Fields A+B did not receive both utterances exactly once: %r + %r' % (text, other_text)
    last = changes[-1]
    history = [''] + [m['text'] for m in changes if m['field'] == last['field']]
    selections = dict(lastPaste=last['text'][len(history[-2]):], clipboard=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(),
                      primary=Gtk.Clipboard.get(Gdk.SELECTION_PRIMARY).wait_for_text())
    assert selections['clipboard'] == selections['lastPaste'], 'CLIPBOARD does not hold the last pasted chunk'
    assert selections['primary'] == selections['lastPaste'], 'PRIMARY does not hold the last pasted chunk'
    # Success leaves nothing to copy or review: the tray and popover return to Ready.
    wait_for(lambda: any(label.startswith('VOCO — Ready') for label in tray_menus()), 'the tray to report Ready', timeout=5)
    menus = tray_menus()
    tray_state = dict(status=[label for label in menus if label.startswith('VOCO — ')], openEnabled=menus.get('Open VOCO', {}).get('enabled'))
    assert tray_state['openEnabled'], 'The tray has no enabled Open VOCO item after dictation'
    tray_click('Open VOCO')
    wait_for(popover_shown, 'the tray to open the popover', timeout=10)
    pump(1)
    popup = max(app_windows('--onlyvisible'), key=lambda w: w['width'] * w['height'])
    assert inside(popup), 'The popover extends outside its workarea'
    probe = subprocess.Popen(['/usr/bin/python3', str(Path(__file__).with_name('test-native-recovery-controls.py'))], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    wait_for(lambda: probe.poll() is not None, 'the popover accessibility probe', timeout=30)
    output, errors = probe.communicate()
    assert probe.returncode == 0, errors.strip() or 'The popover accessibility probe failed'
    popover = json.loads(output)
    assert popover['ready'], 'The popover is not Ready after a pasted dictation'
    assert not popover['forbidden'], 'The popover presents failure, recovery or Copy UI after success: ' + ', '.join(popover['forbidden'])
    for name, anchor in popover['anchors'].items():
        assert anchor['enabled'] and anchor['showing'] and inside(anchor), 'Popover control %s is disabled, hidden or outside its workarea' % name
    screenshot('popover.png')
    passed = True
except Exception as error:
    failure = '%s: %s' % (type(error).__name__, error)
    raise
finally:
    # Show the app's state in the final screenshot when the gate stopped earlier.
    try:
        if popover is None and app.poll() is None and not popover_shown() and tray_menus().get('Open VOCO', {}).get('enabled'):
            tray_click('Open VOCO')
            pump(1)
    except Exception as error:
        diagnostic_errors.append('tray: %s' % error)
    for name, evidence in [('private-bus-names.json', lambda: call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames')[0]),
                           ('window-geometry.json', lambda: dict(monitors=monitors, hasPrimaryMonitor=display.get_primary_monitor() is not None, windows=app_windows()))]:
        try:
            (root / 'evidence' / name).write_text(json.dumps(evidence(), indent=2) + '\n')
        except Exception as error:
            diagnostic_errors.append('%s: %s' % (name, error))
    c = counts()
    capture = 'webkit-audio-worklet' if c['recording_worklet_connected'] else 'webkit-script-processor' if c['recording_script_processor_connected'] else 'native' if c['recording_state_active'] else None
    report = dict(passed=passed, failure=failure, expectedOutcome='pasted-into-focused-field', case=case,
                  outputMode=os.environ.get('VOCO_NATIVE_OUTPUT_MODE', 'final-text-only'), buildRole=os.environ.get('VOCO_NATIVE_BUILD_ROLE', 'preflight'),
                  callbackTraceInstrumented=os.environ.get('VOCO_NATIVE_TRACE') == '1', expectedWords=expected,
                  text=field.get_text(), otherText=other.get_text(), textBeforeSwitch=before_switch,
                  mutations=[dict(m, t=round(m['t'] - t0, 3)) for m in mutations], preedits=[dict(p, t=round(p['t'] - t0, 3)) for p in preedits],
                  selections=selections, traceCounts=dict(sorted(c.items())), captureRoute=capture, focus=focus_log, harnessWindow=window_id,
                  tray=tray_state, popoverWindow=popup, popover=popover, helpers={name: bool(shutil.which(name)) for name in ['xclip', 'xdotool']},
                  diagnosticErrors=diagnostic_errors,
                  engineSourceHashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('voco_ibus_*.py')},
                  fixtureSha256=hashlib.sha256(sound.read_bytes()).hexdigest(),
                  appSha256=app_hash,
                  modelSha256=hashlib.sha256(model.read_bytes()).hexdigest(),
                  boundary=' / '.join([{'webkit-audio-worklet': 'real WebKit capture', 'native': 'real native capture'}.get(capture, 'capture not established'),
                                       'private PulseAudio fixture', 'Tauri binary IPC', 'pinned Nemotron', 'xclip CLIPBOARD+PRIMARY',
                                       'xdotool Shift+Insert into the focused GTK entry', 'no IBus text mutation', 'private X11 without a window manager']))
    (root / 'evidence/full-app.json').write_text(json.dumps(report, indent=2) + '\n')
    if trace_path.exists():
        shutil.copyfile(trace_path, root / 'evidence/full-app-trace.jsonl')
    try:
        screenshot('full-app.png')
    except Exception as error:
        print('Final screenshot failed: %s' % error)
    app.terminate()
    try:
        app.wait(timeout=5)
    except subprocess.TimeoutExpired:
        app.kill()
        app.wait()
    performance = root / 'state/voco/performance'
    if performance.exists():
        shutil.copytree(performance, root / 'evidence/performance', dirs_exist_ok=True)
    log.close()
    print(json.dumps(report, indent=2))

assert passed, 'Native application paste acceptance failed; inspect the retained evidence'
