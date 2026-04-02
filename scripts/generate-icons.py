#!/usr/bin/env python3
"""Generate app icons for VOCO.

Creates PNG icons at required sizes for Tauri (Linux .deb packaging).
Uses only the Python standard library — no external deps needed.
"""
import os
import math
import struct
import zlib

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "apps", "desktop", "src-tauri", "icons")

def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def ellipse_alpha(nx: float, ny: float, cx: float, cy: float, rx: float, ry: float, feather: float = 0.08) -> float:
    dx = (nx - cx) / rx
    dy = (ny - cy) / ry
    dist = dx * dx + dy * dy
    if dist >= 1.0 + feather:
        return 0.0
    if dist <= 1.0:
        return 1.0
    return 1.0 - smoothstep(1.0, 1.0 + feather, dist)


def circle_alpha(nx: float, ny: float, cx: float, cy: float, radius: float, feather: float = 0.03) -> float:
    dist = math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2)
    if dist <= radius:
        return 1.0
    if dist >= radius + feather:
        return 0.0
    return 1.0 - smoothstep(radius, radius + feather, dist)


def rect_alpha(nx: float, ny: float, x0: float, y0: float, x1: float, y1: float, feather: float = 0.02) -> float:
    if x0 <= nx <= x1 and y0 <= ny <= y1:
        return 1.0
    dx = 0.0
    dy = 0.0
    if nx < x0:
        dx = x0 - nx
    elif nx > x1:
        dx = nx - x1
    if ny < y0:
        dy = y0 - ny
    elif ny > y1:
        dy = ny - y1
    dist = math.sqrt(dx * dx + dy * dy)
    if dist >= feather:
        return 0.0
    return 1.0 - smoothstep(0.0, feather, dist)


def mic_shape(nx: float, ny: float) -> float:
    """Returns opacity 0.0..1.0 for a premium condenser mic silhouette."""
    body = ellipse_alpha(nx, ny, 0.5, 0.39, 0.16, 0.23, feather=0.1)

    # Flat lower body for a more engineered silhouette.
    if body > 0.0 and ny > 0.56:
        body = max(0.0, body * (1.0 - smoothstep(0.56, 0.62, ny)))

    stem = rect_alpha(nx, ny, 0.472, 0.56, 0.528, 0.72, feather=0.015)
    base = rect_alpha(nx, ny, 0.36, 0.73, 0.64, 0.79, feather=0.02)

    dx = (nx - 0.5) / 0.24
    dy = (ny - 0.56) / 0.16
    yoke_dist = dx * dx + dy * dy
    yoke = 0.0
    if 0.7 <= yoke_dist <= 1.06 and ny <= 0.62:
        yoke = 1.0 - abs(yoke_dist - 0.88) / 0.18

    return max(body, stem, base, max(0.0, yoke))


def generate_icon(size: int) -> bytes:
    """Generate RGBA pixel data for an icon at the given size."""
    pixels = bytearray(size * size * 4)

    # Colors
    bg_r, bg_g, bg_b = 17, 17, 26
    bg2_r, bg2_g, bg2_b = 26, 26, 38
    purple_r, purple_g, purple_b = 108, 76, 245
    lavender_r, lavender_g, lavender_b = 183, 167, 255
    mic_r, mic_g, mic_b = 244, 239, 255

    for py in range(size):
        for px in range(size):
            nx = (px + 0.5) / size
            ny = (py + 0.5) / size

            idx = (py * size + px) * 4

            orb_alpha = circle_alpha(nx, ny, 0.5, 0.5, 0.46, feather=0.025)
            if orb_alpha <= 0:
                pixels[idx:idx+4] = bytes([0, 0, 0, 0])
                continue

            # Background orb with restrained inner glow.
            top_light = max(0.0, 1.0 - math.sqrt((nx - 0.38) ** 2 + (ny - 0.32) ** 2) / 0.58)
            glow = max(0.0, 1.0 - math.sqrt((nx - 0.5) ** 2 + (ny - 0.42) ** 2) / 0.46)
            rim = max(0.0, 1.0 - abs(math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2) - 0.43) / 0.035)

            r = int(bg_r * (1.0 - top_light * 0.32) + bg2_r * (top_light * 0.32))
            g = int(bg_g * (1.0 - top_light * 0.32) + bg2_g * (top_light * 0.32))
            b = int(bg_b * (1.0 - top_light * 0.32) + bg2_b * (top_light * 0.32))

            r = int(r * (1.0 - glow * 0.6) + purple_r * glow * 0.6)
            g = int(g * (1.0 - glow * 0.6) + purple_g * glow * 0.6)
            b = int(b * (1.0 - glow * 0.6) + purple_b * glow * 0.6)

            r = int(r * (1.0 - rim * 0.35) + lavender_r * rim * 0.35)
            g = int(g * (1.0 - rim * 0.35) + lavender_g * rim * 0.35)
            b = int(b * (1.0 - rim * 0.35) + lavender_b * rim * 0.35)

            # Premium highlight to keep the icon crisp at small sizes.
            highlight = ellipse_alpha(nx, ny, 0.38, 0.28, 0.16, 0.11, feather=0.16) * 0.28
            r = int(r * (1.0 - highlight) + 255 * highlight)
            g = int(g * (1.0 - highlight) + 255 * highlight)
            b = int(b * (1.0 - highlight) + 255 * highlight)

            mic_alpha = mic_shape(nx, ny)
            if mic_alpha > 0.0:
                ma = min(1.0, mic_alpha)
                r = int(r * (1.0 - ma) + mic_r * ma)
                g = int(g * (1.0 - ma) + mic_g * ma)
                b = int(b * (1.0 - ma) + mic_b * ma)

                # Grille lines in the capsule.
                if 0.405 <= nx <= 0.595 and 0.25 <= ny <= 0.52:
                    line_mod = abs(((nx - 0.405) / 0.038) % 1.0 - 0.5)
                    if line_mod < 0.14:
                        groove = 1.0 - line_mod / 0.14
                        r = int(r * (1.0 - groove * 0.25) + purple_r * groove * 0.25)
                        g = int(g * (1.0 - groove * 0.18) + purple_g * groove * 0.18)
                        b = int(b * (1.0 - groove * 0.32) + purple_b * groove * 0.32)

            a = int(orb_alpha * 255)
            pixels[idx] = min(255, r)
            pixels[idx+1] = min(255, g)
            pixels[idx+2] = min(255, b)
            pixels[idx+3] = min(255, a)

    return bytes(pixels)


def write_png(filename: str, width: int, height: int, rgba_data: bytes):
    """Write RGBA data as a PNG file (no external deps needed)."""
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + c + struct.pack(">I", crc)

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT — filter each row with filter type 0 (None)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type
        offset = y * width * 4
        raw.extend(rgba_data[offset:offset + width * 4])

    compressed = zlib.compress(bytes(raw), 9)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(sig + ihdr + idat + iend)


def main():
    os.makedirs(ICON_DIR, exist_ok=True)

    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }

    for filename, size in sizes.items():
        path = os.path.join(ICON_DIR, filename)
        print(f"Generating {filename} ({size}x{size})...")
        rgba = generate_icon(size)
        write_png(path, size, size, rgba)
        print(f"  → {path} ({os.path.getsize(path)} bytes)")

    # Also generate icon.ico (just use 32x32 PNG — Tauri accepts PNG for .ico)
    # And icon.icns (use 256x256 PNG — Tauri accepts PNG for .icns on build)
    import shutil
    shutil.copy(
        os.path.join(ICON_DIR, "128x128.png"),
        os.path.join(ICON_DIR, "icon.ico"),
    )
    shutil.copy(
        os.path.join(ICON_DIR, "128x128@2x.png"),
        os.path.join(ICON_DIR, "icon.icns"),
    )
    print("Generated icon.ico and icon.icns (from PNG sources)")
    print("Done!")


if __name__ == "__main__":
    main()
