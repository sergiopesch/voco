#!/usr/bin/python3
"""Real GNOME actors with a synthetic, transcript-free panel protocol fixture."""
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import time
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib
root = Path(sys.argv[1]); evidence = root / 'evidence'
report = {'passed': False, 'scope': 'GNOME 46 nested Wayland, synthetic app service', 'states': {}}
state = dict(version=1, token='1:1', status='idle', description='Ready', canStop=False, canOpen=True, level=0)
actions = []; attached = []; fail_next = []; stalled = []; stall_state = []; delayed_reservations = []; delay_reservation = []
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
xml = '''<node><interface name="org.voco.Panel1"><method name="Attach"><arg type="b" direction="out"/></method><method name="GetState"><arg type="s" direction="out"/></method><method name="ReserveStopShortcut"><arg type="s" direction="in"/><arg type="b" direction="out"/></method><method name="Action"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/></method><method name="Detach"/><signal name="Changed"/></interface></node>'''
def method(connection, sender, path, interface, name, params, invocation):
    if name == 'Attach':
        attached.append(sender); invocation.return_value(GLib.Variant('(b)', (True,)))
    elif name == 'GetState':
        if stall_state:
            stalled.append(invocation); return
        if fail_next:
            fail_next.pop(); invocation.return_dbus_error('org.voco.TestUnavailable', 'Synthetic transient failure')
        else: invocation.return_value(GLib.Variant('(s)', (json.dumps(state),)))
    elif name == 'ReserveStopShortcut':
        if delay_reservation:
            delayed_reservations.append(invocation); return
        invocation.return_value(GLib.Variant('(b)', (params.unpack()[0] == state['token'],)))
    elif name == 'Action':
        actions.append(params.unpack()); invocation.return_value(GLib.Variant('(b)', (True,)))
    elif name == 'Detach': invocation.return_value(None)
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
    code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,800,600);p.savev(__import__('sys').argv[1],'png',[],[])"
    subprocess.run(['/usr/bin/python3','-c',code,str(evidence / (name+'.png'))], env={**os.environ,'DISPLAY':':77','GDK_BACKEND':'x11'}, check=True)
    panel_code = code.replace('800,600)', '800,32)')
    subprocess.run(['/usr/bin/python3','-c',panel_code,str(evidence / ('panel-'+name+'.png'))], env={**os.environ,'DISPLAY':':77','GDK_BACKEND':'x11'}, check=True)
shell = None; system = None; app = None
try:
    system_address = 'unix:path=' + str(root / 'runtime/system-test-bus')
    system = subprocess.Popen(['dbus-daemon','--session','--nofork','--address='+system_address], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.environ['DBUS_SYSTEM_BUS_ADDRESS'] = system_address
    installed_mode = (root / 'panel-payload').exists()
    enabled = ['ubuntu-appindicators@ubuntu.com', 'voco-panel-probe@test.invalid']
    if not installed_mode: enabled.append('voco-panel@voco.local')
    for schema,key,value in [('org.gnome.shell','enabled-extensions',str(enabled)),('org.gnome.shell','disable-user-extensions','false'),('org.gnome.desktop.interface','enable-animations','true')]:
        subprocess.run(['gsettings','set',schema,key,value],check=True)
    log = (evidence / 'shell.log').open('w')
    shell = subprocess.Popen(['gnome-shell','--nested','--wayland','--no-x11','--force-animations','--wayland-display=voco-panel-test','--sm-disable'], env={**os.environ,'DISPLAY':':77'}, stdout=log,stderr=subprocess.STDOUT)
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
        # Recreate the isolated shell session only, as the installer instructs.
        shell.terminate(); shell.wait(timeout=10); pump(.5)
        shell = subprocess.Popen(['gnome-shell','--nested','--wayland','--no-x11','--force-animations','--wayland-display=voco-panel-test','--sm-disable'], env={**os.environ,'DISPLAY':':77'}, stdout=log,stderr=subprocess.STDOUT)
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
    report['compositorAnimationsInitially'] = inspect()['animations']
    report['forceAnimationsForSoftwareRenderer'] = True
    assert inspect()['animations']
    for i,status in enumerate(['idle','starting','recording','processing','recovery','idle']):
        state.update(token=f'1:{i+1}',status=status,description=status,canStop=status in ('starting','recording'),canOpen=status not in ('starting','recording','processing'),level=.8 if status=='recording' else 0)
        if attached:
            bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None)
        if i == 1:
            for _ in range(50):
                pump(.01)
                frame = inspect()
                if frame['indicator']['width'] > report['states']['0-idle']['indicator']['width'] + 2 and any(actor['transitions'] for actor in frame['actors']):
                    report['intermediate'] = frame
                    screenshot('expanding')
                    break
            report['animationProbe'] = inspect()
            assert 'intermediate' in report, 'No width animation observed'
        pump(.4)
        data=inspect(); p=data['panel']; a=data['indicator']
        assert a['y'] >= p['y'] and a['y']+a['height'] <= p['y']+p['height']+.1, data
        assert a['x'] >= p['x'] and a['x']+a['width'] <= p['x']+p['width']+.1, data
        assert data['windows'] == 0, data
        report['states'][f'{i}-{status}']=data
        screenshot(f'{i}-{status}')
        if status=='recording':
            state['level'] = 0; pump(.2)
            quiet = inspect()
            state['level'] = .8; pump(.2)
            loud = inspect()
            bars = lambda data: [a['scale'] for a in data['actors'] if a.get('style') == 'voco-panel-bar']
            assert max(bars(quiet)) < max(bars(loud))
            report['meterResponds'] = True
            call('Stop'); pump(.2)
            assert actions[-1] == ('stop', state['token']), actions
    assert report['states']['2-recording']['indicator']['width'] > report['states']['0-idle']['indicator']['width'] + 50
    assert abs(report['states']['5-idle']['indicator']['width'] - report['states']['0-idle']['indicator']['width']) < 2
    subprocess.run(['gsettings','set','org.gnome.desktop.interface','enable-animations','false'],check=True)
    state.update(status='recording',canStop=True,canOpen=False,level=.4); pump(1.8)
    report['reducedMotion']=inspect(); screenshot('reduced-motion')
    assert not any(a['transitions'] for a in report['reducedMotion']['actors'])
    call('Crowd', GLib.Variant('(b)', (True,))); pump(.3)
    report['crowded'] = inspect(); screenshot('crowded')
    assert report['crowded']['indicator']['width'] <= report['states']['0-idle']['indicator']['width'] + 2
    call('Crowd', GLib.Variant('(b)', (False,))); pump(.3)
    assert inspect()['indicator']['width'] > report['crowded']['indicator']['width'] + 50
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
    assert inspect()['indicator']['width'] > report['states']['0-idle']['indicator']['width'] + 50
    report['reenableVisible'] = True
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
    xenv={**os.environ, 'DISPLAY':':77', 'GDK_BACKEND':'x11'}
    ids=subprocess.check_output(['xdotool','search','--pid',str(shell.pid)],env=xenv,text=True).splitlines()
    subprocess.run(['xdotool','windowfocus',ids[0]],env=xenv,check=True)
    def keys(*args): subprocess.run(['xdotool',*args],env=xenv,check=True,timeout=3)
    def shortcut_state(status, accelerator='<Alt>d'):
        state.update(token='2:'+str(time.monotonic_ns()),status=status,canStop=status in ('starting','recording'),
                     stopSession='2:1',
                     canOpen=status=='idle',stopAccelerator=accelerator)
        bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None);pump(.3)
    shortcut_state('idle'); entry.set_text('Keep my dictated words');entry.set_position(-1)
    keys('key','alt+d');pump(.2)
    assert leaked and entry.get_selection_bounds(), 'fixture must reproduce browser-style select-all'
    leaked.clear();entry.select_region(-1,-1);shortcut_state('recording')
    shortcut_state('starting')
    before=len(actions);keys('keydown','Alt_L','keydown','d');pump(.3)
    assert not leaked and not entry.get_selection_bounds(), 'reserved Stop leaked into input'
    assert len(actions)==before, 'held modifiers must not initiate final paste'
    shortcut_state('recording')  # Same capture, new presentation revision while held.
    keys('keyup','d','keyup','Alt_L');pump(.3)
    assert len(actions)==before+1 and actions[-1]==('stop',state['token']), actions
    before_replacement=len(actions);keys('keydown','Alt_L','keydown','d');pump(.1)
    state.update(token='2:replacement',stopSession='2:2')
    bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None);pump(.15)
    keys('keyup','d','keyup','Alt_L');pump(.2)
    assert len(actions)==before_replacement, 'held Stop must not affect a replacement recording'
    shortcut_state('processing');keys('key','alt+d');pump(.2)
    assert not leaked and len(actions)==before+1, 'processing must consume without another action'
    shortcut_state('idle');keys('key','alt+d');pump(.2)
    assert leaked, 'idle must return the shortcut to the application'
    leaked.clear();entry.select_region(-1,-1);shortcut_state('recording','<Alt><Shift>d')
    keys('key','alt+shift+d');pump(.2)
    assert not leaked and actions[-1]==('stop',state['token'])
    delay_reservation.append(True);pump(.12)
    assert delayed_reservations, 'fixture must hold an old reservation response'
    shortcut_state('idle');delay_reservation.clear()
    shortcut_state('recording','<Alt><Shift>d')
    for pending in delayed_reservations: pending.return_dbus_error('org.voco.TestExpired','Old recording expired')
    delayed_reservations.clear();pump(.01)
    keys('key','alt+shift+d');pump(.2)
    assert not leaked and actions[-1]==('stop',state['token']), 'late old failure must not release a new grab'
    stall_state.append(True)
    bus.emit_signal(attached[-1], '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None);pump(2.2)
    keys('key','alt+shift+d');pump(.2)
    assert leaked, 'an unresponsive app must not leave the shortcut swallowed'
    stall_state.clear()
    for pending in stalled: pending.return_dbus_error('org.voco.TestExpired', 'Synthetic expired request')
    stalled.clear();pump(2.5)
    leaked.clear();entry.select_region(-1,-1);shortcut_state('recording','<Alt><Shift>d')
    Gio.bus_unown_name(owner);owner=None;pump(.2)
    keys('key','alt+shift+d');pump(.2)
    assert leaked, 'disconnect must release the compositor shortcut'
    window.destroy();pump(.2)
    owner=Gio.bus_own_name_on_connection(bus,'org.voco.Panel',Gio.BusNameOwnerFlags.NONE,None,None)
    state.pop('stopAccelerator',None);pump(.4)
    report['shortcutProtection']={'realCompositorKeys':True,'heldModifierWait':True,'sameSessionRevisionPreserved':True,'replacementSessionRejected':True,'processingConsumed':True,
        'idleReleased':True,'disconnectReleased':True,'unresponsiveAppReleased':True,'staleReservationIsolated':True,'alternateHotkey':True,'textPreserved':True}
    report['actions']=actions
    if (root / 'voco').exists():
        Gio.bus_unown_name(owner); owner=None; pump(.3)
        app_log = (evidence / 'app.log').open('w')
        app = subprocess.Popen([str(root / 'voco')], env={**os.environ,
            'WAYLAND_DISPLAY':'voco-panel-test', 'GDK_BACKEND':'wayland',
            'WEBKIT_DISABLE_COMPOSITING_MODE':'1'}, stdout=app_log, stderr=subprocess.STDOUT)
        for _ in range(150):
            pump(.1)
            assert app.poll() is None, 'Application exited during bridge startup'
            if inspect()['indicator']['visible']: break
        else: raise AssertionError('Native application bridge did not attach')
        native = json.loads(call('NativeState').unpack()[0])
        assert native['version'] == 1 and not native['canStop'], native
        report['nativeBridgeState'] = native
        try:
            bus.call_sync('org.voco.Panel','/org/voco/Panel','org.voco.Panel1','GetState',None,None,Gio.DBusCallFlags.NONE,1500,None)
            raise AssertionError('Unattached client read native panel state')
        except GLib.Error as error:
            assert 'NotAttached' in str(error), error
        report['unattachedClientRejected'] = True
        try:
            bus.call_sync('org.voco.Panel','/org/voco/Panel','org.voco.Panel1','ReserveStopShortcut',GLib.Variant('(s)',(native['token'],)),None,Gio.DBusCallFlags.NONE,1500,None)
            raise AssertionError('Unattached client reserved the shortcut')
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
        assert report['fallbackLabel'] in ['Starting VOCO', 'Check setup', 'Ready']
        old_icon = Path(tray_property('IconName'))
        assert old_icon.exists()
        pump(2)
        assert old_icon.exists(), 'Advertised icon deleted while delayed reader still needs it'
        icon_files = list(old_icon.parent.glob('*.png'))
        assert len(icon_files) == 69, icon_files  # four states, 64 meter frames, library initial image
        gi.require_version('GdkPixbuf','2.0')
        from gi.repository import GdkPixbuf
        for icon in icon_files: GdkPixbuf.Pixbuf.new_from_file(str(icon))
        report['retainedIconFiles'] = len(icon_files)
        second = subprocess.run([str(root/'voco')], capture_output=True, text=True, timeout=5)
        assert second.returncode == 0, second.stderr
        report['secondLaunchAccepted'] = True
    report['passed']=True
finally:
    (evidence/'results.json').write_text(json.dumps(report,indent=2))
    if app: app.terminate(); app.wait(timeout=10)
    if shell: shell.terminate(); shell.wait(timeout=10)
    if system: system.terminate(); system.wait(timeout=5)
