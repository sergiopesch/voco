#!/usr/bin/env python3
"""Draw the installer's terminal microphone from assets/voco-symbol.png.

ffmpeg composites the optical master onto the installer card's graphite, crops
it to the microphone and scales it with Lanczos to MIC_WIDTH × MIC_HEIGHT
pixels, two to each half-block cell. The pixels go into
scripts/lib/install-brand.json, which sync-installer-ui.py embeds into the
installer, so the installer itself never reads an image. ffmpeg is the only
external requirement, as for scripts/generate-icons.py.

  python3 scripts/generate-installer-art.py [--check]
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/voco-symbol.png'
BRAND = ROOT / 'scripts/lib/install-brand.json'
# 561 × 890 source pixels, so 14 × 22 keeps the microphone's proportions to 1%.
MIC_WIDTH = 14
MIC_HEIGHT = 22
# Alpha above this counts as part of the microphone when finding its bounds.
ALPHA_FLOOR = 32
# ffmpeg releases round the Lanczos scale differently, by up to two levels a channel.
TOLERANCE = 2


def ffmpeg(ffmpeg_path, arguments):
    return subprocess.run([ffmpeg_path, '-v', 'error', '-nostdin', '-y', *arguments],
                          check=True, stdout=subprocess.PIPE).stdout


def bounds(ffmpeg_path):
    """The opaque microphone's box in the square master: left, top, width, height."""
    rgba = ffmpeg(ffmpeg_path, ['-i', str(SOURCE), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    size = int((len(rgba) // 4) ** 0.5)
    if size * size * 4 != len(rgba):
        raise SystemExit(f'{SOURCE} is not square')
    alpha = rgba[3::4]
    rows = [y for y in range(size) if max(alpha[y * size:(y + 1) * size]) > ALPHA_FLOOR]
    columns = [x for x in range(size) if max(alpha[x::size]) > ALPHA_FLOOR]
    return columns[0], rows[0], columns[-1] - columns[0] + 1, rows[-1] - rows[0] + 1, size


def microphone(ffmpeg_path, card):
    left, top, width, height, size = bounds(ffmpeg_path)
    # Composite first, so the downscale blends edges with the graphite the card
    # shows, never with the transparent pixels' black.
    graphite = '0x%02x%02x%02x' % tuple(card)
    rgb = ffmpeg(ffmpeg_path, [
        '-f', 'lavfi', '-i', f'color=c={graphite}:s={size}x{size}', '-i', str(SOURCE),
        '-filter_complex',
        f'[0:v][1:v]overlay=format=auto,crop={width}:{height}:{left}:{top},'
        f'scale={MIC_WIDTH}:{MIC_HEIGHT}:flags=lanczos,format=rgb24',
        '-frames:v', '1', '-f', 'rawvideo', '-'])
    if len(rgb) != MIC_WIDTH * MIC_HEIGHT * 3:
        raise SystemExit('ffmpeg returned an unexpected image size')
    rows = []
    for y in range(MIC_HEIGHT):
        line = rgb[y * MIC_WIDTH * 3:(y + 1) * MIC_WIDTH * 3]
        rows.append(' '.join(line[x * 3:x * 3 + 3].hex() for x in range(MIC_WIDTH)))
    return {'source': SOURCE.relative_to(ROOT).as_posix(), 'width': MIC_WIDTH, 'height': MIC_HEIGHT, 'rows': rows}


def matches(stored, drawn):
    if not stored or {key: stored[key] for key in ('source', 'width', 'height')} != \
            {key: drawn[key] for key in ('source', 'width', 'height')} or len(stored['rows']) != len(drawn['rows']):
        return False
    for kept, fresh in zip(stored['rows'], drawn['rows']):
        kept, fresh = bytes.fromhex(kept.replace(' ', '')), bytes.fromhex(fresh.replace(' ', ''))
        if len(kept) != len(fresh) or any(abs(a - b) > TOLERANCE for a, b in zip(kept, fresh)):
            return False
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--check', action='store_true', help='fail if the brand data is stale')
    arguments = parser.parse_args()
    ffmpeg_path = shutil.which('ffmpeg')
    if not ffmpeg_path:
        raise SystemExit('ffmpeg is required to draw the installer microphone')
    brand = json.loads(BRAND.read_text())
    drawn = microphone(ffmpeg_path, brand['card'])
    if arguments.check:
        if not matches(brand.get('mic'), drawn):
            raise SystemExit('The installer microphone is stale. Run python3 scripts/generate-installer-art.py')
        return
    brand['mic'] = drawn
    BRAND.write_text(json.dumps(brand, indent=2) + '\n')
    print(f'Drew a {MIC_WIDTH} × {MIC_HEIGHT} microphone into {BRAND.relative_to(ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
