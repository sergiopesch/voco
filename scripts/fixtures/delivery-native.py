"""Synthetic toolkit fields for the private application-delivery suite.

Each stdin word is a command: 'entry' or 'document' focuses that field, and
'read' does nothing. Every command answers with one JSON line holding the
keyboard-focused field and both values.
"""
import json
import os
import sys
import gi

kind = sys.argv[1]
version = '4.0' if kind == 'gtk4' else '3.0'
gi.require_version('Gtk', version)
from gi.repository import Gtk, Gio, GLib
focus = {}
read = None


def reply(fields):
    print(json.dumps(fields), flush=True)


def widgets(window):
    global read
    if kind == 'webkit':
        gi.require_version('WebKit2', '4.1')
        from gi.repository import WebKit2
        view = WebKit2.WebView()
        window.add(view)
        view.load_html('<html><body><input id="entry"><textarea id="document"></textarea></body></html>', None)
        def run(script, answered=None):
            view.evaluate_javascript(script, -1, None, None, None, answered, None)
        def focus_field(name):
            view.grab_focus()
            run(f'document.getElementById("{name}").focus()')
        for name in ('entry', 'document'):
            focus[name] = lambda name=name: focus_field(name)
        def answered(_, result, __):
            try:
                reply(json.loads(view.evaluate_javascript_finish(result).to_string()))
            except GLib.Error:
                reply({})  # The page is still loading.
        # Each evaluation shares the page's global scope, so declare nothing there.
        read = lambda: run('''(() => {
            const value = id => document.getElementById(id).value;
            return JSON.stringify({focus: document.hasFocus() ? document.activeElement.id || null : null,
                                   entry: value("entry"), document: value("document")});
        })()''', answered)
        view.connect('load-changed', lambda _, state: focus_field('entry') if state == WebKit2.LoadEvent.FINISHED else None)
        return
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
    entry = Gtk.Entry()
    document = Gtk.TextView()
    document.set_size_request(500, 200)
    if version == '4.0':
        window.set_child(box)
        box.append(entry)
        box.append(document)
    else:
        window.add(box)
        box.pack_start(entry, False, False, 0)
        box.pack_start(document, True, True, 0)
    fields = {'entry': entry, 'document': document}
    focus.update(entry=entry.grab_focus, document=document.grab_focus)
    def focused():
        # A GTK4 entry focuses its internal text child.
        widget = window.get_focus() if window.is_active() else None
        return next((name for name, field in fields.items()
                     if widget is not None and (widget == field or widget.is_ancestor(field))), None)
    def document_text():
        buffer = document.get_buffer()
        return buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True)
    read = lambda: reply({'focus': focused(), 'entry': entry.get_text(), 'document': document_text()})
    entry.grab_focus()


def command(_, condition):
    data = os.read(0, 4096)
    if not data:
        return False
    for name in data.decode().split():
        focus.get(name, lambda: None)()
        read()
    return True
GLib.io_add_watch(0, GLib.IO_IN | GLib.IO_HUP, command)

if version == '4.0':
    app = Gtk.Application(application_id='org.voco.DeliveryGtk4', flags=Gio.ApplicationFlags.NON_UNIQUE)
    def activate(app):
        window = Gtk.ApplicationWindow(application=app, title='VOCO-gtk4-fixture')
        window.set_default_size(700, 500)
        widgets(window)
        window.present()
    app.connect('activate', activate)
    app.run([])
else:
    window = Gtk.Window(title='VOCO-' + kind + '-fixture')
    window.set_default_size(700, 500)
    window.connect('destroy', Gtk.main_quit)
    widgets(window)
    window.show_all()
    window.present()
    Gtk.main()
