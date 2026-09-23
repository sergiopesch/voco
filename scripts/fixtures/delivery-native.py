"""Synthetic toolkit controls for the isolated clipboard-delivery matrix."""
import sys
import gi

kind=sys.argv[1]
version='4.0' if kind=='gtk4' else '3.0'
gi.require_version('Gtk',version)
from gi.repository import Gtk, Gio, GLib
focus_actions={}

def widgets(window):
    if kind=='webkit':
        gi.require_version('WebKit2','4.1')
        from gi.repository import WebKit2
        view=WebKit2.WebView()
        window.add(view)
        view.load_html('<html><body><input autofocus aria-label="Entry"><textarea aria-label="Document"></textarea><input type="password" aria-label="Protected"></body></html>',None)
        def focus(selector):
            view.grab_focus()
            view.evaluate_javascript('document.querySelector('+repr(selector)+').focus()',-1,None,None,None,None,None)
        for name,selector in [('entry','input'),('document','textarea'),('protected','input[type=password]')]:
            focus_actions[name]=lambda selector=selector:focus(selector)
        view.connect('load-changed',lambda _,state:focus('input') if state==WebKit2.LoadEvent.FINISHED else None)
        view.grab_focus()
        return
    box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=12)
    if version=='4.0':window.set_child(box)
    else:window.add(box)
    entry=Gtk.Entry()
    document=Gtk.TextView();document.set_accepts_tab(False);document.set_size_request(500,200)
    protected=Gtk.PasswordEntry() if version=='4.0' else Gtk.Entry()
    if version=='3.0':protected.set_visibility(False)
    focus_actions.update(entry=entry.grab_focus,document=document.grab_focus,protected=protected.grab_focus)
    for widget in [entry,document,protected]:
        if version=='4.0':box.append(widget)
        else:box.pack_start(widget,True,True,0)
    entry.grab_focus()

def command(_,condition):
    line=sys.stdin.readline()
    if not line:return False
    action=focus_actions.get(line.strip())
    if action:
        action()
    return True
GLib.io_add_watch(sys.stdin,GLib.IO_IN,command)

if version=='4.0':
    app=Gtk.Application(application_id='org.voco.DeliveryGtk4',flags=Gio.ApplicationFlags.NON_UNIQUE)
    def activate(app):
        window=Gtk.ApplicationWindow(application=app,title='VOCO-gtk4-fixture')
        window.set_default_size(700,500)
        widgets(window);window.present()
    app.connect('activate',activate)
    app.run([])
else:
    window=Gtk.Window(title='VOCO-'+kind+'-fixture')
    window.set_default_size(700,500)
    window.connect('destroy',Gtk.main_quit)
    widgets(window);window.show_all();window.present()
    Gtk.main()
