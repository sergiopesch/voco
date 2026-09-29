# VOCO code map

This is the reading path for humans and agents working on the Linux dictation
application. Names containing `benchmark` are historical: the files below run in the
production NVIDIA path. A research adapter's presence does not make it a supported
user-selectable model.

## Installer presentation

`install` remains a standalone Bash download. `scripts/lib/install-ui.sh` owns
bounded terminal rendering and the optional APT wrapper;
`scripts/lib/install-apt-ui.py` observes separate status/output streams using only
Python's standard library. `scripts/lib/install-brand.json` owns the shared terminal glyphs and palette.
`scripts/sync-installer-ui.py` generates the brand constants in both renderers and
embeds them into `install`; run it after editing the brand or either source. `--check` is part of the DevOps gate. Shared
installation/readiness behavior stays in `scripts/lib/install-common.sh`, with
its existing exact-copy check. Presentation never owns package success or readiness.
See the [performance report](../testing/installer-performance-2026-09-22.md) for
the bounded tests, benchmark and disposable-container APT prompt check.

## Before recording

Backend startup warms the bundled Nemotron worker. Readiness requires its successful
model load and warmup; importing the queue does not start inference. The same
recognizer serves desktop, browser and onboarding sessions. See
[startup](README.md#startup-and-recognizer-selection).

## Follow one recording

1. `apps/desktop/src/App.tsx` mounts the thin UI and dictation hook. The store in
   `src/store/useStore.ts` represents preferences and visible state; it does not
   own native input authority.
2. `src/hooks/useDictation.ts` wires capture and explicit recovery. Start/Stop/Cancel
   and shortcut boundaries live in `src/lib/dictationRecording.ts`. Capture admission
   keeps unverified ScriptProcessor input out of automatic delivery.
   `desktopCaptureTail.ts` retains each source sample and forwards the Stop tail once.
   `browserStreamDelivery.ts` separately owns an explicit browser field lease,
   verifies each append receipt and never retries uncertain output. Tab departure or
   native connection loss stops that browser recording; ordinary field focus loss
   revokes its recipient without discarding the session's Stop control.
3. `src/lib/benchmarkPhraseQueue.ts` serializes bounded NVIDIA requests. Recording
   capture continues while a paste is in flight. A newer append-only hypothesis
   can supersede pending output; already dispatched text cannot be blindly replayed.
   A `no-mutation` paste typed nothing, so its text stays pending for the next
   hypothesis or bounded Stop retries. An uncertain or rejected paste disables
   insertion while recognition continues through Stop, which copies the
   undelivered remainder to the clipboard and notifies; if that copy fails,
   `CrashJournal.keep` moves the session's text into Review. A Chromium
   exact-field session whose field stopped taking text ends the same way. Recognition/transport
   failure still stops queue admission. Handled cursor failures notify, clear
   text/audio at Stop and return to a nonblocking idle state. Onboarding retains
   its local test retry path.
   The worker owns acoustic boundaries, so this path needs no second phrase segmenter.
4. `src-tauri/src/benchmark_stream.rs` supervises one local Python process, frames
   bounded JSON, checks session/sequence responses and reaps failures. Start/warmup
   may replace a confirmed-dead idle worker. Push/finish may never restart and replay.
   It moves audio requests into the I/O channel while retaining only bounded
   diagnostic and response-identity fields.
5. `runtime/speech/stream_worker.py` enters `worker_main.py`, which keeps native-library
   stdout away from protocol stdout and validates identity/sequence/operation and emits sanitized
   metadata. `streaming.py` owns the sample gate and streaming lifecycle;
   `adapters.py::Nemotron` owns native recognizer/stream/result handles.
6. `src-tauri/src/insertion.rs` copies each chunk to CLIPBOARD and PRIMARY, then
   sends Shift+Insert to whatever has keyboard focus. A successful key command is
   not proof that a recipient displayed the text.
7. At Stop, the hook drains capture, forwards only retained samples not yet offered
   to the queue, then finishes recognition and pending delivery. Successful cursor
   dictation clears all transcript/audio state. `crashRecovery.ts` serializes text-only
   checkpoints to `src-tauri/src/crash_recovery.rs`, which owns private atomic files
   under the user's state directory. Clean completion removes the active checkpoint;
   startup promotes an unfinished prior checkpoint into Review, and
   `keep_crash_journal` does the same for a Stop that could neither paste nor copy. No audio
   is persisted. `CrashReview.tsx` opens only on explicit `voco:open-review`, with
   copy and discard but no delivery/retranscription action. Cancelled or old callbacks
   cannot update a replacement session.

Paths in steps 2–7 are relative to `apps/desktop` unless prefixed with `runtime/`.
See [architecture](README.md) and [desktop paste](../testing/desktop-paste.md)
for delivery and recipient limitations.

## Component ownership

There is one production recognition queue, `BenchmarkPhraseQueue`. Its latest
accepted hypothesis and successfully dispatched prefix are different facts: a
slow or rejected paste must not stop healthy recognition or cause a replay.
`DesktopPhraseQueue`, its preview/segmentation helpers and `liveCommitPolicy` were
unused legacy implementations and have been removed. The pinned historical code
guide retains its original source snapshot.

| Transcript fact | Owner |
| --- | --- |
| Completed native phrases and current recognizer output | `runtime/speech/adapters.py::Nemotron` |
| Accepted append-only hypothesis and dispatched prefix | `benchmarkPhraseQueue.ts` |
| Paste dispatch, or exact-field receipt for explicit browser delivery | Native insertion or explicit browser delivery |
| Visible transcript and retained recovery | Dictation hook/store, mirroring recognition |

Do not merge these facts into one success flag. IBus owns shortcut authority,
not text delivery. Future personalisation is a [separate gated plan](personalisation-plan.md),
not another live recognizer or queue.

| Area | Implementation | Responsibility / constraint |
| --- | --- | --- |
| App orchestration and native IPC | `apps/desktop/src-tauri/src/lib.rs` | Command registration, startup, model readiness, cursor delivery and shared limits. Keep platform authority in Rust. |
| UI | `apps/desktop/src/components/`, `src/store/` | Tray-associated controls, status, setup and recovery. No model inference or OS simulation in React. |
| Capture | `apps/desktop/src/lib/audioInput.ts`, `audioCaptureBuffer.ts`, `audioCaptureFlush.ts`, `nativeCapture.ts`; `src-tauri/src/native_capture/` | The .43 candidate selects native capture on Wayland and browser capture on X11. The .44 candidate resolves and grants the default source on an explicit Start Test/recording action; manual selection remains available in settings. Preserve sample ownership and drain ordering. |
| Desktop capture tail | `src/lib/desktopCaptureTail.ts` | Append-only sample accounting and Stop-tail forwarding into the NVIDIA queue. Do not recopy an already streamed recording. |
| Speech runtime | `runtime/speech/` | Selected pinned CPU runtime, bounded local protocol, content-free metrics. Model/native artifacts are provisioned separately from Git. |
| Desktop paste | `src-tauri/src/insertion.rs` | One Shift+Insert gesture into whatever has focus, bounded helpers, no uncertain automatic retry. |
| Desktop input service | `src-tauri/src/desktop_input_setup.rs`, `packaging/ydotool/`, `vendor/ydotool-legacy/` | One installed system client; exact legacy identity selects the private daemon. Only the installed Wayland app can migrate its unmodified service while holding the single-instance guard. No package-hook session mutation. |
| Desktop notifications | `src-tauri/src/desktop_notifications.rs` | Retain the session D-Bus sender for VOCO's lifetime so GNOME can display registered-app notifications. Use the VOCO icon, normal desktop notification policy, bounded requests and finite error events; service acceptance does not prove banner visibility. |
| Shortcuts | `src-tauri/src/hotkey_state.rs`, `shortcut_arbitration.rs`, `shortcut_readiness.rs`, `owned_preedit.rs` and IBus resources | Admit one trigger. The optional IBus component does not authorize generic text mutation or switch the owner's input source. |
| Shortcut arbitration | `src-tauri/src/shortcut_arbitration.rs`; registration/readiness and `suppress_passive_shortcut` in `lib.rs` | Completed IBus authority controls registration. Passive evdev also guards pending polls; an already-consuming X11 callback keeps shared debounce without that passive suppression. X11 global callbacks admit a matched press/release pair on release, after the temporary root keyboard grab; stale bindings and backend changes cancel the pending pair. |
| X11 actor wakeup | `vendor/global-hotkey/src/platform_impl/x11/{mod.rs,wake.rs}` | Wait on X fd and queued-command signal; drain buffered events before sleeping. No 50 ms periodic idle wakeup. Preserve error health. Paths are repository-relative. |
| Renderer replacement | `src-tauri/src/lib.rs` PageLoad Started, `crash_recovery.rs` | Increment the renderer epoch so the previous renderer's journal writes become stale, and clear owned preedit before the replacement renderer starts. |
| Explicit browser field | `integrations/chromium/`, `src-tauri/src/browser_{broker,protocol,socket}.rs`, `src-tauri/src/bin/voco-browser-host.rs` | Explicit tab/field authorization, private same-user transport, ordered bounded receipts. Separate from ordinary desktop paste. |
| Audio transport | `src-tauri/src/audio_transport.rs`, `native_capture_commands.rs` | Validate binary headers, sample counts and finite values before decoding or retaining. |
| Config and process lifecycle | `src-tauri/src/config.rs`, `single_instance.rs`, `trigger_socket.rs`, `process_runner.rs` | Private state, exclusive process ownership, bounded helper execution and reaping. |
| Diagnostics | `src-tauri/src/performance.rs`, `runtime/speech/streaming.py::Metrics`, `scripts/report-*.py` | Bounded local logs; failures cannot stall dictation. Reports distinguish successful events, failures and unavailable evidence. |
| Read-only setup checks | `src-tauri/src/main.rs`, `lib.rs` | `--check-desktop-input` verifies input prerequisites; `--check-panel` checks the GNOME companion. Neither records, changes the clipboard or sends keys. |
| Build/package | `scripts/build-desktop.sh`, `package-nvidia.py`, `verify-deb-package.sh`, `verify-speech-payload.py`, `packaging/` | Build matching application/host; require pinned complete payload; validate before publishing an artifact. |
| Quality evidence | `scripts/test-*`, `scripts/dictation-quality*`, `tests/fixtures/`, `docs/testing/` | Tests/reports, not application features. Keep public fixtures separate from private owner recordings. |

Unprefixed `src-tauri/` and `src/` paths in the table are under `apps/desktop/`.
The repository also contains package-channel experiments, static brand assets,
vendored native dependencies and historical specifications. Follow current release
gates; a draft file is not evidence that its channel or feature is shipped.

## GNOME panel presentation

`integrations/gnome/` contains the GNOME 46 panel extension, bundled in the Debian package.
`src-tauri/src/panel.rs` owns its leased session-bus connection; `tray.rs` derives
state from the same authoritative snapshot as the native tray. `App.tsx` forwards
only the normalized meter level during recording. No transcript or audio samples
are sent to the panel. See the [integration contract](../../integrations/gnome/README.md).

## Where to put a change

Keep changes in the component that owns the invariant. Do not add parallel frontend
state for a fact already owned by the queue or worker. Before deleting apparently
unused code, check the browser delivery and gated capture routes.
Avoid changing model, context, thread count or gate parameters without matched
accuracy and latency evidence. Do not equate fewer lines with less runtime work.

Comments should explain boundaries, ordering, ownership and reasons a simpler-looking
alternative is unsafe. Name the current behavior directly; avoid narrating obvious
syntax or leaving obsolete migration stories. Tests should exercise consequences:
Stop-tail retention, late callbacks, worker recovery, malformed transport, protected
files and uncertain delivery. Preserve original failing evidence and rerun into a
fresh output directory after a fix.

## Verification path

Run focused regression tests for changed components, then typecheck, lint, full
frontend/Python tests, Rust tests/Clippy and production package verification. For
release candidates run the exact packaged binary with a private virtual microphone,
controlled destination and independent field readback. Distribution userspace,
package-manager integration and actual compositor/physical-device tests are separate
coverage levels. See [testing](../testing/README.md), [packaging](../linux-packaging.md)
and [release gates](../release-candidate.md).
The current strict Stop matrix selects 34 passing cases from 35 attempts; preserve
its excluded coverage-precondition failure and exact fixture identities. Final
Debian/RPM/Arch qualification uses external per-artifact install/parity/remove
receipts, including executable/runtime parity with validation C. Packaged source
docs describe the contract; they do not contain a self-referential package hash.
For userspace fixtures, assert the route actually owning the shortcut: Ubuntu/Debian
used root X11 restoration; Fedora/Mint/Omarchy used verified IBus retriggering.
All five selected cases passed from eight attempts. An inappropriate universal
root-binding assertion is a fixture failure, not proof an IBus shortcut is broken.

Native Fedora/Arch candidate metadata is generated by `scripts/stage-native-packages.py`;
`scripts/test-native-staging.py` checks translation boundaries and
`scripts/verify-native-install.py` verifies exact payload identity inside disposable containers.
These do not change the recognition or delivery pipeline.

The glib 0.18.5 dependency is pinned under `vendor/glib` with an upstream iterator
safety backport. `verify-glib-backport.py` checks its full source and resolution;
`test-glib-variant.py` runs the optimized regression without launching the app.

The .43 candidate adds `voco --toggle` in `src-tauri/src/main.rs`, calling the
existing owner-only trigger transport. It uses one nonblocking connection; no
retry, GUI startup or recording-state acknowledgment is implied. Native packaging
selects Fedora/openSUSE dependency profiles explicitly and preserves license files
when RPM excludes ordinary documentation. See [Linux support](../linux-support.md).

### Onboarding recognition

`Onboarding.tsx` presents the default devices, input meter and test transcript.
The `onboarding:test` trigger reuses `dictationRecording.ts` and
`BenchmarkPhraseQueue` with an output callback that never touches another app.
Capture and final recognition must complete before onboarding is saved.
VOCO then calls `get_desktop_input_status`: a fresh, bounded input-helper
check with no key injection or clipboard mutation. For Alt+D and Alt+Shift+D on
GNOME Wayland, a missing or outdated companion adds a recommendation
(`setupArea: "panel"`) but never blocks: without it, the focused app also
receives the shortcut. `get_desktop_paste_status` reports the same recording
prerequisites when normal dictation begins; each paste then targets whatever has
focus. `voco --check-desktop-input` checks input helpers only, without launching
the GUI.

Setup failures happen before capture. They preserve the approved microphone's
readiness; only an attempted capture startup can invalidate it, with the existing
native generation/selection ownership checks.

### Desktop paste

`insertion.rs::desktop_paste` copies each chunk to CLIPBOARD, then PRIMARY (best
effort), and sends one Shift+Insert gesture to whatever has keyboard focus. A
single leading joining space is its own Space key, and ASCII controls become
spaces, so no chunk can press Enter. On Wayland it first waits at most 1.5 seconds
for released shortcut modifiers, from evdev or the GNOME companion's
`ModifiersClear`; unknown state does not block and a timeout sends no keys.
`copy_desktop_text` sets both selections without keys for the Stop remainder.
[Desktop paste](../testing/desktop-paste.md) describes the X11 application and
Chromium suites. The dated [application matrix](../testing/application-delivery-2026-09-22.md)
records the retired focus-verified route.

### Transcript diagnostics and microphone feedback

`benchmarkPhraseQueue.ts::textLengths` counts UTF-16 units, UTF-8 bytes and Unicode
scalars without temporary full-transcript arrays. Quality fields are evaluated
only when diagnostics are enabled and admitted by the existing bounded queue.
`audioLevel.ts` maps centered RMS into a visual speech range; this never changes
captured samples, recognition gain or model parameters. The same signal display
serves onboarding and recording, preserving system motion/contrast preferences.

### Panel setup and launcher handoff (.50)

`panel_setup.rs` supervises the bounded `voco_gnome_panel.py` helper. Read-only
checks distinguish missing, disabled, blocked, active and pending session restart.
Only an explicit setup command changes this extension's activation; Debian hooks
never change a user profile. `PanelSetup.tsx` presents the same result in setup/Help.

`activation.rs` owns a separate private launcher socket; connections cannot toggle
capture. Pending activation survives renderer initialization, then `App.tsx`
presents idle UI through the existing guarded window transition. Starting,
recording and processing refuse activation focus changes. The legacy `--toggle`
transport retains its single-attempt contract.

`tray_icons.rs` retains four state PNGs and 64 pre-rendered audio-meter PNGs in a
private process directory. Worker updates release the state lock before dispatching
GTK presentation on the main thread, so Shell requests cannot deadlock with it.
A recording-only GLib timer smooths measured volume
with a fast attack and short release, selects an existing frame, and stops at the
recording boundary. Stale samples settle to silence; reduced motion uses direct
level changes. No audio update writes another image or opens a window.
The additive vendored tray-icon path API selects these without deleting older
advertised paths. `tray.rs` suppresses equivalent presentation updates and exposes
a menu status row; its adjacent label appears only for startup and setup problems
and clears while dictating, so starting or stopping dictation from Ready never
resizes the icon. State-token publication stays
independent from native icon deduplication. Native Stop uses an explicit stop action.

Onboarding swaps microphone selection into the existing setup canvas rather than
stacking the form above the test. A successful explicit selection returns to the
test; failed grants remain visible. Long device lists scroll only inside their
selector, while setup controls fit the supported desktop canvas.
