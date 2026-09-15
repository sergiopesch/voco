#!/usr/bin/env python3
"""Stage native-package recipes from an already verified, immutable VOCO payload.

This packages prebuilt candidate bytes, not a portable source rebuild. Build the
recipes using the native distro tools and verify install/remove and payload parity
before describing either artifact as tested. No installation scripts are emitted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile

DEBIAN_RUNTIME_FLOORS = {'libc6 (>= 2.39)', 'libstdc++6 (>= 13.2.0)'}
RPM_RUNTIME_FLOORS = ['glibc >= 2.39', 'libstdc++ >= 13.2.0']
ARCH_RUNTIME_FLOORS = ['glibc>=2.39', 'gcc-libs>=13.2.0']


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_debian_dependencies(value):
    """Require an explicit native mapping when the source package adds a need."""
    mapped = {
        'ibus', 'python3', 'gir1.2-ibus-1.0', 'python3-gi', 'xclip',
        'gir1.2-atspi-2.0', 'at-spi2-core', 'python3-numpy', 'python3-psutil',
        'libsentencepiece0', 'libayatana-appindicator3-1', 'libwebkit2gtk-4.1-0',
        'libgtk-3-0',
    }
    # Versioned/alternative requirements also need a deliberate translation;
    # silently deleting their constraint would broaden the accepted platforms.
    dependencies = {part.strip() for part in value.split(',')}
    if (not DEBIAN_RUNTIME_FLOORS <= dependencies
            or not dependencies <= mapped | DEBIAN_RUNTIME_FLOORS):
        raise ValueError('Native dependency mapping requires review for this Debian package')


def inventory(root):
    result = []
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        if not re.fullmatch(r'[A-Za-z0-9_./+@-]+', name):
            raise ValueError(f'Unsupported package pathname: {name!r}')
        mode = stat.S_IMODE(path.lstat().st_mode)
        if not path.is_symlink() and mode & 0o6002:
            raise ValueError(f'Unsafe package permissions: {name}')
        row = {'path': '/' + name, 'mode': mode}
        if path.is_symlink():
            target = path.readlink()
            if target.is_absolute() or not path.resolve().is_relative_to(root.resolve()) or not path.exists():
                raise ValueError(f'Unsafe package link: {name}')
            row.update(kind='symlink', target=str(target))
        elif path.is_file():
            row.update(kind='file', sha256=digest(path))
        elif path.is_dir():
            row.update(kind='directory')
        else:
            raise ValueError(f'Unsupported package object: {name}')
        result.append(row)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('deb', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--verifier', required=True, type=Path)
    args = parser.parse_args()
    if digest(args.deb) != args.sha256:
        raise ValueError('Debian artifact hash mismatch')
    identity = subprocess.check_output(['dpkg-deb', '-f', str(args.deb), 'Package', 'Version', 'Architecture'], text=True)
    fields = dict(line.split(': ', 1) for line in identity.splitlines())
    match = re.fullmatch(r'(\d{4}\.\d+\.\d+)\+local(\d+)', fields['Version'])
    if fields['Package'] != 'voco' or fields['Architecture'] != 'amd64' or not match:
        raise ValueError('Expected a local VOCO amd64 candidate')
    version, revision = match.groups()
    depends = subprocess.check_output(['dpkg-deb', '-f', str(args.deb), 'Depends'], text=True)
    validate_debian_dependencies(depends.strip())
    # Use the repository's complete-payload verifier before recipe generation.
    subprocess.run(['bash', str(args.verifier.resolve()), str(args.deb.resolve()), fields['Version']], check=True)
    args.output.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix='voco-native-package-') as temporary:
        control = Path(temporary) / 'control'
        subprocess.run(['dpkg-deb', '-e', str(args.deb.resolve()), str(control)], check=True)
        if any(path.name not in ('control', 'md5sums') for path in control.iterdir()):
            raise ValueError('Debian maintainer actions require explicit native package review')
        payload = Path(temporary) / 'payload'
        subprocess.run(['dpkg-deb', '-x', str(args.deb.resolve()), str(payload)], check=True)
        entries = inventory(payload)
        archive = args.output / 'voco-payload.tar'
        with tarfile.open(archive, 'w', format=tarfile.PAX_FORMAT) as tar:
            for row in entries:
                path = payload / row['path'].lstrip('/')
                info = tar.gettarinfo(str(path), arcname=row['path'].lstrip('/'))
                info.uid = info.gid = 0
                info.uname = info.gname = 'root'
                info.mtime = 0
                if path.is_file() and not path.is_symlink():
                    with path.open('rb') as stream:
                        tar.addfile(info, stream)
                else:
                    tar.addfile(info)
    archive_hash = digest(archive)
    (args.output / 'payload-inventory.json').write_text(json.dumps(entries, indent=2) + '\n')
    (args.output / 'provenance.json').write_text(json.dumps({
        'debian_version': fields['Version'], 'debian_sha256': args.sha256,
        'application_version': version, 'native_release': f'{revision}.local',
        'payload_tar_sha256': archive_hash, 'scope': 'Exact prebuilt candidate payload; not a portable source rebuild',
    }, indent=2) + '\n')
    # Dependencies are explicit per distro. Automatic ELF dependencies remain on
    # RPM; private recognizer libraries must not become public system provides.
    fedora = RPM_RUNTIME_FLOORS + 'python3 python3-numpy python3-psutil sentencepiece-libs gstreamer1-plugins-base gstreamer1-plugins-good gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 ibus python3-gobject at-spi2-core xclip xdotool wl-clipboard ydotool'.split()
    spec = f'''Name: voco
Version: {version}
Release: {revision}.local
Summary: Local Linux dictation candidate
License: MIT AND Apache-2.0 AND LicenseRef-NVIDIA-Open-Model
URL: https://github.com/sergiopesch/voco
Source0: voco-payload.tar
BuildArch: x86_64
Requires: {', '.join(fedora)}
%global debug_package %{{nil}}
%global _binary_payload w3.zstdio
%global __os_install_post %{{nil}}
%global __provides_exclude_from ^/usr/lib/voco/.*$
%global __requires_exclude ^lib(ggml(-base|-cpu)?|nemo_speech_asr(_c)?|bench_nemo_pool)\\.so.*$

%description
Local testing candidate with a pinned NVIDIA runtime and model. Native package
metadata wraps the exact verified prebuilt payload. No desktop configuration is
changed during installation. Model terms are included with the payload.

%prep
echo '{archive_hash}  %{{SOURCE0}}' | sha256sum -c -

%build

%install
mkdir -p %{{buildroot}}
tar -xf %{{SOURCE0}} -C %{{buildroot}} --no-same-owner --same-permissions

%files
%defattr(-,root,root,-)
'''
    # Files, not shared system directories, belong to this package. Dedicated
    # VOCO subdirectories are owned so an uninstall can remove them cleanly.
    owned = ('/usr/lib/voco', '/usr/share/voco', '/usr/share/doc/voco')
    for row in entries:
        if row['kind'] == 'directory':
            if any(row['path'] == prefix or row['path'].startswith(prefix + '/') for prefix in owned):
                spec += '%dir ' + row['path'] + '\n'
        else:
            spec += row['path'] + '\n'
    (args.output / 'voco.spec').write_text(spec)
    arch = ARCH_RUNTIME_FLOORS + 'python python-numpy python-psutil sentencepiece gst-plugins-good gtk3 webkit2gtk-4.1 libayatana-appindicator ibus python-gobject at-spi2-core xclip xdotool wl-clipboard ydotool'.split()
    (args.output / 'PKGBUILD').write_text(f'''# Exact prebuilt local candidate; no download, install hook or source rebuild.
pkgname=voco
pkgver={version}
pkgrel={revision}
pkgdesc='Local Linux dictation candidate with pinned NVIDIA runtime'
arch=('x86_64')
url='https://github.com/sergiopesch/voco'
license=('MIT' 'Apache-2.0' 'LicenseRef-NVIDIA-Open-Model')
depends=({' '.join(repr(dep) for dep in arch)})
source=('voco-payload.tar')
sha256sums=('{archive_hash}')
noextract=('voco-payload.tar')
options=('!strip' '!debug')
package() {{
  bsdtar -xf "$srcdir/voco-payload.tar" -C "$pkgdir"
}}
''')


if __name__ == '__main__':
    main()
