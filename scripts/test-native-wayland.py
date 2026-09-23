#!/usr/bin/python3
"""Real Wayland surfaces; subprocesses separate incompatible GI toolkit versions."""
if not __debug__:
    raise SystemExit("Wayland qualification requires assertions; unset PYTHONOPTIMIZE and do not use python -O.")

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

root = Path(sys.argv[1])
if len(sys.argv) > 2 and sys.argv[2] == '--manifest':
    import datetime
    evidence = root / 'evidence'
    (evidence / 'execution.json').write_text(json.dumps({
        'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'exitCode': int(sys.argv[3]),
        'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(evidence.iterdir()) if p.is_file()},
        'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__), Path(__file__).with_suffix('.sh'), Path(__file__).with_name('test_native_wayland_capture.py')]},
    }, indent=2) + '\n')
    sys.exit(0)
if len(sys.argv) > 2:
    import gi
    version = sys.argv[2]
    gi.require_version('Gtk', version)
    gi.require_version('Gdk', version)
    from gi.repository import Gtk, Gdk, GLib
    if version == '3.0':
        gi.require_version('WebKit2', '4.1')
        from gi.repository import WebKit2 as WebKit
        Gtk.init([])
    else:
        gi.require_version('WebKit', '6.0')
        from gi.repository import WebKit
        Gtk.init()
    window = Gtk.Window(title='VOCO isolated Wayland fixture')
    view = WebKit.WebView()
    if version == '3.0':
        window.add(view)
        window.show_all()
    else:
        window.set_child(view)
        window.present()
    loaded = []
    view.connect('load-changed', lambda _, event: loaded.append(event) if event == WebKit.LoadEvent.FINISHED else None)
    view.load_html('<textarea id="a">Synthetic café 🦀</textarea><textarea id="b"></textarea>', None)
    deadline = time.monotonic() + 20
    while not loaded and time.monotonic() < deadline:
        GLib.MainContext.default().iteration(False)
        time.sleep(.01)
    assert loaded, 'WebKit never loaded fixture'
    display_type = Gdk.Display.get_default().__gtype__.name
    assert 'Wayland' in display_type, display_type
    surface = window.get_window() if version == '3.0' else window.get_surface()
    assert surface is not None and window.get_mapped(), 'No mapped native surface'
    seat_available = Gdk.Display.get_default().get_default_seat() is not None
    clipboard_available = None
    if version == '3.0':
        clipboard_available = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD) is not None
    print(json.dumps({'gtk': version, 'display': display_type, 'surface': surface.__gtype__.name,
                      'webKit': '.'.join(str(f()) for f in [WebKit.get_major_version, WebKit.get_minor_version, WebKit.get_micro_version]),
                      'loaded': True, 'mapped': True, 'defaultSeatAvailable': seat_available,
                      'gtk3ClipboardObjectAvailable': clipboard_available}))
    window.destroy()
    sys.exit(0)

report = {'passed': False, 'physicalMicrophone': False, 'hardwareCompositor': False,
          'backend': os.environ.get('VOCO_WAYLAND_BACKEND', 'headless'),
          'toolkits': [], 'application': [], 'isolation': {'displayUnset': 'DISPLAY' not in os.environ,
          'soundDeviceAbsent': not Path('/dev/snd').exists(), 'inputDeviceAbsent': not Path('/dev/input').exists()}}
try:
    assert all(report['isolation'].values())
    assert not os.environ.get('VOCO_WAYLAND_APP_BINARY') or (root / 'voco').is_file(), 'Requested application missing'
    for version in ['3.0', '4.0']:
        result = subprocess.run(['/usr/bin/python3', __file__, str(root), version], text=True, capture_output=True, timeout=40)
        (root / f'evidence/gtk-{version}.log').write_text(result.stdout + result.stderr)
        assert result.returncode == 0, result.stderr
        report['toolkits'].append(json.loads(result.stdout.strip().splitlines()[-1]))
    # Capability observation only: a GTK clipboard object can exist even when
    # this headless compositor cannot provide cross-process clipboard ownership.
    if shutil.which('wl-copy') and shutil.which('wl-paste'):
        sentinel = 'VOCO private synthetic clipboard probe'
        probe = subprocess.Popen(['wl-copy', '--foreground'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            probe.stdin.write(sentinel)
            probe.stdin.close()
            time.sleep(.3)
            copied = subprocess.run(['wl-paste', '--no-newline'], text=True, capture_output=True, timeout=3)
            report['clipboardProbe'] = {'command': 'wl-copy --foreground',
                                        'exitCode': probe.poll(), 'readExitCode': copied.returncode,
                                        'readStderr': copied.stderr,
                                        'crossProcessReadbackVerified': copied.returncode == 0 and copied.stdout == sentinel}
        except subprocess.TimeoutExpired:
            report['clipboardProbe'] = {'command': 'wl-copy --foreground', 'timedOut': True,
                                        'crossProcessReadbackVerified': False}
        finally:
            if probe.poll() is None:
                probe.terminate()
            probe.wait(timeout=3)
            report['clipboardProbe']['stderr'] = probe.stderr.read()
        if report['backend'] == 'nested-x11':
            assert report['clipboardProbe']['crossProcessReadbackVerified'], 'Nested Wayland clipboard round trip failed'
    capture_requested = os.environ.get('VOCO_WAYLAND_CAPTURE') == '1'
    pulse = None
    if capture_requested:
        assert report['backend'] == 'nested-x11' and report['clipboardProbe']['crossProcessReadbackVerified']
        assert (root / 'voco').exists() and (root / 'speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf').exists()
        os.environ.update(PULSE_SERVER='unix:' + str(root / 'runtime/pulse.sock'),
                          PULSE_SOURCE='voco_fixture', PULSE_SINK='fixture')
        pulse = subprocess.Popen([os.environ['VOCO_WAYLAND_PULSEAUDIO'], '--daemonize=no', '--use-pid-file=no',
                                  '--exit-idle-time=-1', '--disable-shm=true', '-n',
                                  '--log-target=file:' + str(root / 'evidence/pulse.log'),
                                  '-L', 'module-native-protocol-unix socket=' + str(root / 'runtime/pulse.sock') + ' auth-anonymous=1',
                                  '-L', 'module-null-sink sink_name=fixture rate=48000',
                                  '-L', 'module-remap-source master=fixture.monitor source_name=voco_fixture'])
        deadline = time.monotonic() + 5
        while not (root / 'runtime/pulse.sock').exists() and time.monotonic() < deadline:
            assert pulse.poll() is None, 'Private PulseAudio exited'
            time.sleep(.02)
        assert (root / 'runtime/pulse.sock').exists(), 'Private audio socket missing'
        subprocess.run([os.environ['VOCO_WAYLAND_PACTL'], 'set-default-source', 'voco_fixture'], check=True, timeout=5)
        (root / 'evidence/pulse-sources.txt').write_text(subprocess.check_output([os.environ['VOCO_WAYLAND_PACTL'], 'list', 'short', 'sources'], text=True, timeout=5))
    if (root / 'voco').exists():
        import gi
        gi.require_version('Atspi', '2.0')
        from gi.repository import Gio, GLib, Atspi
        items = []
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        xml = '<node><interface name="org.kde.StatusNotifierWatcher"><method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method><method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method><property name="RegisteredStatusNotifierItems" type="as" access="read"/><property name="IsStatusNotifierHostRegistered" type="b" access="read"/><property name="ProtocolVersion" type="i" access="read"/></interface></node>'
        def method(connection, sender, path, interface, name, values, invocation):
            if name == 'RegisterStatusNotifierItem':
                service = values.unpack()[0]
                items.append((sender, service) if service.startswith('/') else (service, '/StatusNotifierItem'))
            invocation.return_value(None)
        def prop(connection, sender, path, interface, name):
            if name == 'RegisteredStatusNotifierItems':
                return GLib.Variant('as', [a + b for a, b in items])
            return GLib.Variant('b', True) if name == 'IsStatusNotifierHostRegistered' else GLib.Variant('i', 0)
        bus.register_object('/StatusNotifierWatcher', Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0], method, prop, None)
        Gio.bus_own_name_on_connection(bus, 'org.kde.StatusNotifierWatcher', Gio.BusNameOwnerFlags.NONE, None, None)
        def pump(seconds):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                GLib.MainContext.default().iteration(False)
                time.sleep(.01)
        def call(name, path, interface, method, values=None):
            return bus.call_sync(name, path, interface, method, values, None, Gio.DBusCallFlags.NONE, 2000, None).unpack()
        def activate(label):
            name, path = items[-1]
            menu = call(name, path, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierItem', 'Menu')))[0]
            layout = call(name, menu, 'com.canonical.dbusmenu', 'GetLayout', GLib.Variant('(iias)', (0, -1, ['label'])))[1]
            def find(node):
                if node[1].get('label') == label:
                    return node[0]
                for child in node[2]:
                    found = find(child)
                    if found is not None:
                        return found
            item = find(layout)
            assert item is not None, label
            call(name, menu, 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (item, 'clicked', GLib.Variant('s', ''), 0)))
        pump(.2)
        model = root / 'speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'
        report['model'] = {'provided': model.exists(), 'decoderLoaded': False}
        if model.exists():
            report['model']['sha256'] = hashlib.sha256(model.read_bytes()).hexdigest()
        def visible_app(pid):
            desktop = Atspi.get_desktop(0)
            for i in range(desktop.get_child_count()):
                app_node = desktop.get_child_at_index(i)
                if app_node.get_process_id() != pid:
                    continue
                for j in range(app_node.get_child_count()):
                    window = app_node.get_child_at_index(j)
                    states = window.get_state_set()
                    if states.contains(Atspi.StateType.SHOWING) and states.contains(Atspi.StateType.VISIBLE):
                        return {'name': window.get_name(), 'role': window.get_role_name()}
            return None
        report['appSha256'] = hashlib.sha256((root / 'voco').read_bytes()).hexdigest()
        for cycle in range(2):
            items.clear()
            with (root / f'evidence/app-{cycle}.log').open('w') as log:
                app = subprocess.Popen([str(root / 'voco')], stdout=log, stderr=subprocess.STDOUT,
                                       env={**os.environ, 'RUST_LOG': 'info', **({'VOCO_HOTKEY_TRACE': '1'} if capture_requested else {})})
                try:
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline and app.poll() is None and not (root / 'runtime/voco.sock').exists():
                        pump(.05)
                    assert app.poll() is None and (root / 'runtime/voco.sock').exists(), 'Application failed native Wayland startup'
                    pump(2)
                    assert app.poll() is None and items, 'No tray registration'
                    if model.exists():
                        deadline = time.monotonic() + 15
                        while time.monotonic() < deadline and 'Bundled Nemotron streaming model ready' not in (root / f'evidence/app-{cycle}.log').read_text():
                            assert app.poll() is None
                            pump(.05)
                        assert 'Bundled Nemotron streaming model ready' in (root / f'evidence/app-{cycle}.log').read_text(), 'Bundled model readiness was not observed'
                    activate('Open VOCO')
                    deadline = time.monotonic() + 15
                    visible = None
                    while time.monotonic() < deadline and visible is None:
                        pump(.1)
                        visible = visible_app(app.pid)
                    assert visible is not None, 'Tray Open did not expose a visible application window'
                    if capture_requested and cycle == 0:
                        from test_native_wayland_capture import run_capture
                        report['capture'] = run_capture(root, app, pump, activate)
                        report['model']['decoderLoaded'] = True
                    activate('Quit VOCO')
                    assert app.wait(timeout=10) == 0, 'Tray Quit was not clean'
                    report['application'].append({'cycle': cycle + 1, 'startup': True, 'trayOpenInvoked': True, 'visibleWindow': visible, 'modelCacheReady': model.exists(), 'trayQuitExitCode': 0, 'recordingRequested': capture_requested and cycle == 0})
                finally:
                    if app.poll() is None:
                        app.terminate()
                    app.wait(timeout=10)
            # Do not remove stale sockets: the next launch must handle its own state.
    if capture_requested:
        assert report.get('capture', {}).get('passed'), 'Requested capture-to-Copy was not verified'
    report['passed'] = True
finally:
    if locals().get('pulse') is not None:
        pulse.terminate()
        pulse.wait(timeout=5)
    (root / 'evidence/results.json').write_text(json.dumps(report, indent=2) + '\n')
