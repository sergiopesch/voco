#!/usr/bin/python3
"""Real widget delivery acceptance; no mocked IM contexts or host desktop access."""
import importlib.util
import json
import hashlib
import os
from pathlib import Path
import subprocess
import time
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('IBus', '1.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, Gdk, IBus, WebKit2

spec = importlib.util.spec_from_file_location('private_ibus', Path(__file__).with_name('test-private-ibus-engine.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
helper.PROTOCOL_VERSION = 6
pump = helper.pump_events
root = Path(os.environ['VOCO_NATIVE_TEST_ROOT'])
assert os.environ['DISPLAY'] == ':0'
assert str(root / 'runtime') == os.environ['XDG_RUNTIME_DIR']
assert str(root / 'runtime/private-ibus.sock') in os.environ['IBUS_ADDRESS']
IBus.init()
bus = IBus.Bus()
assert bus.is_connected()
assert bus.preload_engines(['voco'])
pump(.3)
assert bus.set_global_engine('voco')
pump(.3)
helper.wait_for_socket(root / 'runtime/voco/ibus-engine.sock')
client = helper.ProtocolClient(root / 'runtime/voco/ibus-engine.sock')
events = []
results = []
atspi = subprocess.Popen(['/usr/bin/python3', str(Path(__file__).with_name('test-native-atspi.py'))])
deadline = time.monotonic() + 5
while not (root / 'evidence/atspi-ready').exists() and time.monotonic() < deadline:
    pump(.02)
assert (root / 'evidence/atspi-ready').exists(), 'isolated AT-SPI listener did not start'

def event(kind, **values):
    events.append(dict(t=time.monotonic(), kind=kind, **values))
    if os.environ.get('VOCO_NATIVE_TRACE') == '1':
        with (root / 'evidence/callbacks.log').open('a') as trace:
            trace.write('MARK ' + json.dumps(dict(kind=kind, **values)) + '\n')

def focus(widget):
    widget.grab_focus()
    window.present()
    Gdk.flush()
    pump(.3)
    if isinstance(widget, Gtk.Entry):
        widget.set_position(-1)
        event("selection", field=widget.get_placeholder_text(), cursor=widget.get_position(), selection=widget.get_selection_bounds())

window = Gtk.Window(title='VOCO isolated native acceptance')
window.set_default_size(1000, 700)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
window.add(box)
entries = {}
for name, purpose, hints in [('A', Gtk.InputPurpose.FREE_FORM, Gtk.InputHints.SPELLCHECK), ('B', Gtk.InputPurpose.FREE_FORM, Gtk.InputHints.WORD_COMPLETION), ('generic', Gtk.InputPurpose.FREE_FORM, Gtk.InputHints.NONE), ('password', Gtk.InputPurpose.PASSWORD, Gtk.InputHints.NONE)]:
    entry = Gtk.Entry()
    entry.set_placeholder_text(name)
    entry.set_input_purpose(purpose)
    entry.set_input_hints(hints)
    entry.connect('changed', lambda w, n=name: event('mutation', field=n, text=w.get_text()))
    entry.connect('focus-in-event', lambda w, e, n=name: event('focus', field=n))
    box.pack_start(entry, False, False, 0)
    entries[name] = entry
window.show_all()
window.present()
pump(.5)

def trigger(hotkey="Alt+D"):
    armed = client.request('poll-trigger', hotkey=hotkey)
    event('armed', result=armed)
    subprocess.run(['xdotool', 'key', '--clearmodifiers', hotkey.lower().replace('control', 'ctrl')], check=True)
    pump(.15)
    result = client.request('poll-trigger', hotkey=hotkey)
    event('trigger', result=result)
    return result.get('trigger')

def rejected_mutations(sid, origin=None):
    for operation, values in [
        ('start', dict(clientSessionId=sid, triggerId=origin['triggerId'] if origin else None)),
        ('update', dict(sessionId=sid, confirmedText='', preeditText='never show draft', provisionalText='never show draft')),
        ('commit', dict(sessionId=sid, text='never insert café 你好')),
        ('checkpoint', dict(sessionId=sid, expectedCommittedText='', appendText='never insert checkpoint')),
        ('finish-canonical', dict(sessionId=sid, expectedCommittedText='', appendText='never insert final')),
        ('cancel', dict(sessionId=sid)),
    ]:
        try:
            client.request(operation, **values)
        except helper.EngineRejected as error:
            assert 'original text field' in str(error), str(error)
            event('safety-rejection', operation=operation, session=sid)
        else:
            raise AssertionError(operation + ' unexpectedly accepted')
        pump(.03)

try:
    status = client.request('status')
    assert status['setupState'] == 'safety-disabled' and not status['ready']
    focus(entries['generic'])
    for index, name in enumerate(['A', 'B', 'generic', 'password']):
        focus(entries[name])
        before = {key: entry.get_text() for key, entry in entries.items()}
        origin = trigger()
        if name in ['A', 'B']:
            assert origin, 'recording shortcut unavailable in ' + name
        rejected_mutations(40000 + index, origin)
        assert {key: entry.get_text() for key, entry in entries.items()} == before
        results.append(dict(scenario='gtk-' + name + '-manual-only', outcome='passed', shortcutAvailable=bool(origin)))
    focus(entries['A'])
    for attempt in range(10):
        origin = trigger()
        assert origin, 'recording shortcut lost after rejected delivery'
        rejected_mutations(42000 + attempt, origin)
    assert all(entry.get_text() == '' for entry in entries.values())
    results.append(dict(scenario='gtk-repeated-recording-shortcuts-no-mutation', outcome='passed', attempts=10))
    web = WebKit2.WebView()
    box.pack_start(web, True, True, 0)
    web.show()
    web.load_html('''<!doctype html><html><body><label>A<textarea id="a" spellcheck="true"></textarea></label><label>B<textarea id="b" spellcheck="true"></textarea></label><input id="password" type="password"><script>window.events=[];for(const e of document.querySelectorAll('textarea,input'))for(const kind of ['focus','blur','input','select','compositionstart','compositionupdate','compositionend'])e.addEventListener(kind,()=>events.push({kind,field:e.id,text:e.value,t:performance.now()}));</script></body></html>''', 'file:///')
    pump(1)
    def js(code):
        output = []
        def done(view, task, _):
            try:
                output.append(view.evaluate_javascript_finish(task).to_json(0))
            except Exception as error:
                output.append(error)
        web.evaluate_javascript(code, -1, None, None, None, done, None)
        deadline = time.monotonic() + 5
        while not output and time.monotonic() < deadline:
            pump(.02)
        assert output, 'WebKit JavaScript timeout'
        if isinstance(output[0], Exception):
            raise output[0]
        return json.loads(output[0])
    for index, name in enumerate(['a', 'b', 'password']):
        web.grab_focus()
        js('document.getElementById(' + json.dumps(name) + ').focus(); true')
        pump(.3)
        before = js('[a.value,b.value,password.value]')
        origin = trigger()
        rejected_mutations(41000 + index, origin)
        assert js('[a.value,b.value,password.value]') == before
        results.append(dict(scenario='webkit-' + name + '-manual-only', outcome='passed', shortcutAvailable=bool(origin)))
    # Retain both original critical reorderings, with equal text and geometry.
    js("for (const e of [a,b]) {e.style.cssText='position:absolute;left:40px;top:40px;width:200px;height:80px';e.value='same';} a.style.zIndex='2';b.style.zIndex='1'; true")
    for index, phase in enumerate(['before-start', 'after-rejected-start']):
        js('password.focus(); true')
        pump(.2)
        js('a.focus(); true')
        pump(.3)
        origin = trigger()
        assert origin, 'WebKit recording shortcut unavailable'
        before = js('[a.value,b.value,password.value]')
        if phase == 'after-rejected-start':
            rejected_mutations(44000 + index, origin)
        js('b.focus(); true')
        pump(.3)
        rejected_mutations(44000 + index, origin)
        assert js('[a.value,b.value,password.value]') == before
        results.append(dict(scenario='webkit-same-context-' + phase, outcome='passed', before=before, after=js('[a.value,b.value,password.value]')))
    mutations = js("events.filter(e=>e.kind==='input'||e.kind.startsWith('composition'))")
    assert mutations == [], 'rejected operations caused DOM input/composition events'
    event('webkit-events', events=js('window.events'))
    for chord in ['Alt+Shift+D', 'Control+Shift+space']:
        origin = trigger(chord)
        results.append(dict(scenario='webkit-recording-chord-' + chord, outcome='triggered' if origin else 'unavailable'))
    atspi.terminate()
    atspi.wait(timeout=3)
    accessibility_events = [json.loads(line) for line in (root / 'evidence/atspi-focus.jsonl').read_text().splitlines()]
    identities = {e['name']: e['path'] for e in accessibility_events if e['name'] in ['A', 'B']}
    assert identities.keys() == {'A', 'B'} and identities['A'] != identities['B']
    results.append(dict(scenario='webkit-distinct-atspi-identities', outcome='passed', atomicDeliveryProof=False))

finally:
    if atspi.poll() is None:
        atspi.terminate()
        atspi.wait(timeout=3)
    pixbuf = Gdk.pixbuf_get_from_window(window.get_window(), 0, 0, 1000, 700)
    pixbuf.savev(str(root / 'evidence/gtk.png'), 'png', [], [])
    report = dict(engineSourceHashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('voco_ibus_*.py')}, callbackTraceInstrumented=os.environ.get('VOCO_NATIVE_TRACE') == '1', protocolVersion=helper.PROTOCOL_VERSION, platform='private Xvfb X11', gtk='.'.join(map(str,[Gtk.MAJOR_VERSION,Gtk.MINOR_VERSION,Gtk.MICRO_VERSION])), webkit='.'.join(map(str,[WebKit2.get_major_version(),WebKit2.get_minor_version(),WebKit2.get_micro_version()])), results=results, events=events)
    (root / 'evidence/native.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    client.close()
    window.destroy()
