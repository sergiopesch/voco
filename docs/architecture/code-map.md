# Code map

This page gives one line per file or small group of files, and paths in each
section are relative to that section's directory. The [architecture overview](README.md) explains how
the parts fit together.

The production path is `runtime/speech/` → `speech_stream.rs` →
`dictationStream.ts` → `insertion.rs`.

## Desktop shell: `apps/desktop/src-tauri/src/`

- `lib.rs` — App setup and most Tauri commands: startup order (on Wayland, warming the virtual keyboard and retiring the old `voco-ydotoold.service` link), shortcut routes, `admit_toggle` and its 120 ms debounce, the evdev listener and the CLI checks.
- `main.rs` — Command-line entry point; see [Command line](#command-line).
- `speech_stream.rs` — The speech worker process and the `speech_stream` command: NDJSON requests, deadlines, size limits and restarting a dead idle worker.
- `worker_sandbox.rs` — Confines the speech worker before its Python starts: close-on-exec descriptors, no-new-privileges and a seccomp filter that refuses network sockets and io_uring.
- `insertion.rs` — Desktop paste and copy: helper and `/dev/uinput` checks, the clipboard transaction, Shift+Insert and the three failure outcomes.
- `desktop_session.rs` — Retains the originating graphical login and checks its active seat before Wayland paste, and follows its screen lock through logind's `LockedHint`; bounded logind discovery supports user-manager app launches.
- `virtual_keyboard.rs` — VOCO's uinput keyboard for Wayland paste keys: one device per process with only Shift and Insert, 12 ms between key events.
- `config.rs` — Settings file, field-level updates, the copy from the legacy `voice` directory and the update cache.
- `crash_recovery.rs` — Text-only crash journal and the Review store.
- `tray.rs` — Tray icon, menu, status line and meter animation.
- `tray_icons.rs` — Writes the state icons and 64 meter frames once, to paths that stay valid for the process lifetime, after removing the ones an earlier VOCO left behind.
- `panel.rs` — GNOME companion bridge on D-Bus (`org.voco.Panel1`), its shortcut leases and the `ModifiersClear` call.
- `panel_setup.rs` — Bounded companion check and setup; a check is reused for 20 seconds, or 2 seconds after a failure.
- `ibus_shortcut.rs` — Client for the optional IBus engine's private socket (protocol 6).
- `shortcut_arbitration.rs` — Tells confirmed IBus authority apart from an unanswered poll, and guards evdev and X11 toggles.
- `shortcut_readiness.rs` — Shortcut status observations and their text; it never registers or admits a shortcut.
- `hotkey_state.rs` — Physical key state per evdev device for the passive shortcut listener, and the count of live keyboards that shortcut status reports.
- `hotkey_trace.rs` — Opt-in shortcut timing trace, enabled with `VOCO_HOTKEY_TRACE=1`.
- `trigger_socket.rs` — Owner-only trigger socket `voco.sock`, with its `voice.sock` alias, that `voco --toggle` connects to.
- `activation.rs` — Owner-only launcher socket `voco-activate.sock`; it presents the window and never toggles capture.
- `single_instance.rs` — Process lock that allows one VOCO per user.
- `desktop_notifications.rs` — Notifications that keep their D-Bus sender for the app's lifetime, because GNOME removes notifications whose sender disappears.
- `performance.rs` — Opt-in performance metadata log, enabled with `VOCO_PERFORMANCE_LOG=1`.
- `process_runner.rs` — Bounded helper processes: timeouts, output limits and reaping.
- `digest_hex.rs` — Lowercase hex for SHA-256 digests.
- `native_capture_commands.rs` — Tauri commands for native capture, callable only from VOCO's main page.
- `native_capture/mod.rs` — Native capture manager: the capture worker, the 5 ms pump, the 5-second drain lease and retained audio.
- `native_capture/pulse.rs` — Rust side of the libpulse shim; libpulse types stay in C.
- `native_capture/protocol.rs` — Packets and acknowledgements between native capture and the renderer.
- `native_capture/audit.rs` — Opt-in, one-shot capture audit for debugging.
- `native_capture/retained.rs` — Opt-in record of the audio the renderer retained, for the same audit.
- `native_capture/private_bundle.rs` — Writes private audit bundles after capture ends.
- `native_capture/tests.rs` — Native capture unit tests.
- `browser_broker.rs` — Chromium exact-field broker: claims, sessions, appends and receipts. Only a matching receipt proves a field changed.
- `browser_event_delivery.rs` — Delivers browser Start and Stop to the renderer, so a Stop survives a briefly unresponsive renderer without turning into a toggle.
- `browser_protocol.rs` — Bounded, versioned messages shared by the broker and the native host.
- `browser_socket.rs` — Same-user transport under `$XDG_RUNTIME_DIR/voco-browser/`, and the `SO_PEERCRED` peer check that the trigger, activation and IBus sockets share.
- `bin/voco-browser-host.rs` — Chromium native messaging host that relays framed messages between the extension and VOCO.

## Renderer: `apps/desktop/src/`

### Top level

- `App.tsx` — Root component: startup, window surfaces, update checks and runtime diagnostics.
- `main.tsx` — Renderer entry point.
- `store/useStore.ts` — Zustand store for app state and the current surface.
- `types/index.ts` — Shared renderer types.
- `styles.css` — Base styles and window surfaces.
- `preferences.css` — Settings window layout.
- `motion.css` — Shared motion styles.
- `vite-env.d.ts` — Vite type references.

### Components: `components/`

- `ControlPanel.tsx` — Settings window with the Settings, Microphone, Shortcut, Updates and Help sections.
- `ControlPanel.test.tsx` — Settings guidance and controls.
- `recordedShortcuts.json` — Key presses, the shortcut **Record keys** makes of each and whether Rust accepts it; `ControlPanel.test.tsx` and `lib.rs` both check it.
- `Onboarding.tsx` — First-run voice test and desktop setup check. Its text stays in the window.
- `Onboarding.test.tsx` — Onboarding states.
- `CrashReview.tsx` — Review window: copy or discard interrupted dictations.
- `crashReview.css` — Review styles.
- `ConfigRecoveryPanel.tsx` — Shown when the settings file can't be read: Retry, Open and Reset.
- `ConfigRecoveryPanel.test.tsx` — Recovery panel actions.
- `PanelSetup.tsx` — GNOME companion status and setup button.
- `NativeMicrophoneSettings.tsx` — Microphone list for native capture.
- `DeviceSelect.tsx` — Accessible device picker.
- `VoiceSignal.tsx` — Level display for the microphone signal.
- `StatusMark.tsx` — Status glyph.
- `Tooltip.tsx` — Tooltip.
- `SettingsIcon.tsx` — Settings navigation icons.

### Hooks: `hooks/`

- `useDictation.ts` — Recording lifecycle: capture, the dictation stream, Stop, crash journal and notifications.
- `useDictation.desktopLifecycle.test.ts` — Start, Stop and cancel against a delayed paste.
- `useDictation.desktopTail.test.ts` — Stop tail accounting with deterministic capture and worker IPC.
- `useGlobalShortcut.ts` — Receives toggles and browser triggers from Rust and reports renderer readiness.
- `useNativeCaptureSettings.ts` — Native microphone list and selection.
- `useGlassPointer.ts` — Pointer highlight on buttons.
- `useGlassPointer.test.ts` — Pointer highlight.

### Library: `lib/`

- `dictationStream.ts` — `DictationStream`: 100 ms packets, one request at a time, append-only results, paste outcomes and Stop retries.
- `dictationStream.test.ts` — Append-only results, backlog limit and delivery outcomes.
- `dictationStream.startup.test.ts` — Importing the module leaves model warmup to Rust.
- `dictationRecording.ts` — Start and Stop for one recording: delivery callbacks, the Stop copy and notifications.
- `dictationRecording.test.ts` — Start and Stop ordering and cleanup.
- `desktopCaptureTail.ts` — `DictationStreamInput`, the recording sample cap, the Stop tail and capture teardown.
- `audioCaptureBuffer.ts` — In-memory audio for the current recording; `collectAudioSamplesRange` is its only reader.
- `audioCaptureBuffer.test.ts` — Buffer bounds and ranges.
- `audioCaptureFlush.ts` — AudioWorklet flush acknowledgement with an 80 ms timeout.
- `audioCaptureFlush.test.ts` — Flush acknowledgement.
- `captureHealth.ts` — WebKit capture liveness: ended track, 3-second system mute and 5-second sample gap.
- `captureHealth.test.ts` — Capture liveness.
- `captureDescriptor.ts` — Capture backend selection and the retained audio format.
- `captureDescriptor.test.ts` — Retained audio format.
- `audioInput.ts` — Opens the WebKit microphone stream and picks the device.
- `audioLevel.ts` — Level meter values for every capture path, shown in the window, the tray and the companion.
- `nativeCapture.ts` — Renderer side of native capture: sources, packets and acknowledgements.
- `nativeCapture.test.ts` — Native capture protocol and ownership.
- `nativeCaptureSettings.ts` — Native capture availability and source selection commands.
- `nativeCaptureAudit.ts` — Renderer half of the opt-in capture audit.
- `nativeCaptureAudit.test.ts` — Audit records.
- `browserStreamDelivery.ts` — Chromium exact-field delivery; a missing receipt is never retried.
- `browserStreamDelivery.test.ts` — Browser delivery and Stop.
- `crashRecovery.ts` — `CrashJournal` and the Review commands.
- `crashRecovery.test.ts` — Journal updates and failures.
- `dictationRecovery.ts` — The 600-second recording limit, the capture sample limit and error text helpers.
- `dictationRecovery.test.ts` — Recovery helpers.
- `dictationSession.ts` — Session state machine and a queued Stop.
- `dictationSession.test.ts` — Session state machine.
- `dictationTrigger.ts` — Rules for which triggers may start or stop a recording.
- `dictationTrigger.test.ts` — Browser trigger rules.
- `dictationPresentation.ts` — Status labels and desktop setup state.
- `dictationPresentation.test.ts` — Status labels.
- `activityMode.ts` — Whether dictation is active and whether a toggle is allowed.
- `activityMode.test.ts` — Activity rules.
- `shortcutPresentation.ts` — Shortcut and microphone labels, and time limits for diagnostics requests.
- `shortcutPresentation.test.ts` — Presentation helpers.
- `microphoneRefresh.ts` — Orders device list refreshes against explicit access requests.
- `microphoneRefresh.test.ts` — Refresh ordering.
- `configSnapshot.ts` — When to apply a settings snapshot from Rust.
- `configSnapshot.test.ts` — Snapshot rules.
- `updates.ts` — GitHub release check, version comparison and the update cache.
- `updates.test.ts` — Versions and channel selection.
- `updateCheckCoordinator.ts` — Runs update checks, keeps only the latest request's result and notifies about a new release.
- `updateCheckCoordinator.test.ts` — Coordinator behaviour.
- `windowRemap.ts` — Shows interactive windows on Wayland without treating the remap as a blur.
- `windowRemap.test.ts` — Window remap.
- `popoverPlacement.ts` — Places the popover inside the work area, centred, because the tray never reports where its icon is.
- `popoverPlacement.test.ts` — Placement.
- `animationFrameLease.ts` — Shared animation-frame scheduling.
- `animationFrameLease.test.ts` — Frame scheduling.
- `tauri.ts` — Typed wrappers for Tauri commands.

### Tests: `__tests__/`

- `audioInput.test.ts` — Microphone device selection.
- `audioLevel.test.ts` — Companion level updates.
- `globalShortcutReadiness.test.ts` — Shortcut readiness handshake.
- `nativeIpcCsp.test.ts` — The content security policy allows Tauri's native IPC.
- `store.test.ts` — Store behaviour.
- `windowSurfacePermissions.test.ts` — Window capabilities grant only the window commands VOCO uses.

## Desktop build and resources: `apps/desktop/`

- `package.json` — Workspace scripts: `dev`, `dev:frontend`, `build`, `build:frontend`, `check`, `lint` and `test`.
- `index.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js` — Renderer build and lint configuration.
- `public/audio-processor.js` — AudioWorklet that captures WebKit audio on X11 and confirms each flush.
- `public/tray/*.png` — Tray state icons.
- `public/icons/`, `public/textures/`, `public/favicon.png` — Interface icons and textures, with their licences.
- `tests/brand-motion.html`, `tests/brand-motion.tsx` — Isolated presentation fixture for the motion test.
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` — Rust dependencies. `native-capture` is the default feature, and `[patch.crates-io]` points glib, global-hotkey and tray-icon at `vendor/`.
- `src-tauri/build.rs` — Compiles the libpulse shim when `native-capture` is on.
- `src-tauri/native/native_capture_pulse.c`, `.h` — C shim that owns the libpulse record stream.
- `src-tauri/tauri.conf.json` — Window, bundle and content security policy settings.
- `src-tauri/capabilities/default.json` — Tauri permissions for the main window.
- `src-tauri/resources/voco_ibus_engine.py` — The IBus engine that takes the dictation shortcut.
- `src-tauri/resources/voco_ibus_protocol.py` — The engine's private socket protocol.
- `src-tauri/resources/voco_ibus_engine_test.py`, `voco_ibus_protocol_test.py` — Engine and protocol tests.
- `src-tauri/resources/voco_gnome_panel.py` — Companion check and setup through GNOME Shell's D-Bus API.
- `src-tauri/tests/glib_variant_iter.rs` — Regression test for the glib variant iterator fix.
- `src-tauri/tests/desktop_notifications/mod.rs` — Notification tests on a private bus.
- `src-tauri/examples/browser_broker_fixture.rs` — Test-only broker driver, never packaged.
- `src-tauri/icons/*` — Application icons.

## Speech worker: `runtime/speech/`

- `stream_worker.py` — Worker entry point; keeps native library output away from the JSON protocol.
- `worker_main.py` — Protocol loop: ready line, request size limit, default thread count and request dispatch.
- `streaming.py` — Streaming session: sample-rate checks, silence gate, frame batching and the opt-in timing log.
- `adapters.py` — Loads the native library and the model, and checks the model's SHA-256.
- `nemo_bridge.cpp` — C++ bridge between the worker and NeMo-Speech.cpp.
- `MODEL-IDENTITY.json` — Model source, revision, hash and CPU requirement.
- `NATIVE-BUILD.json` — Build receipt for the pinned native library.
- `test_cpu_threads.py` — Default thread count.
- `test_diagnostics.py` — Protocol framing, diagnostics and private metrics logs.
- `test_model_identity.py` — The model integrity check, the worker's native revision and the NVIDIA notice match the pinned identity files.
- `test_streaming.py` — Silence gate accounting and log privacy.
- `test_timing.py` — Timing instrumentation keeps sample order and transcripts.
- `test_worker_protocol.py` — Protocol and lifecycle checks against the real model.

## Native runtime and notices: `runtime/`

- `native/build.py` — Builds the pinned, patched NeMo-Speech.cpp libraries and the bridge.
- `native/README.md` — [Native runtime guide](../../runtime/native/README.md): what ships, the patches and how to rebuild.
- `native/first-chunk.patch`, `native/thread-pool.patch` — Patches applied to the pinned upstream source.
- `notices/*` — Licences and notices for the model, ggml and third-party code.

## GNOME companion: `integrations/gnome/`

- `voco-panel@voco.local/extension.js` — Panel pill, meter, menu, shortcut grab and the D-Bus client.
- `voco-panel@voco.local/model.js` — Presentation model shared with the Node tests.
- `voco-panel@voco.local/metadata.json` — Extension metadata for GNOME Shell 46, 48 and 50.
- `voco-panel@voco.local/stylesheet.css` — Pill and meter styles.
- `voco-panel@voco.local/voco-symbol.png` — Microphone symbol.
- `package.json` — Marks the directory as ES modules for the tests.
- `README.md` — [Companion guide](../../integrations/gnome/README.md).

## Chromium extension: `integrations/chromium/`

- `manifest.json` — Manifest V3 extension "VOCO Exact Field".
- `background.js` — Toolbar action, per-tab enablement and the native messaging port.
- `content.js` — Field eligibility, `Alt+Shift+V`, appends and receipts.
- `README.md` — [Extension guide](../../integrations/chromium/README.md).

## Packaging: `packaging/`

- `udev/70-voco-uinput.rules` — The `uaccess` rule that gives the user of the active local session access to `/dev/uinput`.
- `udev/voco-uinput.conf` — Loads the `uinput` module at boot, from `/usr/lib/modules-load.d/`.
- `ibus/voco.xml`, `ibus/voco-ibus-engine` — IBus component and engine launcher.
- `chromium/com.voco.exact_field.json` — Native messaging host manifest.
- `tauri/VOCO.desktop`, `tauri/com.sergiopesch.voco.metainfo.xml` — Desktop entry and AppStream metadata.
- `debian/postinst.py.in` — The Debian package's only maintainer action: repairs group-writable VOCO directories to 0755 and applies the `/dev/uinput` rule.
- `rpm/voco.spec.in` — The Fedora RPM's spec template: the Fedora requirements, no build stages, and the payload and dependency-generator settings.
- `rpm/post.sh` — The RPM's only scriptlet: applies the `/dev/uinput` rule, as the Debian `postinst` does.
- `published-release.json` — The version the README installs.

## Scripts: `scripts/`

### Build and packaging

- `setup.sh` — Prepares a development checkout; `--install` builds, packages and installs the complete Debian package.
- `build-desktop.sh` — Builds the renderer, the browser host and the base Debian bundle.
- `package-nvidia.py` — Turns the base package into the complete one: speech runtime, notices, documentation and the maintainer script. With `--rpm`, it also builds the Fedora RPM from the same staged tree.
- `rpm_package.py` — Renders the RPM spec for the staged tree and runs rpmbuild, and holds the RPM checks: scriptlets, folder ownership, requirements, and file and dependency parity with the Debian package.
- `package-gnome-panel.py` — Builds a reproducible companion zip.
- `provision-ci-speech.sh` — Copies the speech payload of a checksum-pinned published package into `runtime/speech/` for CI.
- `debian_maintainer.py` — Generates and checks the maintainer script.
- `sync-installer-ui.py`, `lib/install-ui.sh`, `lib/install-apt-ui.py`, `lib/install-brand.json` — Installer interface sources, and the script that embeds them and the install steps in `install`.
- `lib/install-common.sh` — Install steps that `setup.sh --install` sources and `sync-installer-ui.py` embeds in `install`: package manager detection, the glibc and processor check, the APT and DNF installs and their checks, and the desktop input check. `test-install-common.sh` tests them.
- `lib/test-speech-runtime.sh` — Speech runtime setup for disposable test desktops.
- `lib/browser-app-sandbox.sh` — The private desktop the two Chromium application launchers share.
- `lib/test-sandbox.sh` — `voco_bwrap`, the Bubblewrap namespace the CI desktop suites run in.
- `lib/uinput-bridge.sh` — Starts and stops the uinput bridge for disposable test desktops.

### Checks

- `test-unit.sh` — `npm test`: fast checks that need no microphone, speech model or desktop session.
- `check-devops.sh`, `check-shell-syntax.sh`, `check-version-consistency.mjs` — Repository, shell and version checks.
- `verify-deb-package.sh`, `verify-speech-payload.py` — Package contents.
- `verify-rpm-package.sh` — The RPM's contents and policy; given the Debian package, it also proves that both carry the same files and dependencies.
- `distro-dependencies.py` — Prints the packages' dependencies by Debian or Fedora names, for CI's Debian 13 and Fedora 44 runtime jobs.
- `verify-speech-engine.py` — Checks that shipping source and dependency metadata don't reference the retired Whisper recognizer.
- `verify-glib-backport.py`, `verify-shortcut-backport.py`, `verify-tray-backport.py` — Vendored crate provenance and resolution.
- `verify-native-capture-audit.py` — Checks a capture audit bundle.

### Release

- `assemble-release.sh` — Builds the Debian package and the RPM, verifies them and signs one release from a signed tag on the maintainer's Linux computer. It uploads nothing.
- `sign-release-checksums.sh` — Detached, armored signatures for checksum lists, on the maintainer's computer.
- `verify-release.sh` — Offline checksum and signature verification.
- `test-verify-release.sh` — Signs and verifies with a throwaway key.
- `rehearse-release.sh`, `render-release-body.sh` — Local release checks, and the GitHub release notes.

### Speech evaluation

- `test-speech-baseline.mjs` — Accuracy and continuity gate on the public corpus.
- `evaluate-dictation-worker.py` — Replays the public fixtures through the worker with chosen settings.
- `speech-score.mjs`, `speech-integrity.mjs`, `score-dictation-worker.mjs` — Word error rate and integrity scoring.
- `dictation-quality.mjs`, `dictation-quality-cli.mjs`, `comparative-dictation.mjs` — Extra quality metrics and comparisons.
- `test-speech-continuity.mjs`, `audio_continuity.py` — Continuity checks for lost audio.
- `browser-long-accuracy.mjs`, `browser-capture-lifecycle.mjs` — Long-recording helpers for the browser tests.
- `speech_worker.py` — Bounded JSON framing for evaluation workers.
- `typesafe-evaluate.py` — Research tooling; see the [evaluation protocol](../testing/typesafe-evaluation.md).
- `*.test.mjs` next to these files — Their unit tests.

### Reports

- `report-performance.py`, `report-speech-performance.py`, `report-dictation-quality-events.py`, `report-typesafe-evaluation.py`, `report-linux-runtime.sh` — Summaries of the opt-in logs and runtime state.

### Desktop and integration tests

- `test-private-ibus-engine-hosted.sh` — Entry point for the private desktop suites in CI.
- `test-private-ibus-engine.py`, `test-private-ibus-engine.sh` — IBus engine on a headless IBus daemon.
- `test-gnome-panel.py`, `test-gnome-panel.sh`, `test-panel-model.mjs`, `test-panel-setup.py` — GNOME companion.
- `test-application-delivery.py`, `test-application-delivery.sh` — Paste into real applications on a private desktop.
- `test-browser-delivery.mjs`, `test-browser-full-app.mjs`, `test-browser-full-app.sh`, `test-browser-toolbar-app.mjs`, `test-browser-toolbar-app.sh`, `test-browser-toolbar-action.py`, `browser-app-harness.mjs` — Chromium paste, exact field and toolbar.
- `test-chromium-exact-field.mjs`, `chromium-background.test.cjs`, `chromium-content-lifecycle.test.cjs` — Extension scripts.
- `test-native-desktop.py`, `test-native-desktop.sh`, `test-native-full-app.py`, `test-native-atspi.py`, `test-native-recovery-controls.py` — GTK and WebKit fields in a private X11 session.
- `test-native-wayland.py`, `test-native-wayland.sh` — Wayland toolkit and lifecycle checks.
- `test-native-gnome.py`, `test-native-gnome.sh`, `test_native_crash_review.py`, `test_native_cursor_capture.py`, `test_native_onboarding_capture.py` — The packaged app in a private GNOME session.
- `native_tray_app.py` — The tray app helpers the GNOME, KDE and Wayland suites share: readiness, the registered tray item and its menu.
- `test-native-kde.py`, `test-native-kde.sh`, `test-native-kde-identity.py` — KWin and Plasma in a private session.
- `test-native-capture-callbacks.py`, `test-native-capture-pulse-latency.py`, `native-capture-lifecycle.test.c`, `test-native-capture-renderer.mjs`, `test_verify_native_capture_audit.py` — Native capture.
- `test-dictation-renderer.mjs`, `test-microphone-app-renderer.mjs`, `renderer-fixture.mjs`, `test-brand-motion.mjs`, `audio-worklet-capture.test.mjs` — Renderer and AudioWorklet.
- `test-speech-package.py`, `test-speech-worker.py`, `test-audio-continuity.py` — Speech packaging and worker pipes.
- `test-rpm-package.py` — The RPM's file list, spec, header policy and parity checks; with rpmbuild installed, a real build.
- `test-install-apt.py`, `test-install-common.sh`, `test-install-journey.py`, `test-install-launch.py`, `test-install-performance.py`, `test-install-presentation.py` — Installer.
- `test-glib-variant.py`, `test-debian-maintainer.py`, `test-check-shell-syntax.py`, `test-report-dictation-quality-events.py`, `test-report-performance.py`, `test-report-speech-timing.py`, `test-typesafe-evaluation.py` — Other checks.
- `fixtures/*` — Test-only helpers: synthetic fields, probe extensions, a `wl-copy` and an input-state relay through the private Shell probe, and the [uinput bridge](../testing/README.md#the-uinput-bridge) that replays VOCO's virtual keyboard on a private Xvfb. None is installed.

### Brand

- `generate-icons.py`, `generate-brand-banner.py`, `prepare-brand-masters.py` — Icons, the README banner and brand masters.

## Test fixtures: `tests/`

- `fixtures/speech/*` — Public development speech corpus; see its [README](../../tests/fixtures/speech/README.md).
- `fixtures/speech/adversarial/*` — Held-out speakers; see its [README](../../tests/fixtures/speech/adversarial/README.md).
- `fixtures/installer/*` — Installer test fixtures.
- `fixtures/typesafe/calibration.json` — Synthetic calibration cases for the evaluation tooling.

## Vendored code: `vendor/`

- `glib/`, `global-hotkey/`, `tray-icon/` — Patched crates, each with a `VOCO-PATCH.md`; see [Security](../security/README.md#dependency-policy).
- `provenance/`, `README.md`, `THIRD-PARTY-NOTICES.txt` — Provenance and notices.

## Brand assets: `assets/`

- `voco-logo.png` — Square primary logo, the source of the larger app icons.
- `voco-symbol.png` — Simplified symbol, the source of icons up to 64 px.
- `voco-symbol-ui.png` — 128 px symbol that the window and the GNOME companion show.
- `voco-readme-banner.svg` — README banner, written by `scripts/generate-brand-banner.py`.
- `brand-sources/*` — Source images for the logo, the symbol and the two window textures, with notes on the textures. [Branding](../branding.md) covers their use.

## Repository root

- `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE` — Overview, agent and contributor guides, security policy, code of conduct and licence.
- `install` — Guided installer for the signed release: the Debian package with APT, or the RPM with DNF.
- `KEYS` — Release signing key.
- `package.json` — Root npm scripts, including `npm test`, `test:ibus`, `test:speech-baseline`, `verify:security` and `verify:devops`.
- `package-lock.json`, `.nvmrc` — Pinned npm dependencies, and Node 24.
- `.editorconfig`, `.gitattributes`, `.gitignore` — Editor settings, LF line endings with byte-exact vendored files and notices, and ignored paths.
- `.github/workflows/ci.yml` — CI on pull requests and pushes to the default branch.
- `.github/dependabot.yml` — Weekly Cargo, npm and GitHub Actions updates.
- `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*` — Review owner, pull request template and issue forms.
- `docs/` — Documentation; the [index](../README.md) lists every guide.

## Command line

`voco` with no arguments starts VOCO, or presents the running instance. If it
can't take its single-instance lock or reach the running instance, it prints
"VOCO could not start: …", shows a notification and exits 1.

| Option | Behaviour | Exit status |
| --- | --- | --- |
| `--toggle` | Asks the VOCO running in this session to start or stop. It doesn't launch VOCO, change focus or confirm the recording state. | 1 if VOCO's socket can't be reached |
| `--check-desktop-input` | Checks the paste prerequisites: the clipboard helper, plus `xdotool` on X11 or access to `/dev/uinput` on Wayland. It doesn't launch VOCO, create a keyboard or send keys. | 1 on failure |
| `--check-panel` | Checks the GNOME companion without changing settings. | 2 unless the companion is active, the desktop isn't GNOME, or GNOME isn't 46, 48 or 50; 1 on error |
| `--setup-panel` | Enables the packaged GNOME companion for this user, on GNOME 46, 48 or 50. It may need a sign-out and never restarts Shell. | As for `--check-panel` |
| `--version` | Prints `VOCO` and the version. | 0 |
| `--help`, `-h` | Prints usage. | 0 |

Any other argument prints "Unknown arguments. Run voco --help for usage." and
exits 2.
