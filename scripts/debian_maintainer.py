"""Generate and verify the sole reviewed Debian maintainer action."""
from pathlib import Path
import stat
import sys

TEMPLATE = Path(__file__).resolve().parents[1] / 'packaging/debian/postinst.py.in'
OWNED_ROOTS = ('usr/lib/voco', 'usr/libexec/voco', 'usr/share/voco', 'usr/share/doc/voco')


def render_postinst(payload):
    directories = []
    for relative in OWNED_ROOTS:
        root = payload / relative
        if root.is_symlink():
            raise ValueError('VOCO payload root cannot be a symlink')
        if not root.exists():
            continue
        for path in (root, *sorted(root.rglob('*'))):
            if path.is_dir() and not path.is_symlink():
                directories.append('/' + path.relative_to(payload).as_posix())
    return TEMPLATE.read_text().replace('@DIRECTORIES@', repr(tuple(directories)))


def verify_control(control, payload):
    if any(path.name not in ('control', 'md5sums', 'postinst') for path in control.iterdir()):
        raise ValueError('Unreviewed Debian maintainer action or metadata')
    hook = control / 'postinst'
    if (hook.is_symlink() or not hook.is_file()
            or stat.S_IMODE(hook.stat().st_mode) != 0o755
            or hook.read_text() != render_postinst(payload)):
        raise ValueError('Debian postinst does not match the reviewed directory repair')


if __name__ == '__main__':
    verify_control(Path(sys.argv[1]), Path(sys.argv[2]))
