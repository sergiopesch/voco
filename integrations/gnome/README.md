# VOCO GNOME panel

This development integration keeps VOCO's microphone and active dictation capsule
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

The current development target is **GNOME Shell 46**. Other Shell versions are not
advertised as supported. Use a matching app built from this branch: released VOCO
versions do not expose this protocol and the extension will stay hidden with them.

```bash
python3 scripts/package-gnome-panel.py /tmp/voco-panel@voco.local.shell-extension.zip
# Install only in the intended desktop/profile:
gnome-extensions install /tmp/voco-panel@voco.local.shell-extension.zip
# A newly installed extension may require logging out and back in on Wayland.
gnome-extensions enable voco-panel@voco.local
```

Disable with `gnome-extensions disable voco-panel@voco.local`. The ordinary VOCO
tray returns on detach, or within approximately six seconds after lost heartbeats.
The archive builder does not install, enable, replace other extensions or alter the
running application. The .47 release cut includes this archive as an optional GNOME 46 companion.
It is never enabled automatically. Other Shell versions remain unqualified.

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
