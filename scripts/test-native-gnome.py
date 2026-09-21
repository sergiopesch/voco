#!/usr/bin/python3
"""GNOME compositor and real Ubuntu tray qualification in a disposable namespace."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

if not __debug__:
    raise SystemExit('GNOME qualification requires assertions enabled')
root = Path(sys.argv[1])
evidence = root / 'evidence'
report = {'passed': False, 'scope': 'actual GNOME Shell/Mutter, isolated virtual session',
          'physicalMicrophone': False, 'installedSessionQualified': False,
          'inferenceRequested': os.environ.get('VOCO_GNOME_CAPTURE') == '1', 'toolkits': []}
shell = None
system_bus = None
pulse = None
try:
    assert 'DISPLAY' not in os.environ and 'WAYLAND_DISPLAY' not in os.environ
    assert not Path('/dev/input').exists() and not Path('/dev/snd').exists()
    assert os.environ['HOME'] == str(root / 'home')
    system_address = 'unix:path=' + str(root / 'runtime/system-test-bus')
    system_bus = subprocess.Popen(['dbus-daemon', '--session', '--nofork', '--address=' + system_address], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 5
    while not (root / 'runtime/system-test-bus').exists() and time.monotonic() < deadline:
        assert system_bus.poll() is None
        time.sleep(.02)
    assert (root / 'runtime/system-test-bus').exists()
    os.environ['DBUS_SYSTEM_BUS_ADDRESS'] = system_address
    report['systemServices'] = 'private bus only; no host system bus or logind'
    for schema, key, value in [
        ('org.gnome.shell', 'enabled-extensions', "['ubuntu-appindicators@ubuntu.com', 'voco-private-probe@test.invalid']"),
        ('org.gnome.shell', 'disable-user-extensions', 'false'),
        ('org.gnome.desktop.interface', 'enable-animations', 'false'),
        ('org.gnome.desktop.session', 'idle-delay', 'uint32 0'),
    ]:
        subprocess.run(['gsettings', 'set', schema, key, value], check=True, timeout=10)
    report['gnomeVersion'] = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    with (evidence / 'gnome-shell.log').open('w') as log:
        shell = subprocess.Popen(['gnome-shell', '--nested', '--wayland', '--no-x11',
                                  '--wayland-display=voco-gnome', '--sm-disable'],
                                 env={**os.environ, 'DISPLAY': ':77'}, stdout=log, stderr=subprocess.STDOUT)
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    def call(name, path, interface, method, values=None):
        return bus.call_sync(name, path, interface, method, values, None,
                             Gio.DBusCallFlags.NONE, 3000, None).unpack()
    from gi.repository import GLib
    call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
         'UpdateActivationEnvironment', GLib.Variant('(a{ss})', ({'WAYLAND_DISPLAY': 'voco-gnome', 'GDK_BACKEND': 'wayland', 'DBUS_SYSTEM_BUS_ADDRESS': system_address},)))
    deadline = time.monotonic() + 45
    owner = None
    while time.monotonic() < deadline:
        assert shell.poll() is None, 'GNOME Shell exited'
        try:
            owner = call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                         'org.freedesktop.DBus', 'GetNameOwner',
                         GLib.Variant('(s)', ('org.kde.StatusNotifierWatcher',)))[0]
            break
        except GLib.Error:
            time.sleep(.1)
    assert owner, 'Real GNOME appindicator watcher unavailable'
    pid = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
               'GetConnectionUnixProcessID', GLib.Variant('(s)', (owner,)))[0]
    assert pid == shell.pid, ('Watcher not owned by GNOME Shell', pid, shell.pid)
    probe = json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0])
    report['testOnlyGeometryBridge'] = {'available': True, 'initialWindows': probe}
    report['tray'] = {'realUbuntuExtension': True, 'ownerPid': pid, 'shellPid': shell.pid}
    socket = root / 'runtime/voco-gnome'
    assert socket.exists(), 'Native Wayland socket missing'
    env = {**os.environ, 'WAYLAND_DISPLAY': 'voco-gnome', 'GDK_BACKEND': 'wayland', 'RUST_LOG': 'info'}
    for version in ['3.0', '4.0']:
        run = subprocess.run(['/usr/bin/python3', str(Path(__file__).with_name('test-native-wayland.py')),
                              str(root), version], env=env, capture_output=True, text=True, timeout=45)
        (evidence / f'gtk-{version}.log').write_text(run.stdout + run.stderr)
        assert run.returncode == 0, run.stderr
        report['toolkits'].append(json.loads(run.stdout.strip().splitlines()[-1]))
    xenv = {**os.environ, 'DISPLAY': ':77', 'LD_LIBRARY_PATH': '/tmp/native-deps/lib/x86_64-linux-gnu'}
    outer_ids = subprocess.check_output(['/tmp/native-deps/bin/xdotool', 'search', '--pid', str(shell.pid)], env=xenv, text=True, timeout=5).splitlines()
    for window_id in outer_ids:
        raw = subprocess.check_output(['/tmp/native-deps/bin/xdotool', 'getwindowgeometry', '--shell', window_id], env=xenv, text=True, timeout=5)
        values = dict(line.split('=', 1) for line in raw.splitlines())
        if int(values['WIDTH']) >= 600 and int(values['HEIGHT']) >= 400:
            subprocess.run(['/tmp/native-deps/bin/xdotool', 'windowfocus', window_id, 'key', 'Escape'], env=xenv, check=True, timeout=5)
            report['overviewDismissal'] = 'private XTest Escape to nested Shell window'
    if os.environ.get('VOCO_GNOME_WEBKIT_SCROLL_PROBE') == '1':
        os.environ.update(env)
        gi.require_version('Gtk', '3.0')
        gi.require_version('WebKit2', '4.1')
        gi.require_version('Atspi', '2.0')
        from gi.repository import Gtk, WebKit2, Atspi
        Gtk.init([])
        target = Gtk.Window(title='VOCO private WebKit overflow probe')
        target.set_default_size(420, 300)
        view = WebKit2.WebView()
        target.add(view)
        target.show_all()
        view.load_html('<html><body style="margin:0"><div style="height:240px;overflow:auto"><p style="height:800px">Synthetic overflow fixture</p><button>Settings</button></div></body></html>', None)
        def find_setting():
            desktop = Atspi.get_desktop(0)
            pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count()) if desktop.get_child_at_index(i).get_process_id() == os.getpid()]
            while pending:
                node = pending.pop()
                if node.get_role() == Atspi.Role.PUSH_BUTTON and node.get_name() == 'Settings':
                    return node
                pending.extend(node.get_child_at_index(i) for i in range(node.get_child_count()))
            return None
        until = time.monotonic() + 15
        button = None
        while time.monotonic() < until:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            button = find_setting()
            if button:
                break
            time.sleep(.05)
        assert button, 'WebKit Settings fixture missing'
        def bounds():
            r = button.get_component_iface().get_extents(Atspi.CoordType.WINDOW)
            return [r.x, r.y, r.width, r.height]
        before = bounds()
        supported = button.get_component_iface().scroll_to(Atspi.ScrollType.ANYWHERE)
        until = time.monotonic() + 5
        while time.monotonic() < until:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            if bounds()[1] < 300:
                break
            time.sleep(.02)
        report['webKitScrollProbe'] = {'before': before, 'after': bounds(), 'scrollToAccepted': supported}
        assert supported and before[1] > 300 and 0 <= bounds()[1] < 300
        target.destroy()
    if os.environ.get('VOCO_GNOME_SCROLL_PROBE') == '1':
        os.environ.update(env)
        gi.require_version('Gtk', '3.0')
        from gi.repository import Gtk
        Gtk.init([])
        target = Gtk.Window(title='VOCO private scroll probe')
        target.set_default_size(400, 300)
        scroll = Gtk.ScrolledWindow()
        text = Gtk.TextView()
        text.get_buffer().set_text(''.join(f'Synthetic scroll row {i}\n' for i in range(100)))
        text.get_buffer().place_cursor(text.get_buffer().get_start_iter())
        key_events = []
        text.connect('key-press-event', lambda _, event: key_events.append(int(event.keyval)) or False)
        scroll.add(text)
        target.add(scroll)
        target.show_all()
        text.grab_focus()
        until = time.monotonic() + 10
        native = None
        while time.monotonic() < until:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            windows = json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0])
            native = next((window for window in windows if window['pid'] == os.getpid() and window['visible'] and window['focused']), None)
            if native:
                break
            time.sleep(.05)
        assert native, 'Scroll probe not visibly focused'
        before = scroll.get_vadjustment().get_value()
        x, y, width, height = native['frame']
        subprocess.run(['/tmp/native-deps/bin/xdotool', 'mousemove', '--sync', str(x + width // 2), str(y + height // 2), 'click', '--repeat', '5', '--delay', '40', '5'], env=xenv, check=True, timeout=5)
        until = time.monotonic() + 3
        while time.monotonic() < until:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            if scroll.get_vadjustment().get_value() > before:
                break
            time.sleep(.02)
        report['scrollProbe'] = {'nativeWindow': native, 'before': before, 'after': scroll.get_vadjustment().get_value()}
        subprocess.run(['/tmp/native-deps/bin/xdotool', 'key', 'Next'], env=xenv, check=True, timeout=5)
        until = time.monotonic() + 3
        while time.monotonic() < until:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            if scroll.get_vadjustment().get_value() > before:
                break
            time.sleep(.02)
        report['scrollProbe']['afterPageDown'] = scroll.get_vadjustment().get_value()
        report['scrollProbe']['keyEvents'] = key_events
        assert 65366 in key_events, 'Actual PageDown key event not received'
        assert report['scrollProbe']['afterPageDown'] > before, 'Private XTest PageDown did not scroll actual GTK fixture'
        target.destroy()
    if os.environ.get('VOCO_GNOME_CAPTURE') == '1':
        env.update(PULSE_SERVER='unix:' + str(root / 'runtime/pulse.sock'),
                   PULSE_SOURCE='voco_fixture', PULSE_SINK='fixture')
        os.environ.update(env)
        pulse = subprocess.Popen([os.environ['VOCO_WAYLAND_PULSEAUDIO'], '--daemonize=no', '--use-pid-file=no',
                                  '--exit-idle-time=-1', '--disable-shm=true', '-n',
                                  '--log-target=file:' + str(evidence / 'pulse.log'),
                                  '-L', 'module-native-protocol-unix socket=' + str(root / 'runtime/pulse.sock') + ' auth-anonymous=1',
                                  '-L', 'module-null-sink sink_name=fixture rate=48000',
                                  '-L', 'module-remap-source master=fixture.monitor source_name=voco_fixture'])
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
        assert model_hash == 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'
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
                report.setdefault('nativeWindows', []).append(json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0]))
                assert 'Bundled Nemotron streaming model ready' in (evidence / f'app-{cycle}.log').read_text()
                if os.environ.get('VOCO_GNOME_FOCUS_REOPEN') == '1' and cycle == 0:
                    observations = report.setdefault('focusReopen', [])
                    origin = time.monotonic()
                    def observe(stage):
                        windows = json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0])
                        state = [window for window in windows if window['pid'] == app.pid]
                        observations.append({'stage': stage, 'elapsed': time.monotonic() - origin, 'windows': state})
                        return next((window for window in state if window['visible'] and window['frame'][2] > 4), None)
                    clipboard = subprocess.Popen(['wl-copy', '--foreground'], env=env, text=True, stdin=subprocess.PIPE)
                    try:
                        clipboard.stdin.write('VOCO isolated focus diagnostic')
                        clipboard.stdin.close()
                        for attempt in range(3):
                            activate('Open VOCO')
                            wait_for(lambda: observe('before-read-' + str(attempt)))
                            read = subprocess.run(['wl-paste', '--no-newline'], env=env, text=True, capture_output=True, timeout=5)
                            observations.append({'stage': 'clipboard-read-' + str(attempt), 'verified': read.returncode == 0 and read.stdout == 'VOCO isolated focus diagnostic'})
                            observe('immediately-after-read-' + str(attempt))
                            activate('Open VOCO')
                            until = time.monotonic() + 2
                            while time.monotonic() < until:
                                pump(.05)
                                observe('after-immediate-open-' + str(attempt))
                    finally:
                        clipboard.terminate()
                        clipboard.wait(timeout=5)
                if os.environ.get('VOCO_GNOME_CAPTURE') == '1' and cycle == 0:
                    # The outer X11 window belongs only to this private Shell.
                    xenv = {**os.environ, 'DISPLAY': ':77', 'LD_LIBRARY_PATH': '/tmp/native-deps/lib/x86_64-linux-gnu'}
                    windows = subprocess.check_output(['/tmp/native-deps/bin/xdotool', 'search', '--pid', str(shell.pid)], env=xenv, text=True, timeout=5).splitlines()
                    parents = []
                    for window_id in windows:
                        raw = subprocess.check_output(['/tmp/native-deps/bin/xdotool', 'getwindowgeometry', '--shell', window_id], env=xenv, text=True, timeout=5)
                        values = dict(line.split('=', 1) for line in raw.splitlines())
                        if int(values['WIDTH']) >= 600 and int(values['HEIGHT']) >= 400:
                            parents.append({key: int(values[key]) for key in ['X', 'Y', 'WIDTH', 'HEIGHT']})
                    assert len(parents) == 1, parents
                    parent = parents[0]
                    def geometry(pid):
                        windows = json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0])
                        found = [window for window in windows if window['pid'] == pid and window['visible'] and window['frame'][2] > 4]
                        if len(found) != 1:
                            return None
                        window = found[0]
                        window['frame'][0] += parent['X']
                        window['frame'][1] += parent['Y']
                        return window
                    def reveal(pid, control):
                        assert control == 'Settings'
                        native = wait_for(lambda: geometry(pid))
                        assert native['focused'], 'Refuse private scroll into an unfocused app'
                        x, y, width, height = native['frame']
                        assert x >= 0 and y >= 0 and x + width <= 1280 and y + height <= 900
                        desktop = Atspi.get_desktop(0)
                        def find_control():
                            pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count()) if desktop.get_child_at_index(i).get_process_id() == pid]
                            for _ in range(500):
                                if not pending:
                                    break
                                node = pending.pop()
                                if node.get_role() == Atspi.Role.PUSH_BUTTON and node.get_name() == control:
                                    return node
                                pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
                            return None
                        button = wait_for(find_control)
                        accepted = button.get_component_iface().scroll_to(Atspi.ScrollType.ANYWHERE)
                        report.setdefault('privateScrollActions', []).append({'control': control, 'nativeWindowBefore': native, 'action': 'actual AT-SPI Component.scroll_to(ANYWHERE)', 'accepted': accepted})
                        assert accepted, 'Actual WebKit scroll action refused'
                        # Shared caller now checks contained live bounds, paint and
                        # matching focused native generation before activating it.
                    from test_native_wayland_capture import run_capture
                    report['inferenceRequested'] = True
                    report['capture'] = run_capture(root, app, pump, activate, geometry_provider=geometry, control_revealer=reveal)
                activate('Quit VOCO')
                assert app.wait(timeout=10) == 0
                report['application'].append({'cycle': cycle + 1, 'visibleFrame': visible,
                                             'modelCacheReady': True, 'initialReadinessCheck': 'verified model cache, before optional capture',
                                             'trayAction': 'real registered DBusMenu Event; not pointer activation'})
            finally:
                if app.poll() is None:
                    app.terminate()
                    app.wait(timeout=5)
    code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
    subprocess.run(['/usr/bin/python3', '-c', code, str(evidence / 'gnome-shell.png')],
                   env={**os.environ, 'DISPLAY': ':77', 'GDK_BACKEND': 'x11'}, check=True, timeout=10)
    report['passed'] = True
finally:
    code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
    subprocess.run(['/usr/bin/python3', '-c', code, str(evidence / 'final-state.png')], env={**os.environ, 'DISPLAY': ':77', 'GDK_BACKEND': 'x11'}, timeout=10)
    trace = root / 'state/voco/hotkey-trace.jsonl'
    if trace.exists():
        (evidence / 'hotkey-trace.jsonl').write_bytes(trace.read_bytes())
    if shell is not None:
        shell.terminate()
        try:
            shell.wait(timeout=8)
        except subprocess.TimeoutExpired:
            shell.kill()
            shell.wait(timeout=3)
    if pulse is not None:
        pulse.terminate()
        pulse.wait(timeout=5)
    if system_bus is not None:
        system_bus.terminate()
        system_bus.wait(timeout=3)
    report['sourceHashes'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in [Path(__file__), Path(__file__).with_suffix('.sh'), Path(__file__).with_name('test_native_wayland_capture.py'), *sorted(Path(__file__).with_name('fixtures').joinpath('gnome-private-probe').glob('*'))]}
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
