#!/usr/bin/python3
"""Send one valid Alt+D gesture in a private X11 test session.

Two independent XTEST clients using --clearmodifiers can interleave Alt+D
with a streaming Shift+Insert and manufacture Alt+Shift+D. A server grab
serializes this fixture gesture without changing the application's helper,
shortcut matcher, or recording/flush deadlines.
"""
import ctypes as C
import json
import os
from pathlib import Path
import time


def send_alt_d():
    x11 = C.CDLL("libX11.so.6")
    xtest = C.CDLL("libXtst.so.6")
    display_type, window_type = C.c_void_p, C.c_ulong
    x11.XOpenDisplay.argtypes = [C.c_char_p]
    x11.XOpenDisplay.restype = display_type
    x11.XDefaultRootWindow.argtypes = [display_type]
    x11.XDefaultRootWindow.restype = window_type
    x11.XGrabServer.argtypes = [display_type]
    x11.XUngrabServer.argtypes = [display_type]
    x11.XSync.argtypes = [display_type, C.c_int]
    x11.XCloseDisplay.argtypes = [display_type]
    x11.XKeysymToKeycode.argtypes = [display_type, C.c_ulong]
    x11.XKeysymToKeycode.restype = C.c_ubyte
    x11.XQueryPointer.argtypes = [display_type, window_type,
                                 C.POINTER(window_type), C.POINTER(window_type),
                                 C.POINTER(C.c_int), C.POINTER(C.c_int),
                                 C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_uint)]
    x11.XQueryPointer.restype = C.c_int
    xtest.XTestFakeKeyEvent.argtypes = [display_type, C.c_uint, C.c_int, C.c_ulong]
    xtest.XTestFakeKeyEvent.restype = C.c_int
    display = x11.XOpenDisplay(os.environ["DISPLAY"].encode())
    if not display:
        raise RuntimeError("The private X11 display is unavailable")
    grabbed, pressed = False, []
    try:
        root = x11.XDefaultRootWindow(display)
        alt, letter = (x11.XKeysymToKeycode(display, symbol) for symbol in (0xffe9, 0x64))
        if not alt or not letter:
            raise RuntimeError("The private keyboard has no Alt+D mapping")
        deadline = time.monotonic() + 2
        while True:
            x11.XGrabServer(display)
            grabbed = True
            x11.XSync(display, False)
            root_return, child = window_type(), window_type()
            coordinates = [C.c_int() for _ in range(4)]
            mask = C.c_uint()
            if not x11.XQueryPointer(display, root, C.byref(root_return), C.byref(child),
                                    *(C.byref(value) for value in coordinates), C.byref(mask)):
                raise RuntimeError("The private keyboard state could not be read")
            # Wait without sending any keys. Releasing the grab lets an already
            # active paste finish; once neutral, no other client can interleave.
            if not mask.value & 0xff:
                break
            x11.XUngrabServer(display)
            grabbed = False
            x11.XSync(display, False)
            if time.monotonic() >= deadline:
                raise RuntimeError("The private keyboard did not return to neutral")
            time.sleep(.005)
        for key, down in ((alt, True), (letter, True), (letter, False), (alt, False)):
            if not xtest.XTestFakeKeyEvent(display, key, down, 0):
                raise RuntimeError("The private shortcut could not be injected")
            if down:
                pressed.append(key)
            else:
                pressed.remove(key)
        # Process all four events before letting the competing paste client run.
        x11.XSync(display, False)
        return {"method": "atomic-private-x11", "shortcut": "Alt+D", "keyPresses": 1,
                "modifierPrecondition": "neutral", "retries": 0}
    finally:
        for key in reversed(pressed):
            xtest.XTestFakeKeyEvent(display, key, False, 0)
        if grabbed:
            x11.XSync(display, False)
            x11.XUngrabServer(display)
        x11.XSync(display, False)
        x11.XCloseDisplay(display)


if __name__ == "__main__":
    # This helper belongs only to the isolated native fixture, never a session
    # supplied by a user. The parent harness already asserts the same boundary.
    root = Path(os.environ["VOCO_NATIVE_TEST_ROOT"])
    assert os.environ["DISPLAY"] == ":0"
    assert os.environ["XDG_RUNTIME_DIR"] == str(root / "runtime")
    print(json.dumps(send_alt_d()))
