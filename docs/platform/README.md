# Platform support

VOCO runs on x86-64 Linux desktops, in Wayland and X11 sessions. This page
covers what the computer needs, how VOCO pastes and receives its shortcut, and
how to set up the Wayland input service. [Install VOCO](../install.md) covers
installation, and [Architecture](../architecture/README.md) follows a recording.

## Requirements

| Area | Requirement |
| --- | --- |
| Processor | x86-64 with AVX2, FMA and F16C. VOCO doesn't check for them, and recognition can't run without them. |
| System | Ubuntu 24.04 or later, or another Debian-based system with glibc 2.39 or later. The package needs `libc6 (>= 2.39)` and `libstdc++6 (>= 13.2.0)`. |
| Audio | PulseAudio, or PipeWire with its PulseAudio service. |
| Session | Wayland or X11. The reference desktop is Ubuntu 24.04 with GNOME 46. |
| Wayland paste | `ydotool`, a running `ydotoold`, and write access to `/dev/uinput` for your login. |

To check the processor, run this command. It must print all three names.

```bash
grep -o -w -E 'avx2|fma|f16c' /proc/cpuinfo | sort -u
```

The package pulls in the clipboard, key, notification and IBus helpers VOCO
uses. It recommends `ydotool` and `ydotoold`, which the guided installer adds on
Wayland. VOCO runs as your login and never changes groups, device permissions,
or a service that someone else set up.

## Session types

| | Wayland | X11 |
| --- | --- | --- |
| Microphone | Rust records through libpulse | WebKit records through an AudioWorklet |
| Clipboard | `wl-copy`, or `xclip` through XWayland on GNOME | `xclip` |
| Paste keys | `ydotool`, through `ydotoold` | `xdotool` |
| Shortcut | GNOME companion, passive evdev, IBus or `voco --toggle` | VOCO's key grab, IBus or `voco --toggle` |

## Paste helpers

VOCO copies each new phrase to the clipboard and the primary selection, then
sends Shift+Insert to the app that has keyboard focus. Each clipboard or key
helper gets 5 seconds. VOCO never restores the earlier clipboard, and a
clipboard manager may keep dictated text in its history.

Only `/usr/bin/ydotool` counts, and `ydotoold` counts only while
`pgrep -x ydotoold` finds it. VOCO runs `ydotool key --help`, with a 2-second
limit, to learn the key syntax: Ubuntu 24.04's client takes key names
(`shift+insert`), newer clients take key codes (`42:1 110:1 110:0 42:0`), and
VOCO refuses any other client. On X11, VOCO runs
`xdotool key --clearmodifiers shift+Insert`. On GNOME under Wayland with
`DISPLAY` set, the clipboard goes through `xclip` and XWayland, because GNOME
lacks the data-control protocol and `wl-copy` would need a temporary window that
takes focus.

Desktop dictation starts only when the helpers are ready. Otherwise VOCO
notifies "Dictation setup incomplete" with the reason, the tray tooltip reads
"VOCO — Desktop setup needed", and nothing is recorded. The
[Chromium extension](../../integrations/chromium/README.md) needs none of them.

### Check the helpers

`voco --check-desktop-input` checks the helpers without recording, copying or
typing, and exits 1 when something is missing. VOCO's Help page shows the same
message under **My words are not appearing**.

| Message | Meaning |
| --- | --- |
| Desktop input helpers are ready. VOCO pastes into whichever app has keyboard focus. | Every helper VOCO can check is in place. |
| Pasting on Wayland requires: ydotoold. Start VOCO's input service with … | No `ydotoold` runs. Set up the [input service](#ydotoold-ydotool-daemon). |
| Pasting on … requires: … | A helper program is missing. Install its package. |
| The desktop paste helper cannot reach its input service. … | A `ydotoold` runs, but `ydotool` can't use its socket, for example because another login owns it. |
| The desktop paste helper could not connect to its input service. | `ydotool key --help` failed. |
| The desktop paste helper did not answer its compatibility check. | `ydotool` didn't answer within 2 seconds. |
| The installed ydotool key interface is unsupported; … | The client's help text matches neither known syntax. |
| Desktop paste is not enabled. | `VOCO_DESKTOP_PASTE=0` is set in VOCO's environment. |

### ydotoold (ydotool daemon)

On Wayland, `ydotool` sends keys through `ydotoold`, a daemon that holds one
virtual keyboard open on `/dev/uinput`, and VOCO pastes only while a `ydotoold`
runs for your login. X11 needs neither. The package installs the user service
`/usr/lib/systemd/user/voco-ydotoold.service`, which installing doesn't start.
It runs as you with your graphical session, only when `/dev/uinput` exists, and
restarts 3 seconds after a failure, with `UMask=0077`, `NoNewPrivileges=yes` and
`RestrictAddressFamilies=AF_UNIX`. It runs `/usr/libexec/voco/ydotool-launcher`,
which picks the daemon:

- If `/usr/bin/ydotool` is Ubuntu 24.04's `ydotool` 0.1.8-3build1 for amd64,
  checked by SHA-256 and with `dpkg-query`, it runs VOCO's private build of
  `ydotoold` 0.1.8 from `/usr/libexec/voco/ydotool-legacy/`, after checking the
  binary against its build manifest. That build closes finished connections and
  retries interrupted calls ([source and patches](../../vendor/ydotool-legacy/README.md)).
  It listens on `/tmp/.ydotool_socket`, mode 0600 and owned by your login, so it
  serves one login at a time.
- With any other client, it runs the system `/usr/bin/ydotoold`.

The launcher trusts only files and directories that root owns and that group
and others can't write. Never widen a daemon socket's permissions: any process
that can write to it can type into your session. To set the service up by hand,
quit VOCO, then run:

```bash
sudo apt install ydotool ydotoold
voco --setup-desktop-input
systemctl --user enable --now voco-ydotoold.service
voco --check-desktop-input
```

`voco --setup-desktop-input` points an unmodified VOCO service at the launcher,
reloads systemd's copy of the unit, and restarts the service if it runs a
different daemon, but never starts a stopped one. It acts only for the installed
`/usr/bin/voco` in a Wayland session while VOCO is closed. It changes nothing,
and says why, if the unit is overridden, has drop-ins or differs from the
packaged file, if the service runs a custom command or belongs to another login,
if another `ydotoold` runs, or if your login can't write to `/dev/uinput`.

VOCO runs the same step at each start, where a refusal only logs a warning. When
the service is changing state, a restart can't be confirmed, or the step takes
over 5 seconds, VOCO notifies "VOCO could not start" and exits.

The guided installer runs the step too and keeps any `ydotoold` that already
works. Otherwise it needs write access to `/dev/uinput`, refuses to replace a
`ydotoold` it can't reach, then starts the service and checks again. If setup
still fails, it prints the reason and a link to this section, then exits with
status 2.

#### Access to /dev/uinput

Grant your login write access to `/dev/uinput` as your system's policy allows.
Two common udev rules follow; VOCO neither installs nor tests them. Put one in
`/etc/udev/rules.d/60-voco-uinput.rules`, then restart the computer.

```text
# Option 1: the user of the active local session gets access.
KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"

# Option 2: members of a dedicated group get access.
KERNEL=="uinput", SUBSYSTEM=="misc", GROUP="uinput", MODE="0660", OPTIONS+="static_node=uinput"
```

For option 2, create the group with `sudo groupadd --system uinput` and join it
with `sudo usermod -aG uinput "$USER"` before you restart. Don't use the `input`
group, which lets every program you run read all keyboards, or make
`/dev/uinput` world-writable, which lets any account type into your session.

## Shortcuts by desktop

VOCO's shortcut combines Alt, Control or Super with a key, Alt+D by default.

| Desktop | How the shortcut reaches VOCO |
| --- | --- |
| GNOME 46 on Wayland, [companion](../../integrations/gnome/README.md) attached | Shell grabs Alt+D or Alt+Shift+D, so the focused app never sees it. |
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
- Text reaches only apps that paste on Shift+Insert. A passing helper check
  can't show that an app accepts it, and VOCO can't tell whether a paste landed.
- On GNOME, apps that inhibit system shortcuts, such as virtual machines and
  remote desktops, receive the companion's chord. In Shell menus and dialogs it
  does nothing.
- The companion supports GNOME 46 only. Elsewhere VOCO uses the tray, which on
  GNOME needs an AppIndicator extension.
- Automated tests use synthetic audio in private X11, Wayland, GNOME and
  Chromium sessions, not physical microphones, other desktops or other apps.
