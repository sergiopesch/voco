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
BRAND_MIC = [
    ['19;20;25', '9;10;15', '50;51;55', '167;166;167', '174;171;172', '208;205;205', '177;175;174', '178;176;175', '206;203;203', '170;168;168', '170;168;170', '54;55;59', '8;9;15', '19;20;25'],
    ['16;17;22', '18;19;24', '180;178;179', '96;94;94', '60;58;58', '187;185;185', '50;49;49', '48;47;47', '185;182;182', '61;59;59', '99;96;96', '190;188;189', '21;22;27', '15;17;22'],
    ['7;8;13', '61;61;65', '178;176;176', '37;35;35', '76;75;75', '191;189;189', '65;63;63', '60;58;58', '187;185;185', '80;78;78', '36;34;34', '177;174;174', '68;68;72', '6;7;12'],
    ['7;8;13', '62;63;67', '177;175;175', '47;45;46', '76;74;74', '193;192;192', '65;63;63', '61;59;59', '190;189;188', '79;78;78', '45;43;43', '172;169;169', '69;69;72', '6;7;12'],
    ['7;8;13', '62;62;67', '176;174;174', '47;45;45', '76;74;74', '192;191;191', '64;62;63', '61;59;59', '190;188;188', '80;78;78', '45;43;43', '171;168;168', '67;67;71', '6;7;12'],
    ['7;8;13', '62;62;67', '175;172;172', '47;46;46', '77;76;76', '190;188;188', '63;61;62', '60;58;59', '188;185;185', '79;78;78', '46;44;44', '167;165;164', '66;66;70', '6;7;13'],
    ['7;8;13', '61;62;66', '172;170;170', '47;45;46', '76;74;74', '187;185;185', '64;62;62', '62;60;60', '184;182;182', '78;76;76', '45;43;44', '165;162;162', '65;65;69', '6;8;13'],
    ['10;11;17', '62;62;66', '168;165;165', '46;44;45', '75;73;73', '184;181;181', '62;60;61', '60;58;58', '180;178;178', '76;74;74', '45;43;44', '162;160;159', '66;66;70', '10;11;16'],
    ['0;0;1', '53;54;58', '165;162;162', '45;44;44', '75;73;73', '179;177;177', '61;59;59', '59;57;57', '175;172;172', '74;71;72', '44;42;42', '159;157;157', '56;56;60', '0;0;0'],
    ['140;139;141', '119;118;120', '151;148;148', '49;47;47', '76;74;74', '177;175;175', '62;60;60', '62;60;60', '173;171;170', '74;72;72', '47;45;46', '145;142;143', '121;120;122', '147;146;148'],
    ['233;231;231', '160;158;158', '140;138;138', '28;26;26', '57;55;55', '170;167;167', '40;38;38', '40;39;39', '165;163;163', '55;53;53', '29;27;27', '133;131;131', '164;162;164', '239;236;235'],
    ['210;208;209', '136;134;135', '168;166;166', '128;126;126', '148;147;146', '205;204;203', '140;139;138', '137;135;135', '194;193;192', '136;135;134', '117;115;115', '168;166;166', '141;139;141', '216;213;212'],
    ['210;208;208', '129;127;128', '182;179;179', '237;234;233', '255;255;255', '251;249;249', '246;243;243', '227;224;223', '200;197;197', '192;190;189', '183;181;180', '205;202;201', '140;138;140', '213;210;210'],
    ['210;207;207', '101;100;102', '138;135;136', '187;184;184', '217;215;215', '221;219;219', '201;199;199', '181;178;178', '164;161;161', '148;145;145', '143;140;141', '159;155;155', '112;110;112', '214;211;210'],
    ['207;205;205', '79;78;81', '134;132;133', '198;196;195', '237;235;235', '240;238;238', '222;219;219', '199;196;196', '181;178;178', '164;162;161', '161;159;159', '162;160;159', '86;85;88', '213;210;209'],
    ['203;200;200', '79;78;81', '117;115;116', '191;189;188', '226;224;224', '238;236;235', '222;219;219', '199;196;196', '180;177;177', '158;155;156', '174;172;171', '138;136;136', '79;79;83', '200;196;196'],
    ['163;161;162', '142;141;142', '34;34;38', '171;166;165', '199;196;195', '216;214;213', '201;199;199', '180;177;177', '163;160;160', '159;156;156', '177;174;173', '38;37;42', '139;138;140', '157;154;155'],
    ['61;61;65', '219;215;215', '75;74;78', '36;35;39', '120;117;117', '154;151;151', '168;165;165', '152;149;149', '134;131;131', '116;114;114', '37;37;40', '74;74;78', '212;209;208', '59;58;62'],
    ['6;7;12', '101;99;102', '218;214;214', '139;137;139', '72;72;76', '101;99;101', '208;205;205', '166;163;162', '94;92;93', '74;73;77', '135;134;136', '209;205;205', '96;94;96', '7;8;13'],
    ['19;20;24', '6;7;12', '63;62;66', '155;152;154', '182;179;180', '176;172;173', '237;235;235', '178;175;175', '149;146;146', '180;177;177', '143;140;141', '59;58;61', '7;8;13', '18;19;24'],
    ['17;18;23', '20;21;26', '5;6;12', '40;40;44', '76;75;78', '149;146;147', '243;241;241', '194;191;192', '127;125;126', '76;75;78', '45;45;49', '6;7;13', '20;21;25', '17;18;23'],
    ['17;18;23', '18;19;24', '14;15;21', '106;104;106', '183;179;179', '224;222;221', '221;218;218', '191;188;188', '159;156;156', '163;160;159', '123;121;122', '13;14;19', '18;19;24', '17;18;23'],
]
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


def card_lines(version, shine_ms=-1):
    """The card at rest, exactly as install-ui.sh draws it, with the shine
    shine_ms milliseconds in, or none when negative."""
    card = f'\033[48;2;{BRAND_CARD}m '
    edge = f'\033[38;2;{BRAND_CARD};49m'
    band = -100 if shine_ms < 0 else -8 + shine_ms * 51 // SHINE_MS
    lines = [edge + '▗' + (edge + '▄') * (CARD_WIDTH - 2) + edge + '▖']
    for r in range(CARD_ROWS):
        row = [f'\033[38;2;{BRAND_MIC[2 * r][x - 2]};48;2;{BRAND_MIC[2 * r + 1][x - 2]}m▀' if 2 <= x < 16 else card
               for x in range(CARD_WIDTH)]

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
    # The installer passes its canvas height, so both renderers agree on it.
    canvas_lines = ART_LINES if len(sys.argv) > 5 and sys.argv[5] == str(ART_LINES) else 10
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
            up = f'\033[{canvas_lines}A'.encode()
            write(up + b'\r\033[K\n' * canvas_lines + up + b'\r')
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
        if canvas_lines == ART_LINES:
            if card_drawn and not shining(now):
                # A card at rest stays on screen; only the progress lines change.
                lines, up = progress, len(progress)
            else:
                shine = int((now - start) * 1000) if shining(now) else -1
                lines, up = card_lines(version, shine) + progress, canvas_lines
                card_drawn = shine < 0
        else:
            heading = [BRAND_COLORS['silver'] + 'V O C O' + reset + '  v' + version, 'The voice layer for Linux. Today: private dictation.']
            lines, up = heading + progress, canvas_lines
        write((f'\033[{up}A' + ''.join('\r\033[K  ' + line + '\n' for line in lines)).encode())
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
