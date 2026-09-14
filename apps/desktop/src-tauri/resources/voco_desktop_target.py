"""Read only focus metadata; never read field text, window titles or clipboard data."""
import hashlib
import json
import sys
import uuid
from pathlib import Path

TERMINALS = {"ghostty", "gnome-terminal-server", "kgx", "konsole", "kitty", "alacritty", "wezterm-gui", "xfce4-terminal", "tilix", "xterm", "foot", "terminator"}


class FocusTracker:
    """Events invalidate identity; a retained object is only a hint for a fresh query."""
    def __init__(self):
        self.generation = 0
        self.key = None
        self.hint = None
        self.listener = None
        self.attempted = False
        self.nonce = uuid.uuid4().hex

    def observe(self, node):
        key = (node.get_process_id(), node.path)
        if key != self.key:
            self.generation += 1
            self.key = key
        self.hint = node

    def event(self, event, *_):
        try:
            if event.detail1:
                self.observe(event.source)
            elif self.key == (event.source.get_process_id(), event.source.path):
                self.generation += 1
                self.key = self.hint = None
        except Exception:
            self.generation += 1
            self.key = self.hint = None

    def start(self, atspi):
        if self.attempted:
            return
        self.attempted = True
        try:
            listener = atspi.EventListener.new(self.event)
            if listener.register('object:state-changed:focused'):
                self.listener = listener
        except Exception:
            pass  # Fresh tree discovery still works; diagnostics expose the gap.

    def focused_hint(self, window, pid, atspi):
        node = self.hint
        if node is None:
            return None
        try:
            node.clear_cache_single()
            if node.get_process_id() != pid or node.path == window.path:
                return None
            if not node.get_state_set().contains(atspi.StateType.FOCUSED):
                return None
            parent = node
            for _ in range(32):
                parent.clear_cache_single()
                if parent.get_process_id() != pid:
                    return None
                if parent.path == window.path:
                    return node
                child = parent
                index = child.get_index_in_parent()
                parent = child.get_parent()
                if parent is None or index < 0:
                    break
                parent.clear_cache_single()
                if parent.get_child_at_index(index).path != child.path:
                    return None
        except Exception:
            pass
        return None


TRACKER = FocusTracker()


def unavailable():
    return {"shortcut": "ctrl+v", "token": None, "scope": "unavailable",
            "events_tracked": TRACKER.listener is not None}


def probe():
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi, GLib
    Atspi.set_timeout(80, 80)
    TRACKER.start(Atspi)
    context = GLib.MainContext.default()
    for _ in range(256):
        if not context.pending():
            break
        context.iteration(False)
    if context.pending():
        return unavailable()  # Do not act on a partially drained event backlog.
    desktop = Atspi.get_desktop(0)
    desktop.clear_cache_single()
    active = []
    for i in range(min(desktop.get_child_count(), 128)):
        app = desktop.get_child_at_index(i)
        try:
            app.clear_cache_single()
            for j in range(min(max(app.get_child_count(), 0), 20)):
                window = app.get_child_at_index(j)
                window.clear_cache_single()
                if window.get_state_set().contains(Atspi.StateType.ACTIVE):
                    active.append((app, window))
        except Exception:
            continue
    if len(active) != 1:
        return unavailable()
    app, window = active[0]
    pid = app.get_process_id()
    try:
        binary = Path(f"/proc/{pid}/exe").resolve().name
    except OSError:
        binary = ""
    terminal = binary in TERMINALS
    focused = TRACKER.focused_hint(window, pid, Atspi)
    pending = [] if focused is not None else [window]
    visited = 0
    discovered = len(pending)
    while pending and visited < 128:
        node = pending.pop()
        visited += 1
        try:
            node.clear_cache_single()
            state = node.get_state_set()
            terminal = terminal or node.get_role() == Atspi.Role.TERMINAL
            if node.path != window.path and state.contains(Atspi.StateType.FOCUSED):
                focused = node
                break
            # Bound total child discovery, rather than truncating every container
            # to 30 children. Some toolkits emit no focus event for a control
            # until an accessibility client has first discovered that object.
            for j in range(min(max(node.get_child_count(), 0), 128 - discovered)):
                pending.append(node.get_child_at_index(j))
                discovered += 1
        except Exception:
            continue
    if focused is not None:
        TRACKER.observe(focused)
        terminal = terminal or focused.get_role() == Atspi.Role.TERMINAL
    focused_path = focused.path if focused is not None else ''
    identity = f"{TRACKER.nonce}:{TRACKER.generation}:{pid}:{window.path}:{focused_path}"
    return {"shortcut": "ctrl+shift+v" if terminal else "ctrl+v",
            "token": hashlib.sha256(identity.encode()).hexdigest(),
            "scope": "control" if focused is not None else "window",
            "events_tracked": TRACKER.listener is not None}


def safe_probe():
    try:
        return probe()
    except Exception:
        return unavailable()


def serve():
    # Input contains a sequence number only; output contains no app/field text.
    for line in iter(lambda: sys.stdin.buffer.readline(128), b""):
        if not line.endswith(b"\n"): return
        try:
            request = json.loads(line)
            seq = request["seq"]
            if type(seq) is not int or seq < 0: return
        except (ValueError, KeyError, TypeError):
            return
        result = safe_probe()
        result["seq"] = seq
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]: serve()
    else: print(json.dumps(safe_probe()))
