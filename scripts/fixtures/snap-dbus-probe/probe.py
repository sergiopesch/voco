"""Test only: the confined side of scripts/test-snap-dbus-probe.py.

Owns org.voco.Panel, as a confined VOCO would, and holds the unconfined
caller's NextRequest call until it answers it. Then it tries what snapd's
dbus slot may forbid: calling the caller, and emitting a signal. Prints one
JSON line with what happened."""
import json
import sys

from gi.repository import Gio, GLib

XML = """<node><interface name="org.voco.Panel1">
<method name="NextRequest"><arg type="s" direction="out"/><arg type="u" direction="out"/></method>
<method name="PasteDone"><arg type="u" direction="in"/><arg type="t" direction="in"/></method>
<signal name="Changed"/>
</interface></node>"""
result = {'owned': False, 'answered': False, 'pasteDone': None, 'callToCaller': None, 'signalSent': None}
loop = GLib.MainLoop()


def finish():
    print(json.dumps(result), flush=True)
    loop.quit()


def try_reverse(bus, caller):
    def done(connection, task):
        try:
            connection.call_finish(task)
            result['callToCaller'] = 'allowed'
        except GLib.Error as error:
            result['callToCaller'] = Gio.dbus_error_get_remote_error(error) or error.message
        try:
            bus.emit_signal(None, '/org/voco/Panel', 'org.voco.Panel1', 'Changed', None)
            result['signalSent'] = True
        except GLib.Error as error:
            result['signalSent'] = error.message
        GLib.timeout_add(500, finish)
    bus.call(caller, '/org/voco/ProbeCaller', 'org.voco.ProbeCaller1', 'Ping', None, None,
             Gio.DBusCallFlags.NONE, 2000, None, done)


def on_call(bus, sender, path, interface, method, params, invocation):
    if method == 'NextRequest':
        # Held, as VOCO holds it until it needs the companion.
        def answer():
            invocation.return_value(GLib.Variant('(su)', ('paste', 7)))
            result['answered'] = True
            return GLib.SOURCE_REMOVE
        GLib.timeout_add(300, answer)
    elif method == 'PasteDone':
        request, insert_us = params.unpack()
        result['pasteDone'] = [request, insert_us]
        invocation.return_value(None)
        try_reverse(bus, sender)


def on_bus(bus, _name):
    node = Gio.DBusNodeInfo.new_for_xml(XML)
    bus.register_object('/org/voco/Panel', node.interfaces[0], on_call, None, None)


def on_name(_bus, _name):
    result['owned'] = True
    print('ready', flush=True)


Gio.bus_own_name(Gio.BusType.SESSION, 'org.voco.Panel', Gio.BusNameOwnerFlags.NONE,
                 on_bus, on_name, lambda *_: (result.update(owned=False), finish()))
GLib.timeout_add_seconds(30, finish)
loop.run()
sys.exit(0)
