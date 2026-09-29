# VOCO GNOME panel

This GNOME Shell 46 integration keeps VOCO's microphone and active dictation capsule
inside the system panel. On GNOME Wayland it is recommended for **Alt+D** and
**Alt+Shift+D**: Shell consumes the shortcut, idle included, before the focused
application can act on it. On X11 its panel presentation is optional. During
capture and finishing a waveform opens on the microphone's left and closes again
at idle, without moving the microphone or the indicators to its right. While
VOCO's capture stream is open, GNOME also shows its privacy microphone indicator in
Quick Settings, which shifts everything on its left, VOCO included, by one icon.
Right-click the microphone for Settings and Review; Stop
dictation is available in that menu during capture. Left-clicking the microphone
also stops capture; at idle it opens Settings. Review opens only on explicit menu
selection. No recording or review window is opened automatically by the extension.

The packaged image is byte-identical to `assets/voco-symbol-ui.png`. The waveform
uses VOCO's real normalized capture level; it does not capture audio itself. GNOME
controls panel height and text styling. Width changes take 220 ms; processing uses
a subtle pulse. System reduced motion disables transitions and pulsing. When the
panel is crowded, the capsule contracts to its actionable microphone instead of
covering adjacent indicators. The microphone remains an accessible Stop control.

## Build and install

The Debian package includes this GNOME Shell 46 extension. The guided
installer calls `voco --setup-panel` for its current desktop user. A manual APT
installation can use that command or **Enable live panel** in onboarding/Help.
Package hooks do not touch user extension settings. A newly installed component
may require signing out and back in; setup reports this separately from active.
Run `voco --check-panel` for a read-only check. Setup compares the loaded companion
version with the application contract, so an upgrade cannot report stale loaded
code as current; follow its sign-out guidance. Other Shell versions use the native
tray fallback and remain unqualified for this companion.

The separately built archive remains available for development:

```bash
python3 scripts/package-gnome-panel.py /tmp/voco-panel@voco.local.shell-extension.zip
```

Disable with `gnome-extensions disable voco-panel@voco.local`. The ordinary VOCO
tray returns on detach, or within approximately six seconds after lost heartbeats.
During recording its icon shows measured-volume bars. Ready and dictating have no
text label, so the icon keeps its place; only startup and setup problems add one.
Its menu includes Settings, Review and an explicit Stop action. See
[release status](../../docs/release-candidate.md) for current downloads.

## Bridge

The application owns session-bus name `org.voco.Panel`, object `/org/voco/Panel`,
interface `org.voco.Panel1`. `Attach` accepts only the current unique owner of
`org.gnome.Shell`; subsequent calls must come from that attached connection.
`GetState` returns protocol version 1 with status, fixed descriptive text, a
renderer epoch/revision token, epoch/capture-session identity, the configured accelerator Shell may consume (and the version 10 Stop reservation token), action availability and a finite level in [0,1].
No speech, samples, target-window titles, clipboard contents or device names cross
this interface. Meter values expire after 250 ms. The renderer supplies at most
one meter update per 40 ms with at most one call in flight, only while recording.
Capture-store events drive updates without an additional hidden-window timer.

A directed `Changed` signal updates transitions immediately. The extension also
polls at 50 ms while recording, for meter levels, and at 1500 ms otherwise. Calls have a
1500 ms deadline and target the app's unique bus owner without auto-start. A
transient error hides the extension and schedules a bounded-rate reconnect.
`Action(action, token)` uses the capture identity for Stop and the presentation
revision for Open, Settings and Review. It rejects stale ownership. Menu and microphone Stop is explicit rather than toggle,
so an already-finished session cannot accidentally start another recording. Repeated
Stop requests for the same token are rejected. Existing renderer admission
remains authoritative. `Detach` restores the native tray.

On Wayland, the companion consumes Alt+D (or Alt+Shift+D when configured)
whenever it is attached, idle included, so the focused application never also
acts on it. Each press sends one `Action('shortcut', '')`, the ordinary toggle:
VOCO decides Start or Stop with its usual debounce. Holding the chord does not
repeat it. `ReserveShortcut(accelerator)` renews a 2.5 second native reservation
about once a second, with one renewal in flight. Only the authenticated Shell can
renew it, and only for the exact configured accelerator. That one reservation both
suppresses the passive duplicate and admits the Shell's shortcut action, so each
press toggles through exactly one route. A rejected renewal, a changed or
unsupported accelerator, disconnect and disable release the grab; a failed or
timed-out renewal also detaches and reconnects. Replies about an earlier grab
cannot release a newer one. Inside Shell menus and modal dialogs the chord does
nothing; applications that inhibit system shortcuts, such as virtual machines and
remote desktops, receive it instead. A version 10 companion loaded before an
upgrade keeps its Stop-only `ReserveStopShortcut` until the user signs out and back in.
The companion is recommended, not required. Without a loaded and attached
companion, dictation still works, but the focused application also receives
these GNOME Wayland shortcuts (browsers focus the address bar, terminals delete
a word), and VOCO shows that recommendation.

The shortcut toggles on press, so a paste can be ready while it is still held.
The companion exports `/org/voco/PanelInput`, interface `org.voco.PanelInput1`,
with `ModifiersClear`. Only the attached application may query this boolean;
key identities and input events never cross the bridge. Before sending
Shift+Insert, native Wayland delivery waits at most 1.5 seconds for released
modifiers, asking evdev first and then this companion. Unknown state does not block
the paste. A timeout sends no keys, and VOCO retries that text later. VOCO pastes
into whichever application has focus, never forces modifier release, and never
replays uncertain delivery.

## Verification

```bash
node --test scripts/test-panel-model.mjs
# Fresh output directory and an extracted Xvfb runtime; never the live desktop:
VOCO_NATIVE_DEPS=/path/to/extracted/usr \
VOCO_PANEL_EVIDENCE_DIR=/tmp/voco-panel-evidence \
  bash scripts/test-gnome-panel.sh
```

The native harness runs actual GNOME Shell/Mutter and the production extension in
an isolated filesystem, D-Bus, display and network namespace. Its app status service
is synthetic: it proves panel geometry, state rendering and protocol actions, not
physical microphone capture, installed-app interoperability or cursor insertion.
Set `VOCO_PANEL_APP_BINARY` to a matching debug/custom-protocol build to also
exercise the real app bridge, Shell-only attachment and fallback tray restoration.
The software-rendered harness uses GNOME’s `--force-animations` to observe
intermediate frames, then verifies the system reduced-motion setting. It slows
opening and closing eightfold and checks that the microphone and the indicators
to its right hold still in every sampled frame. Its synthetic service opens no
capture stream, so GNOME's privacy indicator is outside this check.
Rust tray tests cover authoritative state mapping; the application must separately
pass its native build, capture and release qualification before installation.
