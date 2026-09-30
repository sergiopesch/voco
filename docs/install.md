# Install VOCO

VOCO is published as a Debian package for 64-bit Intel and AMD computers. The
package includes the English speech model and everything needed to run it, so
VOCO needs no downloads after installation.

## Requirements

| Requirement | Details |
| --- | --- |
| Processor | 64-bit Intel or AMD (amd64) with AVX2, FMA and F16C |
| System | Ubuntu 24.04 or later, or another Debian-based system with glibc 2.39 or later |
| Desktop | An X11 or Wayland session. The reference desktop is Ubuntu 24.04 with GNOME 46. |
| Audio | A microphone, with PulseAudio or PipeWire's PulseAudio service (Ubuntu includes it) |
| Wayland typing | Write access to `/dev/uinput` for your login (see [Wayland input service](#wayland-input-service)) |
| Wayland shortcut | Outside GNOME 46, a desktop shortcut that runs `voco --toggle` (see [Wayland compositor shortcuts](#wayland-compositor-shortcuts)) |

To check the processor, run this command. It must print all three names.

```bash
grep -o -w -E 'avx2|fma|f16c' /proc/cpuinfo | sort -u
```

## Guided install

Open a terminal in your desktop session and run the installer as your normal
user. It asks for your password when APT needs it.

```bash
wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.59/install && bash voco-install
```

The installer:

1. Checks that it runs on Linux amd64 and has the tools it needs.
2. Downloads the package and its signed checksum list, trying each download up
   to three times.
3. Checks the list's signature with the release key built into the installer,
   then the package's checksum. If a check fails, it installs nothing.
4. Installs the package with APT, plus `ydotool` and `ydotoold` on Wayland.
5. Keeps your saved shortcut, or sets `Alt+D` if VOCO has no settings yet.
6. On Wayland, sets up the [input service](#wayland-input-service). Then it runs
   `voco --check-desktop-input`.
7. On GNOME 46, turns on the [VOCO panel](#gnome-panel) for your account.
8. Opens VOCO for a short voice test. As root or over SSH it skips this, so
   open VOCO from your desktop.

| Exit status | Meaning |
| --- | --- |
| 0 | VOCO is installed and desktop input works. |
| 1 | The installer stopped. It prints the reason and, when it keeps one, the path of a private log. |
| 2 | VOCO is installed, but desktop input needs one more step. |

After status 2, fix the problem the installer names, usually the
[Wayland input service](#wayland-input-service), until
`voco --check-desktop-input` passes. The installer stops before panel setup, so
on GNOME 46 also run `voco --setup-panel`. Then open VOCO.
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
package. They need `curl`, `gpg` and `gpgv`:

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

The block stops at the first command that fails, so the package is installed
only after every check passes. `gpgv` must report a good signature, and
`sha256sum -c voco_latest_checksums.txt` must print
`voco_latest_amd64.deb: OK`.

The release key's fingerprint is `B33C7C6AAEC8C20433A7A837540796453D8E3865`.
It also appears in [KEYS](../KEYS) and on each release page. Compare it with a
copy you trust before you rely on it.

A manual install doesn't set up desktop input or the panel. APT installs the
recommended `ydotool` and `ydotoold` unless you turned recommended packages
off. Follow [Wayland input service](#wayland-input-service) and
[GNOME panel](#gnome-panel), then open VOCO from your app menu.

### Verify with the repository script

In a clone of this repository, `scripts/verify-release.sh` checks every file a
checksum list names, then the list's signature against [KEYS](../KEYS). It
accepts any key in the KEYS file you give it, so check the fingerprint yourself.

```bash
bash scripts/verify-release.sh --keys KEYS ~/Downloads/voco-install/voco_latest_checksums.txt
```

The files must sit beside the list. `voco_latest_checksums.txt` names only the
package, and `voco_checksums.txt` names every release file.

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
Shift+Insert in the app that has keyboard focus. Helper programs send the keys
and set the clipboard:

| Session | Keys | Clipboard | Setup |
| --- | --- | --- | --- |
| X11 | `xdotool` | `xclip` | None; the package depends on both |
| Wayland | `ydotool` with `ydotoold` | `wl-copy`, or `xclip` on GNOME | The [input service](#wayland-input-service) |

To check the helpers, run `voco --check-desktop-input`. It doesn't record, copy
or type anything.

### Wayland input service

On Wayland, `ydotoold` sends key presses through `/dev/uinput`, the kernel's
virtual input device. VOCO's user service, `voco-ydotoold.service`, runs it for
your login while your graphical session is open. With Ubuntu 24.04's
`ydotool`, the service runs a matching `ydotoold` that VOCO bundles; otherwise
it runs the system `ydotoold`.

Your account needs write access to `/dev/uinput`. VOCO never changes device
permissions or group membership. Set up access as your system's policy allows;
[Platform support](platform/README.md#ydotoold-ydotool-daemon) explains the
options.

If `voco --check-desktop-input` already passes, for example because your
system runs its own `ydotoold`, you are done. Otherwise quit VOCO and run:

```bash
sudo apt install ydotool ydotoold
voco --setup-desktop-input
systemctl --user enable --now voco-ydotoold.service
voco --check-desktop-input
```

`voco --setup-desktop-input` updates VOCO's service to match the installed
package. It won't change a VOCO service you edited or replace another running
`ydotoold`. In those cases it reports the problem instead.

## GNOME panel

On GNOME 46, VOCO includes an optional top-bar panel with live microphone bars,
a menu and a Stop control. On Wayland it also keeps your `Alt+D` or `Alt+Shift+D`
shortcut from reaching the app you are typing in. The guided installer turns it on.
Otherwise, run `voco --setup-panel` or choose **Enable live panel** on VOCO's
Help page. Save your work, then sign out and back in to load the panel. To
check it without changing anything, run `voco --check-panel`.

Panel setup adds only VOCO to GNOME's enabled extensions. It doesn't change
other extensions or settings an administrator controls. Other GNOME versions
and other desktops use the system tray. On GNOME the tray needs an AppIndicator
extension, which Ubuntu includes. See the [panel guide](../integrations/gnome/README.md).

## Wayland compositor shortcuts

The compositor is the part of a Wayland desktop that draws windows and handles
shortcuts. Outside GNOME 46, VOCO can't reserve a global shortcut on Wayland.
Instead, bind a key to `voco --toggle` in your desktop settings. The command
asks the running VOCO to start or stop dictation. It never opens VOCO, so keep
VOCO running. On GNOME 46 the panel handles only `Alt+D` and `Alt+Shift+D`, so
bind any other key the same way.

Pick an unused key such as F8. VOCO briefly holds Shift while it pastes, so the
binding must also work with Shift held. Either let it ignore modifiers or add a
second binding for Shift+F8.

| Desktop | Binding |
| --- | --- |
| GNOME other than 46 | Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts. Add `voco --toggle` for F8, and a second entry for Shift+F8. |
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
   quit item, so with the panel run `pkill -x voco`.
3. Run the installer for the new release, or repeat the manual install.

Your settings are kept. If panel setup asks you to, save your work and sign out
and back in.

## Remove

Quit VOCO, then turn off its input service and remove the package:

```bash
systemctl --user disable --now voco-ydotoold.service
sudo apt remove voco
```

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
reduced-animation setting turns the animation off. You can also choose:

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
`./scripts/setup.sh --install` builds, checks and installs the package with APT.
