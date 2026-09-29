# VOCO inline tray expansion

This correction supersedes the floating tray presentation in the first brand
motion pass. The GNOME 46 implementation is in `integrations/gnome/`; the existing React
popover remains the non-GNOME fallback.
It is not the GNOME recording indicator.

## Layout and identity

The idle indicator uses VOCO's existing silver microphone asset. The active
indicator expands horizontally inside the desktop panel, keeping the panel's
allocated height. It must not open a floating recording surface above or below
the panel, overlap other indicators, or reserve space outside the panel.

The expanded arrangement is a compact meter on the microphone's left. GNOME
anchors the panel's right side at the screen edge and grows it leftward, so the
meter opens and closes there while the microphone, and every indicator to its
right, holds still in every frame. GNOME's privacy microphone indicator is outside
VOCO's control: it appears in Quick Settings while the capture stream exists and
moves the indicators on its left, VOCO included. The waveform uses real audio level data.
Starting and processing show their actual state. Returning to ready collapses to
the icon. The microphone and its menu keep Stop; Settings and Review remain
explicitly opened application views rather than content squeezed into the panel.
Preserve existing start/stop safety gates.

Use existing VOCO artwork and icons. The panel controls typography, height and
contrast; VOCO motion must respect system reduced-motion preferences. Expansion
must participate in panel layout rather than painting over neighbouring items.
If available width is insufficient, retain the icon and essential state without
overflow. Do not simulate a waveform with random or timed bars.

## Implementation decision

Inspection on Ubuntu GNOME Wayland found the enabled Ubuntu AppIndicators
extension supports an adjacent label. VOCO's current Tauri tray implementation
can supply it through `TrayIcon::set_title`, backed by AppIndicator `set_label`.
This provides native horizontal icon-and-text allocation without a new dependency.
It does not provide React children, inline buttons, or VOCO control over width
interpolation. Other tray hosts may omit the title entirely. Since .51 the native
icon slot shows a measured waveform while recording. It selects from 64 immutable
images, with bounded updates and a short envelope instead of allocating images
continuously. Ready and dictating carry no title, so toggling never resizes the
slot; only startup and setup problems add a short label. Accessible status and
Stop stay available in the menu. This also covers a companion awaiting login.

The full animated capsule requires a panel integration, such as a GNOME Shell
extension. That introduces a separately supported desktop component and an IPC
boundary. The user approved this integration; the initial development target is GNOME 46. Do not silently replace the user's extension or
install a development extension in the live desktop session.

References: [GNOME panel extension example](https://gjs.guide/extensions/development/creating.html)
and the locally installed Ubuntu AppIndicators `indicatorStatusIcon.js` label
implementation. The existing floating React fixture proves neither panel geometry
nor native integration.

## Acceptance checks

- On the supported desktop, compare panel/indicator bounds at idle, starting,
  listening, processing and recovery; the indicator stays within panel bounds.
- Inspect intermediate expansion frames and crowded/multiple-monitor panels.
- Record the microphone and every indicator to its right at each state and across
  slowed opening and closing frames; none may move by half a pixel or more.
- Confirm the original microphone artwork remains stable and other indicators
  remain accessible.
- Verify Stop, shortcut, settings and recovery use existing guarded operations;
  expansion must not acquire focus or change the dictation destination.
- Verify reduced motion, contrast, extension disable/re-enable if applicable,
  application exit and loss of the app connection.
- Use isolated desktop and synthetic audio fixtures before any installed or
  physical-microphone qualification claims.
