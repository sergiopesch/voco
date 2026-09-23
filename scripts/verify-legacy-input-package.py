#!/usr/bin/env python3
"""Check the private input payload without starting a daemon or touching uinput."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def regular(path, mode):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != mode:
        raise ValueError('Invalid private input payload type/mode: ' + str(path))


def verify(stage):
    private = stage / 'usr/libexec/voco/ydotool-legacy'
    for directory in (private.parent, private):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o755:
            raise ValueError('Invalid private input payload directory')
    expected = {'ydotoold': 0o755, 'MANIFEST.json': 0o644, 'qualified-client.json': 0o644}
    if {p.name for p in private.iterdir()} != set(expected):
        raise ValueError('Unexpected private input payload inventory')
    for name, mode in expected.items():
        regular(private / name, mode)
    regular(private.parent / 'ydotool-launcher', 0o755)
    manifest = json.loads((private / 'MANIFEST.json').read_text())
    if (manifest['format_version'] != 1
            or manifest['source_provenance']['manifest_sha256'] != digest(ROOT / 'vendor/ydotool-legacy/SOURCE.json')
            or manifest['build']['script_sha256'] != digest(ROOT / 'scripts/build-legacy-ydotool.py')):
        raise ValueError('Private input build provenance differs from reviewed source')
    binary = private / 'ydotoold'
    if digest(binary) != manifest['binary_sha256'] or binary.stat().st_size != manifest['binary_bytes']:
        raise ValueError('Private input daemon differs from its build manifest')
    dynamic = subprocess.check_output(['readelf', '-d', str(binary)], text=True)
    needed = sorted(re.findall(r'\(NEEDED\).*\[(.*?)\]', dynamic))
    if needed != ['libc.so.6', 'libgcc_s.so.1', 'libstdc++.so.6']:
        raise ValueError('Unexpected private input daemon link closure')
    if sorted(manifest['elf']['needed']) != needed:
        raise ValueError('Private input daemon link closure differs from build manifest')
    if (stage / 'usr/bin/ydotool').exists() or (stage / 'usr/bin/ydotoold').exists():
        raise ValueError('VOCO must not replace distribution input helpers')
    for source, destination in (
            (ROOT / 'packaging/ydotool/qualified-client.json', private / 'qualified-client.json'),
            (ROOT / 'packaging/ydotool/voco-ydotool-launcher', private.parent / 'ydotool-launcher')):
        if source.read_bytes() != destination.read_bytes():
            raise ValueError('Packaged input selection differs from reviewed source')
    notices = stage / 'usr/share/doc/voco/vendor/ydotool-legacy'
    if not notices.is_dir() or notices.is_symlink() or not list(notices.iterdir()):
        raise ValueError('Missing private input helper licenses and provenance')
    files = {}
    for path in notices.rglob('*'):
        if path.is_dir() and not path.is_symlink():
            if stat.S_IMODE(path.stat().st_mode) != 0o755:
                raise ValueError('Invalid private input notice directory mode')
            continue
        regular(path, 0o644)
        files[path.relative_to(notices).as_posix()] = digest(path)
    if not files or files != manifest['notices']:
        raise ValueError('Private input helper license/provenance inventory differs')
    return {'binary_sha256': manifest['binary_sha256'], 'needed': needed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', type=Path)
    print(json.dumps(verify(parser.parse_args().stage)))
