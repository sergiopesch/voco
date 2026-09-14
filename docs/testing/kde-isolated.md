# Private KDE compositor qualification

The iteration 5 harness runs actual KWin 5.27.11 and Plasma using locally extracted
Ubuntu runtime packages, nested on a private 1280×900 Xvfb seat. Its home, runtime,
configuration, session/system buses and mount/network/PID/IPC namespaces are
separate. `/dev/input`, `/dev/snd` and the host desktop buses are absent. No package
was installed into the active host. This proves an isolated virtual KDE session;
it does not qualify an installed SDDM login, hardware GPU or physical microphone.

The package manifest freezes 247 public Ubuntu runtime archives plus
`plasma-desktop` and `plasma-desktop-data`. Each downloaded archive was checksum
verified before extraction. The initial plan selected unavailable ESM archives;
that failed attempt remains recorded, followed by a separate public-archive plan.
No credentials were read or changed. Dependency plans, checksums and logs are in
`foundations-evidence/iteration-5/platform/kde-public-*` and `kde-shell-*` beside
the checkout. Runtime files were extracted under `/tmp/voco-kde-deps/root`.

```bash
VOCO_NATIVE_DEPS=/absolute/path/to/extracted-xvfb/usr \
VOCO_KDE_DEPS=/absolute/path/to/extracted-kde/usr \
VOCO_KDE_EVIDENCE_DIR=/absolute/path/to/fresh-evidence \
VOCO_KDE_APP_BINARY=/absolute/path/to/extracted/usr/bin/voco \
VOCO_KDE_MODEL=/absolute/path/to/existing/ggml-base.en.bin \
  env -u PYTHONOPTIMIZE bash scripts/test-native-kde.sh
```

For the complete synthetic journey, also set `VOCO_KDE_CAPTURE=1`,
`VOCO_WAYLAND_SURFACE_JOURNEY=1`, `VOCO_WAYLAND_DISMISS_TARGET=1` and
`VOCO_DEBUG_CAPTURE_AUDIO=1`. The harness requires PulseAudio tools and
`wl-copy`/`wl-paste`; only the checked-in public GO WAV is played into its private
virtual source. It uses the app's private control socket to start/stop recording,
so it does not qualify a hardware/global recording shortcut.

The watcher is the real kded `statusnotifierwatcher` module. The harness observes
its D-Bus interface, explicitly loads that actual module in the private session,
and verifies its unique bus owner, PID, UID, executable bytes and private PID
namespace. KDED starts through explicit D-Bus activation; a separate direct launch
can race automatic activation and produce a second legitimate process with a
different PID. The watcher must belong to that verified KDED owner, and both
identities must remain stable across validation. Pure ownership rejection tests
run in `npm test`. Application tray registration is bound to each app
process. Open/Quit invoke the registered DBusMenu Event method, not a simulated
watcher or a pointer click on the tray. The package's D-Bus service definitions
are copied into the private data directory with executable paths redirected to
extracted runtime files.

A test-only read-only KWin script observes the app PID, native `internalId`,
frame geometry and active/minimized state. It uses the versioned KWin 5.27.11
source API (`src/window.h` and `src/scripting/workspace_wrapper.h`, preserved in
the evidence directory), and the live introspected scripting interface. Each
query script is loaded/run/unloaded through the private bus. The private Xvfb
parent is independently required to be at `(0,0)` with size 1280×900. Painted
controls require matching current native geometry and accessibility observations;
Copy and Settings must be wholly inside the frame and have rendered text before
their actual accessibility action. This instrumentation is not a production
integration or a general Wayland geometry API.

`platform/final-kde-capture` passed on packaged executable SHA
`0783700482cdfee9808efbce80c4c8ce8ccdba4608be200411a14ed7c0b2e631` and pinned model
SHA `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`:

- GTK3/WebKit2 and GTK4/WebKit6 mapped actual native Wayland surfaces.
- Two model-cache-ready Open/Quit cycles passed.
- Real WebKit capture, native transcription and two painted explicit Copy actions
  returned “Go! Do you hear?” to independently checked private clipboards.
- The target stayed unchanged, Settings navigation passed, recording-time Open
  was refused, and real focus loss dismissed the panel before successful reopen.
- Whole-fixture PCM correlation was 0.9981876593; all scored speech quarters
  exceeded 0.9972. Synthetic WAVs, traces and actual pre-action images are retained.

The raw lifecycle rows still contain the earlier unconditional
`inferenceRequested:false` label; it refers incorrectly to the complete first
cycle. The nested capture report proves first-cycle inference. Likewise, raw
ghost paint threshold labels describe Copy thresholds even though the recorded
Settings predicate uses a dark button with light inner glyphs. These metadata-only
labels were corrected afterward; invocation source snapshots and original
results remain immutable. Neither correction changes the acceptance predicates.

Earlier `kde-initial`/`kde-plasma` failures retain missing desktop-data and watcher
startup diagnoses. Final logs still show unavailable private system/portal
services. Lock/unlock, suspend, device reconnection, portal permission UX, pointer
tray activation, installed package upgrades and physical audio remain untested.
See [GNOME qualification](gnome-isolated.md), the [Linux matrix](linux-e2e.md), and
[physical microphone protocol](physical-microphone-qualification.md).

The [iteration 13 evidence index](foundations-iteration-13-2026-09-06.md) records
the current application package's separate failed startup and corrected recovery.
The historical package results above remain unchanged.
