#!/usr/bin/python3
"""Real GNOME actors with a synthetic, transcript-free panel protocol fixture."""
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
import time
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib
root = Path(sys.argv[1]); evidence = root / 'evidence'
# test-gnome-panel.sh chooses the mode from the Shell's major version.
mode = os.environ['VOCO_PANEL_SHELL_MODE']; assert mode in ('nested', 'headless'), mode
# bridge skips the synthetic cases and checks only the app's tray bridge.
suite = os.environ['VOCO_PANEL_SUITE']; assert suite in ('full', 'bridge'), suite
headless = mode == 'headless'
shell_version = subprocess.check_output(['gnome-shell', '--version'], text=True).split()[-1]
report = {'passed': False, 'suite': suite, 'scope': f'GNOME {shell_version.split(".")[0]} {mode} Wayland, ' +
          ('synthetic app service' if suite == 'full' else "the app's tray bridge, without the synthetic cases"),
          'shellVersion': shell_version, 'states': {}}
state = dict(version=1, token='1:1', stopSession='1:1', status='idle', description='Ready', canStop=False, canOpen=True, level=0)
actions = []; attached = []; detached = []; fail_next = []; stalled = []; stall_state = []
reservations = []; held = []; hold_reservation = []; fail_reservation = []; stop_reservations = []
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
# The synthetic service serves the app's own interface, so it can't drift from panel.rs.
panel_rs = (Path(__file__).resolve().parents[1] / 'apps/desktop/src-tauri/src/panel.rs').read_text()
xml = re.search(r'const XML: &str = r#"(.*?)"#;', panel_rs, re.S).group(1)
SUPPORTED = ('<Alt>d', '<Alt><Shift>d')
def shortcut_token():
    # Stop-only field the native app still publishes for a loaded v10 companion.
    if state['status'] in ('starting','recording','processing') and state.get('stopSession') and state.get('stopAccelerator') in SUPPORTED:
        return state['stopSession'] + '/' + state['stopAccelerator']
    return None
def snapshot():
    return json.dumps({**state, 'stopShortcutToken': shortcut_token()})
def method(connection, sender, path, interface, name, params, invocation):
    if name == 'Attach':
        attached.append(sender); invocation.return_value(GLib.Variant('(b)', (True,)))
    elif name == 'GetState':
        if stall_state:
            stalled.append(invocation); return
        if fail_next:
            fail_next.pop(); invocation.return_dbus_error('org.voco.TestUnavailable', 'Synthetic transient failure')
        else: invocation.return_value(GLib.Variant('(s)', (snapshot(),)))
    elif name == 'ReserveShortcut':
        if hold_reservation:
            held.append(invocation); return
        if fail_reservation:
            fail_reservation.pop(); invocation.return_dbus_error('org.voco.TestUnavailable', 'Synthetic transient failure'); return
        accelerator = params.unpack()[0]
        accepted = accelerator in SUPPORTED and accelerator == state.get('shortcutAccelerator')
        reservations.append((time.monotonic(), accelerator, accepted))
        invocation.return_value(GLib.Variant('(b)', (accepted,)))
    elif name == 'ReserveStopShortcut':
        stop_reservations.append(params.unpack()[0])
        invocation.return_value(GLib.Variant('(b)', (params.unpack()[0] == shortcut_token(),)))
    elif name == 'Action':
        action, token = params.unpack()
        # A consumed chord is the plain toggle; the native app decides Start or Stop.
        accepted = (action == 'shortcut' and token == '') or (action == 'stop' and state['canStop'] and token == state['stopSession']) or (action in ('open','settings','review') and state['canOpen'] and token == state['token'])
        if accepted: actions.append((action, token))
        invocation.return_value(GLib.Variant('(b)', (accepted,)))
    elif name == 'Detach':
        detached.append(sender); invocation.return_value(None)
registration = bus.register_object('/org/voco/Panel', Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0], method, None, None)
owner = Gio.bus_own_name_on_connection(bus, 'org.voco.Panel', Gio.BusNameOwnerFlags.NONE, None, None)
def pump(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        while GLib.MainContext.default().pending(): GLib.MainContext.default().iteration(False)
        time.sleep(.005)
def call(method, params=None):
    return bus.call_sync('org.gnome.Shell', '/org/voco/PanelProbe', 'org.voco.PanelProbe', method, params, None, Gio.DBusCallFlags.NONE, 1500, None)
def inspect(): return json.loads(call('Inspect').unpack()[0])
def screenshot(name):
    if headless:
        # No host window to capture; the probe renders the same stage areas.
        for prefix, height in (('', 600), ('panel-', 32)):
            bus.call_sync('org.gnome.Shell', '/org/voco/PanelProbe', 'org.voco.PanelProbe', 'Screenshot',
                GLib.Variant('(siiii)', (str(evidence / (prefix+name+'.png')), 0, 0, 800, height)),
                None, Gio.DBusCallFlags.NONE, 5000, None)
        return
    code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,800,600);p.savev(__import__('sys').argv[1],'png',[],[])"
    subprocess.run(['/usr/bin/python3','-c',code,str(evidence / (name+'.png'))], env={**os.environ,'DISPLAY':':77','GDK_BACKEND':'x11'}, check=True)
    panel_code = code.replace('800,600)', '800,32)')
    subprocess.run(['/usr/bin/python3','-c',panel_code,str(evidence / ('panel-'+name+'.png'))], env={**os.environ,'DISPLAY':':77','GDK_BACKEND':'x11'}, check=True)
def start_shell():
    if headless:
        # GNOME 50 has neither --nested nor --sm-disable. The virtual monitor has
        # the nested window's 800x600, so every geometry check keeps its meaning.
        return subprocess.Popen(['gnome-shell','--headless','--virtual-monitor','800x600','--wayland','--no-x11','--force-animations','--wayland-display=voco-panel-test'], stdout=log,stderr=subprocess.STDOUT)
    return subprocess.Popen(['gnome-shell','--nested','--wayland','--no-x11','--force-animations','--wayland-display=voco-panel-test','--sm-disable'], env={**os.environ,'DISPLAY':':77'}, stdout=log,stderr=subprocess.STDOUT)
class RemoteInput:
    """Real compositor input through Mutter's RemoteDesktop API, the path GNOME Remote Desktop uses."""
    # Evdev key and button codes.
    KEYS = {'alt': 56, 'Alt_L': 56, 'Alt_R': 100, 'shift': 42, 'Shift_L': 42, 'Shift_R': 54,
            'Control_L': 29, 'Control_R': 97, 'Super_L': 125, 'Super_R': 126, 'd': 32, 'space': 57,
            'Menu': 127, 'F10': 68}
    BUTTONS = {1: 0x110, 2: 0x112, 3: 0x111}
    def __init__(self):
        self.path = bus.call_sync('org.gnome.Mutter.RemoteDesktop', '/org/gnome/Mutter/RemoteDesktop',
            'org.gnome.Mutter.RemoteDesktop', 'CreateSession', None, GLib.VariantType('(o)'),
            Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
        # While the session runs, GNOME shows its screen-sharing indicator to the
        # right of the companion, as it would for any remote desktop client.
        self.session('Start')
        # Mutter adds the session's keyboard at its first key press, which a
        # Wayland client focused before then never receives. A lone Shift tap,
        # which nothing binds, gives the seat its keyboard before any client.
        self.keys('key', 'Shift_L')
        # Absolute motion needs a ScreenCast stream, and a stream needs PipeWire.
        # Relative motion stops at the monitor's edges, so the bottom-right
        # corner, where no pointer barrier sits, is an exact origin.
        self.position = None
        self.move(799, 599, (1e5, 1e5))
    def session(self, method, params=None):
        bus.call_sync('org.gnome.Mutter.RemoteDesktop', self.path, 'org.gnome.Mutter.RemoteDesktop.Session',
            method, params, None, Gio.DBusCallFlags.NONE, 1500, None)
    def move(self, x, y, delta=None):
        delta = delta or (x - self.position[0], y - self.position[1])
        self.session('NotifyPointerMotionRelative', GLib.Variant('(dd)', delta))
        deadline = time.monotonic() + 1
        while (reached := call('Pointer').unpack()[0]) != [x, y] and time.monotonic() < deadline: time.sleep(.005)
        assert reached == [x, y], {'pointer': reached, 'target': (x, y)}
        self.position = (x, y)
    def click(self, button):
        for pressed in (True, False):
            self.session('NotifyPointerButton', GLib.Variant('(ib)', (self.BUTTONS[button], pressed)))
    def keys(self, *args):
        # The subset of xdotool's key, keydown and keyup syntax the checks use.
        for arg in args:
            if arg in ('key', 'keydown', 'keyup'):
                command = arg; continue
            codes = [self.KEYS[name] for name in arg.split('+')]
            if command != 'keyup':
                for code in codes: self.session('NotifyKeyboardKeycode', GLib.Variant('(ub)', (code, True)))
            if command != 'keydown':
                for code in reversed(codes): self.session('NotifyKeyboardKeycode', GLib.Variant('(ub)', (code, False)))
shell = None; system = None; app = None
try:
    system_address = 'unix:path=' + str(root / 'runtime/system-test-bus')
    system = subprocess.Popen(['dbus-daemon','--session','--nofork','--address='+system_address], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.environ['DBUS_SYSTEM_BUS_ADDRESS'] = system_address
    installed_mode = (root / 'panel-payload').exists()
    enabled = ['ubuntu-appindicators@ubuntu.com', 'voco-panel-probe@test.invalid']
    if not installed_mode: enabled.append('voco-panel@voco.local')
    settings = [('org.gnome.shell','enabled-extensions',str(enabled)),('org.gnome.shell','disable-user-extensions','false'),('org.gnome.desktop.interface','enable-animations','true')]
    # Some distributions, Fedora among them, open GNOME's first-login tour as a
    # modal dialog over the panel.
    settings.append(('org.gnome.shell','welcome-dialog-last-shown-version',shell_version))
    if headless:
        # A headless Shell starts its pointer on the hot corner, where relative
        # motion presses the corner's barriers and could open the overview.
        settings.append(('org.gnome.desktop.interface','enable-hot-corners','false'))
    for schema,key,value in settings:
        subprocess.run(['gsettings','set',schema,key,value],check=True)
    log = (evidence / 'shell.log').open('w')
    shell = start_shell()
    if installed_mode:
        for _ in range(150):
            pump(.1)
            try: inspect(); break
            except GLib.Error: pass
        else: raise AssertionError('Shell setup probe did not load')
        missing = subprocess.run([str(root/'voco'), '--check-panel'], capture_output=True, text=True, timeout=6)
        assert missing.returncode == 2 and 'missing' in missing.stdout, missing
        before = subprocess.check_output(['gsettings','get','org.gnome.shell','enabled-extensions'],text=True)
        shutil.copytree(root/'panel-payload', Path('/usr/share/gnome-shell/extensions/voco-panel@voco.local'))
        checked = subprocess.run([str(root/'voco'), '--check-panel'], capture_output=True, text=True, timeout=6)
        assert checked.returncode == 2 and 'Enable' in checked.stdout, checked
        assert subprocess.check_output(['gsettings','get','org.gnome.shell','enabled-extensions'],text=True) == before
        setup = subprocess.run([str(root/'voco'), '--setup-panel'], capture_output=True, text=True, timeout=6)
        report['freshPanelSetup'] = {'missing':missing.stdout, 'check':checked.stdout, 'setup':setup.stdout, 'code':setup.returncode}
        assert setup.returncode == 2 and 'Sign out' in setup.stdout, setup
        enabled_after = subprocess.check_output(['gsettings','get','org.gnome.shell','enabled-extensions'],text=True)
        assert all(uuid in enabled_after for uuid in [*enabled, 'voco-panel@voco.local'])
        # Load the previous metadata version, then replace files as an in-place
        # package upgrade would. GetExtensionInfo must describe loaded code.
        metadata_path = Path('/usr/share/gnome-shell/extensions/voco-panel@voco.local/metadata.json')
        current_metadata = json.loads(metadata_path.read_text())
        previous_metadata = {**current_metadata, 'version': current_metadata['version'] - 1}
        metadata_path.write_text(json.dumps(previous_metadata))
        shell.terminate(); shell.wait(timeout=10); pump(.5)
        shell = start_shell()
        for _ in range(150):
            pump(.1)
            try:
                if inspect()['indicator']['visible']: break
            except (GLib.Error, TypeError): pass
        else: raise AssertionError('Previous-version companion did not load')
        metadata_path.write_text(json.dumps(current_metadata))
        upgraded = subprocess.run([str(root/'voco'), '--check-panel'], capture_output=True, text=True, timeout=6)
        assert upgraded.returncode == 2 and 'sign out' in upgraded.stdout.lower(), upgraded
        report['freshPanelSetup']['loadedOldVersionAfterUpgrade'] = upgraded.stdout
        # Recreate the isolated shell session only, as the installer instructs.
        shell.terminate(); shell.wait(timeout=10); pump(.5)
        shell = start_shell()
    for _ in range(150):
        pump(.1)
        try:
            data=inspect()
            if data['indicator'] and data['indicator']['visible']: break
        except GLib.Error: pass
    else: raise AssertionError('Panel did not attach')
    pump(5); call('Overview'); pump(1)
    if installed_mode:
        checked = subprocess.run([str(root/'voco'), '--check-panel'], capture_output=True, text=True, timeout=6)
        assert checked.returncode == 0 and 'active' in checked.stdout, checked
        report['freshPanelSetup']['afterSessionRestart'] = checked.stdout
    def native_bridge():
        # The real app takes over org.voco.Panel from the synthetic service.
        global owner, app
        Gio.bus_unown_name(owner); owner=None; pump(.3)
        assert not inspect()['indicator']['visible'], 'The synthetic service stayed attached'
        # Startup clears the icons an earlier VOCO left; a second launch never touches them.
        stale = root / 'runtime/voco/tray-1-0'
        stale.parent.mkdir(mode=0o700, exist_ok=True); stale.mkdir(mode=0o700)
        (stale / 'ready.png').write_bytes(b'')
        app_log = (evidence / 'app.log').open('w')
        app_env = {**os.environ, 'WAYLAND_DISPLAY':'voco-panel-test', 'GDK_BACKEND':'wayland',
            'WEBKIT_DISABLE_COMPOSITING_MODE':'1'}
        app = subprocess.Popen([str(root / 'voco')], env=app_env, stdout=app_log, stderr=subprocess.STDOUT)
        for _ in range(150):
            pump(.1)
            assert app.poll() is None, 'Application exited during bridge startup'
            if inspect()['indicator']['visible']: break
        else: raise AssertionError('Native application bridge did not attach')
        assert not stale.exists(), 'Startup kept the icons an earlier VOCO left behind'
        report['staleTrayIconsRemoved'] = True
        native = json.loads(call('NativeState').unpack()[0])
        assert native['version'] == 1 and not native['canStop'], native
        assert native.get('shortcutAccelerator') == '<Alt>d' and native.get('stopShortcutToken') is None, native
        report['nativeBridgeState'] = native
        try:
            bus.call_sync('org.voco.Panel','/org/voco/Panel','org.voco.Panel1','GetState',None,None,Gio.DBusCallFlags.NONE,1500,None)
            raise AssertionError('Unattached client read native panel state')
        except GLib.Error as error:
            assert 'NotAttached' in str(error), error
        report['unattachedClientRejected'] = True
        for name, params in (('ReserveShortcut', GLib.Variant('(s)', ('<Alt>d',))),
                             ('ReserveStopShortcut', GLib.Variant('(s)', (native['token'],))),
                             ('Action', GLib.Variant('(ss)', ('shortcut', '')))):
            try:
                bus.call_sync('org.voco.Panel','/org/voco/Panel','org.voco.Panel1',name,params,None,Gio.DBusCallFlags.NONE,1500,None)
                raise AssertionError(f'Unattached client called {name}')
            except GLib.Error as error:
                assert 'NotAttached' in str(error), error
        report['unattachedShortcutReservationRejected'] = True
        attach = bus.call_sync('org.voco.Panel','/org/voco/Panel','org.voco.Panel1','Attach',None,None,Gio.DBusCallFlags.NONE,1500,None).unpack()[0]
        assert attach is False
        report['nonShellAttachRejected'] = True
        screenshot('native-bridge')
        values = bus.call_sync('org.kde.StatusNotifierWatcher','/StatusNotifierWatcher',
            'org.freedesktop.DBus.Properties','Get',GLib.Variant('(ss)',
            ('org.kde.StatusNotifierWatcher','RegisteredStatusNotifierItems')),None,Gio.DBusCallFlags.NONE,1500,None).unpack()[0]
        assert len(values) == 1, values
        identifier = values[0]
        if '@/' in identifier: service, item_path = identifier.split('@',1)
        elif '/' in identifier:
            service, item_path = identifier.split('/',1); item_path = '/' + item_path
        else: service, item_path = identifier, '/StatusNotifierItem'
        def tray_status():
            return bus.call_sync(service,item_path,'org.freedesktop.DBus.Properties','Get',
                GLib.Variant('(ss)',('org.kde.StatusNotifierItem','Status')),None,Gio.DBusCallFlags.NONE,1500,None).unpack()[0]
        assert tray_status() == 'Passive', tray_status()
        subprocess.run(['gnome-extensions','disable','voco-panel@voco.local'],check=True)
        pump(.4)
        assert tray_status() == 'Active', tray_status()
        report['nativeTrayRestoredOnDisable'] = True
        def tray_property(name):
            return bus.call_sync(service,item_path,'org.freedesktop.DBus.Properties','Get',
                GLib.Variant('(ss)',('org.kde.StatusNotifierItem',name)),None,Gio.DBusCallFlags.NONE,1500,None).unpack()[0]
        report['fallbackLabel'] = tray_property('XAyatanaLabel')
        # Only startup and setup problems carry a label; Ready and dictating share the bare icon.
        assert report['fallbackLabel'] in ['', 'Starting VOCO', 'Check setup']
        old_icon = Path(tray_property('IconName'))
        assert old_icon.exists()
        pump(2)
        assert old_icon.exists(), 'Advertised icon deleted while delayed reader still needs it'
        icon_files = list(old_icon.parent.glob('*.png'))
        assert len(icon_files) == 68, icon_files  # three states, 64 meter frames, library initial image
        gi.require_version('GdkPixbuf','2.0')
        from gi.repository import GdkPixbuf
        for icon in icon_files: GdkPixbuf.Pixbuf.new_from_file(str(icon))
        report['retainedIconFiles'] = len(icon_files)
        second = subprocess.run([str(root/'voco')], env=app_env, capture_output=True, text=True, timeout=5)
        assert second.returncode == 0, second.stderr
        assert old_icon.exists(), 'A second launch removed the running icons'
        report['secondLaunchAccepted'] = True
    if suite == 'bridge':
        native_bridge(); report['passed'] = True
        sys.exit()  # finally still writes the results and stops the Shell
    report['compositorAnimationsInitially'] = inspect()['animations']
    report['forceAnimationsForSoftwareRenderer'] = True
    assert inspect()['animations']
    if headless:
        remote = RemoteInput()
        report['remoteDesktopInput'] = True
        def mousemove(x, y): remote.move(x, y)
        def click(button): remote.click(button)
        def keys(*args): remote.keys(*args)
    else:
        pointer_env = {**os.environ, 'DISPLAY': ':77'}
        shell_windows = subprocess.check_output(['xdotool', 'search', '--pid', str(shell.pid)], env=pointer_env, text=True).splitlines()
        subprocess.run(['xdotool', 'windowfocus', shell_windows[0]], env=pointer_env, check=True)
        def mousemove(x, y): subprocess.run(['xdotool', 'mousemove', str(x), str(y)], env=pointer_env, check=True)
        def click(button): subprocess.run(['xdotool', 'click', str(button)], env=pointer_env, check=True)
        def keys(*args): subprocess.run(['xdotool', *args], env=pointer_env, check=True, timeout=3)
    def styled(data, name):
        return [actor for actor in data['actors'] if name in (actor.get('style') or '').split()]
    def anchors(data):
        # The microphone and every right-box item on its right, in panel pixels.
        row = data['rightBox']; own = next(index for index, child in enumerate(row) if child['voco'])
        return [actor['x'] for actor in styled(data, 'voco-panel-icon')] + \
            [child['x'] for child in row[own + 1:] if child['visible']]
    frames = []
    sequence = ['idle','starting','recording','processing','recovery','idle','attention']
    for i,status in enumerate(sequence):
        # Stretch the meter opening and closing so the probe samples many frames.
        animated = {1: 'expanding', 4: 'collapsing'}.get(i)
        if animated: call('SlowDown', GLib.Variant('(d)', (8.0,)))
        state.update(token=f'1:{i+1}',status=status,description=status,canStop=status in ('starting','recording'),canOpen=status not in ('starting','recording','processing'),level=.8 if status=='recording' else 0)
        if attached:
            bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None)
        if animated:
            settled = report['states'][f'{i-1}-{sequence[i-1]}']['indicator']['width']
            for _ in range(400):
                pump(.01)
                frame = inspect(); frames.append((animated, anchors(frame)))
                moving = frame['revealing']
                if animated not in report and moving and abs(frame['indicator']['width'] - settled) > 2:
                    report[animated] = frame
                    screenshot(animated)
                elif animated in report and not moving: break
            call('SlowDown', GLib.Variant('(d)', (1.0,)))
            assert animated in report, f'No {animated} width animation observed'
        pump(.4)
        data=inspect(); p=data['panel']; a=data['indicator']
        assert a['y'] >= p['y'] and a['y']+a['height'] <= p['y']+p['height']+.1, data
        assert a['x'] >= p['x'] and a['x']+a['width'] <= p['x']+p['width']+.1, data
        frames.append((f'{i}-{status}', anchors(data)))
        # The pill is the theme's highlight area, 3px inside the indicator, so
        # VOCO's tint and GNOME's hover, focus and menu fills draw as one shape.
        pill = styled(data, 'voco-panel-button')[0]; mic = styled(data, 'voco-panel-icon')[0]
        inset = (pill['x'] - a['x'], pill['y'] - a['y'], a['width'] - pill['width'], a['height'] - pill['height'])
        assert all(abs(value - expected) < .5 for value, expected in zip(inset, (3, 3, 6, 6))), {'pill': pill, 'indicator': a}
        assert ('voco-panel-active' in pill['style'].split()) == (status != 'idle'), pill
        if status not in ('idle','recovery'):
            content = [actor for actor in data['actors'] if actor['visible'] and
                       actor.get('style') in ('voco-panel-status', 'voco-panel-wave')]
            # The meter opens on the microphone's left. Its content keeps the
            # glyph's margin from the pill edge, 11px padding plus the glyph's
            # 4px transparent side, and sits 4px from the icon.
            insets = (min(actor['x'] for actor in content) - pill['x'],
                      mic['x'] - max(actor['x'] + actor['width'] for actor in content),
                      pill['x'] + pill['width'] - mic['x'] - mic['width'])
            assert all(abs(value - expected) < .5 for value, expected in zip(insets, (15, 4, 11))), f'Meter insets are {insets}px'
            data['meterInsets'] = insets
        assert data['windows'] == 0, data
        if status == 'attention':
            # Content is measured as styled, so a later idle poll never resizes it.
            pump(1.7)
            assert abs(inspect()['indicator']['width'] - a['width']) < .5, 'The label resized after opening'
        report['states'][f'{i}-{status}']=data
        screenshot(f'{i}-{status}')
        if status in ('starting', 'recording', 'processing'):
            assert not any(actor['visible'] and actor.get('text') for actor in data['actors']), data
            assert not any(actor.get('style') == 'voco-panel-stop' for actor in data['actors']), data
        mousemove(400, 300)
        pump(.1)
        mousemove(round(mic['x'] + mic['width'] / 2), round(mic['y'] + mic['height'] / 2))
        pump(.1)
        click(3)
        pump(.3)
        menu = inspect()['menu']
        assert menu['open'], {'menu': menu, 'actions': actions, 'state': status}
        items = {item['text']: item for item in menu['items']}
        assert items['Settings']['sensitive'] == state['canOpen'], items
        assert items['Review']['sensitive'] == state['canOpen'], items
        assert items['Stop dictation']['visible'] == state['canStop'], items
        assert menu['x'] >= 0 and menu['x'] + menu['width'] <= 800, menu
        if status == 'idle':
            screenshot('idle-menu')
            for label, action in [('Settings', 'settings'), ('Review', 'review')]:
                call('MenuAction', GLib.Variant('(s)', (label,))); pump(.2)
                assert actions[-1] == (action, state['token']), actions
                call('Menu'); pump(.1)
        elif status == 'recording':
            screenshot('recording-menu')
            call('MenuAction', GLib.Variant('(s)', ('Stop dictation',))); pump(.2)
            assert actions[-1] == ('stop', state['stopSession']), actions
            call('Menu'); pump(.1)
        call('Menu'); pump(.2)
        if status == 'idle':
            # A primary click on an idle pill opens Settings; the middle button
            # opens the menu like the secondary one.
            before = len(actions)
            click(1); pump(.3)
            assert actions[before:] == [('open', state['token'])] and not inspect()['menu']['open'], actions[before:]
            click(2); pump(.3)
            assert inspect()['menu']['open'] and actions[before + 1:] == [], actions[before:]
            call('Menu'); pump(.2)
            report['idleClickRouting'] = {'primaryOpens': True, 'middleOpensMenu': True}
        if status=='recording':
            state['level'] = 0; pump(.2)
            quiet = inspect()
            state['level'] = .8; pump(.2)
            loud = inspect()
            bars = lambda data: [a['scale'] for a in data['actors'] if a.get('style') == 'voco-panel-bar']
            assert max(bars(quiet)) < max(bars(loud))
            report['meterResponds'] = True
            call('Stop'); pump(.2)
            assert actions[-1] == ('stop', state['stopSession']), actions
            # A primary click anywhere on the pill stops, the meter included.
            wave = styled(data, 'voco-panel-wave')[0]; before = len(actions)
            mousemove(round(wave['x'] + wave['width'] / 2), round(wave['y'] + wave['height'] / 2))
            pump(.1)
            click(1)
            pump(.3)
            assert actions[before:] == [('stop', state['stopSession'])] and not inspect()['menu']['open'], actions[before:]
            report['meterClickStops'] = True
    # Keyboard focus shows GNOME's own focus fill on the indicator.
    mousemove(400, 300)
    call('Focus', GLib.Variant('(b)', (True,))); pump(.4)
    assert inspect()['indicatorFocus'], 'Keyboard focus did not reach the indicator'
    screenshot('focus')
    # The Menu key and Shift+F10 open the menu from the focused pill.
    for combo in ('Menu', 'shift+F10'):
        before = len(actions)
        keys('key', combo); pump(.3)
        assert inspect()['menu']['open'] and actions[before:] == [], {'key': combo, 'actions': actions[before:]}
        call('Menu'); pump(.2)
        call('Focus', GLib.Variant('(b)', (True,))); pump(.2)
    report['keyboardMenu'] = ['Menu', 'Shift+F10']
    call('Focus', GLib.Variant('(b)', (False,))); pump(.3)
    assert not inspect()['indicatorFocus'], 'The indicator kept focus styling'
    report['focusVisible'] = True
    assert report['states']['2-recording']['indicator']['width'] > report['states']['0-idle']['indicator']['width'] + 20
    assert abs(report['states']['5-idle']['indicator']['width'] - report['states']['0-idle']['indicator']['width']) < 2
    subprocess.run(['gsettings','set','org.gnome.desktop.interface','enable-animations','false'],check=True)
    state.update(status='recording',canStop=True,canOpen=False,level=.4); pump(1.8)
    report['reducedMotion']=inspect(); screenshot('reduced-motion')
    assert not report['reducedMotion']['revealing']
    frames.append(('reduced-motion', anchors(report['reducedMotion'])))
    call('Crowd', GLib.Variant('(b)', (True,))); pump(.3)
    report['crowded'] = inspect(); screenshot('crowded')
    assert report['crowded']['indicator']['width'] <= report['states']['0-idle']['indicator']['width'] + 2
    call('Crowd', GLib.Variant('(b)', (False,))); pump(.3)
    uncrowded = inspect()
    assert uncrowded['indicator']['width'] > report['crowded']['indicator']['width'] + 20, uncrowded['indicator']
    frames.append(('uncrowded', anchors(uncrowded)))
    # Opening and closing the meter never moves the microphone or its neighbours.
    reference = frames[0][1]
    moved = [frame for frame in frames if len(frame[1]) != len(reference) or
             any(abs(value - fixed) > .5 for value, fixed in zip(frame[1], reference))]
    assert not moved, {'reference': reference, 'moved': moved[:5]}
    report['fixedMicrophone'] = {'frames': len(frames), 'anchors': reference}
    subprocess.run(['gsettings','set','org.gnome.desktop.interface','gtk-theme','HighContrast'],check=True)
    pump(.5); screenshot('high-contrast')
    fail_next.append(True)
    bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None)
    pump(.2)
    assert not inspect()['indicator']['visible']
    pump(2.5)
    assert inspect()['indicator']['visible']
    report['transientFailureRecovered'] = True
    Gio.bus_unown_name(owner); owner=None; pump(.3)
    assert not inspect()['indicator']['visible']
    report['disconnectHidden']=True
    owner = Gio.bus_own_name_on_connection(bus, 'org.voco.Panel', Gio.BusNameOwnerFlags.NONE, None, None)
    pump(.5)
    assert inspect()['indicator']['visible']
    report['reconnectVisible'] = True
    subprocess.run(['gnome-extensions','disable','voco-panel@voco.local'],check=True)
    pump(.3)
    assert inspect()['indicator'] is None
    subprocess.run(['gnome-extensions','enable','voco-panel@voco.local'],check=True)
    pump(.5)
    assert inspect()['indicator']['visible']
    assert inspect()['indicator']['width'] > report['states']['0-idle']['indicator']['width'] + 20
    report['reenableVisible'] = True
    detaches = len(detached)
    # Real compositor key delivery to a disposable GTK input. No host devices.
    gi.require_version('Gtk', '3.0'); gi.require_version('Gdk', '3.0')
    os.environ.update(WAYLAND_DISPLAY='voco-panel-test', GDK_BACKEND='wayland')
    from gi.repository import Gtk, Gdk
    Gtk.init([])
    window=Gtk.Window(title='VOCO shortcut fixture'); entry=Gtk.Entry(); window.add(entry)
    leaked=[]
    def on_key(_widget, event):
        if event.keyval in (Gdk.KEY_d, Gdk.KEY_D) and event.state & Gdk.ModifierType.MOD1_MASK:
            leaked.append(True); entry.select_region(0, -1)
        return False
    entry.connect('key-press-event', on_key)
    window.show_all(); entry.grab_focus(); window.present(); pump(.6)
    if not headless:
        xenv={**os.environ, 'DISPLAY':':77', 'GDK_BACKEND':'x11'}
        ids=subprocess.check_output(['xdotool','search','--pid',str(shell.pid)],env=xenv,text=True).splitlines()
        subprocess.run(['xdotool','windowfocus',ids[0]],env=xenv,check=True)
        def keys(*args): subprocess.run(['xdotool',*args],env=xenv,check=True,timeout=3)
    def modifiers_clear():
        return bus.call_sync('org.gnome.Shell', '/org/voco/PanelInput', 'org.voco.PanelInput1',
            'ModifiersClear', None, None, Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()[0]
    unauthorized = Gio.DBusConnection.new_for_address_sync(os.environ['DBUS_SESSION_BUS_ADDRESS'],
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
    try:
        unauthorized.call_sync('org.gnome.Shell', '/org/voco/PanelInput', 'org.voco.PanelInput1',
            'ModifiersClear', None, None, Gio.DBusCallFlags.NO_AUTO_START, 1500, None)
        raise AssertionError('Unattached application read compositor input state')
    except GLib.Error as error:
        assert 'NotAttached' in str(error), error
    finally: unauthorized.close_sync(None)
    # This fixture answers the companion only while it pumps. Loading GTK can
    # outlast the companion's 1.5-second call timeout; the companion then
    # detaches and attaches again 2 seconds later, as it would from a stalled app.
    deadline = time.monotonic() + 5
    while True:
        try: ready = modifiers_clear(); break
        except GLib.Error as error:
            if 'NotAttached' not in str(error) or time.monotonic() > deadline: raise
            pump(.05)
    report['reattachedAfterFixtureStall'] = len(detached) > detaches
    assert ready
    def wait_for(predicate, seconds):
        end = time.monotonic() + seconds
        while not predicate() and time.monotonic() < end: pump(.01)
        return predicate()
    def shortcut_state(status, accelerator='<Alt>d'):
        state.update(token='2:'+str(time.monotonic_ns()),status=status,canStop=status in ('starting','recording'),
                     stopSession='2:1',canOpen=status=='idle',
                     shortcutAccelerator=accelerator,stopAccelerator=accelerator)
        bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None);pump(.3)
    def press(combo):
        # (reached the focused field, panel actions sent) for one tapped chord.
        leaked.clear();entry.select_region(-1,-1);before=len(actions)
        keys('key',combo);pump(.2)
        return bool(leaked), actions[before:]
    consumed = (False, [('shortcut', '')]); released = (True, [])
    shortcut_state('idle', None); entry.set_text('Keep my dictated words');entry.set_position(-1)
    assert press('alt+d') == released and entry.get_selection_bounds(), 'fixture must reproduce browser-style select-all'
    # Attached at idle: Shell grabs and reserves immediately, before any capture exists.
    shortcut_state('idle')
    assert reservations and reservations[-1][1:] == ('<Alt>d', True), reservations
    assert press('alt+d') == consumed, 'idle chord must be consumed as exactly one toggle'
    # Held past the autorepeat delay: one toggle on press, never a delayed one.
    leaked.clear();entry.select_region(-1,-1);before=len(actions)
    keys('keydown','Alt_L','keydown','d');pump(.9)
    assert not leaked and actions[before:] == [('shortcut', '')], actions[before:]
    assert not modifiers_clear(), 'a held chord must block final paste until release'
    assert not inspect()['windowMenuOpen'], 'held chord opened a window menu without paste'
    keys('keyup','d','keyup','Alt_L');pump(.2)
    assert modifiers_clear(), 'released chord must permit delivery'
    assert not inspect()['windowMenuOpen'], 'a released chord must not leave the GNOME window menu open'
    assert entry.get_text() == 'Keep my dictated words', entry.get_text()
    assert actions[before:] == [('shortcut', '')], 'release must not send another action'
    # Presentation revisions and every status keep the same grab and toggle.
    for status in ('starting', 'recording', 'processing', 'attention', 'idle'):
        shortcut_state(status)
        assert press('alt+d') == consumed, status
    # Renewal is a heartbeat, independent of state polling and Changed signals.
    mark=len(reservations);pump(2.5)
    renewals=reservations[mark:]
    renewal_gaps=[round(later[0]-earlier[0],3) for earlier,later in zip(renewals,renewals[1:])]
    assert len(renewals) >= 2 and all(item[1:] == ('<Alt>d', True) for item in renewals), renewals
    assert all(.7 < gap < 1.5 for gap in renewal_gaps), renewal_gaps
    shortcut_state('idle','<Alt><Shift>d')
    assert press('alt+shift+d') == consumed, 'a changed chord must be regrabbed'
    assert press('alt+d') == released, 'the previous chord must return to the application'
    # Late replies about a replaced grab, false or failed, must not release or
    # detach the newer one.
    for accelerator, combo, settle in [
            ('<Alt>d', 'alt+d', lambda pending: pending.return_value(GLib.Variant('(b)', (False,)))),
            ('<Alt><Shift>d', 'alt+shift+d', lambda pending: pending.return_dbus_error('org.voco.TestExpired', 'Old grab expired'))]:
        hold_reservation.append(True)
        assert wait_for(lambda: held, 1.3), 'fixture must hold a renewal'
        hold_reservation.clear();shortcut_state('idle',accelerator);before_detach=len(detached)
        for pending in held: settle(pending)
        held.clear();pump(.1)
        assert press(combo) == consumed and len(detached) == before_detach, f'a late reply revoked the {accelerator} grab'
    # Freeze the next state read so this proves immediate rejection cleanup,
    # rather than a later poll.
    hold_reservation.append(True)
    assert wait_for(lambda: held, 1.3), 'fixture must hold a renewal'
    stall_state.append(True)
    bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None)
    assert wait_for(lambda: stalled, .5), 'fixture must hold a state read'
    for pending in held: pending.return_value(GLib.Variant('(b)', (False,)))
    held.clear();hold_reservation.clear();pump(.03)
    assert press('alt+shift+d') == released, 'a rejected renewal must release the shortcut immediately'
    stall_state.clear()
    for pending in stalled: pending.return_value(GLib.Variant('(s)', (snapshot(),)))
    stalled.clear();pump(.3)
    assert press('alt+shift+d') == consumed, 'the next state read must regrab'
    # A hung app times out its single in-flight renewal; Shell detaches and releases
    # within one heartbeat plus the call timeout, then attaches again.
    hold_reservation.append(True);started=time.monotonic()
    before_detach=len(detached);before_attach=len(attached)
    assert wait_for(lambda: len(detached) > before_detach, 3.2), 'an unresponsive app kept the shortcut swallowed'
    unresponsive_released=round(time.monotonic()-started,3)
    assert unresponsive_released < 3.0, unresponsive_released
    assert press('alt+shift+d') == released, 'an unresponsive app must not leave the shortcut swallowed'
    hold_reservation.clear()
    for pending in held: pending.return_dbus_error('org.voco.TestExpired', 'Synthetic expired request')
    held.clear()
    assert wait_for(lambda: len(attached) > before_attach, 3), 'companion did not attach again'
    pump(.4)
    assert press('alt+shift+d') == consumed, 'an attached companion must regrab'
    fail_reservation.append(True);before_detach=len(detached);before_attach=len(attached)
    assert wait_for(lambda: len(detached) > before_detach, 1.5), 'a failed renewal must detach'
    assert press('alt+shift+d') == released, 'a failed renewal must release the shortcut'
    assert wait_for(lambda: len(attached) > before_attach, 3), 'companion did not attach again'
    pump(.4)
    assert press('alt+shift+d') == consumed, 'an attached companion must regrab'
    Gio.bus_unown_name(owner);owner=None;pump(.2)
    assert press('alt+shift+d') == released, 'disconnect must release the compositor shortcut'
    owner=Gio.bus_own_name_on_connection(bus,'org.voco.Panel',Gio.BusNameOwnerFlags.NONE,None,None);pump(.5)
    assert press('alt+shift+d') == consumed, 'reconnect must regrab'
    before_detach=len(detached)
    subprocess.run(['gnome-extensions','disable','voco-panel@voco.local'],check=True);pump(.3)
    assert len(detached) > before_detach, 'disable must detach'
    assert press('alt+shift+d') == released, 'disable must release the compositor shortcut'
    subprocess.run(['gnome-extensions','enable','voco-panel@voco.local'],check=True);pump(.6)
    assert press('alt+shift+d') == consumed, 'enable must regrab'
    shortcut_state('idle', None)
    assert press('alt+shift+d') == released and press('alt+d') == released, 'no supported chord must release the grab'
    assert not stop_reservations, 'the companion must not use the v10 Stop reservation'
    assert entry.get_text() == 'Keep my dictated words', entry.get_text()
    # Super may open the overview; test it only after all focused-field checks.
    for modifier in ('Alt_L', 'Alt_R', 'Control_L', 'Control_R', 'Shift_L', 'Shift_R', 'Super_L', 'Super_R'):
        keys('keydown', modifier);pump(.03)
        assert not modifiers_clear(), f'{modifier} must block streaming paste'
        keys('keyup', modifier);pump(.03)
        assert modifiers_clear(), f'{modifier} release must restore paste readiness'
    Gio.bus_unown_name(owner);owner=None;call('Overview');pump(.4)
    window.destroy();pump(.2)
    owner=Gio.bus_own_name_on_connection(bus,'org.voco.Panel',Gio.BusNameOwnerFlags.NONE,None,None)
    state.pop('stopAccelerator',None);state.pop('shortcutAccelerator',None);pump(.4)
    report['shortcutProtection']={'realCompositorKeys':True,'idleConsumed':True,'heldChordTogglesOnce':True,'heldModifierWait':True,
        'everyStatusConsumed':True,'renewalGaps':renewal_gaps,'changedChordRegrabbed':True,'staleRepliesIsolated':True,
        'rejectedRenewalReleased':True,'unresponsiveAppReleasedAfter':unresponsive_released,'failedRenewalReattached':True,
        'disconnectReleased':True,'disableReleased':True,'unsupportedChordReleased':True,'noLegacyStopReservation':True,
        'alternateHotkey':True,'textPreserved':True}
    report['actions']=actions
    report['modifierGuard'] = {'callerAuthenticated': True, 'allEightModifiers': True,
        'heldStreamingSeparatorBlocked': True, 'releasePreservedText': True}
    if (root / 'voco').exists(): native_bridge()
    report['passed']=True
finally:
    (evidence/'results.json').write_text(json.dumps(report,indent=2))
    if app: app.terminate(); app.wait(timeout=10)
    if shell: shell.terminate(); shell.wait(timeout=10)
    if system:
        # GTK can hold GIO's shared system-bus connection, which by default
        # raises SIGTERM in this process once that bus goes away.
        try: Gio.bus_get_sync(Gio.BusType.SYSTEM, None).set_exit_on_close(False)
        except GLib.Error: pass
        system.terminate(); system.wait(timeout=5)
