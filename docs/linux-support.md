# Linux packages and qualification

The public release is **2026.0.42**, distributed as a Debian amd64 package.
**2026.0.43 is development work, not a public or recommended replacement yet.**

VOCO shares its recognition model and application source across distributions.
Native packages provide the dependencies and desktop integration appropriate to
that system. A different package format alone does not improve recognition speed.
Hardware tuning needs matched accuracy and latency measurements.

| Target | Package plan | Remaining qualification |
| --- | --- | --- |
| Ubuntu 24.04+, Debian 13, Mint 22.3 | Debian `.deb` | Exact .43 artifact, installed GNOME/X11 sessions and upgrades |
| Fedora 44 | Fedora `.rpm` | Exact .43 artifact and installed GNOME/KDE sessions |
| openSUSE Tumbleweed | Separate openSUSE `.rpm` | Exact .43 artifact, companion tokenizer package and installed KDE/GNOME sessions |
| Arch Linux | Pacman package | Exact .43 artifact and maintained tokenizer dependency |
| Omarchy | Arch package with Hyprland setup | Exact .43 artifact, default Omarchy session and application matrix |

This is the intended scope, not a certification list. Older distribution releases,
other CPU architectures, AppImage, Flatpak and Snap have no new support claim.
The current prebuilt payload requires glibc 2.39+, compatible libstdc++ and
AVX2/FMA/F16C. Do not remove those floors to make an installer accept an older OS.

## What each package must prove

1. Install through the native package manager with satisfiable dependencies.
2. Preserve the exact application, runtime and model identity, including executable
   permissions, loader links and bundled licenses. RPM license files survive a
   `nodocs` install; full payload checks run with documentation enabled.
3. Preserve microphone/shortcut preferences across upgrades and remove only
   package-owned files on uninstall.
4. Finish fresh-user setup and deliver public fixture audio into an independently
   observed field. Check Start, Stop, repeated sessions, focus changes and recovery.
5. Exercise the intended compositor and representative browsers, editors and
   terminals in a booted guest. Containers establish package/userspace evidence.
6. Pass long recordings, device interruptions and release regressions before
   signing the exact assets. Physical microphones and suspend/resume need their
   own evidence; a virtual source cannot establish them.

## Hyprland shortcut integration in the .43 candidate

`voco --toggle` queues one Start/Stop request to VOCO already running in the same
user's desktop session. It does not launch the app, change focus, alter keybindings,
confirm recording state or require keyboard-device access. A missing/unsafe/busy
socket fails without retries. Use the same `XDG_RUNTIME_DIR` as the running app.

For the Hyprland 0.56 Lua configuration tested in the development VM:

```lua
hl.bind("F8", hl.dsp.exec_cmd("voco --toggle"), { ignore_mods = true })
```

Use an unused key such as F8. The [modifier-independent flag](https://wiki.hypr.land/configuring/core/binds/flags/)
keeps the command available while clipboard delivery briefly holds Ctrl or Shift.
It was tested with both plain F8 and Ctrl+F8 on Omarchy. Do not hold Alt or Meta
while stopping: those keys can affect the final paste or activate application menus.
Test Start and Stop in the receiving application.

On KDE, assign the same command to an unused key and its Ctrl and Ctrl+Shift
variants in System Settings → Keyboard → Shortcuts. The isolated test used F7,
Ctrl+F7 and Ctrl+Shift+F7 after checking all three for conflicts. A plain-key-only
binding missed a deliberately modified Stop; the three bindings passed that
control. Choose available keys rather than replacing an existing desktop action.

Use the syntax of your installed Hyprland release. Keep the binding non-repeating,
check for conflicts and preserve existing Omarchy dictation bindings. The command
cannot discover which keys the compositor assigned; VOCO's configured-key
readiness describes its built-in keyboard routes. Wayland Shortcuts settings
explain the compositor command and this distinction; a desktop binding must be
tested in that desktop session.

Shortcut handling and text delivery are separate. Wayland paste still needs a
working `ydotoold` service and the clipboard helper, with narrowly scoped access.
Never grant broad keyboard-device access merely to make a compositor binding work.

## Hidden-window capture in the .43 candidate

Earlier Hyprland tests reproduced a transparent tile when VOCO moved its WebKit
window off screen. Unmapping that window removed the tile but blocked a fresh
WebKit microphone request. The .43 candidate now selects the native audio backend
on Wayland and actually hides its window. X11 retains WebKit capture.

In Microphone settings, select a source, allow direct access for this app session,
and choose **Use this microphone**. This does not start recording. The current
system default resolves to one specific source; later default changes do not
silently switch it. Native capture requires PipeWire's Pulse compatibility server
and its stable source identity metadata. A lost or changed source requires explicit
selection and permission again. There is no automatic browser fallback.

The installed .43 Arch candidate was tested with Omarchy 4.0.4's packaged
Hyprland/Quickshell configuration in a booted guest. Fresh hidden Start delivered
14/14 normalized words (Stop-to-idle 244 ms); repeated sessions delivered 28/28
(246 and 235 ms). A 577.68-second public repetition delivered 1,162/1,162 normalized
words and finished in 920 ms after Stop. These are individual observations, not
percentiles. All 25,508,763 captured frames matched retained renderer audio, and
full-source waveform correlation exceeded 0.9995 in each quarter. Focus departure
halted delivery; source removal retained audio for explicit Retry/Copy without
automatic replay.

This guest uses the packaged desktop defaults but a supplied kernel and direct
boot, with virtual audio and a GTK recipient. It is not clean ISO/bootloader,
physical microphone or arbitrary application certification. Debian-family upgrades
and native Fedora/openSUSE installation have separate userspace receipts; the full
installed GNOME/KDE and recipient matrix remains a release gate.

See [the dated experiment report](testing/linux-release-2026-09-19.md),
[packaging](linux-packaging.md), and [the evaluation protocol](testing/typesafe-evaluation.md).
