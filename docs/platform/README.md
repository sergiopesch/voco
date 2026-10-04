# Platform support

VOCO runs on x86-64 Linux desktops, in Wayland and X11 sessions. This page
covers the systems VOCO supports and how they are tested, what the computer
needs, how VOCO pastes and receives its shortcut, and what Wayland paste keys
need. [Install VOCO](../install.md) covers installation, and
[Architecture](../architecture/README.md) follows a recording.

## Supported systems

| System | Desktop | Sessions | Package | Without the panel |
| --- | --- | --- | --- | --- |
| Ubuntu 24.04 LTS | GNOME 46 | Wayland, X11 | `voco_<version>_amd64.deb`, with APT | Tray icon, through Ubuntu's AppIndicator extension |
| Ubuntu 26.04 LTS | GNOME 50 | Wayland | `voco_<version>_amd64.deb`, with APT | Tray icon, through Ubuntu's AppIndicator extension |
| Debian 13 | GNOME 48 | Wayland, X11 | `voco_<version>_amd64.deb`, with APT | No top-bar icon unless you add an AppIndicator extension |
| Fedora 44 Workstation | GNOME 50 | Wayland | `voco-<version>-1.x86_64.rpm`, with DNF | No top-bar icon unless you add an AppIndicator extension |

The [GNOME panel](../install.md#gnome-panel) works on all four, and the guided
installer turns it on; after you sign out and back in, it replaces the tray icon
while VOCO runs. Without the panel or a tray icon, open VOCO from your app menu.

The two packages hold the same files and need glibc 2.39 or later: they are
built on Ubuntu 24.04, whose glibc 2.39 and GCC 13 runtime set their floors.
Other systems that meet the package dependencies may run VOCO, but nothing here
tests them, and other GNOME versions use the tray instead of the panel.

## How VOCO is tested

Each kind of check shows something different, and a check covers only the
system and GNOME version it ran on.

| Evidence | What runs | Where |
| --- | --- | --- |
| Source and package checks | Unit tests; the package scripts' tests; the installer's APT and DNF steps against stand-in package managers; the package verifiers | Hosted CI on Ubuntu 24.04, for every change. For each release, both verifiers run on the signing computer, the RPM's against the Debian package. |
| Isolated desktop sessions | The app, the GNOME companion and real apps in private Xvfb, headless Weston and nested GNOME Shell 46 sessions, with synthetic audio and no input devices | Hosted CI on Ubuntu 24.04. The companion's harness also runs GNOME 48 nested and GNOME 50 headless on a computer that has them. |
| Native installation | Installing the package with APT or DNF, then `voco --check-desktop-input`. On Fedora 44 also the speech worker and removal, with SELinux enforcing; none of these steps raises a denial. | For each release, the Debian package on the signing computer and the RPM on Fedora 44 |
| Physical audio and real sessions | The [manual acceptance](../testing/README.md#manual-acceptance) check: a physical microphone, dictation into real apps, the tray or the panel | A Linux desktop, before each release |

Isolated sessions have no input devices, so only a real computer exercises
VOCO's virtual keyboard on `/dev/uinput`. Each release's validation record,
`voco_<version>_validation.json`, lists the checks that release passed and what
they don't cover. [Testing](../testing/README.md) describes the suites.

## Requirements

| Area | Requirement |
| --- | --- |
| Processor | x86-64 with AVX2, FMA and F16C. VOCO doesn't check for them, and recognition can't run without them. |
| System | One of the [supported systems](#supported-systems). The Debian package needs `libc6 (>= 2.39)` and `libstdc++6 (>= 13.2.0)`, and the RPM `glibc >= 2.39` and `libstdc++ >= 13.2`. |
| Audio | PulseAudio, or PipeWire with its PulseAudio service. |
| Session | Wayland or X11. GNOME 50 has no X11 session, so on Ubuntu 26.04 and Fedora 44 VOCO runs on Wayland. |
| Wayland paste | Read and write access to `/dev/uinput`, which the package gives the user of the active local session. |

To check the processor, run this command. It must print all three names.

```bash
grep -o -w -E 'avx2|fma|f16c' /proc/cpuinfo | sort -u
```

Either package pulls in the clipboard, key, notification and IBus helpers VOCO
uses, and installs the udev rule that gives the active local session access to
`/dev/uinput` ([Access to /dev/uinput](#access-to-devuinput)). VOCO runs as your
login. Apart from that rule, it never changes groups or device permissions, and
it never touches a service that someone else set up.

## Session types

| | Wayland | X11 |
| --- | --- | --- |
| Microphone | Rust records through libpulse | WebKit records through an AudioWorklet |
| Clipboard | `wl-copy`, or `xclip` through XWayland on GNOME | `xclip` |
| Paste keys | VOCO's virtual keyboard, through `/dev/uinput` | `xdotool` |
| Shortcut | GNOME companion, passive evdev, IBus or `voco --toggle` | VOCO's key grab, IBus or `voco --toggle` |

## Paste helpers

VOCO copies each new phrase to the clipboard and the primary selection, then
sends Shift+Insert to the app that has keyboard focus. Each clipboard or key
helper gets 5 seconds. VOCO never restores the earlier clipboard, and a
clipboard manager may keep dictated text in its history.

On Wayland, VOCO sends the keys itself, through its
[virtual keyboard](#wayland-paste-keys). On X11, VOCO runs
`xdotool key --clearmodifiers shift+Insert`. On GNOME under Wayland with
`DISPLAY` set, the clipboard goes through `xclip` and XWayland, because GNOME
lacks the data-control protocol and `wl-copy` would need a temporary window that
takes focus.

Desktop dictation starts only when [desktop input](#check-desktop-input) is
ready. Otherwise VOCO notifies "Dictation setup incomplete" with the reason, the
tray tooltip reads "VOCO — Desktop setup needed", and nothing is recorded. The
[Chromium extension](../../integrations/chromium/README.md) needs none of this.

### Check desktop input

`voco --check-desktop-input` checks the helpers and, on Wayland, opens
`/dev/uinput` to check access. It doesn't record, copy, type or create a
keyboard, and exits 1 when something is missing. VOCO's Help page shows the same
message under **My words are not appearing**.

| Message | Meaning |
| --- | --- |
| Desktop input helpers are ready. VOCO pastes into whichever app has keyboard focus. | Everything VOCO can check is in place. |
| VOCO can't open /dev/uinput, so it can't send the paste keys. … | VOCO can't open `/dev/uinput` for reading and writing, usually because your session doesn't have [access](#access-to-devuinput) yet. |
| Pasting on … requires: … | A helper program is missing. Install its package. |
| Desktop paste is not enabled. | `VOCO_DESKTOP_PASTE=0` is set in VOCO's environment. |

### Wayland paste keys

On Wayland, VOCO presses the paste keys through its own virtual keyboard, a
device named "VOCO virtual keyboard" that it creates on `/dev/uinput`, the
kernel's interface for virtual input devices. The keyboard has three keys:
Shift, Insert and Space. VOCO creates it when it starts in a Wayland session, so
the compositor has added it long before the first paste, and keeps it until VOCO
quits; the kernel then removes it and releases any key it still held. If VOCO
can't create it at startup, it tries again before each paste. X11 sessions use
`xdotool` instead.

Each paste is Shift+Insert, led by its own Space key when the phrase continues
the previous one, sent as separate key events 12 ms apart. Passive evdev ignores
VOCO's keyboard, so its keys never count as your shortcut or a held modifier.

No daemon, service, socket or group is involved. VOCO needs only read and write
access to `/dev/uinput`, which the package gives the user of the active local
session. If `voco --check-desktop-input` says VOCO can't open `/dev/uinput`, sign
out and back in once, then check again. [Access to /dev/uinput](#access-to-devuinput)
covers the rest.

After an upgrade from a version that pasted through `voco-ydotoold.service`,
VOCO's first start in a Wayland session retires that service for your login: it
removes the service's enablement link, stops the service and reloads your user's
service manager. It acts only when the link points at
`/usr/lib/systemd/user/voco-ydotoold.service` and that file is gone.

#### Access to /dev/uinput

The package installs `/usr/lib/udev/rules.d/70-voco-uinput.rules`:

```text
KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"
```

`uaccess` gives the user of the active local session read and write access to
`/dev/uinput` through an ACL, which logind moves when another user's session
becomes active. No group is involved. Other accounts, users signed in only
remotely and system services get no access.
`/usr/lib/modules-load.d/voco-uinput.conf` loads the `uinput` module at boot.
Installing or upgrading the package also loads the module and asks udev to apply
the rule, so the active local session usually has access at once.

If VOCO still can't paste on Wayland:

1. Sign out and back in once, so that the rule applies to your new session.
2. Run `voco --check-desktop-input` and fix what it names.
3. Run `getfacl /dev/uinput`, from the `acl` package. A line
   `user:<your user name>:rw-` shows that you have access. If it's missing,
   check that you signed in at this computer, not over SSH or a remote login,
   and that no rule in `/etc/udev/rules.d/` replaces VOCO's.

An administrator who prefers another policy can replace the rule. A file with
the same name in `/etc/udev/rules.d/` takes its place, and package upgrades leave
it alone; linking that name to `/dev/null` turns the rule off. For example, to
give access only to members of a dedicated group:

```text
KERNEL=="uinput", SUBSYSTEM=="misc", GROUP="uinput", MODE="0660", OPTIONS+="static_node=uinput"
```

Create the group with `sudo groupadd --system uinput` and add each user who
dictates with `sudo usermod -aG uinput "$USER"`. Restart the computer after any
change to the rule. Unlike `uaccess`, a group gives its members access at all
times, even when they aren't signed in at the computer. Don't use the `input`
group, which lets every program you run read all keyboards, or make
`/dev/uinput` world-writable, which lets any account type into your session.

## Shortcuts by desktop

VOCO's shortcut combines Alt, Control or Super with a key, Alt+D by default.

| Desktop | How the shortcut reaches VOCO |
| --- | --- |
| GNOME 46, 48 or 50 on Wayland, [companion](../../integrations/gnome/README.md) attached | Shell grabs Alt+D or Alt+Shift+D, so the focused app never sees it. |
| Wayland with Alt+D or Alt+Shift+D, no companion | Passive evdev. The focused app also acts on the chord. |
| Wayland with any other shortcut | A desktop keybinding that runs `voco --toggle`. |
| X11 | VOCO's root-window grab, for any shortcut it accepts. It toggles on release, so the paste keys reach the app. |
| Any session, VOCO Dictation selected | The IBus engine consumes the chord in eligible fields. |

With passive evdev, browsers move the cursor to the address bar on Alt+D and
terminals delete a word. VOCO notifies "Your shortcut also reached the app" once
per launch, with the fix for your desktop.

`voco --toggle` connects once to VOCO's owner-only socket,
`$XDG_RUNTIME_DIR/voco.sock`; the connection is the request. It never launches
VOCO, doesn't report whether recording started, and exits 1 with "Could not
reach VOCO's private control socket" when VOCO isn't running. VOCO briefly holds
Shift while it pastes, so bind the key with modifiers ignored, or add a second
binding with Shift, such as F8 and Shift+F8. [Install VOCO](../install.md) lists
the settings for common desktops.

### IBus input source

While the **VOCO Dictation** input source is selected, its engine arms VOCO's
shortcut for 1 second at a time, renewed while VOCO keeps asking, in a focused
field that supports preedit, reports a known and current content type, isn't
for a password, PIN or terminal, and has no private or hidden-text hint. While
armed, it consumes the chord and tells VOCO to toggle, passive evdev ignores the
chord, and VOCO releases its X11 grab. The engine never edits text.

### Keyboard access for evdev

Passive evdev reads keyboards under `/dev/input`, which usually takes the
`input` group. That group lets every program you run read every keystroke,
passwords included, so prefer the GNOME companion, a `voco --toggle` binding or
the IBus input source. VOCO finds keyboards as they appear, through inotify or
polling, and keeps watching when none is readable at startup.

## Known limits

- Recognition is English only.
- Text reaches only apps that paste on Shift+Insert. A passing desktop input
  check can't show that an app accepts it, and VOCO can't tell whether a paste
  landed.
- On Wayland, VOCO pastes only into the active local session. A user signed in
  only remotely has no access to `/dev/uinput`.
- On GNOME, apps that inhibit system shortcuts, such as virtual machines and
  remote desktops, receive the companion's chord. In Shell menus and dialogs it
  does nothing.
- The companion supports GNOME 46, 48 and 50, and `voco --check-panel` reports
  other versions as unsupported. Elsewhere VOCO uses the tray, which on GNOME
  needs an AppIndicator extension. Debian 13 and Fedora 44 don't turn one on.
- Automated tests use synthetic audio in private X11, Wayland, GNOME and
  Chromium sessions, not physical microphones, other desktops or other apps.
  Hosted CI runs them only on Ubuntu 24.04 with GNOME 46.
- The RPM carries no OpenPGP signature of its own; the release's signed checksum
  lists authenticate it, as [Install VOCO](../install.md#fedora) shows.
