#!/usr/bin/python3
"""Actual KWin/Plasma in private namespaces, using only extracted runtime packages."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

if not __debug__:
    raise SystemExit('KDE qualification requires assertions enabled')
def validate_watcher_identity(kded, watcher, expected_exe, expected_sha, uid, namespace):
    assert kded['uniqueName'].startswith(':'), 'KDED must have a unique bus owner'
    assert watcher['uniqueName'] == kded['uniqueName'], 'Watcher must be owned by verified KDED'
    for identity in (kded, watcher):
        assert type(identity['pid']) is int and identity['pid'] > 0
        assert identity['pid'] == kded['pid']
        assert identity['uid'] == uid, 'Unexpected watcher user'
        assert identity['exe'] == expected_exe, 'Unexpected watcher executable'
        assert identity['exeSha256'] == expected_sha, 'Watcher executable bytes changed'
        assert identity['pidNamespace'] == namespace, 'Watcher is outside private PID namespace'


root = Path(sys.argv[1])
evidence = root / 'evidence'
report = {'passed': False, 'scope': 'actual KWin/Plasma, isolated virtual session',
          'physicalMicrophone': False, 'installedSessionQualified': False, 'toolkits': []}
children = []
try:
    assert 'DISPLAY' not in os.environ and 'WAYLAND_DISPLAY' not in os.environ
    assert not Path('/dev/input').exists() and not Path('/dev/snd').exists()
    capture_requested = os.environ.get('VOCO_KDE_CAPTURE') == '1'
    env = {**os.environ, 'PATH': '/tmp/kde-deps/bin:/usr/bin:/bin',
           'LD_LIBRARY_PATH': '/tmp/kde-deps/lib/x86_64-linux-gnu',
           'QT_PLUGIN_PATH': '/tmp/kde-deps/lib/x86_64-linux-gnu/qt5/plugins:/usr/lib/x86_64-linux-gnu/qt5/plugins',
           'QML2_IMPORT_PATH': '/tmp/kde-deps/lib/x86_64-linux-gnu/qt5/qml:/usr/lib/x86_64-linux-gnu/qt5/qml',
           'XDG_DATA_DIRS': '/tmp/kde-deps/share:/usr/local/share:/usr/share',
           'XDG_CONFIG_DIRS': '/etc/xdg'}
    report['kwinVersion'] = subprocess.check_output(['/tmp/kde-deps/bin/kwin_wayland', '--version'], env={**env, 'QT_QPA_PLATFORM': 'offscreen'}, text=True).strip()
    def start(args, name, child_env):
        with (evidence / name).open('w') as log:
            child = subprocess.Popen(args, env=child_env, stdout=log, stderr=subprocess.STDOUT)
        children.append(child)
        return child
    system_address = 'unix:path=' + str(root / 'runtime/system-test-bus')
    start(['dbus-daemon', '--session', '--nofork', '--address=' + system_address], 'system-bus.log', env)
    env['DBUS_SYSTEM_BUS_ADDRESS'] = system_address
    kwin = start(['/tmp/kde-deps/bin/kwin_wayland', '--x11-display', ':77', '--width', '1280', '--height', '900',
                  '--socket', 'voco-kde', '--no-lockscreen', '--no-kactivities'], 'kwin.log', {**env, 'DISPLAY': ':77'})
    until = time.monotonic() + 30
    while not (root / 'runtime/voco-kde').exists() and time.monotonic() < until:
        assert kwin.poll() is None, 'KWin exited before native Wayland socket'
        time.sleep(.05)
    assert (root / 'runtime/voco-kde').exists()
    env.update(WAYLAND_DISPLAY='voco-kde', GDK_BACKEND='wayland', QT_QPA_PLATFORM='wayland')
    for version in ['3.0', '4.0']:
        run = subprocess.run(['/usr/bin/python3', str(Path(__file__).with_name('test-native-wayland.py')), str(root), version],
                             env=env, capture_output=True, text=True, timeout=45)
        (evidence / f'gtk-{version}.log').write_text(run.stdout + run.stderr)
        assert run.returncode == 0, run.stderr
        report['toolkits'].append(json.loads(run.stdout.strip().splitlines()[-1]))
    import gi
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'UpdateActivationEnvironment',
                  GLib.Variant('(a{ss})', ({key: env[key] for key in ['WAYLAND_DISPLAY', 'GDK_BACKEND', 'QT_QPA_PLATFORM', 'DBUS_SYSTEM_BUS_ADDRESS']},)),
                  None, Gio.DBusCallFlags.NONE, 3000, None)
    def call(service, path, interface, method, params=None):
        return bus.call_sync(service, path, interface, method, params, None, Gio.DBusCallFlags.NONE, 3000, None).unpack()
    # Use one activation path. Introspecting an unowned well-known name after
    # Popen races D-Bus auto-activation and can create a second legitimate KDED.
    service = root / 'data/dbus-1/services/org.kde.kded5.service'
    assert 'Name=org.kde.kded5' in service.read_text().splitlines()
    assert 'Exec=/tmp/kde-deps/bin/kded5' in service.read_text().splitlines()
    activation_status = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                             'StartServiceByName', GLib.Variant('(su)', ('org.kde.kded5', 0)))[0]
    assert activation_status in (1, 2)
    kded_unique = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                      'GetNameOwner', GLib.Variant('(s)', ('org.kde.kded5',)))[0]
    expected_kded = '/tmp/kde-deps/bin/kded5'
    expected_hash = hashlib.sha256(Path(expected_kded).read_bytes()).hexdigest()
    own_namespace = os.readlink('/proc/self/ns/pid')

    def identity(name):
        unique = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                      'GetNameOwner', GLib.Variant('(s)', (name,)))[0]
        pid = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                   'GetConnectionUnixProcessID', GLib.Variant('(s)', (unique,)))[0]
        uid = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                   'GetConnectionUnixUser', GLib.Variant('(s)', (unique,)))[0]
        proc = Path('/proc') / str(pid)
        return {'uniqueName': unique, 'pid': pid, 'uid': uid,
                'exe': os.readlink(proc / 'exe'),
                'exeSha256': hashlib.sha256((proc / 'exe').read_bytes()).hexdigest(),
                'pidNamespace': os.readlink(proc / 'ns/pid')}

    kded_identity = identity('org.kde.kded5')
    assert kded_identity['uniqueName'] == kded_unique
    validate_watcher_identity(kded_identity, kded_identity, expected_kded, expected_hash, os.getuid(), own_namespace)
    deadline = time.monotonic() + 15
    while True:
        try:
            xml = call(kded_unique, '/kded', 'org.freedesktop.DBus.Introspectable', 'Introspect')[0]
            (evidence / 'kded-interface.xml').write_text(xml)
            assert 'loadModule' in xml
            loaded = call(kded_unique, '/kded', 'org.kde.kded5', 'loadModule', GLib.Variant('(s)', ('statusnotifierwatcher',)))[0]
            assert loaded, 'Real KDE watcher module did not load'
            report['watcherActivation'] = 'actual kded loadModule(statusnotifierwatcher), observed introspection'
            break
        except GLib.Error:
            if time.monotonic() >= deadline:
                raise
            time.sleep(.05)
    plasma = start(['/tmp/kde-deps/bin/plasmashell'], 'plasmashell.log', env)
    import gi
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    until = time.monotonic() + 30
    watcher_identity = None
    while time.monotonic() < until:
        assert kwin.poll() is None and plasma.poll() is None, 'KWin or Plasma exited'
        try:
            watcher_identity = identity('org.kde.StatusNotifierWatcher')
            break
        except GLib.Error:
            time.sleep(.1)
    assert watcher_identity is not None, 'Real watcher did not acquire private bus name'
    validate_watcher_identity(kded_identity, watcher_identity, expected_kded, expected_hash, os.getuid(), own_namespace)
    assert identity('org.kde.kded5') == kded_identity, 'KDED owner changed during activation'
    assert identity('org.kde.StatusNotifierWatcher') == watcher_identity, 'Watcher owner changed during validation'
    assert bus.get_guid(), 'Private session bus GUID missing'
    report['tray'] = {'ownerPid': watcher_identity['pid'], 'kdedPid': kded_identity['pid'],
                      'plasmaPid': plasma.pid, 'activationStatus': activation_status,
                      'kdedIdentity': kded_identity, 'watcherIdentity': watcher_identity,
                      'privateBusGuid': bus.get_guid(), 'sessionBusAddress': os.environ['DBUS_SESSION_BUS_ADDRESS'],
                      'testUniqueName': bus.get_unique_name(), 'activationServiceSha256': hashlib.sha256(service.read_bytes()).hexdigest()}
    # Test-only read-only KWin script, routed only over this private bus.
    observations = {}
    info = Gio.DBusNodeInfo.new_for_xml('<node><interface name="org.voco.PrivateKWinProbe"><method name="Record"><arg type="s" direction="in"/></method></interface></node>')
    def recorded(connection, sender, path, interface, method, parameters, invocation):
        payload = json.loads(parameters.unpack()[0])
        observations[payload['request']] = payload['windows']
        invocation.return_value(GLib.Variant('()', ()))
    bus.register_object('/org/voco/PrivateKWinProbe', info.interfaces[0], recorded, None, None)
    (evidence / 'kwin-scripting-interface.xml').write_text(call('org.kde.KWin', '/Scripting', 'org.freedesktop.DBus.Introspectable', 'Introspect')[0])
    xenv = {**env, 'DISPLAY': ':77', 'LD_LIBRARY_PATH': '/tmp/native-deps/lib/x86_64-linux-gnu'}
    ids = subprocess.check_output(['/tmp/native-deps/bin/xdotool', 'search', '--pid', str(kwin.pid)], env=xenv, text=True).splitlines()
    parent_frames = []
    for window_id in ids:
        raw = subprocess.check_output(['/tmp/native-deps/bin/xdotool', 'getwindowgeometry', '--shell', window_id], env=xenv, text=True)
        values = dict(line.split('=', 1) for line in raw.splitlines())
        if int(values['WIDTH']) >= 600 and int(values['HEIGHT']) >= 400:
            parent_frames.append([int(values[k]) for k in ['X', 'Y', 'WIDTH', 'HEIGHT']])
    assert parent_frames == [[0, 0, 1280, 900]], parent_frames
    report['privateParentFrames'] = parent_frames
    geometry_sequence = 0
    def geometry(pid):
        global geometry_sequence
        geometry_sequence += 1
        request = str(geometry_sequence)
        script = root / ('geometry-' + request + '.js')
        script.write_text('var rows=workspace.clientList().filter(function(w){return w.pid===' + str(pid) + ';}).map(function(w){var r=w.frameGeometry;return {pid:w.pid,generation:String(w.internalId),frame:[r.x,r.y,r.width,r.height],visible:!w.minimized,focused:w.active};});callDBus(' + json.dumps(bus.get_unique_name()) + ',"/org/voco/PrivateKWinProbe","org.voco.PrivateKWinProbe","Record",JSON.stringify({request:' + json.dumps(request) + ',windows:rows}));')
        script_id = call('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'loadScript', GLib.Variant('(ss)', (str(script), 'voco-private-' + request)))[0]
        assert script_id >= 0
        call('org.kde.KWin', '/' + str(script_id), 'org.kde.kwin.Script', 'run')
        deadline = time.monotonic() + 3
        while request not in observations and time.monotonic() < deadline:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            time.sleep(.01)
        assert request in observations, 'KWin geometry response missing'
        rows = [w for w in observations[request] if w['frame'][2] > 4 and w['frame'][3] > 4]
        report.setdefault('nativeGeometryObservations', []).append({'request': request, 'windows': observations[request]})
        call('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', GLib.Variant('(s)', ('voco-private-' + request,)))
        if len(rows) != 1:
            return None
        rows[0]['positionBasis'] = 'private KWin native frame + verified zero-origin private Xvfb parent'
        return rows[0]
    os.environ.update(env)
    env['RUST_LOG'] = 'info'

    if capture_requested:
        env.update(PULSE_SERVER='unix:' + str(root / 'runtime/pulse.sock'),
                   PULSE_SOURCE='voco_fixture', PULSE_SINK='fixture')
        os.environ.update(env)
        pulse = subprocess.Popen([os.environ['VOCO_WAYLAND_PULSEAUDIO'], '--daemonize=no', '--use-pid-file=no',
                                  '--exit-idle-time=-1', '--disable-shm=true', '-n',
                                  '--log-target=file:' + str(evidence / 'pulse.log'),
                                  '-L', 'module-native-protocol-unix socket=' + str(root / 'runtime/pulse.sock') + ' auth-anonymous=1',
                                  '-L', 'module-null-sink sink_name=fixture rate=48000',
                                  '-L', 'module-remap-source master=fixture.monitor source_name=voco_fixture'])
        children.append(pulse)
        until = time.monotonic() + 5
        while not (root / 'runtime/pulse.sock').exists() and time.monotonic() < until:
            assert pulse.poll() is None
            time.sleep(.02)
        assert (root / 'runtime/pulse.sock').exists()
        subprocess.run([os.environ['VOCO_WAYLAND_PACTL'], 'set-default-source', 'voco_fixture'], check=True, timeout=5)
    if (root / 'voco').exists():
        gi.require_version('Atspi', '2.0')
        from gi.repository import Atspi
        model = root / 'speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'
        assert model.exists(), 'Lifecycle acceptance requires pinned model cache'
        model_hash = hashlib.sha256(model.read_bytes()).hexdigest()
        assert model_hash == 'd9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d'
        report['modelSha256'] = model_hash
        report['appSha256'] = hashlib.sha256((root / 'voco').read_bytes()).hexdigest()
        report['application'] = []
        def pump(seconds=0):
            end = time.monotonic() + seconds
            while True:
                while GLib.MainContext.default().pending():
                    GLib.MainContext.default().iteration(False)
                if time.monotonic() >= end:
                    break
                time.sleep(.01)
        def wait_for(fn, seconds=20):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                pump()
                value = fn()
                if value:
                    return value
                time.sleep(.05)
            raise AssertionError('Timed out waiting for ' + fn.__name__)
        def visible_app():
            desktop = Atspi.get_desktop(0)
            for i in range(desktop.get_child_count()):
                node = desktop.get_child_at_index(i)
                if node is not None and node.get_process_id() == app.pid:
                    for j in range(node.get_child_count()):
                        frame = node.get_child_at_index(j)
                        if frame is None:
                            continue  # A restarting accessibility tree may shrink between queries.
                        states = frame.get_state_set()
                        if states.contains(Atspi.StateType.SHOWING) and states.contains(Atspi.StateType.VISIBLE):
                            rect = frame.get_extents(Atspi.CoordType.WINDOW)
                            report['lastVisibleFrame'] = {'name': frame.get_name(), 'bounds': [rect.x, rect.y, rect.width, rect.height]}
                            if rect.width >= 300 and rect.height >= 300:
                                return {'name': frame.get_name(), 'bounds': [rect.x, rect.y, rect.width, rect.height]}
            return None
        for cycle in range(2):
            trace = root / 'state/voco/hotkey-trace.jsonl'
            previous_ready_count = trace.read_text().count('frontend_hotkey_handler_ready') if trace.exists() else 0
            with (evidence / f'app-{cycle}.log').open('w') as log:
                app = subprocess.Popen([str(root / 'voco')], env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                def registered():
                    assert app.poll() is None, 'App exited before tray registration'
                    values = call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
                                  'org.freedesktop.DBus.Properties', 'Get',
                                  GLib.Variant('(ss)', ('org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems')))[0]
                    matching = []
                    for identifier in values:
                        candidate = identifier.split('@', 1)[0].split('/', 1)[0]
                        try:
                            owner_pid = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID', GLib.Variant('(s)', (candidate,)))[0]
                            if owner_pid == app.pid:
                                matching.append(identifier)
                        except GLib.Error:
                            pass
                    return matching if matching else None
                values = wait_for(registered)
                report['registeredItems'] = list(values)
                identifier = values[-1]
                if '@/' in identifier:
                    service, item_path = identifier.split('@', 1)
                elif '/' in identifier:
                    service, item_path = identifier.split('/', 1)
                    item_path = '/' + item_path
                else:
                    service, item_path = identifier, '/StatusNotifierItem'
                assert Gio.dbus_is_name(service), identifier
                menu = call(service, item_path, 'org.freedesktop.DBus.Properties', 'Get',
                            GLib.Variant('(ss)', ('org.kde.StatusNotifierItem', 'Menu')))[0]
                def activate(label):
                    layout = call(service, menu, 'com.canonical.dbusmenu', 'GetLayout',
                                  GLib.Variant('(iias)', (0, -1, ['label'])))[1]
                    def find(node):
                        if node[1].get('label') == label:
                            return node[0]
                        for child in node[2]:
                            value = find(child)
                            if value is not None:
                                return value
                    item = find(layout)
                    assert item is not None, label
                    call(service, menu, 'com.canonical.dbusmenu', 'Event',
                         GLib.Variant('(isvu)', (item, 'clicked', GLib.Variant('s', ''), 0)))
                def cache_ready():
                    assert app.poll() is None
                    return 'Bundled Nemotron streaming model ready' in (evidence / f'app-{cycle}.log').read_text()
                wait_for(cache_ready)
                def frontend_ready():
                    trace = root / 'state/voco/hotkey-trace.jsonl'
                    return trace.exists() and trace.read_text().count('frontend_hotkey_handler_ready') > previous_ready_count
                wait_for(frontend_ready)
                activate('Open VOCO')
                visible = wait_for(visible_app)
                report.setdefault('appNativeGeometry', []).append(geometry(app.pid))
                if capture_requested and cycle == 0:
                    from test_native_wayland_capture import run_capture
                    report['capture'] = run_capture(root, app, pump, activate, geometry_provider=geometry)

                activate('Quit VOCO')
                assert app.wait(timeout=10) == 0
                report['application'].append({'cycle': cycle + 1, 'visibleFrame': visible, 'modelCacheOnlyCheck': True,
                                              'inferenceRequested': capture_requested and cycle == 0, 'trayAction': 'real DBusMenu Event, not pointer activation'})
            finally:
                if app.poll() is None:
                    app.terminate()
                    app.wait(timeout=5)
    report['passed'] = True
finally:
    code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
    subprocess.run(['/usr/bin/python3', '-c', code, str(evidence / 'final-state.png')],
                   env={**os.environ, 'DISPLAY': ':77', 'GDK_BACKEND': 'x11'}, timeout=10)
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=3)
    report['sourceHashes'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in [Path(__file__), Path(__file__).with_suffix('.sh')]}
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
