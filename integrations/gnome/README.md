# VOCO GNOME panel

This GNOME Shell 46 integration keeps VOCO's microphone and active dictation capsule
inside the system panel. On GNOME Wayland, the current source requires it for
**Alt+D** and **Alt+Shift+D** so Shell consumes Stop before the focused application
can act on the same shortcut. On X11 its panel presentation is optional.
It expands to show only the microphone and waveform during capture and finishing,
then contracts at idle. Right-click the microphone for Settings and Review; Stop
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
During recording it replaces Ready with measured-volume bars; active states have
no text label. Stop restores Ready. Its menu includes Settings, Review and an
explicit Stop action. See
[release status](../../docs/release-candidate.md) for current downloads.

## Bridge

The application owns session-bus name `org.voco.Panel`, object `/org/voco/Panel`,
interface `org.voco.Panel1`. `Attach` accepts only the current unique owner of
`org.gnome.Shell`; subsequent calls must come from that attached connection.
`GetState` returns protocol version 1 with status, fixed descriptive text, a
renderer epoch/revision token, epoch/capture-session identity, capture/accelerator reservation identity, action availability and a finite level in [0,1].
No speech, samples, target-window titles, clipboard contents or device names cross
this interface. Meter values expire after 250 ms. The renderer supplies at most
one meter update per 40 ms with at most one call in flight, only while recording.
Capture-store events drive updates without an additional hidden-window timer.

A directed `Changed` signal updates transitions immediately. The extension also
polls at 50 ms while active and 1500 ms while idle for meter updates and leases. Calls have a
1500 ms deadline and target the app's unique bus owner without auto-start. A
transient error hides the extension and schedules a bounded-rate reconnect.
`Action(action, token)` uses the capture identity for Stop and the presentation
revision for Open, Settings and Review. It rejects stale ownership. Stop is explicit rather than toggle,
so an already-finished session cannot accidentally start another recording. Repeated
Stop requests for the same token are rejected. Existing renderer admission and
cursor-delivery guards remain authoritative. `Detach` restores the native tray.

On Wayland, the companion consumes Alt+D (or Alt+Shift+D when configured)
through Starting, Listening and Finishing. A held Stop belongs to the capture
session, so presentation updates cannot cancel it; a replacement session cannot
inherit it. Stop is sent after modifier release with the capture identity, which is revalidated at native dispatch and renderer admission.
Only the authenticated Shell can renew the short native reservation suppressing
passive duplicates. The reservation token binds the renderer epoch, capture session
and exact configured accelerator; presentation revisions cannot revoke it. A rejected latest reservation, idle, disconnect, disable and
state timeout release the grab. Each renewal has a generation: older replies
cannot release a newer reservation, including renewals of the same grab.
Without a loaded and attached companion, the current source blocks cursor
dictation with these GNOME Wayland shortcuts and explains the setup requirement.
Start also waits for the live reservation for that capture before opening the
microphone. Other desktops and shortcuts retain their existing input checks.
If a reservation is lost after capture starts and the application changes its
selection, continuation delivery is rejected rather than replacing existing
words. Recognition continues until Stop, but a handled interruption does not
retain a transcript or open Review. The user must check the original field for
missing words. This does not establish atomic ownership during a desktop paste
gesture.

Streaming pastes can overlap a held Stop before its explicit action is sent.
The companion exports `/org/voco/PanelInput`, interface `org.voco.PanelInput1`,
with `ModifiersClear`. Only the attached application may query this boolean;
key identities and input events never cross the bridge. Native GNOME Wayland
delivery waits at most 1.5 seconds for released modifiers, revalidates the original
destination, and checks modifiers again immediately before dispatch. A chord
pressed during validation requires a new wait and destination check. Unavailable
compositor state or a timeout sends no keys. VOCO never forces modifier release,
restores another application's focus, or retries uncertain delivery. This reduces
the collision window but does not make compositor key delivery atomic.

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
intermediate frames, then verifies the system reduced-motion setting.
Rust tray tests cover authoritative state mapping; the application must separately
pass its native build, capture and release qualification before installation.
