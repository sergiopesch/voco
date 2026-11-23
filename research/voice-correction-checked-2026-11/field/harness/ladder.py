#!/usr/bin/python3.12
"""Field ladder v2: one ordered "change what I just dictated" procedure,
measured in a headless GNOME Shell session on Wayland.

Run through run.sh, which gives each run its own namespaces, D-Bus session,
HOME and XDG_RUNTIME_DIR:

    ./run.sh <case> <scenario> [--config NAME] [--rep N]
    ./run.sh <case> plain --trial FILE.json [--config NAME] [--rep N]

One run = one field, one scenario or trial, one fresh Shell session, one JSON
file. Only the made-up sentences below, or a trial file's text, are ever
pasted or typed.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
import unicodedata

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, Gio, GLib  # noqa: E402

HERE = os.environ.get("FIELD_LADDER_HERE", os.path.dirname(os.path.abspath(__file__)))
RUN = os.environ.get("FIELD_LADDER_RUN", "/nonexistent")
WAYLAND = "ladder"
MONITOR = (1280, 800)
# Every fixed wait is multiplied by this: above 1 on a machine too busy for
# an app to take a paste or a key in the usual time.
SLOW = float(os.environ.get("FIELD_LADDER_SLOW") or 1)

# ----------------------------------------------------------------- the text
# Each sentence is pasted in three parts that begin with their space, and the
# built-in request is always its last "peer" to "pier".
SENTENCES = {
    "plain": ["Let's meet at the", " peer on Thursday", " afternoon."],
    "twice": ["The peer said to meet", " at the peer on Thursday", " afternoon."],
    "non-ascii": ["Zo\u00eb's na\u00efve caf\u00e9 is at the", " peer on Thursday", " afternoon."],
}
WRONG, RIGHT = "peer", "pier"
PREFILL = "Notes: "
EMOJI_PREFILL = "Notes \U0001F642 caf\u00e9: "
FIRST_LINE = "First line."
AFTER = " (draft)"
TYPED = "ok"

SCENARIOS = ["plain", "home", "typed-after", "cleared", "other-field", "prefilled", "text-after",
             # Focus moves to a window AT-SPI does not expose here (FeatherPad
             # as a native Wayland client).
             "other-unreadable",
             "twice", "two-lines", "selected-all", "emoji-before", "non-ascii"]
OTHER_SCENARIOS = ("other-field", "other-unreadable")
# Something happened after the paste: the right end is a refusal and the
# field as the setup left it.
REFUSE_SCENARIOS = ("home", "typed-after", "cleared", "other-field", "other-unreadable", "selected-all")


def make_request(parts, start, end, replacement, rest=""):
    """The change asked for: the characters [start, end) of the pasted text
    become replacement.  rest is pasted at the caret after the ladder."""
    pasted = "".join(parts)
    if not (isinstance(start, int) and isinstance(end, int) and 0 <= start <= end <= len(pasted)):
        raise ValueError("the span is not inside the pasted text")
    if not all(isinstance(t, str) for t in (*parts, replacement, rest)) or not pasted:
        raise ValueError("parts, replacement and rest must be text, and parts not empty")
    return dict(parts=list(parts), pasted=pasted, start=start, end=end, replacement=replacement,
                corrected=pasted[:start] + replacement + pasted[end:], rest=rest)


def builtin_request(scenario):
    parts = SENTENCES.get(scenario, SENTENCES["plain"])
    start = "".join(parts).rindex(WRONG)
    return make_request(parts, start, start + len(WRONG), RIGHT)


assert builtin_request("plain")["pasted"] == "Let's meet at the peer on Thursday afternoon."
assert builtin_request("plain")["corrected"] == "Let's meet at the pier on Thursday afternoon."
assert builtin_request("twice")["corrected"] == "The peer said to meet at the pier on Thursday afternoon."
assert builtin_request("non-ascii")["corrected"] == "Zo\u00eb's na\u00efve caf\u00e9 is at the pier on Thursday afternoon."


def text_before(scenario):
    """What the field already holds before the paste."""
    return {"prefilled": PREFILL, "emoji-before": EMOJI_PREFILL,
            "two-lines": FIRST_LINE + "\n"}.get(scenario, "")


def intended(scenario, req, before=None):
    """(field text, text before the caret) the setup should leave, with rest
    pasted after it, and the field text a correct change would leave."""
    pasted, corrected, rest = req["pasted"], req["corrected"], req["rest"]
    before = text_before(scenario) if before is None else before
    if scenario == "home":
        return pasted, "", corrected
    if scenario == "typed-after":
        return pasted + TYPED, pasted + TYPED, corrected + TYPED
    if scenario == "cleared":
        return "", "", None
    if scenario == "text-after":
        return pasted + AFTER, pasted, corrected + AFTER
    # plain, other-field, other-unreadable, twice, selected-all, non-ascii,
    # and the three with text before the paste
    return before + pasted + rest, before + pasted + rest, before + corrected + rest


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
# single_line: the field holds one line, so `two-lines` does not apply.
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
        cmd=[PY, GTK_FIELD, "4", "entry"], window="synthetic-gtk4-entry", click=None, single_line=True),
    "gedit": dict(
        label="gedit 46 (GTK3 GtkSourceView)", kind="gui",
        cmd=["gedit", "--standalone"], window="gedit", click=(0.5, 0.6)),
    "gtk3-textview": dict(
        label="synthetic GTK3 Gtk.TextView", kind="gui",
        cmd=[PY, GTK_FIELD, "3", "textview"], window="synthetic-gtk3-textview", click=None),
    "gtk3-entry": dict(
        label="synthetic GTK3 Gtk.Entry", kind="gui",
        cmd=[PY, GTK_FIELD, "3", "entry"], window="synthetic-gtk3-entry", click=None, single_line=True),
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
        window="gnome-terminal|terminal", click=(0.5, 0.5), single_line=True),
    "epiphany-textarea": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea>", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#ta"],
        window="epiphany|web|fields", click=(400, 120), settle=3.0, focus_wait=10.0, pre=EPI_PRE),
    "epiphany-input": dict(
        label="Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text>", kind="gui",
        cmd=["epiphany-browser", "--private-instance", f"{FIELDS}#in"],
        window="epiphany|web|fields", click=(400, 213), settle=3.0, focus_wait=10.0, pre=EPI_PRE,
        single_line=True),
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
        focus_wait=10.0, single_line=_f == "in")
    CASES[f"electron-{_name}"] = dict(
        label=f"Electron 45 minimal app {_what}", kind="gui", cmd=electron_cmd(),
        env={"FIELD_LADDER_FIELD": _f}, window="electron|fields", click=None, settle=2.0,
        focus_wait=10.0, single_line=_f == "in")

# What a config changes before or at launch.  "plain" changes nothing.
#   status: set org.a11y.Status IsEnabled=true on the session bus before launch
#   args / env: added to the app's command line / environment
#   xwayland: run the app as an X11 client; root_property: the accessibility
#   bus's address on the X root window, where Qt 5 looks for it
CONFIGS = {
    "plain": dict(),
    "status-force-renderer": dict(status=True, args=["--force-renderer-accessibility"]),
    "status-a11y-api": dict(status=True, env={"FIELD_LADDER_ELECTRON_A11Y": "1"}),
    "xwayland-root-property": dict(xwayland=True, root_property=True),
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
    end = time.monotonic() + seconds * SLOW
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
        out["count"] = n
        out["text"] = Atspi.Text.get_text(obj, 0, n)
        out["caret"] = Atspi.Text.get_caret_offset(obj)
    except GLib.Error as e:
        out["error"] = e.message or "empty message"
    return out


def read_selections(obj):
    """Every selection the field reports, as [start, end] in its own unit."""
    out = dict(ranges=[])
    try:
        out["n"] = Atspi.Text.get_n_selections(obj)
        for i in range(min(out["n"], 16)):
            sel = Atspi.Text.get_selection(obj, i)
            out["ranges"].append([sel.start_offset, sel.end_offset])
    except GLib.Error as e:
        out["error"] = e.message or "empty message"
    return out


def selected(selections):
    return [r for r in selections.get("ranges", []) if r[0] != r[1]]


def fold(text):
    """Rich-text fields store a space at a paste's edge as U+00A0."""
    return text.replace("\u00a0", " ") if isinstance(text, str) else text


# What one character counts for in each unit a toolkit may give its offsets in.
UNITS = {
    "code points": lambda ch: 1,
    "UTF-16 code units": lambda ch: 2 if ord(ch) > 0xFFFF else 1,
    "UTF-8 bytes": lambda ch: len(ch.encode("utf-8", "surrogatepass")),
}


def to_unit(text, index, unit):
    """The offset, in unit, of the character at index in text."""
    return sum(UNITS[unit](ch) for ch in text[:index])


def from_unit(text, offset, unit):
    """The index in text an offset in unit points at, or None when it falls
    inside a character or outside the text."""
    at = 0
    for index, ch in enumerate(text):
        if at >= offset:
            break
        at += UNITS[unit](ch)
    else:
        index = len(text)
    return index if at == offset else None


def one_key_each(text):
    """Whether one BackSpace surely deletes one character of text, each: no
    combining mark, joiner or variation selector, nothing outside the Basic
    Multilingual Plane."""
    return all(ord(ch) <= 0xFFFF and unicodedata.category(ch)[0] not in "MC" for ch in text)


def locate(obj, text, caret, req):
    """Step 3 and the offsets every later step uses.  The interface says
    nowhere what its offsets count, so each unit is tried: the caret must fall
    on a character with the pasted text before it, and the pasted text and the
    span must read back through the interface at the offsets that unit gives.
    Units that give the same offsets are one answer; two answers, or none that
    reads back, is a refusal."""
    pasted, start, end = req["pasted"], req["start"], req["end"]
    out = dict(unit=None, tried={})
    answers = {}
    ends_with_pasted = False
    for unit in UNITS:
        tried = out["tried"][unit] = dict(count=to_unit(text, len(text), unit))
        c = from_unit(text, caret, unit)
        tried["caret_index"] = c
        if c is None or not fold(text[:c]).endswith(pasted):
            continue
        ends_with_pasted = True
        base = c - len(pasted)
        offsets = [to_unit(text, i, unit) for i in (base, base + start, base + end, c)]
        tried["offsets"] = offsets
        try:
            read_pasted = Atspi.Text.get_text(obj, offsets[0], offsets[3])
            read_span = Atspi.Text.get_text(obj, offsets[1], offsets[2])
        except GLib.Error as e:
            tried["error"] = e.message or "empty message"
            continue
        tried["reads_back"] = fold(read_pasted) == pasted and fold(read_span) == pasted[start:end]
        if tried["reads_back"]:
            answers.setdefault(tuple(offsets), []).append((unit, c))
    if not ends_with_pasted:
        out["reason"] = "moved or changed: the text before the caret does not end with what was pasted"
    elif len(answers) != 1:
        out["reason"] = ("offsets unsure: the pasted text does not read back at the offsets of any unit"
                         if not answers else "offsets unsure: two units read back with different offsets")
    else:
        (out["unit"], out["caret_index"]), = [found[0] for found in answers.values()]
        out["units_agreeing"] = [unit for found in answers.values() for unit, _c in found]
        # Whether the answer rests on the read-back: some character before
        # the pasted text's end counts differently from one unit to another.
        c = out["caret_index"]
        out["units_differ_here"] = len({to_unit(text, c, unit) for unit in UNITS}) > 1
    return out


def unit_after(obj, text, start, end, units):
    """Among units, the one whose offsets read text[start:end] back, or None
    when none does or two do with different offsets.  The changed text may
    tell apart units that gave the old text the same offsets.  The last
    character is read alone as well: a read past the text's end is cut off
    there, and would pass for the right one."""
    fits = {}
    for unit in units:
        offsets = [to_unit(text, i, unit) for i in (start, max(start, end - 1), end)]
        try:
            if (fold(Atspi.Text.get_text(obj, offsets[0], offsets[2])) == fold(text[start:end])
                    and fold(Atspi.Text.get_text(obj, offsets[1], offsets[2])) == fold(text[max(start, end - 1):end])):
                fits.setdefault(tuple(offsets), unit)
        except GLib.Error:
            pass
    return next(iter(fits.values())) if len(fits) == 1 else None


def put_caret(obj, text, index, unit, note):
    """Caret before text[index], read back; True when it stands there."""
    want = to_unit(text, index, unit)
    try:
        note["set_caret_offset"] = Atspi.Text.set_caret_offset(obj, want)
        pump(0.05)
        note["caret_read_back"] = Atspi.Text.get_caret_offset(obj)
    except GLib.Error as e:
        note["caret_error"] = e.message or "empty message"
    return note.get("caret_read_back") == want


def settle(obj, text, index, unit, note):
    """Nothing selected and the caret before text[index], as dictation needs
    them for its next paste; True when both read so.  LibreOffice's copy_text
    leaves its range selected, and removing a selection there sends the caret
    to the paragraph's start."""
    want = to_unit(text, index, unit)
    try:
        for i in reversed(range(Atspi.Text.get_n_selections(obj))):
            sel = Atspi.Text.get_selection(obj, i)
            if sel.start_offset != sel.end_offset:
                note.setdefault("selections_removed", []).append([sel.start_offset, sel.end_offset])
                Atspi.Text.remove_selection(obj, i)
        pump(0.05)
        if Atspi.Text.get_caret_offset(obj) != want:
            put_caret(obj, text, index, unit, note)
        sels = read_selections(obj)
        return "error" not in sels and not selected(sels) and Atspi.Text.get_caret_offset(obj) == want
    except GLib.Error as e:
        note["settle_error"] = e.message or "empty message"
        return False


def put_selection(obj, text, start, end, unit, note):
    """Selection over text[start:end]; True when three reads agree with what
    was asked: the selection's offsets, the text between them, and the caret
    at one of its ends.  Chromium's selection reads back one lower for each
    character outside the Basic Multilingual Plane before it, though the
    right text is selected: such a selection is not sure, and not used."""
    want = [to_unit(text, start, unit), to_unit(text, end, unit)]
    try:
        if Atspi.Text.get_n_selections(obj) > 0:
            note["call"] = "set_selection"
            note["returned"] = Atspi.Text.set_selection(obj, 0, *want)
        else:
            note["call"] = "add_selection"
            try:
                note["returned"] = Atspi.Text.add_selection(obj, *want)
            except GLib.Error as e:
                note["add_selection_error"] = e.message or "empty message"
                note["call"] = "set_selection"
                note["returned"] = Atspi.Text.set_selection(obj, 0, *want)
        pump(0.05)
        sel = Atspi.Text.get_selection(obj, 0)
        note["selection_read_back"] = [sel.start_offset, sel.end_offset]
        note["selected_text"] = Atspi.Text.get_text(obj, sel.start_offset, sel.end_offset)
        note["caret_with_selection"] = Atspi.Text.get_caret_offset(obj)
    except GLib.Error as e:
        note["error"] = e.message or "empty message"
    return (note.get("selection_read_back") == want and fold(note.get("selected_text")) == fold(text[start:end])
            and note.get("caret_with_selection") in want)


def insert_length(obj, text):
    """The length InsertText wants beside its text: bytes, as libatspi
    documents and ATK and GTK take it.  Qt resizes the text to it in its own
    UTF-16 code units, and a longer one pads the text with NUL."""
    toolkit = safe(lambda: obj.get_application().get_toolkit_name(), "")
    return to_unit(text, len(text), "UTF-16 code units" if toolkit == "Qt" else "UTF-8 bytes")


def editable_text_copies(obj, offsets, pasted, note):
    """EditableText has no read of its own, but its copy_text takes offsets
    as its edits do: the pasted text must come back on the clipboard.  The
    caller settles the field afterwards."""
    copy_x(SENTINEL, ("clipboard",))
    try:
        note["copy_text_returned"] = Atspi.EditableText.copy_text(obj, offsets[0], offsets[1])
    except GLib.Error as e:
        note["copy_text_error"] = e.message or "empty message"
        return False
    deadline = time.monotonic() + 2
    while True:
        pump(0.1)
        got = read_selection("clipboard")
        if got not in (None, SENTINEL) or time.monotonic() >= deadline:
            break
    note["copy_text_gave_pasted"] = got is not None and fold(got) == pasted
    return note["copy_text_gave_pasted"]


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


def verified(obj, expected, caret, timeout=3.0):
    """Re-read until the whole text is the expected one, a no-break space
    read as a space, the caret stands where asked and nothing is selected."""
    deadline = time.monotonic() + timeout
    while True:
        pump(0.05)
        r = read_text(obj)
        r["selections"] = read_selections(obj)
        ok = (isinstance(r.get("text"), str) and fold(r["text"]) == fold(expected) and r.get("caret") == caret
              and "error" not in r["selections"] and not selected(r["selections"]))
        if ok or time.monotonic() >= deadline:
            return ok, r


def correct(req, paste_wait=0.45, find_wait=1.5):
    """The ladder.  Returns outcome CHANGED-VERIFIED / REFUSED / FAILED-DETECTED
    with the rung or reason, and what each step saw."""
    out = dict(outcome=None, rung=None, reason=None, steps=[])
    t_start = time.perf_counter()

    def done(outcome, rung=None, reason=None):
        out.update(outcome=outcome, rung=rung, reason=reason,
                   ms=round((time.perf_counter() - t_start) * 1000, 1))
        return out

    pasted, start, end = req["pasted"], req["start"], req["end"]
    replacement, corrected = req["replacement"], req["corrected"]
    if corrected == pasted:
        return done("REFUSED", reason="nothing to change: the replacement is the span's own text")

    # 0. the focused editable or terminal object
    obj, info = find_target(find_wait)
    out["find"] = info
    out["object"] = describe(obj)
    if obj is None:
        return done("REFUSED", reason="unreadable: no focused editable or terminal object")
    is_terminal = role_of(obj) == Atspi.Role.TERMINAL

    # 1. its window is the active one
    out["target_window"] = window_state(obj)
    if not out["target_window"].get("active"):
        return done("REFUSED", reason="not the active window: the field's top-level window is not ACTIVE")

    # 2. nothing is selected
    out["selections"] = read_selections(obj)
    if "error" in out["selections"]:
        return done("REFUSED", reason="unreadable: the field's selections could not be read")
    if selected(out["selections"]):
        return done("REFUSED", reason="selection: the field has selected text")

    # 3. CHECK
    r = read_text(obj)
    out["check_read"] = r
    text, caret = r.get("text"), r.get("caret")
    if not isinstance(text, str) or not isinstance(caret, int) or caret < 0:
        return done("REFUSED", reason="unreadable: no text or caret from the focused object")
    out["nbsp_in_text"] = text.count("\u00a0")
    where = out["offsets"] = locate(obj, text, caret, req)
    unit = where["unit"]
    if unit is None:
        return done("REFUSED", reason=where["reason"])
    c = where["caret_index"]
    base = c - len(pasted)
    ws, we = base + start, base + end
    expected = text[:base] + corrected + text[c:]
    after = text[c:]
    out["text_after_caret"] = after[:200]

    def at(index):
        return to_unit(text, index, unit)

    def finish(rung, step):
        """Common end of a rung: once the text reads as changed, nothing
        selected and the caret at the end of the changed text, then the
        verifying re-read of the whole text."""
        deadline = time.monotonic() + 3
        while True:
            pump(0.05)
            now = read_text(obj)
            changed = isinstance(now.get("text"), str) and fold(now["text"]) == fold(expected)
            if changed or time.monotonic() >= deadline:
                break
        step["caret_after_edit"] = now.get("caret")
        end = base + len(corrected)
        unit_now = step["unit_after"] = unit_after(obj, expected, base, end, where["units_agreeing"]) if changed else None
        if unit_now:
            step["settled"] = settle(obj, expected, end, unit_now, step)
        ok, reread = verified(obj, expected, to_unit(expected, end, unit_now or unit))
        step["reread"] = reread
        step["verified"] = ok = ok and unit_now is not None
        out["steps"].append(step)
        if ok:
            return done("CHANGED-VERIFIED", rung=rung)
        return done("FAILED-DETECTED", rung=rung, reason="the verifying re-read did not match")

    # 4. EditableText
    if has_iface(obj, "EditableText"):
        step = dict(rung=2, method="EditableText.delete_text + insert_text")
        if where["units_differ_here"]:
            sure = editable_text_copies(obj, [at(base), at(c)], pasted, step)
            step["settled_after_copy"] = settle(obj, text, c, unit, step)
            if not step["settled_after_copy"] or read_text(obj).get("text") != text:
                out["steps"].append(step)
                return done("FAILED-DETECTED", rung=2, reason="the copy that proves EditableText's offsets "
                            "left a selection or moved the caret, and they could not be put back")
            if not sure:
                out["steps"].append(step)
                return done("REFUSED", reason="offsets unsure: EditableText did not copy the pasted text at its offsets")
        try:
            if we > ws:
                step["delete_returned"] = Atspi.EditableText.delete_text(obj, at(ws), at(we))
                pump(0.02)
            if replacement:
                step["insert_length"] = insert_length(obj, replacement)
                step["insert_returned"] = Atspi.EditableText.insert_text(
                    obj, at(ws), replacement, step["insert_length"])
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

    # 5. select the span, or put the caret there, and paste over it
    if not is_terminal:
        step = dict(rung=3, method="Text selection + paste" if we > ws else "Text caret + paste")
        if not replacement:
            return done("REFUSED", reason="nothing to paste: an empty replacement needs EditableText or a terminal")
        copy_voco(replacement)  # before the selection: the app then owns PRIMARY, and CLIPBOARD is pasted
        if we > ws:
            placed = put_selection(obj, text, ws, we, unit, step)
        else:
            sels = step["selections_read_back"] = read_selections(obj) if put_caret(obj, text, ws, unit, step) else None
            placed = sels is not None and "error" not in sels and not selected(sels)
        if placed:
            shift_insert()
            pump(paste_wait)
            return finish(3, step)
        # Nothing was sent.  The attempt may have left a selection or moved
        # the caret, and the next paste would land there: put both back.
        step["placed"] = False
        back = step["put_back"] = {}
        back["settled"] = settle(obj, text, c, unit, back)
        back["text_same"] = read_text(obj).get("text") == text
        out["steps"].append(step)
        if back["settled"] and back["text_same"]:
            return done("REFUSED", reason="the selection or caret did not read back as asked; nothing was sent")
        return done("FAILED-DETECTED", rung=3,
                    reason="the selection or caret did not read back as asked and could not be put back")

    # 6. BackSpace to the span's start, paste the replacement and the rest
    if after.split("\n", 1)[0].strip() != "":
        return done("REFUSED", reason="text follows the caret on its line; BackSpace and paste would not be safe")
    if not one_key_each(pasted[start:]):
        return done("REFUSED", reason="BackSpace count unsure: a character after the span's start may take more or fewer than one key")
    tail = replacement + pasted[end:]
    step = dict(rung=4, method=f"{len(pasted) - start} BackSpace + paste", backspaces=len(pasted) - start)
    if tail:
        copy_voco(tail)  # before the keys, so nothing can come between them
    for _ in range(len(pasted) - start):
        S.key("BackSpace", gap=0.006)
    # The terminal draws the keys a moment after they are sent.
    deadline = time.monotonic() + 3
    while True:
        pump(0.15)
        now = read_text(obj)
        step["erased_as_asked"] = (isinstance(now.get("text"), str) and now.get("caret") == at(ws)
                                   and fold(now["text"]).startswith(fold(text[:ws])))
        if step["erased_as_asked"] or time.monotonic() >= deadline:
            break
    if tail:
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
    a bind -x key (Ctrl+X Ctrl+P) from terminal.bashrc.  This bash counts
    READLINE_POINT in characters."""
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


def classify(r):
    """The run's class from the independent read alone, then how the ladder's
    own report compares.  r is a result with its request, ladder and reads."""
    scenario, req, ladder, ind = r["scenario"], r["request"], r["ladder"], r["independent_after"]
    other, trial = r.get("independent_other_field"), r.get("trial")
    untouched_full, _before, correct_full = intended(scenario, req, r.get("before"))
    if trial:
        correct_full = trial["expected"]
    full = norm(ind.get("full"))
    seen = ladder.get("check_read", {}).get("text")
    seen = norm(seen) if isinstance(seen, str) else None
    c = dict(intended_untouched=untouched_full, intended_correct=correct_full, independent_full=full,
             equals_correct=correct_full is not None and full == norm(correct_full),
             equals_untouched=full == norm(untouched_full))
    if full is None:
        c["class"] = "unverified"
        c["why"] = "the independent read gave nothing"
    elif c["equals_correct"]:
        c["class"] = "correct"
    elif c["equals_untouched"]:
        c["class"] = "untouched"
    else:
        c["class"] = "damaged"
    if other is not None:
        c["other_field_full"] = norm(other.get("full"))
        if c["other_field_full"] not in ("", None):
            c["class"] = "damaged"
            c["why"] = "the other field is not empty"
        elif c["other_field_full"] is None:
            c["other_field_unverified"] = True
    outcome = ladder.get("outcome")
    # A field that is neither text although the ladder sent nothing and
    # called nothing that edits: the setup, or the paste of rest, left it so.
    c["ladder_sent_nothing"] = outcome == "REFUSED" and not ladder.get("steps")
    if c["class"] == "damaged" and "why" not in c and (
            c["ladder_sent_nothing"] or (seen is not None and seen != norm(untouched_full) and full == seen)):
        c["setup_differed"] = True
    if c["class"] == "correct":
        c["caret_at_end_of_corrected"] = (
            isinstance(ind.get("before_caret"), str)
            and norm(ind["before_caret"]).endswith(norm(req["corrected"] + req["rest"])))
    wanted = r.get("wanted")
    if wanted:
        c["wanted"] = wanted
        c["as_wanted"] = c["class"] == wanted
    c["ladder_agrees"] = ((outcome == "CHANGED-VERIFIED" and c["class"] == "correct")
                          or (outcome == "REFUSED" and c["class"] == "untouched")
                          or (outcome == "FAILED-DETECTED" and c["class"] == "damaged"))
    # Honest: never "changed and verified" on an untouched or damaged field.
    c["honest"] = not (outcome == "CHANGED-VERIFIED" and c["class"] in ("untouched", "damaged"))
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
    if config.get("root_property"):
        # What at-spi-bus-launcher sets on an X11 root window when it starts with a display.
        address = S.bus.call_sync("org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress", None,
                                  None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
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


def not_applicable(case, scenario, req):
    """Why this case can't run this scenario or trial, or None."""
    if scenario == "two-lines" and case.get("single_line"):
        return "the field holds one line"
    if case["kind"] == "terminal" and not all(
            ch.isprintable() for ch in req["pasted"] + req["replacement"] + req["rest"]):
        return "a control character would reach the shell"
    return None


def run(case_name, scenario, config_name, req, trial=None, before=None, wanted=None):
    global S
    case = CASES[case_name]
    config = CONFIGS[config_name]
    paste_wait = case.get("paste_wait", 0.45)
    terminal = case["kind"] == "terminal"
    before = text_before(scenario) if before is None else before
    result = dict(case=case_name, label=case["label"], kind=case["kind"], scenario=scenario,
                  config=config_name, config_detail=dict(config), request=req, before=before,
                  copy="xclip through XWayland, PRIMARY then CLIPBOARD (VOCO's copy on GNOME Wayland)")
    if trial:
        result["trial"] = trial
    if wanted:
        result["wanted"] = wanted
    reason = not_applicable(case, scenario, req)
    if reason:
        result["not_applicable"] = reason
        return result
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

        # ---- setup: what happened before the change was asked for
        if scenario == "prefilled":
            S.type(before)
        elif scenario == "emoji-before":
            # The keys can't type an emoji: this text is pasted as VOCO pastes.
            paste_voco(before, paste_wait)
        elif scenario == "two-lines":
            S.type(before.rstrip("\n"))
            S.key("Return")
            pump(0.3)
        if scenario == "text-after":
            S.type(AFTER)
            # Ctrl+Home in GUI fields: plain Home is "smart" in some editors
            # (GtkSourceView, FeatherPad) and stops after the leading space.
            S.key("Home" if terminal else "ctrl+Home")
            pump(0.2)
        for part in req["parts"]:
            paste_voco(part, paste_wait)
        log(f"pasted {len(req['parts'])} parts")
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
        elif scenario == "selected-all":
            # In a terminal Ctrl+A is readline's beginning-of-line.
            S.key("ctrl+a")
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
        ladder = correct(req, paste_wait=paste_wait,
                         find_wait=case.get("focus_wait", 4.0) if scenario not in OTHER_SCENARIOS else 4.0)
        result["ladder"] = ladder
        log(f"ladder: {ladder['outcome']} rung={ladder['rung']} reason={ladder['reason']}")
        result["desktop_apps"] = desktop_apps()
        if ladder["outcome"] == "REFUSED" and (ladder["reason"] or "").startswith("unreadable"):
            result["tree_outline"] = tree_outline()
        result["a11y_status_after"] = a11y_status()
        result["screenshot_after_ladder"] = S.screenshot("after-ladder.png")

        # ---- dictation goes on: the rest is pasted at the caret, whatever
        # the ladder reported
        if req["rest"]:
            paste_voco(req["rest"], paste_wait)

        # ---- the independent read
        independent = independent_terminal if terminal else independent_gui
        if scenario in OTHER_SCENARIOS:
            result["independent_other_field"] = independent_gui()
            try:
                os.killpg(other.pid, signal.SIGTERM)
                other.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                pass
            back = wait_for_window(case["window"], 10, "window_after_other", result)
            if back is None:
                result["independent_error"] = "the field's own window did not take focus back"
            pump(0.5)
        result["independent_after"] = independent()
        result["classification"] = classify(result)
        log(f"independent: {result['independent_after'].get('full')!r} -> {result['classification']['class']}")
        result["screenshot"] = S.screenshot("end.png")
        return result
    finally:
        drop_clipboard()
        try:
            result["app_log_tail"] = open(os.path.join(RUN, "app.log"), "rb").read()[-1500:].decode("utf-8", "replace")
        except OSError:
            pass
        S.stop()


def load_trial(path):
    """A trial file: one request, its parts pasted one by one, and the text
    the field should hold at the end when the change is made."""
    raw = open(path, "rb").read()
    t = json.loads(raw.decode("utf-8"))
    if not isinstance(t.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]+", t["id"]):
        raise ValueError("a trial's id is letters, digits, - and _")
    if not isinstance(t.get("expected"), str):
        raise ValueError("a trial needs its expected text")
    req = make_request(t["parts"], t["start"], t["end"], t["replacement"], t.get("rest", ""))
    trial = dict(id=t["id"], sha256=hashlib.sha256(raw).hexdigest(),
                 file=os.environ.get("FIELD_LADDER_TRIAL_SOURCE") or path, expected=t["expected"],
                 expected_is_corrected_plus_rest=t["expected"] == req["corrected"] + req["rest"])
    return req, trial


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case", nargs="?")
    ap.add_argument("scenario", nargs="?", default="plain")
    ap.add_argument("--config", default="plain")
    ap.add_argument("--rep", default="1")
    ap.add_argument("--trial", help="a trial file; runs in scenario plain")
    ap.add_argument("--refuse-expected", action="store_true",
                    help="with --trial: the right end is the untouched field")
    ap.add_argument("--before", help="with emoji-before: other text to put in the field first; "
                    "the run is kept apart from the scenario's own")
    ap.add_argument("--out")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list or not args.case:
        print("cases:    ", " ".join(CASES))
        print("scenarios:", " ".join(SCENARIOS))
        print("configs:  ", " ".join(CONFIGS))
        return 0
    name, trial, wanted = args.scenario, None, None
    try:
        if args.trial:
            if args.scenario != "plain":
                raise ValueError("a trial runs in scenario plain")
            req, trial = load_trial(args.trial)
            name = "trial-" + trial["id"]
            wanted = "untouched" if args.refuse_expected else "correct"
        else:
            req = builtin_request(args.scenario)
            if args.scenario in REFUSE_SCENARIOS:
                wanted = "untouched"
        if args.before is not None and args.scenario != "emoji-before":
            raise ValueError("--before goes with scenario emoji-before")
        out = args.out or os.path.join(HERE, "results", f"{args.case}.{name}.{args.config}.r{args.rep}.json")
        result = run(args.case, args.scenario, args.config, req, trial=trial, before=args.before, wanted=wanted)
        if args.before is not None:
            result["variant"] = "before"
    except Exception as e:  # noqa: BLE001
        out = args.out or os.path.join(HERE, "results", f"{args.case}.{name}.{args.config}.r{args.rep}.json")
        result = dict(case=args.case, scenario=args.scenario, config=args.config,
                      harness_error=f"{type(e).__name__}: {e}", traceback=traceback.format_exc())
        if trial:
            result["trial"] = trial
    result["rep"] = args.rep
    result["log"] = log_lines
    result["run_dir"] = RUN
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, ensure_ascii=False, default=str)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
