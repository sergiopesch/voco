#!/usr/bin/python3
"""A disposable GTK 3 field for the companion suite's Paste checks.

One focused entry, on Wayland or, with GDK_BACKEND=x11, under XWayland. Each
line on stdout is JSON with CLOCK_MONOTONIC seconds: every Insert press the
entry receives, every change of its text, and the replies below. It reads one
command per line on stdin: `copy TEXT` puts TEXT on its own CLIPBOARD, which
Shift+Insert pastes, and `clear` empties the entry. Synthetic text only."""
import json
import sys
import time
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gdk, GLib, Gtk


def say(**record):
    print(json.dumps({'t': time.monotonic(), **record}), flush=True)


window = Gtk.Window(title='VOCO paste fixture')
entry = Gtk.Entry()
window.add(entry)
window.set_default_size(600, 80)
clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)


def on_key(_widget, event):
    if event.keyval == Gdk.KEY_Insert:
        say(what='insert', shift=bool(event.state & Gdk.ModifierType.SHIFT_MASK))
    return False


entry.connect('key-press-event', on_key)
entry.connect('changed', lambda field: say(what='text', text=field.get_text()))


def on_command(channel, _condition):
    line = channel.readline()
    if not line:
        Gtk.main_quit()
        return GLib.SOURCE_REMOVE
    command, _, argument = line.rstrip('\n').partition(' ')
    if command == 'copy':
        clipboard.set_text(argument, -1)
        say(what='copied', text=argument)
    elif command == 'clear':
        entry.set_text('')
        say(what='cleared')
    return GLib.SOURCE_CONTINUE


GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.PRIORITY_DEFAULT, GLib.IOCondition.IN, on_command)
window.connect('destroy', Gtk.main_quit)
window.show_all()
entry.grab_focus()
window.present()
say(what='ready', backend=type(Gdk.Display.get_default()).__name__)
Gtk.main()
