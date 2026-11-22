#!/usr/bin/python3.12
"""Synthetic test window: one GTK text widget, focused. Not a real app.

usage: gtk_field.py {3|4} {entry|textview} [title]
"""
import sys

import gi

major, widget = sys.argv[1], sys.argv[2]
title = sys.argv[3] if len(sys.argv) > 3 else f"synthetic-gtk{major}-{widget}"
gi.require_version("Gtk", "4.0" if major == "4" else "3.0")
from gi.repository import GLib, Gtk  # noqa: E402


def make_field():
    if widget == "entry":
        return Gtk.Entry()
    view = Gtk.TextView()
    view.set_wrap_mode(Gtk.WrapMode.NONE)
    return view


if major == "4":
    loop = GLib.MainLoop()
    window = Gtk.Window(title=title)
    window.set_default_size(900, 200)
    field = make_field()
    window.set_child(field)
    window.connect("close-request", lambda *_: loop.quit())
    window.present()
    field.grab_focus()
    loop.run()
else:
    window = Gtk.Window(title=title)
    window.set_default_size(900, 200)
    field = make_field()
    window.add(field)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    field.grab_focus()
    Gtk.main()
