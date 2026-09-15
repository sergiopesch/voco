# Install VOCO

Ubuntu x86_64 is the reference platform. Debian-derived systems are best-effort.
A complete Debian package includes the NVIDIA English model and CPU runtime.
A plain Tauri bundle is incomplete. See [packaging](linux-packaging.md).

## Published release

Download `voco_latest_amd64.deb` and `voco_latest_checksums.txt` from
[GitHub Releases](https://github.com/sergiopesch/voco/releases). From that folder:

```bash
sha256sum -c voco_latest_checksums.txt
sudo apt install ./voco_latest_amd64.deb
```

Continue only if verification succeeds. These files refer to the latest public
release, which may differ from the development candidate.

### Guided installer

For a specific published release, replace `<version>` with its version number.
Download and inspect the installer before executing it:

```bash
TAG="voco.<version>"
BASE="https://raw.githubusercontent.com/sergiopesch/voco"
wget "$BASE/$TAG/install" -O voco-install
less voco-install
bash voco-install
```

The installer downloads the matching package and verifies its checksum before
installation. Never execute an unreviewed network response through a shell pipe.

## Local candidate

Use the complete package and checksum file provided with that candidate, rather
than a latest-release link. Check the artifact identity before installing:

```bash
sha256sum -c SHA256SUMS
dpkg-deb -f ./voco_*.deb Version
sudo apt install ./voco_*.deb
```

Keep only the intended versioned `.deb` in this folder. Quit VOCO first; copy any
needed recovery text before exiting. Upgrades preserve supported settings and
migrate retired output/assistant settings to direct dictation. A purge is unnecessary.

## First launch

Open VOCO from the application menu, finish microphone setup, and focus a text
field. Press **Alt+D** to start and again to stop. You can change the shortcut in
Settings. Known terminal paste shortcuts are selected automatically.

On Wayland, desktop paste may require the packaged input helpers and the VOCO
IBus source. Follow the setup diagnostics for your session; do not change another
app’s keybindings. See [troubleshooting](troubleshooting.md).

The model lives under `/usr/lib/voco/speech`. Readiness follows worker warmup.
The default path does not download Whisper; explicit legacy/browser dictation
uses that separately pinned model. A failed NVIDIA warmup reports an error.

## Source development

Install the build prerequisites listed in [contributing](contributing.md), then:

```bash
npm ci
npm run check
npm test
npm run build
```

Git source excludes model weights and compiled runtime assets. Provision the
[pinned runtime](linux-packaging.md#runtime-provisioning) before testing NVIDIA
or assembling a complete package. Source checks alone do not qualify an installer.

## Other Linux systems

Userspace checks cover Ubuntu, Debian, Fedora, Linux Mint and an Omarchy-related Arch
profile. This is not proof of every distribution’s default compositor, audio stack
or application. RPM/Arch packages require their own native receipts. AppImage,
Flatpak and Snap are experimental scaffolding, not published support channels.
See [the compatibility evidence](testing/cross-linux-review-2026-09-15.md).

## Remove

```bash
sudo apt remove voco
```

This removes the package and preserves personal settings. VOCO uses XDG directories
under `~/.config/voco`, `~/.local/share/voco`, `~/.local/state/voco` and `~/.cache/voco`.
Inspect these separately before choosing to remove personal data. Files belonging
to other applications are never part of a VOCO uninstall.
