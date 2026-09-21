#!/usr/bin/env python3
"""Build a reproducible extension zip from source, without installing it."""
from pathlib import Path
import argparse
import hashlib
import zipfile
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = root / 'integrations/gnome/voco-panel@voco.local'
files = ['extension.js', 'metadata.json', 'model.js', 'stylesheet.css', 'voco-symbol.png']
assert (source / 'voco-symbol.png').read_bytes() == (root / 'assets/voco-symbol-ui.png').read_bytes(), 'VOCO icon must match the branding asset'
with args.output.open('xb') as output:
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (source / name).read_bytes())
print(hashlib.sha256(args.output.read_bytes()).hexdigest(), args.output)
