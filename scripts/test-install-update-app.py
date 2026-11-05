"""Install update in the real VOCO (scripts/test-install-update-app.sh runs it).

An installed package of this checkout, one version below a published release,
updates itself to that release through its own Settings window. Only real
controls are pressed: the tray menu over DBusMenu and the window's buttons
through AT-SPI. The outcome is read from outside the app: the package manager's
version and the processes running /usr/bin/voco.

Usage: test-install-update-app.py EVIDENCE_DIR FROM_VERSION TARGET_VERSION
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import gi
gi.require_version('Atspi', '2.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Atspi, Gio, GLib  # noqa: E402

OUT, FROM, TARGET = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
OUT.mkdir(parents=True, exist_ok=True)
REPORT = {'steps': [], 'screens': []}


def note(step, **fields):
    entry = {'t': round(time.monotonic() - START, 1), 'step': step, **fields}
    REPORT['steps'].append(entry)
    print(json.dumps(entry), flush=True)


def pump(seconds=0.0):
    end = time.monotonic() + seconds
    while True:
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        if time.monotonic() >= end:
            return
        time.sleep(0.02)


def wait_for(predicate, description, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump(0.1)
        value = predicate()
        if value:
            return value
    raise AssertionError('Timed out: ' + description)


def installed():
    return subprocess.run(['dpkg-query', '-W', '-f=${Version}', 'voco'], capture_output=True, text=True).stdout


def voco_pids():
    found = subprocess.run(['pgrep', '-x', 'voco'], capture_output=True, text=True).stdout.split()
    return sorted(int(pid) for pid in found)


def screenshot(name):
    path = OUT / f'{len(REPORT["screens"]):02d}-{name}.png'
    code = ("import gi,sys;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);"
            "w=Gdk.get_default_root_window();p=Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height());p.savev(sys.argv[1],'png',[],[])")
    subprocess.run([sys.executable, '-c', code, str(path)], check=False, timeout=15)
    REPORT['screens'].append(path.name)


# The standard tray-host discovery service, absent from bare Xvfb, as CI's suites supply it.
bus = Gio.bus_get_sync(Gio.BusType.SESSION)
items = []
TRAY_XML = """<node><interface name="org.kde.StatusNotifierWatcher"><method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method><method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method><property name="RegisteredStatusNotifierItems" type="as" access="read"/><property name="IsStatusNotifierHostRegistered" type="b" access="read"/><property name="ProtocolVersion" type="i" access="read"/></interface></node>"""


def tray_method(connection, sender, path, interface, method, values, invocation):
    if method == 'RegisterStatusNotifierItem':
        item = values.unpack()[0]
        items.append(item if item.startswith(':') else sender + item if item.startswith('/') else item)
    invocation.return_value(None)


def tray_property(connection, sender, path, interface, name):
    return {'RegisteredStatusNotifierItems': GLib.Variant('as', items),
            'IsStatusNotifierHostRegistered': GLib.Variant('b', True),
            'ProtocolVersion': GLib.Variant('i', 0)}[name]


bus.register_object('/StatusNotifierWatcher', Gio.DBusNodeInfo.new_for_xml(TRAY_XML).interfaces[0], tray_method, tray_property, None)
Gio.bus_own_name_on_connection(bus, 'org.kde.StatusNotifierWatcher', Gio.BusNameOwnerFlags.NONE, None, None)


def call(name, path, interface, method, values=None):
    return bus.call_sync(name, path, interface, method, values, None, Gio.DBusCallFlags.NONE, 10000, None).unpack()


def visible_text():
    """Every accessible name on the private display, for a failure's evidence."""
    desktop = Atspi.get_desktop(0)
    pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
    texts = []
    while pending and len(texts) < 3000:
        node = pending.pop()
        if node is None:
            continue
        try:
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 200)))
            name = (node.get_name() or '').strip()
            if name:
                texts.append(name)
        except GLib.Error:
            continue
    return texts


def main():
    global START
    START = time.monotonic()
    assert installed() == FROM, installed()
    assert not voco_pids(), 'A VOCO is already running'
    note('installed before', version=installed())

    app = subprocess.Popen(['/usr/bin/voco'], stdout=open(OUT / 'voco.log', 'w'), stderr=subprocess.STDOUT)
    note('started', pid=app.pid)

    # The tray item VOCO's own process registered, then its real menu's Settings.
    def registered():
        assert app.poll() is None, 'VOCO exited before tray registration'
        for identifier in items:
            service = identifier.split('/', 1)[0]
            try:
                owner = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID', GLib.Variant('(s)', (service,)))[0]
            except GLib.Error:
                continue
            if owner == app.pid:
                return identifier
        return None


    identifier = wait_for(registered, 'tray registration')
    service, _, item_path = identifier.partition('/')
    item_path = '/' + item_path if item_path else '/StatusNotifierItem'
    menu = call(service, item_path, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierItem', 'Menu')))[0]


    def menu_item(label):
        layout = call(service, menu, 'com.canonical.dbusmenu', 'GetLayout', GLib.Variant('(iias)', (0, -1, ['label', 'enabled'])))[1]

        def find(node):
            if node[1].get('label') == label and node[1].get('enabled', True):
                return node[0]
            for child in node[2]:
                found = find(child)
                if found is not None:
                    return found
        return find(layout)


    settings = wait_for(lambda: menu_item('Settings'), 'an enabled Settings item', 90)
    call(service, menu, 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (settings, 'clicked', GLib.Variant('s', ''), 0)))
    note('tray Settings clicked')


    def nodes(pid):
        # Every accessible on the private display: VOCO is the only app there.
        desktop = Atspi.get_desktop(0)
        pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
        found = []
        while pending and len(found) < 3000:
            node = pending.pop()
            if node is None:
                continue
            try:
                found.append(node)
                pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 200)))
            except GLib.Error:
                continue
        return found


    def named(role, label, pid):
        for node in nodes(pid):
            try:
                if node.get_role() == role and (node.get_name() or '').strip() == label:
                    states = node.get_state_set()
                    if states.contains(Atspi.StateType.SHOWING) and states.contains(Atspi.StateType.ENABLED):
                        return node
            except GLib.Error:
                continue
        return None


    def text_present(fragment, pid):
        for node in nodes(pid):
            try:
                if fragment in (node.get_name() or ''):
                    return True
                if node.get_text_iface() is not None:
                    count = Atspi.Text.get_character_count(node)
                    if fragment in (Atspi.Text.get_text(node, 0, count) or ''):
                        return True
            except GLib.Error:
                continue
        return False


    def press(label, pid, seconds=60):
        node = wait_for(lambda: named(Atspi.Role.PUSH_BUTTON, label, pid), 'button ' + label, seconds)
        action = node.get_action_iface()
        assert action is not None and action.get_n_actions() > 0 and action.do_action(0), label
        note('pressed', label=label)


    press('Updates', app.pid, 90)
    wait_for(lambda: text_present(f'VOCO {TARGET} is available', app.pid), 'the check finding ' + TARGET, 90)
    note('update found')
    screenshot('update-offered')
    press('Install update', app.pid)

    # Follow the window through each stage until this VOCO exits for the restart.
    seen = []
    stages = [(f'Downloading VOCO {TARGET}', 'downloading'), ('Checking the release', 'verifying'),
              ('Enter your password', 'authorizing'), (f'Installing VOCO {TARGET}', 'installing'),
              (f'{TARGET} is installed', 'installed'), (f'Restarting into VOCO {TARGET}', 'restarting'),
              ('The update didn’t install', 'failed')]
    deadline = time.monotonic() + 900
    last_shot = 0.0
    while app.poll() is None and time.monotonic() < deadline:
        pump(0.3)
        try:
            for fragment, stage in stages:
                if stage not in seen and text_present(fragment, app.pid):
                    seen.append(stage)
                    note('stage shown', stage=stage, installed=installed())
                    screenshot(stage)
                    last_shot = time.monotonic()
        except Exception as error:  # the window goes away as VOCO exits
            note('window read ended', error=str(error))
        if 'failed' in seen:
            break
        if time.monotonic() - last_shot > 20:
            screenshot('progress')
            last_shot = time.monotonic()
    REPORT['stagesShown'] = seen
    assert 'failed' not in seen, 'The update failed; see the screenshots'
    exit_code = app.wait(timeout=30)
    note('old VOCO exited', code=exit_code, installed=installed())
    assert exit_code == 0, exit_code
    assert installed() == TARGET, installed()

    # The relaunch: a new /usr/bin/voco, the published release, starts on its own.
    new = wait_for(lambda: [pid for pid in voco_pids() if pid != app.pid], 'the restarted VOCO', 30)
    new_pid = new[0]
    exe = os.readlink(f'/proc/{new_pid}/exe')
    note('new VOCO running', pid=new_pid, exe=exe, ppid=int(Path(f'/proc/{new_pid}/stat').read_text().split()[3]))
    time.sleep(8)
    assert new_pid in voco_pids(), 'The restarted VOCO exited'
    version = subprocess.run(['/usr/bin/voco', '--version'], capture_output=True, text=True).stdout.strip()
    note('new VOCO still running after 8 s', version=version)
    assert version == f'VOCO {TARGET}', version
    screenshot('after-restart')
    REPORT['passed'] = True
    (OUT / 'REPORT.json').write_text(json.dumps(REPORT, indent=2) + '\n')
    subprocess.run(['kill', str(new_pid)])
    print('PASSED')


START = time.monotonic()
try:
    main()
except BaseException as error:
    note('failed', error=repr(error))
    screenshot('failure')
    REPORT['visibleText'] = visible_text()
    (OUT / 'FAILURE.json').write_text(json.dumps(REPORT, indent=2) + '\n')
    raise
