# Isolated native GTK and WebKit acceptance

Current acceptance: [iteration 3](foundations-iteration-3-2026-09-05.md). IBus protocol 5
requires zero target mutation in every context. Full-application cases now verify
completed manual Copy; Chromium direct delivery is exercised separately by
`test-browser-full-app.sh`. Earlier insertion reproductions below explain why the
IBus boundary was suspended and are retained as historical investigation evidence.

`scripts/test-native-desktop.sh` runs actual GTK 3 entries and WebKitGTK DOM
fields on an Xvfb server, with private IBus and session/accessibility D-Bus
instances. It exercises the checkout's Python engine and its socket protocol,
not a mock input context. It does not run the complete Tauri application,
Whisper, microphone capture, or the host desktop.

Prerequisites: Bubblewrap, Xvfb, xdotool, IBus, system Python with GTK 3,
WebKit2 4.1, IBus and Atspi GI namespaces, and the GTK IBus input module.
The shell fails if isolation or a prerequisite is unavailable; it never falls
back to the active desktop. The private mount/network/PID/IPC namespaces hide
host X11, user-runtime and system D-Bus sockets. No microphone/input device is mounted.

```bash
VOCO_NATIVE_EVIDENCE_DIR=/absolute/evidence/directory \
  scripts/test-native-desktop.sh
```

If Xvfb and xdotool are absent, development dependencies can be extracted
without installing host packages. Use a disposable directory, download Ubuntu
packages with `apt-get download xvfb xdotool libxdo3`, and extract each with
`dpkg-deb -x package.deb root`. Set `VOCO_NATIVE_DEPS` to the extracted `root/usr`.
The host's already installed libraries must satisfy the extracted executables.
This is local isolation, not Crabbox remote coverage. Crabbox doctor on
4 September 2026 failed because the configured Hetzner credentials were absent.

`VOCO_NATIVE_TRACE=1` instruments only the engine copy inside the disposable
sandbox to log focus, content-type and capability callback ordering. The report
marks instrumentation and hashes the actual engine files that ran. Acceptance
can also run without instrumentation against byte-identical source copies.

## Evidence established on 4 September 2026

Ubuntu 24.04, Xvfb 21.1.12, GTK 3.24.41, WebKitGTK 2.52.6, IBus 1.5.29-rc2:

- Real Unicode insertion into a GTK entry and 30 consecutive default `Alt+D`
  trigger/commit cycles: correct target, exact character counts, no duplicates.
- Actual XTest shortcut events traverse GTK's input method and are consumed by
  VOCO's IBus engine when armed. No host input injection occurs.
- Switching GTK fields between trigger and lease claim rejects the old token.
  Switching after lease acquisition rejects final text and clears owned preedit
  without mutating either field.
- Untyped generic and password GTK entries reject automatic ownership.
- Real WebKit textarea A/B Unicode delivery and `Alt+D`, `Alt+Shift+D`, and
  `Control+Shift+space` origin capture succeed in the corrected independent cases.
  Earlier unavailable/ineligible results were invalid: an uncanceled GTK session
  contaminated subsequent WebKit cases. The harness now cancels between cases and
  fails on unexpected rejection after an eligible trigger.
- A real WebKit lease acquired in A then committed after focus moved to B mutated B.
  The engine incorrectly acknowledged intact ownership. This is an open automatic
  delivery safety regression; native acceptance is failing until corrected. Both
  token-before-focus-switch/start and lease-before-focus-switch/commit redirect into
  B. GTK and WebKit share capabilities `41`, client string, and safe purpose/hints
  in this mixed process; those metadata cannot reliably distinguish the widgets.
- Two identical WebKit textarea metadata sets share one IBus input context;
  moving A to B emits no fresh IBus focus/content callback. An IBus context ID
  alone therefore cannot establish a DOM field identity.
- A separate AT-SPI observer sees distinct WebKit A/B accessibility object
  paths and the password role. Refocusing A preserves its path during this
  fixture's lifetime. This establishes witness availability only: asynchronous
  accessibility events do not make a later text commit atomic with a focus
  check. No AT-SPI production integration is included.

The native callback trace exposed and drove a fix for lost GTK capabilities:
IBus suppresses unchanged capability callbacks across context switches, while
the previous engine cleared its cache for each new target. Fresh safe content
metadata was present but no safe GTK entry could acquire a lease. The engine
now preserves transport capabilities while requiring fresh field metadata.

The JSON report includes source hashes, exact runtime versions, monotonic
fixture events, acknowledgments and explicit unsupported cases. A native
screenshot, IBus/Xvfb logs, optional callback trace and accessibility focus
JSONL accompany it. Failures retain evidence when an output directory is set.

This closes a contained source-engine GTK/X11 regression slice. It does not
close installed-package GNOME/KDE Wayland, browser/Electron, Qt, LibreOffice,
lock/suspend, physical keyboard, native Tauri IPC, or real microphone acceptance.
The complete [Linux matrix](linux-e2e.md) remains the release standard.

## Cold focus versus established focus

The 30-cycle supported-field test deliberately enters a different-metadata field
before A, so its starting metadata proof is observable. This is not a claim that
cold launch or same-field refocus always produces fresh metadata. The separate
`VOCO_NATIVE_STARTUP_ONLY=1` mode leaves initial focus untouched and returns failure
when automatic delivery is unavailable. A five-launch series produced four correct
Unicode deliveries and one safe rejection: GTK focus bounced A→IBus fake→A, and
IBus omitted the unchanged content callback on return. No target text was mutated
in the rejected case. That is 4/5 automatic startup coverage, not five passes;
`startup-5/callbacks.log` retains the ordering. The engine policy was not weakened
to make that case pass.

## Full application with virtual microphone

The additional `scripts/test-native-full-app.py` fixture provides a minimal private
tray-host discovery service, then launches a copied Tauri
executable with a copied, SHA-256-verified existing model. A private PulseAudio
null sink and remapped source accept only the public, licensed speech fixture;
there is no hardware microphone access. Onboarding is completed in the disposable
config, and final-only output is selected. Actual XTest shortcuts, WebKit capture,
AudioWorklet, binary IPC, recognition and final GTK mutation are checked.

```bash
VOCO_NATIVE_APP_BINARY=/absolute/path/to/candidate/voco \
VOCO_NATIVE_MODEL=/absolute/path/to/existing/ggml-base.en.bin \
VOCO_NATIVE_EVIDENCE_DIR=/absolute/evidence/full-app \
  scripts/test-native-desktop.sh
```

This mode also requires `pulseaudio`, `pactl`, and `paplay`. It hashes the actual
copied binary before launch and records its identity. Its diagnostic audio export
contains only the fixture recording and is confined to the disposable test state
and requested evidence directory. It does not enable diagnostic capture in the
user's configuration. Run against the final candidate after integration changes;
an earlier preflight build is not final-snapshot proof.

## Final packaged candidate verification

The executable extracted from the final development Debian bundle was tested
without callback instrumentation. Its SHA-256 is
`1ecd66a1336ca0158be17d66cb96ceba96ebbaa782e12201ca22c8c0d9e4e1fe`;
the unchanged model is
`a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`.
The public source fixture is `84-121123-0000.wav`, SHA-256
`6e8353d85498a02b0e06c0107e81f48b2020615b541d13a13440b41effbac0ff`.
These are development acceptance records, not evidence of host installation or
publication. The application executable is the exact packaged file; the isolated
IBus component runs source copies whose hashes are recorded in each report.

| Full application case | Verified result |
| --- | --- |
| Final text only | Real capture, resampling, binary IPC and existing-model inference produced `Go! Do you hear?` exactly once in GTK A; B remained empty. Start and stop traveled through consuming IBus shortcuts. |
| Stable cursor streaming, short fixture | The same exact text was committed once through the canonical final path, with one canonical chunk. This does not establish rolling multi-chunk native capture coverage. |
| A→B during capture | Recognition completed, both fields remained unchanged, and VOCO retained the complete text for recovery. The actual recovery window fit entirely within the monitor workarea. |
| Recovery Copy action | AT-SPI located the real enabled, visible Copy transcript button. A trusted XTest click copied the exact recovered text to the private X11 clipboard. Before/after screenshots were inspected. |

The verified recovery window was `(430,120)` with size `420×660` inside the
`1280×900` workarea. Its Copy transcript button was `(466,539)` with size `149×44`.
The older failing placement `(660,474,420,660)`, which extended 234 pixels below
the display, is retained separately as regression evidence. The final window is
bounded; its additional content remains scrollable within the window.

The iterations found real native regressions that renderer mocks could not expose:
IBus's deduplicated capabilities blocked GTK delivery; X11 global shortcut grabs
intercepted the consuming input method; CSP blocked raw IPC and forced Tauri's JSON
fallback; and the recovery popup extended below the screen. The final native cases
exercise the resulting fixes through the actual toolkit and application.

To repeat the other full application cases, keep the binary/model/evidence variables
above and set:

```bash
# Use a distinct evidence directory for each case.
VOCO_NATIVE_OUTPUT_MODE=stable-cursor-streaming scripts/test-native-desktop.sh
VOCO_NATIVE_APP_CASE=focus-switch scripts/test-native-desktop.sh
```

Set `VOCO_NATIVE_BUILD_ROLE=packaged-candidate` when testing an extracted candidate.
The hosted `--full-application` wrapper runs final-only, streaming and focus recovery
with the same binary. `execution.json` records the exit code and hashes of files
produced by that invocation. When reusing an output directory, treat only files
listed by that current execution manifest as current evidence; an older report
outside the manifest cannot turn a failed startup into a pass.

Final reports and screenshots are under the adjacent development evidence directory:
`iteration-2/native/verified-final`, `verified-streaming`, `verified-recovery`, and
`verified-engine-clean` (corrected independent cases). The contaminated old
`verified-engine` WebKit classifications are invalid. `verified-webkit-focus` and
`webkit-redirect-proof` retain the failing same-context DOM redirect regression.
The packaged GTK passes do not supersede this open safety failure. The separate
cold-focus 4/5 measurement and DOM-identity limitation remain explicit. Native rolling
checkpoints, Wayland desktops, broad app coverage and physical microphone journeys
remain pending.

The optional `VOCO_NATIVE_OVERLAP=1` fixture places distinct WebKit fields at the
same rectangle and swaps z-order. With `VOCO_NATIVE_TRACE=1`, the disposable engine
logs cursor callbacks and dispatch markers. `webkit-identical-cursor-proof`
confirms both focus races redirect text without any intervening cursor callback;
a cursor-geometry guard cannot supply the missing field identity.
