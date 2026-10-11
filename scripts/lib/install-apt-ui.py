#!/usr/bin/env python3
"""Observe separate APT status/output streams without changing terminal input.

APT closes its progress descriptor before invoking dpkg. The caller creates that
separate descriptor after sudo; package-script stdout/stderr stay intact. Unknown
output and non-newline prompts suspend presentation and remain visible.
"""
import contextlib
import itertools
import os
import re
import select
import shutil
import sys
import time

# BEGIN GENERATED INSTALLER BRAND
BRAND_COLORS = {'silver': '\x1b[38;2;199;204;212m', 'muted': '\x1b[38;2;122;128;138m', 'complete': '\x1b[38;2;165;217;178m', 'active': '\x1b[38;2;239;206;131m'}
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
# install-ui.sh's art canvas: the card's size, and its shine.
CARD_ROWS = 11
SHINE_MS = 280
ART_LINES = CARD_ROWS + 2 + 8


def runs(kinds, graphite, lit, glow):
    """A wordmark row's right part from its kinds, as install-ui.sh's
    voco_ui_runs writes it: one SGR for each run of graphite (0), lit (1) or
    shining (2) cells."""
    out = []
    for kind, group in itertools.groupby(kinds):
        count = len(list(group))
        out.append(graphite + ' ' * count if kind == '0' else (lit if kind == '1' else glow) + '▀' * count)
    return ''.join(out)


def card_rows(card, shine, shine_ms=-1):
    """The card's 13 lines as install-ui.sh passes them: the edges whole and each
    row as its left and right parts, with the wordmark's right parts drawn again
    for the shine shine_ms milliseconds in, when that isn't negative."""
    lines = card.split('\n')
    rows = [lines[0]] + [tuple(line.split('\t', 1)) for line in lines[1:CARD_ROWS + 1]] + [lines[CARD_ROWS + 1]]
    if shine_ms >= 0:
        graphite, glow, *wordmark = shine.split('\n')
        band = -8 + shine_ms * 51 // SHINE_MS
        for row, spec in enumerate(wordmark[:5]):
            lit, kinds = spec.split('\t')
            kinds = list(kinds)
            # The same slanted band, three columns wide, as voco_ui_card_at's.
            for cell in range(max(0, band + 7 - row), min(len(kinds), band + 10 - row)):
                if kinds[cell] == '1':
                    kinds[cell] = '2'
            rows[row + 3] = (rows[row + 3][0], runs(kinds, graphite, lit, glow))
    return rows


def main():
    path, no_motion = sys.argv[1:3]
    separate = len(sys.argv) > 3 and sys.argv[3] == 'separate'
    version = sys.argv[4] if len(sys.argv) > 4 else ''
    # The installer passes its canvas height, so both renderers agree on it, then
    # its card at rest, what the shine needs, and the commands that place the
    # image after the card and take it away.
    canvas_lines = ART_LINES if len(sys.argv) > 9 and sys.argv[5] == str(ART_LINES) else 10
    card, shine, place, unplace = sys.argv[6:10] if canvas_lines == ART_LINES else ('', '', '', '')
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
    card_drawn = False
    # What the canvas shows, by line, so a frame redraws only what changed.
    shown = {}

    def write(data):
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()

    def release():
        nonlocal canvas_open, card_drawn
        if canvas_open:
            # The image would stay where the canvas was, so it goes first.
            up = f'\033[{canvas_lines}A'.encode()
            write(unplace.encode() + up + b'\r\033[K\n' * canvas_lines + up + b'\r')
            canvas_open = False
            card_drawn = False
            shown.clear()

    def pass_output():
        nonlocal passthrough
        release()
        passthrough = True

    def shining(now):
        return no_motion != 'true' and canvas_lines == ART_LINES and now - start < SHINE_MS / 1000

    def frame(now):
        nonlocal last_frame, dirty, canvas_open, card_drawn
        width = max(10, shutil.get_terminal_size((80, 24)).columns - 5)
        reset = '\033[0m'
        if not canvas_open:
            write(b'\n' * canvas_lines)
            canvas_open = True
        stages = BRAND_COLORS['complete'] + '✓ Check   ✓ Download   ✓ Verify   ' + BRAND_COLORS['active'] + '› Install' + reset
        progress = ['', BRAND_COLORS['silver'] + mark + reset,
                    'Setting up VOCO.', detail[:width], '',
                    '────────────────────────────────────────────────────────'[:width],
                    stages, '']
        lines = {}
        first = 0
        if canvas_lines == ART_LINES:
            if card_drawn and not shining(now):
                # A card at rest stays on screen; only the progress lines change.
                first = canvas_lines - len(progress)
            else:
                shine_ms = int((now - start) * 1000) if shining(now) else -1
                lines = dict(enumerate(card_rows(card, shine, shine_ms)))
                card_drawn = shine_ms < 0
        else:
            lines = {0: BRAND_COLORS['silver'] + 'V O C O' + reset + '  v' + version,
                     1: 'The voice layer for Linux. Today: private dictation.'}
        lines.update(enumerate(progress, canvas_lines - len(progress)))
        text, redrawn = '', False
        for index in range(first, canvas_lines):
            line = lines[index]
            if isinstance(line, tuple):
                left, right = line
                if shown.get(index, ('',))[0] != left or index not in shown:
                    text += '\r\033[K  ' + left + right + '\033[0m\n'
                    redrawn = True
                elif shown[index][1] != right:
                    # Column 19 is the card's column 16, after the microphone.
                    text += '\033[19G' + right + '\033[0m\033[K\n'
                else:
                    text += '\n'
            elif shown.get(index) != line:
                text += '\r\033[K  ' + line + ('\033[0m' if canvas_lines == ART_LINES and index in (0, CARD_ROWS + 1) else '') + '\n'
            else:
                text += '\n'
            shown[index] = line
            if index == CARD_ROWS + 1 and redrawn:
                text += place
        up = canvas_lines - first
        write((f'\033[{up}A' + text).encode())
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
            # About 30 frames a second until the card rests, otherwise 10 at most.
            moving = canvas_lines == ART_LINES and (shining(now) or (canvas_open and not card_drawn))
            interval = .033 if moving else .1
            if not passthrough and (dirty or moving) and now - last_frame >= interval:
                frame(now)
            timeout = None
            if not passthrough and (dirty or moving):
                timeout = max(0, interval - (now - last_frame))
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
