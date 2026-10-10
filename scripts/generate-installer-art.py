#!/usr/bin/env python3
"""Draw the installer's microphone from assets/voco-symbol.png, for each way a
terminal can show it.

- The image: a PNG for terminals that show pictures through the kitty graphics
  protocol, about twice the size the card shows it at on a HiDPI screen. It
  keeps graphite room around the microphone, so the installer can crop it to
  the shape of any terminal's cells and never stretch it.
- The mosaics: the microphone in the card's 14 × 11 cells of block symbols, for
  every other terminal. There is one for terminals that draw octants
  themselves, one for sextants and one for quadrants. Each cell gets the symbol
  and the two colours closest to the image, as chafa chooses them.

ffmpeg composites and scales the optical master. Everything after that is
plain Python, so nothing else is needed. The results go into
scripts/lib/install-brand.json, which sync-installer-ui.py embeds into the
installer, so the installer itself never reads an image.

  python3 scripts/generate-installer-art.py [--check]
"""
import argparse
import base64
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/voco-symbol.png'
BRAND = ROOT / 'scripts/lib/install-brand.json'
# The card's microphone cells.
COLUMNS = 14
ROWS = 11
# Alpha above this counts as part of the microphone when finding its bounds.
ALPHA_FLOOR = 32
# The image: the microphone's height in pixels, about twice the card's 11 rows
# on a HiDPI screen, and the cell shapes (width over height) its graphite room
# serves without stretching.
IMAGE_HEIGHT = 400
CELL_SHAPES = (0.40, 0.65)
# Colours in the image's palette, which the mosaics share.
COLORS = 40
# Each mosaic cell is judged on 8 × 24 samples, which every symbol divides evenly.
SAMPLE_WIDTH = 8
SAMPLE_HEIGHT = 24
# ffmpeg releases scale a little differently, so a fresh drawing may differ
# slightly from the stored one: on average by this much a channel, and a mosaic
# may fit the image this much worse than a fresh one.
IMAGE_TOLERANCE = 1.5
MOSAIC_TOLERANCE = 1.02


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
    return columns[0], rows[0], columns[-1] - columns[0] + 1, rows[-1] - rows[0] + 1


def render(ffmpeg_path, card, box, width, height, smooth=False):
    """RGB pixels of the master's BOX (left, top, width, height, which may reach
    past the master) on graphite, averaged down to WIDTH × HEIGHT. SMOOTH takes
    out the grille's fine texture, which no cell can show and which would cost
    the PNG a tenth of its size."""
    left, top, box_width, box_height = box
    graphite = '0x%02x%02x%02x' % tuple(card)
    # Composite in RGB, so the graphite stays exactly the card's colour.
    rgb = ffmpeg(ffmpeg_path, [
        '-f', 'lavfi', '-i', f'color=c={graphite}:s={box_width}x{box_height},format=rgb24', '-i', str(SOURCE),
        '-filter_complex',
        f'[0:v][1:v]overlay=x={-left}:y={-top}:format=rgb,scale={width}:{height}:flags=area'
        f'{",median=radius=1" if smooth else ""},format=rgb24',
        '-frames:v', '1', '-f', 'rawvideo', '-'])
    if len(rgb) != width * height * 3:
        raise SystemExit('ffmpeg returned an unexpected image size')
    return [tuple(rgb[i:i + 3]) for i in range(0, len(rgb), 3)]


def image_layout(mic):
    """The image's size, the master box it shows and where the microphone sits in it."""
    left, top, width, height = mic
    scale = IMAGE_HEIGHT / height
    # The widest cells show the microphone's full height, the narrowest its full width.
    image_width = math.ceil(IMAGE_HEIGHT * COLUMNS / ROWS * CELL_SHAPES[1])
    image_height = math.ceil(width * scale / (COLUMNS / ROWS * CELL_SHAPES[0]))
    box_width, box_height = round(image_width / scale), round(image_height / scale)
    box_left, box_top = round(left + width / 2 - box_width / 2), round(top + height / 2 - box_height / 2)
    sx, sy = image_width / box_width, image_height / box_height
    placed = [round((left - box_left) * sx), round((top - box_top) * sy), round(width * sx), round(height * sy)]
    return (box_left, box_top, box_width, box_height), image_width, image_height, placed


def luminance(rgb):
    return 299 * rgb[0] + 587 * rgb[1] + 114 * rgb[2]


def palette_for(pixels, card):
    """COLORS colours for the microphone: the card's graphite, then a median cut
    of everything else, refined by a few rounds of k-means. Deterministic."""
    counts = {}
    for rgb in pixels:
        counts[rgb] = counts.get(rgb, 0) + 1
    counts.pop(tuple(card), None)
    boxes = [sorted(counts.items())]

    def spread(box):
        total = sum(count for _, count in box)
        error = 0
        for axis in range(3):
            mean = sum(rgb[axis] * count for rgb, count in box) / total
            error += sum((rgb[axis] - mean) ** 2 * count for rgb, count in box)
        return error

    while len(boxes) < COLORS - 1:
        index = max(range(len(boxes)), key=lambda i: (spread(boxes[i]) if len(boxes[i]) > 1 else -1, -i))
        box = boxes[index]
        if len(box) < 2:
            break
        axis = max(range(3), key=lambda a: (max(rgb[a] for rgb, _ in box) - min(rgb[a] for rgb, _ in box), -a))
        box.sort(key=lambda item: (item[0][axis], item[0]))
        half, running = sum(count for _, count in box) / 2, 0
        for cut, (_, count) in enumerate(box):
            running += count
            if running >= half:
                break
        cut = min(max(cut + 1, 1), len(box) - 1)
        boxes[index:index + 1] = [box[:cut], box[cut:]]
    centres = [tuple(sum(rgb[a] * count for rgb, count in box) / sum(count for _, count in box) for a in range(3))
               for box in boxes]
    items = sorted(counts.items())
    for _ in range(6):
        sums = [[0, 0, 0, 0] for _ in centres]
        for rgb, count in items:
            best = min(range(len(centres)), key=lambda i: (sum((rgb[a] - centres[i][a]) ** 2 for a in range(3)), i))
            for a in range(3):
                sums[best][a] += rgb[a] * count
            sums[best][3] += count
        centres = [tuple(s[a] / s[3] for a in range(3)) if s[3] else centre for s, centre in zip(sums, centres)]
    colours = sorted({tuple(round(value) for value in centre) for centre in centres} - {tuple(card)}, key=lambda c: (luminance(c), c))
    return [tuple(card)] + colours


def nearest(palette):
    cache = {}

    def index(rgb):
        if rgb not in cache:
            cache[rgb] = min(range(len(palette)), key=lambda i: (sum((rgb[a] - palette[i][a]) ** 2 for a in range(3)), i))
        return cache[rgb]
    return index


def png(width, height, palette, indices):
    """An indexed PNG, with each row's filter and the zlib strategy chosen for size."""
    rows = [bytes(indices[y * width:(y + 1) * width]) for y in range(height)]
    filtered = bytearray()
    previous = bytes(width)
    for row in rows:
        candidates = [bytes([kind]) + bytes((row[x] - predict(kind, row[x - 1] if x else 0, previous[x],
                                                             previous[x - 1] if x else 0)) % 256 for x in range(width))
                      for kind in range(5)]
        filtered += min(candidates, key=lambda line: (sum(value if value < 128 else 256 - value for value in line[1:]), line[0]))
        previous = row
    data = min((compress(bytes(filtered), strategy) for strategy in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED)), key=len)

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 3, 0, 0, 0)) +
            chunk(b'PLTE', b''.join(bytes(rgb) for rgb in palette)) + chunk(b'IDAT', data) + chunk(b'IEND', b''))


def predict(kind, left, up, corner):
    """PNG's five filter predictors."""
    if kind == 0:
        return 0
    if kind == 1:
        return left
    if kind == 2:
        return up
    if kind == 3:
        return (left + up) // 2
    p = left + up - corner
    return min((abs(p - left), 0, left), (abs(p - up), 1, up), (abs(p - corner), 2, corner))[2]


def compress(data, strategy):
    worker = zlib.compressobj(9, zlib.DEFLATED, 15, 9, strategy)
    return worker.compress(data) + worker.flush()


def decode_png(blob):
    """The RGB pixels of an indexed PNG that png() wrote."""
    position, chunks = 8, {}
    while position < len(blob):
        length, = struct.unpack('>I', blob[position:position + 4])
        kind = blob[position + 4:position + 8]
        chunks[kind] = chunks.get(kind, b'') + blob[position + 8:position + 8 + length]
        position += 12 + length
    width, height, depth, kind = struct.unpack('>IIBB', chunks[b'IHDR'][:10])
    if depth != 8 or kind != 3:
        raise ValueError('The installer image must be an 8-bit indexed PNG')
    palette = [tuple(chunks[b'PLTE'][i:i + 3]) for i in range(0, len(chunks[b'PLTE']), 3)]
    raw, previous, pixels = zlib.decompress(chunks[b'IDAT']), bytes(width), []
    for y in range(height):
        line = raw[y * (width + 1):(y + 1) * (width + 1)]
        kind, row = line[0], bytearray(line[1:])
        for x in range(width):
            row[x] = (row[x] + predict(kind, row[x - 1] if x else 0, previous[x], previous[x - 1] if x else 0)) % 256
        pixels += [palette[index] for index in row]
        previous = bytes(row)
    return width, height, palette, pixels


# Symbols as rectangles of the 8 × 24 samples: (left, top, right, bottom).
def _halves():
    return {'▀': [(0, 0, 8, 12)], '▄': [(0, 12, 8, 24)], '▌': [(0, 0, 4, 24)], '▐': [(4, 0, 8, 24)]}


def _grid(mask, columns, rows):
    w, h = SAMPLE_WIDTH // columns, SAMPLE_HEIGHT // rows
    return [((i % columns) * w, (i // columns) * h, (i % columns + 1) * w, (i // columns + 1) * h)
            for i in range(columns * rows) if mask >> i & 1]


QUADRANTS = dict(zip('▘▝▀▖▌▞▛▗▚▐▜▄▙▟', (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)))
EIGHTHS = {**{chr(0x2581 + k - 1): [(0, SAMPLE_HEIGHT - 3 * k, 8, SAMPLE_HEIGHT)] for k in (1, 2, 3, 5, 6, 7)},
           **{chr(0x258f - k + 1): [(0, 0, k, SAMPLE_HEIGHT)] for k in (1, 2, 3, 5, 6, 7)},
           '▔': [(0, 0, 8, 3)], '▕': [(7, 0, 8, SAMPLE_HEIGHT)]}
# Sextant masks 1..62 without the two halves, numbered like Unicode's sextants.
SEXTANTS = {chr(0x1FB00 + n - 1 - (n > 21) - (n > 42)): _grid(n, 2, 3) for n in range(1, 63) if n not in (21, 42)}
# Octants: Unicode 16 numbers the 2 × 4 masks that have no older symbol in order.
_OLDER_OCTANTS = {0, 1, 2, 3, 5, 10, 15, 20, 40, 63, 64, 80, 85, 90, 95, 128, 160, 165, 170, 175, 192, 240, 245, 250, 252, 255}
OCTANTS = {chr(0x1CD00 + i): _grid(mask, 2, 4) for i, mask in enumerate(m for m in range(256) if m not in _OLDER_OCTANTS)}
OCTANTS.update({'\U0001FB82': _grid(3, 2, 4), '\U0001FB85': _grid(63, 2, 4), '\U0001CEA8': _grid(1, 2, 4),
                '\U0001CEAB': _grid(2, 2, 4), '\U0001CEA3': _grid(64, 2, 4), '\U0001CEA0': _grid(128, 2, 4),
                '\U0001FBE6': _grid(20, 2, 4), '\U0001FBE7': _grid(40, 2, 4)})


def symbols(kind):
    """The symbols a mosaic may use: every terminal's block elements, then the
    sextants or octants for terminals that draw those themselves."""
    chosen = {**_halves(), **{glyph: _grid(mask, 2, 2) for glyph, mask in QUADRANTS.items()}, **EIGHTHS}
    if kind in ('sextant', 'octant'):
        chosen.update(SEXTANTS)
    if kind == 'octant':
        chosen.update(OCTANTS)
    return chosen


def mosaic(samples, kind, palette):
    """The cells, row by row, as [symbol, foreground index, background index]."""
    index = nearest(palette)
    # Fewer inked samples first, so of a symbol and its inverse the one with the
    # smaller foreground wins and the background covers most of the cell.
    candidates = sorted(symbols(kind).items(),
                        key=lambda item: (sum((r - l) * (b - t) for l, t, r, b in item[1]), item[0]))
    width = COLUMNS * SAMPLE_WIDTH
    cells = []
    for row in range(ROWS):
        line = []
        for column in range(COLUMNS):
            # A summed-area table of the cell's samples.
            table = [[(0, 0, 0)] * (SAMPLE_WIDTH + 1) for _ in range(SAMPLE_HEIGHT + 1)]
            for y in range(SAMPLE_HEIGHT):
                running = [0, 0, 0]
                for x in range(SAMPLE_WIDTH):
                    rgb = samples[(row * SAMPLE_HEIGHT + y) * width + column * SAMPLE_WIDTH + x]
                    for a in range(3):
                        running[a] += rgb[a]
                    above = table[y][x + 1]
                    table[y + 1][x + 1] = tuple(running[a] + above[a] for a in range(3))

            def area(rectangles):
                total, count = [0, 0, 0], 0
                for left, top, right, bottom in rectangles:
                    for a in range(3):
                        total[a] += table[bottom][right][a] - table[top][right][a] - table[bottom][left][a] + table[top][left][a]
                    count += (right - left) * (bottom - top)
                return total, count
            whole, size = area([(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)])
            # Minimising the squared error means maximising this fit.
            best = (sum(v * v for v in whole) / size, ' ', None, whole, size)
            for glyph, rectangles in candidates:
                inside, count = area(rectangles)
                outside = [whole[a] - inside[a] for a in range(3)]
                fit = sum(v * v for v in inside) / count + sum(v * v for v in outside) / (size - count)
                if fit > best[0] + 1e-6:
                    best = (fit, glyph, (inside, count), outside, size - count)
            _, glyph, ink, paper, paper_count = best
            background = index(tuple(round(v / paper_count) for v in paper))
            foreground = index(tuple(round(v / ink[1]) for v in ink[0])) if ink else background
            line.append([glyph, foreground, background])
        cells.append(line)
    return cells


def mosaic_error(samples, cells, palette):
    """How far a mosaic's cells are from the samples, as a sum of squares."""
    table = symbols('octant')
    width, error = COLUMNS * SAMPLE_WIDTH, 0
    for row in range(ROWS):
        for column in range(COLUMNS):
            glyph, foreground, background = cells[row][column]
            ink = set()
            for left, top, right, bottom in table.get(glyph, []):
                ink.update((x, y) for x in range(left, right) for y in range(top, bottom))
            for y in range(SAMPLE_HEIGHT):
                for x in range(SAMPLE_WIDTH):
                    rgb = samples[(row * SAMPLE_HEIGHT + y) * width + column * SAMPLE_WIDTH + x]
                    shown = palette[foreground if (x, y) in ink else background]
                    error += sum((rgb[a] - shown[a]) ** 2 for a in range(3))
    return error


def draw(ffmpeg_path, card):
    mic = bounds(ffmpeg_path)
    box, width, height, placed = image_layout(mic)
    pixels = render(ffmpeg_path, card, box, width, height, smooth=True)
    palette = palette_for(pixels, card)
    index = nearest(palette)
    blob = png(width, height, palette, [index(rgb) for rgb in pixels])
    samples = render(ffmpeg_path, card, mic, COLUMNS * SAMPLE_WIDTH, ROWS * SAMPLE_HEIGHT)
    art = {
        'source': SOURCE.relative_to(ROOT).as_posix(),
        'columns': COLUMNS, 'rows': ROWS,
        'palette': ['%02x%02x%02x' % rgb for rgb in palette],
        'image': {'width': width, 'height': height, 'mic': placed, 'png': base64.b64encode(blob).decode()},
        'mosaic': {kind: [[f'{glyph}{foreground:02x}{background:02x}' for glyph, foreground, background in line]
                          for line in mosaic(samples, kind, palette)] for kind in ('octant', 'sextant', 'quadrant')},
    }
    return art, pixels, samples


def cells_of(rows):
    return [[[cell[:-4], int(cell[-4:-2], 16), int(cell[-2:], 16)] for cell in line] for line in rows]


def fresh(stored, drawn, pixels, samples):
    """True when the stored art still matches a fresh drawing of the master."""
    keys = ('source', 'columns', 'rows')
    if not stored or any(stored.get(key) != drawn[key] for key in keys):
        return False
    image, new = stored.get('image', {}), drawn['image']
    if any(image.get(key) != new[key] for key in ('width', 'height', 'mic')):
        return False
    width, height, _, shown = decode_png(base64.b64decode(image['png']))
    if (width, height) != (new['width'], new['height']):
        return False
    if sum(abs(a - b) for old, now in zip(shown, pixels) for a, b in zip(old, now)) / (len(pixels) * 3) > IMAGE_TOLERANCE:
        return False
    palette, new_palette = ([tuple(bytes.fromhex(value)) for value in art['palette']] for art in (stored, drawn))
    for kind, rows in drawn['mosaic'].items():
        kept = stored.get('mosaic', {}).get(kind)
        if not kept or len(kept) != ROWS or any(len(line) != COLUMNS for line in kept):
            return False
        allowed = symbols(kind)
        if any(cell[:-4] not in allowed and cell[:-4] != ' ' for line in kept for cell in line):
            return False
        if mosaic_error(samples, cells_of(kept), palette) > MOSAIC_TOLERANCE * mosaic_error(samples, cells_of(rows), new_palette) + 1:
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
    drawn, pixels, samples = draw(ffmpeg_path, brand['card'])
    if arguments.check:
        if not fresh(brand.get('art'), drawn, pixels, samples):
            raise SystemExit('The installer microphone is stale. Run python3 scripts/generate-installer-art.py')
        return
    brand['art'] = drawn
    BRAND.write_text(json.dumps(brand, indent=2) + '\n')
    size = len(base64.b64decode(drawn['image']['png']))
    print(f'Drew the installer microphone into {BRAND.relative_to(ROOT)}: a {drawn["image"]["width"]} × '
          f'{drawn["image"]["height"]} image of {size} bytes and three {COLUMNS} × {ROWS} mosaics')


if __name__ == '__main__':
    sys.exit(main())
