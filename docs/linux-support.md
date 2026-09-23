# Linux packages and qualification

**2026.0.59** is the current Ubuntu/Debian release. Its
[release notes](releases/2026.0.59.md) and
[qualification record](testing/stop-reservation-release-2026-09-23.md) cover GNOME
Stop reservations, installer cleanup, native Brave/Ghostty, five-minute browser
speech, onboarding, recovery and exact-package installation/removal. The pinned
recognizer and input permissions are retained.
The .43 desktop results below remain historical evidence; other native package
channels stay at .43.

The [historical 22 September candidate delivery matrix](testing/application-delivery-2026-09-22.md) covers:
Brave and Chromium address bars/editors, Firefox, VS Code, GTK/WebKit controls,
GNOME Text Editor, Bash and nano. It separates exact-field confirmation from
terminal dispatch and records toolkit limitations. It does not certify all Linux apps.
Stop dictation before switching fields. Destination checks run before keyboard
insertion, but a focus change during a key gesture can still redirect a fragment;
recovery cannot retract text from another application.

This matrix records **2026.0.43** package and desktop qualification. Only assets
attached to a published [GitHub release](https://github.com/sergiopesch/voco/releases)
are public downloads; source metadata and local receipts do not establish availability.
The earlier .42 release supplied a Debian amd64 package.

VOCO shares its recognition model and application source across distributions.
Native packages provide the dependencies and desktop integration appropriate to
that system. A different package format alone does not improve recognition speed.
Hardware tuning needs matched accuracy and latency measurements.

| Target | Package | Engine qualification; refreshed-build scope below |
| --- | --- | --- |
| Ubuntu 24.04 | Debian `.deb` | Public .42 upgrade, GNOME Wayland/X11 repeated dictation, X11 long dictation, focus departure and explicit recovery |
| Ubuntu 26.04, Debian 13, Mint 22.3 | Same Debian `.deb` | Container install/upgrade/reinstall/remove and complete payload checks; no default-desktop claim |
| Fedora 44 | Fedora `.rpm` | Native installation and GNOME Wayland repeated/long dictation, focus departure and source-loss recovery |
| openSUSE Tumbleweed | Separate openSUSE `.rpm` | Native installation with companion tokenizer; KDE Wayland, Firefox, Kate and Konsole |
| Arch / Omarchy 4.0.4 | Pacman package | Native installation with companion tokenizer; packaged Omarchy Hyprland/Quickshell desktop, repeated and long dictation, focus departure and source-loss recovery |

The [20 September refresh](testing/linux-release-2026-09-20.md) changes Updates
help copy and bundled documentation. All seven package lifecycles and four desktop
scenarios were repeated. Long/recovery results below retain the preceding engine
build identity; they are not exact-byte measurements of the refreshed application.

These are bounded test results, not certification of every desktop in each family.
Fedora KDE, openSUSE GNOME and other Arch desktops were not independently qualified.
Publisher signatures and public-download verification are separate release gates. Older distribution releases,
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

The final .43 Arch candidate was tested with Omarchy 4.0.4's packaged
Hyprland/Quickshell configuration in a booted guest. Repeated sessions delivered
28/28 normalized words. A 577.68-second public repetition delivered 1,162/1,162
normalized words and reached idle 922 ms after Stop. All 25,505,676 retained native
frames matched the renderer; independent waveform alignment covered every quarter.
Focus departure left the other field empty; source removal retained audio for
explicit Retry/Copy without automatic replay. These are individual observations,
not latency percentiles or a hardware ranking.

The guest uses packaged desktop defaults with a supplied kernel and direct boot.
It does not qualify the Omarchy ISO installer or bootloader. All desktop speech
trials use virtual audio. Physical microphones, suspend/resume and arbitrary
applications need separate evidence. See [native installation](install-native.md)
for the appropriate package and explicit desktop setup.

See [the dated experiment report](testing/linux-release-2026-09-19.md),
[packaging](linux-packaging.md), and [the evaluation protocol](testing/typesafe-evaluation.md).
