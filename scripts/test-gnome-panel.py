#!/usr/bin/python3
"""Real GNOME actors with a synthetic, transcript-free panel protocol fixture."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib
root = Path(sys.argv[1]); evidence = root / 'evidence'
report = {'passed': False, 'scope': 'GNOME 46 nested Wayland, synthetic app service', 'states': {}}
state = dict(version=1, token='1:1', status='idle', description='Ready', canStop=False, canOpen=True, level=0)
actions = []; attached = []; fail_next = []
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
xml = '''<node><interface name="org.voco.Panel1"><method name="Attach"><arg type="b" direction="out"/></method><method name="GetState"><arg type="s" direction="out"/></method><method name="Action"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/></method><method name="Detach"/><signal name="Changed"/></interface></node>'''
def method(connection, sender, path, interface, name, params, invocation):
    if name == 'Attach':
        attached.append(sender); invocation.return_value(GLib.Variant('(b)', (True,)))
    elif name == 'GetState':
        if fail_next:
            fail_next.pop(); invocation.return_dbus_error('org.voco.TestUnavailable', 'Synthetic transient failure')
        else: invocation.return_value(GLib.Variant('(s)', (json.dumps(state),)))
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
    for schema,key,value in [('org.gnome.shell','enabled-extensions',"['ubuntu-appindicators@ubuntu.com','voco-panel@voco.local','voco-panel-probe@test.invalid']"),('org.gnome.shell','disable-user-extensions','false'),('org.gnome.desktop.interface','enable-animations','true')]:
        subprocess.run(['gsettings','set',schema,key,value],check=True)
    log = (evidence / 'shell.log').open('w')
    shell = subprocess.Popen(['gnome-shell','--nested','--wayland','--no-x11','--force-animations','--wayland-display=voco-panel-test','--sm-disable'], env={**os.environ,'DISPLAY':':77'}, stdout=log,stderr=subprocess.STDOUT)
    for _ in range(150):
        pump(.1)
        try:
            data=inspect()
            if data['indicator'] and data['indicator']['visible']: break
        except GLib.Error: pass
    else: raise AssertionError('Panel did not attach')
    pump(5); call('Overview'); pump(1)
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
    report['passed']=True
finally:
    (evidence/'results.json').write_text(json.dumps(report,indent=2))
    if app: app.terminate(); app.wait(timeout=10)
    if shell: shell.terminate(); shell.wait(timeout=10)
    if system: system.terminate(); system.wait(timeout=5)
