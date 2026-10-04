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
          'inferenceRequested': os.environ.get('VOCO_GNOME_ONBOARDING') == '1', 'toolkits': []}
shell = None
system_bus = None
pulse = None
try:
    assert 'DISPLAY' not in os.environ and 'WAYLAND_DISPLAY' not in os.environ
    assert not any(Path(path).exists() for path in ('/dev/input', '/dev/snd'))
    # Only the cursor journey types, through the app's real virtual keyboard.
    assert Path('/dev/uinput').is_char_device() == (os.environ.get('VOCO_GNOME_CURSOR') == '1')
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
    enabled_extensions = ['ubuntu-appindicators@ubuntu.com', 'voco-private-probe@test.invalid']
    if os.environ.get('VOCO_GNOME_CURSOR') == '1':
        enabled_extensions.append('voco-panel@voco.local')
    for schema, key, value in [
        ('org.gnome.shell', 'enabled-extensions', str(enabled_extensions)),
        ('org.gnome.shell', 'disable-user-extensions', 'false'),
        ('org.gnome.desktop.interface', 'enable-animations', 'false'),
        ('org.gnome.desktop.session', 'idle-delay', 'uint32 0'),
    ]:
        subprocess.run(['gsettings', 'set', schema, key, value], check=True, timeout=10)
    report['gnomeVersion'] = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    with (evidence / 'gnome-shell.log').open('w') as log:
        shell_accessibility = {'NO_AT_BRIDGE': '1'} if os.environ.get('VOCO_GNOME_CURSOR') == '1' else {}
        report['nestedShellAccessibilityDisabled'] = bool(shell_accessibility)
        shell = subprocess.Popen(['gnome-shell', '--nested', '--wayland', '--no-x11',
                                  '--wayland-display=voco-gnome', '--sm-disable'],
                                 env={**os.environ, 'DISPLAY': ':77', **shell_accessibility}, stdout=log, stderr=subprocess.STDOUT)
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
    # The optional dependency bundle need only supply Xvfb. Either helper is
    # mounted read-only; its input operations target only the private X server.
    bundled_xdotool = Path('/tmp/native-deps/bin/xdotool')
    xdotool = bundled_xdotool if os.access(bundled_xdotool, os.X_OK) else Path('/usr/bin/xdotool')
    assert xdotool.is_file() and os.access(xdotool, os.X_OK), 'Install xdotool or include it in VOCO_NATIVE_DEPS'
    xenv = {**os.environ, 'DISPLAY': ':77'}
    xenv.pop('LD_LIBRARY_PATH', None)
    if xdotool == bundled_xdotool:
        xenv['LD_LIBRARY_PATH'] = '/tmp/native-deps/lib/x86_64-linux-gnu'
    report['privateXTestHelper'] = {'path': str(xdotool), 'sha256': hashlib.sha256(xdotool.read_bytes()).hexdigest(), 'display': ':77'}
    outer_ids = subprocess.check_output([str(xdotool), 'search', '--pid', str(shell.pid)], env=xenv, text=True, timeout=5).splitlines()
    for window_id in outer_ids:
        raw = subprocess.check_output([str(xdotool), 'getwindowgeometry', '--shell', window_id], env=xenv, text=True, timeout=5)
        values = dict(line.split('=', 1) for line in raw.splitlines())
        if int(values['WIDTH']) >= 600 and int(values['HEIGHT']) >= 400:
            subprocess.run([str(xdotool), 'windowfocus', window_id, 'key', 'Escape'], env=xenv, check=True, timeout=5)
            report['overviewDismissal'] = 'private XTest Escape to nested Shell window'
    if os.environ.get('VOCO_GNOME_ONBOARDING') == '1' or os.environ.get('VOCO_GNOME_CURSOR') == '1':
        pulse_socket = Path(f'/run/user/{os.getuid()}/pulse/native')
        env.update(PULSE_SERVER='unix:' + str(pulse_socket),
                   PULSE_SOURCE='voco_fixture', PULSE_SINK='fixture')
        os.environ.update(env)
        pulse = subprocess.Popen([os.environ['VOCO_WAYLAND_PULSEAUDIO'], '--daemonize=no', '--use-pid-file=no',
                                  '--exit-idle-time=-1', '--disable-shm=true', '-n',
                                  '--log-target=file:' + str(evidence / 'pulse.log'),
                                  '-L', 'module-native-protocol-unix socket=' + str(pulse_socket) + ' auth-anonymous=1',
                                  '-L', 'module-null-sink sink_name=fixture rate=48000',
                                  '-L', 'module-remap-source master=fixture.monitor source_name=voco_fixture source_properties=object.serial=1'])
        until = time.monotonic() + 5
        while not pulse_socket.exists() and time.monotonic() < until:
            assert pulse.poll() is None
            time.sleep(.02)
        assert pulse_socket.exists()
        subprocess.run([os.environ['VOCO_WAYLAND_PACTL'], 'set-default-source', 'voco_fixture'], check=True, timeout=5)
    if (root / 'voco').exists():
        gi.require_version('Atspi', '2.0')
        import native_tray_app as tray
        report['modelSha256'] = tray.pinned_model(root, evidence)
        report['appSha256'] = hashlib.sha256((root / 'voco').read_bytes()).hexdigest()
        report['application'] = []
        pump, wait_for = tray.pump, tray.wait_for
        def visible_app():
            return tray.visible_app(app, report)
        review_mode = os.environ.get('VOCO_GNOME_CRASH_REVIEW') == '1'
        if review_mode:
            assert os.environ.get('VOCO_GNOME_ONBOARDING') != '1', 'Crash review needs completed onboarding'
            from test_native_crash_review import seed_crash, run_review
            seed_crash(root)
        for cycle in range(2):
            trace = root / 'state/voco/hotkey-trace.jsonl'
            previous_ready_count = trace.read_text().count('frontend_hotkey_handler_ready') if trace.exists() else 0
            with (evidence / f'app-{cycle}.log').open('w') as log:
                app = subprocess.Popen([str(root / 'voco')], env={**env, 'VOCO_HOTKEY_TRACE': '1'}, stdout=log, stderr=subprocess.STDOUT)
            try:
                service, menu = tray.tray_menu(call, app, report)
                def activate(label):
                    tray.dbusmenu_activate(call, service, menu, label)
                tray.wait_ready(app, evidence / f'app-{cycle}.log', trace, previous_ready_count)
                if review_mode:
                    report.setdefault('crashReview', []).append(run_review(root, app, pump, activate,
                        lambda: json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0]), env, cycle))
                if os.environ.get('VOCO_GNOME_CURSOR') == '1' and cycle == 0:
                    from test_native_cursor_capture import run_cursor
                    report['cursorCapture'] = run_cursor(root, app, pump,
                        lambda: json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0]), activate)
                onboarding_cycle = os.environ.get('VOCO_GNOME_ONBOARDING') == '1' and cycle == 0
                if not onboarding_cycle:
                    activate('Open VOCO')
                visible = wait_for(visible_app)
                report.setdefault('nativeWindows', []).append(json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0]))
                assert 'Bundled Nemotron streaming model ready' in (evidence / f'app-{cycle}.log').read_text()
                if os.environ.get('VOCO_GNOME_ONBOARDING') == '1' and cycle == 0:
                    from test_native_onboarding_capture import run_onboarding
                    report['onboarding'] = run_onboarding(root, app, pump, lambda: json.loads(call('org.gnome.Shell', '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe', 'GetWindows')[0]))
                activate('Quit VOCO')
                assert app.wait(timeout=10) == 0
                report['application'].append({'cycle': cycle + 1, 'visibleFrame': visible,
                                             'modelCacheReady': True, 'initialReadinessCheck': 'verified model cache, before optional capture',
                                             'trayAction': 'startup onboarding; real DBusMenu Quit' if onboarding_cycle else 'real registered DBusMenu Event; not pointer activation'})
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
    sources = evidence / 'sources'
    report['sourceHashes'] = {str(path.relative_to(sources)): hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in sorted(sources.rglob('*')) if path.is_file()}
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
