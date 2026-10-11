#!/usr/bin/env python3
"""Keep the downloaded single-file installer identical to its maintainable sources:
the install steps setup.sh also sources, and the UI."""
import argparse
import base64
import importlib.util
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEPS = ('# BEGIN EMBEDDED INSTALL STEPS\n', '# END EMBEDDED INSTALL STEPS\n')
UI = ('# BEGIN EMBEDDED INSTALLER UI\n', '# END EMBEDDED INSTALLER UI\n')


def rgb_valid(rgb):
    return len(rgb) == 3 and all(type(value) is int and 0 <= value <= 255 for value in rgb)


def art_sources(brand):
    """The microphone: its palette, its three mosaics and its image, checked."""
    art = brand['art']
    spec = importlib.util.spec_from_file_location('installer_art', ROOT / 'scripts/generate-installer-art.py')
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    palette = art['palette']
    if art['columns'] != 14 or art['rows'] != 11 or not 2 <= len(palette) <= 256 or \
            any(len(value) != 6 or set(value) - set('0123456789abcdef') for value in palette):
        raise ValueError('The installer microphone needs 14 × 11 cells and a palette of hex colours')
    mosaics = {}
    for kind in ('octant', 'sextant', 'quadrant'):
        rows, allowed = art['mosaic'][kind], set(generator.symbols(kind)) | {' '}
        cells = [cell for row in rows for cell in row]
        if len(rows) != 11 or any(len(row) != 14 for row in rows) or any(
                cell[:-4] not in allowed or int(cell[-4:-2], 16) >= len(palette) or
                int(cell[-2:], 16) >= len(palette) for cell in cells):
            raise ValueError(f'The {kind} mosaic needs 14 × 11 cells of its own symbols and palette colours')
        mosaics[kind] = rows
    image = art['image']
    blob = base64.b64decode(image['png'], validate=True)
    width, height = image['width'], image['height']
    left, top, mic_width, mic_height = image['mic']
    if not blob.startswith(b'\x89PNG\r\n\x1a\n') or len(blob) > 16384 or \
            not (0 <= left and 0 <= top and left + mic_width <= width and top + mic_height <= height):
        raise ValueError('The installer image must be a PNG of at most 16 KiB around its microphone')
    rgb = [';'.join(str(byte) for byte in bytes.fromhex(value)) for value in palette]
    return rgb, mosaics, image


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
    mic_palette, mosaics, image = art_sources(brand)
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
    shell += ('# The microphone, from ' + brand['art']['source'] + ' by generate-installer-art.py: its\n'
              '# palette, a mosaic of block symbols for each kind of terminal, and its image.\n')
    shell += 'VOCO_UI_PALETTE=(' + ' '.join(f"'{rgb}'" for rgb in mic_palette) + ')\n'
    # A cell is a block symbol and four hex digits, which need no quotes; only
    # the blank symbol, a space, does.
    for kind, lines in mosaics.items():
        shell += f'VOCO_UI_MOSAIC_{kind.upper()}=(\n' + ''.join(
            '  ' + ' '.join(shlex.quote(cell) if cell[0] == ' ' else cell for cell in line) + '\n'
            for line in lines) + ')\n'
    shell += f"VOCO_UI_IMAGE_SIZE=({image['width']} {image['height']})\n"
    shell += 'VOCO_UI_IMAGE_MIC=(' + ' '.join(map(str, image['mic'])) + ')\n'
    shell += f"VOCO_UI_IMAGE_PNG='{image['png']}'\n"
    # The APT display draws the card install-ui.sh passes it, so it keeps only
    # the progress palette.
    python = 'BRAND_COLORS = ' + repr({name: '\033[38;2;' + ';'.join(map(str, rgb)) + 'm' for name, rgb in palette.items()}) + '\n'
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
