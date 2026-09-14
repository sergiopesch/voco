#!/usr/bin/env python3
"""Prepare transparent VOCO masters from retained ImageGen keyed source exports.

Run before generate-icons.py. ffmpeg handles key removal and color spill;
no background-removal service or additional Python dependency is required.
"""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        sys.exit('error: ffmpeg is required to prepare brand masters')
    for source_name, output_name in (
        ('microphone-primary-keyed.png', 'voco-logo.png'),
        ('microphone-symbol-keyed.png', 'voco-symbol.png'),
    ):
        subprocess.run([
            ffmpeg, '-v', 'error', '-y',
            '-i', str(ROOT / 'assets/brand-sources' / source_name),
            '-vf', 'format=rgba,colorkey=0x00ff00:0.3:0.1,despill=type=green,scale=1024:1024:flags=lanczos',
            '-frames:v', '1', str(ROOT / 'assets' / output_name),
        ], check=True)
        print(f'Prepared assets/{output_name}')


if __name__ == '__main__':
    main()
