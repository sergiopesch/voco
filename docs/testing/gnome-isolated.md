# Private GNOME compositor qualification

This harness runs installed GNOME Shell 46/Mutter 46.2 as a real Wayland compositor
nested on a private Xvfb display. It uses private home/config/data/runtime paths,
private session and system D-Bus endpoints, and mount/network/PID/IPC namespaces.
Host input/audio devices and runtime buses are absent. This is an isolated virtual
session, not an installed Ubuntu login, physical microphone or GDM qualification.

The real Ubuntu appindicator extension supplies the StatusNotifierWatcher; the
harness verifies that its bus owner PID is the Shell PID. It never substitutes the
Weston fixture watcher. Tray actions currently use the registered application's
real DBusMenu Event method; pointer interaction with the rendered tray menu remains
a separate qualification step. Both GTK3/WebKit2 and GTK4/WebKit6 map native Wayland
surfaces. Optional VOCO lifecycle checks copy an exact executable and pinned model,
require new frontend readiness and model-cache verification, then perform two
Open/Quit cycles. Registration is bound to the current process so stale tray items
cannot qualify a restarted app.

```bash
VOCO_NATIVE_DEPS=/absolute/path/to/extracted-xvfb/usr \
VOCO_GNOME_EVIDENCE_DIR=/absolute/path/to/fresh-evidence \
VOCO_GNOME_APP_BINARY=/absolute/path/to/extracted/usr/bin/voco \
VOCO_TEST_SPEECH_RUNTIME=/absolute/path/to/extracted/usr/lib/voco/speech \
  env -u PYTHONOPTIMIZE bash scripts/test-native-gnome.sh
```

The optional current capture journey uses `VOCO_GNOME_ONBOARDING=1` with
`VOCO_DEV_NATIVE_CAPTURE=1`, `VOCO_DEBUG_CAPTURE_AUDIO=1`, and
`VOCO_DEBUG_NATIVE_CAPTURE=1`. It starts from an incomplete disposable profile,
activates the actual app-owned Start test and Finish test controls, and checks the
public GO WAV through the native Pulse capture backend and pinned recognizer.
The fixture requires focused native window ownership and contained accessible
controls; screenshots retain their presentation. Actions use AT-SPI, not pointer
injection. It verifies one ordered recording/Stop/teardown/idle session, an
independent Pulse capture client that stops, unchanged private clipboard, exact
local transcript, complete native and renderer audit receipts, and waveform
continuity. A failed audio or transcript check remains a failed qualification.

The private Pulse listener is a real same-UID socket at the native backend's
expected `/run/user/<uid>/pulse/native` inside the already isolated namespace.
The synthetic source has its own explicit stable identity. No host audio socket or
device is shared. The fixture uses a private umask so audit files pass the normal
ownership and ancestor checks; it does not relax production security checks.
Playback wraps the checked-in public WAV in a fixed 250 ms of digital silence on
each side to start the private null-sink clock. Both input hashes are retained;
continuity still scores the complete original WAV at the unchanged thresholds. Complete raw capture receipts remain in
the external evidence directory, including on a failed trial.

The test stops before Check desktop setup or Done: it does not establish physical
microphone quality, automatic cursor insertion, a global shortcut, or completion
of desktop readiness. The separate default two-cycle lifecycle run qualifies real
tray Open/Quit and fresh renderer/model readiness without capture. The XTest helper
may come from the extracted dependencies or `/usr/bin/xdotool`; its executable is
mounted read-only and input is sent only to the private Xvfb display.

`VOCO_GNOME_CAPTURE=1` was the historical manual-Copy journey and now fails early
with guidance to the onboarding variant. Current cursor-only behavior correctly
refuses to start without an authorized target, so the old journey is not current
acceptance evidence. Shared historical Weston/KDE fixtures are unchanged.

A test-only extension in `scripts/fixtures/gnome-private-probe` is copied solely into
the disposable data directory. It observes native window PID, surface generation,
frame rectangle, visibility and focus over the private session bus.

The following records describe historical manual-Copy qualification only.

Final iteration 5 evidence under
`foundations-evidence/iteration-5/platform/final-gnome-scrollto` passes the complete
synthetic capture journey and two Open/Quit cycles using packaged executable SHA
`0783700482cdfee9808efbce80c4c8ce8ccdba4608be200411a14ed7c0b2e631`.
Both explicit Copy actions returned “Go! Do you hear?” to an independently checked
private clipboard; the target remained unchanged. Painted Settings navigation,
reopen, actual native focus loss and subsequent Copy passed. Whole-fixture PCM
correlation was 0.9985547877; scored speech-quarter correlations exceeded 0.9978.
The scoped window was 420×568 on GNOME's 800×600 nested output. Screenshots
`nested-before-copy-1.png`, `nested-before-settings-0.png`, and
`nested-before-reopened-copy-0.png` retain the actual controls before action.
The lifecycle rows' historical `decoderLoaded:false` label describes the initial
cache-only check, not the subsequent capture: cycle 1 did perform inference, as
the capture trace and copied transcript establish.

Earlier failures remain intact: `gnome-capture-initial` and
`gnome-capture-scroll` used the older iteration 4 package; `final-gnome-capture`
used the final package but failed its PageDown-based Settings reveal. No app CSS
change was made. An independent WebKit fixture in `gnome-webkit-scroll-to` proved
that the supported scroll action moves the offscreen button from y832 to y214;
the corrected final journey then verified the actual app's painted control.
A separate three-cycle no-inference clipboard/Open observation settles visible and
focused each time; it does not establish all focus-race behavior.

The private system bus has no host logind, and the shell explicitly reports that
screen locking requires GDM. Missing PipeWire/system-service diagnostics remain in
logs. Lock/unlock, suspend, actual device permissions, hardware shortcuts, GNOME
session startup and installed package lifecycle remain unqualified. See the
[Linux matrix](linux-e2e.md) and [physical microphone protocol](physical-microphone-qualification.md).
