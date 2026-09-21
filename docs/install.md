# Install VOCO

Ubuntu 24.04 or later on x86_64 is the package dependency baseline; AVX2, FMA
and F16C CPU support are required. Tested environments are listed in the release
notes. Debian-derived systems are best-effort.
A complete Debian package includes the NVIDIA English model and CPU runtime.
A plain Tauri bundle is incomplete. See [packaging](linux-packaging.md).

## Published release

The [README command](../README.md#get-started) runs the guided installer from
the current published **2026.0.45** tag. It downloads that exact release and
verifies its package checksum before installation. On Wayland, this older installer
can omit the input helpers; complete the [Wayland setup](platform/README.md#ydotoold-ydotool-daemon)
before testing dictation in another app. The .46 candidate repairs dependency
installation and refuses to finish onboarding while desktop input is unavailable.

For a manual installation, these links always follow the latest public release:

```bash
(
  set -e
  mkdir -p ~/Downloads/voco-install
  cd ~/Downloads/voco-install
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_amd64.deb
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_checksums.txt
  sha256sum -c voco_latest_checksums.txt
  sudo apt install ./voco_latest_amd64.deb
)
```

Continue only if verification succeeds. These files refer to the latest public
release, which may differ from the development candidate. Checksums are integrity
checks. Releases also ship signed checksums (`*.asc`); verify
those with `scripts/verify-release.sh` and the `KEYS` file from git, after checking
the fingerprint out of band.

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

Open VOCO from the application menu. Your system microphone and speaker
are selected. Click **Start test**, speak, and check that the signal band moves
and your words appear. On the design branch, choose **Finish test**. VOCO then checks desktop input
prerequisites before showing **Your voice, ready.** and **Done**.
If setup needs attention, complete the indicated setup and click **Check desktop setup**.
Your successful voice test remains available; an external cursor is not required
for this check. Once onboarding finishes, focus a text field.
Press **Alt+D** to start and again to stop. You can change the shortcut in
the **Shortcut** section. Known terminal paste shortcuts are selected automatically.

VOCO requires a verifiable editable cursor before automatic desktop
dictation. If no cursor is available, VOCO displays a notification; click in an
accessible text field and try again. Password fields are excluded. Changing fields
during a recording stops delivery; review retained text before copying it.
Custom controls that do not expose an accessible cursor are not supported.

On X11, desktop paste uses xclip and xdotool. On Wayland, it uses ydotool plus
the appropriate clipboard helper; its input service and permissions may require
setup. The Debian package recommends both ydotool and ydotoold because Ubuntu 24.04
packages the client and daemon separately. Availability differs by distribution.
If it is unavailable, X11 remains usable; Wayland paste is unavailable until the
helper and its service are installed and configured. The optional VOCO IBus source handles shortcuts, not text mutation. Follow
VOCO’s setup diagnostics for your session; do not change another app’s keybindings.
See [troubleshooting](troubleshooting.md).

### Wayland compositor shortcuts

Assign `voco --toggle` to an unused, non-repeating key in your desktop's shortcut
settings, and keep VOCO running. Use an unused key such as **F8**, with a binding
that also accepts Ctrl and Ctrl+Shift: clipboard delivery briefly uses those
modifiers. Hyprland supports `ignore_mods`; KDE can assign the three variants to
one command. Check every variant for conflicts. Avoid holding Alt or Meta during
Stop, and test Start and Stop in your editor before normal use.
The compositor binding is separate from VOCO's built-in shortcut setting; the
command cannot identify which key your desktop assigned. See the
[Hyprland example](linux-support.md#hyprland-shortcut-integration-in-the-43-candidate).

### GNOME tray integration

VOCO keeps its controls in the system tray. Stock Fedora GNOME needs the
distribution's AppIndicator extension; the .43 Fedora package recommends it when
GNOME is installed. If it is missing:

```bash
sudo dnf install gnome-shell-extension-appindicator
```

Sign out and back in after installing the extension, then enable it in GNOME
Extensions or run:

```bash
gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com
```

Confirm VOCO's tray icon is visible before hiding its window. Ubuntu's packaged
GNOME session and KDE/Omarchy have their own tray integrations. Installing an
extension does not configure microphone access, a compositor shortcut or ydotoold.

The model lives under `/usr/lib/voco/speech`. Readiness follows worker warmup.
The default path does not download Whisper; explicit legacy/browser dictation
uses that separately pinned model. Explicit recovery of normal NVIDIA dictation
also uses the bundled NVIDIA model and works without a Whisper cache. A failed NVIDIA warmup reports an error.

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

See the [Linux support plan](linux-support.md) for .43 native package work and
its outstanding gates. Development recipes are not public installers.


Historical userspace checks cover Ubuntu, Debian, Fedora, Linux Mint and an
Omarchy-related Arch profile. Consult the [.45 release notes](releases/2026.0.45.md)
for the recorded checks, and [release status](release-candidate.md) for newer candidates. This is not proof of every distribution’s default compositor, audio stack
or application. RPM/Arch packages require their own native receipts. AppImage,
Flatpak and Snap are experimental scaffolding, not published support channels.
See [the compatibility evidence](testing/cross-linux-review-2026-09-15.md).

## Remove

Quit VOCO first. If the .46 installer enabled its per-login input service, stop
and disable that service before removing the package:

```bash
systemctl --user disable --now voco-ydotoold.service
sudo apt remove voco
```

This removes the package and preserves personal settings. VOCO uses XDG directories
under `~/.config/voco`, `~/.local/share/voco`, `~/.local/state/voco` and `~/.cache/voco`.
Inspect these separately before choosing to remove personal data. Files belonging
to other applications are never part of a VOCO uninstall.

Microphone capture formats must be between 8 and 96 kHz, matching the bundled
recognizer and recovery runtime. An unsupported format is rejected before recording
starts; select a supported format in the system audio settings, then restart VOCO
so its audio context uses the new format.

### Installer presentation candidate

The design branch shows measured download bytes and average speed in colour
terminals, and static lines for redirected output, NO_COLOR or TERM=dumb. The
progress has no estimated percentage or time remaining. Downloads make at most
three attempts and continue partial transfers within that run when the server
supports it. Interrupted runs remove temporary downloads; running the installer
again starts fresh. Checksums are always verified before APT runs.

A failed download prints the path to a private diagnostic log. A missing release
file points to the versioned release page; connection failures suggest checking
the connection and rerunning. Successful runs remove the temporary log.
