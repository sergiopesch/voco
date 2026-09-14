#!/usr/bin/env python3
"""Rebuild the self-contained README SVG after generating the Linux icons."""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
icon = base64.b64encode((ROOT / 'apps/desktop/src-tauri/icons/128x128@2x.png').read_bytes()).decode('ascii')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="560" height="184" viewBox="0 0 560 184" role="img" aria-labelledby="title desc">
  <title id="title">VOCO — Your voice, typed.</title>
  <desc id="desc">A satin silver microphone beside the VOCO wordmark. Built for Linux.</desc>
  <rect width="560" height="184" rx="22" fill="#111318"/>
  <image href="data:image/png;base64,{icon}" x="26" y="16" width="152" height="152" preserveAspectRatio="xMidYMid meet"/>
  <g font-family="Geist, Inter, ui-sans-serif, system-ui, sans-serif">
    <text x="200" y="49" fill="#aeb5bf" font-size="11" font-weight="500" letter-spacing="2.2">BUILT FOR LINUX</text>
    <text x="196" y="111" fill="#f1f3f6" font-size="68" font-weight="600" letter-spacing="-2.7">VOCO</text>
    <text x="200" y="144" fill="#c7ccd4" font-size="18" font-weight="400">Your voice, typed.</text>
  </g>
</svg>
'''
(ROOT / 'assets/voco-readme-banner.svg').write_text(svg)
print('Generated assets/voco-readme-banner.svg')
