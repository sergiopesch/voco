#!/usr/bin/env python3
"""Generate Linux launcher, favicon, and shared tray-state PNGs.

The square primary master is assets/voco-logo.png. The simplified optical
master, assets/voco-symbol.png, serves sizes up to 64px. ffmpeg is the only
external requirement; badge geometry uses the Python standard library.
"""
import math
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/voco-logo.png"
SMALL_SOURCE = ROOT / "assets/voco-symbol.png"
ICON_DIR = ROOT / "apps/desktop/src-tauri/icons"
PUBLIC_DIR = ROOT / "apps/desktop/public"
TRAY_SIZE = 32
SUPERSAMPLE = 4
STATES = ("not-ready", "muted", "ready", "recording", "processing")


def run_ffmpeg(ffmpeg: str, arguments: list[str], data: bytes | None = None) -> bytes:
    return subprocess.run(
        [ffmpeg, "-v", "error", "-y", *arguments],
        input=data,
        check=True,
        stdout=subprocess.PIPE,
    ).stdout


def fit_filter(size: int) -> str:
    return (
        f"scale={size}:{size}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={size}:{size}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba"
    )


def render_png(ffmpeg: str, source: Path, target: Path, size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(ffmpeg, ["-i", str(source), "-vf", fit_filter(size), "-frames:v", "1", str(target)])


def near_segment(x: float, y: float, start: tuple, end: tuple, width: float) -> bool:
    dx, dy = end[0] - start[0], end[1] - start[1]
    projection = max(0, min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - start[0] - projection * dx, y - start[1] - projection * dy) <= width / 2


def badge_mark(x: float, y: float, state: str) -> bool:
    """Recognizable shapes remain different even without their accent colors."""
    if state == "recording":
        return math.hypot(x - 25, y - 25) <= 2.6
    if state == "ready":
        segments = [((22, 25), (24, 27)), ((24, 27), (28, 23))]
    elif state == "processing":
        segments = [((22.5, 22), (27.5, 22)), ((22.5, 28), (27.5, 28)),
                    ((22.5, 22), (27.5, 28)), ((27.5, 22), (22.5, 28))]
    elif state == "muted":
        segments = [((23, 22.5), (23, 27.5)), ((27, 22.5), (27, 27.5))]
    else:
        return near_segment(x, y, (25, 22), (25, 25), 2) or math.hypot(x - 25, y - 28) <= 0.9
    return any(near_segment(x, y, start, end, 2) for start, end in segments)


def badge_contains(x: float, y: float, state: str, inset: float = 0) -> bool:
    """Outer silhouettes preserve state distinctions when small glyphs soften."""
    x, y = x - 25, y - 25
    radius = 6.6
    if state == "recording":
        return math.hypot(x, y) <= radius - inset
    if state == "muted":
        corner = 1.2
        straight = radius - corner - inset
        return math.hypot(max(abs(x) - straight, 0), max(abs(y) - straight, 0)) <= corner
    outlines = {
        "ready": [(-1, -1), (1, -1), (1, 0), (0, 1), (-1, 0)],
        "processing": [(0, -1), (1, 0), (0, 1), (-1, 0)],
        "not-ready": [(0, -1), (1, 1), (-1, 1)],
    }
    vertices = [(px * radius, py * radius) for px, py in outlines[state]]
    for start, end in zip(vertices, vertices[1:] + vertices[:1]):
        dx, dy = end[0] - start[0], end[1] - start[1]
        if dx * (y - start[1]) - dy * (x - start[0]) < inset * math.hypot(dx, dy):
            return False
    return True


def render_tray_icons(ffmpeg: str) -> None:
    size = TRAY_SIZE * SUPERSAMPLE
    base = run_ffmpeg(ffmpeg, ["-i", str(SMALL_SOURCE), "-vf", fit_filter(size),
                              "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
    if len(base) != size * size * 4:
        raise ValueError("Unexpected tray master pixel buffer")
    colors = {
        "not-ready": (239, 191, 104, 255),
        "muted": (224, 228, 234, 255),
        "ready": (129, 215, 165, 255),
        "recording": (250, 121, 127, 255),
        "processing": (239, 191, 104, 255),
    }
    target_dir = PUBLIC_DIR / "tray"
    target_dir.mkdir(parents=True, exist_ok=True)
    for state in STATES:
        pixels = bytearray(base)
        for py in range(18 * SUPERSAMPLE, size):
            for px in range(18 * SUPERSAMPLE, size):
                x, y = (px + 0.5) / SUPERSAMPLE, (py + 0.5) / SUPERSAMPLE
                if not badge_contains(x, y, state):
                    continue
                inside = badge_contains(x, y, state, inset=1)
                color = (24, 27, 33, 255) if inside else (210, 215, 223, 255)
                if inside and badge_mark(x, y, state):
                    color = colors[state]
                offset = (py * size + px) * 4
                pixels[offset:offset + 4] = bytes(color)
        run_ffmpeg(ffmpeg, ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", f"{size}x{size}",
                           "-i", "pipe:0", "-vf", f"scale={TRAY_SIZE}:{TRAY_SIZE}:flags=lanczos",
                           "-frames:v", "1", str(target_dir / f"{state}.png")], bytes(pixels))
        print(f"Generated tray/{state}.png")


def main() -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("error: ffmpeg is required to generate icons")
    for source in (SOURCE, SMALL_SOURCE):
        if not source.is_file():
            sys.exit(f"error: source logo not found: {source}")
    outputs = {
        ICON_DIR / "32x32.png": 32,
        ICON_DIR / "128x128.png": 128,
        ICON_DIR / "128x128@2x.png": 256,
        PUBLIC_DIR / "favicon.png": 64,
    }
    for path, size in outputs.items():
        render_png(ffmpeg, SMALL_SOURCE if size <= 64 else SOURCE, path, size)
        print(f"Generated {path.relative_to(ROOT)} ({size}x{size})")
    ui_symbol = ROOT / "assets/voco-symbol-ui.png"
    render_png(ffmpeg, SMALL_SOURCE, ui_symbol, 128)
    print(f"Generated {ui_symbol.relative_to(ROOT)} (128x128)")
    render_tray_icons(ffmpeg)


if __name__ == "__main__":
    main()
