# Native Linux packages

Ubuntu/Debian packages are **2026.0.45**. Fedora, openSUSE and Arch/Omarchy packages
remain **2026.0.43**. Use each channel only with assets from its matching published
[GitHub release](https://github.com/sergiopesch/voco/releases).
Source files and drafts do not establish availability; check
[release status](release-candidate.md) first. The earlier .42 release is Debian-only.

Choose the package for your distribution. Recognition uses the same bundled CPU
model in every format; the native dependency profile is what differs.

| System | Package | Additional package |
| --- | --- | --- |
| Ubuntu, Debian, Mint | `voco_2026.0.45_amd64.deb` | Resolved by apt |
| Fedora 44 | `voco-2026.0.43-1.fedora.x86_64.rpm` | Resolved by dnf |
| openSUSE Tumbleweed | `voco-2026.0.43-1.opensuse.x86_64.rpm` | `libsentencepiece0-0.2.1-2.x86_64.rpm` |
| Arch, Omarchy | `voco-2026.0.43-1-x86_64.pkg.tar.zst` | `sentencepiece-0.2.1-2-x86_64.pkg.tar.zst` |

All require x86-64 with AVX2/FMA/F16C, glibc 2.39+ and compatible libstdc++.
Other architectures and older distribution releases are not covered. Package
compatibility and desktop evidence are recorded separately in the
[support matrix](linux-support.md).

## Verify before installation

Use the versioned release assets, matching platform checksum file and detached
signature. Check the publisher fingerprint through a trusted independent channel
before trusting `KEYS`. Never import a private key or disable package signature
verification. The [verification script](../scripts/verify-release.sh) checks every
file listed by a checksum manifest and its publisher signature in an isolated
keyring. Run it from a checkout of the matching release source, with the manifest
path pointing to your download folder:

```bash
bash scripts/verify-release.sh --keys /path/to/downloads/KEYS /path/to/downloads/PLATFORM_checksums.txt
```

Replace `PLATFORM_checksums.txt` with the manifest supplied for your package
channel. Keep all files it lists in the same download folder. Continue only after
the script reports that both checksums and publisher signature verified.

Quit VOCO and copy any needed recovery text before an upgrade. Do not purge your
settings. Native package managers preserve user-owned configuration; VOCO does
not install a system microphone service or change your desktop shortcuts.

## Install with the native package manager

Debian family:

```bash
sudo apt install ./voco_2026.0.45_amd64.deb
```

Fedora, after importing the verified public publisher key:

```bash
sudo rpm --import KEYS
sudo dnf install ./voco-2026.0.43-1.fedora.x86_64.rpm
```

openSUSE uses its own dependency profile and the accompanying tokenizer library:

```bash
sudo rpm --import KEYS
sudo zypper install ./libsentencepiece0-0.2.1-2.x86_64.rpm ./voco-2026.0.43-1.opensuse.x86_64.rpm
```

On Arch and Omarchy, add and locally trust the verified publisher key first. The
fingerprint below must match the key you independently checked:

```bash
sudo pacman-key --add KEYS
sudo pacman-key --lsign-key B33C7C6AAEC8C20433A7A837540796453D8E3865
sudo pacman -U ./sentencepiece-0.2.1-2-x86_64.pkg.tar.zst ./voco-2026.0.43-1-x86_64.pkg.tar.zst
```

Keep each Arch package's matching `.sig` beside it. The companion tokenizer
packages come from the [pinned source recipes](../packaging/dependencies/sentencepiece/README.md);
they are not claims of an official distribution repository or AUR submission.
Release source and license assets remain available for inspection and rebuilding.

## Finish desktop setup

Open VOCO and complete [first launch](install.md#first-launch). In .44, Start Test
selects and allows the default microphone. In .43, select and allow the microphone
explicitly for the app session. Install and
configure the distribution's input daemon for paste with narrowly scoped access;
[helper setup](platform/README.md#ydotoold-ydotool-daemon) explains the boundary.
GNOME may need its packaged AppIndicator extension to expose the tray controls.

Omarchy additionally needs the [tested Hyprland binding](linux-support.md#hyprland-shortcut-integration-in-the-43-candidate).
KDE and GNOME use their desktop shortcut settings. Check that Start and Stop both
work, including the Ctrl/Shift variants used during clipboard delivery. A package
installation cannot prove your custom shortcut or receiving editor works.

Test a disposable text field before using VOCO for important text. Keep that field
focused, review the transcript and send it yourself; VOCO never presses Enter.
For an interrupted session, use explicit Retry or Copy rather than starting a
second automatic paste over uncertain text.
