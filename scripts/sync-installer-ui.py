#!/usr/bin/env python3
"""Keep the downloaded single-file installer identical to its maintainable UI source."""
import argparse
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '# BEGIN EMBEDDED INSTALLER UI\n'
END = '# END EMBEDDED INSTALLER UI\n'


def brand_sources():
    brand = json.loads((ROOT / 'scripts/lib/install-brand.json').read_text())
    rows, palette = brand['rows'], brand['palette']
    if len(rows) != 5 or any(len(row) != 4 or any(len(letter) != 8 or set(letter) - {' ', '█'} for letter in row) for row in rows):
        raise ValueError('Installer wordmark must contain five rows of four eight-column glyphs')
    if set(palette) != {'silver', 'shine', 'muted', 'complete', 'active'} or any(len(rgb) != 3 or any(type(value) is not int or not 0 <= value <= 255 for value in rgb) for rgb in palette.values()):
        raise ValueError('Invalid installer brand palette')
    shell = 'VOCO_UI_GLYPHS=(\n' + ''.join('  ' + ' '.join(shlex.quote(letter) for letter in row) + '\n' for row in rows) + ')\n'
    for name, rgb in palette.items():
        shell += f"VOCO_UI_{name.upper()}='\\033[38;2;{';'.join(map(str, rgb))}m'\n"
    python = 'BRAND_ROWS = ' + repr(rows) + '\n'
    python += 'BRAND_COLORS = ' + repr({name: '\033[38;2;' + ';'.join(map(str, rgb)) + 'm' for name, rgb in palette.items()}) + '\n'
    return shell, python


def with_brand(content, generated):
    start, end = '# BEGIN GENERATED INSTALLER BRAND\n', '# END GENERATED INSTALLER BRAND\n'
    before, rest = content.split(start, 1)
    _, after = rest.split(end, 1)
    return before + start + generated + end + after


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
    block = START + ui + END
    if START in content:
        start = content.index(START)
        end = content.index(END, start) + len(END)
        updated = content[:start] + block + content[end:]
    else:
        updated = content.replace('# Download output is measured', block + '\n# Download output is measured', 1)
    if args.check:
        if updated != content:
            raise SystemExit('Installer UI is stale. Run python3 scripts/sync-installer-ui.py')
    else:
        path.write_text(updated)


if __name__ == '__main__':
    main()
