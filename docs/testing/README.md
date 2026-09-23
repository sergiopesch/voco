# Testing


- [2026.0.59 Stop reservation and installer qualification](stop-reservation-release-2026-09-23.md): rejected renewals, parent-owned cleanup and exact-package release evidence.
- [2026.0.58 Brave Stop release qualification](brave-release-2026-09-23.md): exact-package upgrade, five-minute dictation and signed public assets.
- [2026.0.57 tray and installer release qualification](tray-brand-release-2026-09-23.md): exact-package installation, recovery and desktop checks.
[The unreleased installer brand refresh](installer-brand-2026-09-23.md) records the
larger shared wordmark, terminal fallbacks, prompt handoff and rendering cost.

[The unreleased onboarding and recovery review](onboarding-recovery-2026-09-23.md)
records direct-to-tray completion, continued recognition after delivery interruption,
quiet recovery, multi-minute trials and the remaining qualification limits.

[The .56 installer and Ghostty qualification](installer-ghostty-2026-09-23.md)
records the exact released package, repeated X11 Start/Stop, separate native
Wayland checks, installer opening, installed worker and package removal checks,
and signed public-download verification.

[The .55 qualification and publication record](release-qualification-2026-09-23.md)
binds the final package to installation/removal, worker, 16 private GNOME X11,
nine browser lifecycle, native Wayland onboarding and real VM helper migration
checks. It also records signing and anonymous release-download verification.
Physical microphone and owner-session acceptance remain separate from those fixtures.

[The 22 September review](release-readiness-2026-09-22.md) retains the earlier
security/performance assessment, superseded candidates and failed attempts.
[The first-run follow-up](first-run-follow-up-2026-09-22.md) records the Brave
readback regression and installer canvas work against the then-public .54 baseline.

- [2026.0.52 release qualification](installer-release-2026-09-22.md) — exact package, desktop, signing and public-download receipts.

The [.52 installer performance record](installer-performance-2026-09-22.md) records
download timing, CPU overhead, event-driven presentation and real Ubuntu APT prompt
tests. Package and desktop qualification are recorded separately above.

The [.51 public release record](linux-release-2026-09-22.md) identifies the signed
package, source and verified downloads. The
[tray, setup and single-engine integration record](tray-setup-2026-09-21.md)
retains the candidate's desktop/audio evidence and remaining coverage limits.

[Wayland installation and onboarding readiness](wayland-install-2026-09-20.md) records the .46 regression fix and installed-guest scope.

The [public benchmark gallery](../release-assets/2026.0.43/README.md) presents the
matched seven-model comparison and separate historical cohorts, with 8K graphics,
numeric data and measurement boundaries.

Current publication and qualification status: [release gates](../release-candidate.md).
Dated reports below are historical evidence, not qualification of a later binary.
The [.43 Linux qualification report](linux-release-2026-09-19.md) tracks native
packages and the Wayland hidden-capture change. See the [native capture contract](native-capture-development.md)
for explicit permission, interruption recovery and independently verified audio audits.

The [TypeSafe evaluation protocol](typesafe-evaluation.md) defines timing, word and
punctuation accuracy, semantic judgments, corpus requirements and rejection rules.
The [19 September before/after experiment](typesafe-results-2026-09-19.md) records
actual local-worker comparisons and live Jev scores, separately from product QA.

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
The 15 September review includes paired event-driven versus polling-actor callback and
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
the [dated review](stop-delivery-review-2026-09-15.md).
The packaged-UI reload attempt found no supported action; Ctrl+R did not initialize
a second renderer. Epoch race tests pass, but active-owner full-app reload remains
unqualified; no debugger/backdoor or child-process kill substituted for that test.
Validation B stopped after two attempts: one completion under its original harness,
then a pre-capture startup failure. Do not reclassify the first using C's tightened
actual-Stop-overlap/focus-identity gates. C includes consuming-X11 versus passive-evdev
arbitration tests; preserve actual attempted denominators for the native matrix.

See the [historical foundational acceptance record](foundations-iteration-13-2026-09-06.md)
for implemented changes, reproduced regressions, verification and open coverage.

See the historical [preview timestamp geometry](preview-geometry.md) record for
the retired snapshot decoder's bounds and provisional-text design. Its unused
modules and exclusive tests have been removed; current speech gates exercise the
production Nemotron stream.

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

The [preview scheduling and cancellation record](preview-scheduling.md) documents
the retired snapshot decoder. Its exclusive tests are historical; current speech
gates exercise the production Nemotron stream and recovery path.

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
`npm run test:speech-baseline` runs the pinned Nemotron streaming worker against
eight fixed speech fixtures, repeated-speech integrity, silence and capture-boundary
variants. Original corpus thresholds remain unchanged. `scripts/provision-ci-speech.sh`
provisions only the checksum-pinned native payload from release .47; it keeps Python
worker code from this checkout. Local runs can use an already verified runtime.
`runtime/speech/test_worker_protocol.py` separately checks startup, sequence bounds,
stale-session rejection, cancellation and cleanup. Reports identify the actual model.

The earlier [adversarial evaluation](speech-adversarial-evaluation.md) and
[phase diagnostics](speech-continuity.md) are historical Whisper evidence. Their
retired decoder runners are not current release gates.

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
for screenshots/results. Coverage includes five minutes of simulated audio and a
delivery rejection at two minutes with continued recognition through Stop. These
are renderer checks, not native Wayland or WebKit proof.

`npm run test:microphone-renderer` checks the real App's asynchronous device discovery,
access retries and preview ownership with mocked microphones. Set
`VOCO_RENDERER_EVIDENCE_DIR` to a new output directory; its parent must exist.
CI and release jobs enforce this suite too. See [microphone recovery](microphone-recovery.md)
for the separate installed Linux qualification protocol and evidence boundaries.

The current speech baseline is a repeatable regression floor, not a representative
product-wide accuracy benchmark. Use `--report /path/to/new/report.json` to retain
complete results; existing report files are refused. It never downloads a model or
reads personal recordings. CI retains failures as well as successful reports.

The [private Wayland harness](wayland-isolated.md) supplements X11 checks with real
GTK/WebKit surfaces, tray Open/Quit lifecycle and verified bundled-worker warmup.
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

## glib iterator safety

Run `python3 scripts/verify-glib-backport.py`, then
`python3 scripts/test-glib-variant.py --output /tmp/voco-glib-check` using a fresh
output directory. The latter uses the resolved dependency and production optimization
without starting a desktop. Add `--debug` for the debug control.

## Current Linux package milestone

[19 September native packaging and Hyprland experiments](linux-release-2026-09-19.md)
records the .43 development work, successful checks and unresolved release gates.
It is not a publication or universal compatibility claim.

- [22 September dependency refresh and .53 qualification](dependency-release-2026-09-22.md)
