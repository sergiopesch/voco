#!/usr/bin/python3.12
"""Field-access measurement: can AT-SPI2 find, read, verify and correct the
text VOCO just pasted into the focused field?

Run through run.sh, which provides the isolated X11 + D-Bus + AT-SPI session:

    ./run.sh <case> <scenario> [--config NAME] [--out FILE]

One run = one app/field, one scenario, one fresh session, one JSON file.
Only the synthetic sentence below is ever pasted.
"""
import argparse
import json
import os
import re
import signal
import statistics
import subprocess
import sys
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, Gio, GLib  # noqa: E402

HERE = os.environ.get("FIELD_ACCESS_HERE", os.path.dirname(os.path.abspath(__file__)))
RUN = os.environ.get("FIELD_ACCESS_RUN", "/nonexistent")

# The only text used.
CHUNKS = ["Let's meet at the ", "peer on Thursday", " afternoon."]
EXPECTED = "".join(CHUNKS)  # Let's meet at the peer on Thursday afternoon.
WRONG, RIGHT = "peer", "pier"
OLD_TAIL = "peer on Thursday afternoon."  # 27 characters
NEW_TAIL = "pier on Thursday afternoon."
FINAL = "Let's meet at the " + NEW_TAIL
BACKSPACES = len(OLD_TAIL)
assert BACKSPACES == 27 and EXPECTED.endswith(OLD_TAIL)

# Playwright's Chromium. Here /opt/pw-browsers/chromium is a link to a wrapper
# script that passes a launch without --headless on unchanged.
CHROME = None
if os.path.isfile("/opt/pw-browsers/chromium"):
    CHROME = os.path.realpath("/opt/pw-browsers/chromium")
else:
    for root, _dirs, files in os.walk("/opt/pw-browsers/chromium", followlinks=True):
        if "chrome" in files:
            CHROME = os.path.join(root, "chrome")
            break

RCFILE = os.path.join(HERE, "terminal.bashrc")
DUMP = os.path.join(RUN, "readline.dump")
FIELDS = "file://" + os.path.join(HERE, "fields.html")


def chrome_cmd(field):
    return [
        CHROME or "chrome-not-found",
        "--no-sandbox",  # root in a container
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--user-data-dir=" + os.path.join(RUN, "chrome-profile"),
        "--window-size=1100,700",
        f"{FIELDS}#{field}",
    ]


# click: (x, y) in pixels from the window's top-left corner, or fractions of
# its size when both are < 1.  None = the app focuses its field by itself.
# Epiphany gives the page no keyboard focus at load, so its fields are
# clicked at their place in fields.html's fixed layout.
CASES = {
    "gnome-text-editor": dict(
        label="gnome-text-editor 46 (GTK4 GtkSourceView)", kind="gui",
        cmd=["gnome-text-editor", "--standalone", "--ignore-session"],
        wclass="gnome-text-editor|org.gnome.TextEditor", click=(0.5, 0.6)),
    "gedit": dict(
        label="gedit 46 (GTK3 GtkSourceView)", kind="gui",
        cmd=["gedit", "--standalone"], wclass="gedit", click=(0.5, 0.6)),
    "mousepad": dict(
        label="mousepad 0.6 (GTK3 GtkSourceView)", kind="gui",
        cmd=["mousepad", "--disable-server"], wclass="mousepad", click=(0.5, 0.6)),
    "gtk4-entry": dict(
        label="synthetic GTK4 Gtk.Entry", kind="gui",
        cmd=["/usr/bin/python3.12", os.path.join(HERE, "gtk_field.py"), "4", "entry"],
        wclass="synthetic-gtk", click=None),
    "gtk4-textview": dict(
        label="synthetic GTK4 Gtk.TextView", kind="gui",
        cmd=["/usr/bin/python3.12", os.path.join(HERE, "gtk_field.py"), "4", "textview"],
        wclass="synthetic-gtk", click=None),
    "gtk3-entry": dict(
        label="synthetic GTK3 Gtk.Entry", kind="gui",
        cmd=["/usr/bin/python3.12", os.path.join(HERE, "gtk_field.py"), "3", "entry"],
        wclass="synthetic-gtk", click=None),
    "gtk3-textview": dict(
        label="synthetic GTK3 Gtk.TextView", kind="gui",
        cmd=["/usr/bin/python3.12", os.path.join(HERE, "gtk_field.py"), "3", "textview"],
        wclass="synthetic-gtk", click=None),
    "featherpad": dict(
        label="FeatherPad 1.4 (Qt 5.15 QPlainTextEdit)", kind="gui",
        cmd=["featherpad", "--standalone"], wclass="featherpad", click=(0.5, 0.6)),
    "libreoffice-writer": dict(
        label="LibreOffice Writer 24.2 (gtk3 VCL plugin)", kind="gui",
        cmd=["soffice", "--writer", "--norestore", "--nologo", "--nofirststartwizard",
             "-env:UserInstallation=file://" + os.path.join(RUN, "lo-profile")],
        env={"SAL_USE_VCLPLUGIN": "gtk3"},
        wclass="libreoffice|soffice", click=(0.5, 0.6), settle=3.0, paste_wait=0.8,
        start_timeout=90),
    "gnome-terminal": dict(
        label="gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt", kind="terminal",
        cmd=["/usr/bin/gnome-terminal.real", "--wait", "--", "bash", "--rcfile", RCFILE, "-i"],
        wclass="gnome-terminal", click=(0.5, 0.5)),
    "xfce4-terminal": dict(
        label="xfce4-terminal 1.1 (VTE 0.76, GTK3), bash prompt", kind="terminal",
        cmd=["xfce4-terminal", "--disable-server", "-x", "bash", "--rcfile", RCFILE, "-i"],
        wclass="xfce4-terminal", click=(0.5, 0.5)),
    "xterm": dict(
        label="xterm 390 (Xaw), bash prompt", kind="terminal",
        cmd=["xterm", "-e", "bash", "--rcfile", RCFILE, "-i"],
        wclass="xterm", click=(0.5, 0.5)),
    "chromium-textarea": dict(
        label="Chrome for Testing 153 (Playwright) <textarea>", kind="gui",
        cmd=chrome_cmd("ta"), env={"CHROMIUM_FULL_AS_SHIPPED": "1"}, wclass="chrom", click=None, settle=2.0, focus_wait=10.0),
    "chromium-input": dict(
        label="Chrome for Testing 153 (Playwright) <input type=text>", kind="gui",
        cmd=chrome_cmd("in"), env={"CHROMIUM_FULL_AS_SHIPPED": "1"}, wclass="chrom", click=None, settle=2.0, focus_wait=10.0),
    "chromium-contenteditable": dict(
        label="Chrome for Testing 153 (Playwright) contenteditable div", kind="gui",
        cmd=chrome_cmd("ce"), env={"CHROMIUM_FULL_AS_SHIPPED": "1"}, wclass="chrom", click=None, settle=2.0, focus_wait=10.0),
    "epiphany-textarea": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea>", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#ta"],
        wclass="epiphany", click=(400, 120), settle=3.0, focus_wait=10.0,
        pre=[["gsettings", "set", "org.gnome.Epiphany", "ask-for-default", "false"]]),
    "epiphany-input": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text>", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#in"],
        wclass="epiphany", click=(400, 213), settle=3.0, focus_wait=10.0,
        pre=[["gsettings", "set", "org.gnome.Epiphany", "ask-for-default", "false"]]),
    "epiphany-contenteditable": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#ce"],
        wclass="epiphany", click=(400, 300), settle=3.0, focus_wait=10.0,
        pre=[["gsettings", "set", "org.gnome.Epiphany", "ask-for-default", "false"]]),
}

# What a config changes before or at launch.  "plain" changes nothing.
#   status:  set org.a11y.Status IsEnabled=true on the session bus first
#   screen_reader: set org.a11y.Status ScreenReaderEnabled=true first
#   screen_reader_after: set ScreenReaderEnabled=true once the app's window is up
#   env / args: added to the app's environment / command line
#   client: "before" = the AT-SPI client (this harness) connects before the
#           app starts, as a tray app started at login would; "after" = the
#           client connects only once the app is up and its text is pasted.
#   bus:    "prestart" = the accessibility bus is running before the app
#           starts, as where a desktop autostarts at-spi-bus-launcher, though
#           no client has connected yet (org.a11y.Bus GetAddress, no libatspi).
#           Without it and with client "after", nothing has started the
#           accessibility bus when the app starts, unless the app does.
CONFIGS = {
    "plain": dict(),
    "late-client": dict(client="after"),
    "bus-late-client": dict(bus="prestart", client="after"),
    "bus-late-client-status": dict(bus="prestart", client="after", status=True),
    "bus-late-client-force-renderer": dict(bus="prestart", client="after",
                                           args=["--force-renderer-accessibility"]),
    "bus-late-client-qt-always-on": dict(bus="prestart", client="after",
                                         env={"QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "status": dict(status=True),
    "screen-reader": dict(screen_reader=True),
    "qt-always-on": dict(env={"QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "qt-accessibility": dict(env={"QT_ACCESSIBILITY": "1"}),
    "force-renderer": dict(args=["--force-renderer-accessibility"]),
    "status-force-renderer": dict(status=True, args=["--force-renderer-accessibility"]),
    "bus-late-client-status-force-renderer": dict(bus="prestart", client="after", status=True,
                                                  args=["--force-renderer-accessibility"]),
    "gnome-accessibility-env": dict(env={"GNOME_ACCESSIBILITY": "1"}),
    "late-client-qt-always-on": dict(client="after", env={"QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "status-screen-reader-after-launch": dict(status=True, screen_reader_after=True),
    "accessibility-enabled-env": dict(env={"ACCESSIBILITY_ENABLED": "1"}),
    "status-accessibility-enabled-env": dict(status=True, env={"ACCESSIBILITY_ENABLED": "1"}),
    "bus-late-client-gnome-accessibility-env": dict(bus="prestart", client="after",
                                                    env={"GNOME_ACCESSIBILITY": "1"}),
    "force-renderer-late-client": dict(args=["--force-renderer-accessibility"], client="after"),
    "no-webkit-sandbox": dict(env={"WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS": "1"}),
    "gsk-cairo": dict(env={"GSK_RENDERER": "cairo"}),
}

SCENARIOS = [
    "probe",            # launch, paste, look up and read only
    "atspi",            # replace through EditableText: delete+insert, else set_text_contents
    "atspi_settext",    # replace with set_text_contents only
    "atspi_selpaste",   # select the word through Text.set_selection, then paste VOCO's way
    "blind",            # 27 BackSpace + paste the corrected tail
    "hazard_atspi",     # Home first, then what the AT-SPI path sees (it must not edit)
    "hazard_blind",     # Home first, then the blind path
]

log_lines = []
T0 = time.monotonic()


def log(msg):
    line = f"[{time.monotonic() - T0:7.3f}] {msg}"
    log_lines.append(line)
    print(line, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- X helpers

def sh(cmd, timeout=10, input_=None):
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, input=input_)
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"


def key(*keys, delay_ms=12):
    rc, _out, err = sh(["xdotool", "key", "--delay", str(delay_ms), *keys])
    if rc:
        log(f"xdotool key {keys} failed: {err.strip()}")
    return rc == 0


_holders = []


def drop_clipboard():
    """End our xclip holders, so both selections have no owner."""
    for p in _holders:
        if p.poll() is None:
            p.terminate()
    for p in _holders:
        try:
            p.wait(timeout=2)
        except subprocess.TimeoutExpired:
            p.kill()
    _holders.clear()


def copy_voco(text):
    """CLIPBOARD then PRIMARY with foreground xclip, as VOCO does on X11."""
    old = list(_holders)
    _holders.clear()
    for selection in ("clipboard", "primary"):
        p = subprocess.Popen(["xclip", "-selection", selection, "-quiet"],
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        p.stdin.write(text.encode())
        p.stdin.close()
        _holders.append(p)
    # Wait until the new helpers own the selections.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if read_selection("clipboard") == text and read_selection("primary") == text:
            break
        time.sleep(0.02)
    for p in old:
        try:
            p.wait(timeout=1)
        except subprocess.TimeoutExpired:
            p.terminate()


def read_selection(selection):
    rc, out, _err = sh(["xclip", "-o", "-selection", selection], timeout=3)
    return out if rc == 0 else None


def paste_voco(text, wait):
    copy_voco(text)
    key("shift+Insert")
    time.sleep(wait)


def active_window():
    rc, out, _ = sh(["xdotool", "getactivewindow"])
    if rc or not out.strip():
        return None, ""
    wid = out.strip()
    _rc, cls, _ = sh(["xprop", "-id", wid, "WM_CLASS", "WM_NAME"])
    return wid, cls


def window_geometry(wid):
    _rc, out, _ = sh(["xdotool", "getwindowgeometry", "--shell", wid])
    return {k: int(v) for k, v in re.findall(r"(\w+)=(-?\d+)", out)}


def click_window(wid, where):
    geo = window_geometry(wid)
    x, y = where
    if x < 1 and y < 1:
        x, y = int(geo["WIDTH"] * x), int(geo["HEIGHT"] * y)
    sh(["xdotool", "mousemove", "--window", wid, str(x), str(y), "click", "1"])
    return dict(x=x, y=y, window=geo)


def screenshot(name):
    path = os.path.join(RUN, name)
    sh(["import", "-window", "root", path], timeout=15)
    return path


# ------------------------------------------------------------ a11y status

def a11y_status():
    """org.a11y.Status on the session bus, read without AT-SPI."""
    out = {}
    try:
        if not a11y_bus_running():
            return dict(bus="not running")
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        for prop in ("IsEnabled", "ScreenReaderEnabled"):
            value = bus.call_sync(
                "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties", "Get",
                GLib.Variant("(ss)", ("org.a11y.Status", prop)), None,
                Gio.DBusCallFlags.NONE, 3000, None)
            out[prop] = value.unpack()[0]
    except GLib.Error as e:
        out["error"] = e.message
    return out


def start_a11y_bus():
    """D-Bus-activate at-spi-bus-launcher without connecting a client."""
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    reply = bus.call_sync("org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress",
                          None, None, Gio.DBusCallFlags.NONE, 5000, None)
    return bool(reply.unpack()[0])


def a11y_bus_running():
    """Whether org.a11y.Bus has an owner, asked without activating it."""
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    reply = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus",
                          "org.freedesktop.DBus", "NameHasOwner",
                          GLib.Variant("(s)", ("org.a11y.Bus",)), None,
                          Gio.DBusCallFlags.NONE, 3000, None)
    return reply.unpack()[0]


def root_at_spi_bus_property():
    rc, out, _ = sh(["xprop", "-root", "AT_SPI_BUS"])
    return rc == 0 and "=" in out


def set_a11y_status(prop, value):
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    bus.call_sync(
        "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties", "Set",
        GLib.Variant("(ssv)", ("org.a11y.Status", prop, GLib.Variant("b", value))), None,
        Gio.DBusCallFlags.NONE, 3000, None)


def gsetting_toolkit_accessibility():
    rc, out, err = sh(["gsettings", "get", "org.gnome.desktop.interface", "toolkit-accessibility"])
    return out.strip() if rc == 0 else f"unreadable: {err.strip()[:120]}"


# ------------------------------------------------------------ AT-SPI side

focus_events = []
_listener = None


def pump(seconds=0.05):
    """Dispatch queued AT-SPI events; libatspi's cache follows them."""
    ctx = GLib.MainContext.default()
    end = time.monotonic() + seconds
    while True:
        while ctx.pending():
            ctx.iteration(False)
        if time.monotonic() >= end:
            break
        time.sleep(0.005)


def _on_event(event):
    try:
        if event.type.startswith("object:state-changed:focused") and event.detail1 != 1:
            return
        focus_events.append(dict(t=time.monotonic() - T0, type=event.type, source=event.source))
    except Exception as e:  # noqa: BLE001
        log(f"event callback error: {e}")


def atspi_connect():
    global _listener
    t = time.perf_counter()
    rc = Atspi.init()
    _listener = Atspi.EventListener.new(_on_event)
    _listener.register("object:state-changed:focused")
    _listener.register("focus:")
    pump(0.1)
    return dict(init_rc=rc, connect_ms=round((time.perf_counter() - t) * 1000, 1))


def safe(fn, default=None):
    try:
        return fn()
    except GLib.Error as e:
        return default if default is not None else f"error: {e.message}"
    except Exception as e:  # noqa: BLE001
        return default if default is not None else f"error: {e}"


def has_state(obj, state):
    try:
        return obj.get_state_set().contains(state)
    except GLib.Error:
        return False


def kids(obj):
    try:
        n = obj.get_child_count()
    except GLib.Error:
        return
    for i in range(min(n, 500)):
        try:
            child = obj.get_child_at_index(i)
        except GLib.Error:
            continue
        if child is not None:
            yield child


def has_iface(obj, name):
    try:
        return name in obj.get_interfaces()
    except GLib.Error:
        return False


def find_focused(stats):
    """Walk the desktop tree for STATE_FOCUSED: active windows first, then the
    rest. An object that is focused, editable and implements Text is returned
    at once. Apps report focus on more than one object (Chromium on a toolbar
    web view as well as the field, Qt on a field and its viewport), so any
    other focused object is only a fallback, used after its whole window was
    walked: the first with Text, else the first."""
    stats["nodes"] = 0
    desktop = Atspi.get_desktop(0)
    windows = []
    for app in kids(desktop):
        for win in kids(app):
            windows.append(win)
    stats["windows"] = len(windows)
    ordered = [w for w in windows if has_state(w, Atspi.StateType.ACTIVE)]
    stats["active_windows"] = len(ordered)
    ordered += [w for w in windows if w not in ordered]

    for win in ordered:
        fallbacks = []
        stack = [win]
        while stack:
            node = stack.pop()
            stats["nodes"] += 1
            if stats["nodes"] > 20000:
                break
            try:
                states = node.get_state_set()
            except GLib.Error:
                continue
            if states.contains(Atspi.StateType.FOCUSED):
                if states.contains(Atspi.StateType.EDITABLE) and has_iface(node, "Text"):
                    stats["focused_seen"] = len(fallbacks) + 1
                    stats["picked"] = "focused+editable+Text"
                    return node
                fallbacks.append(node)
            stack.extend(reversed(list(kids(node))))
        if fallbacks:
            stats["focused_seen"] = len(fallbacks)
            with_text = [o for o in fallbacks if has_iface(o, "Text")]
            stats["picked"] = "focused+Text (not editable)" if with_text else "focused only"
            return (with_text or fallbacks)[0]
    return None


def describe(obj):
    if obj is None:
        return None
    states = safe(lambda: [s.value_nick for s in obj.get_state_set().get_states()], [])
    app = safe(obj.get_application)
    return dict(
        role=safe(obj.get_role_name),
        name=safe(obj.get_name),
        interfaces=safe(lambda: list(obj.get_interfaces()), []),
        states=states,
        attributes=safe(lambda: dict(obj.get_attributes() or {}), {}),
        app=safe(app.get_name) if hasattr(app, "get_name") else None,
        toolkit=safe(obj.get_toolkit_name),
        toolkit_version=safe(obj.get_toolkit_version),
        ancestry=ancestry(obj),
    )


def ancestry(obj):
    chain = []
    node = obj
    for _ in range(40):
        if node is None:
            break
        chain.append(safe(node.get_role_name))
        try:
            node = node.get_parent()
        except GLib.Error:
            break
    return " < ".join(str(c) for c in chain)


def desktop_apps():
    out = []
    for app in kids(Atspi.get_desktop(0)):
        out.append(dict(name=safe(app.get_name), toolkit=safe(app.get_toolkit_name),
                        toolkit_version=safe(app.get_toolkit_version),
                        windows=safe(app.get_child_count)))
    return out


def read_text(obj):
    """Text interface: full text and caret."""
    out = dict(has_text="Text" in safe(lambda: list(obj.get_interfaces()), []),
               has_editable_text="EditableText" in safe(lambda: list(obj.get_interfaces()), []))
    t = time.perf_counter()
    try:
        n = Atspi.Text.get_character_count(obj)
        out["character_count"] = n
        out["text"] = Atspi.Text.get_text(obj, 0, n)
        out["caret"] = Atspi.Text.get_caret_offset(obj)
    except GLib.Error as e:
        out["error"] = e.message
    out["read_ms"] = round((time.perf_counter() - t) * 1000, 2)
    return out


def timed_lookups(cold):
    """Five lookups; cold = libatspi's cache cleared before each."""
    runs = []
    found = None
    for _ in range(5):
        pump(0.02)
        if cold:
            safe(lambda: Atspi.get_desktop(0).clear_cache())
        stats = {}
        t = time.perf_counter()
        found = find_focused(stats)
        stats["ms"] = round((time.perf_counter() - t) * 1000, 2)
        stats["found"] = found is not None
        runs.append(stats)
    return found, dict(runs=runs, median_ms=statistics.median(r["ms"] for r in runs))


def fold(text):
    """Rich-text fields store a space at a paste's edge as U+00A0."""
    return text.replace("\u00a0", " ")


def check_before_caret(reading):
    """Step (c): does the text before the caret still end with what was pasted?
    Strictly, and with no-break spaces read as spaces."""
    text, caret = reading.get("text"), reading.get("caret")
    if not isinstance(text, str) or not isinstance(caret, int) or caret < 0:
        return dict(verifiable=False)
    before = text[:caret]
    return dict(
        verifiable=True,
        text_equals_expected=text == EXPECTED,
        text_equals_expected_nbsp_folded=fold(text) == EXPECTED,
        no_break_spaces_in_text=text.count("\u00a0"),
        text_before_caret_ends_with_pasted=before.endswith(EXPECTED),
        text_before_caret_ends_with_pasted_nbsp_folded=fold(before).endswith(EXPECTED),
        text_before_caret_ends_with_tail=before.endswith(OLD_TAIL),
        text_before_caret_ends_with_tail_nbsp_folded=fold(before).endswith(OLD_TAIL),
        caret_at_end_of_text=caret == len(text),
        text_after_caret=text[caret:caret + 200],
        text_after_caret_is_blank=text[caret:].strip() == "",
    )


# ------------------------------------------------------- replace methods

def replace_delete_insert(obj, start):
    out = dict(method="delete_text+insert_text")
    t = time.perf_counter()
    try:
        out["delete_returned"] = Atspi.EditableText.delete_text(obj, start, start + len(WRONG))
        out["delete_ms"] = round((time.perf_counter() - t) * 1000, 2)
        pump(0.02)
        out["text_after_delete"] = read_text(obj).get("text")
        t2 = time.perf_counter()
        out["insert_returned"] = Atspi.EditableText.insert_text(obj, start, RIGHT, len(RIGHT.encode()))
        out["insert_ms"] = round((time.perf_counter() - t2) * 1000, 2)
        out["ms"] = round(out["delete_ms"] + out["insert_ms"], 2)
    except GLib.Error as e:
        out["error"] = e.message
    return out


def replace_set_contents(obj, new_text):
    out = dict(method="set_text_contents")
    t = time.perf_counter()
    try:
        out["returned"] = Atspi.EditableText.set_text_contents(obj, new_text)
    except GLib.Error as e:
        out["error"] = e.message
    out["ms"] = round((time.perf_counter() - t) * 1000, 2)
    return out


def replace_select_paste(obj, start, wait):
    """Hybrid: AT-SPI selects the wrong word, VOCO's own paste replaces it."""
    out = dict(method="Text.set_selection+paste")
    copy_voco(RIGHT)
    t = time.perf_counter()
    step = "get_n_selections"
    try:
        n = Atspi.Text.get_n_selections(obj)
        out["selections_before"] = n
        if n > 0:
            step = "set_selection"
            out["select_returned"] = Atspi.Text.set_selection(obj, 0, start, start + len(WRONG))
        else:
            step = "add_selection"
            try:
                out["select_returned"] = Atspi.Text.add_selection(obj, start, start + len(WRONG))
            except GLib.Error as e:
                out["add_selection_error"] = e.message or "empty message"
                step = "set_selection"
                out["select_returned"] = Atspi.Text.set_selection(obj, 0, start, start + len(WRONG))
        out["select_call"] = step
        pump(0.05)
        step = "get_selection"
        sel = Atspi.Text.get_selection(obj, 0)
        out["selection_read_back"] = [sel.start_offset, sel.end_offset]
    except GLib.Error as e:
        out["error"] = f"{step}: {e.message or 'empty message'}"
        return out
    if out["selection_read_back"] != [start, start + len(WRONG)]:
        out["error"] = "the selection read back is not the word; nothing pasted"
        return out
    key("shift+Insert")
    out["ms"] = round((time.perf_counter() - t) * 1000, 2)
    time.sleep(wait)
    return out


# ------------------------------------------------- independent reading

def independent_gui(wait=0.25):
    """Without AT-SPI: Ctrl+Shift+Home, Ctrl+C gives the text before the caret
    (so it also tells where the caret is); Ctrl+A, Ctrl+C gives all of it.
    The selections have no owner first, so an app that copies nothing reads
    as None, never as a stale value."""
    out = {}
    drop_clipboard()
    time.sleep(0.05)
    out["clipboard_empty_first"] = read_selection("clipboard") is None
    key("ctrl+shift+Home")
    time.sleep(wait)
    key("ctrl+c")
    time.sleep(wait)
    out["before_caret"] = read_selection("clipboard")
    key("ctrl+a")
    time.sleep(wait)
    key("ctrl+c")
    time.sleep(wait)
    out["full"] = read_selection("clipboard")
    out["method"] = "ctrl+shift+Home ctrl+c, then ctrl+a ctrl+c, read with xclip -o"
    return out


def independent_terminal():
    """Without AT-SPI: bash's own READLINE_LINE and READLINE_POINT, written by
    a bind -x key (Ctrl+X Ctrl+P) from terminal.bashrc."""
    try:
        os.unlink(DUMP)
    except FileNotFoundError:
        pass
    key("ctrl+x", "ctrl+p")
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if os.path.exists(DUMP):
            raw = open(DUMP, encoding="utf-8", errors="replace").read()
            point, _, line = raw.partition("\n")
            return dict(full=line, point=int(point) if point.isdigit() else None,
                        before_caret=line[:int(point)] if point.isdigit() else None,
                        method="bash bind -x: READLINE_LINE / READLINE_POINT")
        time.sleep(0.05)
    return dict(full=None, before_caret=None, point=None,
                method="bash bind -x: READLINE_LINE / READLINE_POINT", error="no dump written")


def norm(text):
    """Trailing newline some apps add to a copy; reported separately."""
    return text.rstrip("\n") if isinstance(text, str) else text


# ------------------------------------------------------------------ main

def launch(case, config, result):
    env = dict(os.environ)
    env.update(case.get("env", {}))
    env.update(config.get("env", {}))
    env["FIELD_ACCESS_DUMP"] = DUMP
    cmd = list(case["cmd"])
    extra = config.get("args", [])
    if extra:
        cmd = cmd[:1] + extra + cmd[1:]
    result["launch"] = dict(cmd=cmd, env_added={**case.get("env", {}), **config.get("env", {})})
    if not os.path.exists(cmd[0]) and sh(["which", cmd[0]])[0] != 0:
        result["launch"]["error"] = f"{cmd[0]} is not installed"
        return None
    for pre in case.get("pre", []):
        rc, _out, err = sh(pre, timeout=15)
        result["launch"].setdefault("pre", []).append(dict(cmd=pre, rc=rc, err=err.strip()[:200]))
    out = open(os.path.join(RUN, "app.log"), "wb")
    return subprocess.Popen(cmd, env=env, stdout=out, stderr=subprocess.STDOUT,
                            start_new_session=True)


def wait_for_window(case, proc, result):
    pattern = re.compile(case["wclass"], re.I)
    deadline = time.monotonic() + case.get("start_timeout", 45)
    while time.monotonic() < deadline:
        pump(0.1)
        wid, cls = active_window()
        if wid and pattern.search(cls):
            result["launch"]["window"] = dict(id=wid, props=cls.strip(),
                                              after_s=round(time.monotonic() - T0, 2))
            return wid
        if proc.poll() is not None and case["kind"] != "terminal" and "gnome-terminal" not in case["cmd"][0]:
            # Some launchers exit after handing over; keep waiting for the window.
            pass
    result["launch"]["error"] = "no active window of the app within the timeout"
    result["launch"]["active_window_seen"] = active_window()[1].strip()
    return None


def wait_until_focused(seconds, want_text=False):
    """Poll for a focused accessible (one with Text if wanted, else any found
    by the deadline). Returns it or None."""
    deadline = time.monotonic() + seconds
    found = None
    while True:
        pump(0.1)
        found = find_focused({})
        if found is not None and (not want_text or has_iface(found, "Text")):
            return found
        if time.monotonic() >= deadline:
            return found


def tree_outline(max_nodes=60, max_depth=6):
    """The top of the AT-SPI tree, for cases where no field is found."""
    lines = []

    def walk(node, depth):
        if len(lines) >= max_nodes or depth > max_depth:
            return
        states = safe(lambda: [s.value_nick for s in node.get_state_set().get_states()], [])
        flags = [f for f in ("active", "focused", "editable", "showing") if f in states]
        lines.append("  " * depth + f"{safe(node.get_role_name)} {safe(node.get_name)!r:.40}"
                     + (f" [{','.join(flags)}]" if flags else "")
                     + (" <Text>" if has_iface(node, "Text") else ""))
        for child in kids(node):
            walk(child, depth + 1)

    walk(Atspi.get_desktop(0), 0)
    return lines


def run(case_name, scenario, config_name):
    case = CASES[case_name]
    config = CONFIGS[config_name]
    paste_wait = case.get("paste_wait", 0.45)
    client = config.get("client", "before")
    result = dict(
        case=case_name, label=case["label"], kind=case["kind"], scenario=scenario,
        config=config_name, config_detail={k: v for k, v in config.items()},
        client_connects=client, expected=EXPECTED, final_expected=FINAL,
        environment=dict(
            display=os.environ.get("DISPLAY"), session_type="x11 (Xvfb) + openbox",
            python=sys.version.split()[0],
            atspi_version=sh(["dpkg-query", "-W", "-f=${Version}", "at-spi2-core"])[1],
            gsettings_toolkit_accessibility=gsetting_toolkit_accessibility(),
            a11y_status_at_start=a11y_status(),
        ),
    )
    if config.get("bus") == "prestart":
        result["environment"]["a11y_bus_prestarted"] = start_a11y_bus()
    if config.get("status"):
        set_a11y_status("IsEnabled", True)
    if config.get("screen_reader"):
        set_a11y_status("ScreenReaderEnabled", True)
    if config.get("status") or config.get("screen_reader"):
        result["environment"]["a11y_status_after_set"] = a11y_status()

    if client == "before":
        result["atspi_connect"] = atspi_connect()
        result["environment"]["a11y_status_after_client_connect"] = a11y_status()

    if a11y_bus_running():
        # at-spi-bus-launcher sets the root window's AT_SPI_BUS a moment after
        # it takes its name; an app started inside that moment is not a case
        # a desktop has (see results/flakes).
        deadline = time.monotonic() + 2
        while not root_at_spi_bus_property() and time.monotonic() < deadline:
            time.sleep(0.05)
    result["environment"]["at_app_start"] = dict(
        a11y_bus_running=a11y_bus_running(),
        root_window_AT_SPI_BUS_property=root_at_spi_bus_property(),
        a11y_status=a11y_status())
    proc = launch(case, config, result)
    if proc is None:
        return result
    try:
        wid = wait_for_window(case, proc, result)
        if wid is None:
            result["screenshot"] = screenshot("no-window.png")
            return result
        time.sleep(case.get("settle", 1.0))
        if config.get("screen_reader_after"):
            set_a11y_status("ScreenReaderEnabled", True)
            result["environment"]["a11y_status_set_after_launch"] = a11y_status()
            time.sleep(3.0)
        if case.get("click"):
            result["launch"]["click"] = click_window(wid, case["click"])
            time.sleep(0.4)
        pump(0.3)
        result["environment"]["a11y_status_after_launch"] = a11y_status()
        result["environment"]["after_launch"] = dict(
            a11y_bus_running=a11y_bus_running(),
            root_window_AT_SPI_BUS_property=root_at_spi_bus_property())

        # Step 2: paste the three chunks VOCO's way.
        for chunk in CHUNKS:
            paste_voco(chunk, paste_wait)
        log("pasted three chunks")

        if scenario.startswith("hazard"):
            key("Home")
            time.sleep(0.3)
            result["hazard"] = "Home pressed after the pastes"

        if client == "after":
            result["atspi_connect"] = atspi_connect()
            result["environment"]["a11y_status_after_client_connect"] = a11y_status()
            time.sleep(1.0)
        pump(0.3)

        independent = independent_terminal if case["kind"] == "terminal" else independent_gui

        # ---- blind scenarios never touch AT-SPI before the keys.
        if scenario in ("blind", "hazard_blind"):
            key(*(["BackSpace"] * BACKSPACES))
            time.sleep(0.3)
            paste_voco(NEW_TAIL, paste_wait)
            ind = independent()
            result["independent_after"] = ind
            result["blind"] = dict(
                backspaces=BACKSPACES, pasted=NEW_TAIL,
                field_exact=ind.get("full") == FINAL,
                field_exact_ignoring_trailing_newline=norm(ind.get("full")) == FINAL,
                caret_at_end=ind.get("before_caret") == ind.get("full") and ind.get("full") is not None,
            )
            result["screenshot"] = screenshot("end.png")
            return result

        # ---- AT-SPI scenarios.
        # Some apps build their tree only once a client asks: poll first, and
        # record how long the field took to appear, before timing lookups.
        t_poll = time.monotonic()
        first = wait_until_focused(case.get("focus_wait", 4.0), want_text=case["kind"] == "gui")
        result["first_lookup"] = dict(
            found=first is not None,
            has_text=first is not None and has_iface(first, "Text"),
            after_s=round(time.monotonic() - t_poll, 2),
            waited_up_to_s=case.get("focus_wait", 4.0))
        result["desktop_apps"] = desktop_apps()
        obj, cold = timed_lookups(cold=True)
        _obj2, warm = timed_lookups(cold=False)
        result["lookup"] = dict(cold=cold, warm=warm, found=obj is not None)
        result["focused"] = describe(obj)

        # Focus events: did the listener get the same object without a walk?
        pump(0.1)
        result["focus_events"] = dict(
            count=len(focus_events),
            last=[dict(t=round(e["t"], 3), type=e["type"], role=safe(e["source"].get_role_name),
                       same_as_walk=(e["source"] == obj)) for e in focus_events[-4:]],
            last_event_source_is_walk_result=bool(focus_events) and focus_events[-1]["source"] == obj,
            any_event_source_is_walk_result=any(e["source"] == obj for e in focus_events),
        )
        if obj is None:
            result["tree_outline"] = tree_outline()
            result["independent_after"] = independent()
            result["screenshot"] = screenshot("end.png")
            return result

        reading = read_text(obj)
        result["read"] = reading
        result["verify_before_caret"] = check_before_caret(reading)
        log(f"read: {reading}")

        if scenario == "probe":
            result["tree_outline"] = tree_outline(max_nodes=400, max_depth=40)
            result["independent_after"] = independent()
            result["screenshot"] = screenshot("end.png")
            return result

        v = result["verify_before_caret"]
        if scenario == "hazard_atspi":
            result["hazard_atspi"] = dict(
                would_edit=bool(v.get("text_before_caret_ends_with_tail_nbsp_folded")),
                caret_seen=reading.get("caret"),
                decision="refuse: the text before the caret does not end with what was pasted"
                if not v.get("text_before_caret_ends_with_tail_nbsp_folded")
                else "would edit (hazard NOT detected)",
            )
            ind = independent()
            result["independent_after"] = ind
            result["hazard_atspi"]["field_untouched"] = norm(ind.get("full")) == EXPECTED
            result["screenshot"] = screenshot("end.png")
            return result

        if not v.get("text_before_caret_ends_with_tail_nbsp_folded"):
            result["replace"] = dict(skipped="the text before the caret does not end with the pasted tail")
            result["independent_after"] = independent()
            result["screenshot"] = screenshot("end.png")
            return result

        caret = reading["caret"]
        start = caret - len(OLD_TAIL)
        text = reading["text"]
        # Offsets hold with no-break spaces (one character each); the text
        # expected back keeps whatever spaces the field stores.
        new_full = text[:start] + RIGHT + text[start + len(WRONG):]
        attempts = []
        methods = {"atspi": ["delete_insert", "set_contents"],
                   "atspi_settext": ["set_contents"],
                   "atspi_selpaste": ["select_paste"]}[scenario]
        worked = None
        for method in methods:
            current = read_text(obj)
            if method == "delete_insert":
                a = replace_delete_insert(obj, start)
            elif method == "set_contents":
                a = replace_set_contents(obj, new_full)
            else:
                if current.get("text") != text:
                    a = dict(method="Text.set_selection+paste", skipped="text already changed")
                else:
                    a = replace_select_paste(obj, start, paste_wait)
            pump(0.15)
            after = read_text(obj)
            a["text_after"] = after.get("text")
            a["caret_after"] = after.get("caret")
            a["text_is_final"] = after.get("text") == new_full
            attempts.append(a)
            if a["text_is_final"]:
                worked = a
                break
        result["replace"] = dict(attempts=attempts, worked_method=worked["method"] if worked else None,
                                 ms=worked.get("ms") if worked else None,
                                 atspi_reread_is_final=bool(worked))

        # Caret: must be back at the end of the pasted text.
        after = read_text(obj)
        end = start + len(NEW_TAIL)
        caret_info = dict(after_replace=after.get("caret"), wanted=end,
                          at_end_without_help=after.get("caret") == end)
        if not caret_info["at_end_without_help"]:
            t = time.perf_counter()
            try:
                caret_info["set_caret_offset_returned"] = Atspi.Text.set_caret_offset(obj, end)
            except GLib.Error as e:
                caret_info["set_caret_offset_error"] = e.message
            caret_info["set_caret_ms"] = round((time.perf_counter() - t) * 1000, 2)
            pump(0.15)
            caret_info["after_set_caret_offset"] = read_text(obj).get("caret")
        caret_info["at_end_finally_atspi"] = (
            caret_info["at_end_without_help"] or caret_info.get("after_set_caret_offset") == end)
        result["caret"] = caret_info
        result["read_after"] = read_text(obj)

        ind = independent()
        result["independent_after"] = ind
        if case["kind"] == "terminal":
            ind_final = ind.get("full") == FINAL
            ind_caret = ind.get("before_caret") == FINAL
        else:
            ind_final = norm(ind.get("full")) == FINAL
            ind_caret = ind.get("before_caret") == FINAL
        result["replace"]["independent_is_final"] = ind_final
        result["caret"]["independent_text_before_caret_is_final"] = ind_caret
        result["screenshot"] = screenshot("end.png")
        return result
    finally:
        drop_clipboard()
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        sh(["pkill", "-f", "gnome-terminal-server"], timeout=3)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            tail = open(os.path.join(RUN, "app.log"), "rb").read()[-1500:].decode("utf-8", "replace")
            result["app_log_tail"] = tail
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case", nargs="?")
    ap.add_argument("scenario", nargs="?", default="probe")
    ap.add_argument("--config", default="plain")
    ap.add_argument("--out")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list or not args.case:
        print("cases:    ", " ".join(CASES))
        print("scenarios:", " ".join(SCENARIOS))
        print("configs:  ", " ".join(CONFIGS))
        return 0
    out = args.out or os.path.join(HERE, "results", f"{args.case}.{args.scenario}.{args.config}.json")
    try:
        result = run(args.case, args.scenario, args.config)
    except Exception as e:  # noqa: BLE001
        import traceback
        result = dict(case=args.case, scenario=args.scenario, config=args.config,
                      harness_error=f"{type(e).__name__}: {e}", traceback=traceback.format_exc())
    result["log"] = log_lines
    result["run_dir"] = RUN
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, ensure_ascii=False, default=str)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
