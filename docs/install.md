# Install VOCO

VOCO is published for 64-bit Intel and AMD computers as a Debian package for
Ubuntu and Debian, and as an RPM for Fedora. Both hold the same files: the
English speech model and everything needed to run it, so VOCO needs no
downloads after installation.

## Requirements

| Requirement | Details |
| --- | --- |
| Processor | 64-bit Intel or AMD (x86-64) with AVX2, FMA and F16C |
| System | Ubuntu 24.04 LTS, Ubuntu 26.04 LTS or Debian 13, which install the Debian package with APT, or Fedora 44 Workstation, which installs the RPM with DNF. [Supported systems](platform/README.md#supported-systems) lists their desktops. |
| Desktop | A Wayland or X11 session. GNOME 50 has no X11 session, so on Ubuntu 26.04 and Fedora 44 VOCO runs on Wayland. |
| Audio | A microphone, with PipeWire's PulseAudio service (`pipewire-pulse`), which the supported systems include. PulseAudio itself works only on X11 (see [Microphone problems](troubleshooting.md#microphone-problems)) |
| Wayland typing | Access to `/dev/uinput`, which the package gives the user of the active local session (see [Wayland paste keys](#wayland-paste-keys)) |
| Wayland shortcut | Outside GNOME 46, 48 and 50, a desktop shortcut that runs `voco --toggle` (see [Wayland compositor shortcuts](#wayland-compositor-shortcuts)) |

To check the processor, run this command. It must print all three names.

```bash
grep -o -w -E 'avx2|fma|f16c' /proc/cpuinfo | sort -u
```

## Guided install

Open a terminal in your desktop session and run the installer as your normal
user. It asks for your password when APT or DNF needs it.

```bash
wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.59/install && bash voco-install
```

The installer:

1. Checks that it runs on x86-64 Linux, and picks APT if the system has it,
   otherwise DNF. Then it checks for the other tools it needs.
2. Downloads the package for that package manager, the Debian package for APT
   or the RPM for DNF, and the release's signed checksum list, trying each
   download up to three times.
3. Checks the list's signature with the release key built into the installer,
   then the package's checksum. If a check fails, it installs nothing.
4. Installs the package with APT or DNF, then checks that exactly this release
   is installed.
5. Runs `voco --check-desktop-input` to check [desktop input](#desktop-input).
6. Runs `voco --setup-panel`, which on GNOME 46, 48 and 50 turns on the
   [VOCO panel](#gnome-panel) for your account.
7. Opens VOCO for a short voice test. As root or over SSH it skips this, so
   open VOCO from your desktop.

The installer doesn't touch your settings. VOCO keeps a saved shortcut, and
uses `Alt+D` when it starts without one.

| Exit status | Meaning |
| --- | --- |
| 0 | VOCO is installed and desktop input works. |
| 1 | The installer stopped. It prints the reason and, when it keeps one, the path of a private log. |
| 2 | VOCO is installed, but desktop input needs one more step. |

After status 2, fix the problem the installer names until
`voco --check-desktop-input` passes. On Wayland it's usually
[access to `/dev/uinput`](#wayland-paste-keys): sign out and back in once. The
installer stops before panel setup, so on GNOME also run `voco --setup-panel`.
Then open VOCO.
[Troubleshooting](troubleshooting.md#the-installer-stops) explains the common messages.

### Install a specific release

Set `TAG` to the release you want. Download the installer and read it before
you run it.

```bash
TAG="voco.2026.0.59"
BASE="https://raw.githubusercontent.com/sergiopesch/voco"
wget "$BASE/$TAG/install" -O voco-install
less voco-install
bash voco-install
```

Each installer installs only its own release and carries the release key's
fingerprint.

## Manual install

These commands download the latest release, check the release key's
fingerprint and the signature, verify the package checksum and install the
package. Each block stops at the first command that fails, so the package is
installed only after every check passes. `gpgv` must report a good signature.

The release key's fingerprint is `B33C7C6AAEC8C20433A7A837540796453D8E3865`.
It also appears in [KEYS](../KEYS) and on each release page. Compare it with a
copy you trust before you rely on it.

A manual install doesn't check desktop input or turn on the panel, so
afterwards run `voco --check-desktop-input` (see [Desktop input](#desktop-input)),
follow [GNOME panel](#gnome-panel), then open VOCO from your app menu.

### Ubuntu and Debian

The commands need `curl`, `gpg` and `gpgv`:

```bash
sudo apt install curl gpg gpgv
```

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

`sha256sum -c voco_latest_checksums.txt` must print `voco_latest_amd64.deb: OK`.

### Fedora

The commands need `curl`, and `gpg` and `gpgv` from `gnupg2`:

```bash
sudo dnf install curl gnupg2
```

```bash
(
  set -e
  mkdir -p ~/Downloads/voco-install
  cd ~/Downloads/voco-install
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_x86_64.rpm
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_rpm_checksums.txt
  curl -fLO https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_rpm_checksums.txt.asc
  curl -fLo KEYS https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.59/KEYS
  fingerprints="$(gpg --show-keys --with-colons KEYS | awk -F: '$1 == "fpr" { print $10 }')"
  test "$fingerprints" = B33C7C6AAEC8C20433A7A837540796453D8E3865
  gpg --dearmor < KEYS > voco-release-keyring.gpg
  gpgv --keyring ./voco-release-keyring.gpg voco_latest_rpm_checksums.txt.asc voco_latest_rpm_checksums.txt
  sha256sum -c voco_latest_rpm_checksums.txt
  sudo dnf install ./voco_latest_x86_64.rpm
)
```

`sha256sum -c voco_latest_rpm_checksums.txt` must print
`voco_latest_x86_64.rpm: OK`. The RPM carries no OpenPGP signature of its own,
so DNF warns that it skipped OpenPGP checks for it. The signed checksum list you
just checked is what proves the file.

### Verify with the repository script

In a clone of this repository, `scripts/verify-release.sh` checks every file a
checksum list names, then the list's signature against [KEYS](../KEYS). It
accepts any key in the KEYS file you give it, so check the fingerprint yourself.

```bash
bash scripts/verify-release.sh --keys KEYS ~/Downloads/voco-install/voco_latest_checksums.txt
```

The files must sit beside the list. `voco_latest_checksums.txt` names only the
Debian package, `voco_latest_rpm_checksums.txt` only the RPM, and
`voco_checksums.txt` every release file.

## First launch

VOCO opens with a short voice test that uses your default microphone. The test
only shows your words in the VOCO window.

1. Choose **Start test** and say a sentence. Your words appear as you speak.
2. Choose **Finish test**.
3. Choose **Done**. If the button says **Check desktop setup**, fix what VOCO
   shows, then choose it again.

To dictate, click where you want the text, press `Alt+D` and speak. Press
`Alt+D` again to finish. See [Everyday use](everyday-use.md).

## Desktop input

VOCO types by pasting. It puts each phrase on the clipboard and presses
Shift+Insert in the app that has keyboard focus. Helper programs set the
clipboard. On X11 `xdotool` presses the keys; on Wayland VOCO presses them
itself, through its own virtual keyboard:

| Session | Keys | Clipboard | Setup |
| --- | --- | --- | --- |
| X11 | `xdotool` | `xclip` | None; the package depends on both |
| Wayland | VOCO's virtual keyboard | `wl-copy`, or `xclip` on GNOME | [Access to `/dev/uinput`](#wayland-paste-keys), from the package's udev rule |

To check, run `voco --check-desktop-input`. It doesn't record, copy or type
anything.

### Wayland paste keys

On Wayland, VOCO sends the paste keys through a virtual keyboard it creates on
`/dev/uinput`, the kernel's interface for virtual input devices. No daemon,
service or group is involved. The package installs a udev rule that gives the
user of the active local session access to `/dev/uinput`, and applies it as it
installs, so your session usually has access straight away.

If `voco --check-desktop-input` says VOCO can't open `/dev/uinput`, sign out and
back in once, then check again. [Access to /dev/uinput](platform/README.md#access-to-devuinput)
explains the rule, how to check it and how to use a different policy.

## GNOME panel

On GNOME 46, 48 and 50, VOCO includes an optional top-bar panel with live
microphone bars, a menu and a Stop control. On Wayland it also keeps your
`Alt+D` or `Alt+Shift+D` shortcut from reaching the app you are typing in. The
guided installer turns it on. Otherwise, run `voco --setup-panel` or choose
**Enable live panel** on VOCO's Help page. Save your work, then sign out and
back in to load the panel. To check it without changing anything, run
`voco --check-panel`.

Panel setup adds only VOCO to GNOME's enabled extensions. It doesn't change
other extensions or settings an administrator controls. Other GNOME versions
and other desktops use the system tray. On GNOME the tray needs an AppIndicator
extension. Ubuntu includes one, so without the panel VOCO shows a tray icon
there. Debian 13 and Fedora 44 don't turn one on, so there the panel is VOCO's
only icon in the top bar unless you add such an extension. See the
[panel guide](../integrations/gnome/README.md).

## Wayland compositor shortcuts

The compositor is the part of a Wayland desktop that draws windows and handles
shortcuts. Without the [GNOME panel](#gnome-panel), VOCO can't reserve a
global shortcut on Wayland. Instead, bind a key to `voco --toggle` in your
desktop settings. The command asks the running VOCO to start or stop dictation.
It never opens VOCO, so keep VOCO running. The panel handles only `Alt+D` and
`Alt+Shift+D`, so with the panel bind any other key the same way.

Pick an unused key such as F8. VOCO briefly holds Shift while it pastes, so the
binding must also work with Shift held. Either let it ignore modifiers or add a
second binding for Shift+F8.

| Desktop | Binding |
| --- | --- |
| GNOME | Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts. Add `voco --toggle` for F8, and a second entry for Shift+F8. |
| KDE Plasma | System Settings → Keyboard → Shortcuts. Add the command `voco --toggle`, then assign F8 and Shift+F8. |
| Hyprland (Lua configuration) | `hl.bind("F8", hl.dsp.exec_cmd("voco --toggle"), { ignore_mods = true })` |

Don't hold Alt or Super when you press the key to stop. They can change the
final paste or open app menus. Test start and stop in the app you plan to use.
VOCO can't see which key your desktop assigned, so its Shortcut page keeps
showing its built-in shortcut.

## Chromium extension

VOCO Exact Field is an optional extension for Google Chrome and Chromium. In a
tab where you turn it on, `Alt+Shift+V` dictates straight into one plain text
field instead of pasting. The package installs the extension at
`/usr/share/voco/chromium` and registers its native messaging host, the small
program that connects the browser to VOCO.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select `/usr/share/voco/chromium`.
3. Click the extension's toolbar button in each tab where you want it.

See [Browser fields](everyday-use.md#browser-fields) and the
[extension guide](../integrations/chromium/README.md).

## IBus input source

IBus is the input method framework that GNOME and many other desktops use. The
optional **VOCO Dictation** input source reserves your shortcut in text fields
while it is selected, so the key press doesn't also reach the app. It never
types; VOCO still pastes as usual. It ignores password, PIN and terminal fields.

To use it, add **VOCO Dictation** as an input source in your desktop's keyboard
settings and select it. VOCO never switches input sources for you. After an
upgrade, sign out and back in, or restart IBus, to load the new version.

## Upgrade

VOCO checks GitHub for new releases but never installs them. To upgrade:

1. Finish any dictation, and copy anything you need from **Review**.
2. Quit VOCO. Choose **Quit VOCO** in the tray menu. The GNOME panel has no
   quit item, so with the panel, or without a tray icon, run `pkill -x voco`.
3. Run the installer for the new release, or repeat the manual install.

Your settings are kept. If panel setup asks you to, save your work and sign out
and back in.

## Remove

Quit VOCO, then remove the package. On Ubuntu and Debian:

```bash
sudo apt remove voco
```

On Fedora:

```bash
sudo dnf remove voco
```

This also removes the package's `/dev/uinput` rule, but the access the rule
gave lasts until you restart the computer.

On GNOME, also turn off the VOCO panel in the Extensions app, or run
`gnome-extensions disable voco-panel@voco.local`. Remove the
**VOCO Dictation** input source and the Chromium extension if you added them.

Removing the package keeps your settings and any text saved for Review. See
[What VOCO keeps](everyday-use.md#what-voco-keeps) for the folders to delete if
you want them gone.

## Installer output

In a colour terminal at least 64 columns wide and 12 rows tall, the installer
shows an animated progress view. It prints plain lines instead when its output
isn't a terminal, `NO_COLOR` is set or `TERM` is `dumb`. GNOME's
reduced-animation setting turns the animation off. On Fedora the view steps
aside while DNF installs, and DNF shows its own output. You can also choose:

```bash
VOCO_INSTALL_PLAIN=1 bash voco-install      # plain lines without colour
VOCO_INSTALL_NO_MOTION=1 bash voco-install  # progress view without animation
```

## Build from source

Install Node.js 24 and Rust first. [CONTRIBUTING.md](../CONTRIBUTING.md)
describes the development setup. The common checks are:

```bash
npm ci
npm run check
npm test
npm run build
```

Git doesn't contain the speech model or the native speech libraries. Before you
build a complete package, provision them as described in
[Runtime provisioning](linux-packaging.md#runtime-provisioning). Then
`./scripts/setup.sh --install` builds, checks and installs the Debian package
with APT. Both packages are built on an APT system;
[Linux packaging](linux-packaging.md) covers the RPM.
