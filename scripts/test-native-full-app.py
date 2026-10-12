#!/usr/bin/python3
"""Full native capture/IPC/inference, pasted into the focused GTK field of a private X11 session.

A private PulseAudio fixture feeds the real app, which copies each recognized chunk to
CLIPBOARD and PRIMARY with xclip, then sends xdotool [Space] Shift+Insert to whatever has
keyboard focus. Each appended suffix is pasted as it arrives; Stop pastes only what
remains, into the field focused at that moment.

delivery: A keeps focus and receives the fixture words exactly once; B stays empty.
focus-switch: the fixture plays with A focused; once A's streamed text settles, focus moves
to B and the fixture plays again, all in one recording. A keeps only text pasted while it
had focus; B receives the rest, including whatever Stop flushes.
spelling: settings without a spelling choice, as an earlier setup has, spell British. The
recognizer writes the fixture's "honor" the American way; A must receive "honour".
lock: a fake logind on a private system bus serves this session, locked when VOCO starts,
so its first read must see the lock and the shortcut starts nothing. After unlocking, a
lock stops a running dictation, the fixture then reaches no field, and the shortcut again
starts nothing; a dictation after unlocking delivers as in delivery.
web-process: WebKit's web process, which runs the renderer that drives dictation, aborts
while a dictation runs, as one did on CI. VOCO must load its window again: a new web
process starts, a second renderer reports ready, the tray returns to Ready, one
notification says the dictation was interrupted, and a dictation afterwards delivers
as in delivery.
Every dictation case fails on IBus preedit or commit, a non-append field change, paste
refusal or failure, a copied remainder, recovery or fallback capture, then checks the real
tray menu and the Ready popover through AT-SPI.
launcher: VOCO starts as GIO launches its desktop entry, naming VOCO.desktop and this
process, and must open the Ready popover by itself once it is ready, with no second launch.
autostart: the same start with DESKTOP_AUTOSTART_ID, as a login autostart has, must stay in
the tray. Neither dictates.
"""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('IBus', '1.0')
from gi.repository import Gtk, Gdk, GLib, IBus, Gio

root = Path(os.environ['VOCO_NATIVE_TEST_ROOT'])
repo = Path(__file__).resolve().parent.parent
assert os.environ['XDG_RUNTIME_DIR'] == str(root / 'runtime')
assert os.environ['PULSE_SERVER'] == 'unix:' + str(root / 'runtime/pulse.sock')
assert os.environ['DISPLAY'] == ':0'
case = os.environ.get('VOCO_NATIVE_APP_CASE', 'delivery')
assert case in ['delivery', 'focus-switch', 'spelling', 'lock', 'web-process', 'launcher', 'autostart'], 'Unsupported native application case'
trace_path = root / 'state/voco/hotkey-trace.jsonl'
model = root / 'speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'
sound = repo / 'tests/fixtures/speech' / ('1673-143396-0000.wav' if case == 'spelling' else '84-121123-0000.wav')
EXPECTED = ['honour'] if case == 'spelling' else ['go', 'do', 'you', 'hear']
# focus-switch speaks the fixture once per field.
expected = EXPECTED * (2 if case == 'focus-switch' else 1)
# Every successful paste session traces these. Trace writes are unordered IPC: count, never order.
REQUIRED = ['dictation_desktop_paste_session_started', 'dictation_desktop_stream_started', 'recording_state_active',
            'dictation_desktop_paste_requested', 'dictation_desktop_paste_dispatched', 'dictation_desktop_live_prefix_dispatched',
            'dictation_recording_stopped', 'dictation_desktop_stream_flush_completed', 'dictation_stop_to_final_transcript',
            'dictation_stop_to_idle']
# Automatic paste was refused or stopped, the recognizer revised pasted text, or capture fell back to recovery.
FATAL = {'dictation_desktop_paste_unavailable', 'dictation_desktop_stream_failed', 'dictation_desktop_remainder_copied',
         'dictation_desktop_remainder_kept', 'dictation_desktop_snapshot_revised', 'recording_script_processor_connected',
         'dictation_capture_health_interrupted', 'dictation_recovery_retained'}
# The launch cases start VOCO as a launcher or a login autostart would, and never dictate.
LAUNCH = {'launcher': 'popover-opened-by-a-launcher-start', 'autostart': 'stayed-in-the-tray'}
t0 = time.monotonic()

def pump(duration=.05):
    until = time.monotonic() + duration
    context = GLib.MainContext.default()
    while time.monotonic() < until:
        while context.pending():
            context.iteration(False)
        time.sleep(.005)

def traces():
    if not trace_path.exists():
        return []
    records = []
    for line in trace_path.read_text().splitlines():
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            pass # the writer may be appending the final line
    return records

def counts():
    return collections.Counter(x['event'] for x in traces() if isinstance(x, dict) and x.get('event'))

def words(text):
    return re.findall('[a-z]+', (text or '').lower())

def wait_for(predicate, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        if app.poll() is not None:
            raise RuntimeError('VOCO exited before ' + description)
        stopped = sorted(FATAL.intersection(counts()))
        if stopped:
            raise AssertionError('Automatic paste stopped before %s: %s' % (description, ', '.join(stopped)))
        pump(.05)
    raise AssertionError('Timed out waiting for %s; last trace events: %s' % (description, [x.get('event') for x in traces()[-8:]]))

def app_ready():
    # The renderer takes shortcuts and the worker is warm; a failed warm-up fails at once.
    output = (root / 'evidence/full-app.log').read_text()
    assert 'Selected speech model startup failed' not in output, 'Speech model startup failed; see full-app.log'
    return 'Bundled Nemotron streaming model ready' in output and counts()['frontend_hotkey_handler_ready'] > 0

def web_processes():
    # The private PID namespace holds only VOCO's.
    found = []
    for entry in Path('/proc').iterdir():
        try:
            if entry.name.isdigit() and Path(os.readlink(entry / 'exe')).name == 'WebKitWebProcess':
                found.append(int(entry.name))
        except OSError:
            pass # gone, or not ours to read
    return found

def play(description):
    player = subprocess.Popen([os.environ['VOCO_NATIVE_PAPLAY'], '--device=fixture', str(sound)])
    wait_for(lambda: player.poll() is not None, description)
    assert player.returncode == 0, 'paplay failed during ' + description

paste_activity = dict(counts=None, t=t0)
def quiet(seconds):
    """No paste requested, in flight or landing: paste counts and fields unchanged for `seconds`."""
    c = counts()
    now = time.monotonic()
    observed = (c['dictation_desktop_paste_requested'], c['dictation_desktop_paste_dispatched'], c['dictation_desktop_paste_deferred'])
    if observed != paste_activity['counts']:
        paste_activity.update(counts=observed, t=now)
    latest = max([paste_activity['t']] + [m['t'] for m in mutations])
    return observed[0] <= observed[1] + observed[2] and now - latest >= seconds

focus_log = []
def note_focus(moment):
    # Diagnostics only: without a window manager, GTK activity flags may lag X focus.
    focused = subprocess.run(['xdotool', 'getwindowfocus'], capture_output=True, text=True).stdout.strip()
    focus_log.append(dict(t=round(time.monotonic() - t0, 3), moment=moment, xFocus=focused, harnessWindow=window_id,
                          harnessActive=window.is_active(), fieldAFocused=field.has_focus(), fieldBFocused=other.has_focus()))

def app_windows(*flags):
    found = []
    for xid in subprocess.run(['xdotool', 'search', *flags, '--pid', str(app.pid)], capture_output=True, text=True).stdout.split():
        shell = subprocess.run(['xdotool', 'getwindowgeometry', '--shell', xid], capture_output=True, text=True).stdout
        values = dict(line.split('=', 1) for line in shell.splitlines() if '=' in line)
        if {'X', 'Y', 'WIDTH', 'HEIGHT'} <= values.keys():
            found.append(dict(window=xid, x=int(values['X']), y=int(values['Y']), width=int(values['WIDTH']), height=int(values['HEIGHT'])))
    return found

def popover_shown():
    # WebKit capture keeps the hidden window mapped off-screen, where X11 shows it at
    # least 200 px square; the popover is larger, and inside a workarea.
    return any(w['width'] * w['height'] >= 40000 and inside(w) for w in app_windows('--onlyvisible'))

window_history = []
def note_windows():
    """Record each change of VOCO's visible windows, for a launch case's evidence."""
    windows = sorted((w['x'], w['y'], w['width'], w['height']) for w in app_windows('--onlyvisible'))
    if not window_history or window_history[-1]['windows'] != windows:
        window_history.append(dict(t=round(time.monotonic() - t0, 3), windows=windows))
    return False

def check_ready_popover(description):
    """The Ready popover inside its workarea, every control usable, no failure or recovery UI."""
    global popup, popover
    wait_for(popover_shown, description, timeout=10)
    pump(1)
    popup = max(app_windows('--onlyvisible'), key=lambda w: w['width'] * w['height'])
    assert inside(popup), 'The popover extends outside its workarea'
    probe = subprocess.Popen(['/usr/bin/python3', str(Path(__file__).with_name('test-native-recovery-controls.py'))], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    wait_for(lambda: probe.poll() is not None, 'the popover accessibility probe', timeout=30)
    output, errors = probe.communicate()
    assert probe.returncode == 0, errors.strip() or 'The popover accessibility probe failed'
    popover = json.loads(output)
    assert popover['ready'], 'The popover is not Ready after ' + description
    assert not popover['forbidden'], 'The popover presents failure, recovery or Copy UI after %s: %s' % (description, ', '.join(popover['forbidden']))
    for name, anchor in popover['anchors'].items():
        assert anchor['enabled'] and anchor['showing'] and inside(anchor), 'Popover control %s is disabled, hidden or outside its workarea' % name
    screenshot('popover.png')

def inside(bounds):
    return any(bounds['x'] >= m['workarea'][0] and bounds['y'] >= m['workarea'][1]
               and bounds['x'] + bounds['width'] <= m['workarea'][0] + m['workarea'][2]
               and bounds['y'] + bounds['height'] <= m['workarea'][1] + m['workarea'][3] for m in monitors)

def call(name, path, interface, method, values=None):
    return tray_bus.call_sync(name, path, interface, method, values, None, Gio.DBusCallFlags.NONE, 2000, None).unpack()

def tray_menus():
    """Label -> item of the app's exported dbusmenu; an absent 'enabled' property means enabled."""
    items = {}
    for name, item_path in tray_items:
        try:
            menu = call(name, item_path, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', ('org.kde.StatusNotifierItem', 'Menu')))[0]
            pending = [call(name, menu, 'com.canonical.dbusmenu', 'GetLayout', GLib.Variant('(iias)', (0, -1, ['label', 'enabled'])))[1]]
        except GLib.Error as error:
            if str(error) not in diagnostic_errors:
                diagnostic_errors.append(str(error))
            continue
        while pending:
            node_id, props, children = pending.pop()
            if props.get('label'):
                items.setdefault(props['label'], dict(name=name, menu=menu, id=node_id, enabled=props.get('enabled', True)))
            pending.extend(children)
    return items

def tray_click(label):
    item = tray_menus()[label]
    call(item['name'], item['menu'], 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (item['id'], 'clicked', GLib.Variant('s', ''), 0)))

def seccomp_state(proc):
    fields = dict(line.split(':', 1) for line in (proc / 'status').read_text().splitlines() if ':' in line)
    return dict(noNewPrivs=fields['NoNewPrivs'].strip(), seccompFilters=int(fields['Seccomp_filters']))


# The variables the worker reads (worker_sandbox.rs), and the only ones it may get.
WORKER_ENVIRONMENT = {'HOME', 'XDG_STATE_HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NEMO_SPEECH_CPU_THREADS',
                      'VOCO_NEMOTRON_CONTEXT', 'VOCO_NEMOTRON_MODEL', 'VOCO_NEMO_BACKEND', 'VOCO_PERFORMANCE_LOG',
                      'VOCO_SILENCE_GATE'}


def environment_names(proc):
    return sorted(entry.split(b'=', 1)[0].decode() for entry in (proc / 'environ').read_bytes().split(b'\0') if entry)


def worker_confinement():
    # The warm speech worker as the kernel reports it: its interpreter flags,
    # one seccomp filter more than the app that started it, and the variables
    # it started with.
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            argv = (proc / 'cmdline').read_bytes().split(b'\0')
            if any(arg.endswith(b'/stream_worker.py') for arg in argv):
                return dict(flags=[arg.decode() for arg in argv[1:4]], worker=seccomp_state(proc),
                            app=seccomp_state(Path('/proc', str(app.pid))), environment=environment_names(proc))
        except OSError:
            continue
    return None


def screenshot(name):
    Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), 0, 0, 1280, 900).savev(str(root / 'evidence' / name), 'png', [], [])

IBus.init()
bus = IBus.Bus()
assert bus.is_connected() and bus.preload_engines(['voco'])
pump(.3)
assert bus.set_global_engine('voco')
window = Gtk.Window(title='VOCO private full application acceptance')
window.set_default_size(1100, 220)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
window.add(box)
field = Gtk.Entry()
field.set_placeholder_text('A: focused for the first utterance' if case == 'focus-switch' else 'A: focused for the dictation')
field.set_input_hints(Gtk.InputHints.SPELLCHECK)
other = Gtk.Entry()
other.set_placeholder_text('B: focused for the second utterance' if case == 'focus-switch' else 'B: must remain empty')
other.set_input_hints(Gtk.InputHints.WORD_COMPLETION)
box.pack_start(field, False, False, 0)
box.pack_start(other, False, False, 0)
mutations, preedits = [], []
for entry, label in [(field, 'A'), (other, 'B')]:
    entry.connect('changed', lambda widget, label=label: mutations.append(dict(t=time.monotonic(), field=label, text=widget.get_text())))
    entry.connect('preedit-changed', lambda widget, preedit, label=label: preedits.append(dict(t=time.monotonic(), field=label, text=preedit)))
window.show_all()
display = Gdk.Display.get_default()
monitors = []
for index in range(display.get_n_monitors()):
    monitor = display.get_monitor(index)
    rect, work = monitor.get_geometry(), monitor.get_workarea()
    monitors.append(dict(x=rect.x, y=rect.y, width=rect.width, height=rect.height, workarea=[work.x, work.y, work.width, work.height], primary=monitor.is_primary()))
# Supply the standard tray-host discovery service absent from bare Xvfb.
# The app still exports its real menu; no app command or capture API is mocked.
tray_items = []
tray_bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
tray_xml = """<node><interface name="org.kde.StatusNotifierWatcher"><method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method><method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method><property name="RegisteredStatusNotifierItems" type="as" access="read"/><property name="IsStatusNotifierHostRegistered" type="b" access="read"/><property name="ProtocolVersion" type="i" access="read"/></interface></node>"""
def tray_method(connection, sender, path, interface, method, values, invocation):
    if method == 'RegisterStatusNotifierItem':
        service = values.unpack()[0]
        tray_items.append((sender, service) if service.startswith('/') else (service, '/StatusNotifierItem'))
    invocation.return_value(None)
def tray_property(connection, sender, path, interface, name):
    if name == 'RegisteredStatusNotifierItems':
        return GLib.Variant('as', [name + path for name, path in tray_items])
    if name == 'IsStatusNotifierHostRegistered':
        return GLib.Variant('b', True)
    return GLib.Variant('i', 0)
tray_bus.register_object('/StatusNotifierWatcher', Gio.DBusNodeInfo.new_for_xml(tray_xml).interfaces[0], tray_method, tray_property, None)
Gio.bus_own_name_on_connection(tray_bus, 'org.kde.StatusNotifierWatcher', Gio.BusNameOwnerFlags.NONE, None, None)
pump(.1)
log = (root / 'evidence/full-app.log').open('w')
app_env = {**os.environ, 'RUST_LOG': 'info', 'VOCO_HOTKEY_TRACE': '1'}
system_bus = logind = None
if case == 'lock':
    # A private system bus whose only service is a fake logind; the sandbox has no real one.
    socket_path = root / 'runtime/system_bus_socket'
    (root / 'system-bus.conf').write_text(
        '<busconfig><type>session</type><listen>unix:path=%s</listen><auth>EXTERNAL</auth><apparmor mode="disabled"/>'
        '<policy context="default"><allow user="*"/><allow own="*"/><allow send_destination="*" eavesdrop="true"/>'
        '<allow eavesdrop="true"/></policy></busconfig>\n' % socket_path)
    system_bus = subprocess.Popen(['dbus-daemon', '--nofork', '--config-file=%s' % (root / 'system-bus.conf')],
                                  stdout=log, stderr=subprocess.STDOUT)
    for _ in range(100):
        if socket_path.exists():
            break
        time.sleep(.02)
    assert socket_path.exists(), 'The private system bus did not start'
    app_env['DBUS_SYSTEM_BUS_ADDRESS'] = 'unix:path=%s' % socket_path
    # Locked before VOCO starts, with no change signal: only its first read can see it.
    logind = subprocess.Popen(['/usr/bin/python3', str(repo / 'scripts/fixtures/fake-logind.py'), app_env['DBUS_SYSTEM_BUS_ADDRESS'],
                               str(root / 'logind.ready'), '--locked'], stdout=log, stderr=subprocess.STDOUT)
    for _ in range(250):
        if (root / 'logind.ready').exists():
            break
        time.sleep(.02)
    assert (root / 'logind.ready').exists(), 'The fake logind did not start'
app_hash = hashlib.sha256((root / 'voco').read_bytes()).hexdigest()
command = [str(root / 'voco')]
if case in LAUNCH:
    # As GIO launches a desktop entry: it names the entry and the process it started.
    # The shell's own PID becomes VOCO's through exec, so the two match.
    app_env['GIO_LAUNCHED_DESKTOP_FILE'] = '/usr/share/applications/VOCO.desktop'
    command = ['/bin/sh', '-c', 'export GIO_LAUNCHED_DESKTOP_FILE_PID=$$; exec "$0"', str(root / 'voco')]
    if case == 'autostart':
        # A login autostart's mark, which GTK removes from the environment once it starts.
        app_env['DESKTOP_AUTOSTART_ID'] = 'voco-private-autostart'
app = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=app_env)
passed, failure, window_id, before_switch = False, None, None, None
selections, tray_state, popup, popover, diagnostic_errors, confinement = {}, None, None, None, [], None
try:
    assert shutil.which('xclip') and shutil.which('xdotool'), 'X11 paste needs xclip and xdotool on PATH'
    wait_for(lambda: (root / 'runtime/voco.sock').exists(), 'application control socket')
    # The launch cases record VOCO's windows from the start: a launcher start presents early.
    wait_for(lambda: (note_windows() if case in LAUNCH else False) or app_ready(), 'frontend and model readiness', timeout=30)
    if case in LAUNCH:
        requested = [x.get('backend_used') for x in traces() if x.get('event') == 'launcher_activation_requested']
        if case == 'launcher':
            assert requested == ['launch'], 'The launcher start was not taken as a launcher click: %r' % requested
            wait_for(lambda: counts()['launcher_activation_presented'] > 0, 'the launcher start to present VOCO')
            wait_for(lambda: note_windows() or popover_shown(), 'the launcher start to show the popover', timeout=20)
            check_ready_popover('a launcher start')
        else:
            # Well past the frontend's readiness, when a launcher start has already opened.
            for _ in range(30):
                note_windows()
                pump(.1)
            assert not requested and not counts()['launcher_activation_presented'], 'A login autostart was taken as a launcher click'
            assert not popover_shown(), 'A login autostart opened the popover'
            wait_for(lambda: any(label.startswith('VOCO — Ready') for label in tray_menus()), 'the tray to report Ready', timeout=5)
            tray_state = dict(status=[label for label in tray_menus() if label.startswith('VOCO — ')])
        # No idle recording: opening VOCO, or starting it in the tray, never captures.
        c = counts()
        started = {event: c[event] for event in ('recording_state_active', 'recording_worklet_connected',
                                                  'recording_script_processor_connected', 'dictation_desktop_paste_session_started') if c[event]}
        assert not started, 'A launch case started recording: %r' % started
        passed = True
        # Neither launch case dictates; finally still records the evidence and stops VOCO.
        raise SystemExit(0)
    confinement = worker_confinement()
    assert confinement and confinement['flags'] == ['-E', '-s', '-B'] and confinement['worker']['noNewPrivs'] == '1' \
        and confinement['worker']['seccompFilters'] == confinement['app']['seccompFilters'] + 1, 'The speech worker is not confined: %r' % (confinement,)
    # The app has this session's bus, display and runtime directory; the worker gets none of them.
    assert {'DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'XDG_RUNTIME_DIR', 'VOCO_NEMOTRON_MODEL'} <= set(environment_names(Path('/proc', str(app.pid))))
    assert set(confinement['environment']) <= WORKER_ENVIRONMENT and 'VOCO_NEMOTRON_MODEL' in confinement['environment'], \
        'The speech worker got other variables: %r' % sorted(set(confinement['environment']) - WORKER_ENVIRONMENT)
    window.present()
    window_id = subprocess.check_output(['xdotool', 'search', '--name', '^VOCO private full application acceptance$'], text=True).strip().splitlines()[0]
    subprocess.run(['xdotool', 'windowfocus', '--sync', window_id], check=True)
    pump(.2)
    other.grab_focus()
    pump(.5)
    field.grab_focus()
    field.set_position(-1)
    pump(1)
    assert not mutations and field.get_text() == other.get_text() == '', 'A GTK field changed before dictation'
    if case == 'lock':
        def refused_while_locked(attempt):
            started = counts()['recording_state_active']
            subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
            wait_for(lambda: counts()['eval_toggle_suppressed_locked'] >= attempt, 'the shortcut to be refused while locked')
            pump(1)
            assert counts()['recording_state_active'] == started, 'The shortcut started a dictation while the screen was locked'
        # VOCO started locked: its first read of LockedHint must have seen it.
        pump(2)
        refused_while_locked(1)
        logind.send_signal(signal.SIGUSR2)
        pump(.5)
        subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
        wait_for(lambda: counts()['recording_state_active'] > 0, 'capture after unlocking')
        logind.send_signal(signal.SIGUSR1)
        wait_for(lambda: counts()['session_locked_stop'] > 0, 'the lock to stop the dictation')
        wait_for(lambda: counts()['dictation_stop_to_idle'] > 0, 'the stopped dictation to return to idle', timeout=15)
        play('fixture playback while locked')
        pump(1)
        assert field.get_text() == other.get_text() == '', 'Text reached a field while the screen was locked'
        refused_while_locked(2)
        logind.send_signal(signal.SIGUSR2)
        pump(.5)
        mutations.clear()
        # The rest is a delivery case.
    if case == 'web-process':
        subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
        wait_for(lambda: counts()['recording_state_active'] > 0, 'capture before the crash')
        crashed = web_processes()
        assert len(crashed) == 1, 'VOCO should run one web process: %r' % crashed
        # Sent or refused, each notification is traced; the harness runs no notification service.
        notifications = lambda: sum(n for event, n in counts().items() if event.startswith('desktop_notification_'))
        notified = notifications()
        os.kill(crashed[0], signal.SIGABRT)
        wait_for(lambda: counts()['frontend_hotkey_handler_ready'] > 1, 'a new renderer after the crash', timeout=30)
        assert counts()['web_process_reloaded'] == 1, 'VOCO did not load its window again exactly once'
        assert web_processes() and crashed[0] not in web_processes(), 'WebKit started no new web process'
        wait_for(lambda: any(label.startswith('VOCO — Ready') for label in tray_menus()), 'the tray to report Ready after the crash', timeout=15)
        wait_for(lambda: notifications() > notified, 'VOCO to say the dictation was interrupted', timeout=5)
        assert notifications() == notified + 1, 'VOCO sent more than one notification for the crash'
        assert field.get_text() == other.get_text() == '', 'Text reached a field from the crashed dictation'
        mutations.clear()
        # The rest is a delivery case.
    note_focus('before-start')
    # The lock case already ran one recording: wait for this one's events.
    before = counts()
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
    wait_for(lambda: counts()['recording_state_active'] > before['recording_state_active'], 'actual capture')
    note_focus('recording')
    pulse_outputs = subprocess.check_output([os.environ['VOCO_NATIVE_PACTL'], 'list', 'source-outputs'], text=True)
    observable_fields = ('Source Output #', 'Driver:', 'Source:', 'Sample Specification:', 'Corked:', 'Mute:', 'application.name =', 'application.process.binary =')
    (root / 'evidence/pulse-source-outputs.txt').write_text('\n'.join(line for line in pulse_outputs.splitlines() if line.strip().startswith(observable_fields)) + '\n')
    pump(.5)
    play('fixture playback')
    if case == 'focus-switch':
        # Streaming pastes A's text before Stop. Switch only after it settles, with no
        # paste requested, in flight or landing, so each chunk has one recipient; the
        # second utterance cannot be recognized before the switch, so B must get text.
        wait_for(lambda: quiet(.5) and bool(field.get_text()), 'streamed text to settle in field A', timeout=15)
        before_switch = field.get_text()
        mutations.append(dict(t=time.monotonic(), field='switch', text=None))
        other.grab_focus()
        other.set_position(-1)
        note_focus('after-switch')
        pump(.3)
        play('second fixture playback after the focus switch')
    pump(.6)
    note_focus('before-stop')
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+d'], check=True)
    wait_for(lambda: counts()['dictation_stop_to_idle'] > before['dictation_stop_to_idle'], 'successful recording returned to idle', timeout=35)
    wait_for(lambda: quiet(.5), 'the last paste to land', timeout=5)
    note_focus('delivered')
    screenshot('delivered.png')
    c = counts()
    text, other_text = field.get_text(), other.get_text()
    missing = [event for event in REQUIRED if not c[event]]
    assert not missing, 'Paste session trace lacks ' + ', '.join(missing)
    assert not FATAL.intersection(c), 'Automatic paste stopped: ' + ', '.join(sorted(FATAL.intersection(c)))
    assert not any(p['text'] for p in preedits), 'A GTK field showed IBus preedit text'
    changes = [m for m in mutations if m['field'] in ('A', 'B')]
    for label in ('A', 'B'):
        history = [''] + [m['text'] for m in changes if m['field'] == label]
        assert all(after.startswith(before) and len(after) > len(before) for before, after in zip(history, history[1:])), 'Field %s changed other than by appended paste' % label
    # xdotool sends one Shift+Insert per dispatched chunk, joining space included.
    assert len(changes) <= c['dictation_desktop_paste_dispatched'], 'Fields changed more often than VOCO dispatched pastes'
    if case in ('delivery', 'lock', 'web-process'):
        assert other_text == '' and not any(m['field'] == 'B' for m in changes), 'Unfocused field B received text'
        assert words(text) == expected, 'Focused field A did not receive the dictation exactly once: %r' % text
    elif case == 'spelling':
        assert other_text == '' and not any(m['field'] == 'B' for m in changes), 'Unfocused field B received text'
        assert 'honour' in words(text) and 'honor' not in words(text), 'British spelling did not reach field A: %r' % text
        assert len(words(text)) >= 20, 'Field A did not receive the whole fixture: %r' % text
    else:
        switch = next(index for index, m in enumerate(mutations) if m['field'] == 'switch')
        assert text == before_switch and all(index < switch for index, m in enumerate(mutations) if m['field'] == 'A'), 'Field A changed after focus moved to B'
        assert all(index > switch for index, m in enumerate(mutations) if m['field'] == 'B'), 'Field B changed before it had focus'
        assert other_text, 'Nothing was pasted into B after focus moved to it'
        # Concatenate unseparated: a chunk boundary may fall inside a word.
        assert words(text + other_text) == expected, 'Fields A+B did not receive both utterances exactly once: %r + %r' % (text, other_text)
    last = changes[-1]
    history = [''] + [m['text'] for m in changes if m['field'] == last['field']]
    selections = dict(lastPaste=last['text'][len(history[-2]):], clipboard=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(),
                      primary=Gtk.Clipboard.get(Gdk.SELECTION_PRIMARY).wait_for_text())
    assert selections['clipboard'] == selections['lastPaste'], 'CLIPBOARD does not hold the last pasted chunk'
    assert selections['primary'] == selections['lastPaste'], 'PRIMARY does not hold the last pasted chunk'
    # Success leaves nothing to copy or review: the tray and popover return to Ready.
    wait_for(lambda: any(label.startswith('VOCO — Ready') for label in tray_menus()), 'the tray to report Ready', timeout=5)
    menus = tray_menus()
    tray_state = dict(status=[label for label in menus if label.startswith('VOCO — ')], openEnabled=menus.get('Open VOCO', {}).get('enabled'))
    assert tray_state['openEnabled'], 'The tray has no enabled Open VOCO item after dictation'
    tray_click('Open VOCO')
    check_ready_popover('a pasted dictation')
    passed = True
except Exception as error:
    failure = '%s: %s' % (type(error).__name__, error)
    raise
finally:
    # Show the app's state in the final screenshot when the gate stopped earlier.
    try:
        # An autostart that stayed in the tray already shows its true state.
        if case != 'autostart' and popover is None and app.poll() is None and not popover_shown() \
                and tray_menus().get('Open VOCO', {}).get('enabled'):
            tray_click('Open VOCO')
            pump(1)
    except Exception as error:
        diagnostic_errors.append('tray: %s' % error)
    for name, evidence in [('private-bus-names.json', lambda: call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames')[0]),
                           ('window-geometry.json', lambda: dict(monitors=monitors, hasPrimaryMonitor=display.get_primary_monitor() is not None, windows=app_windows()))]:
        try:
            (root / 'evidence' / name).write_text(json.dumps(evidence(), indent=2) + '\n')
        except Exception as error:
            diagnostic_errors.append('%s: %s' % (name, error))
    c = counts()
    capture = 'webkit-audio-worklet' if c['recording_worklet_connected'] else 'webkit-script-processor' if c['recording_script_processor_connected'] else 'native' if c['recording_state_active'] else None
    if case in LAUNCH:
        boundary = ["the release binary started with GIO's launch variables for VOCO.desktop"
                    + (' and DESKTOP_AUTOSTART_ID' if case == 'autostart' else ''), 'the real renderer and its launch check',
                    'the Ready popover through AT-SPI' if case == 'launcher' else 'the tray menu through a private StatusNotifierWatcher',
                    'no dictation', 'private X11 without a window manager']
    else:
        boundary = [{'webkit-audio-worklet': 'real WebKit capture', 'native': 'real native capture'}.get(capture, 'capture not established'),
                    'private PulseAudio fixture', 'Tauri binary IPC', 'pinned Nemotron in a seccomp-filtered worker', 'xclip CLIPBOARD+PRIMARY',
                    'xdotool Shift+Insert into the focused GTK entry', 'no IBus text mutation', 'private X11 without a window manager']
        if case == 'web-process':
            boundary.insert(1, 'a WebKit web process aborted mid-dictation and loaded again')
    report = dict(passed=passed, failure=failure, expectedOutcome=LAUNCH.get(case, 'pasted-into-focused-field'), case=case,
                  buildRole=os.environ.get('VOCO_NATIVE_BUILD_ROLE', 'preflight'),
                  callbackTraceInstrumented=os.environ.get('VOCO_NATIVE_TRACE') == '1', expectedWords=[] if case in LAUNCH else expected,
                  text=field.get_text(), otherText=other.get_text(), textBeforeSwitch=before_switch,
                  mutations=[dict(m, t=round(m['t'] - t0, 3)) for m in mutations], preedits=[dict(p, t=round(p['t'] - t0, 3)) for p in preedits],
                  selections=selections, traceCounts=dict(sorted(c.items())), captureRoute=capture, focus=focus_log, harnessWindow=window_id,
                  tray=tray_state, popoverWindow=popup, popover=popover, helpers={name: bool(shutil.which(name)) for name in ['xclip', 'xdotool']},
                  diagnosticErrors=diagnostic_errors, workerConfinement=confinement, windowHistory=window_history,
                  engineSourceHashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('voco_ibus_*.py')},
                  fixtureSha256=None if case in LAUNCH else hashlib.sha256(sound.read_bytes()).hexdigest(),
                  appSha256=app_hash,
                  modelSha256=hashlib.sha256(model.read_bytes()).hexdigest(),
                  boundary=' / '.join(boundary))
    (root / 'evidence/full-app.json').write_text(json.dumps(report, indent=2) + '\n')
    if trace_path.exists():
        shutil.copyfile(trace_path, root / 'evidence/full-app-trace.jsonl')
    try:
        screenshot('full-app.png')
    except Exception as error:
        print('Final screenshot failed: %s' % error)
    app.terminate()
    try:
        app.wait(timeout=5)
    except subprocess.TimeoutExpired:
        app.kill()
        app.wait()
    for helper in (logind, system_bus):
        if helper is not None:
            helper.terminate()
            helper.wait(timeout=5)
    performance = root / 'state/voco/performance'
    if performance.exists():
        shutil.copytree(performance, root / 'evidence/performance', dirs_exist_ok=True)
    log.close()
    print(json.dumps(report, indent=2))

assert passed, 'Native application paste acceptance failed; inspect the retained evidence'
