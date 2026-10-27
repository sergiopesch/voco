#!/usr/bin/env python3
"""What strict confinement lets a snap do on the session bus, measured.

Test only, on a disposable runner with snapd, after the probe snap in
scripts/fixtures/snap-dbus-probe is installed. A private session bus that
requires AppArmor mediation stands in for the desktop's. This process plays
GNOME Shell, unconfined: it keeps a NextRequest call pending on the probe,
which owns org.voco.Panel through a dbus slot, and reports back with
PasteDone, as the companion would. The probe then calls this process and
emits a signal, which snapd's slot rules should refuse. Prints a JSON report
and fails unless the pull direction works and the push direction doesn't."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

CALLER = """<node><interface name="org.voco.ProbeCaller1"><method name="Ping"/></interface></node>"""
runtime = Path(f'/run/user/{os.getuid()}')
assert runtime.is_dir(), 'The runner needs its user runtime directory'
folder = Path(tempfile.mkdtemp(prefix='voco-snap-probe-'))
socket = runtime / 'bus'
assert not socket.exists(), 'Run only where no session bus is listening'
config = folder / 'session.conf'
# AppArmor mediation required, as Ubuntu's session bus has it; everything else open.
config.write_text(f"""<busconfig><type>session</type><listen>unix:path={socket}</listen>
<auth>EXTERNAL</auth><apparmor mode="required"/>
<policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>""")
daemon = subprocess.Popen(['dbus-daemon', '--nofork', f'--config-file={config}'],
                          stdout=subprocess.DEVNULL, stderr=(folder / 'dbus.log').open('w'))
probe = None
report = {}
try:
    for _ in range(200):
        if socket.exists():
            break
        time.sleep(.02)
    address = f'unix:path={socket}'
    env = {**os.environ, 'DBUS_SESSION_BUS_ADDRESS': address, 'XDG_RUNTIME_DIR': str(runtime)}
    bus = Gio.DBusConnection.new_for_address_sync(
        address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
    pings = []
    signals = []
    node = Gio.DBusNodeInfo.new_for_xml(CALLER)
    bus.register_object('/org/voco/ProbeCaller', node.interfaces[0],
                        lambda *args: (pings.append(args[1]), args[-1].return_value(None)), None, None)
    bus.signal_subscribe(None, 'org.voco.Panel1', 'Changed', '/org/voco/Panel', None,
                         Gio.DBusSignalFlags.NONE, lambda *args: signals.append(args[1]))
    probe = subprocess.Popen(['snap', 'run', 'voco-dbus-probe.probe'], env=env, stdout=subprocess.PIPE,
                             stderr=(folder / 'probe.log').open('w'), text=True)
    lines = []
    # A thread reads the probe, so the main loop keeps answering the bus.
    threading.Thread(target=lambda: lines.extend(line.strip() for line in probe.stdout), daemon=True).start()
    context = GLib.MainContext.default()

    def pump(seconds):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            context.iteration(False)
            time.sleep(.005)

    def wait_line(predicate, seconds):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            found = next((line for line in lines if predicate(line)), None)
            if found is not None:
                return found
            pump(.02)
        return None

    assert wait_line(lambda line: line == 'ready', 20), 'The probe never owned org.voco.Panel'

    started = time.monotonic()
    reply = {}
    bus.call('org.voco.Panel', '/org/voco/Panel', 'org.voco.Panel1', 'NextRequest', None,
             GLib.VariantType('(su)'), Gio.DBusCallFlags.NO_AUTO_START, 5000, None,
             lambda connection, task: reply.update(value=connection.call_finish(task).unpack(),
                                                   after_ms=round((time.monotonic() - started) * 1000)))
    while 'value' not in reply and time.monotonic() - started < 5:
        pump(.01)
    report['nextRequest'] = reply
    bus.call_sync('org.voco.Panel', '/org/voco/Panel', 'org.voco.Panel1', 'PasteDone',
                  GLib.Variant('(ut)', (7, 12345)), None, Gio.DBusCallFlags.NO_AUTO_START, 2000, None)
    line = wait_line(lambda line: line.startswith('{'), 10)
    report['probe'] = json.loads(line) if line else None
    pump(.5)
    report['callerPinged'] = bool(pings)
    report['signalReceived'] = bool(signals)
finally:
    if probe and probe.poll() is None:
        probe.terminate()
    daemon.terminate()
    daemon.wait()
    report['probeLog'] = (folder / 'probe.log').read_text()[-2000:] if (folder / 'probe.log').exists() else ''
    report['busLog'] = (folder / 'dbus.log').read_text()[-2000:]
print(json.dumps(report, indent=1))
seen = report.get('probe') or {}
failures = []
if report.get('nextRequest', {}).get('value') != ('paste', 7):
    failures.append('the snap could not answer a pending call')
if seen.get('pasteDone') != [7, 12345]:
    failures.append('a call from the unconfined side never reached the snap')
if report.get('callerPinged') or seen.get('callToCaller') == 'allowed':
    failures.append('the snap reached an unconfined peer, so mediation is off or the policy changed')
sys.exit('; '.join(failures) if failures else 0)
