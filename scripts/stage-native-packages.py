#!/usr/bin/env python3
"""Stage native-package recipes from an already verified, immutable VOCO payload.

This packages prebuilt release or candidate bytes, not a portable source rebuild. Build the
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


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_debian_dependencies(value):
    """Require an explicit native mapping when the source package adds a need."""
    mapped = {
        'ibus', 'python3', 'gir1.2-ibus-1.0', 'python3-gi', 'xclip',
        'gir1.2-atspi-2.0', 'at-spi2-core', 'python3-numpy', 'python3-psutil',
        'libsentencepiece0', 'libayatana-appindicator3-1', 'libwebkit2gtk-4.1-0',
        'libgtk-3-0', 'libpulse0', 'libnotify-bin', 'xdotool', 'wl-clipboard', 'procps',
        'libc6 (>= 2.39)', 'libstdc++6 (>= 13.2.0)',
    }
    # Only the reviewed ABI floors below have native translations. Other
    # versioned/alternative requirements need a deliberate translation;
    # silently deleting their constraint would broaden the accepted platforms.
    dependencies = {part.strip() for part in value.split(',')}
    if not dependencies or not dependencies <= mapped:
        raise ValueError('Native dependency mapping requires review for this Debian package')


def package_version(value, native_release=None):
    match = re.fullmatch(r'(\d{4}\.\d+\.\d+)(?:\+local([1-9]\d*))?', value)
    if not match:
        raise ValueError('Expected a final or local VOCO version')
    version, local_revision = match.groups()
    if native_release is not None and (local_revision or not re.fullmatch(r'[1-9]\d*', native_release)):
        raise ValueError('Native release must be a positive integer for a final version')
    revision = local_revision or native_release or '1'
    return version, revision, bool(local_revision)


def rpm_dependencies(distribution):
    common = 'python3 python3-numpy python3-psutil python3-gobject ibus at-spi2-core xclip xdotool wl-clipboard ydotool'.split()
    if distribution == 'fedora':
        return common + 'procps-ng libnotify pulseaudio-libs sentencepiece-libs gstreamer1-plugins-base gstreamer1-plugins-good gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3'.split() + ['glibc >= 2.39', 'libstdc++ >= 13.2.0']
    if distribution == 'opensuse':
        # Tumbleweed's default Python provides these unversioned capabilities.
        # libsentencepiece0 is built from the reviewed companion source recipe.
        return common + 'procps libnotify-tools libpulse0 libsentencepiece0 gstreamer-plugins-base gstreamer-plugins-good libgtk-3-0 libwebkit2gtk-4_1-0 libayatana-appindicator3-1 typelib-1_0-IBus-1_0 typelib-1_0-Atspi-2_0'.split() + ['glibc >= 2.39', 'libstdc++6 >= 13.2.0']
    raise ValueError('Unknown RPM distribution')


def rpm_file_entry(path):
    # RPM's nodocs policy must never discard bundled licensing obligations.
    name = Path(path).name
    license_names = {'COPYRIGHT', 'NOTICE', 'THIRD-PARTY-NOTICES.txt',
                     'THIRD_PARTY_NOTICES.md', 'NVIDIA-NOTICE.txt',
                     'NVIDIA-OPEN-MODEL-LICENSE.html', 'NVIDIA-MODEL-CARD.md',
                     'GGML-LICENSE'}
    is_license = path.startswith('/usr/share/doc/voco/') and (
        name.startswith('LICENSE') or name in license_names)
    return ('%license ' if is_license else '') + path


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
    parser.add_argument('--native-release', help='Positive package revision for a final release (default: 1)')
    parser.add_argument('--rpm-distribution', choices=('fedora', 'opensuse'), default='fedora',
                        help='Native RPM dependency profile (default: fedora)')
    args = parser.parse_args()
    if digest(args.deb) != args.sha256:
        raise ValueError('Debian artifact hash mismatch')
    identity = subprocess.check_output(['dpkg-deb', '-f', str(args.deb), 'Package', 'Version', 'Architecture'], text=True)
    fields = dict(line.split(': ', 1) for line in identity.splitlines())
    if fields['Package'] != 'voco' or fields['Architecture'] != 'amd64':
        raise ValueError('Expected a VOCO amd64 package')
    version, revision, local = package_version(fields['Version'], args.native_release)
    rpm_release = f'{revision}.local' if local else revision
    depends = subprocess.check_output(['dpkg-deb', '-f', str(args.deb), 'Depends'], text=True)
    validate_debian_dependencies(depends.strip())
    # Use the repository's complete-payload verifier before recipe generation.
    subprocess.run(['bash', str(args.verifier.resolve()), str(args.deb.resolve()), fields['Version']], check=True)
    args.output.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix='voco-native-package-') as temporary:
        control = Path(temporary) / 'control'
        subprocess.run(['dpkg-deb', '-e', str(args.deb.resolve()), str(control)], check=True)
        payload = Path(temporary) / 'payload'
        subprocess.run(['dpkg-deb', '-x', str(args.deb.resolve()), str(payload)], check=True)
        # RPM and pacman apply directory modes themselves. Deliberately omit only
        # the byte-verified Debian legacy repair; reject any other maintainer action.
        from debian_maintainer import verify_control
        verify_control(control, payload)
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
        'application_version': version, 'native_release': rpm_release,
        'channel': 'local-candidate' if local else 'final-payload',
        'rpm_distribution': args.rpm_distribution,
        'payload_tar_sha256': archive_hash, 'scope': 'Exact prebuilt candidate payload; not a portable source rebuild',
    }, indent=2) + '\n')
    # Dependencies are explicit per distro. Automatic ELF dependencies remain on
    # RPM; private recognizer libraries must not become public system provides.
    dependencies = rpm_dependencies(args.rpm_distribution)
    # Stock Fedora GNOME has no StatusNotifier host. Install its distro extension
    # only when GNOME is present; enabling it remains an explicit user action.
    recommendations = ('Recommends: (gnome-shell-extension-appindicator if gnome-shell)\n'
                       if args.rpm_distribution == 'fedora' else '')
    spec = f'''Name: voco
Version: {version}
Release: {rpm_release}
Summary: Local English dictation for Linux
License: MIT AND Apache-2.0 AND LicenseRef-NVIDIA-Open-Model
URL: https://github.com/sergiopesch/voco
Source0: voco-payload.tar
BuildArch: x86_64
Requires: {', '.join(dependencies)}
{recommendations}%global debug_package %{{nil}}
%global _binary_payload w3.zstdio
%global __os_install_post %{{nil}}
%global __provides_exclude_from ^/usr/lib/voco/.*$
%global __requires_exclude ^lib(ggml(-base|-cpu)?|nemo_speech_asr(_c)?|bench_nemo_pool)\\.so.*$

%description
Local English dictation with a pinned NVIDIA runtime and model. Native package
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
            spec += rpm_file_entry(row['path']) + '\n'
    (args.output / 'voco.spec').write_text(spec)
    arch = 'procps-ng glibc>=2.39 gcc-libs>=13.2.0 libpulse libnotify python python-numpy python-psutil sentencepiece gst-plugins-good gtk3 webkit2gtk-4.1 libayatana-appindicator ibus python-gobject at-spi2-core xclip xdotool wl-clipboard ydotool'.split()
    (args.output / 'PKGBUILD').write_text(f'''# Exact verified prebuilt payload; no download, install hook or source rebuild.
pkgname=voco
pkgver={version}
pkgrel={revision}
pkgdesc='Local English dictation with a bundled offline speech model'
arch=('x86_64')
url='https://github.com/sergiopesch/voco'
license=('MIT' 'Apache-2.0' 'LicenseRef-NVIDIA-Open-Model')
depends=({' '.join(repr(dep) for dep in arch)})
source=('voco-payload.tar')
sha256sums=('{archive_hash}')
noextract=('voco-payload.tar')
options=('!strip' '!debug' '!purge' '!zipman' '!libtool' '!staticlibs')
package() {{
  bsdtar -xf "$srcdir/voco-payload.tar" -C "$pkgdir"
}}
''')


if __name__ == '__main__':
    main()
