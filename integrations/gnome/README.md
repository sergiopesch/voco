# VOCO GNOME panel

This optional GNOME Shell 46 integration keeps VOCO's microphone and active dictation capsule
inside the system panel. It expands horizontally for Starting, Listening and
Finishing, then contracts at idle. Review remains visible for unresolved recovery.
The microphone and Stop button issue an explicit Stop during capture. At idle the
microphone opens settings; Review opens the existing recovery interface on request.
No recording window is opened by the extension.

The packaged image is byte-identical to `assets/voco-symbol-ui.png`. The waveform
uses VOCO's real normalized capture level; it does not capture audio itself. GNOME
controls panel height and text styling. Width changes take 220 ms; processing uses
a subtle pulse. System reduced motion disables transitions and pulsing. When the
panel is crowded, the capsule contracts to its actionable microphone instead of
covering adjacent indicators. The microphone remains an accessible Stop control.

## Build and install

The .50 Debian candidate includes this GNOME Shell 46 extension. The guided
installer calls `voco --setup-panel` for its current desktop user. A manual APT
installation can use that command or **Enable live panel** in onboarding/Help.
Package hooks do not touch user extension settings. A newly installed component
may require signing out and back in; setup reports this separately from active.
Run `voco --check-panel` for a read-only check. Other Shell versions use the native
tray fallback and remain unqualified for this companion.

The separately built archive remains available for development:

```bash
python3 scripts/package-gnome-panel.py /tmp/voco-panel@voco.local.shell-extension.zip
```

Disable with `gnome-extensions disable voco-panel@voco.local`. The ordinary VOCO
tray returns on detach, or within approximately six seconds after lost heartbeats.
Its label reports Starting, Listening or Finishing where the desktop supports
labels, and its menu always shows status. The .47 published release supplies the
companion separately; source .50 is not a published release.

## Bridge

The application owns session-bus name `org.voco.Panel`, object `/org/voco/Panel`,
interface `org.voco.Panel1`. `Attach` accepts only the current unique owner of
`org.gnome.Shell`; subsequent calls must come from that attached connection.
`GetState` returns protocol version 1 with status, fixed descriptive text, a
renderer epoch/revision token, action availability and a finite level in [0,1].
No speech, samples, target-window titles, clipboard contents or device names cross
this interface. Meter values expire after 500 ms. The renderer supplies at most
one meter update per 100 ms with at most one call in flight, only while recording.
Capture-store events drive updates without an additional hidden-window timer.

A directed `Changed` signal updates transitions immediately. The extension also
polls at 100 ms while active and 1500 ms while idle for meter updates and leases. Calls have a
1500 ms deadline and target the app's unique bus owner without auto-start. A
transient error hides the extension and schedules a bounded-rate reconnect.
`Action(action, token)` rejects stale tokens. Stop is explicit rather than toggle,
so an already-finished session cannot accidentally start another recording. Repeated
Stop requests for the same token are rejected. Existing renderer admission and
cursor-delivery guards remain authoritative. `Detach` restores the native tray.

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
