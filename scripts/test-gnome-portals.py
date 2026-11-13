#!/usr/bin/python3
"""CI's portal suite: the snap's typing through GNOME's portal, and its
shortcut through GNOME's keyboard shortcuts.

An actual headless GNOME Shell 50 with XWayland, PipeWire, xdg-desktop-portal
and its GNOME backend, whose dialog this answers over AT-SPI, and GNOME's
media keys daemon, which runs custom shortcuts. VOCO is the lib test binary's
portal fixture (portal_fixture.rs) as the snap (SNAP_NAME=voco). The portal
names it through its own test hook, from the metadata `snap routine
portal-info` gives a snap, since no snapd runs here. The tester's keys come from
the probe extension's Clutter keyboard inside the Shell. Synthetic text only."""
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
import gi
gi.require_version('Gio', '2.0')
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi, Gio, GLib

root = Path(sys.argv[1]); evidence = root / 'evidence'
fixtures = Path(__file__).resolve().parent / 'fixtures'
PORTAL, PORTAL_PATH = 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop'
WAYLAND = 'voco-portal-test'
FIELD = 'VOCO paste fixture'
# Evdev codes for the probe's keyboard: Shift, Control, and Super+X, VOCO's default.
SHIFT, CONTROL, SUPER, X = 42, 29, 125, 45
# Control+Alt+K, the shortcut Settings changes to, and Control+Alt+J,
# which another custom shortcut already uses.
ALT, K, J = 56, 37, 36
# GNOME's own list of custom shortcuts, and VOCO's entry in it.
MEDIA_KEYS = 'org.gnome.settings-daemon.plugins.media-keys'
CUSTOM = MEDIA_KEYS + '.custom-keybinding'
CUSTOM_ROOT = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/'
VOCO_SHORTCUT, OTHER_SHORTCUT = CUSTOM_ROOT + 'voco/', CUSTOM_ROOT + 'terminal/'
# The refusals: the paste preflight's or portal_keys.rs's remedy without
# GNOME's permission, and portal_keys.rs's after GNOME's Stop.
NOT_ALLOWED, CLOSED_BY_GNOME = 'Choose Allow typing', "GNOME's Stop ended VOCO's typing"
# What `snap routine portal-info` reports for VOCO's snap and its one app.
SNAP_INFO = '[Snap Info]\nInstanceName=voco\nAppName=voco\nDesktopFile=voco_voco.desktop\nHasNetworkStatus=false\n'
report = {'passed': False, 'checks': {}}
processes = []
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
started = time.monotonic()


def note(*parts):
    print(f'[{time.monotonic() - started:7.2f}]', *parts, file=sys.stderr, flush=True)


def wait_for(check, timeout, step=.02):
    deadline = time.monotonic() + timeout
    while True:
        try:
            if value := check(): return value
        except GLib.Error: pass
        if time.monotonic() >= deadline: return None
        time.sleep(step)


def launch(name, args, env=None):
    process = subprocess.Popen(args, env=env, stdout=(evidence / f'{name}.log').open('w'), stderr=subprocess.STDOUT)
    processes.append((name, process))
    return process


def alive():
    for name, process in processes:
        assert process.poll() is None, f'{name} exited with {process.returncode}'


def call(dest, path, iface, method, params=None, reply=None, timeout=5000):
    return bus.call_sync(dest, path, iface, method, params, GLib.VariantType(reply) if reply else None,
                         Gio.DBusCallFlags.NONE, timeout, None)


def probe(method, params=None, reply=None, timeout=5000):
    return call('org.gnome.Shell', '/org/voco/PortalProbe', 'org.voco.PortalProbe', method, params, reply, timeout)


def windows(): return json.loads(probe('Windows', reply='(s)').unpack()[0])
def dialogs(): return [w['title'] for w in windows() if w['title'] != FIELD]
def sharing(): return probe('Sharing', reply='(b)').unpack()[0]
def key(code, pressed): probe('Key', GLib.Variant('(ub)', (code, pressed)))


def screenshot(name):
    try: probe('Screenshot', GLib.Variant('(s)', (str(evidence / f'{name}.png'),)), timeout=15000)
    except GLib.Error as error: note('screenshot', name, 'failed:', error.message)


def chord(hold=.08):
    """Super+X, as a hand presses it."""
    key(SUPER, True); time.sleep(.03); key(X, True); time.sleep(hold)
    key(X, False); time.sleep(.03); key(SUPER, False)


def gsettings(*arguments):
    """GNOME's own tool with GNOME's own schemas, as GNOME Settings reads and
    writes the shortcuts."""
    return subprocess.run(['gsettings', *arguments], check=True, capture_output=True, text=True).stdout.strip()


def custom_shortcuts(): return GLib.Variant.parse(GLib.VariantType('as'), gsettings('get', MEDIA_KEYS, 'custom-keybindings')).unpack()
def custom(path, name): return GLib.Variant.parse(None, gsettings('get', f'{CUSTOM}:{path}', name)).unpack()


def toggled(count, timeout=2):
    """GNOME's daemon runs the shortcut's command, which calls VOCO."""
    return wait_for(lambda: voco.counts()['toggles'] == count, timeout)


def press(*codes, hold=.08):
    """Any chord as a hand presses it: its modifiers, then its key, last."""
    for code in codes[:-1]: key(code, True); time.sleep(.03)
    key(codes[-1], True); time.sleep(hold); key(codes[-1], False)
    for code in reversed(codes[:-1]): time.sleep(.03); key(code, False)


def owner_pid(name):
    return call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
                GLib.Variant('(s)', (name,)), '(u)').unpack()[0]


def activation_environment(variables):
    call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'UpdateActivationEnvironment',
         GLib.Variant('(a{ss})', (variables,)))


def portal_version(interface):
    return call(PORTAL, PORTAL_PATH, 'org.freedesktop.DBus.Properties', 'Get',
                GLib.Variant('(ss)', (interface, 'version')), '(v)').unpack()[0]


# --- GNOME's dialogs, over AT-SPI ------------------------------------------------------------
def showing(node): return node.get_state_set().contains(Atspi.StateType.SHOWING)
def sensitive(node): return node.get_state_set().contains(Atspi.StateType.SENSITIVE)


def find_all(node, predicate, depth=0):
    found = []
    if depth > 30: return found
    try:
        if predicate(node): found.append(node)
        for index in range(node.get_child_count()):
            found += find_all(node.get_child_at_index(index), predicate, depth + 1)
    except GLib.Error: pass
    return found


def button(name):
    desktop = Atspi.get_desktop(0)
    for app in (desktop.get_child_at_index(i) for i in range(desktop.get_child_count())):
        if not app: continue
        found = find_all(app, lambda n: n.get_role_name() in ('push button', 'button') and n.get_name() == name and showing(n))
        if found: return app, found[0]
    return None


def toggle(app, name):
    """GNOME 50's switch rows expose two nodes with the row's name; only the
    GtkSwitch inside has the toggle action."""
    for node in find_all(app, lambda n: n.get_name() == name and n.get_role_name() in ('switch', 'toggle button', 'check box') and showing(n)):
        action = node.get_action_iface()
        names = [action.get_action_name(i) for i in range(action.get_n_actions())] if action else []
        if 'toggle' in names:
            action.do_action(names.index('toggle')); return True
    return False


def answer(label, approve, switch=None):
    """Waits for GNOME's dialog, switches on what approving needs, then approves."""
    # VOCO answering first means its request ended without one.
    found = wait_for(lambda: button(approve) or (not voco.replies.empty() and 'answered'), 30, step=.1)
    if not isinstance(found, tuple):
        screenshot(label + '-missing')
        early = voco.reply(1) if found == 'answered' else None
        raise AssertionError(f'GNOME showed no dialog with {approve}: {dialogs()}; VOCO answered {early}')
    app, node = found
    time.sleep(.4)
    record = {'app': app.get_name(), 'windows': dialogs()}
    screenshot(label)
    if switch:
        assert not sensitive(node), f'{approve} must wait for {switch}'
        assert toggle(app, switch), f'no {switch} switch'
        record['switchedOn'] = switch
    assert wait_for(lambda: sensitive(node), 5), f'{approve} stayed insensitive'
    node.get_action_iface().do_action(0)
    return record


# --- the field the pastes land in ------------------------------------------------------------
class PasteField:
    """fixtures/paste-field.py: one focused GTK 3 entry that reports each Insert
    press and each change of its text, with CLOCK_MONOTONIC times."""
    def __init__(self, env):
        self.records = []; self.lock = threading.Lock()
        self.process = subprocess.Popen(['/usr/bin/python3', str(fixtures / 'paste-field.py')], env=env,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        threading.Thread(target=self.read, daemon=True).start()
        assert wait_for(lambda: self.seen('ready'), 20), 'the paste field did not start'
        self.focus()
    def focus(self):
        def focused():
            if any(w['focused'] and w['title'] == FIELD for w in windows()): return True
            probe('ActivateWindow', GLib.Variant('(s)', (FIELD,)), '(b)'); return False
        assert wait_for(focused, 10, step=.1), f'the paste field did not take focus: {windows()}'
        time.sleep(.3)
    def read(self):
        for line in self.process.stdout:
            with self.lock: self.records.append(json.loads(line))
    def seen(self, what, since=0.0):
        with self.lock: return [r for r in self.records if r['what'] == what and r['t'] >= since]
    def command(self, line, reply):
        mark = time.monotonic(); self.process.stdin.write(line + '\n'); self.process.stdin.flush()
        assert wait_for(lambda: self.seen(reply, mark), 3), line
    def text(self):
        texts = self.seen('text'); return texts[-1]['text'] if texts else ''
    def clear(self):
        self.command('clear', 'cleared')
    def close(self):
        self.process.terminate(); self.process.wait(timeout=5); time.sleep(.3)


# --- VOCO ------------------------------------------------------------------------------------
class Fixture:
    """portal_fixture.rs: one JSON command per line, one reply line for each."""
    REPLY = 'VOCO-PORTAL-FIXTURE '
    def __init__(self, env):
        self.replies = queue.Queue(); self.log = (evidence / 'voco.log').open('w')
        self.process = subprocess.Popen([str(root / 'portal-test'), '--ignored', '--exact',
                                         'portal_fixture::serve_the_portal_suite', '--nocapture', '--test-threads=1'],
                                        env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, bufsize=1)
        processes.append(('VOCO', self.process))
        threading.Thread(target=self.read, daemon=True).start()
    def read(self):
        for line in self.process.stdout:
            # libtest's "test NAME ... " has no line end, so the first reply follows it.
            before, marker, reply = line.partition(self.REPLY)
            if before: self.log.write(before if marker else line); self.log.flush()
            if marker: self.replies.put(json.loads(reply))
    def send(self, command, **arguments):
        self.process.stdin.write(json.dumps({'do': command, **arguments}) + '\n'); self.process.stdin.flush()
    def reply(self, timeout=15):
        try: return self.replies.get(timeout=timeout)
        except queue.Empty: raise AssertionError(f'VOCO gave no answer within {timeout} s') from None
    def ask(self, command, timeout=15, **arguments):
        self.send(command, **arguments); return self.reply(timeout)
    def counts(self): return self.ask('counts')['counts']
    def quit(self):
        self.send('quit')
        try: self.process.wait(timeout=10)
        except subprocess.TimeoutExpired: self.process.kill()
        return self.process.returncode


def typing_sessions():
    """VOCO's RemoteDesktop sessions as the portal holds them."""
    sender = voco_bus_name.lstrip(':').replace('.', '_')
    try:
        xml = call(PORTAL, f'{PORTAL_PATH}/session/{sender}', 'org.freedesktop.DBus.Introspectable', 'Introspect',
                   reply='(s)').unpack()[0]
    except GLib.Error:
        return []
    return [node.path for node in Gio.DBusNodeInfo.new_for_xml(xml).nodes if node.path.startswith('voco_typing_')]


def paste(field, text):
    """One production desktop paste, which must land whole, from one Insert."""
    field.clear()
    mark = time.monotonic()
    answered = voco.ask('paste', text=text)
    assert 'ok' in answered, answered
    metrics = answered['ok']['pasteMetrics']
    assert metrics['pasteKeys'] == 'portal', metrics
    assert wait_for(lambda: field.text() == text, 3), {'expected': text, 'field': field.text()}
    inserts = field.seen('insert', mark)
    assert len(inserts) == 1 and inserts[0]['shift'], inserts
    return {'insertAfterMs': round((inserts[0]['t'] - mark) * 1000, 1), 'selectionRead': metrics['selectionRead'],
            'modifierWaitMs': metrics['modifierWaitMs']}


def refused(field, text, detail, outcomes=('no-mutation',)):
    """A paste that must type nothing and say why."""
    field.clear()
    mark = time.monotonic()
    answered = voco.ask('paste', text=text)
    error = answered.get('error') or {}
    assert error.get('outcome') in outcomes and detail in error.get('message', ''), answered
    time.sleep(.5)
    assert not field.seen('insert', mark) and field.text() == '', 'a refused paste sent keys'
    return {'outcome': error['outcome'], 'message': error['message'], 'clipboardChanged': error['clipboardChanged']}


def begin(label, keyboard=True):
    """A dictation starts: GNOME restores VOCO's permission without a dialog.
    The session types through GNOME's keyboard connection unless the fixture
    was told to do without it, as on a GNOME that offers none."""
    answered = voco.ask('begin')
    if not answered['session']: screenshot(label + '-no-session')
    assert answered['session'], f'no typing session started: {dialogs()}'
    assert not dialogs(), f'a restored session showed a dialog: {dialogs()}'
    assert wait_for(lambda: answered['session'].rsplit('/', 1)[1] in typing_sessions(), 2), typing_sessions()
    # GNOME 50 reports the modifiers as its keyboard resumes; without the
    # connection nothing is known.
    counts = answered['counts']
    assert counts['keyboard'] is keyboard and counts['modifiersHeld'] is (False if keyboard else None), counts
    return answered['session']


def end(session):
    voco.ask('end')
    assert wait_for(lambda: session.rsplit('/', 1)[1] not in typing_sessions(), 3), 'the session outlived its dictation'
    assert voco.ask('session')['session'] is None


def check(name, function):
    note('==', name)
    alive()
    t0 = time.monotonic()
    report['checks'][name] = result = function()
    report['checks'][name + 'Seconds'] = round(time.monotonic() - t0, 1)
    return result


shell = voco = field = None
try:
    system_address = 'unix:path=' + str(root / 'runtime/system-test-bus')
    launch('system-bus', ['dbus-daemon', '--session', '--nofork', '--address=' + system_address])
    os.environ['DBUS_SYSTEM_BUS_ADDRESS'] = system_address
    runtime = Path(os.environ['XDG_RUNTIME_DIR'])
    for schema, key_name, value in (('org.gnome.shell', 'enabled-extensions', "['voco-portal-probe@test.invalid']"),
                                    ('org.gnome.shell', 'disable-user-extensions', 'false'),
                                    ('org.gnome.shell', 'welcome-dialog-last-shown-version', "'999'"),
                                    ('org.gnome.desktop.interface', 'enable-animations', 'false'),
                                    ('org.gnome.desktop.interface', 'enable-hot-corners', 'false'),
                                    ('org.gnome.desktop.session', 'idle-delay', 'uint32 0'),
                                    ('org.gnome.desktop.screensaver', 'lock-enabled', 'false')):
        subprocess.run(['gsettings', 'set', schema, key_name, value], check=True)
    # A GNOME login has PipeWire, without which the portal offers no
    # RemoteDesktop, and gnome-session's gnome-portals.conf, without which it
    # picks the GTK backend for everything. The Shell's start activates the
    # portal, so both come first.
    launch('pipewire', ['pipewire'])
    assert wait_for((runtime / 'pipewire-0').exists, 30), 'PipeWire did not start'
    # WirePlumber exits when PipeWire isn't listening yet.
    launch('wireplumber', ['wireplumber'])
    portals = Path(os.environ['XDG_CONFIG_HOME']) / 'xdg-desktop-portal'; portals.mkdir(parents=True)
    (portals / 'gnome-portals.conf').write_text('[preferred]\ndefault=gnome;gtk;\n')
    # Where snapd installs the snap's entry; the portal refuses an app it can't
    # find one for. GLib skips an entry whose Exec program doesn't exist, so
    # this one runs true where the snap's runs /snap/bin/voco.
    applications = Path(os.environ['XDG_DATA_HOME']) / 'applications'; applications.mkdir(parents=True)
    (applications / 'voco_voco.desktop').write_text('[Desktop Entry]\nType=Application\nName=VOCO\nExec=/usr/bin/true\n'
                                                    'Icon=audio-input-microphone\nNoDisplay=true\n')
    (root / 'snap-portal-info').write_text(SNAP_INFO)
    # Every caller is the voco snap to the portal; only VOCO calls it here.
    snap_portal = {'XDG_DESKTOP_PORTAL_TEST_APP_INFO_KIND': 'snap',
                   'XDG_DESKTOP_PORTAL_TEST_SNAP_METADATA': str(root / 'snap-portal-info')}
    session_env = {'XDG_SESSION_TYPE': 'wayland', 'XDG_CURRENT_DESKTOP': 'ubuntu:GNOME', 'XDG_SESSION_DESKTOP': 'ubuntu',
                   'GNOME_SHELL_SESSION_MODE': 'user', 'WAYLAND_DISPLAY': WAYLAND, 'GDK_BACKEND': 'wayland'}
    activation_environment({**session_env, **snap_portal})
    Path('/tmp/.X11-unix').mkdir(mode=0o1777, exist_ok=True); os.chmod('/tmp/.X11-unix', 0o1777)
    shell = launch('shell', ['gnome-shell', '--headless', '--virtual-monitor', '1280x800', '--wayland',
                             f'--wayland-display={WAYLAND}'], env={**os.environ, **session_env})
    # A busy runner has taken 16 seconds to start the Shell (test-gnome-panel.py).
    assert wait_for(lambda: (alive(), windows())[1] is not None, 120, step=.2), 'the Shell did not start'
    # Hidden during the startup animation, the overview sometimes stalls it.
    assert wait_for(lambda: not probe('StartingUp', reply='(b)').unpack()[0], 60, step=.2), 'the Shell never finished starting'
    probe('HideOverview')
    # The probe's keyboard exists from its first key, before any client.
    key(SHIFT, True); key(SHIFT, False)
    display = wait_for(lambda: re.findall(r'Using public X11 display (:\d+)', (evidence / 'shell.log').read_text()), 30)
    authority = wait_for(lambda: sorted(runtime.glob('.mutter-Xwaylandauth.*')), 30)
    assert display and authority, 'the Shell offers no XWayland'
    x11 = {'DISPLAY': display[-1], 'XAUTHORITY': str(authority[-1])}
    activation_environment(x11)
    desktop_env = {**os.environ, **session_env, **x11}
    # Started again with --replace, for their logs.
    backend = launch('portal-gnome', ['/usr/libexec/xdg-desktop-portal-gnome', '--verbose', '--replace'], env=desktop_env)
    assert wait_for(lambda: owner_pid('org.freedesktop.impl.portal.desktop.gnome') == backend.pid, 30), 'no GNOME portal backend'
    frontend = launch('portal', ['/usr/libexec/xdg-desktop-portal', '--verbose', '--replace'], env={**desktop_env, **snap_portal})
    assert wait_for(lambda: owner_pid(PORTAL) == frontend.pid, 30), 'no desktop portal'
    report['portal'] = {'remoteDesktop': portal_version('org.freedesktop.portal.RemoteDesktop'),
                        'globalShortcuts': portal_version('org.freedesktop.portal.GlobalShortcuts')}
    # A GNOME session runs this daemon, which grabs custom shortcuts in the
    # Shell and runs their commands.
    media_keys = launch('media-keys', ['/usr/libexec/gsd-media-keys'], env=desktop_env)
    assert wait_for(lambda: owner_pid('org.gnome.SettingsDaemon.MediaKeys') == media_keys.pid, 30), 'no media keys daemon'
    report['shell'] = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    field = PasteField({**desktop_env, 'GDK_BACKEND': 'wayland'})
    voco = Fixture({**desktop_env, 'SNAP_NAME': 'voco', 'RUST_BACKTRACE': '1'})
    status = voco.ask('status')
    voco_bus_name = status['busName']
    report['before'] = status
    assert status['applies'] and status['shortcutPortal'] and status['shortcutAvailable'], status
    assert not status['typingAllowed'] and status['binding'] is None and not custom_shortcuts(), status

    def without_permission():
        # Dictation without GNOME's permission opens nothing and types nothing.
        assert voco.ask('begin')['session'] is None and not typing_sessions()
        refusal = refused(field, 'notallowedx', NOT_ALLOWED)
        # The paste preflight refuses before the copy.
        assert not refusal['clipboardChanged'], refusal
        voco.ask('end')
        return {'refused': refusal}
    check('withoutPermission', without_permission)

    def allow_typing():
        # Setup's Allow typing: GNOME asks once, and VOCO keeps its answer.
        voco.send('allow-typing')
        dialog = answer('dialog-remote-desktop', 'Share', switch='Allow Remote Interaction')
        answered = voco.reply(30)
        assert answered.get('ok', False) is None, answered
        assert voco.ask('status')['typingAllowed'] and (Path(os.environ['XDG_CONFIG_HOME']) / 'voco/remote-desktop-token').exists()
        # The test session closes at once: no session while idle.
        assert wait_for(lambda: not typing_sessions(), 3), typing_sessions()
        field.focus()
        return {'dialog': dialog}
    check('allowTyping', allow_typing)

    texts = ['Hello from the portal.', 'two words', 'café naïve über', 'Ünïcödé — dashes – and “quotes”',
             'numbers 0123456789', 'punctuation ,.;:!?', "it's VOCO's", 'a', 'tabs\tbecome spaces', 'end of the line']
    expected = [text.replace('\t', ' ') for text in texts]

    def wayland_dictation():
        session = begin('wayland')
        shown = wait_for(sharing, 3)
        screenshot('remote-access-icon')
        pastes = []
        for text, landing in zip(texts, expected):
            pastes.append(paste_expect(field, text, landing))
        end(session)
        return {'pastes': len(pastes), 'remoteAccessIcon': bool(shown), 'runs': pastes}

    def paste_expect(target, text, landing):
        # ASCII controls become spaces (insertion.rs paste_text).
        if text == landing: return paste(target, text)
        target.clear(); mark = time.monotonic()
        answered = voco.ask('paste', text=text)
        assert 'ok' in answered, answered
        assert wait_for(lambda: target.text() == landing, 3), {'expected': landing, 'field': target.text()}
        assert len(target.seen('insert', mark)) == 1
        return {'routed': True}
    check('waylandDictation', wayland_dictation)

    def xwayland_dictation():
        global field
        field.close()
        field = PasteField({**desktop_env, 'GDK_BACKEND': 'x11'})
        session = begin('xwayland')
        pastes = [paste_expect(field, text, landing) for text, landing in zip(texts, expected)]
        end(session)
        field.close()
        field = PasteField({**desktop_env, 'GDK_BACKEND': 'wayland'})
        return {'pastes': len(pastes), 'runs': pastes}
    check('xwaylandDictation', xwayland_dictation)

    def remote_access_stop():
        # GNOME's remote-access icon's Stop ends the dictation; no key follows.
        session = begin('stop')
        paste(field, 'beforestopx')
        stops = voco.counts()['stops']
        assert wait_for(sharing, 3), 'no remote-access icon'
        mark = time.monotonic()
        probe('StopSharing')
        assert wait_for(lambda: voco.counts()['stops'] == stops + 1, 3), 'GNOME\'s Stop did not stop the dictation'
        assert voco.ask('session')['session'] is None
        # The refusal comes after the copy, which paste_transaction reports as
        # uncertain whatever the keyboard said; what matters here is that no
        # key went out.
        refusal = refused(field, 'afterstopx', CLOSED_BY_GNOME, outcomes=('no-mutation', 'uncertain'))
        assert not field.seen('insert', mark)
        assert session.rsplit('/', 1)[1] not in typing_sessions()
        voco.ask('end')
        # The permission survives GNOME's Stop: the next dictation restores it.
        again = begin('after-stop')
        paste(field, 'afterrestorex')
        end(again)
        return {'refused': refusal, 'stopsRequested': voco.counts()['stops'] - stops}
    check('remoteAccessStop', remote_access_stop)

    def idle_guard():
        # A session no dictation reports needing closes by itself.
        answered = voco.ask('begin-idle')
        assert answered['session'], 'no typing session started'
        t0 = time.monotonic()
        assert wait_for(lambda: voco.ask('session')['session'] is None and not typing_sessions(), 12, step=.2), \
            'an idle session stayed open'
        return {'closedAfterS': round(time.monotonic() - t0, 1)}
    check('idleGuard', idle_guard)

    def shortcut():
        # Setup adds VOCO's shortcut to GNOME's keyboard shortcuts, which asks
        # nobody. GNOME's own daemon then runs its command for Super+X, the
        # command calls VOCO, and the keys never reach the focused app.
        served = voco.ask('serve-shortcut')
        assert 'ok' in served, served
        answered = voco.ask('hold-shortcut', text='Super+X')
        assert 'ok' in answered, answered
        assert not dialogs(), f'adding the shortcut showed a dialog: {dialogs()}'
        # What GNOME Settings shows under Keyboard, read with GNOME's schema.
        assert custom_shortcuts() == [VOCO_SHORTCUT], custom_shortcuts()
        entry = {name: custom(VOCO_SHORTCUT, name) for name in ('name', 'binding', 'command')}
        assert entry['name'] == 'VOCO' and entry['binding'] == '<Super>x', entry
        assert 'com.sergiopesch.voco.Panel1.Toggle' in entry['command'] and entry['command'].endswith("--toggle'"), entry
        status = voco.ask('status')
        assert status['binding'] == '<Super>x' and status['command'] == entry['command'], status
        assert voco.ask('shortcut-present', text='Super+X')['present'] and not voco.ask('shortcut-present', text='Alt+D')['present']
        # Asked again, as when setup runs again: nothing changes, nobody is asked.
        assert 'ok' in voco.ask('hold-shortcut', text='Super+X') and custom_shortcuts() == [VOCO_SHORTCUT]
        field.focus(); field.clear()
        toggles = voco.counts()['toggles']
        # The daemon grabs the keys once it has read the new entry.
        assert wait_for(lambda: (chord(), time.sleep(.8), voco.counts()['toggles'] > toggles)[2], 15, step=0), 'Super+X never reached VOCO'
        # A press before the daemon's grab went to the field.
        field.clear(); time.sleep(.8)
        toggles = voco.counts()['toggles']
        for _ in range(3):
            chord(); time.sleep(.8)
        assert voco.counts()['toggles'] == toggles + 3, voco.counts()
        assert field.text() == '', f'Super+X reached the focused app: {field.text()!r}'
        return {'entry': entry, 'toggles': 3}
    check('shortcut', shortcut)

    def held_shortcut(keyboard=True):
        # A paste while the chord is down waits. With GNOME's keyboard
        # connection it goes out once Super is really up; without it, GNOME
        # reports no release of either key, so it waits the repeat delay and
        # the modifier's grace after the shortcut's last call.
        time.sleep(.8)
        session = begin('held', keyboard)
        field.clear()
        toggles = voco.counts()['toggles']
        key(SUPER, True); time.sleep(.03)
        pressed = time.monotonic(); key(X, True)
        assert toggled(toggles + 1), 'the press did not toggle'
        held = voco.counts()
        assert held['keysHeld'] is True and held['modifiersHeld'] is (True if keyboard else None), held
        mark = time.monotonic()
        voco.send('paste', text='heldx')
        time.sleep(.3)
        # People often let go of Super a moment after the letter.
        released = time.monotonic(); key(X, False); time.sleep(.3)
        assert field.text() == '', f'a paste went out under Super: {field.text()!r}'
        super_released = time.monotonic(); key(SUPER, False)
        answered = voco.reply(5)
        assert 'ok' in answered, answered
        assert wait_for(lambda: field.text() == 'heldx', 3), field.text()
        inserts = field.seen('insert', mark)
        assert len(inserts) == 1 and inserts[0]['shift'], inserts
        after_press = inserts[0]['t'] - pressed
        after_super = inserts[0]['t'] - super_released
        assert after_super > 0, 'the paste went out while Super was down'
        if keyboard: assert after_super < .25, f'the Insert came {after_super:.3f} s after Super came up'
        else: assert .85 <= after_press < 1.7, f'the Insert came {after_press:.3f} s after the press'
        assert after_press < 2, 'the paste waited past 1.5 s from the press'
        assert voco.counts()['toggles'] == toggles + 1, 'the held chord toggled again'
        end(session)
        return {'insertAfterPressMs': round(after_press * 1000, 1), 'insertAfterSuperMs': round(after_super * 1000, 1),
                'modifierWaitMs': answered['ok']['pasteMetrics']['modifierWaitMs']}
    check('heldShortcut', held_shortcut)

    def modifier_first(keyboard=True):
        # Super let go first, as people often do. GNOME's keyboard connection
        # says Super is up, so the paste goes out at once; without it the
        # paste waits out the press's grace, about 900 ms after it, and never
        # its own 1.5 s.
        time.sleep(.8)
        session = begin('modifier-first', keyboard)
        field.clear()
        before = voco.counts()
        key(SUPER, True); time.sleep(.03)
        pressed = time.monotonic(); key(X, True)
        assert toggled(before['toggles'] + 1), 'the press did not toggle'
        time.sleep(.08)
        key(SUPER, False); time.sleep(.05); key(X, False)
        after = voco.counts()
        assert after['keysHeld'] is True, 'a press GNOME reported no release for was not held'
        if keyboard: assert wait_for(lambda: voco.counts()['modifiersHeld'] is False, 1), voco.counts()
        mark = time.monotonic()
        voco.send('paste', text='superfirst')
        answered = voco.reply(5)
        assert 'ok' in answered, answered
        assert wait_for(lambda: field.text() == 'superfirst', 3), field.text()
        inserts = field.seen('insert', mark)
        assert len(inserts) == 1 and inserts[0]['shift'], inserts
        after_press = inserts[0]['t'] - pressed
        wait = answered['ok']['pasteMetrics']['modifierWaitMs']
        if keyboard:
            assert wait < 50, f'the paste waited {wait} ms for keys GNOME said were up'
        else:
            assert .85 <= after_press < 1.4, f'the Insert came {after_press:.3f} s after the press'
            assert voco.counts()['keysHeld'] is None, voco.counts()
        end(session)
        return {'insertAfterPressMs': round(after_press * 1000, 1), 'modifierWaitMs': wait}
    check('modifierFirst', modifier_first)

    def held_past_repeat(keyboard=True):
        # A chord held past the repeat delay keeps repeating: GNOME runs the
        # command again for each repeat, and none of them toggles. With
        # GNOME's keyboard connection the paste goes out once Super is up.
        # Without it the chord counts as held until its repeats stop, so a
        # paste that outwaits its 1.5 s types nothing, keeps its text
        # pending, and lands once the keys have been up for their grace.
        time.sleep(.8)
        session = begin('held-past-repeat', keyboard)
        field.clear()
        before = voco.counts()
        key(SUPER, True); time.sleep(.03)
        key(X, True)
        assert toggled(before['toggles'] + 1), 'the press did not toggle'
        mark = time.monotonic()
        voco.send('paste', text='heldlong')
        result = {}
        try:
            if keyboard:
                time.sleep(1.0)
                assert field.text() == '', f'a paste went out under the held chord: {field.text()!r}'
            else:
                answered = voco.reply(5)
                error = answered.get('error') or {}
                assert error.get('outcome') == 'no-mutation' and 'Release the keyboard modifiers' in error.get('message', ''), answered
                assert field.text() == '' and not field.seen('insert', mark), 'a refused paste sent keys'
                result['refused'] = error['message']
        finally:
            key(X, False); time.sleep(.03)
            super_released = time.monotonic(); key(SUPER, False)
        if keyboard:
            answered = voco.reply(5)
            assert 'ok' in answered, answered
            assert wait_for(lambda: field.text() == 'heldlong', 3), field.text()
            inserts = field.seen('insert', mark)
            assert len(inserts) == 1 and inserts[0]['shift'], inserts
            after_super = inserts[0]['t'] - super_released
            assert 0 < after_super < .25, f'the Insert came {after_super:.3f} s after Super came up'
            result['insertAfterSuperMs'] = round(after_super * 1000, 1)
        else:
            assert voco.counts()['keysHeld'] is True, 'the last repeat was not held'
            assert wait_for(lambda: voco.counts()['keysHeld'] is None, 2), voco.counts()
            waited = time.monotonic() - super_released
            assert waited >= .8, f'the chord stopped counting as held {waited:.3f} s after its keys came up'
            paste(field, 'heldlong')
        after = voco.counts()
        repeats = after['calls'] - before['calls'] - 1
        assert repeats > 0, f'GNOME ran the command for no repeat: {after}'
        assert after['toggles'] == before['toggles'] + 1, 'the held chord toggled again'
        end(session)
        return {'repeats': repeats, **result}
    check('heldPastRepeat', held_past_repeat)

    def quick_stop():
        # Pressed again half a second after the last press, the time a held
        # chord's first repeat takes, as when a dictation is stopped just
        # after it started: GNOME's keyboard connection saw Super come up in
        # between, so the second press toggles too.
        time.sleep(.8)
        session = begin('quick-stop')
        toggles = voco.counts()['toggles']
        first = time.monotonic(); chord()
        assert toggled(toggles + 1), 'the press did not toggle'
        assert wait_for(lambda: voco.counts()['modifiersHeld'] is False, 1), voco.counts()
        time.sleep(max(0, first + .5 - time.monotonic()))
        gap = time.monotonic() - first; chord()
        assert .45 <= gap < .58, f'the second press came {gap:.3f} s after the first'
        assert toggled(toggles + 2), 'a press half a second after the last was taken for a held chord'
        end(session)
        return {'gapMs': round(gap * 1000, 1)}
    check('quickStop', quick_stop)

    def held_modifier():
        # A modifier held with no shortcut press, as Control under a finger:
        # GNOME's keyboard connection reports it, so the paste waits for it
        # instead of becoming Control+Shift+Insert, which pastes nothing.
        session = begin('held-modifier')
        field.clear()
        key(CONTROL, True)
        assert wait_for(lambda: voco.counts()['modifiersHeld'] is True, 1), voco.counts()
        mark = time.monotonic()
        voco.send('paste', text='afterctrl')
        time.sleep(.5)
        assert field.text() == '' and not field.seen('insert', mark), 'a paste went out under Control'
        released = time.monotonic(); key(CONTROL, False)
        answered = voco.reply(5)
        assert 'ok' in answered, answered
        assert wait_for(lambda: field.text() == 'afterctrl', 3), field.text()
        inserts = field.seen('insert', mark)
        assert len(inserts) == 1 and inserts[0]['shift'], inserts
        after_release = inserts[0]['t'] - released
        assert 0 < after_release < .25, f'the Insert came {after_release:.3f} s after Control came up'
        # Held past the 1.5 s wait, the paste types nothing and says why.
        key(CONTROL, True)
        assert wait_for(lambda: voco.counts()['modifiersHeld'] is True, 1), voco.counts()
        try: refusal = refused(field, 'underctrl', 'Release the keyboard modifiers')
        finally: key(CONTROL, False)
        assert wait_for(lambda: voco.counts()['modifiersHeld'] is False, 1), voco.counts()
        paste(field, 'ctrlisup')
        end(session)
        return {'insertAfterReleaseMs': round(after_release * 1000, 1), 'refused': refusal}
    check('heldModifier', held_modifier)

    def modifier_under_shift():
        # A modifier that goes down after the paste's own check, under VOCO's
        # Shift, as the shortcut's does when it is pressed to stop just as
        # words go out: no Insert follows, nothing is typed, the text stays
        # pending, and it goes once the modifier is up.
        session = begin('modifier-under-shift')
        field.clear()
        voco.ask('shift-hold', ms=1000)
        try:
            mark = time.monotonic()
            voco.send('paste', text='undershift')
            time.sleep(.5)
            key(CONTROL, True)
            answered = voco.reply(5)
            error = answered.get('error') or {}
            assert error.get('outcome') == 'no-mutation' and 'went down as VOCO typed' in error.get('message', ''), answered
            assert error['clipboardChanged'] is True, error
            time.sleep(.3)
            assert field.text() == '' and not field.seen('insert', mark), 'Insert went out under Control'
        finally:
            key(CONTROL, False)
            voco.ask('shift-hold', ms=0)
        assert wait_for(lambda: voco.counts()['modifiersHeld'] is False, 1), voco.counts()
        landed = paste(field, 'undershift')
        end(session)
        return {'refused': error['message'], 'thenLanded': landed}
    check('modifierUnderShift', modifier_under_shift)

    def without_keyboard():
        # A GNOME that gives no keyboard connection: the keys go through the
        # portal's own calls, and the timing of the shortcut's calls says how
        # long to wait for its keys.
        voco.ask('keyboard', wanted=False)
        try:
            session = begin('plain', keyboard=False)
            assert voco.counts()['modifiersHeld'] is None
            pastes = [paste_expect(field, text, landing) for text, landing in zip(texts[:4], expected[:4])]
            end(session)
            return {'pastes': len(pastes), 'heldShortcut': held_shortcut(False), 'modifierFirst': modifier_first(False),
                    'heldPastRepeat': held_past_repeat(False)}
        finally:
            voco.ask('keyboard', wanted=True)
    check('withoutKeyboard', without_keyboard)

    def silent_keyboard():
        # A GNOME whose keyboard connection reports no modifiers: the session
        # that connected closes, a plain one opens in its place and types
        # through the portal's key calls, and the process stops asking.
        voco.ask('keyboard', wanted=True, silent=True)
        try:
            session = begin('silent', keyboard=False)
            assert typing_sessions() == [session.rsplit('/', 1)[1]], typing_sessions()
            first = paste(field, 'plainafterall')
            end(session)
            # The process stopped asking: the next session is plain at once.
            again = begin('silent-again', keyboard=False)
            paste(field, 'stillplain')
            end(again)
            return {'reopened': True, 'paste': first}
        finally:
            voco.ask('keyboard', wanted=True)
    check('silentKeyboard', silent_keyboard)

    def repeated_shortcut():
        # Idle, with no session to report the modifiers: GNOME runs the
        # command for the press and for every repeat of a held chord, every
        # 30 ms after the keyboard's repeat delay, and only the press toggles.
        field.focus(); field.clear()
        time.sleep(.8)
        before = voco.counts()
        chord(hold=1.5); time.sleep(.8)
        after = voco.counts()
        repeats = after['calls'] - before['calls'] - 1
        assert repeats > 0, f'GNOME ran the command for no repeat: {after}'
        assert after['toggles'] == before['toggles'] + 1, f'a held chord toggled {after["toggles"] - before["toggles"]} times'
        assert field.text() == '', f'Super+X reached the focused app: {field.text()!r}'
        chord()
        assert toggled(before['toggles'] + 2), 'the press after the release did not toggle'
        return {'repeats': repeats}
    check('repeatedShortcut', repeated_shortcut)

    def change_shortcut():
        # A saved change of shortcut moves VOCO's entry in GNOME's keyboard
        # shortcuts at once, with no dialog, any number of times; only the
        # new keys toggle.
        field.focus(); field.clear(); time.sleep(.8)
        changes = []
        for hotkey, binding, keys, earlier in (('Ctrl+Alt+K', '<Control><Alt>k', (CONTROL, ALT, K), (SUPER, X)),
                                              ('Super+X', '<Super>x', (SUPER, X), (CONTROL, ALT, K)),
                                              ('Ctrl+Alt+K', '<Control><Alt>k', (CONTROL, ALT, K), (SUPER, X))):
            t0 = time.monotonic()
            changed = voco.ask('keep-shortcut', text=hotkey)
            assert 'ok' in changed, changed
            assert not dialogs(), f'a change showed a dialog: {dialogs()}'
            assert custom_shortcuts() == [VOCO_SHORTCUT] and custom(VOCO_SHORTCUT, 'binding') == binding, custom(VOCO_SHORTCUT, 'binding')
            toggles = voco.counts()['toggles']
            assert wait_for(lambda: (press(*keys), time.sleep(.8), voco.counts()['toggles'] > toggles)[2], 15, step=0), f'{hotkey} never reached VOCO'
            changes.append({'to': hotkey, 'toggledAfterS': round(time.monotonic() - t0, 1)})
            time.sleep(.8)
            toggles = voco.counts()['toggles']
            press(*earlier); time.sleep(.8)
            assert voco.counts()['toggles'] == toggles, f'the earlier keys still toggled after the change to {hotkey}'
            field.clear()
        # Keys another custom shortcut uses, or one of GNOME's window
        # shortcuts: refused with what uses them, and nothing changes.
        gsettings('set', f'{CUSTOM}:{OTHER_SHORTCUT}', 'name', 'Terminal')
        gsettings('set', f'{CUSTOM}:{OTHER_SHORTCUT}', 'command', 'true')
        gsettings('set', f'{CUSTOM}:{OTHER_SHORTCUT}', 'binding', '<Control><Alt>j')
        gsettings('set', MEDIA_KEYS, 'custom-keybindings', str([VOCO_SHORTCUT, OTHER_SHORTCUT]))
        taken = voco.ask('keep-shortcut', text='Ctrl+Alt+J')
        assert 'Ctrl+Alt+J is already your custom shortcut “Terminal”' in taken.get('error', ''), taken
        window = voco.ask('keep-shortcut', text='Alt+F4')
        assert "Alt+F4 is already GNOME's close shortcut" in window.get('error', ''), window
        assert custom(VOCO_SHORTCUT, 'binding') == '<Control><Alt>k' and custom(OTHER_SHORTCUT, 'binding') == '<Control><Alt>j'
        toggles = voco.counts()['toggles']
        press(CONTROL, ALT, K)
        assert toggled(toggles + 1), 'a refused change broke the earlier shortcut'
        press(CONTROL, ALT, J); time.sleep(.8)
        assert voco.counts()['toggles'] == toggles + 1, 'another shortcut\'s keys toggled VOCO'
        # Reset removes VOCO's entry and only it.
        voco.ask('forget-shortcut')
        assert custom_shortcuts() == [OTHER_SHORTCUT] and custom(OTHER_SHORTCUT, 'name') == 'Terminal', custom_shortcuts()
        assert voco.ask('status')['binding'] is None
        time.sleep(.8)
        press(CONTROL, ALT, K); time.sleep(.8)
        assert voco.counts()['toggles'] == toggles + 1, 'a removed shortcut still toggled'
        return {'changes': changes, 'taken': taken['error'], 'windowShortcut': window['error']}
    check('changeShortcut', change_shortcut)

    assert not typing_sessions(), typing_sessions()
    report['passed'] = True
finally:
    report['seconds'] = round(time.monotonic() - started, 1)
    if voco: report['vocoExit'] = voco.quit()
    (evidence / 'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
    if field:
        try: field.close()
        except Exception: pass
    for name, process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill()
