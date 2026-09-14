# Private native Wayland compatibility smoke

`scripts/test-native-wayland.sh` adds a bounded native Wayland check alongside
[the X11 acceptance harness](native-isolated.md). It starts Weston headless with
Pixman in private mount/network/PID/IPC namespaces and a private session D-Bus.
`DISPLAY` is unset; host input, sound devices, X11 sockets, runtime sockets and
system D-Bus are hidden. It does not attach to the current desktop or record audio.

The fixture maps actual GTK 3/WebKit2 4.1 and GTK 4/WebKit 6.0 surfaces, checks their
Wayland GDK types and document-load completion, then destroys them. An optional
copied VOCO executable is launched twice. Each cycle registers with a private
StatusNotifierWatcher, exposes its real tray menu, accepts Open VOCO, exposes a visible AT-SPI frame owned by that process, and exits
successfully through Quit VOCO. The next launch handles runtime state left by the
previous application; the fixture does not delete application sockets between
cycles. AT-SPI observes the visible window after Open; pixel appearance and accessibility of
individual controls remain outside this check. Neither recognition nor automatic
target delivery is requested.

`VOCO_WAYLAND_MODEL` optionally copies/reflinks the existing pinned base.en model
into the private cache with directory mode 755 and file mode 644. The harness
checks SHA-256 before launching, then requires the application's actual
`Cached speech model verified:` log in both cycles. This is verified cache readiness;
the decoder is loaded lazily by transcription commands, so `decoderLoaded` remains
false. Without a model, an attempted initial download fails in the network namespace
and remains in the log; startup survival alone is not model readiness.

Weston and wayland-utils may be extracted without installing system packages:

```bash
mkdir -p /tmp/voco-wayland-deps
cd /tmp/voco-wayland-deps
apt-get download weston libweston-13-0 wayland-utils
for package in *.deb; do dpkg-deb -x "$package" root; done
```

From the repository, with Bubblewrap and the GTK/WebKit/Atspi GI packages installed:

```bash
VOCO_WAYLAND_DEPS=/tmp/voco-wayland-deps/root/usr \
VOCO_WAYLAND_EVIDENCE_DIR=/absolute/path/to/evidence \
VOCO_WAYLAND_APP_BINARY=/absolute/path/to/extracted/usr/bin/voco \
VOCO_WAYLAND_MODEL=/absolute/path/to/existing/ggml-base.en.bin \
  scripts/test-native-wayland.sh
```

The extracted Weston 13 dependency layout is explicit. Missing dependencies or
failed isolation fail the run; there is no active-desktop fallback. `execution.json`
records exit status, current artifact hashes and fixture source hashes. Only files
listed by the current manifest constitute evidence if an output folder is reused.
`results.json` records toolkit versions, app SHA-256 and measured boundaries.

CI installs the Ubuntu 24.04 Weston/toolkit packages and runs the toolkit checks
with `VOCO_WAYLAND_DEPS=/usr`. Release validation supplies the extracted package's
executable and hash-pinned model as well, requiring both application Open/Quit
cycles and verified-cache readiness. These jobs use the existing ephemeral-runner
wrapper's `--native-wayland` selection; it refuses local invocation. Run the direct
script above on development machines. Evidence is retained even when a job fails.

On 5 September 2026, Ubuntu 24.04 with Weston 13.0.0 and WebKitGTK 2.52.6 passed both
GTK generations and two tray Open/Quit cycles. The tested GUI was the iteration 3
package executable, SHA-256
`7cbd6532a7203774705afad4c59312190a5ee9918cc1cd9ba3fc1e0bfec850a8`.
Evidence is in the adjacent `foundations-evidence/iteration-4/platform/wayland-final`
directory (the initial smoke). The enhanced `wayland-model` report proves both
verified-cache events and visible VOCO frames with the same executable. The model
SHA-256 is `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`.
Negative checks in `wayland-negative-app` and `wayland-negative-model` require an
immediately exiting executable and an incorrect model to fail. This is compatibility evidence for that executable, not a qualification
of subsequent recognition changes. Crabbox doctor still reported missing
`HCLOUD_TOKEN`/`HETZNER_TOKEN`; this is local namespace coverage, not a remote VM.

## Remaining qualification

### Optional private nested seat and capture acceptance

The default remains true headless Weston. A fresh toolkit-only check found no
`wl_seat`; GTK still creates a clipboard object, but `wl-copy` exits with a missing
seat error. Object availability therefore does not establish clipboard ownership.
The harness now records these separate observations.

`VOCO_WAYLAND_BACKEND=nested-x11` starts a private Xvfb server solely as Weston's
input/output backend. VOCO and both GTK fixtures keep `DISPLAY` unset and use
native Wayland surfaces. This supplies a compositor-owned virtual seat without
exposing host input devices. Existing extracted Weston/Xvfb dependencies suffice;
no host service or display is used. The toolkit-only `wayland-nested-seat` evidence
passed native GTK 3/4 Wayland mapping and a cross-process `wl-copy`/`wl-paste`
round trip. This is nested Wayland protocol evidence, not GNOME/KDE or hardware
compositor qualification.

The optional capture-to-Copy extension has passed on the extracted iteration 4
package. To reproduce it in a fresh evidence directory:

```bash
VOCO_WAYLAND_BACKEND=nested-x11 \
VOCO_NATIVE_DEPS=/absolute/path/to/extracted-xvfb/usr \
VOCO_WAYLAND_DEPS=/absolute/path/to/extracted-weston/usr \
VOCO_WAYLAND_EVIDENCE_DIR=/absolute/path/to/new-evidence \
VOCO_WAYLAND_APP_BINARY=/absolute/path/to/extracted/usr/bin/voco \
VOCO_WAYLAND_MODEL=/absolute/path/to/existing/ggml-base.en.bin \
VOCO_WAYLAND_CAPTURE=1 env -u PYTHONOPTIMIZE bash scripts/test-native-wayland.sh
```

It requires existing `pulseaudio`, `pactl`, `paplay`, `wl-copy` and `wl-paste`.
The private audio server loads only a null sink and its synthetic monitor source;
`/dev/snd` remains absent. It requests recording through the app's existing private
Unix control socket, plays the checked-in hash-verified GO fixture, requires real
capture and recognition completion traces, opens the real manual result, invokes
the accessible Copy control, and checks the text through a separate Wayland
clipboard client. A real private GTK target must remain unchanged throughout.
This exercises socket-triggered recording, not a global keyboard shortcut.
Requested capture cannot pass merely on startup or toolkit success.

The extracted package executable SHA-256
`52f78c8f17a2a15ba31653750af2b967cbaa7694f3ee150c295a538fbe68b7ca`
passed real WebKit capture, native recognition and explicit Copy with the public
phrase “Go! Do you hear?”. The private GTK target remained unchanged. Evidence is
in `foundations-evidence/iteration-4/platform/remap-wayland-capture` beside the
checkout. Both headless and nested startup checks also passed two Open/Quit cycles
and verified model-cache readiness for this exact executable.

The stronger [surface acceptance journey](wayland-surface-acceptance.md) passed in
`iteration-4/platform/remap-wayland-painted-journey`: idle remap, Hide to tray,
recording, refusal to open during recording, Copy, Settings, reopening, genuine
fixture focus loss and blur dismissal, then another Copy. Both Copy actions require
a fresh private clipboard sentinel, current enabled/showing accessibility state,
and actual painted controls. The bounded pixel check is specific to the configured
1280×900 Weston kiosk with an actual 420×660 VOCO frame; it does not infer a general
Wayland screen origin. Both retained pre-Copy screenshots show the panel and controls.
The captured synthetic PCM has whole-fixture correlation 0.999986 and all scored
active-quarter correlations above 0.99998. This validates transport of this fixture,
not general recognition accuracy or physical microphone quality.

Earlier clipping failures, the initial journey's incorrect shortcut sequence, and
the functional pass with a black reopened screenshot remain retained separately.
See the adjacent `iteration-4/platform/REMAP-QUALIFICATION.md` for those boundaries
and the final paint evidence. Keep `capture-copy.json`, exact artifact hashes,
traces and failed artifacts for every run. Assertions must remain enabled; the
Python harness explicitly refuses optimized mode.

Weston headless has no keyboard seat here. Keyboard/evdev warnings and unavailable
private document portal/PipeWire services are retained in logs. Those limitations
prevent this run from qualifying global shortcuts, clipboard ownership, permission
portals, physical keyboard/microphone, lock/suspend, GPU rendering, or installed
GNOME/KDE sessions. A generic mapped WebKit fixture is not VOCO delivery integration
with every GTK 4 application. Qt, LibreOffice, Electron and confined browser packages
still require their own application-level cases.

Physical microphone evidence must use a deliberately selected device and consented
speaker on a disposable or explicitly authorized desktop, with device/session/model
identity recorded. It must cover first permission, device removal/reconnection,
chosen-device persistence, silence, clipping, environmental noise, and at least
one accent/speaking-rate diversity set. Preserve a reference transcript and report
word errors and capture/stop latency separately. A private PulseAudio virtual source
can check transport and deterministic input; it cannot establish acoustic quality,
hardware permission behavior, physical device stability, or representativeness.
