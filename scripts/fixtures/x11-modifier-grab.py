#!/usr/bin/python3
"""Stand in for a window manager that keeps the Super key, in a private X11 test session.

Mutter grabs Super on the root window for the overview. When another key is
pressed under it, Mutter replays that key, and the X server then delivers it
ignoring passive grabs on the root window. A shortcut another program grabbed
only there never fires, and its letter reaches the focused application. This
fixture does the same and nothing else: it takes Super in a synchronous grab,
lets the next key through to itself, and replays it.
"""
import ctypes as C
import os
from pathlib import Path
import sys

KEY_PRESS, KEY_RELEASE = 2, 3
ANY_MODIFIER = 1 << 15
GRAB_MODE_SYNC, GRAB_MODE_ASYNC = 0, 1
ASYNC_KEYBOARD, SYNC_KEYBOARD, REPLAY_KEYBOARD = 3, 4, 5


class KeyEvent(C.Structure):
    _fields_ = [("type", C.c_int), ("serial", C.c_ulong), ("send_event", C.c_int), ("display", C.c_void_p),
                ("window", C.c_ulong), ("root", C.c_ulong), ("subwindow", C.c_ulong), ("time", C.c_ulong),
                ("x", C.c_int), ("y", C.c_int), ("x_root", C.c_int), ("y_root", C.c_int),
                ("state", C.c_uint), ("keycode", C.c_uint), ("same_screen", C.c_int)]


class Event(C.Union):
    _fields_ = [("type", C.c_int), ("key", KeyEvent), ("pad", C.c_long * 24)]


def main(ready):
    x11 = C.CDLL("libX11.so.6")
    display_type, window_type = C.c_void_p, C.c_ulong
    x11.XOpenDisplay.argtypes = [C.c_char_p]
    x11.XOpenDisplay.restype = display_type
    x11.XDefaultRootWindow.argtypes = [display_type]
    x11.XDefaultRootWindow.restype = window_type
    x11.XKeysymToKeycode.argtypes = [display_type, C.c_ulong]
    x11.XKeysymToKeycode.restype = C.c_ubyte
    x11.XGrabKey.argtypes = [display_type, C.c_int, C.c_uint, window_type, C.c_int, C.c_int, C.c_int]
    x11.XAllowEvents.argtypes = [display_type, C.c_int, C.c_ulong]
    x11.XNextEvent.argtypes = [display_type, C.POINTER(Event)]
    x11.XSync.argtypes = [display_type, C.c_int]
    x11.XFlush.argtypes = [display_type]
    display = x11.XOpenDisplay(os.environ["DISPLAY"].encode())
    if not display:
        raise RuntimeError("The private X11 display is unavailable")
    root = x11.XDefaultRootWindow(display)
    supers = [code for code in (x11.XKeysymToKeycode(display, symbol) for symbol in (0xffeb, 0xffec)) if code]
    if not supers:
        raise RuntimeError("The private keyboard has no Super key")
    for code in supers:
        x11.XGrabKey(display, code, ANY_MODIFIER, root, False, GRAB_MODE_ASYNC, GRAB_MODE_SYNC)
    x11.XSync(display, False)
    Path(ready).write_text("ready\n")
    event = Event()
    while True:
        x11.XNextEvent(display, C.byref(event))
        if event.type not in (KEY_PRESS, KEY_RELEASE):
            continue
        if event.type == KEY_PRESS and event.key.keycode in supers:
            # Super alone so far: see the next key before deciding.
            mode = SYNC_KEYBOARD
        elif event.type == KEY_PRESS:
            # Super and another key: not this program's, so hand it on.
            mode = REPLAY_KEYBOARD
        else:
            mode = ASYNC_KEYBOARD
        x11.XAllowEvents(display, mode, event.key.time)
        x11.XFlush(display)


if __name__ == "__main__":
    # This helper belongs only to the isolated native fixture, never a session
    # supplied by a user. The parent harness already asserts the same boundary.
    root_directory = Path(os.environ["VOCO_NATIVE_TEST_ROOT"])
    assert os.environ["DISPLAY"] == ":0"
    assert os.environ["XDG_RUNTIME_DIR"] == str(root_directory / "runtime")
    main(sys.argv[1])
