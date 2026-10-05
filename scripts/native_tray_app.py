"""Tray app helpers the GNOME and KDE native suites share; the Wayland suite uses the menu click.

They pump the caller's GLib main context and reach VOCO's real StatusNotifierItem
and DBusMenu through the caller's session-bus call(name, path, interface, method,
values).
"""
import hashlib
import json
from pathlib import Path
import time

from gi.repository import Gio, GLib


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


def pinned_model(root, evidence):
    """The staged model's SHA-256, which must be MODEL-IDENTITY.json's; that file joins the evidence sources."""
    model = root / 'speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'
    assert model.exists(), 'Lifecycle acceptance requires pinned model cache'
    model_hash = hashlib.sha256(model.read_bytes()).hexdigest()
    identity = Path(__file__).resolve().parent.parent / 'runtime/speech/MODEL-IDENTITY.json'
    assert model_hash == json.loads(identity.read_text())['model_sha256'], 'Model differs from pinned runtime identity'
    (evidence / 'sources/MODEL-IDENTITY.json').write_bytes(identity.read_bytes())
    return model_hash


def visible_app(app, report):
    """The app's first showing frame of at least 300x300; report keeps the last showing frame."""
    from gi.repository import Atspi
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


def tray_menu(call, app, report):
    """(service, menu path) of the item the app's own process registered with the watcher."""
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
    return service, menu


def dbusmenu_activate(call, service, menu, label):
    """Clicks the menu item labelled label, as a tray host does."""
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


def wait_ready(app, log, trace, previous_ready_count):
    """Waits for the warm model in the app's log, then for the renderer to take shortcuts again."""
    def cache_ready():
        assert app.poll() is None
        return 'Bundled Nemotron streaming model ready' in log.read_text()
    wait_for(cache_ready)
    def frontend_ready():
        return trace.exists() and trace.read_text().count('frontend_hotkey_handler_ready') > previous_ready_count
    wait_for(frontend_ready)
