<!-- markdownlint-disable MD032 MD060 -->

Current cut: the owner accepted installed +local7 and authorized the private
2026.0.37 release cut. See [status and remaining public gates](../releases/2026.0.37.md).
Earlier candidate preparation/deferral statements below are historical. The owner's
installed application remains +local7 until a separately requested update.

Current follow-up: private **+local7** contains the [bounded legacy keyboard optimization](keyboard-delivery-2026-09-15.md). +local6 was installed and successfully owner-tested. Older revision results below remain historical; use exact artifact receipts for the new candidate.
# Testing

Current candidate: [2026.0.37 release gates](../release-candidate.md).
Current work: [`+local6` validation C results and remaining gates](stop-delivery-review-2026-09-15.md).
Frozen baseline: [`+local5` cross-Linux results, including the failed Stop gate](cross-linux-review-2026-09-15.md).
Prior baseline: [pre-release review and acceptance scope](pre-release-review-2026-09-15.md). Model selection
and measurement boundaries: [round-3 comparison](model-comparison-2026-09-14.md).
Run worker tests with `python3 -m unittest discover -s runtime/speech -p 'test_*.py'`;
run the actual model protocol separately with `python3 runtime/speech/test_worker_protocol.py --output-dir /path/to/new/receipts`.
NumPy/psutil and the pinned native/model payload must be present for relevant tests.
Never count a missing model or an unrun protocol case as a pass.

The [X11 follow-up](x11-stop-delivery-followup.md) records the reproduced root-grab
failure and current exact-focus session-grab acceptance plan. Logical frontend
shortcut begin/end traces also occur on native no-op routes; they do not prove
physical X11 scope. Match candidate/fixture hashes and preserve all attempted
trial denominators. Default GNOME, KDE, Cinnamon and Omarchy/Hyprland desktops,
physical audio and owner applications still require their own acceptance.
The current review includes paired event-driven versus polling-actor callback and
idle tests. A planned zero-delay shortcut was scheduled by a helper after XSync;
it is not an atomic same-server-batch test. Zero sampled CPU ticks means below the
10 ms accounting resolution, not zero cost or measured app energy savings.
Renderer-reload tests cover epoch-bound shortcut Begin/cleanup and replacement
UUIDs; generic paste IPC remains a separate contract. Final source checks passed
498 Rust test executions and 459 frontend tests (2 optional skips), with full npm,
20 assembler tests and static checks passing. The strict Stop matrix passed
34 selected cases from 35 attempts; model protocol passed 65 cases in five userspaces.
Normal userspace/shortcut continuation passed five selected cases from eight attempts.
Three original fixtures incorrectly assumed root-X11 ownership when IBus owned the
shortcut; corrected real Start/Stop checks passed and failed receipts are retained.
Use each supplied artifact's external native install/parity/remove receipts; see
the [current review](stop-delivery-review-2026-09-15.md).
The packaged-UI reload attempt found no supported action; Ctrl+R did not initialize
a second renderer. Epoch race tests pass, but active-owner full-app reload remains
unqualified; no debugger/backdoor or child-process kill substituted for that test.
Validation B stopped after two attempts: one completion under its original harness,
then a pre-capture startup failure. Do not reclassify the first using C's tightened
actual-Stop-overlap/focus-identity gates. C includes consuming-X11 versus passive-evdev
arbitration tests; preserve actual attempted denominators for the native matrix.

See the [historical foundational acceptance record](foundations-iteration-13-2026-09-06.md)
for implemented changes, reproduced regressions, verification and open coverage.

See [preview timestamp geometry](preview-geometry.md) for decoded-snapshot bounds,
provisional text preservation, and the model-free regression tests.

See [laptop performance diagnostics](laptop-performance.md) for opt-in local backend
timings, resource samples, privacy boundaries and a report for manual laptop trials.

Run the headless IBus mutation-rejection command matrix before any isolated desktop cursor test:

```bash
npm run test:owned-preedit
```

This does not attach to the live input session. The [native fixture](native-isolated.md) adds actual
GTK/WebKit widgets inside private X11, D-Bus, IBus and process namespaces. It can also launch the
candidate with a private synthetic microphone. The [GNOME harness](gnome-isolated.md)
also runs an actual private Shell/Mutter compositor. Installed-distribution acceptance
still requires its own disposable VM or microVM; local namespaces do not establish that coverage.

## Disposable desktop test

Do not run VOCO input-method, injection, or virtual-audio experiments on an active workstation.
Automated injection must stay in a private fixture. Owner-authorized manual laptop
acceptance is a separate physical test gate, not authorization for arbitrary injected
commands in live apps. Perform the synthetic steps below in the disposable VM described in the cursor
streaming checklist, and preserve the remote run ID and evidence.

1. Install dependencies:

```bash
npm ci
./scripts/setup.sh --install
```

2. Start VOCO:

```bash
npm run dev
```

3. Test the product:
- install the Debian package in the disposable VM so the persistent component exists
- optionally add and select `VOCO Dictation` only when testing consuming IBus shortcuts;
  the default NVIDIA desktop-paste route does not require changing Input Sources
- allow microphone access
- finish onboarding
- press `Alt+D`
- speak a short sentence
- verify progressive words reach the intended test field without an automatic preview window
- press `Alt+D` again
- verify the final tail, separators, no unintended Enter and no duplicate text
- intentionally change focus and check recovery without automatic replay
- for direct delivery, enable the packaged Chromium extension, focus a supported field and use Alt+Shift+V; verify the exact field and receipt

An uninstalled source process does not install native messaging manifests. A browser E2E
fixture must provide the explicit host registration and extension, as the isolated test does.

For a production-mode headless build without packaging, run:

```bash
cd apps/desktop
cargo tauri build --features custom-protocol --no-bundle
```

Do not use plain `cargo build --release` for a runnable desktop build. The app's
`custom-protocol` feature enables Tauri's production frontend protocol; the Rust build now rejects
release binaries that omit it.

## Offline physical and comparative qualification

The [physical microphone protocol](physical-microphone-qualification.md) includes
an executable, consent-gated import workflow that preserves original WAVs and
unrun case status without opening a microphone. The
[comparative evaluation contract](comparative-dictation.md) imports retained peer
measurements with source/model binding and explicit failed/censored denominators.
Both tool suites run in `npm test` and `npm run verify:devops`; their tests use
public fixtures or JSON sidecars, with no recording or model inference.

## Automated checks

The [preview scheduling and cancellation regressions](preview-scheduling.md) cover
continuous capture arrivals, canonical-work ownership and invalidation during
asynchronous audio preparation. They run in the normal frontend test suite.

```bash
npm run verify:versions
npm run test:owned-preedit
npm run test:private-ibus
npm run test:native-desktop
npm run check
npm run lint
CARGO_BUILD_JOBS=2 cargo test --locked --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
npm --workspace @voco/desktop run build:frontend
CARGO_BUILD_JOBS=2 cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm test
```

Run `npm run test:private-ibus` directly on development machines. CI and release jobs use
`scripts/test-private-ibus-engine-hosted.sh` instead. That wrapper refuses to run outside GitHub
Actions and, on affected Ubuntu 24.04 hosted runners, temporarily permits Bubblewrap's private user
namespace only for the test before restoring the original AppArmor policy. The private network,
mount, IPC, PID, and UTS namespaces remain enabled.

The same hosted wrapper's `--native-desktop` selection runs the real GTK/WebKit fixture. Missing
local dependencies or isolation fail the check; there is no fallback to an active desktop.
The pinned-model gates `test:speech-baseline`, `test:speech-continuity` and `test:speech-adversarial` require `VOCO_MODEL_PATH`
and never download or upgrade a model themselves. CI fetches only the existing hash-pinned model.
The [adversarial gate](speech-adversarial-evaluation.md) retains every response from 58 fixed
speech/noise cases, 12 complete-utterance boundary cases, six mixed-loudness cases and
12 additional-voice repetition cases (88 total). Every speech family must meet
its own WER bound, every speech case must contain words, and noise controls must contain no
lexical words. The [repeated-speech phase check](speech-continuity.md#repeated-speech-phase-diagnostic)
also scores accuracy: a short incomplete transcript cannot pass merely by being nonempty.

Build the frontend before the all-features Clippy gate on a clean checkout. Tauri's production
`custom-protocol` context validates `apps/desktop/dist` at compile time.

## Manual checks before release

- confirm the onboarding fits in the window without scrolling
- confirm the top bar can drag the window
- confirm `Hide to tray` works
- confirm the final onboarding step shows the three tray icons clearly
- confirm dictation still works end to end
- run `npm run report:linux-runtime` on the Linux machine used for release testing

Use [linux-e2e.md](./linux-e2e.md) as the release sign-off checklist for Ubuntu-class Linux environments.

Use [browser-broker.md](./browser-broker.md) and the
[current adapter contract](../../integrations/chromium/README.md) for direct delivery.
The older [cursor checklist](./cursor-streaming-manual-qa.md) and
[results](./cursor-streaming-qa-results.md) describe the suspended IBus implementation.

Use [local-intelligence-manual-qa.md](./local-intelligence-manual-qa.md) when validating optional
localhost transcript enhancement or local assistant mode.

## Foundation regression gates

The [worklet input-continuity contract](worklet-input-continuity.md) covers an observable
input gap, exact received-prefix recovery, valid silence, producer sealing and stale
messages. Its model-free worklet tests run in `npm test`; the renderer suite exercises
the actual dictation hook and manual recovery with mocked device/native boundaries.

`npm run test:dictation-renderer` drives the real recording hook, store, and recovery
panel in headless Chromium with explicit microphone/Tauri mocks. Install the development
browser once using `npx playwright install chromium`. CI and release jobs enforce this
suite. It starts and closes its own loopback Vite server/browser and does not capture the
host microphone or inject input. Set `VOCO_RENDERER_EVIDENCE_DIR` to an external directory
for screenshots/results. These are renderer checks, not native Wayland or WebKit proof.

`npm run test:microphone-renderer` checks the real App's asynchronous device discovery,
access retries and preview ownership with mocked microphones. Set
`VOCO_RENDERER_EVIDENCE_DIR` to a new output directory; its parent must exist.
CI and release jobs enforce this suite too. See [microphone recovery](microphone-recovery.md)
for the separate installed Linux qualification protocol and evidence boundaries.

`npm run test:speech-baseline` exercises the pinned base.en model against
[eight attributed LibriSpeech fixtures](../../tests/fixtures/speech/README.md) and synthetic
silence. Set `VOCO_MODEL_PATH` to that existing model; the test refuses missing or different
models. CI and release jobs download and checksum only this existing model for the gate.
This smoke corpus establishes a repeatable regression floor, not product-wide accuracy.

`npm run test:speech-adversarial -- --output-dir /path/to/new/evidence` builds and freezes
the actual Rust replay worker and its transcription source, prepares the checked-in public
fixtures and synthetic controls, and runs both prospective suites even if one fails.
It preserves logs, hashes and per-case results. Existing output directories are refused.
CI and release jobs run this gate and retain its reports, including failures.

The [private Wayland harness](wayland-isolated.md) supplements X11 checks with real
GTK/WebKit surfaces, tray Open/Quit lifecycle and optional verified model-cache readiness.
It does not qualify physical microphones or an installed GNOME/KDE session.

Long packaged-browser capture requires `VOCO_BROWSER_LONG_CAPTURE=1` and
`VOCO_BROWSER_DEBUG_CAPTURE=1` in the private synthetic-audio harness. Before
recording, it verifies every fixture and the reconstructed playback PCM and freezes
the complete reference. After focus loss, it scores both the final canonical text
and final transcript against that full reference before clearing recovery. It also
requires exact preservation of the committed target prefix. Public fixture audio
and debug JSON are retained in the requested evidence directory. This opt-in
diagnostic is for the isolated harness, not the user's normal recording configuration.

`npm run verify:cursor-acceptance -- /path/to/hotkey-trace.jsonl --min-duration-ms 60000`
uses strict exit status for installed-desktop acceptance: unproven/failing sessions and
copy/overlay fallbacks cannot count as successful supported-target delivery. Ordinary
`npm run report:cursor-streaming` remains diagnostic and can describe incomplete runs.

[Foundation changes and acceptance record](foundations-2026-09-04.md) distinguish automated
proof from pending native desktop and microphone validation.

See [Native capture development](native-capture-development.md) for the optional native backend, explicit app-session source selection and its separate qualification gates.

- [Combined UI, UX and laptop testing](combined-laptop-testing.md)

## Exact text and delivery quality

[Quality attribution and scorer](dictation-quality.md) describes diagnostic .36,
the privacy boundary, and why helper completion is not confirmed insertion.
