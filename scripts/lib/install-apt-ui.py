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
BRAND_COLORS = {'silver': '\x1b[38;2;199;204;212m', 'muted': '\x1b[38;2;122;128;138m', 'complete': '\x1b[38;2;165;217;178m', 'active': '\x1b[38;2;239;206;131m'}
BRAND_CARD = '17;19;24'
BRAND_WORDMARK = ['244;246;249', '233;236;240', '222;225;230', '210;214;221', '199;204;212', '188;193;202', '177;182;192', '165;172;181', '154;161;171', '143;150;161']
BRAND_WORDMARK_SHINE = ['255;255;255', '238;241;245']
BRAND_TEXT = {'brand': '199;204;212', 'today': '174;181;191', 'version': '140;146;156'}
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
# install-ui.sh's art canvas: the card's size and layout, and its shine.
CARD_WIDTH = 58
CARD_ROWS = 11
ART_RIGHT = 19
SHINE_MS = 280
ART_LINES = CARD_ROWS + 2 + 8


def card_lines(version, mic, shine_ms=-1):
    """The card at rest, exactly as install-ui.sh draws it: with the microphone
    rows install-ui.sh passes in, and the shine shine_ms milliseconds in, or
    none when negative."""
    card = f'\033[48;2;{BRAND_CARD}m '
    edge = f'\033[38;2;{BRAND_CARD};49m'
    band = -100 if shine_ms < 0 else -8 + shine_ms * 51 // SHINE_MS
    lines = [edge + '▗' + (edge + '▄') * (CARD_WIDTH - 2) + edge + '▖']
    for r in range(CARD_ROWS):
        row = [card] * CARD_WIDTH
        # The microphone's fourteen cells, as one string.
        if len(mic) == CARD_ROWS:
            row[2:16] = [mic[r]] + [''] * 13

        def text(value, color, start):
            for i, char in enumerate(value):
                row[start + i] = f'\033[38;2;{color};48;2;{BRAND_CARD}m{char}'
        if r == 0:
            label = 'v' + version
            text(label, BRAND_TEXT['version'], ART_RIGHT + 37 - len(label))
        elif 2 <= r <= 6:
            glyph_row = r - 2
            for letter, glyph in enumerate(BRAND_ROWS[glyph_row]):
                for column, char in enumerate(glyph):
                    x = ART_RIGHT + letter * 9 + column
                    if char != '█' or x >= CARD_WIDTH - 2:
                        continue
                    lit = (BRAND_WORDMARK_SHINE if band + 4 - glyph_row <= x - ART_RIGHT < band + 7 - glyph_row
                           else BRAND_WORDMARK[2 * glyph_row:2 * glyph_row + 2])
                    row[x] = f'\033[38;2;{lit[0]};48;2;{lit[1]}m▀'
        elif r == 8:
            text('The voice layer for Linux.', BRAND_TEXT['brand'], ART_RIGHT)
        elif r == 9:
            text('Today: private dictation.', BRAND_TEXT['today'], ART_RIGHT)
        lines.append(''.join(row))
    lines.append(edge + '▝' + (edge + '▀') * (CARD_WIDTH - 2) + edge + '▘')
    return [line + '\033[0m' for line in lines]


def main():
    path, no_motion = sys.argv[1:3]
    separate = len(sys.argv) > 3 and sys.argv[3] == 'separate'
    version = sys.argv[4] if len(sys.argv) > 4 else ''
    # The installer passes its canvas height, so both renderers agree on it, then
    # the card's microphone rows and the commands that place its image after the
    # card and take it away.
    canvas_lines = ART_LINES if len(sys.argv) > 5 and sys.argv[5] == str(ART_LINES) else 10
    mic = sys.argv[6].split('\n')[:CARD_ROWS] if len(sys.argv) > 6 else []
    place = sys.argv[7] if len(sys.argv) > 7 else ''
    unplace = sys.argv[8] if len(sys.argv) > 8 else ''
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
        drawn = lambda lines: ''.join('\r\033[K  ' + line + '\n' for line in lines)
        if canvas_lines == ART_LINES:
            if card_drawn and not shining(now):
                # A card at rest stays on screen; only the progress lines change.
                text, up = drawn(progress), len(progress)
            else:
                shine = int((now - start) * 1000) if shining(now) else -1
                text, up = drawn(card_lines(version, mic, shine)) + place + drawn(progress), canvas_lines
                card_drawn = shine < 0
        else:
            heading = [BRAND_COLORS['silver'] + 'V O C O' + reset + '  v' + version, 'The voice layer for Linux. Today: private dictation.']
            text, up = drawn(heading + progress), canvas_lines
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
