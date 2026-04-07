#!/usr/bin/env python3
"""Generate VOCO app icons from the canonical VOCO logo source.

Uses ffmpeg (already present in the dev environment) to create the PNG icons
needed by Tauri plus the frontend favicon from assets/voco-logo.png.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = os.path.join(ROOT, "assets", "voco-logo.png")
ICON_DIR = os.path.join(ROOT, "apps", "desktop", "src-tauri", "icons")
FAVICON = os.path.join(ROOT, "apps", "desktop", "public", "favicon.png")


def require_ffmpeg() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("error: ffmpeg is required to generate icons", file=sys.stderr)
        sys.exit(1)
    return ffmpeg


def ensure_source() -> None:
    if not os.path.exists(SOURCE):
        print(f"error: source logo not found: {SOURCE}", file=sys.stderr)
        sys.exit(1)


def render_png(ffmpeg: str, target: str, size: int) -> None:
    os.makedirs(os.path.dirname(target), exist_ok=True)

    # Fit the transparent icon into a square canvas without adding a background.
    vf = (
        f"scale={size}:{size}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={size}:{size}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba"
    )

    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            SOURCE,
            "-vf",
            vf,
            "-frames:v",
            "1",
            target,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )



def main() -> None:
    ffmpeg = require_ffmpeg()
    ensure_source()
    os.makedirs(ICON_DIR, exist_ok=True)

    outputs = {
        os.path.join(ICON_DIR, "32x32.png"): 32,
        os.path.join(ICON_DIR, "128x128.png"): 128,
        os.path.join(ICON_DIR, "128x128@2x.png"): 256,
        FAVICON: 64,
    }

    for path, size in outputs.items():
        print(f"Generating {os.path.relpath(path, ROOT)} ({size}x{size})")
        render_png(ffmpeg, path, size)

    shutil.copy(os.path.join(ICON_DIR, "128x128.png"), os.path.join(ICON_DIR, "icon.ico"))
    shutil.copy(os.path.join(ICON_DIR, "128x128@2x.png"), os.path.join(ICON_DIR, "icon.icns"))
    print("Generated Tauri icons and favicon from assets/voco-logo.png")


if __name__ == "__main__":
    main()
