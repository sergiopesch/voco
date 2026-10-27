#!/usr/bin/python3
"""Trial only, on a disposable runner: the installed VOCO snap dictates a public
clip into a GTK field, the way a person would use it.

gnome-wayland: a nested GNOME Shell on Wayland loads the repository's companion,
VOCO pastes through it, and a second dictation starts and stops with Alt+D,
which the companion grabs inside the Shell. x11: a bare Xvfb, VOCO's own X11
grab and xdotool. Everything runs at the paths snapd lets a snap reach: the
runner's session bus, /run/user/UID/pulse/native and wayland-N.

Usage: e2e.py gnome-wayland|x11 EVIDENCE_DIR
Prints a JSON report; exits 1 unless the focused field received the clip's
words exactly, through the keyboard the platform should use.
"""
import ast
import collections
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

platform, evidence = sys.argv[1], Path(sys.argv[2])
assert platform in ("gnome-wayland", "x11")
evidence.mkdir(parents=True, exist_ok=True)
repo = Path(__file__).resolve().parents[2]
uid = os.getuid()
runtime = Path(f"/run/user/{uid}")
bus = f"unix:path={runtime}/bus"
revision = subprocess.check_output(["snap", "list", "voco"], text=True).splitlines()[1].split()[2]
data = Path.home() / "snap/voco" / revision
state = data / ".local/state/voco"
trace = state / "hotkey-trace.jsonl"
performance = state / "performance/performance.jsonl"
clip = repo / "tests/fixtures/speech/84-121123-0000.wav"
EXPECTED = ["go", "do", "you", "hear"]
KEYS = {"gnome-wayland": "companion", "x11": "xdotool"}[platform]
processes = []
report = {"platform": platform, "snapRevision": revision, "steps": []}


def note(step, **fields):
    report["steps"].append({"step": step, "t": round(time.monotonic() - started, 2), **fields})
    print(f"[{time.monotonic() - started:7.2f}] {step} {json.dumps(fields) if fields else ''}", flush=True)


def start(command, log, env=None, **options):
    process = subprocess.Popen(command, stdout=open(evidence / log, "w"), stderr=subprocess.STDOUT,
                               env=env, **options)
    processes.append(process)
    return process


def wait(predicate, what, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError(f"Timed out waiting for {what}")


def records(path):
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass  # the writer may be appending the last line
    return rows


def events():
    return collections.Counter(row.get("event") for row in records(trace) if isinstance(row, dict))


def words(text):
    return re.findall("[a-z]+", (text or "").lower())


def start_audio(base):
    """PipeWire with the privacy check's devices: a null sink "fixture" and the
    default microphone voco_fixture, which records its monitor. Its Pulse server
    listens at /run/user/UID/pulse/native, the socket VOCO's native capture and
    the snap's audio plugs use. Native capture needs PipeWire: a source without
    PipeWire's object.serial is never a default microphone."""
    for unit in ("wireplumber.service", "pipewire-pulse.socket", "pipewire-pulse.service", "pipewire.socket",
                 "pipewire.service", "pulseaudio.socket", "pulseaudio.service"):
        subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True, env=base)
    for stale in (runtime / "pulse/native", runtime / "pipewire-0", runtime / "pipewire-0-manager"):
        if stale.exists():
            stale.unlink()
    environment = {**base, "PIPEWIRE_RUNTIME_DIR": str(runtime)}
    start(["pipewire", "-c", str(repo / "scripts/privacy/pipewire.conf")], "pipewire.log", env=environment)
    wait((runtime / "pulse/native").exists, "PipeWire's Pulse server")
    start(["wireplumber"], "wireplumber.log", env=environment)
    sources = lambda: subprocess.run(["pactl", "list", "short", "sources"], capture_output=True, text=True,
                                     env=environment).stdout
    wait(lambda: "voco_fixture" in sources(), "the fixture microphone")
    subprocess.run(["pactl", "set-default-source", "voco_fixture"], check=True, env=environment)
    wait(lambda: subprocess.run(["pactl", "get-default-source"], capture_output=True, text=True,
                                env=environment).stdout.strip() == "voco_fixture", "the default microphone")
    return environment


class Field:
    """paste-field.py, focused, reporting every change of its text."""

    def __init__(self, environment):
        self.lines = []
        self.process = subprocess.Popen(["/usr/bin/python3", str(repo / "scripts/fixtures/paste-field.py")],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(evidence / "field.err", "w"),
                                        text=True, env=environment)
        processes.append(self.process)
        threading.Thread(target=self._read, daemon=True).start()
        wait(lambda: any(line.get("what") == "ready" for line in self.lines), "the field to start")

    def _read(self):
        with open(evidence / "field.jsonl", "w") as log:
            for line in self.process.stdout:
                log.write(line)
                log.flush()
                self.lines.append(json.loads(line))

    def text(self):
        texts = [line["text"] for line in self.lines if line.get("what") == "text"]
        return texts[-1] if texts else ""

    def clear(self):
        self.process.stdin.write("clear\n")
        self.process.stdin.flush()
        wait(lambda: self.text() == "", "the field to clear")


def gnome_session(environment):
    """A nested GNOME Shell on Wayland with the companion and the private probe."""
    extensions = Path.home() / ".local/share/gnome-shell/extensions"
    extensions.mkdir(parents=True, exist_ok=True)
    for source in (repo / "integrations/gnome/voco-panel@sergiopesch.com", repo / "scripts/fixtures/gnome-private-probe"):
        name = "voco-private-probe@test.invalid" if source.name == "gnome-private-probe" else source.name
        subprocess.run(["rm", "-rf", str(extensions / name)], check=True)
        subprocess.run(["cp", "-r", str(source), str(extensions / name)], check=True)
    for key, value in (("org.gnome.shell enabled-extensions", "['voco-private-probe@test.invalid', 'voco-panel@sergiopesch.com']"),
                       ("org.gnome.shell disable-user-extensions", "false"),
                       ("org.gnome.shell welcome-dialog-last-shown-version", "'999'"),
                       ("org.gnome.desktop.interface enable-animations", "false"),
                       ("org.gnome.desktop.session idle-delay", "uint32 0")):
        subprocess.run(["gsettings", "set", *key.split(), value], check=True, env=environment)
    # The Shell's login manager wants a system bus; a private one keeps it away
    # from the runner's logind, which VOCO reads on the real one.
    system_bus = runtime / "voco-shell-system-bus"
    start(["dbus-daemon", "--session", "--nofork", f"--address=unix:path={system_bus}"], "shell-system-bus.log")
    wait(system_bus.exists, "the Shell's system bus")
    shell_environment = {**environment, "LIBGL_ALWAYS_SOFTWARE": "1", "XDG_SESSION_TYPE": "wayland",
                         "XDG_CURRENT_DESKTOP": "ubuntu:GNOME", "GNOME_SHELL_SESSION_MODE": "user",
                         "DBUS_SYSTEM_BUS_ADDRESS": f"unix:path={system_bus}", "NO_AT_BRIDGE": "1"}
    shell = start(["gnome-shell", "--nested", "--wayland", "--wayland-display=wayland-9", "--sm-disable"],
                  "gnome-shell.log", env=shell_environment)
    log = evidence / "gnome-shell.log"
    wait(lambda: (runtime / "wayland-9").exists(), "the Shell's Wayland socket", 120)
    wait(lambda: re.search(r"Using public X11 display (:\d+)", log.read_text()), "XWayland", 120)
    xwayland = re.search(r"Using public X11 display (:\d+)", log.read_text())[1]
    authority = sorted(runtime.glob(".mutter-Xwaylandauth.*"))
    probe = ["gdbus", "call", "--session", "--dest", "org.gnome.Shell", "--object-path", "/org/voco/PrivateShellProbe",
             "--method", "org.voco.PrivateShellProbe.GetWindows"]
    wait(lambda: subprocess.run(probe, capture_output=True, env=environment).returncode == 0, "the Shell probe", 120)
    wait(lambda: "GNOME Shell started" in log.read_text(), "the Shell to start", 120)
    # The Shell opens its overview at startup; Escape on its stage window closes it.
    stage = None
    for window in subprocess.run(["xdotool", "search", "--pid", str(shell.pid)], capture_output=True, text=True,
                                 env=environment).stdout.split():
        geometry = subprocess.run(["xdotool", "getwindowgeometry", "--shell", window], capture_output=True, text=True,
                                  env=environment).stdout
        size = dict(line.split("=") for line in geometry.split())
        if int(size.get("WIDTH", 0)) >= 600 and int(size.get("HEIGHT", 0)) >= 400:
            stage = window
    assert stage, "The nested Shell's window is missing"
    subprocess.run(["xdotool", "windowfocus", "--sync", stage], check=True, env=environment)
    overview = ["gdbus", "call", "--session", "--dest", "org.gnome.Shell", "--object-path", "/org/gnome/Shell", "--method",
                "org.freedesktop.DBus.Properties.Get", "org.gnome.Shell", "OverviewActive"]
    for _ in range(20):
        if subprocess.run(overview, capture_output=True, text=True, env=environment).stdout.strip() == "(<false>,)":
            break
        subprocess.run(["xdotool", "key", "Escape"], env=environment)
        time.sleep(0.5)
    assert subprocess.run(overview, capture_output=True, text=True, env=environment).stdout.strip() == "(<false>,)", \
        "The Shell's overview stayed open"
    session = {"WAYLAND_DISPLAY": "wayland-9", "DISPLAY": xwayland, "XDG_SESSION_TYPE": "wayland",
               "XDG_CURRENT_DESKTOP": "ubuntu:GNOME"}
    if authority:
        session["XAUTHORITY"] = str(authority[0])
    note("gnome-shell", xwayland=xwayland, stage=stage)
    return session, probe


def focused_title(probe, environment):
    reply = subprocess.run(probe, capture_output=True, text=True, env=environment).stdout
    windows = json.loads(ast.literal_eval(reply.strip())[0])  # gdbus prints a tuple of one string
    return next((window["title"] for window in windows if window["focused"]), None)


def dictate(how, field, environment, toggle):
    """Start, play the clip, stop; returns the field's words."""
    before = events()
    toggle()
    wait(lambda: events()["recording_state_active"] > before["recording_state_active"], f"recording ({how})")
    note("recording", how=how)
    player = subprocess.run(["pw-play", "--target", "fixture", str(clip)], env=environment, capture_output=True,
                            text=True)
    assert player.returncode == 0, f"pw-play failed: {player.stderr}"
    wait(lambda: words(field.text()) == EXPECTED, f"the words in the field ({how})", 30)
    note("words arrived", how=how, text=field.text())
    toggle()
    wait(lambda: events()["dictation_stop_to_idle"] > before["dictation_stop_to_idle"], f"Stop to finish ({how})", 30)
    time.sleep(1)  # Stop may paste one space after a finished sentence
    return field.text()


started = time.monotonic()
passed = False
try:
    base = {key: value for key, value in os.environ.items() if key not in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY")}
    base.update(XDG_RUNTIME_DIR=str(runtime), DBUS_SESSION_BUS_ADDRESS=bus, LANG="C.UTF-8")
    audio = start_audio(base)
    note("pipewire")
    host = ":7" if platform == "gnome-wayland" else ":8"
    start(["Xvfb", host, "-screen", "0", "1280x900x24", "-nolisten", "tcp"], "xvfb.log")
    wait(lambda: Path(f"/tmp/.X11-unix/X{host[1:]}").exists(), "Xvfb")
    host_environment = {**base, "DISPLAY": host}
    if platform == "gnome-wayland":
        session, probe = gnome_session(host_environment)
        field = Field({**base, **session, "GDK_BACKEND": "wayland"})
        wait(lambda: focused_title(probe, host_environment) == "VOCO paste fixture", "the field to have focus")
    else:
        session = {"DISPLAY": host, "XDG_SESSION_TYPE": "x11"}
        field = Field({**base, **session, "GDK_BACKEND": "x11"})
        window = subprocess.check_output(["xdotool", "search", "--name", "^VOCO paste fixture$"], text=True,
                                         env=host_environment).split()[0]
        subprocess.run(["xdotool", "windowfocus", "--sync", window], check=True, env=host_environment)
    note("field focused")

    # VOCO, configured past setup, with its opt-in logs on; nothing from an earlier run.
    subprocess.run(["rm", "-rf", str(state)], check=True)
    config = data / ".config/voco"
    config.mkdir(mode=0o700, parents=True, exist_ok=True)
    (data / ".config").chmod(0o700)
    (config / "config.json").write_text(json.dumps({"onboardingCompleted": True, "hotkey": "Alt+D"}) + "\n")
    (config / "config.json").chmod(0o600)
    voco_environment = {**base, **session, "VOCO_HOTKEY_TRACE": "1", "VOCO_PERFORMANCE_LOG": "1", "RUST_LOG": "info"}
    app = start(["snap", "run", "voco"], "voco.log", env=voco_environment)
    wait(lambda: "Bundled Nemotron streaming model ready" in (evidence / "voco.log").read_text()
         and events()["frontend_hotkey_handler_ready"] > 0, "VOCO to be ready", 120)
    note("voco ready")

    if platform == "gnome-wayland":
        asking = ["gdbus", "call", "--session", "--dest", "org.voco.Panel", "--object-path", "/org/voco/Panel",
                  "--method", "org.voco.Panel1.CompanionAsking"]
        wait(lambda: subprocess.run(asking, capture_output=True, text=True, env=base).stdout.strip() == "(true,)",
             "the companion to attach and ask for work", 60)
        note("companion asks for work")
    check = subprocess.run(["snap", "run", "voco", "--check-desktop-input"], capture_output=True, text=True,
                           env=voco_environment)
    note("check-desktop-input", exit=check.returncode, output=(check.stdout + check.stderr).strip())
    assert check.returncode == 0, "voco --check-desktop-input refused"

    toggle_socket = lambda: subprocess.run(["snap", "run", "voco", "--toggle"], check=True, env=voco_environment)
    text = dictate("voco --toggle", field, audio, toggle_socket)
    assert words(text) == EXPECTED, f"Field text after Stop: {text!r}"
    report["toggleText"] = text

    # The shortcut: on GNOME the companion's grab inside the Shell, on X11 VOCO's own.
    field.clear()
    if platform == "gnome-wayland":
        wait(lambda: focused_title(probe, host_environment) == "VOCO paste fixture", "the field to keep focus")
    shortcut = lambda: subprocess.run(["xdotool", "key", "--clearmodifiers", "alt+d"], check=True, env=host_environment)
    text = dictate("Alt+D", field, audio, shortcut)
    assert words(text) == EXPECTED, f"Field text after the shortcut's Stop: {text!r}"
    report["shortcutText"] = text

    backends = collections.Counter(row.get("backend_used") for row in records(trace) if row.get("event") == "eval_toggle_entered")
    keys = collections.Counter(row.get("paste_keys") for row in records(performance) if row.get("paste_keys"))
    report.update(toggleBackends=dict(backends), pasteKeys=dict(keys), fieldChanges=sum(
        1 for line in field.lines if line.get("what") == "text"))
    expected_backend = {"gnome-wayland": "gnome_panel", "x11": "global_shortcut"}[platform]
    assert backends.get(expected_backend), f"The shortcut never toggled through {expected_backend}: {dict(backends)}"
    assert keys and set(keys) == {KEYS}, f"Pastes went through {dict(keys)}, not only {KEYS}"
    assert app.poll() is None, "VOCO exited during the dictations"
    passed = True
except Exception as error:
    report["failure"] = f"{type(error).__name__}: {error}"
    raise
finally:
    report["passed"] = passed
    report["lastEvents"] = [row.get("event") for row in records(trace)[-15:]]
    if not passed:
        # Neither log holds dictated text; their last rows say what VOCO decided.
        for path in (trace, performance):
            print(f"--- last rows of {path.name}")
            for row in records(path)[-40:]:
                print(json.dumps(row, sort_keys=True))
    for path in (trace, performance):
        if path.exists():
            (evidence / path.name).write_text(path.read_text())
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    time.sleep(1)
    for process in processes:
        if process.poll() is None:
            process.kill()
    (evidence / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
