# Install VOCO

Ubuntu 24.04 or later on x86_64 is the package dependency baseline; AVX2, FMA
and F16C CPU support are required. Tested environments are listed in the release
notes. Debian-derived systems are best-effort.
A complete Debian package includes the NVIDIA English model and CPU runtime.
A plain Tauri bundle is incomplete. See [packaging](linux-packaging.md).

## Published release

The [README command](../README.md#get-started) runs the guided installer from
the published **2026.0.59** tag. That version-pinned installer verifies the publisher
signature on the checksum manifest, then verifies the package checksum. The signed
manual procedure below applies the same authentication boundary. On Wayland the
guided installer installs and checks the input helpers. Onboarding checks the
live GNOME Stop shortcut after login. If setup is incomplete, follow the
[Wayland setup](platform/README.md#ydotoold-ydotool-daemon) instructions.
Onboarding completion requires a successful voice test and desktop readiness.

For a manual installation, these links always follow the latest public release:

```bash
(
  set -e
  mkdir -p ~/Downloads/voco-install
  cd ~/Downloads/voco-install
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_amd64.deb
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_checksums.txt
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_checksums.txt.asc
  curl -fLo KEYS https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.59/KEYS
  fingerprints="$(gpg --show-keys --with-colons KEYS | awk -F: '$1 == "fpr" { print $10 }')"
  test "$fingerprints" = B33C7C6AAEC8C20433A7A837540796453D8E3865
  gpg --dearmor < KEYS > voco-release-keyring.gpg
  gpgv --keyring ./voco-release-keyring.gpg voco_latest_checksums.txt.asc voco_latest_checksums.txt
  sha256sum -c voco_latest_checksums.txt
  sudo apt install ./voco_latest_amd64.deb
)
```

Continue only if every verification command succeeds. These files refer to the
latest public release, which may differ from the development candidate. The
fingerprint above is pinned to the current publisher key; check it independently
before relying on a newly downloaded installer or release. A key rotation requires
an updated, independently verified fingerprint. The repository's
`scripts/verify-release.sh` also verifies signed release manifests offline.

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

Starting with 2026.0.55, the installer requires a detached publisher
signature for the release checksums before verifying the package checksum and
installing it. An unsigned candidate cannot be installed by the guided flow.
Never execute an unreviewed network response through a shell pipe.

The .56 guided installer requests one automatic VOCO launch after package
verification and desktop setup succeed. It uses the invoking desktop user's
existing environment and detaches from the installer terminal. Root, remote and
headless invocations keep manual opening instructions; a launch failure leaves
the successful installation intact and explains how to open VOCO manually.
Automatic opening does not start microphone capture or complete onboarding.
Older immutable installers retain their original opening instructions.

## Local candidate

Use the complete package and checksum file provided with that candidate, rather
than a latest-release link. Use candidate files from a trusted build; their
checksum alone does not authenticate a publisher. Check the artifact identity
before installing:

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
and your words appear. Choose **Finish test**. VOCO then checks desktop input
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

### Chromium and Electron applications

Some browsers and Electron apps expose their text cursor only when accessibility
is enabled. If VOCO asks you to check an app's accessibility support, fully quit
that app and launch it with its native accessibility bridge and renderer enabled:

```bash
env ACCESSIBILITY_ENABLED=1 brave --force-renderer-accessibility
```

Use the app's own command in place of `brave` (`chatgpt` for the tested Codex desktop
installation). Closing a window may leave the app running; the flags take effect
only on a new application process. For a persistent change, copy the app's desktop
launcher into `~/.local/share/applications/` and apply the same environment and flag
to its `Exec` entries, preserving its icon and other metadata. VOCO's installer
does not change other apps' launchers or global accessibility preferences.

The .48 candidate also provides `voco --check-cursor`, a read-only check of the
currently focused text field. To allow time to focus a field after starting it:

```bash
sleep 3; voco --check-cursor
```

This checks cursor accessibility without recording, copying or typing. It does not
guarantee that every custom editor accepts dictation. See the [compatibility evidence](testing/fresh-install-2026-09-21.md#codex-and-brave-follow-up).

### Desktop input helpers

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

The Debian package bundles the GNOME 46 live panel. The guided
installer runs `voco --setup-panel` as the desktop user. After a manual APT install,
use the same command or **Enable live panel** in onboarding/Help. This adds only
VOCO to enabled extensions; it preserves other extensions and global policy.
If a session restart is requested, save your work and sign out and back in.
`voco --check-panel` checks activation without changing settings. The package
maintainer scripts never enable a user extension. Other GNOME versions keep the
native tray fallback; live bars are qualified only on GNOME 46.

On GNOME Wayland, **Alt+D** and **Alt+Shift+D** need the live companion to
consume Stop. A package installed after this login may be enabled but not yet
loaded. VOCO checks this during onboarding and before starting cursor dictation;
it shows setup guidance or sends a tray notification if a new login is needed.
This prevents the Stop shortcut from
selecting a browser address or changing another app's focus while final text
is being delivered. After signing back in, use `voco --check-panel` to confirm
that it reports active before testing those shortcuts.


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
Desktop dictation, browser dictation and explicit recovery use the bundled
Nemotron model. No separate recognition model is downloaded. A failed warmup
reports an error. See [release status](release-candidate.md) for current downloads.

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

See the [Linux support matrix](linux-support.md) for the .43 native channels and
their recorded scope. Development recipes are not public installers.


Historical userspace checks cover Ubuntu, Debian, Fedora, Linux Mint and an
Omarchy-related Arch profile. Consult the [support matrix](linux-support.md)
for those recorded checks, the [.59 release notes](releases/2026.0.59.md) for the
current Ubuntu/Debian cut, and [release status](release-candidate.md) for current downloads.
This is not proof of every distribution’s default compositor, audio stack
or application. RPM/Arch packages require their own native receipts. AppImage,
Flatpak and Snap are experimental scaffolding, not published support channels.
See [the compatibility evidence](testing/cross-linux-review-2026-09-15.md).

## Remove

Quit VOCO first. If the guided installer enabled its per-login input service, stop
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

### Installer progress

The installer shows measured download bytes and average speed in colour
terminals, and static lines for redirected output, NO_COLOR or TERM=dumb. The
progress has no estimated percentage or time remaining; completion shows elapsed
download time. Downloads make at most three attempts and continue partial transfers
within that run when the server supports it.
Interrupted runs remove temporary downloads; running the installer again starts
fresh. Checksums are always verified before APT runs. The owned staging directory
contains public release files and permits APT's unprivileged reader to access the
package; private diagnostic logs remain restricted to your account.

A failed download prints the path to a private diagnostic log. A missing release
file points to the versioned release page; connection failures suggest checking
the connection and rerunning. Successful runs remove the temporary log.

The **.52 installer** adds Signal + Silver sweep presentation.
Signal bars show recent measured download rates; a brief silver highlight marks
entry into a phase. Animation never introduces a minimum stage duration. Release
checksums download alongside the package, but verification still completes before
installation. Unfinished optional helper prefetches defer to the final APT transaction.

On an interactive terminal with Python already available, APT reports its own
package progress inside the VOCO view. Passwords, package questions and unexpected
output remain visible. APT percentages describe its current phase, not the whole
installation. Minimal systems and restricted sudo policies retain ordinary APT
output; no presentation dependency is installed. Set `VOCO_INSTALL_NO_MOTION=1`
to keep measured updates without animation, or `VOCO_INSTALL_PLAIN=1` for static
output. GNOME's disabled-animation setting is also respected. See the
[measured comparison and qualification limits](testing/installer-performance-2026-09-22.md).
