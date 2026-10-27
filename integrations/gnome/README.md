# GNOME companion

`voco-panel@voco.local` is an optional GNOME Shell extension for GNOME 46, 48
and 50, and the VOCO packages install it. While VOCO runs, the companion replaces VOCO's
tray icon with a pill in the top bar that shows a live microphone meter while
you dictate. In a Wayland session it also consumes VOCO's shortcut, so the
focused app never receives it. It keeps no recording state: VOCO decides, and
the companion shows what VOCO reports. [Platform support](../../docs/platform/README.md)
covers the other shortcut routes, and [Architecture](../../docs/architecture/README.md)
follows a recording.

## What it shows

The pill sits at the start of the top bar's right side and shows VOCO's icon.
It appears once VOCO answers, and stays hidden while VOCO isn't running. It adds
"Starting VOCO" while VOCO loads and runs its first checks, and "Check setup"
when something needs attention, such as the microphone or the paste helpers.
While you record, seven bars follow the microphone level; while VOCO processes,
they rest at about a third of their height and pulse. The pill takes a light
tint whenever VOCO isn't idle.

The meter opens to the left of the icon, so the icon never moves, and only if
the right side of the bar still fits beside the clock with room for GNOME's
microphone privacy indicator, which the companion never touches. On a crowded
panel only the icon shows. With `enable-animations` off in
`org.gnome.desktop.interface`, the meter opens without motion and the bars
don't pulse.

A primary click stops dictation while VOCO is starting or recording, and
otherwise opens Settings when VOCO allows it. Other mouse buttons, the Menu key
or Shift+F10 open the menu, where **Settings** and **Review** work only while
you aren't dictating and **Stop dictation** shows only while VOCO is starting or
recording.

## Set it up

The package installs the companion in
`/usr/share/gnome-shell/extensions/voco-panel@voco.local/`, and its scripts
never change user settings. Each user turns it on once, with `voco --setup-panel`,
which the guided installer runs, or with **Enable live panel** on VOCO's Help
page or last onboarding step. Setup turns on only this extension, asks the
running Shell first, and never restarts Shell or changes GNOME's switch that
turns off all extensions.

A Shell that started before the files arrived finds them at the next login, so
after installing, save your work and sign out and back in. After an upgrade
that changes the companion, Shell keeps the loaded copy until you do the same.
After a distribution upgrade to a newer GNOME, Shell marks the old copy out of
date; setup then turns the new one on if needed and reports `restart`.
`voco --check-panel` reports the status and changes nothing:

| Status | Meaning | Exit status |
| --- | --- | --- |
| `active` | Loaded and current. | 0 |
| `other-desktop`, `unsupported` | Not GNOME, or a GNOME other than 46, 48, 50 or 51. VOCO uses its tray. | 0 |
| `disabled`, `restart` | Off, or turned on or upgraded but not loaded yet. | 2 |
| `missing`, `blocked`, `error`, `pending`, `unavailable` | Files missing, extensions off or forbidden, a load failure, activation in progress, or no answer. The message says which. | 2 |

It exits 1 when its helper can't run. To turn the companion off, run
`gnome-extensions disable voco-panel@voco.local`; VOCO shows its tray again.

## The shortcut on Wayland

In a Wayland session the attached companion grabs VOCO's shortcut at every
status, idle included, when it is Alt+D or Alt+Shift+D. Each press, autorepeat
ignored, calls `Action('shortcut', '')`, which toggles like any other route. It
works in windows, full screen included, and the overview, but not in Shell menus
or dialogs.

VOCO accepts the grab only while the companion renews it: a `ReserveShortcut`
call every second, one at a time, holds a 2.5-second lease. While the lease is
fresh, VOCO's passive evdev listener ignores the chord and the companion's
press toggles; otherwise VOCO refuses that press and evdev decides, so each
press toggles once. When VOCO refuses a renewal, for example after you change
the shortcut, the companion releases the grab, and when a call fails, it
detaches and attaches again 2 seconds later. On X11 the companion grabs
nothing, because VOCO's own grab consumes the chord.

## D-Bus interface

VOCO owns `org.voco.Panel` on the session bus and serves `org.voco.Panel1` at
`/org/voco/Panel`.

| Member | Behaviour |
| --- | --- |
| `Attach() → b` | True only when the caller owns `org.gnome.Shell`. Hides VOCO's tray and clears any lease. |
| `GetState() → s` | The state as JSON. Each call keeps the attachment alive. |
| `ReserveShortcut(s) → b` | Holds the 2.5-second lease when the argument is the configured accelerator. |
| `ReserveStopShortcut(s) → b` | Holds a 250 ms Stop lease for a `stopSession/accelerator` token, for an earlier companion copy that Shell keeps loaded until the next login. |
| `Action(s, s) → b` | `shortcut` with an empty token, `stop` with `stopSession`, or `settings`, `open` or `review` with `token`. Each Stop token works once. |
| `Detach()` | Drops the lease and shows the tray. |
| `Changed` | Signal sent only to the attached connection when the state changes. |

Every method but `Attach` returns `org.voco.NotAttached` to anyone other than
the attached connection. VOCO also drops the lease and shows its tray when no
`GetState` arrives for more than 5 seconds, and shows its tray when it loses its
bus name.

`GetState` returns `version` (1), `status` (`initializing`, `starting`,
`recording`, `processing`, `attention` or `idle`), `description` (the tray
menu's status line), `token`, `stopSession`, `canStop`, `canOpen`, `level` (0
to 1, only while recording, 0 after 250 ms without a new level),
`shortcutAccelerator`, `stopAccelerator` and `stopShortcutToken`. The
accelerators are `<Alt>d`, `<Alt><Shift>d` or null, and null on X11. The
companion polls every 50 ms while recording, every 1.5 seconds otherwise, and
at each `Changed`.

From version 17 the companion asks VOCO for work, because a confined VOCO can
answer GNOME Shell but not call it. After `Attach` it keeps one
`NextRequest() → (s, u)` call pending, with a 30-second timeout, and calls it
again as soon as VOCO answers. VOCO answers with a kind and a request id, or
with `idle` after 20 seconds:

- `paste`: the companion types VOCO's paste keys from inside the Shell, through
  one Clutter virtual keyboard per enable, so there's no device to settle, no
  portal dialog and no screen-sharing indicator.
  - While a modifier is held it sends no key and calls
    `PasteRefused(id, "ModifiersHeld")`; while another paste is in flight,
    `PasteRefused(id, "Busy")`.
  - Otherwise it sends Shift, Insert and their releases, 12 ms apart, and then
    calls `PasteDone(id, t)` with the Insert press's monotonic time in
    microseconds. VOCO waits up to 1 second for it.
  - Disabled mid-gesture, it releases the keys it holds and calls
    `PasteRefused(id, "Disabled")`, which VOCO treats as uncertain.
  - Its metadata names no session modes, so GNOME disables it at the lock
    screen, where it can't type.
- `modifiers`: it calls `ModifiersState(id, b)`, true when the compositor
  reports no modifier held. VOCO asks before a Wayland paste when it can't read
  the keyboards, with a 150 ms limit.
- `changed`: it polls `GetState` at once.

VOCO accepts a report only from the attached Shell and only for its open
request. An earlier VOCO, which doesn't know `NextRequest`, answers it with
`UnknownMethod`, and the companion then stops asking. For it the companion still
serves `org.voco.PanelInput1.ModifiersClear() → b` at `/org/voco/PanelInput`,
for the attached VOCO only, and still polls at each `Changed`.

## Files and tests

`voco-panel@voco.local/` holds `extension.js` (pill, menu, meter, grab and bus
calls), `model.js` (state checks, shared with Node tests), `metadata.json`,
`stylesheet.css` and `voco-symbol.png`, a copy of `assets/voco-symbol-ui.png`.
In `apps/desktop/src-tauri/`, `src/panel.rs` serves the bus, `src/tray.rs` builds
the state and `src/panel_setup.rs` runs `resources/voco_gnome_panel.py`. A change
that needs Shell to load new code raises both `version` in `metadata.json` and
`COMPANION_VERSION` in `voco_gnome_panel.py`. `scripts/package-gnome-panel.py`
writes a reproducible archive of the five files, attached to each release.

- `node --test scripts/test-panel-model.mjs` checks state validation, meter
  bounds and accelerator filtering.
- `python3 scripts/test-panel-setup.py`, part of `npm test`, checks the setup
  statuses and that the two version numbers match.
- `scripts/test-gnome-panel.sh` runs the installed GNOME Shell on Wayland in
  bubblewrap, with its own D-Bus, XDG directories and display, against a
  synthetic VOCO service. GNOME 46 and 48 run nested in a private Xvfb, driven
  with `xdotool`. GNOME 50 and 51, which have no nested mode, run headless on a
  virtual monitor of the same 800×600 size, driven through Mutter's RemoteDesktop API
  and captured with GNOME's own screenshot API; its panel also shows GNOME's
  screen-sharing indicator. Its Shell runs XWayland from the start, and its
  paste checks type into a GTK 3 field in its own process
  (`scripts/fixtures/paste-field.py`), on Wayland and under XWayland:
  - every paste lands exactly;
  - each paste reports its Insert press with `PasteDone`;
  - over 200 rounds taking turns with Mutter's RemoteDesktop API, the
    companion's median from VOCO's answer to the Insert press is no more than
    1 ms above Mutter's, and its p99 no more than 2 ms above;
  - no key arrives from a paste answered with a modifier held, while another
    is in flight, in the `unlock-dialog` session mode or after disabling, and
    each refusal reports why;
  - a modifier request reports the compositor's held modifiers.

  Set `VOCO_PANEL_EVIDENCE_DIR` to a new directory
  and, for the nested mode, `VOCO_NATIVE_DEPS` to a root with `bin/Xvfb`.
  `VOCO_PANEL_APP_BINARY` adds a real `voco`, and `VOCO_PANEL_PACKAGE_ROOT`, an
  extracted package, adds setup and an upgrade; with either,
  `VOCO_PANEL_SUITE=bridge` skips the synthetic cases. CI runs it with the
  `--gnome-panel` option of `scripts/test-private-ibus-engine-hosted.sh`, which
  runs only on GitHub Actions.

## Known limits

- Only GNOME 46, 48, 50 and 51 load the companion. Elsewhere VOCO uses its tray,
  which on GNOME needs an AppIndicator extension.
- The grab covers Alt+D and Alt+Shift+D only. Apps that inhibit system
  shortcuts, such as virtual machines and remote desktops, receive the chord.
- The tests use a synthetic VOCO service in a nested or headless session, not
  other themes, other panel extensions or physical displays.
