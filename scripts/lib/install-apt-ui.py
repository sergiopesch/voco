#!/usr/bin/env python3
"""Observe separate APT status/output streams without changing terminal input.

APT closes its progress descriptor before invoking dpkg. The caller creates that
separate descriptor after sudo; package-script stdout/stderr stay intact. Unknown
output and non-newline prompts suspend presentation and remain visible.
"""
import contextlib
import os
import re
import select
import shutil
import sys
import time

# BEGIN GENERATED INSTALLER BRAND
BRAND_ROWS = [['██    ██', ' ██████ ', ' ██████ ', ' ██████ '], ['██    ██', '██    ██', '██      ', '██    ██'], [' ██  ██ ', '██    ██', '██      ', '██    ██'], ['  ████  ', '██    ██', '██      ', '██    ██'], ['   ██   ', ' ██████ ', ' ██████ ', ' ██████ ']]
BRAND_COLORS = {'silver': '\x1b[38;2;199;204;212m', 'shine': '\x1b[38;2;241;243;246m', 'muted': '\x1b[38;2;122;128;138m', 'complete': '\x1b[38;2;165;217;178m', 'active': '\x1b[38;2;239;206;131m'}
# END GENERATED INSTALLER BRAND

ROUTINE = re.compile(
    r'^(?:Reading package lists|Building dependency tree|Reading state information|'
    r'Note, selecting |The following (?:additional packages|NEW packages|packages will be upgraded)|'
    r'Suggested packages:|Recommended packages:|'
    r'\d+ upgraded, \d+ newly installed,|Need to get |After this operation, |'
    r'Get:\d+ |Fetched |Selecting previously unselected package |'
    r'\(Reading database|Preparing to unpack |Unpacking |Setting up |Processing triggers for |'
    r'debconf: delaying package configuration, since apt-utils is not installed$)'
)
STATUS = re.compile(r'^(pmstatus|dlstatus):([^:]*):([0-9]+(?:\.[0-9]+)?):(.*)$')


def main():
    path, no_motion = sys.argv[1:3]
    separate = len(sys.argv) > 3 and sys.argv[3] == 'separate'
    version = sys.argv[4] if len(sys.argv) > 4 else ''
    output_fd = 4 if separate else 0
    streams = [0, 4] if separate else [0]
    pending = {fd: b'' for fd in streams}
    passthrough = False
    detail = 'Resolving package dependencies.'
    mark = '—'
    start = time.monotonic()
    last_frame = 0.0
    dirty = True
    partial_since = None
    finished = False
    canvas_open = False
    size = shutil.get_terminal_size((80, 24))
    canvas_lines = 14 if size.columns >= 64 and size.lines >= 16 else 10

    def write(data):
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()

    def release():
        nonlocal canvas_open
        if canvas_open:
            up = f'\033[{canvas_lines}A'.encode()
            write(up + b'\r\033[K\n' * canvas_lines + up + b'\r')
            canvas_open = False

    def pass_output():
        nonlocal passthrough
        release()
        passthrough = True

    def frame(now):
        nonlocal last_frame, dirty, canvas_open
        width = max(10, shutil.get_terminal_size((80, 24)).columns - 5)
        age = now - start
        position = min(3, int(age * 8)) if no_motion != 'true' and age < .5 else -1
        reset = '\033[0m'
        if canvas_lines == 14:
            heading = [' '.join(BRAND_COLORS['shine' if i == position else 'silver'] + letter for i, letter in enumerate(row)) + reset for row in BRAND_ROWS]
            heading.append('Your voice, typed.  ·  v' + version)
        else:
            heading = [BRAND_COLORS['silver'] + 'V O C O' + reset + '  v' + version, 'Your voice, typed.']
        if not canvas_open:
            write(b'\n' * canvas_lines)
            canvas_open = True
        stages = BRAND_COLORS['complete'] + '✓ Check   ✓ Download   ✓ Verify   ' + BRAND_COLORS['active'] + '› Install' + reset
        lines = heading + ['', BRAND_COLORS['silver'] + mark + reset,
                 'Setting up VOCO.', detail[:width], '',
                 '────────────────────────────────────────────────────────'[:width],
                 stages, '']
        write((f'\033[{canvas_lines}A' + ''.join('\r\033[K  ' + line + '\n' for line in lines)).encode())
        last_frame = now
        dirty = False

    def status(raw):
        nonlocal passthrough, detail, mark, dirty
        text = raw.decode('utf-8', 'replace').rstrip('\r\n')
        match = STATUS.fullmatch(text)
        if match:
            kind, package, percent, description = match.groups()
            amount = float(percent)
            if not 0 <= amount <= 100:
                pass_output()
            elif not passthrough:
                # APT's phase progress is never whole-installer progress.
                detail = ('Desktop dependencies' if kind == 'dlstatus' else 'Package setup') + f' · {int(amount)}%'
                mark = '↓' if kind == 'dlstatus' else ' '.join('●' if amount >= step else '○' for step in (25, 50, 75, 100))
                dirty = True
            return True
        if text.startswith(('pmconffile:', 'media-change:', 'pmerror:')):
            pass_output()
            if text.startswith(('pmerror:', 'media-change:')):
                write(('\n' + text.split(':', 3)[-1] + '\n').encode())
            return True
        return False

    def line(fd, raw):
        nonlocal passthrough
        if (fd == 0 or not separate) and status(raw):
            return
        if separate and fd == 0:
            # Unknown protocol data belongs in the log; raw output remains visible.
            pass_output()
            return
        text = raw.decode('utf-8', 'replace').rstrip('\r\n')
        if not passthrough and (not text.strip() or ROUTINE.match(text)):
            return
        pass_output()
        write(raw)

    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
        log_file = os.fdopen(descriptor, 'ab', buffering=0)
    except OSError:
        log_file = None
        pass_output()
        write(b'Could not save installation details; continuing with terminal output.\n')
    with log_file if log_file is not None else contextlib.nullcontext() as log:
        while True:
            now = time.monotonic()
            if not passthrough and (dirty or (no_motion != 'true' and now - start < .5)) and now - last_frame >= .1:
                frame(now)
            timeout = None
            if not passthrough and (dirty or (no_motion != 'true' and now - start < .5)):
                timeout = max(0, .1 - (now - last_frame))
            if partial_since is not None:
                remaining = max(0, .05 - (now - partial_since))
                timeout = remaining if timeout is None else min(timeout, remaining)
            readable, _, _ = select.select(streams, [], [], 0 if finished else timeout)
            if finished and not readable:
                for fd, rest in pending.items():
                    if rest:
                        line(fd, rest)
                release()
                return
            for fd in readable:
                chunk = os.read(fd, 65536)
                if not chunk:
                    streams.remove(fd)
                    if fd == 0:
                        finished = True
                    continue
                if log is not None:
                    try:
                        log.write(chunk)
                    except OSError:
                        log = None
                        pass_output()
                        write(b'Could not save installation details; continuing with terminal output.\n')
                pending[fd] += chunk
                while b'\n' in pending[fd]:
                    raw, pending[fd] = pending[fd].split(b'\n', 1)
                    line(fd, raw + b'\n')
                if fd == output_fd:
                    if not pending[fd]:
                        partial_since = None
                    elif partial_since is None:
                        partial_since = time.monotonic()
                elif len(pending[fd]) > 8192:
                    pass_output()
                    pending[fd] = b''
            rest = pending[output_fd]
            if rest and (len(rest) > 8192 or (partial_since is not None and time.monotonic() - partial_since >= .05)):
                pass_output()
                write(rest)
                pending[output_fd] = b''
                partial_since = None


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
