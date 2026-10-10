#!/usr/bin/env python3
"""Keep the downloaded single-file installer identical to its maintainable sources:
the install steps setup.sh also sources, and the UI."""
import argparse
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEPS = ('# BEGIN EMBEDDED INSTALL STEPS\n', '# END EMBEDDED INSTALL STEPS\n')
UI = ('# BEGIN EMBEDDED INSTALLER UI\n', '# END EMBEDDED INSTALLER UI\n')


def rgb_valid(rgb):
    return len(rgb) == 3 and all(type(value) is int and 0 <= value <= 255 for value in rgb)


def microphone(brand):
    """The art canvas's microphone: rows of 'r;g;b' pixels, two to each cell."""
    mic = brand['mic']
    width, height, rows = mic['width'], mic['height'], mic['rows']
    if width != 14 or height != 22 or len(rows) != height:
        raise ValueError('The installer microphone must be 14 × 22 pixels')
    pixels = []
    for row in rows:
        values = row.split(' ')
        if len(values) != width or any(len(value) != 6 for value in values):
            raise ValueError('Each microphone row needs 14 six-digit hex pixels')
        pixels.append([';'.join(str(byte) for byte in bytes.fromhex(value)) for value in values])
    return pixels


def brand_sources():
    brand = json.loads((ROOT / 'scripts/lib/install-brand.json').read_text())
    rows, palette = brand['rows'], brand['palette']
    if len(rows) != 5 or any(len(row) != 4 or any(len(letter) != 8 or set(letter) - {' ', '█'} for letter in row) for row in rows):
        raise ValueError('Installer wordmark must contain five rows of four eight-column glyphs')
    if set(palette) != {'silver', 'muted', 'complete', 'active'} or not all(map(rgb_valid, palette.values())):
        raise ValueError('Invalid installer brand palette')
    gradient, shine, sweep, text, ease = (brand['wordmark'], brand['wordmarkShine'], brand['sweep'],
                                          brand['text'], brand['ease'])
    if not rgb_valid(brand['card']) or len(gradient) != 10 or len(shine) != 2 or len(sweep) != 2 \
            or not all(map(rgb_valid, gradient + shine + sweep)) or set(text) != {'brand', 'today', 'version'} \
            or not all(map(rgb_valid, text.values())):
        raise ValueError('Invalid installer art colours')
    if len(ease) != 21 or ease[0] != 0 or ease[-1] != 1000 or ease != sorted(ease):
        raise ValueError('The installer easing table needs 21 rising steps from 0 to 1000')
    pixels = microphone(brand)
    triple = lambda rgb: ';'.join(map(str, rgb))
    shell = 'VOCO_UI_GLYPHS=(\n' + ''.join('  ' + ' '.join(shlex.quote(letter) for letter in row) + '\n' for row in rows) + ')\n'
    for name, rgb in palette.items():
        shell += f"VOCO_UI_{name.upper()}='\\033[38;2;{';'.join(map(str, rgb))}m'\n"
    shell += f"VOCO_UI_CARD='{triple(brand['card'])}'\n"
    shell += 'VOCO_UI_WORDMARK=(' + ' '.join(f"'{triple(rgb)}'" for rgb in gradient) + ')\n'
    shell += 'VOCO_UI_WORDMARK_SHINE=(' + ' '.join(f"'{triple(rgb)}'" for rgb in shine) + ')\n'
    shell += 'VOCO_UI_SWEEP=(' + ' '.join(f"'{triple(rgb)}'" for rgb in sweep) + ')\n'
    for name, rgb in text.items():
        shell += f"VOCO_UI_TEXT_{name.upper()}='{triple(rgb)}'\n"
    shell += 'VOCO_UI_EASE=(' + ' '.join(map(str, ease)) + ')\n'
    shell += '# The microphone, from ' + brand['mic']['source'] + ' by generate-installer-art.py.\n'
    shell += 'VOCO_UI_MIC=(\n' + ''.join('  ' + ' '.join(f"'{pixel}'" for pixel in row) + '\n' for row in pixels) + ')\n'
    python = 'BRAND_ROWS = ' + repr(rows) + '\n'
    python += 'BRAND_COLORS = ' + repr({name: '\033[38;2;' + ';'.join(map(str, rgb)) + 'm' for name, rgb in palette.items()}) + '\n'
    python += 'BRAND_CARD = ' + repr(triple(brand['card'])) + '\n'
    python += 'BRAND_WORDMARK = ' + repr([triple(rgb) for rgb in gradient]) + '\n'
    python += 'BRAND_WORDMARK_SHINE = ' + repr([triple(rgb) for rgb in shine]) + '\n'
    python += 'BRAND_TEXT = ' + repr({name: triple(rgb) for name, rgb in text.items()}) + '\n'
    python += 'BRAND_MIC = [\n' + ''.join('    ' + repr(row) + ',\n' for row in pixels) + ']\n'
    return shell, python


def with_brand(content, generated):
    start, end = '# BEGIN GENERATED INSTALLER BRAND\n', '# END GENERATED INSTALLER BRAND\n'
    before, rest = content.split(start, 1)
    _, after = rest.split(end, 1)
    return before + start + generated + end + after


def embedded(content, markers, body):
    # A missing, repeated or misordered marker fails; it never embeds a partial file.
    start_marker, end_marker = markers
    start = content.find(start_marker)
    end = content.find(end_marker, start)
    if content.count(start_marker) != 1 or content.count(end_marker) != 1 or not 0 <= start < end:
        raise SystemExit(f'install must contain exactly one {start_marker.strip()} block')
    return content[:start] + start_marker + body + content[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'install'
    content = path.read_text()
    sources = []
    for name, brand in zip(('install-ui.sh', 'install-apt-ui.py'), brand_sources()):
        source = ROOT / 'scripts/lib' / name
        original = source.read_text()
        generated = with_brand(original, brand)
        if args.check and generated != original:
            raise SystemExit('Installer brand is stale. Run python3 scripts/sync-installer-ui.py')
        if not args.check and generated != original:
            source.write_text(generated)
        sources.append(generated)
    ui, apt_ui = sources
    ui += "\nvoco_apt_display() {\n  local code\n  IFS= read -r -d '' code <<'VOCO_APT_PY' || true\n" + apt_ui + "VOCO_APT_PY\n  python3 -I -c \"$code\" \"$@\"\n}\n"
    updated = embedded(content, STEPS, (ROOT / 'scripts/lib/install-common.sh').read_text())
    updated = embedded(updated, UI, ui)
    if args.check:
        if updated != content:
            raise SystemExit('The installer is stale. Run python3 scripts/sync-installer-ui.py')
    else:
        path.write_text(updated)


if __name__ == '__main__':
    main()
