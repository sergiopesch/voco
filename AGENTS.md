# VOCO development guide

VOCO is a local English dictation app for Linux. Keep it small, fast and clear.
Read [README](README.md), [the code map](docs/architecture/code-map.md) and
[release status](docs/release-candidate.md) before making changes.

## Product contract

- No account, subscription, telemetry or cloud transcription.
- One normal output path: streaming dictation directly to the cursor.
- No assistant, OpenClaw, realtime conversation, enhancement or appearance settings.
- Preserve the tray-first interface and system accessibility preferences.
- Keep microphone and shortcut configuration; recover interrupted dictation explicitly.
- Clipboard paste replaces clipboard text and never sends Enter. Never blindly
  replay uncertain output or overwrite text after focus changes.

## Architecture

The production path is `runtime/speech/` → Rust `benchmark_stream.rs` →
`benchmarkPhraseQueue.ts` → `insertion.rs`. Despite their historical names,
these are production modules. The selected runtime is NVIDIA Nemotron English
0.6B Q8 CPU. Keep the default worker count capped to at most four threads, leaving one CPU
from process affinity for desktop work (minimum one worker); preserve explicit research overrides and record actual counts. Desktop, Chromium exact-field dictation and local recovery all use this one recognizer.
Browser field ownership is a delivery concern, independent of recognition. Research model adapters are not selectable products.

Rust owns OS integration, files, processes, packaging and validation. React owns
presentation and recording orchestration. Keep both typed and state-driven.
Comment invariants and non-obvious decisions; avoid narrating every line.

Development and CI use Node 24 LTS (`.nvmrc`). Maintain Vite 8 and React plugin 6
together, preserve explicit output targets, and keep root renderer fixtures on
the desktop's Vite resolution. Qualify both dev rendering and packaged WebKit.

Configuration deserialization ignores retired output choices and returns cursor,
stable streaming and enhancement off. Patches reject removed fields. These fixed
snapshot fields remain for the legacy dictation engine contract; they are not
settings. Preserve microphone, shortcut and onboarding state during migration.

glib 0.18.5 is vendored with the exact upstream RUSTSEC-2024-0429 fix. Keep
all GTK/WebKit consumers on that single patched copy. Verify source provenance
and optimized iterator regression before accepting a dependency change; adding
glib 0.20 directly leaves the GTK dependency behind. [Backport](vendor/glib/VOCO-PATCH.md).

## Delivery invariants

- Warm the selected worker before reporting readiness. Imports do not start it.
- Flush Stop audio into the same live stream before finish; do not copy/replay a
  whole recording. Recover a dead worker only at a safe session boundary.
- Keep bounded queues, deadlines, sequence/sample accounting and recovery.
  Production worker IPC groups 100 ms of audio; Stop flushes the partial packet.
  Preserve the three-second backlog bound and verify every retained sample.
- Unverified ScriptProcessor fallback cannot enter automatic NVIDIA delivery.
- Explicit NVIDIA recovery uses `recover_stream` and the bundled runtime, with no
  destination callback or alternate recognizer. Preserve source samples/rate; publish
  only a completed result. Cancel keeps audio and stale cleanup is session-bound.
- The private legacy input daemon is selected only for the qualified system client.
  Keep `/usr/bin/ydotool` consistent between probing and dispatch. Migrate only
  VOCO's unmodified user unit while holding its single-instance guard, before
  recording can start. Package hooks must not restart desktop session services.
- Legacy ydotool requires a literal space argument, not `space`. Its paste delay
  is 24 ms; modern numeric arguments and terminal gestures have separate contracts.
- X11 shortcut scope belongs to the exact focus window, UUID and renderer epoch
  through final delivery. Keep the 650-second lease and release ownership safely.
- Completed IBus authority and a poll in flight differ. Consuming X11 callbacks
  proceed through debounce; passive evdev retains its duplicate guard.
- IBus protocol 6 is dictation-shortcut-only; older helpers must reconnect after upgrade. Never restore text mutation there.
- Bounded accessible-field observations are not atomic ownership or cursor paint.
  Rich editors require a bounded caret-linked paragraph route, including route identity
  and trailing noneditable scaffolding. Direct and nested editable HTML div/p blocks
  can lose their empty BR on first paste; native/plain-text newlines remain literal.
  Never acknowledge the outer object placeholder.
  Content and caret can propagate separately. Exact expected content at an earlier
  known caret is pending, never receipt; retain the deadline and no-replay rule.
- Automatic desktop insertion requires a bound, nonempty destination token. An
  unavailable preflight is never permission to paste unguarded. GNOME X11's
  `mutter-x11-frames` decoration is not a second destination; retain rejection for
  genuinely ambiguous active clients and test focus departure in a real session.
- Ghostty's GTK terminal canvas is an explicit `terminal_surface` destination,
  distinct from an accessible editable caret. Bind its unique focused pane through
  a bounded, fresh downward accessibility route; GTK can omit synthetic parents
  from reverse ancestry. Require focus/window-loss event tracking and retain
  departure/return invalidation. Ordinary Ghostty text fields use Ctrl+V. A canvas
  only supports terminal paste dispatch: never invent caret, protected-input,
  read-only-mode or content-receipt assurance, and never use an app/window-only fallback.
- Suggestion focus may resolve to its editable controller only through bounded,
  reciprocal POPUP_FOR/CONTROLLER_FOR relations, fresh focus, same process and
  active-window ancestry. Settle owner loss only within the drained event batch;
  real field departures and roundtrips must invalidate the destination. Cold
  lookup may follow the same verified popup-owner route; never skip its fresh
  active-window ancestry check.
- Focused WebKit wrappers are search roots, not editable carets. Continue bounded
  discovery to a freshly focused input; retain password and unfocused-child rejection.
- Cold discovery prioritizes cached focus/visibility across its bounded queue so
  hidden popup subtrees cannot starve a visible field. Those flags only order
  searches: fresh state, ancestry and caret validation still govern admission.
  Preserve the 128-object discovery budget and the 800 ms helper deadline.
- Revalidate destination and shortcut scope after clipboard preparation and before
  keyboard dispatch. Rejection there records the changed clipboard and sends no
  keys. This is a narrower race window, not atomic ownership during a key gesture.
- Closing or navigating an enabled browser tab, or losing its native connection,
  stops that tab's active recording. Ordinary field focus loss revokes delivery
  but preserves the original session's explicit Stop; stale tokens cannot stop
  a newer session.
- Drain accessibility window-transition events within bounded work and time. Never
  bind through a partially drained queue; cover ordinary GNOME setup backlogs.
- Logs are optional, private and bounded. No dictated text, audio, clipboard values,
  URLs or window titles in performance logs. Reject unsafe log/socket targets.

## Working practices

Inspect first, make a concrete plan, and change only what the task requires.
Preserve unrelated dirty worktrees and frozen evidence. User instructions authorize
product changes; otherwise discuss significant behavior, security, privacy or stack
tradeoffs first. Do not add dependencies without a concrete need.

Keep product docs concise and written for people using VOCO. Release/test history
belongs in scoped records, not the README. Update setup, operation, architecture and
agent guidance whenever behavior changes. Historical tests retain dates and scope.

## Validation

Run focused checks first, then the relevant wider gates:

```bash
npm run verify:versions
npm run check
npm run lint
npm test
npm run test:dictation-renderer
npm run test:microphone-renderer
npm run test:native-capture-renderer
npm run test:chromium-exact-field
npm run test:rich-editor-delivery
npm run test:application-delivery
python3 scripts/verify-glib-backport.py
python3 scripts/test-glib-variant.py --output /tmp/voco-glib-check
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
npm run build
```

Use isolated audio, input, clipboard and desktop fixtures. Do not inject test
speech into a live user session. Python worker tests require NumPy and psutil;
protocol tests also require the pinned model/runtime. Record unavailable checks
as unavailable, never passed. Preserve failures and attempted-trial denominators.

For optimization work follow [the TypeSafe evaluation protocol](docs/testing/typesafe-evaluation.md).
Keep deterministic timing/accuracy separate from optional semantic judgments. The
TypeSafe client is research tooling only: explicit public/synthetic text, never
personal speech or live delivery. Preserve baseline/candidate identities, missing
measurements and rejected experiments; run `npm run test:dictation-evaluation`.

Source excludes model weights and compiled runtime payloads. Follow
[runtime provisioning](docs/linux-packaging.md#runtime-provisioning); never replace
missing pinned artifacts with mutable downloads. A base Tauri `.deb` is incomplete:
assemble and verify the NVIDIA payload before calling it installable.

For Crabbox, run `crabbox doctor` first. `local-container` provides local userspace
isolation, not a remote VM or proof of a distribution's default desktop.

## Release and evidence

Source version: **2026.0.56**. Recorded public Ubuntu/Debian version: **2026.0.56**. Verify the current public release on GitHub and
installed version from the package manager; do not infer either from source.
The .43 package and desktop evidence is recorded in
[the support matrix](docs/linux-support.md); preserve per-artifact receipts and
complete signatures, final CI and downloaded-asset verification before publication. Publication status is authoritative on GitHub Releases;
a version in source alone is not proof of a published or installed package.
Frozen .39 and earlier cuts remain immutable. New product bytes need a new version,
fresh checks and artifact receipts.

Pass all CI gates, including the pinned Nemotron accuracy and continuity checks. No waiver is authorized. Keep a
clean commit, exact package/source hashes, licenses, checksums and release notes.
The hosted Release workflow must not assemble NVIDIA installers. Userspace checks,
native install/remove, physical audio and compositor/application behavior are
distinct evidence levels. Never claim fastest, most accurate, universal
compatibility or stability from a limited test corpus.

Native packages share the qualified application/model, but use explicit distro
dependency mappings, including the native package for `notify-send`. Keep RPM licenses installed under nodocs policies. Companion
SentencePiece recipes must use SPM_BUILD_TEST and fail when no tests run.
Document modifier-independent Hyprland bindings or explicitly checked Ctrl/Shift
variants on other compositors; do not silently overwrite desktop shortcuts.
Browser qualification must keep diagnostic DOM logging separate from latency
measurements: repeatedly copying a growing transcript can stall the recipient.
The control CLI connects once to the owner-only socket; do not add retries or
launch/focus side effects. It does not prove a compositor keybinding exists.
The .43 candidate uses native capture on Wayland and WebKit capture on X11.
The Wayland change is approved and has installed-VM evidence. Keep
automatic default microphone selection on explicit Start test/recording actions
when no approved microphone is selected,
with no idle recording or silent device switching during capture. Onboarding
uses the production recognition queue with local-only transcript output. Never
acquire an external text destination, shortcut lease, clipboard or preedit output
for the onboarding test. Finish must flush capture and recognition successfully.
Check desktop input prerequisites without binding an external target or sending
keys; a missing cursor inside onboarding is expected. Only then save completion.
Done returns directly to the hidden tray surface without presenting or focusing a
Ready window. A delivery interruption disables insertion but leaves healthy
recognition running through Stop. Retained recovery notifies without presenting a
window; explicit review/retry remains in the requested panel.
The guided installer must use APT to install the local package and explicitly require
the Wayland client and daemon on Wayland. Successful package installation alone is
not desktop readiness. After successful setup, request one detached launch as the
invoking desktop user; never launch a GUI from root or package hooks. Distinguish
launch request from readiness and retain manual guidance when launching fails.
Require a verified editable caret or the qualified Ghostty terminal-surface route
before cursor dictation. A destination rejection must preserve microphone readiness;
only a capture-stage failure may invalidate it. Native capture permits real window hiding. Preserve the
failed WebKit hidden-start experiment and independently verify audio retention.
The debug audit needs all three explicit flags and completed private bundles;
wait for their COMMIT receipts before terminating an audited test process.

The [20 September refresh](docs/testing/linux-release-2026-09-20.md) distinguishes
exact refreshed-binary package/smoke checks from the prior engine build's long and
recovery evidence. Preserve both identities; documentation-only edits do not require
rebuilding the qualified application. Bundled docs retain their assembly snapshot.

## Public benchmark assets

The [release-assets index](docs/release-assets/README.md) links GitHub-rendered galleries.
Keep each metric tied to its original corpus, configuration, aggregation and date;
never fill missing scores using another cohort or count failed trials as completed.
When editing a collection, verify its numeric exports, relative links and checksums.
Public assets contain numeric summaries only; keep personal audio, transcripts and
private raw evidence outside the repository. Historical media does not requalify a release.

The recorded public installer version is `packaging/published-release.json`. Keep
README pinned to that version until publication is verified, then update both.
The guided installer checks `/usr/bin/voco`, not an older PATH override. Bundle the GNOME 46 panel in the complete Debian candidate. Enable it only through
the explicit user-run setup flow; never change enabled extensions in package hooks.
Keep session restart feedback distinct from active presentation. Preserve immutable
tray PNG paths for the process lifetime and explicit Stop actions. Preserve screenshot proof outside build caches.
