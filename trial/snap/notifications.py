#!/usr/bin/python3
"""Trial only: a desktop notification server on the session bus that shows
nothing and writes each notification's summary and body as one JSON line.

Usage: notifications.py LOG.jsonl
"""
import json
import sys

from gi.repository import Gio, GLib

INTERFACE = """<node><interface name="org.freedesktop.Notifications">
  <method name="Notify">
    <arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/>
    <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="as" direction="in"/>
    <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="out"/>
  </method>
  <method name="GetCapabilities"><arg type="as" direction="out"/></method>
  <method name="GetServerInformation">
    <arg type="s" direction="out"/><arg type="s" direction="out"/>
    <arg type="s" direction="out"/><arg type="s" direction="out"/>
  </method>
  <method name="CloseNotification"><arg type="u" direction="in"/></method>
</interface></node>"""

log = open(sys.argv[1], "a", encoding="utf-8")
shown = 0


def call(_connection, sender, _path, _interface, method, parameters, invocation):
    global shown
    if method == "Notify":
        app, _replaces, _icon, summary, body, _actions, _hints, _timeout = parameters.unpack()
        shown += 1
        log.write(json.dumps({"sender": sender, "app": app, "summary": summary, "body": body}) + "\n")
        log.flush()
        invocation.return_value(GLib.Variant("(u)", (shown,)))
    elif method == "GetCapabilities":
        invocation.return_value(GLib.Variant("(as)", (["body"],)))
    elif method == "GetServerInformation":
        invocation.return_value(GLib.Variant("(ssss)", ("voco-trial", "VOCO", "1", "1.2")))
    else:
        invocation.return_value(None)


def connected(connection, _name):
    # Registered before the name is ours, so no call finds the name without it.
    node = Gio.DBusNodeInfo.new_for_xml(INTERFACE)
    connection.register_object("/org/freedesktop/Notifications", node.interfaces[0], call, None, None)


loop = GLib.MainLoop()
lost = []
Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.Notifications", Gio.BusNameOwnerFlags.NONE,
                 connected, None, lambda *_: (lost.append(True), loop.quit()))
loop.run()
sys.exit("Another notification server owns org.freedesktop.Notifications" if lost else 0)
