#!/usr/bin/python3.12
"""Field ladder: one ordered "correct what I just dictated" procedure, measured
in a headless GNOME Shell session on Wayland.

Run through run.sh, which gives each run its own namespaces, D-Bus session,
HOME and XDG_RUNTIME_DIR:

    ./run.sh <case> <scenario> [--config NAME] [--rep N]

One run = one field, one scenario, one fresh Shell session, one JSON file.
Only the made-up sentence below is ever pasted or typed.
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, Gio, GLib  # noqa: E402

HERE = os.environ.get("FIELD_LADDER_HERE", os.path.dirname(os.path.abspath(__file__)))
RUN = os.environ.get("FIELD_LADDER_RUN", "/nonexistent")
WAYLAND = "ladder"
MONITOR = (1280, 800)

# ----------------------------------------------------------------- the text
CHUNKS = ["Let's meet at the", " peer on Thursday", " afternoon."]
PASTED = "".join(CHUNKS)
WRONG, RIGHT = "peer", "pier"
WRONG_OFFSET = PASTED.index(WRONG)
CORRECTED = PASTED[:WRONG_OFFSET] + RIGHT + PASTED[WRONG_OFFSET + len(WRONG):]
assert PASTED == "Let's meet at the peer on Thursday afternoon."
assert CORRECTED == "Let's meet at the pier on Thursday afternoon."
PREFILL = "Notes: "
AFTER = " (draft)"
TYPED = "ok"

SCENARIOS = ["plain", "home", "typed-after", "cleared", "other-field", "prefilled", "text-after",
             # An extra hazard, not in the brief's list: focus moves to a window
             # AT-SPI does not expose here (FeatherPad as a native Wayland client).
             "other-unreadable"]
OTHER_SCENARIOS = ("other-field", "other-unreadable")


def intended(scenario):
    """(field text, text before the caret) the setup should leave, and the
    field text a correct correction would leave."""
    if scenario == "home":
        return PASTED, "", CORRECTED
    if scenario == "typed-after":
        return PASTED + TYPED, PASTED + TYPED, CORRECTED + TYPED
    if scenario == "cleared":
        return "", "", None
    if scenario == "prefilled":
        return PREFILL + PASTED, PREFILL + PASTED, PREFILL + CORRECTED
    if scenario == "text-after":
        return PASTED + AFTER, PASTED, CORRECTED + AFTER
    return PASTED, PASTED, CORRECTED  # plain, other-field, other-unreadable


# ---------------------------------------------------------------- the cases
CHROME = os.path.realpath("/opt/pw-browsers/chromium") if os.path.exists("/opt/pw-browsers/chromium") else None
ELECTRON = os.path.join(HERE, "electron-app", "node_modules", "electron", "dist", "electron")
RCFILE = os.path.join(HERE, "terminal.bashrc")
DUMP = os.path.join(RUN, "readline.dump")
FIELDS = "file://" + os.path.join(HERE, "fields.html")
PY = "/usr/bin/python3.12"
GTK_FIELD = os.path.join(HERE, "gtk_field.py")
OTHER_TITLE = "other-field"


def chrome_cmd(field):
    return [CHROME or "chrome-not-found", "--ozone-platform=wayland",
            "--no-sandbox",  # root in a container
            "--no-first-run", "--no-default-browser-check", "--password-store=basic",
            "--user-data-dir=" + os.path.join(RUN, "chrome-profile"),
            "--window-size=1100,700", f"{FIELDS}#{field}"]


def electron_cmd():
    return [ELECTRON, "--ozone-platform=wayland", "--no-sandbox",
            "--user-data-dir=" + os.path.join(RUN, "electron-profile"),
            os.path.join(HERE, "electron-app")]


EPI_PRE = [["gsettings", "set", "org.gnome.Epiphany", "ask-for-default", "false"]]
# click: (x, y) from the window's top-left corner, as fractions of its size
# when both are < 1.  None = the app or page focuses the field by itself.
CASES = {
    "gnome-text-editor": dict(
        label="gnome-text-editor 46 (GTK4 GtkSourceView)", kind="gui",
        cmd=["gnome-text-editor", "--standalone", "--ignore-session"],
        window="text editor|gnome-text-editor|org.gnome.TextEditor", click=(0.5, 0.6)),
    "gtk4-textview": dict(
        label="synthetic GTK4 Gtk.TextView", kind="gui",
        cmd=[PY, GTK_FIELD, "4", "textview"], window="synthetic-gtk4-textview", click=None),
    "gtk4-entry": dict(
        label="synthetic GTK4 Gtk.Entry", kind="gui",
        cmd=[PY, GTK_FIELD, "4", "entry"], window="synthetic-gtk4-entry", click=None),
    "gedit": dict(
        label="gedit 46 (GTK3 GtkSourceView)", kind="gui",
        cmd=["gedit", "--standalone"], window="gedit", click=(0.5, 0.6)),
    "gtk3-textview": dict(
        label="synthetic GTK3 Gtk.TextView", kind="gui",
        cmd=[PY, GTK_FIELD, "3", "textview"], window="synthetic-gtk3-textview", click=None),
    "gtk3-entry": dict(
        label="synthetic GTK3 Gtk.Entry", kind="gui",
        cmd=[PY, GTK_FIELD, "3", "entry"], window="synthetic-gtk3-entry", click=None),
    "featherpad": dict(
        label="FeatherPad 1.4 (Qt 5.15 QPlainTextEdit)", kind="gui",
        cmd=["featherpad", "--standalone"], env={"QT_QPA_PLATFORM": "wayland"},
        window="featherpad", click=(0.5, 0.6)),
    "libreoffice-writer": dict(
        label="LibreOffice Writer 24.2 (gtk3 VCL plugin)", kind="gui",
        cmd=["soffice", "--writer", "--norestore", "--nologo", "--nofirststartwizard",
             "-env:UserInstallation=file://" + os.path.join(RUN, "lo-profile")],
        env={"SAL_USE_VCLPLUGIN": "gtk3"},
        window="libreoffice|soffice|writer", click=(0.5, 0.6), settle=3.0, paste_wait=0.8,
        start_timeout=90),
    "gnome-terminal": dict(
        label="gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt", kind="terminal",
        cmd=["/usr/bin/gnome-terminal.real", "--wait", "--", "bash", "--rcfile", RCFILE, "-i"],
        window="gnome-terminal|terminal", click=(0.5, 0.5)),
    "epiphany-textarea": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea>", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#ta"],
        window="epiphany|web|fields", click=(400, 120), settle=3.0, focus_wait=10.0, pre=EPI_PRE),
    "epiphany-input": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text>", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#in"],
        window="epiphany|web|fields", click=(400, 213), settle=3.0, focus_wait=10.0, pre=EPI_PRE),
    "epiphany-contenteditable": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#ce"],
        window="epiphany|web|fields", click=(400, 300), settle=3.0, focus_wait=10.0, pre=EPI_PRE),
}
for _f, _what in (("ta", "<textarea>"), ("in", "<input type=text>"), ("ce", "contenteditable div")):
    _name = {"ta": "textarea", "in": "input", "ce": "contenteditable"}[_f]
    CASES[f"chromium-{_name}"] = dict(
        label=f"Chrome for Testing 153 (Playwright) {_what}", kind="gui", cmd=chrome_cmd(_f),
        env={"CHROMIUM_FULL_AS_SHIPPED": "1"}, window="chrom|fields", click=None, settle=2.0,
        focus_wait=10.0)
    CASES[f"electron-{_name}"] = dict(
        label=f"Electron 45 minimal app {_what}", kind="gui", cmd=electron_cmd(),
        env={"FIELD_LADDER_FIELD": _f}, window="electron|fields", click=None, settle=2.0,
        focus_wait=10.0)

# What a config changes before or at launch.  "plain" changes nothing.
#   status: set org.a11y.Status IsEnabled=true on the session bus before launch
#   args / env: added to the app's command line / environment
FRA = "--force-renderer-accessibility"
CONFIGS = {
    "plain": dict(),
    "status": dict(status=True),
    "force-renderer": dict(args=[FRA]),
    "status-force-renderer": dict(status=True, args=[FRA]),
    "a11y-api": dict(env={"FIELD_LADDER_ELECTRON_A11Y": "1"}),
    "status-a11y-api": dict(status=True, env={"FIELD_LADDER_ELECTRON_A11Y": "1"}),
    "xwayland": dict(xwayland=True),
    "screen-reader": dict(screen_reader=True),
    "status-screen-reader": dict(status=True, screen_reader=True),
    "qt-always-on": dict(env={"QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "qt-accessibility": dict(env={"QT_ACCESSIBILITY": "1"}),
    "qt-no-desktop-env": dict(env={"XDG_CURRENT_DESKTOP": ""}),
    "xwayland-qt-no-desktop-env": dict(xwayland=True, env={"XDG_CURRENT_DESKTOP": ""}),
    "qt-no-desktop-env-always-on": dict(env={"XDG_CURRENT_DESKTOP": "", "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "qt-no-desktop-env-screen-reader": dict(screen_reader=True, env={"XDG_CURRENT_DESKTOP": ""}),
    "qt-no-desktop-env-status": dict(status=True, env={"XDG_CURRENT_DESKTOP": ""}),
    "xwayland-qt-no-desktop-env-always-on": dict(xwayland=True, env={"XDG_CURRENT_DESKTOP": "", "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "force-renderer-a11y-api": dict(args=[FRA], env={"FIELD_LADDER_ELECTRON_A11Y": "1"}),
    "screen-reader-a11y-api": dict(screen_reader=True, env={"FIELD_LADDER_ELECTRON_A11Y": "1"}),
    "status-screen-reader-a11y-api": dict(status=True, screen_reader=True, env={"FIELD_LADDER_ELECTRON_A11Y": "1"}),
    "status-screen-reader-force-renderer": dict(status=True, screen_reader=True, args=[FRA]),
    "a11y-address-env": dict(address_env=True),
    "xwayland-root-property": dict(xwayland=True, root_property=True),
    "root-property": dict(root_property=True),
    "qt-debug": dict(env={"QT_LOGGING_RULES": "qt.accessibility*=true;qt.qpa.theme*=true"}),
    "qt-no-platformtheme": dict(env={"QT_QPA_PLATFORMTHEME": "none", "QT_LOGGING_RULES": "qt.accessibility*=true"}),
    "qt-no-platformtheme-always-on": dict(env={"QT_QPA_PLATFORMTHEME": "none", "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"}),
    "xwayland-qt-no-platformtheme": dict(xwayland=True, env={"QT_QPA_PLATFORMTHEME": "none"}),
}

log_lines = []
T0 = time.monotonic()


def log(msg):
    line = f"[{time.monotonic() - T0:7.3f}] {msg}"
    log_lines.append(line)
    print(line, file=sys.stderr, flush=True)


def sh(cmd, timeout=10, input_=None, env=None):
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, input=input_, env=env)
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError as e:
        return 127, "", str(e)


def pump(seconds=0.05):
    """Sleep while dispatching queued AT-SPI events."""
    ctx = GLib.MainContext.default()
    end = time.monotonic() + seconds
    while True:
        while ctx.pending():
            ctx.iteration(False)
        if time.monotonic() >= end:
            break
        time.sleep(0.005)


# ------------------------------------------------------------- the session
class Session:
    """Headless GNOME Shell on Wayland, as VOCO's CI starts it
    (scripts/test-gnome-portals.py): a stand-in system bus, a few settings,
    `gnome-shell --headless --virtual-monitor`, and keys through Mutter's
    RemoteDesktop API."""

    KEYS = {
        "a": 30, "b": 48, "c": 46, "d": 32, "e": 18, "f": 33, "g": 34, "h": 35, "i": 23, "j": 36,
        "k": 37, "l": 38, "m": 50, "n": 49, "o": 24, "p": 25, "q": 16, "r": 19, "s": 31, "t": 20,
        "u": 22, "v": 47, "w": 17, "x": 45, "y": 21, "z": 44,
        "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
        "space": 57, "minus": 12, "semicolon": 39, "apostrophe": 40, "comma": 51, "period": 52,
        "Home": 102, "End": 107, "Delete": 111, "BackSpace": 14, "Insert": 110, "Tab": 15,
        "Return": 28, "Left": 105, "Right": 106, "Escape": 1,
        "ctrl": 29, "shift": 42, "alt": 56, "super": 125,
    }
    CHARS = {" ": ("space", False), ":": ("semicolon", True), "(": ("9", True), ")": ("0", True),
             "#": ("3", True), ".": ("period", False), "'": ("apostrophe", False)}

    def __init__(self, result):
        self.result = result
        self.procs = []
        self.bus = None
        self.rd = None
        self.env = dict(os.environ)
        self.pointer = None
        self.x11 = {}

    def launch(self, name, cmd, env=None):
        out = open(os.path.join(RUN, name + ".log"), "wb")
        p = subprocess.Popen(cmd, env=env or self.env, stdout=out, stderr=subprocess.STDOUT,
                             start_new_session=True)
        self.procs.append(p)
        return p

    def start(self):
        runtime = os.environ["XDG_RUNTIME_DIR"]
        system_address = "unix:path=" + os.path.join(runtime, "system-test-bus")
        self.launch("system-bus", ["dbus-daemon", "--session", "--nofork", "--address=" + system_address])
        os.environ["DBUS_SYSTEM_BUS_ADDRESS"] = system_address
        ext = os.path.join(os.environ["XDG_DATA_HOME"], "gnome-shell", "extensions",
                           "field-ladder-probe@test.invalid")
        os.makedirs(os.path.dirname(ext), exist_ok=True)
        shutil.copytree(os.path.join(HERE, "probe"), ext)
        for schema, key_name, value in (
                ("org.gnome.shell", "enabled-extensions", "['field-ladder-probe@test.invalid']"),
                ("org.gnome.shell", "disable-user-extensions", "false"),
                ("org.gnome.shell", "welcome-dialog-last-shown-version", "'999'"),
                ("org.gnome.desktop.interface", "enable-animations", "false"),
                ("org.gnome.desktop.interface", "enable-hot-corners", "false"),
                ("org.gnome.desktop.session", "idle-delay", "uint32 0"),
                ("org.gnome.desktop.screensaver", "lock-enabled", "false")):
            rc, _o, err = sh(["gsettings", "set", schema, key_name, value], timeout=20)
            if rc:
                log(f"gsettings set {schema} {key_name}: {err.strip()}")
        session_env = {"XDG_SESSION_TYPE": "wayland", "XDG_CURRENT_DESKTOP": "ubuntu:GNOME",
                       "XDG_SESSION_DESKTOP": "ubuntu", "GNOME_SHELL_SESSION_MODE": "user",
                       "WAYLAND_DISPLAY": WAYLAND, "GDK_BACKEND": "wayland",
                       "DBUS_SYSTEM_BUS_ADDRESS": system_address}
        self.env.update(session_env)
        self.activation_environment(session_env)
        os.makedirs("/tmp/.X11-unix", mode=0o1777, exist_ok=True)
        os.chmod("/tmp/.X11-unix", 0o1777)
        shell = self.launch("shell", ["gnome-shell", "--headless", "--virtual-monitor",
                                      f"{MONITOR[0]}x{MONITOR[1]}", "--wayland",
                                      f"--wayland-display={WAYLAND}"])
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        deadline = time.monotonic() + 120
        while True:
            time.sleep(0.2)
            try:
                self.probe("Windows", reply="(s)")
                break
            except GLib.Error:
                pass
            if shell.poll() is not None:
                raise RuntimeError("the Shell exited while starting")
            if time.monotonic() > deadline:
                raise RuntimeError("the Shell did not start within 120 s")
        deadline = time.monotonic() + 60
        while self.probe("StartingUp", reply="(b)")[0] and time.monotonic() < deadline:
            time.sleep(0.2)
        self.probe("HideOverview")
        shell_log = os.path.join(RUN, "shell.log")
        display = authority = None
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            found = re.findall(r"Using public X11 display (:\d+)", open(shell_log, errors="replace").read())
            auth = sorted(f for f in os.listdir(runtime) if f.startswith(".mutter-Xwaylandauth."))
            if found and auth:
                display, authority = found[-1], os.path.join(runtime, auth[-1])
                break
            time.sleep(0.2)
        if not display:
            raise RuntimeError("the Shell offers no XWayland")
        self.x11 = {"DISPLAY": display, "XAUTHORITY": authority}
        self.env.update(self.x11)
        self.activation_environment(self.x11)
        self.result["session"] = dict(
            type="wayland: gnome-shell --headless --virtual-monitor, keys through Mutter's RemoteDesktop API",
            shell=sh(["gnome-shell", "--version"])[1].strip(), xwayland_display=display,
            started_after_s=round(time.monotonic() - T0, 2))
        # Keys: Mutter's RemoteDesktop session.  Mutter adds its keyboard at the
        # first key, which a client focused before then never receives; a lone
        # Shift tap gives the seat its keyboard before any client.
        self.rd = self.bus.call_sync(
            "org.gnome.Mutter.RemoteDesktop", "/org/gnome/Mutter/RemoteDesktop",
            "org.gnome.Mutter.RemoteDesktop", "CreateSession", None, GLib.VariantType("(o)"),
            Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
        self.rd_call("Start")
        self.key("shift")
        pump(0.3)
        # Relative motion stops at the monitor's edges: the bottom-right
        # corner is an exact origin (the top-left one opens the overview).
        self.rd_call("NotifyPointerMotionRelative", GLib.Variant("(dd)", (1e5, 1e5)))
        pump(0.2)
        self.pointer = tuple(self.probe("Pointer", reply="(ai)")[0])
        log(f"session up; pointer at {self.pointer}; overview visible: {self.probe('OverviewVisible', reply='(b)')[0]}")

    def activation_environment(self, values):
        self.bus = self.bus or Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                           "UpdateActivationEnvironment", GLib.Variant("(a{ss})", (values,)), None,
                           Gio.DBusCallFlags.NONE, 5000, None)

    def probe(self, method, params=None, reply=None):
        r = self.bus.call_sync("org.gnome.Shell", "/org/fieldladder/Probe", "org.fieldladder.Probe",
                               method, params, GLib.VariantType(reply) if reply else None,
                               Gio.DBusCallFlags.NONE, 5000, None)
        return r.unpack() if r is not None else None

    def windows(self):
        return json.loads(self.probe("Windows", reply="(s)")[0])

    def rd_call(self, method, params=None):
        self.bus.call_sync("org.gnome.Mutter.RemoteDesktop", self.rd,
                           "org.gnome.Mutter.RemoteDesktop.Session", method, params, None,
                           Gio.DBusCallFlags.NONE, 3000, None)

    def key_event(self, code, pressed):
        self.rd_call("NotifyKeyboardKeycode", GLib.Variant("(ub)", (code, pressed)))

    def key(self, *chords, gap=0.012):
        """key("ctrl+a", "Delete"): each chord pressed in order, released in
        reverse, every event on its own."""
        for chord in chords:
            codes = [self.KEYS[name] for name in chord.split("+")]
            for code in codes:
                self.key_event(code, True)
                time.sleep(gap)
            for code in reversed(codes):
                self.key_event(code, False)
                time.sleep(gap)

    def type(self, text):
        for ch in text:
            if ch in self.CHARS:
                name, shift = self.CHARS[ch]
            elif ch.isupper():
                name, shift = ch.lower(), True
            else:
                name, shift = ch, False
            self.key(("shift+" if shift else "") + name, gap=0.008)
        pump(0.15)

    def move(self, x, y):
        for _ in range(6):
            cur = tuple(self.probe("Pointer", reply="(ai)")[0])
            if cur == (x, y):
                break
            self.rd_call("NotifyPointerMotionRelative", GLib.Variant("(dd)", (float(x - cur[0]), float(y - cur[1]))))
            pump(0.08)
        self.pointer = tuple(self.probe("Pointer", reply="(ai)")[0])
        return self.pointer

    def click(self, x, y):
        at = self.move(x, y)
        for pressed in (True, False):
            self.rd_call("NotifyPointerButton", GLib.Variant("(ib)", (0x110, pressed)))
            time.sleep(0.03)
        return at

    def screenshot(self, name):
        path = os.path.join(RUN, name)
        try:
            self.probe("Screenshot", GLib.Variant("(s)", (path,)))
        except GLib.Error as e:
            return f"failed: {e.message}"
        return path

    def stop(self):
        for p in reversed(self.procs):
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 5
        for p in self.procs:
            try:
                p.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


S = None  # the Session


# ---------------------------------------------------- clipboard, VOCO's way
_holders = []


def read_selection(selection):
    rc, out, _err = sh(["xclip", "-o", "-selection", selection], timeout=3, env=S.env)
    return out if rc == 0 else None


def copy_x(text, selections):
    """Foreground xclip through XWayland, one helper per selection."""
    old = list(_holders)
    _holders.clear()
    for selection in selections:
        p = subprocess.Popen(["xclip", "-selection", selection, "-quiet"], env=S.env,
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        p.stdin.write(text.encode())
        p.stdin.close()
        _holders.append(p)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if all(read_selection(s) == text for s in selections):
            break
        time.sleep(0.02)
    for p in old:
        try:
            p.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            p.terminate()
    # The helpers own the X selections; Mutter passes each on to Wayland
    # clients a moment later.
    pump(0.12)


def copy_voco(text):
    """VOCO's copy on GNOME Wayland: xclip, PRIMARY first, then CLIPBOARD."""
    copy_x(text, ("primary", "clipboard"))


def shift_insert():
    for code, pressed in ((42, True), (110, True), (110, False), (42, False)):
        S.key_event(code, pressed)
        time.sleep(0.012)


def paste_voco(text, wait):
    copy_voco(text)
    shift_insert()
    pump(wait)


def drop_clipboard():
    for p in _holders:
        if p.poll() is None:
            p.terminate()
    _holders.clear()


# ------------------------------------------------------------ a11y status
def a11y_bus_running():
    reply = S.bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                            "NameHasOwner", GLib.Variant("(s)", ("org.a11y.Bus",)), None,
                            Gio.DBusCallFlags.NONE, 3000, None)
    return reply.unpack()[0]


def a11y_status():
    out = {}
    try:
        if not a11y_bus_running():
            return dict(bus="not running")
        for prop in ("IsEnabled", "ScreenReaderEnabled"):
            value = S.bus.call_sync(
                "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties", "Get",
                GLib.Variant("(ss)", ("org.a11y.Status", prop)), None,
                Gio.DBusCallFlags.NONE, 3000, None)
            out[prop] = value.unpack()[0]
    except GLib.Error as e:
        out["error"] = e.message
    return out


def set_a11y_status(prop, value):
    S.bus.call_sync(
        "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties", "Set",
        GLib.Variant("(ssv)", ("org.a11y.Status", prop, GLib.Variant("b", value))), None,
        Gio.DBusCallFlags.NONE, 3000, None)


# ------------------------------------------------------------ AT-SPI side
focus_events = []
_listener = None


def _on_event(event):
    try:
        if event.type.startswith("object:state-changed:focused") and event.detail1 != 1:
            return
        focus_events.append(dict(t=time.monotonic() - T0, type=event.type, source=event.source))
    except Exception as e:  # noqa: BLE001
        log(f"event callback error: {e}")


def atspi_connect():
    global _listener
    rc = Atspi.init()
    _listener = Atspi.EventListener.new(_on_event)
    _listener.register("object:state-changed:focused")
    _listener.register("focus:")
    pump(0.1)
    return rc


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


def has_iface(obj, name):
    try:
        return name in obj.get_interfaces()
    except GLib.Error:
        return False


def role_of(obj):
    try:
        return obj.get_role()
    except GLib.Error:
        return None


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


def is_target(obj):
    """A field the ladder may work on: focused, with Text, and editable or a
    terminal."""
    if obj is None or not has_iface(obj, "Text"):
        return False
    try:
        states = obj.get_state_set()
    except GLib.Error:
        return False
    if not states.contains(Atspi.StateType.FOCUSED):
        return False
    return states.contains(Atspi.StateType.EDITABLE) or role_of(obj) == Atspi.Role.TERMINAL


def walk_for_focused(stats):
    """Tree walk for STATE_FOCUSED, active windows first; focused+editable+Text
    wins at once, a focused terminal with Text is the fallback of its window."""
    stats["nodes"] = 0
    stats["focused_seen"] = []
    windows = []
    for app in kids(Atspi.get_desktop(0)):
        for win in kids(app):
            windows.append(win)
    ordered = [w for w in windows if has_state(w, Atspi.StateType.ACTIVE)]
    stats["windows"], stats["active_windows"] = len(windows), len(ordered)
    ordered += [w for w in windows if w not in ordered]
    for win in ordered:
        fallback = None
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
                stats["focused_seen"].append(f"{safe(node.get_role_name)} ({safe(lambda: node.get_application().get_name())})")
                if has_iface(node, "Text"):
                    if states.contains(Atspi.StateType.EDITABLE):
                        return node
                    if role_of(node) == Atspi.Role.TERMINAL and fallback is None:
                        fallback = node
            stack.extend(reversed(list(kids(node))))
        if fallback is not None:
            return fallback
    return None


def describe(obj):
    if obj is None:
        return None
    app = safe(obj.get_application)
    return dict(
        role=safe(obj.get_role_name), name=safe(obj.get_name),
        interfaces=safe(lambda: list(obj.get_interfaces()), []),
        states=safe(lambda: [s.value_nick for s in obj.get_state_set().get_states()], []),
        app=safe(app.get_name) if hasattr(app, "get_name") else None,
        toolkit=safe(app.get_toolkit_name) if hasattr(app, "get_toolkit_name") else None,
        toolkit_version=safe(app.get_toolkit_version) if hasattr(app, "get_toolkit_version") else None)


def desktop_apps():
    out = []
    for app in kids(Atspi.get_desktop(0)):
        out.append(dict(name=safe(app.get_name), toolkit=safe(app.get_toolkit_name),
                        windows=safe(app.get_child_count)))
    return out


def tree_outline(max_nodes=120, max_depth=12):
    """The AT-SPI tree of every app but the Shell, for runs where no field is found."""
    lines = []

    def walk(node, depth):
        if len(lines) >= max_nodes or depth > max_depth:
            return
        states = safe(lambda: [s.value_nick for s in node.get_state_set().get_states()], [])
        flags = [f for f in ("active", "focused", "editable", "showing") if f in states]
        lines.append("  " * depth + f"{safe(node.get_role_name)} {str(safe(node.get_name))[:40]!r}"
                     + (f" [{','.join(flags)}]" if flags else "")
                     + (" <Text>" if has_iface(node, "Text") else ""))
        for child in kids(node):
            walk(child, depth + 1)

    for app in kids(Atspi.get_desktop(0)):
        if safe(app.get_name) != "gnome-shell":
            walk(app, 0)
    return lines


def read_text(obj):
    out = {}
    try:
        n = Atspi.Text.get_character_count(obj)
        out["text"] = Atspi.Text.get_text(obj, 0, n)
        out["caret"] = Atspi.Text.get_caret_offset(obj)
    except GLib.Error as e:
        out["error"] = e.message or "empty message"
    return out


def fold(text):
    """Rich-text fields store a space at a paste's edge as U+00A0."""
    return text.replace(" ", " ") if isinstance(text, str) else text


def window_state(obj):
    """The object's top-level accessible (the child of its application) and
    whether it has STATE_ACTIVE."""
    node, top = obj, None
    for _ in range(60):
        try:
            parent = node.get_parent()
        except GLib.Error:
            break
        if parent is None or role_of(parent) in (Atspi.Role.APPLICATION, Atspi.Role.DESKTOP_FRAME):
            top = node
            break
        node = parent
    if top is None:
        return dict(found=False)
    return dict(found=True, role=safe(top.get_role_name), active=has_state(top, Atspi.StateType.ACTIVE))


# =============================================================== THE LADDER
def find_target(wait_s):
    """Step 0. The last focus event's object if it is still a target, else a
    tree walk; polled for up to wait_s, since some apps build their tree only
    once a client asks."""
    info = dict(focus_events=len(focus_events))
    deadline = time.monotonic() + wait_s
    t = time.monotonic()
    while True:
        pump(0.05)
        info["focus_events"] = len(focus_events)
        if focus_events:
            cand = focus_events[-1]["source"]
            if is_target(cand):
                info.update(found_by="focus event", after_s=round(time.monotonic() - t, 2))
                return cand, info
        stats = {}
        obj = walk_for_focused(stats)
        info["walk"] = stats
        if obj is not None:
            info.update(found_by="tree walk", after_s=round(time.monotonic() - t, 2))
            return obj, info
        if time.monotonic() >= deadline:
            info.update(found_by=None, after_s=round(time.monotonic() - t, 2))
            return None, info


def verified(obj, before_tail, timeout=1.5):
    """Re-read until the text before the caret ends with before_tail."""
    deadline = time.monotonic() + timeout
    while True:
        pump(0.05)
        r = read_text(obj)
        ok = (isinstance(r.get("text"), str) and isinstance(r.get("caret"), int) and r["caret"] >= 0
              and fold(r["text"][:r["caret"]]).endswith(before_tail))
        if ok or time.monotonic() >= deadline:
            return ok, r


def correct(pasted, wrong_offset, wrong, right, paste_wait=0.45, find_wait=1.5, guard=None):
    """The ladder.  Returns outcome CHANGED-VERIFIED / REFUSED / FAILED-DETECTED
    with the rung or reason, and what each step saw."""
    out = dict(outcome=None, rung=None, reason=None, steps=[])
    t_start = time.perf_counter()

    def done(outcome, rung=None, reason=None):
        out.update(outcome=outcome, rung=rung, reason=reason,
                   ms=round((time.perf_counter() - t_start) * 1000, 1))
        return out

    corrected = pasted[:wrong_offset] + right + pasted[wrong_offset + len(wrong):]
    tail_len = len(pasted) - wrong_offset

    # 0. the focused editable or terminal object
    obj, info = find_target(find_wait)
    out["find"] = info
    out["object"] = describe(obj)
    if obj is None:
        return done("REFUSED", reason="unreadable: no focused editable or terminal object")
    is_terminal = role_of(obj) == Atspi.Role.TERMINAL
    # Recorded only, not part of the ladder: is the object's top-level window ACTIVE?
    out["target_window"] = window_state(obj)
    if guard == "window-active" and not out["target_window"].get("active"):
        # A variant, not the ladder as specified (configs ending in +guard).
        return done("REFUSED", reason="not the active window: the field's top-level window is not ACTIVE")

    # 1. CHECK
    r = read_text(obj)
    out["check_read"] = r
    text, caret = r.get("text"), r.get("caret")
    if not isinstance(text, str) or not isinstance(caret, int) or caret < 0 or caret > len(text):
        return done("REFUSED", reason="unreadable: no text or caret from the focused object")
    before, after = fold(text[:caret]), text[caret:]
    out["nbsp_in_text"] = text.count(" ")
    out["text_after_caret"] = after[:200]
    line_after = after.split("\n", 1)[0]
    rung4_allowed = line_after.strip() == ""
    out["rung4_allowed"] = rung4_allowed
    if not before.endswith(pasted):
        return done("REFUSED", reason="moved or changed: the text before the caret does not end with what was pasted")
    base = caret - len(pasted)
    ws, we = base + wrong_offset, base + wrong_offset + len(wrong)
    end_target = base + len(corrected)

    def finish(rung, step):
        """Common end of a rung: caret to the end of the corrected text if it
        is not there, then the verifying re-read."""
        pump(0.05)
        now = read_text(obj)
        step["caret_after_edit"] = now.get("caret")
        if now.get("caret") != end_target:
            try:
                step["set_caret_offset"] = Atspi.Text.set_caret_offset(obj, end_target)
            except GLib.Error as e:
                step["set_caret_offset_error"] = e.message or "empty message"
        ok, reread = verified(obj, corrected)
        step["reread"] = reread
        step["verified"] = ok
        # Stricter than the ladder's own rule, recorded only: the whole text.
        step["whole_text_as_expected"] = (
            isinstance(reread.get("text"), str)
            and fold(reread["text"]) == fold(text[:ws] + right + text[we:]))
        out["steps"].append(step)
        if ok:
            return done("CHANGED-VERIFIED", rung=rung)
        return done("FAILED-DETECTED", rung=rung, reason="the verifying re-read did not match")

    # 2. EditableText
    if has_iface(obj, "EditableText"):
        step = dict(rung=2, method="EditableText.delete_text + insert_text")
        try:
            step["delete_returned"] = Atspi.EditableText.delete_text(obj, ws, we)
            pump(0.02)
            step["insert_returned"] = Atspi.EditableText.insert_text(obj, ws, right, len(right.encode()))
        except GLib.Error as e:
            step["error"] = e.message or "empty message"
        pump(0.05)
        now = read_text(obj)
        if now.get("text") == text and now.get("caret") == caret:
            # Nothing changed at all: the interface is there but does nothing.
            step["no_effect"] = True
            out["steps"].append(step)
        else:
            return finish(2, step)

    # 3. select the word, paste over it
    if not is_terminal:
        step = dict(rung=3, method="Text selection + paste")
        copy_voco(right)  # before the selection: the app then owns PRIMARY, and CLIPBOARD is pasted
        selected = False
        try:
            n = Atspi.Text.get_n_selections(obj)
            step["selections_before"] = n
            if n > 0:
                step["call"] = "set_selection"
                step["returned"] = Atspi.Text.set_selection(obj, 0, ws, we)
            else:
                step["call"] = "add_selection"
                try:
                    step["returned"] = Atspi.Text.add_selection(obj, ws, we)
                except GLib.Error as e:
                    step["add_selection_error"] = e.message or "empty message"
                    step["call"] = "set_selection"
                    step["returned"] = Atspi.Text.set_selection(obj, 0, ws, we)
            pump(0.05)
            sel = Atspi.Text.get_selection(obj, 0)
            step["selection_read_back"] = [sel.start_offset, sel.end_offset]
            selected = step["selection_read_back"] == [ws, we]
        except GLib.Error as e:
            step["error"] = e.message or "empty message"
        if selected:
            shift_insert()
            pump(paste_wait)
            return finish(3, step)
        step["selection_failed"] = True
        out["steps"].append(step)
        if not rung4_allowed:
            return done("REFUSED", reason="the selection failed or did not read back, and text follows the caret")
        # The failed attempt may have moved the caret: CHECK again before keys.
        again = read_text(obj)
        if again.get("text") != text or again.get("caret") != caret:
            try:
                Atspi.Text.set_caret_offset(obj, caret)
            except GLib.Error:
                pass
            pump(0.05)
            again = read_text(obj)
            if again.get("text") != text or again.get("caret") != caret:
                return done("REFUSED", reason="the selection attempt moved the caret and it could not be put back")

    # 4. BackSpace and paste the corrected tail
    if not rung4_allowed:
        return done("REFUSED", reason="text follows the caret on its line; BackSpace and paste would not be safe")
    step = dict(rung=4, method=f"{tail_len} BackSpace + paste", backspaces=tail_len)
    copy_voco(corrected[wrong_offset:])  # before the keys, so nothing can come between them
    for _ in range(tail_len):
        S.key("BackSpace", gap=0.006)
    pump(0.15)
    shift_insert()
    pump(paste_wait)
    return finish(4, step)


# ============================================================ the harness
SENTINEL = "FIELD-LADDER-NOTHING-COPIED"


def norm(text):
    """A trailing newline some apps add to a copy; no-break spaces as spaces."""
    return fold(text).rstrip("\n") if isinstance(text, str) else text


def independent_gui(wait=0.3):
    """Without AT-SPI: Ctrl+Shift+Home, Ctrl+C is the text before the caret;
    Ctrl+A, Ctrl+C is all of it; read with xclip through XWayland. A marker is
    copied first each time (Mutter's clipboard manager keeps CLIPBOARD's text
    when its owner goes, so the clipboard is never empty): reading the marker
    back means the app copied nothing. Then one "#" is typed and the field
    copied again: where the first copy gave nothing, "#" alone shows an empty,
    working field."""
    out = dict(method="ctrl+shift+Home ctrl+c, then ctrl+a ctrl+c, read with xclip -o through XWayland")

    def copied(*keys):
        copy_x(SENTINEL, ("clipboard",))
        for k in keys:
            S.key(k)
            pump(wait)
        got = read_selection("clipboard")
        return None if got == SENTINEL else got

    out["before_caret"] = copied("ctrl+shift+Home", "ctrl+c")
    out["full"] = copied("ctrl+a", "ctrl+c")
    if out["full"] is None:
        S.key("End")
        S.type("#")
        out["full_after_typing_marker"] = copied("ctrl+a", "ctrl+c")
        if norm(out["full_after_typing_marker"]) == "#":
            out["full"] = ""
            out["empty_shown_by"] = "typed # and copied it back alone"
    return out


def independent_terminal():
    """Without AT-SPI: bash's own READLINE_LINE and READLINE_POINT, written by
    a bind -x key (Ctrl+X Ctrl+P) from terminal.bashrc."""
    try:
        os.unlink(DUMP)
    except FileNotFoundError:
        pass
    S.key("ctrl+x", "ctrl+p")
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if os.path.exists(DUMP):
            raw = open(DUMP, encoding="utf-8", errors="replace").read()
            point, _, line = raw.partition("\n")
            return dict(full=line, point=int(point) if point.isdigit() else None,
                        before_caret=line[:int(point)] if point.isdigit() else None,
                        method="bash bind -x: READLINE_LINE / READLINE_POINT")
        pump(0.05)
    return dict(full=None, before_caret=None, point=None,
                method="bash bind -x: READLINE_LINE / READLINE_POINT", error="no dump written")


def classify(scenario, ladder, ind, other):
    """The run's class from the independent read alone, then how the ladder's
    own outcome compares."""
    setup_full, _setup_before, corrected_full = intended(scenario)
    full = norm(ind.get("full"))
    seen = ladder.get("check_read", {}).get("text")
    seen = norm(seen) if isinstance(seen, str) else None
    c = dict(intended_setup=setup_full, intended_corrected=corrected_full, independent_full=full)
    took_action = ladder.get("outcome") != "REFUSED" or bool(ladder.get("steps"))
    if full is None:
        c["class"] = "UNVERIFIED"
        c["why"] = "the independent read gave nothing"
    elif corrected_full is not None and full == corrected_full:
        c["class"] = "correct"
    elif full == setup_full:
        c["class"] = "untouched"
    elif not took_action or (seen is not None and seen != setup_full and full == seen):
        # The setup itself left other text than intended (an app's own
        # behaviour, a lost key).  The ladder sent nothing and called nothing
        # that edits, or the field still holds exactly what the ladder read
        # before it acted.  Counted apart, never as correct or untouched.
        c["class"] = "SETUP-DIFFERED"
        c["setup_differs_from_intended"] = True
    else:
        c["class"] = "DAMAGED"
    if other is not None:
        c["other_field_full"] = norm(other.get("full"))
        if c["other_field_full"] not in ("", None):
            c["class"] = "DAMAGED"
            c["why"] = "the other field is not empty"
        elif c["other_field_full"] is None:
            c["other_field_unverified"] = True
    if c["class"] == "correct":
        c["caret_at_end_of_corrected"] = (
            isinstance(ind.get("before_caret"), str)
            and norm(ind["before_caret"]).endswith(CORRECTED))
    outcome = ladder.get("outcome")
    c["ladder_agrees"] = ((outcome == "CHANGED-VERIFIED" and c["class"] == "correct")
                          or (outcome == "REFUSED" and c["class"] in ("untouched", "SETUP-DIFFERED"))
                          or (outcome == "FAILED-DETECTED" and c["class"] not in ("correct", "UNVERIFIED")))
    c["damaged_but_reported_verified"] = outcome == "CHANGED-VERIFIED" and c["class"] == "DAMAGED"
    return c


def launch_app(case, config, result):
    env = dict(S.env)
    env["GSK_RENDERER"] = "cairo"  # software rendering only; no GPU here
    env.update(case.get("env", {}))
    env.update(config.get("env", {}))
    env["FIELD_LADDER_DUMP"] = DUMP
    cmd = list(case["cmd"])
    if config.get("xwayland"):
        env.pop("WAYLAND_DISPLAY", None)
        env["GDK_BACKEND"] = "x11"
        env["QT_QPA_PLATFORM"] = "xcb"
        cmd = [c for c in cmd if c != "--ozone-platform=wayland"]
    extra = config.get("args", [])
    if extra:
        cmd = cmd[:1] + extra + cmd[1:]
    result["launch"] = dict(cmd=cmd, env_added={**case.get("env", {}), **config.get("env", {})})
    if config.get("address_env") or config.get("root_property"):
        address = S.bus.call_sync("org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress", None,
                                  None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
        if config.get("address_env"):
            # The accessibility bus's address in the app's environment.
            env["AT_SPI_BUS_ADDRESS"] = address
            result["launch"]["env_added"]["AT_SPI_BUS_ADDRESS"] = "(the address org.a11y.Bus.GetAddress returns)"
        else:
            # What at-spi-bus-launcher sets on an X11 root window when it starts with a display.
            rc, _o, err = sh(["xprop", "-root", "-f", "AT_SPI_BUS", "8s", "-set", "AT_SPI_BUS", address], env=S.env)
            result["launch"]["root_property_set"] = rc == 0 or err.strip()
    if not os.path.exists(cmd[0]) and sh(["which", cmd[0]])[0] != 0:
        result["launch"]["error"] = f"{cmd[0]} is not installed"
        return None
    for pre in case.get("pre", []):
        rc, _out, err = sh(pre, timeout=15, env=env)
        result["launch"].setdefault("pre", []).append(dict(cmd=pre, rc=rc, err=err.strip()[:200]))
    return S.launch("app", cmd, env=env)


def wait_for_window(pattern, timeout, result_key, result):
    """A focused window whose title or class matches; activated through the
    probe if it shows up without focus."""
    rx = re.compile(pattern, re.I)
    deadline = time.monotonic() + timeout
    seen_unfocused_since = None
    while time.monotonic() < deadline:
        pump(0.15)
        for w in S.windows():
            if rx.search(f"{w.get('title') or ''} {w.get('wmClass') or ''}") and w["width"] > 50:
                if w["focused"]:
                    result[result_key] = dict(w, after_s=round(time.monotonic() - T0, 2))
                    return w
                if seen_unfocused_since is None:
                    seen_unfocused_since = time.monotonic()
                elif time.monotonic() - seen_unfocused_since > 2.0:
                    S.probe("ActivateWindow", GLib.Variant("(s)", (w.get("title") or "",)), reply="(b)")
                    result.setdefault("activated_by_probe", []).append(w.get("title"))
                    seen_unfocused_since = time.monotonic()
    result[result_key + "_error"] = dict(error="no focused window of the app within the timeout",
                                         windows=S.windows())
    return None


def run(case_name, scenario, config_name):
    global S
    case = CASES[case_name]
    # "<config>+guard" runs the variant that refuses unless the field's window is ACTIVE.
    guard = "window-active" if config_name.endswith("+guard") else None
    config = CONFIGS[config_name.removesuffix("+guard")]
    paste_wait = case.get("paste_wait", 0.45)
    terminal = case["kind"] == "terminal"
    result = dict(case=case_name, label=case["label"], kind=case["kind"], scenario=scenario,
                  config=config_name, config_detail=dict(config), pasted=PASTED, corrected=CORRECTED,
                  copy="xclip through XWayland, PRIMARY then CLIPBOARD (VOCO's copy on GNOME Wayland)")
    S = Session(result)
    app = other = None
    try:
        S.start()
        env_info = result["environment"] = dict(
            python=sys.version.split()[0],
            gsettings_toolkit_accessibility=sh(["gsettings", "get", "org.gnome.desktop.interface", "toolkit-accessibility"])[1].strip(),
            a11y_bus_running_after_shell_start=a11y_bus_running(),
            a11y_status_after_shell_start=a11y_status())
        if config.get("status"):
            set_a11y_status("IsEnabled", True)
        if config.get("screen_reader"):
            set_a11y_status("ScreenReaderEnabled", True)
        if config.get("status") or config.get("screen_reader"):
            env_info["a11y_status_after_set"] = a11y_status()
        # The AT-SPI client connects before the app starts, as a tray app
        # started at login would, and registers its focus listener then.
        atspi_connect()
        env_info["a11y_status_at_app_start"] = a11y_status()

        app = launch_app(case, config, result)
        if app is None:
            return result
        win = wait_for_window(case["window"], case.get("start_timeout", 60), "window", result)
        if win is None:
            result["screenshot"] = S.screenshot("no-window.png")
            return result
        result["client_type"] = win["client"]
        pump(case.get("settle", 1.0))
        if case.get("click"):
            win = next((w for w in S.windows() if w["pid"] == win["pid"] and w["focused"]), win)
            x, y = case["click"]
            if x < 1 and y < 1:
                x, y = int(win["width"] * x), int(win["height"] * y)
            at = S.click(win["x"] + x, win["y"] + y)
            result["launch"]["click"] = dict(in_window=[x, y], pointer=list(at), window=[win["x"], win["y"], win["width"], win["height"]])
            pump(0.4)
        pump(0.3)

        # ---- setup: what happened before the correction was asked for
        if scenario == "prefilled":
            S.type(PREFILL)
        if scenario == "text-after":
            S.type(AFTER)
            # Ctrl+Home in GUI fields: plain Home is "smart" in some editors
            # (GtkSourceView, FeatherPad) and stops after the leading space.
            S.key("Home" if terminal else "ctrl+Home")
            pump(0.2)
        for chunk in CHUNKS:
            paste_voco(chunk, paste_wait)
        log("pasted three chunks")
        if scenario == "home":
            S.key("Home")
        elif scenario == "typed-after":
            S.type(TYPED)
        elif scenario == "cleared":
            if terminal:
                S.key("ctrl+u")
            else:
                S.key("ctrl+a")
                pump(0.15)
                S.key("Delete")
        elif scenario == "other-field":
            other = S.launch("other", [PY, GTK_FIELD, "4", "entry", OTHER_TITLE],
                             env={**S.env, "GSK_RENDERER": "cairo"})
            if wait_for_window("^" + OTHER_TITLE, 30, "other_window", result) is None:
                result["setup_error"] = "the other field's window did not take focus"
        elif scenario == "other-unreadable":
            other = S.launch("other", ["featherpad", "--standalone"],
                             env={**S.env, "QT_QPA_PLATFORM": "wayland"})
            ow = wait_for_window("featherpad", 30, "other_window", result)
            if ow is None:
                result["setup_error"] = "the other window did not take focus"
            else:
                pump(1.0)
                S.click(ow["x"] + ow["width"] // 2, ow["y"] + int(ow["height"] * 0.6))
        pump(0.4)
        result["windows_before_ladder"] = S.windows()
        if terminal and scenario not in OTHER_SCENARIOS:
            result["independent_before"] = independent_terminal()

        # ---- the ladder
        ladder = correct(PASTED, WRONG_OFFSET, WRONG, RIGHT, paste_wait=paste_wait, guard=guard,
                         find_wait=case.get("focus_wait", 4.0) if scenario not in OTHER_SCENARIOS else 4.0)
        result["ladder"] = ladder
        log(f"ladder: {ladder['outcome']} rung={ladder['rung']} reason={ladder['reason']}")
        result["desktop_apps"] = desktop_apps()
        if ladder["outcome"] == "REFUSED" and (ladder["reason"] or "").startswith("unreadable"):
            result["tree_outline"] = tree_outline()
        result["a11y_status_after"] = a11y_status()
        if os.environ.get("FIELD_LADDER_DEBUG"):
            # Development aid only: a shell command run inside the session.
            result["debug"] = sh(["bash", "-c", os.environ["FIELD_LADDER_DEBUG"]], timeout=60, env=S.env)
        result["screenshot_after_ladder"] = S.screenshot("after-ladder.png")

        # ---- the independent read
        independent = independent_terminal if terminal else independent_gui
        other_read = None
        if scenario in OTHER_SCENARIOS:
            other_read = independent_gui()
            result["independent_other_field"] = other_read
            try:
                os.killpg(other.pid, signal.SIGTERM)
                other.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                pass
            back = wait_for_window(case["window"], 10, "window_after_other", result)
            if back is None:
                result["independent_error"] = "the field's own window did not take focus back"
            pump(0.5)
        ind = independent()
        result["independent_after"] = ind
        result["classification"] = classify(scenario, ladder, ind, other_read)
        log(f"independent: {ind.get('full')!r} -> {result['classification']['class']}")
        result["screenshot"] = S.screenshot("end.png")
        return result
    finally:
        drop_clipboard()
        try:
            result["app_log_tail"] = open(os.path.join(RUN, "app.log"), "rb").read()[-1500:].decode("utf-8", "replace")
        except OSError:
            pass
        S.stop()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case", nargs="?")
    ap.add_argument("scenario", nargs="?", default="plain")
    ap.add_argument("--config", default="plain")
    ap.add_argument("--rep", default="1")
    ap.add_argument("--out")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list or not args.case:
        print("cases:    ", " ".join(CASES))
        print("scenarios:", " ".join(SCENARIOS))
        print("configs:  ", " ".join(CONFIGS))
        return 0
    out = args.out or os.path.join(HERE, "results", f"{args.case}.{args.scenario}.{args.config}.r{args.rep}.json")
    try:
        result = run(args.case, args.scenario, args.config)
    except Exception as e:  # noqa: BLE001
        result = dict(case=args.case, scenario=args.scenario, config=args.config,
                      harness_error=f"{type(e).__name__}: {e}", traceback=traceback.format_exc())
    result["rep"] = args.rep
    result["log"] = log_lines
    result["run_dir"] = RUN
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, ensure_ascii=False, default=str)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
