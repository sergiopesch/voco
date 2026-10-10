#!/usr/bin/python3 -I
"""Test-only bridge from VOCO's virtual keyboard to a private Xvfb, never installed.

The bridged suites give their bwrap namespace /dev/uinput but no /dev/input, so
production pastes through VOCO's real uinput keyboard, which nothing inside can
read. This bridge runs outside the namespace. It grabs each kernel device named
exactly "VOCO virtual keyboard" as it appears, so its keys reach no compositor
or console, and replays every press and release in order, with the gaps VOCO
sent them at, as XTest on the private Xvfb socket it is given. A nested Shell on
that Xvfb passes them to its focused client. Devices come and go with VOCO
processes. Only the paste gesture is accepted, Shift+Insert optionally led by
one Space; anything else is rejected loudly and nothing more is replayed.

Evidence is JSONL with CLOCK_MONOTONIC times. With --input-state, each gesture
also records the private Shell's input state before its first key ("dispatch")
and after its last ("completed").

Usage: VOCO_UINPUT_BRIDGE=1 uinput-bridge.py --display SOCKET --log FILE [--input-state SOCKET]
SIGTERM stops it. It exits 0 only if every gesture was accepted and replayed.
"""
import argparse
import collections
import ctypes
import errno
import fcntl
import json
import os
from pathlib import Path
import select
import signal
import socket
import struct
import sys
import time

DEVICE_NAME = 'VOCO virtual keyboard'
EV_SYN, EV_KEY, SYN_DROPPED = 0, 1, 3
# Kernel key codes and the X keysyms they replay as.
KEYS = {42: ('Shift_L', 0xffe1), 110: ('Insert', 0xff63)}
PASTE = ((42, 1), (110, 1), (110, 0), (42, 0))
# The only gesture VOCO's keyboard sends: Shift+Insert. Any other key is an error.
GESTURES = {(42, 1): (PASTE, ['shift+Insert'])}
INPUT_EVENT = struct.Struct('@llHHi')
EVIOCGNAME = 0x81004506  # _IOC(_IOC_READ, 'E', 0x06, 256)
EVIOCGRAB = 0x40044590
EVIOCSCLOCKID = 0x400445a0
CLOCK_MONOTONIC = 1
# udev sets the event node's permissions shortly after the device appears; VOCO
# waits 500 ms before a new keyboard's first key.
OPEN_WARNING_S = 0.4


def refuse_unless_disposable():
    """The bridge grabs kernel input devices and types into an X server. Where a
    real desktop runs, a VOCO keyboard it failed to grab in time, or a leftover
    one, would type into that desktop. So it runs only where CI or the person
    opted in explicitly, and never alongside a graphical session."""
    if os.environ.get('VOCO_UINPUT_BRIDGE') != '1':
        sys.exit('uinput-bridge: refusing to run without VOCO_UINPUT_BRIDGE=1; '
                 'set it only on a disposable test machine')
    for name in ('WAYLAND_DISPLAY', 'DISPLAY'):
        if os.environ.get(name):
            sys.exit(f'uinput-bridge: refusing to run with {name} set; a graphical session is active')
    sessions = Path('/run/systemd/sessions')
    for path in sorted(sessions.iterdir()) if sessions.is_dir() else ():
        if not path.is_file():
            continue  # logind's .ref FIFOs
        fields = dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line)
        if fields.get('TYPE') in ('x11', 'wayland', 'mir'):
            sys.exit(f'uinput-bridge: refusing to run beside graphical login session {path.name} '
                     f'({fields["TYPE"]}, {fields.get("USER", "unknown user")})')


class XError(Exception):
    pass


class XTest:
    """The few X11 requests the bridge needs, over the server's Unix socket."""

    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
        self.sock.settimeout(5)
        self.sock.connect(path)
        self.sequence = 0
        # Little-endian, protocol 11.0, no authorization: the private Xvfb has none.
        self.sock.sendall(struct.pack('<BxHHHHxx', 0x6c, 11, 0, 0, 0))
        head = self.receive(8)
        body = self.receive(struct.unpack_from('<H', head, 6)[0] * 4)
        if head[0] != 1:
            raise XError(f'The X server refused the connection: {body[:head[1]]!r}')
        first, last = body[26], body[27]
        reply = self.request(struct.pack('<BxHHxx', 98, 4, 5) + b'XTEST\0\0\0', reply=True)
        if not reply[8]:
            raise XError('The X server has no XTEST extension')
        self.opcode = reply[9]
        reply = self.request(struct.pack('<BxHBBxx', 101, 2, first, last - first + 1), reply=True)
        width = reply[1]
        rows = [struct.unpack_from(f'<{width}I', reply, 32 + 4 * width * row) for row in range(last - first + 1)]
        self.keycodes = {}
        for code, (name, keysym) in KEYS.items():
            matches = [first + row for column in range(width) for row, syms in enumerate(rows) if syms[column] == keysym]
            if not matches:
                raise XError(f'The X server has no {name} key')
            self.keycodes[code] = matches[0]

    def receive(self, size):
        data = b''
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise XError('The X server closed the connection')
            data += chunk
        return data

    def request(self, data, reply=False):
        self.sock.sendall(data)
        self.sequence = (self.sequence + 1) & 0xffff
        while reply:
            packet = self.receive(32)
            if packet[0] == 0:
                raise XError(f'X error {packet[1]} for request {struct.unpack_from("<H", packet, 2)[0]}')
            if packet[0] == 1:
                packet += self.receive(struct.unpack_from('<I', packet, 4)[0] * 4)
                if struct.unpack_from('<H', packet, 2)[0] == self.sequence:
                    return packet
        return None

    def key(self, code, pressed):
        """One XTestFakeInput key event, then a round trip so it is processed."""
        self.request(struct.pack('<BBHBBxxII8xhh7xB', self.opcode, 2, 9, 2 if pressed else 3,
                                 self.keycodes[code], 0, 0, 0, 0, 0))
        self.request(struct.pack('<BxH', 43, 1), reply=True)  # GetInputFocus

    def close(self):
        self.sock.close()


class Keyboard:
    def __init__(self, name, node, fd):
        self.name, self.node, self.fd = name, node, fd
        self.queue = collections.deque()  # (sent, type, code, value) not yet replayed
        self.expected = []  # the rest of the gesture in progress
        self.keys = None
        self.pressed = []  # kernel codes this keyboard holds down in X
        self.previous = None  # (sent, replayed) of the gesture's last replayed event
        self.gone = False


class Bridge:
    def __init__(self, display, state_socket, log):
        self.display, self.state_socket, self.out = display, state_socket, log
        self.x = None
        self.keyboards = []
        self.seen = set()  # sysfs input devices already handled; numbers are never reused
        self.waiting = {}  # VOCO devices whose event node isn't open yet: name -> first seen
        self.blocked = {}  # the last reason such a node didn't open
        self.warned = set()
        self.failed = False
        self.counts = {'devices': 0, 'gestures': 0, 'keys': 0, 'errors': 0}

    def log(self, event, **fields):
        self.out.write(json.dumps({'time': time.monotonic(), 'event': event, **fields}) + '\n')

    def error(self, detail, **fields):
        """Fail closed: report loudly, replay nothing more, release what X holds."""
        self.counts['errors'] += 1
        self.failed = True
        self.log('error', detail=detail, **fields)
        print(f'uinput-bridge: {detail}; no further keys are replayed', file=sys.stderr, flush=True)
        self.release_all()

    def release_all(self):
        for keyboard in self.keyboards:
            self.release(keyboard)
            keyboard.expected, keyboard.previous = [], None

    def release(self, keyboard):
        """Release in X what this keyboard still holds there, last press first."""
        released = [KEYS[code][0] for code in reversed(keyboard.pressed)]
        for code in reversed(keyboard.pressed):
            try:
                self.x.key(code, False)
            except (OSError, XError):
                break
        keyboard.pressed = []
        return released

    def scan(self):
        for entry in os.scandir('/sys/class/input'):
            if entry.name.startswith('input') and entry.name not in self.seen and entry.name not in self.waiting:
                try:
                    name = Path(entry.path, 'name').read_text().rstrip('\n')
                except OSError:
                    continue
                if name == DEVICE_NAME:
                    self.waiting[entry.name] = time.monotonic()
                else:
                    self.seen.add(entry.name)
        for name, first in list(self.waiting.items()):
            self.attach(name, first)

    def attach(self, name, first):
        device = Path('/sys/class/input', name)
        try:
            event = next((path for path in device.iterdir() if path.name.startswith('event')), None)
            if event is None:
                return  # evdev hasn't connected to it yet
            number = os.makedev(*map(int, (event / 'dev').read_text().split(':')))
            identity = ':'.join((device / 'id' / field).read_text().strip()
                                for field in ('bustype', 'vendor', 'product', 'version'))
        except OSError:
            if not device.exists():
                self.lost(name)
            return
        node = f'/dev/input/{event.name}'
        try:
            fd = os.open(node, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        except (PermissionError, FileNotFoundError) as error:
            # Until udev has applied the node's permissions.
            self.blocked[name] = f'{node}: {error.strerror}'
            if time.monotonic() - first > OPEN_WARNING_S and name not in self.warned:
                self.warned.add(name)
                self.log('late', device=name, detail=self.blocked[name])
            return
        try:
            if os.fstat(fd).st_rdev != number:
                raise OSError(errno.ENODEV, 'the node now belongs to another device')
            label = fcntl.ioctl(fd, EVIOCGNAME, bytes(256)).split(b'\0', 1)[0].decode()
            if label != DEVICE_NAME:
                raise OSError(errno.ENODEV, f'the node now belongs to {label!r}')
            fcntl.ioctl(fd, EVIOCSCLOCKID, struct.pack('i', CLOCK_MONOTONIC))
            fcntl.ioctl(fd, EVIOCGRAB, 1)
        except OSError as error:
            os.close(fd)
            if error.errno == errno.ENODEV:
                self.lost(name)
            else:
                del self.waiting[name]
                self.seen.add(name)
                self.error(f'Could not grab {node}: {error}', device=name)
            return
        del self.waiting[name]
        self.seen.add(name)
        self.keyboards.append(Keyboard(name, node, fd))
        self.counts['devices'] += 1
        self.log('grabbed', device=name, node=node, id=identity, after=time.monotonic() - first)

    def lost(self, name):
        """A VOCO keyboard that left before its grab may have typed into the console."""
        del self.waiting[name]
        self.seen.add(name)
        detail = f'; last open attempt: {self.blocked[name]}' if name in self.blocked else ''
        self.error(f'VOCO keyboard {name} disappeared before it was grabbed{detail}', device=name)

    def drain(self, keyboard):
        """Read everything the kernel holds now: a device's unread events vanish with it."""
        while not keyboard.gone:
            try:
                data = os.read(keyboard.fd, INPUT_EVENT.size * 64)
            except BlockingIOError:
                return
            except OSError as error:
                if error.errno != errno.ENODEV:
                    self.error(f'Reading {keyboard.node} failed: {error}', device=keyboard.name)
                data = b''
            if not data:
                keyboard.gone = True
                os.close(keyboard.fd)
                return
            for seconds, micros, kind, code, value in INPUT_EVENT.iter_unpack(data):
                if kind != EV_SYN or code == SYN_DROPPED:
                    keyboard.queue.append((seconds + micros / 1e6, kind, code, value))

    def replay(self, keyboard):
        """Replay due events in order; return how long until the next one is due."""
        while keyboard.queue:
            sent = keyboard.queue[0][0]
            if keyboard.previous is not None and not self.failed:
                wait = keyboard.previous[1] + sent - keyboard.previous[0] - time.monotonic()
                if wait > 0:
                    return wait
            self.event(keyboard, *keyboard.queue.popleft())
        return None

    def event(self, keyboard, sent, kind, code, value):
        where = {'device': keyboard.name, 'sent': sent}
        if self.failed:
            self.log('swallowed', type=kind, code=code, value=value, **where)
            return
        step = (code, value)
        if kind == EV_SYN:
            return self.error('The kernel dropped events from a VOCO keyboard (SYN_DROPPED)', **where)
        if kind != EV_KEY or code not in KEYS or value not in (0, 1):
            return self.error(f'Rejected input event type {kind} code {code} value {value}', **where)
        if not keyboard.expected:
            if step not in GESTURES:
                return self.error(f'Rejected {KEYS[code][0]} {"press" if value else "release"} outside a paste', **where)
            if any(other.expected for other in self.keyboards):
                return self.error('Rejected a paste while another VOCO keyboard was mid-paste', **where)
            steps, keyboard.keys = GESTURES[step]
            keyboard.expected = list(steps)
            if not self.ready_to_replay(where):
                return
            self.log('dispatch', keys=keyboard.keys, **self.input_state(where), **where)
            if self.failed:
                return
        if step != keyboard.expected[0]:
            return self.error(f'Rejected {KEYS[code][0]} {"press" if value else "release"} in {keyboard.keys}', **where)
        try:
            self.x.key(code, bool(value))
        except (OSError, XError) as error:
            return self.error(f'Replaying {KEYS[code][0]} on the private X server failed: {error}', **where)
        replayed = time.monotonic()
        keyboard.expected.pop(0)
        if value:
            keyboard.pressed.append(code)
        else:
            keyboard.pressed.remove(code)
        keyboard.previous = (sent, replayed)
        self.counts['keys'] += 1
        self.log('key', key=KEYS[code][0], pressed=bool(value), replayed=replayed, **where)
        if not keyboard.expected:
            self.completed(keyboard, where)

    def completed(self, keyboard, where, **fields):
        self.counts['gestures'] += 1
        self.log('completed', keys=keyboard.keys, **fields, **self.input_state(where), **where)
        keyboard.keys, keyboard.previous = None, None

    def ready_to_replay(self, where):
        if self.x is None:
            try:
                self.x = XTest(self.display)
            except (OSError, XError) as error:
                self.error(f'The private X server at {self.display} is unavailable: {error}', **where)
                return False
            self.log('x11', display=self.display,
                     keycodes={KEYS[code][0]: keycode for code, keycode in self.x.keycodes.items()})
        return True

    def input_state(self, where):
        if not self.state_socket:
            return {}
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC) as relay:
                relay.settimeout(2)
                relay.connect(self.state_socket)
                relay.sendall(b'GetInputState\n')
                reply = b''
                while not reply.endswith(b'\n'):
                    chunk = relay.recv(4096)
                    if not chunk:
                        raise OSError(errno.EPIPE, 'the relay closed the connection')
                    reply += chunk
            return {'input': json.loads(reply)}
        except (OSError, ValueError) as error:
            self.error(f'The private input state is unavailable: {error}', **where)
            return {}

    def finish(self, keyboard):
        """The device is gone and its events are replayed. The kernel released any
        key it still held, so the bridge releases those in X too."""
        self.keyboards.remove(keyboard)
        unfinished = list(keyboard.expected)
        pressed = list(keyboard.pressed)
        released = self.release(keyboard)
        self.log('removed', device=keyboard.name, released=released)
        if unfinished and not self.failed:
            # A process that exits right after its last key can take that key's
            # release with it; only a missing press means the paste was cut short.
            if all(value == 0 and code in pressed for code, value in unfinished):
                self.completed(keyboard, {'device': keyboard.name}, releasedWithDevice=released)
            else:
                self.error('A VOCO keyboard disappeared during a paste', device=keyboard.name)

    def run(self, stopping):
        self.scan()
        self.log('ready', pid=os.getpid(), display=self.display, inputState=self.state_socket)
        due = None
        while not stopping():
            timeout = 0.01 if due is None else max(0.0, min(0.01, due))
            live = [keyboard for keyboard in self.keyboards if not keyboard.gone]
            readable = select.select([keyboard.fd for keyboard in live], [], [], timeout)[0] if live else ()
            if not live:
                time.sleep(timeout)
            for keyboard in live:
                if keyboard.fd in readable:
                    self.drain(keyboard)
            due = None
            for keyboard in list(self.keyboards):
                wait = self.replay(keyboard)
                if wait is not None:
                    due = wait if due is None else min(due, wait)
                elif keyboard.gone:
                    self.finish(keyboard)
            self.scan()
        for keyboard in list(self.keyboards):
            if not keyboard.gone:
                self.drain(keyboard)
            if keyboard.queue or keyboard.expected:
                self.error('Stopped during a paste', device=keyboard.name)
            self.release(keyboard)
            if not keyboard.gone:
                os.close(keyboard.fd)  # closing ungrabs
        for name in list(self.waiting):
            detail = f'; last open attempt: {self.blocked[name]}' if name in self.blocked else ''
            self.error(f'VOCO keyboard {name} was never grabbed{detail}', device=name)
        if self.x is not None:
            self.x.close()
        self.log('stop', **self.counts)
        return 1 if self.counts['errors'] else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--display', required=True, help="the private Xvfb's Unix socket")
    parser.add_argument('--log', required=True, help='JSONL evidence, appended')
    parser.add_argument('--input-state', help="the private Shell's input-state relay socket")
    args = parser.parse_args()
    refuse_unless_disposable()
    stop = []
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, lambda *_: stop.append(True))
    # Stop with the harness even if it never gets to stop the bridge itself.
    parent = os.getppid()
    ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGTERM, 0, 0, 0)  # PR_SET_PDEATHSIG
    if os.getppid() != parent:
        sys.exit('uinput-bridge: the harness exited before the bridge started')
    with open(args.log, 'a', buffering=1) as log:
        sys.exit(Bridge(args.display, args.input_state, log).run(lambda: bool(stop)))


if __name__ == '__main__':
    main()
