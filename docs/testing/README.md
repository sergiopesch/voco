# Testing

VOCO's automated tests never touch the desktop you work in: renderer suites mock
the microphone, desktop suites play public speech into private audio servers and
displays, and speech suites feed audio straight to the worker. `npm test` runs
the quick checks and the rest are separate steps. A person with a physical
microphone finishes with the [manual acceptance](#manual-acceptance) check.
[CONTRIBUTING.md](../../CONTRIBUTING.md#prerequisites) lists the tools.

## npm test

`npm test` runs `scripts/test-unit.sh`, which needs no microphone, speech model
or desktop session and stops at the first failure:

| Group | Steps |
| --- | --- |
| Source provenance | `verify-speech-engine.py`, which finds no second speech engine in shipping source or dependency metadata; `verify-tray-backport.py` and `verify-shortcut-backport.py`, which check the vendored tray and shortcut crates against upstream and that the app resolves only those copies |
| Speech reports, the package assembler and the speech runtime | `test:dictation-quality`, `test:dictation-quality-events`, `test:speech-report`, `test:speech-package` (the package assembler and the Debian maintainer script), `test:speech-runtime` (the worker's unit tests) and `test-report-performance.py` |
| Capture and desktop integration | `test-panel-setup.py`, `audio-worklet-capture.test.mjs`, `test:native-capture-audit`, `test:ibus`, `test-native-kde-identity.py` and `test-speech-worker.py` |
| Dictation scoring and evaluation tools | `comparative-dictation.test.mjs`, `test-audio-continuity.py`, `speech-score.test.mjs`, `speech-integrity.test.mjs`, `speech-continuity.test.mjs`, `browser-long-accuracy.test.mjs`, `browser-capture-lifecycle.test.mjs` and `test:dictation-evaluation` |
| The desktop app | Vitest, as `vitest run` in `apps/desktop` |

Names with a colon are npm scripts; the others are in `scripts/`. The worker's
tests run under `/usr/bin/python3` with NumPy and psutil, and `test:ibus` needs
python3-gi and gir1.2-ibus-1.0. The evaluation tests make no network requests.

## Types, lint and Rust

`npm run check` runs `tsc --noEmit` and `npm run lint` runs ESLint, both in
`apps/desktop`. `npm run verify:devops` checks script syntax, package metadata,
the CI workflow rules and the installer, then rehearses a release, as the
[release process](../release-process.md#what-ci-checks) describes. Clippy with
every feature embeds the built interface, so build that first:

```bash
npm --workspace @voco/desktop run build:frontend
cd apps/desktop/src-tauri
cargo fmt --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets
```

A release build fails to compile without the `custom-protocol` feature, which CI
and `scripts/build-desktop.sh` turn on. `python3 scripts/verify-glib-backport.py`
checks that `vendor/glib` is the upstream release plus one upstream fix and that
the app resolves only that copy; `scripts/test-glib-variant.py --output NEW-DIR`
tests it with release optimization. Both work offline, from crates Cargo has
fetched. `npm run test:native-capture-callbacks` compiles VOCO's C capture code
against libpulse, with `CC` or `cc`, and runs its callbacks with no audio server.

## Renderer suites

These load VOCO's interface from a local Vite server into Playwright's Chromium,
which `npx playwright install --with-deps chromium` installs. The dictation,
microphone and native-capture suites run the real app, hooks and store with every
microphone, clipboard and native call mocked; none opens a microphone.

| Command | Covers |
| --- | --- |
| `npm run test:dictation-renderer` | Recording into native and browser fields, progressive paste, Stop, cancellation and paste failures, including five minutes of simulated audio in 100 ms packets with a paste failure at two minutes |
| `npm run test:microphone-renderer` | Microphone permission, device discovery, retries and the level preview |
| `npm run test:native-capture-renderer` | Native source selection and capture-failure recovery; with `VOCO_RENDERER_SUITE=onboarding`, the setup voice test |
| `npm run test:brand-motion` | The setup, popover, settings and Review surfaces with synthetic state, as [Branding](../branding.md#check-the-presentation) describes |
| `npm run test:chromium-exact-field` | The extension's scripts against a mock `chrome` API, then the extension in Chromium with a local page; the [Chromium extension](../../integrations/chromium/README.md#files-and-tests) README covers `--native`, which adds the real host |
| `node --test scripts/test-panel-model.mjs` | The GNOME companion's presentation model, in Node |

`VOCO_RENDERER_EVIDENCE_DIR` receives screenshots and results. The microphone,
native-capture and brand-motion suites require it and create it, so name a new
directory whose parent exists.

## Isolated desktop suites

These run real programs: GNOME Shell, Weston, Xvfb, IBus, PulseAudio, Chromium
and the app itself. Each suite runs in Bubblewrap with private network, IPC, PID
and UTS namespaces and starts the display, D-Bus, IBus or audio servers it needs,
so nothing reaches your session. CI runs them through
`scripts/test-private-ibus-engine-hosted.sh`, which works only on GitHub Actions,
where it relaxes Ubuntu's AppArmor limit on unprivileged user namespaces for the
test and then restores it. Locally, run the named script with the same variables.
Suites that type through VOCO's virtual keyboard also need the
[uinput bridge](#the-uinput-bridge), which runs only on a disposable machine.

| Wrapper option | Script | What runs |
| --- | --- | --- |
| None | `test-private-ibus-engine.sh` | VOCO's IBus engine against a private IBus daemon, with no display or session bus |
| `--gnome-panel` | `test-gnome-panel.sh` | GNOME Shell with the [companion](../../integrations/gnome/README.md#files-and-tests) and synthetic app status; with `VOCO_PANEL_APP_BINARY`, the app's tray bridge |
| `--native-desktop` | `test-native-desktop.sh` | Real GTK and WebKit widgets with private X11, D-Bus and IBus |
| `--native-wayland` | `test-native-wayland.sh` | Real Wayland surfaces in headless Weston; with `VOCO_WAYLAND_APP_BINARY`, the app starting, opening and quitting from its tray |
| `--native-pulse-latency` | `test-native-capture-pulse-latency.py` | VOCO's C capture from a private PulseAudio: a short clip, a long clip, and a starved run that must fail with `capture-duration-deficit` |
| `--application-delivery`, `--browser-delivery` | `test-application-delivery.sh` | Paste into desktop programs and into Chromium, below |
| `--full-application` | `test-native-desktop.sh` with `VOCO_NATIVE_APP_BINARY` | The app capturing a clip from a private PulseAudio and pasting into GTK fields |
| `--browser-application`, `--browser-toolbar` | `test-browser-full-app.sh`, `test-browser-toolbar-app.sh` | The app, extension and host dictating into an exact Chromium field, started with Alt+Shift+V or the toolbar button |

`npm run test:private-ibus`, `test:native-desktop`, `test:application-delivery`,
`test:browser-delivery` and `test:browser-full-app` run the matching scripts. Give
each suite a new evidence directory; the wrapper requires one for all but the IBus
engine, native desktop and delivery suites. `VOCO_NATIVE_DEPS` and
`VOCO_WAYLAND_DEPS` name the `usr` directory holding Xvfb and Weston, usually `/usr`.

The full-application, Wayland and browser suites run the release build with the
[provisioned runtime](../linux-packaging.md#runtime-provisioning), checked
against `MODEL-IDENTITY.json` and `NATIVE-BUILD.json`. `--full-application` has
two cases: in `delivery`, one field keeps focus and gets the words exactly once;
in `focus-switch`, focus moves mid-recording and each field keeps only what was
pasted while it had focus. Any IBus preedit or commit, refused paste, copied
remainder or fallback capture fails them. `--browser-application` runs a short
recording and, with `VOCO_BROWSER_LONG_CAPTURE=1`, a long one.

### Delivery suites

`test-application-delivery.sh` pastes into real programs as VOCO does, with the
clipboard, the primary selection and Shift+Insert, and reads the result back from
the program. `VOCO_DELIVERY_PLATFORM` is `x11`, a private Xvfb and the default, or
`gnome-wayland`, a nested GNOME Shell with XWayland and no `/dev/input`.
`VOCO_DELIVERY_SUITE` picks the cases:

- `applications`, the default: GTK 3, GTK 4 and WebKit fields, GNOME Text Editor,
  and GNOME Terminal with Bash and with nano. Ghostty, Firefox and VS Code run
  when `VOCO_GHOSTTY_BINARY`, `VOCO_FIREFOX_BINARY` or `VOCO_VSCODE_BINARY` names
  the program, and are recorded as unavailable otherwise. `VOCO_APP_CASE` picks
  cases by name. The run passes when one case passes and none fails.
- `browser`: a Chromium input, a textarea, empty editors, a placeholder, a
  selection, non-ASCII text, a focus change and the address bar. All must pass.

A replica of VOCO's paste commands runs unless `VOCO_FIXTURE_PASTE_BINARY` names
the `voco` library test executable, which pastes through the production code.
On `gnome-wayland` that code types through VOCO's real virtual keyboard, which
the [uinput bridge](#the-uinput-bridge) replays, so it needs
`VOCO_UINPUT_BRIDGE=1`. CI runs `gnome-wayland` only this way, with a release
build of the test executable. `VOCO_DELIVERY_EVIDENCE_DIR` receives `results.json`,
the bridge's `uinput-bridge.jsonl` and failure screenshots.

### The uinput bridge

On Wayland VOCO pastes through its own uinput keyboard, which a compositor reads
from `/dev/input`. The bridged suites, the `gnome-wayland` delivery suites with
the production paste and the GNOME cursor journey, give their namespace
`/dev/uinput` and still no `/dev/input` or `/dev/snd`, so nothing inside can read
that keyboard. `scripts/fixtures/uinput-bridge.py` runs outside the namespace. It
grabs each kernel device named exactly "VOCO virtual keyboard" as it appears, so
its keys reach no compositor or console, and replays every press and release in
order, with VOCO's gaps between them, as XTest on the private Xvfb, reached
through the namespace's shared `/tmp/.X11-unix`. The nested GNOME Shell passes
them to its focused window. Keyboards come and go with each VOCO process. Only
Shift+Insert, optionally led by one Space, is accepted. Any other key, a dropped
event, or a keyboard that leaves before its grab or in the middle of a paste is
rejected; the bridge then replays nothing more and the suite fails.

The bridge refuses to run without `VOCO_UINPUT_BRIDGE=1`, or while `DISPLAY`,
`WAYLAND_DISPLAY` or a logind graphical session exists, because a keyboard it
missed would type into that desktop. Set it only on a disposable machine. The user
running the suite needs read and write access to `/dev/uinput` and read access to
VOCO's event nodes: CI loads `uinput`, gives the runner an ACL on `/dev/uinput`,
and adds a udev rule that gives it one on each VOCO event node.

`uinput-bridge.jsonl` uses `CLOCK_MONOTONIC` times. It records each grab and
removal, each key with when VOCO sent it and when it was replayed, and a
`dispatch` and a `completed` record for each gesture. In the cursor journey those
two records also hold the Shell's modifiers and whether its window menu is open,
just before the first key and after the last, which `shell-probe-input-state.py`
relays from inside the namespace. There `wl-copy` is `shell-probe-wl-copy.py`,
which sets each selection through the private Shell probe.

## Speech suites

These run `runtime/speech/stream_worker.py` with the model and runtime in
`runtime/speech/`, as [runtime provisioning](../linux-packaging.md#runtime-provisioning)
describes. They never download a model and leave out capture, IPC and paste.

`npm run test:speech-baseline -- --report NEW-report.json` is the regression
floor. After checking the model against `MODEL-IDENTITY.json` and each clip's
SHA-256, it streams eight LibriSpeech clips from `tests/fixtures/speech/`, 71.01
seconds in all, in 100 ms packets of 1,600 samples, as VOCO sends them. The
worker must answer each request within 120 seconds and only ever extend its
text. The run passes when:

- each clip returns words with a word error rate of at most 0.5, and all clips
  together at most 0.25;
- `84-121123-0000`, repeated 18 times with 250 ms pauses, returns 18 whole copies
  of its phrase and a word error rate of at most 0.15;
- 10, 20 and 30 seconds of silence return no text;
- the same clip stays within 0.5 at a tenth of its volume, with a second of
  silence before or after it, and padded so Stop's last packet has one sample;
- the worker exits with status 0.

`--report` refuses an existing file. `VOCO_PYTHON` and `VOCO_NEMOTRON_MODEL`
override the interpreter, `/usr/bin/python3`, and the model path.
[Speech fixtures](../../tests/fixtures/speech/README.md) records the clips'
source and what the bounds can't show.

`/usr/bin/python3 runtime/speech/test_worker_protocol.py --output-dir NEW-DIR`
checks the protocol with the real model: warm-up, stale and duplicate requests, a
replacement session, cancellation, silence, a bad sample rate, a clean exit and
logs without audio or text. Without `--output-dir` it writes into `runtime/speech/`.

`scripts/evaluate-dictation-worker.py` replays the development or held-out clips
into the worker to compare changes, as [TypeSafe evaluation](typesafe-evaluation.md)
describes. Neither `npm test` nor CI runs it.

## Suites CI doesn't run

These need programs or permissions that CI doesn't have. A run is evidence only
for the host it ran on. Where you don't run them, record them as unavailable.

| Script | What runs | Needs |
| --- | --- | --- |
| `test-native-gnome.sh` | GNOME Shell with Ubuntu's AppIndicator extension on a private Xvfb seat. `VOCO_GNOME_APP_BINARY` adds the app and its tray, and `VOCO_GNOME_CRASH_REVIEW=1`, `VOCO_GNOME_ONBOARDING=1` or `VOCO_GNOME_CURSOR=1` adds Review, the voice test or dictation into a field | `VOCO_NATIVE_DEPS` and a new `VOCO_GNOME_EVIDENCE_DIR`. The voice test and dictation also need `VOCO_DEV_NATIVE_CAPTURE`, `VOCO_DEBUG_CAPTURE_AUDIO` and `VOCO_DEBUG_NATIVE_CAPTURE` set to 1, and dictation the [uinput bridge](#the-uinput-bridge) |
| `test-native-kde.sh` | KWin and Plasma on a private Xvfb seat. `VOCO_KDE_APP_BINARY` adds the app | `VOCO_NATIVE_DEPS`, `VOCO_KDE_DEPS`, the extracted KDE `usr` directory, and a new `VOCO_KDE_EVIDENCE_DIR` |
| `test-install-apt.py --allow-container-package-changes` | The installer's APT step with a fixture package: a maintainer script's prompt, then a configuration-file prompt that must keep the owner's edit | A disposable Docker container, because it installs and purges the fixture |

## CI jobs

`.github/workflows/ci.yml` runs five jobs on Ubuntu 24.04 for pushes to `master` and
pull requests into it. Evidence artifacts upload even after a failure and stay 7 days.

| Job | Runs | Artifact |
| --- | --- | --- |
| Code Guide | The [Inside VOCO](../guide/README.md) guide's server, catalog and lesson tests | None |
| RustSec Audit | `cargo audit` with cargo-audit 0.22.2 | None |
| Frontend Checks | `verify:devops`, `verify:security`, `check`, `lint` and `npm test`; the renderer suites, the panel model and the exact-field suite; the GNOME companion; both delivery suites on `x11`; the IBus engine, native desktop and native Wayland suites; the frontend build, and desktop entry and AppStream validation | `native-desktop-evidence` |
| Rust Check & Test | `cargo fmt`, Clippy, the glib checks, `cargo test`, the C callbacks and native capture latency; then it provisions the runtime and runs the speech baseline and the worker protocol | `speech-regression-evidence` |
| Application | The release build of `voco` and `voco-browser-host` with the runtime, then the tray bridge on GNOME, `--full-application`, both delivery suites on `gnome-wayland` through the release build's production paste and the uinput bridge, the Wayland lifecycle, `--browser-application` and `--browser-toolbar` | `application-evidence` |
| GNOME 50 Companion | On `ubuntu-26.04`, the companion regression headless on GNOME Shell 50 | `gnome50-panel-evidence` |
| Debian 13 Runtime, Fedora 44 Runtime | In digest-pinned containers, VOCO's package dependencies by that distribution's names, then the speech runtime, IBus and worker protocol tests and the speech baseline on its Python | None |

## Manual acceptance

No automated suite hears a real microphone or runs in a real desktop session.
Before a release, and after a change to capture, paste, the tray or the GNOME
companion, check VOCO on a Linux desktop with a physical microphone. Use a test
account, because dictation replaces the clipboard, and made-up sentences.

1. Install the package with `sudo apt install ./voco_<version>_amd64.deb`, or
   `sudo dnf install ./voco-<version>-1.x86_64.rpm` on Fedora, or run
   `bash scripts/setup.sh --install` in a checkout with the runtime. On Wayland,
   sign out and back in once so the [paste keys](../install.md#wayland-paste-keys)
   get their access.
2. Run `voco --version` and `voco --check-desktop-input`. On GNOME 46, 48 or 50,
   run `voco --setup-panel`, sign out and back in, then run `voco --check-panel`.
3. Start VOCO from the app menu. On a first start it opens setup: run the voice
   test, check that your words appear, and finish desktop setup.
4. Press the shortcut and dictate into a text editor, then a terminal. Words appear
   as you speak; Stop adds only the rest, with no repeats and no Enter.
5. Switch windows while you dictate. Later words go to the new window; the first
   keeps only what it had.
6. Watch the tray icon or GNOME panel as the microphone starts, while you speak
   and while VOCO finishes. Open Settings and Review from its menu.
7. Dictate until words appear, then run `pkill -KILL -x voco`. Start VOCO again,
   open Review, and find the interrupted dictation with Copy transcript and Discard.
8. Start VOCO with `VOCO_PERFORMANCE_LOG=1 voco`, dictate, quit, and run the
   [report scripts](../troubleshooting.md#performance-logs).
   `npm run report:linux-runtime` prints the session, desktop and paste helpers.

Record the version, distribution, desktop, session type, microphone and programs,
and every step's result, including failures and steps you couldn't run. The
runtime report holds local paths; remove them before you share it.

## Evidence rules

- Use synthetic or public fixtures, and made-up sentences when you dictate by hand.
- Remove personal recordings, transcripts, credentials and local paths before
  you share logs, reports or evidence directories.
- Never inject test speech into a live user session. Use isolated audio, input,
  clipboard and desktop fixtures, as the suites above do.
- Record a check that couldn't run as unavailable, never as passed. A missing
  model, program or dependency is never a pass.
- Keep failures and the number of attempted trials, not only the successes, and
  give each run a new evidence directory.
- Hosted CI never assembles the NVIDIA package or signs anything. The maintainer
  does both locally, as the [release process](../release-process.md) describes.
