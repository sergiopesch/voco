#!/usr/bin/python3
"""Full native capture/IPC/inference/manual Copy with a private virtual microphone."""
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

def wait_for(predicate, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        if app.poll() is not None:
            raise RuntimeError('VOCO exited before ' + description)
        pump(.05)
    raise AssertionError('Timed out waiting for ' + description)

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
field.set_placeholder_text('A: actual dictated text')
field.set_input_hints(Gtk.InputHints.SPELLCHECK)
other = Gtk.Entry()
other.set_placeholder_text('B: must remain empty')
other.set_input_hints(Gtk.InputHints.WORD_COMPLETION)
box.pack_start(field, False, False, 0)
box.pack_start(other, False, False, 0)
mutations = []
field.connect('changed', lambda entry: mutations.append(dict(t=time.monotonic(), field='A', text=entry.get_text())))
other.connect('changed', lambda entry: mutations.append(dict(t=time.monotonic(), field='B', text=entry.get_text())))
window.show_all()
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
app = subprocess.Popen([str(root / 'voco')], stdout=log, stderr=subprocess.STDOUT, env={**os.environ, 'RUST_LOG': 'info', 'VOCO_DEBUG_CAPTURE_AUDIO': '1'})
passed = False
try:
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
    started = time.monotonic()
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
    wait_for(lambda: any(x.get('event') == 'recording_state_active' for x in traces()), 'actual WebKit capture')
    pulse_outputs = subprocess.check_output([os.environ['VOCO_NATIVE_PACTL'], 'list', 'source-outputs'], text=True)
    observable_fields = ('Source Output #', 'Driver:', 'Source:', 'Sample Specification:', 'Corked:', 'Mute:', 'application.name =', 'application.process.binary =')
    (root / 'evidence/pulse-source-outputs.txt').write_text('\n'.join(line for line in pulse_outputs.splitlines() if line.strip().startswith(observable_fields)) + '\n')
    pump(.5)
    sound = repo / 'tests/fixtures/speech/84-121123-0000.wav'
    player = subprocess.Popen([os.environ['VOCO_NATIVE_PAPLAY'], '--device=fixture', str(sound)])
    wait_for(lambda: player.poll() is not None, 'fixture playback')
    assert player.returncode == 0
    if case == 'focus-switch':
        other.grab_focus()
        other.set_position(-1)
        pump(.3)
    pump(.6)
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
    wait_for(lambda: any(x.get('event') == 'dictation_stop_to_idle' for x in traces()), 'successful recording returned to idle', timeout=35)
    pump(.5)
    assert field.get_text() == '' and other.get_text() == '', 'Unqualified GTK field received automatic output'
    assert mutations == [], 'An unqualified target was transiently mutated'
    events = {x.get('event') for x in traces()}
    assert 'dictation_transcription_completed' in events or 'dictation_canonical_final_completed' in events, 'Manual result lacks actual recognition proof'
    assert 'dictation_recovery_retained' not in events, 'Successful manual Copy was incorrectly classified as failure recovery'
    assert not events.intersection({'dictation_owned_preedit_committed', 'dictation_owned_preedit_progressive_commit', 'dictation_canonical_checkpoint_committed'}), 'Disabled IBus mutation was reported as committed'
    passed = True
finally:
    # Open this isolated app via its real tray before exercising manual Copy.
    try:
        connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        def call(name, path, interface, method, values=None):
            return connection.call_sync(name, path, interface, method, values, None, Gio.DBusCallFlags.NONE, 2000, None).unpack()
        names = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames')[0]
        (root / 'evidence/private-bus-names.json').write_text(json.dumps(names))
        for name, item_path in tray_items:
            menu = call(name, item_path, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierItem', 'Menu')))[0]
            layout = call(name, menu, 'com.canonical.dbusmenu', 'GetLayout', GLib.Variant('(iias)', (0, -1, ['label'])))[1]
            def find(node):
                node_id, props, children = node
                if props.get('label') == 'Open VOCO':
                    return node_id
                for child in children:
                    found = find(child)
                    if found is not None:
                        return found
            item_id = find(layout)
            if item_id is not None:
                call(name, menu, 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (item_id, 'clicked', GLib.Variant('s', ''), 0)))
                pump(.5)
    except Exception as diagnostic_error:
        (root / 'evidence/popover-diagnostic-error.txt').write_text(str(diagnostic_error))
    display = Gdk.Display.get_default()
    monitor_geometry = []
    for index in range(display.get_n_monitors()):
        monitor = display.get_monitor(index)
        rect = monitor.get_geometry()
        work = monitor.get_workarea()
        monitor_geometry.append(dict(x=rect.x, y=rect.y, width=rect.width, height=rect.height, workarea=[work.x, work.y, work.width, work.height], primary=monitor.is_primary()))
    app_windows = subprocess.check_output(['xdotool', 'search', '--pid', str(app.pid)], text=True).splitlines()
    window_geometry = [subprocess.check_output(['xdotool', 'getwindowgeometry', '--shell', window_id], text=True) for window_id in app_windows]
    (root / 'evidence/window-geometry.json').write_text(json.dumps(dict(monitors=monitor_geometry, hasPrimaryMonitor=display.get_primary_monitor() is not None, windows=window_geometry), indent=2))
    recovery_controls = None
    if passed:
        try:
            app_bounds = [dict(line.split('=', 1) for line in data.splitlines()) for data in window_geometry]
            popup = next(bounds for bounds in app_bounds if int(bounds['WIDTH']) >= 400 and int(bounds['HEIGHT']) >= 500)
            def inside(x, y, width, height):
                return any(x >= m['workarea'][0] and y >= m['workarea'][1] and x + width <= m['workarea'][0] + m['workarea'][2] and y + height <= m['workarea'][1] + m['workarea'][3] for m in monitor_geometry)
            assert inside(*(int(popup[key]) for key in ['X', 'Y', 'WIDTH', 'HEIGHT'])), 'Manual Copy window extends outside its workarea'
            probe = subprocess.Popen(['/usr/bin/python3', str(Path(__file__).with_name('test-native-recovery-controls.py'))], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            wait_for(lambda: probe.poll() is not None, 'accessible normal Copy control', timeout=8)
            output, errors = probe.communicate()
            assert probe.returncode == 0, errors
            recovery_controls = json.loads(output)
            assert recovery_controls['manualReady'] and recovery_controls['clearTranscriptAvailable'], 'Successful transcript is not presented as normal manual Copy'
            assert not recovery_controls['recoveryActions'], 'Successful manual transcript exposes failure recovery actions'
            assert recovery_controls['enabled'] and recovery_controls['showing'], 'Copy control disabled or hidden'
            assert inside(*(recovery_controls[key] for key in ['x', 'y', 'width', 'height'])), 'Copy control lies outside workarea'
            before_copy = Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), 0, 0, 1280, 900)
            before_copy.savev(str(root / 'evidence/recovery-before-copy.png'), 'png', [], [])
            if os.environ.get('VOCO_NATIVE_PAINT_TIMELINE') == '1':
                for index, delay in enumerate([.1, .5, 1.5]):
                    pump(delay)
                    frame = Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), 0, 0, 1280, 900)
                    frame.savev(str(root / 'evidence' / f'before-interaction-{index}.png'), 'png', [], [])
            Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text('VOCO private clipboard sentinel', -1)
            pump(.05)
            subprocess.run(['xdotool', 'mousemove', str(recovery_controls['x'] + recovery_controls['width']//2), str(recovery_controls['y'] + recovery_controls['height']//2), 'click', '1'], check=True)
            pump(.4)
            copied = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()
            assert copied and re.findall('[a-z]+', copied.lower()) == ['go', 'do', 'you', 'hear'], 'Normal Copy did not populate the private clipboard'
            recovery_controls['copiedText'] = copied
            assert field.get_text() == '' and other.get_text() == '' and mutations == [], 'Copy action mutated a destination field'
        except Exception as control_error:
            passed = False
            (root / 'evidence/recovery-control-error.txt').write_text(str(control_error))
    report = dict(passed=passed, expectedOutcome="normal-manual-copy", manualCopyControls=recovery_controls, callbackTraceInstrumented=os.environ.get('VOCO_NATIVE_TRACE') == '1', case=case, outputMode=os.environ.get('VOCO_NATIVE_OUTPUT_MODE', 'final-text-only'), buildRole=os.environ.get('VOCO_NATIVE_BUILD_ROLE', 'preflight'),
                  engineSourceHashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('voco_ibus_*.py')},
                  fixtureSha256=hashlib.sha256((repo / 'tests/fixtures/speech/84-121123-0000.wav').read_bytes()).hexdigest(),
                  appSha256=app_hash,
                  modelSha256=hashlib.sha256(model.read_bytes()).hexdigest(),
                  text=field.get_text(), otherText=other.get_text(), mutations=mutations,
                  boundary='real WebKit capture / private PulseAudio fixture / Tauri binary IPC / pinned Nemotron / disabled IBus mutation / actual Copy control / private clipboard')
    (root / 'evidence/full-app.json').write_text(json.dumps(report, indent=2) + '\n')
    debug_captures = root / 'state/voco/debug-captures'
    if debug_captures.exists():
        shutil.copytree(debug_captures, root / 'evidence/debug-captures', dirs_exist_ok=True)
    if trace_path.exists():
        shutil.copyfile(trace_path, root / 'evidence/full-app-trace.jsonl')
    pixbuf = Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), 0, 0, 1280, 900)
    pixbuf.savev(str(root / 'evidence/full-app.png'), 'png', [], [])
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

assert passed, 'Native application acceptance failed; inspect the retained evidence'
