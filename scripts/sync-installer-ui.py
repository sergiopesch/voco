#!/usr/bin/env python3
"""Keep the downloaded single-file installer identical to its maintainable UI source."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '# BEGIN EMBEDDED INSTALLER UI\n'
END = '# END EMBEDDED INSTALLER UI\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'install'
    content = path.read_text()
    ui = (ROOT / 'scripts/lib/install-ui.sh').read_text()
    apt_ui = (ROOT / 'scripts/lib/install-apt-ui.py').read_text()
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
