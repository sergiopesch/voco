#!/usr/bin/env python3
"""Read-only native install/remove parity receipt in an owned test container or VM."""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('inventory', type=Path)
parser.add_argument('--removed', action='store_true')
parser.add_argument('--isolated-vm', action='store_true',
                    help='Explicitly allow an owned qualification VM; never use on the live desktop')
args = parser.parse_args()
isolated_vm = args.isolated_vm and subprocess.run(
    ['systemd-detect-virt', '--vm', '--quiet'], timeout=5, check=False).returncode == 0
if not Path('/.dockerenv').exists() and not isolated_vm:
    raise SystemExit('This verification requires an isolated test container or explicit test VM')
rows = json.loads(args.inventory.read_text())
errors = []
checked = 0
elf_objects = 0
shared_directory_modes = []
for row in rows:
    path = Path(row['path'])
    if args.removed:
        if row['kind'] != 'directory':
            checked += 1
            if path.exists() or path.is_symlink():
                errors.append({'path': row['path'], 'issue': 'survived_uninstall'})
        continue
    checked += 1
    try:
        info = path.lstat()
        if row['kind'] == 'symlink':
            matches = path.is_symlink() and str(path.readlink()) == row['target']
        elif row['kind'] == 'directory':
            matches = stat.S_ISDIR(info.st_mode)
        else:
            matches = stat.S_ISREG(info.st_mode)
            if matches:
                with path.open('rb') as stream:
                    matches = hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256']
                with path.open('rb') as stream:
                    is_elf = stream.read(4) == b'\x7fELF'
                if is_elf:
                    elf_objects += 1
                    linked = subprocess.run(['ldd', str(path)], capture_output=True, text=True)
                    if linked.returncode or 'not found' in linked.stdout + linked.stderr:
                        errors.append({'path': row['path'], 'issue': 'unresolved_elf_dependency'})
        if not matches:
            errors.append({'path': row['path'], 'issue': 'content_or_type_mismatch'})
        shared_directory = row['kind'] == 'directory' and not any(
            str(path) == prefix or str(path).startswith(prefix + '/')
            for prefix in ('/usr/lib/voco', '/usr/share/voco', '/usr/share/doc/voco'))
        if shared_directory:
            # Native packages must not change Fedora's existing /usr/bin and
            # /usr/lib modes just because Debian uses different system modes.
            shared_directory_modes.append(row['path'])
        if row['kind'] != 'symlink' and not shared_directory and stat.S_IMODE(info.st_mode) != row['mode']:
            errors.append({'path': row['path'], 'issue': 'mode_mismatch'})
        if (info.st_uid, info.st_gid) != (0, 0):
            errors.append({'path': row['path'], 'issue': 'not_root_owned'})
    except FileNotFoundError:
        errors.append({'path': row['path'], 'issue': 'missing'})
print(json.dumps({'stage': 'removed' if args.removed else 'installed', 'checked': checked,
                  'elf_objects': elf_objects, 'shared_directory_modes_preserved': shared_directory_modes,
                  'passed': not errors, 'errors': errors}, indent=2))
raise SystemExit(bool(errors))
