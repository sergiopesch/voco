#!/usr/bin/python3
"""TEST ONLY: a minimal org.freedesktop.login1 on a private system bus.

  fake-logind.py BUS_ADDRESS READY_FILE

It serves one local graphical X11 session of this user on seat0, as VOCO's
binding expects, and writes READY_FILE once it owns the name. SIGUSR1 locks the
screen and SIGUSR2 unlocks it: each sets LockedHint and emits PropertiesChanged,
as logind does. It answers only what VOCO asks.
"""
import os
from pathlib import Path
import signal
import sys

from gi.repository import Gio, GLib

address, ready = sys.argv[1], Path(sys.argv[2])
UID = os.getuid()
MANAGER = '/org/freedesktop/login1'
SESSION = '/org/freedesktop/login1/session/_31'
USER = f'/org/freedesktop/login1/user/_{UID}'
SEAT = '/org/freedesktop/login1/seat/seat0'
NODE = Gio.DBusNodeInfo.new_for_xml('''<node>
  <interface name="org.freedesktop.login1.Manager">
    <method name="GetSessionByPID"><arg type="u" direction="in"/><arg type="o" direction="out"/></method>
    <method name="GetSession"><arg type="s" direction="in"/><arg type="o" direction="out"/></method>
    <method name="GetUser"><arg type="u" direction="in"/><arg type="o" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.login1.Session">
    <property name="Id" type="s" access="read"/>
    <property name="User" type="(uo)" access="read"/>
    <property name="Type" type="s" access="read"/>
    <property name="Class" type="s" access="read"/>
    <property name="Remote" type="b" access="read"/>
    <property name="Seat" type="(so)" access="read"/>
    <property name="Active" type="b" access="read"/>
    <property name="LockedHint" type="b" access="read"/>
  </interface>
  <interface name="org.freedesktop.login1.User">
    <property name="Sessions" type="a(so)" access="read"/>
  </interface>
</node>''')
state = {'locked': False}


def manager_call(connection, sender, path, interface, method, parameters, invocation):
    if method == 'GetUser' and parameters.unpack()[0] != UID:
        invocation.return_dbus_error('org.freedesktop.login1.NoSuchUser', 'No such user')
        return
    invocation.return_value(GLib.Variant('(o)', (USER if method == 'GetUser' else SESSION,)))


def session_property(connection, sender, path, interface, name):
    return {
        'Id': GLib.Variant('s', '31'),
        'User': GLib.Variant('(uo)', (UID, USER)),
        'Type': GLib.Variant('s', 'x11'),
        'Class': GLib.Variant('s', 'user'),
        'Remote': GLib.Variant('b', False),
        'Seat': GLib.Variant('(so)', ('seat0', SEAT)),
        'Active': GLib.Variant('b', True),
        'LockedHint': GLib.Variant('b', state['locked']),
    }[name]


def user_property(connection, sender, path, interface, name):
    return GLib.Variant('a(so)', [('31', SESSION)])


bus = Gio.DBusConnection.new_for_address_sync(
    address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
interfaces = {interface.name: interface for interface in NODE.interfaces}
bus.register_object(MANAGER, interfaces['org.freedesktop.login1.Manager'], manager_call, None, None)
bus.register_object(SESSION, interfaces['org.freedesktop.login1.Session'], None, session_property, None)
bus.register_object(USER, interfaces['org.freedesktop.login1.User'], None, user_property, None)


def set_locked(locked):
    state['locked'] = locked
    bus.emit_signal(None, SESSION, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                    GLib.Variant('(sa{sv}as)', ('org.freedesktop.login1.Session', {'LockedHint': GLib.Variant('b', locked)}, [])))
    return GLib.SOURCE_CONTINUE


loop = GLib.MainLoop()
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, set_locked, True)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR2, set_locked, False)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: loop.quit() or GLib.SOURCE_REMOVE)
Gio.bus_own_name_on_connection(bus, 'org.freedesktop.login1', Gio.BusNameOwnerFlags.NONE,
                               lambda *_: ready.write_text('ready\n'), lambda *_: loop.quit())
loop.run()
