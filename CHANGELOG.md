# Changelog

This file records the notable changes in each VOCO release, newest first. It
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), but VOCO doesn't
use Semantic Versioning: a version has the form `YYYY.0.N`, the year and then a
number that grows with each release, and its signed Git tag is `voco.<version>`.
The [release process](docs/release-process.md) describes how a release is made.

## [2026.0.60] - 2026-09-30

Dictation pastes into the app that has keyboard focus, and Review keeps a dictation
VOCO couldn't finish. The [release notes](docs/releases/2026.0.60.md) explain how
to upgrade.

### Added

- **Review**, in the tray menu and the GNOME panel menu. While you dictate, VOCO
  keeps a private copy of the text and deletes it when the dictation ends normally.
  After an unexpected exit, the next start lists it as an **Interrupted dictation**
  with **Copy transcript** and **Discard**. Review keeps the five most recent
  entries, takes keyboard focus when it opens, and its Copy also sets the primary
  selection.
- **Settings** in the tray menu.
- A clipboard fallback when a paste fails. VOCO shows **VOCO stopped typing** and
  keeps listening; at Stop it copies the words it didn't type, with the space that
  joins them to the rest, and says whether some may already be in the app. If the
  copy fails too, the dictation goes to Review. A Chromium field that loses focus
  keeps the words it took, and Stop copies the rest the same way.
- **Crash recovery unavailable**, once per launch, when VOCO can't keep its copy of
  the text. Dictation continues.
- On Wayland, desktop setup reports a missing `ydotoold`, so Start can name the fix.
- **Your shortcut also reached the app**, once per launch on Wayland, when Alt+D or
  Alt+Shift+D also acted in the app you were typing in. It names the fix: enable or
  reconnect the GNOME panel, or bind another shortcut to `voco --toggle`.
- `/usr/share/doc/voco/copyright` in the package: VOCO's MIT License, with a pointer
  to the runtime, model and helper notices beside it.
- A CI job, Application, that runs the release build of `voco` and
  `voco-browser-host` with the speech runtime through the GNOME panel,
  full-application, Wayland, Chromium field and toolbar suites. The delivery suites
  also run on a nested GNOME Wayland desktop, and the speech baseline checks a Stop
  packet of one sample.

### Changed

- Dictation pastes into the app that has keyboard focus. VOCO puts each phrase on
  the clipboard and the primary selection and presses Shift+Insert, with `xdotool`
  on X11 and `ydotool` on Wayland, so terminals, browsers and native text fields
  take the same path and text follows focus. A paste VOCO can't confirm stops live
  typing and is never replayed as keys.
- Before it pastes, VOCO waits up to 1.5 seconds for the shortcut's keys to be
  released, so a held Alt can't turn Shift+Insert into another shortcut. On X11 the
  shortcut acts when you release it.
- GNOME companion 13. It is one pill that shares GNOME's hover, focus and open-menu
  highlight and carries VOCO's tint, with even margins in both text directions. A
  primary click anywhere on it stops dictation or opens Settings; other buttons open
  the menu. On Wayland it keeps Alt+D and Alt+Shift+D out of the focused app at
  every status, idle included, and it is recommended rather than required. After
  upgrading, run `voco --setup-panel` again, then sign out and back in.
- At launch the tray reads "VOCO — Initializing…" with the busy icon until the
  first desktop check finishes, instead of flashing a setup warning. If that check
  fails, the tray reads "VOCO — Desktop setup needed" and VOCO checks once more
  after 2 seconds.
- The tray menu is in sentence case: Start dictation, Stop dictation, Change
  shortcut and Custom shortcut…. While VOCO transcribes, the status line says so
  and Start dictation is disabled.
- Notices say what VOCO did. A recording VOCO can't confirm is complete is announced
  once, at Start, as **Dictation won't be typed**, and is discarded. A live failure
  isn't repeated at Stop, Hide to tray notifies once per launch, a new dictation
  clears earlier notices, and an interruption is announced even after an earlier
  notice.
- Messages send you to "VOCO's menu", which is the tray or the GNOME panel, and a
  denied microphone names **Retry microphone access**.
- The startup notice for an invalid shortcut names the shortcut VOCO fell back to,
  Alt+D. If VOCO can't load your settings or save the reset, it says dictation is
  paused and to open VOCO.
- A failed voice test reads **Needs attention** with the reason, and Test again
  records a new sample.
- On Wayland, choosing a microphone in Settings uses it at once, with no separate
  confirmation.
- VOCO wakes less often. Idle native capture polls the sound server every 250 ms
  rather than 5 ms; the desktop check reuses a GNOME companion check for up to
  20 seconds, or 2 seconds after a failure; the tray meter ticks every 90 ms rather
  than 33 ms, and only while the tray icon is visible; and the window doesn't
  re-render for each audio level, recognition update or unchanged status poll.
- Settings → Updates gives instructions for GitHub Release and Source installs. An
  install channel saved as AppImage, Flatpak or Snap reads as GitHub Release.
- `apt show voco` describes VOCO as the AppStream listing does.
- Releases are assembled, verified and signed on the maintainer's computer with
  `scripts/assemble-release.sh`, from a signed tag whose commit passed CI. It writes
  provenance and validation records and five signed checksum manifests, and uploads
  nothing.
- `bash scripts/setup.sh --install` checks the provisioned speech runtime, never
  downloading one, then builds, assembles, verifies and installs the complete
  package with APT. Setup installs the worker's NumPy and psutil, installs Tauri
  CLI 2.10.1 when it is missing and warns about any other version, and names
  rustup rather than piping its installer into a shell.
- `npm test` runs `scripts/test-unit.sh`. `package.json` and `Cargo.toml` declare
  the MIT license and the repository, and `Cargo.toml` sets `rust-version` to
  1.94.0, CI's toolchain.
- Tauri 2.11.6 and Vite 8.3.1.
- The third-party notices name the vendored tray-icon 0.24.2 and global-hotkey
  0.8.0, and the private `ydotoold` built from ydotool 0.1.8 and libuInputPlus 0.1.4.

### Removed

- The Flatpak, Snap, AppImage, RPM and Arch recipes and the SentencePiece companion
  recipes. The Ubuntu/Debian package is the only one, and it keeps its
  libsentencepiece0 dependency.
- The hosted release workflow and the signing wizard. `ci.yml` is the only
  workflow, and it never assembles or signs a release.
- The output settings `insertionStrategy`, `transcriptTarget`, `liveCursorMode`,
  `transcriptEnhancement` and `voiceProfile`. An older config still loads, the next
  save drops them, and changes that name them are rejected.
- Per-app routing: the focus probe, the desktop target helper, target observation
  and the X11 focus lease in the vendored shortcut crate.
- IBus text mutation, which the engine's protocol always rejected. The IBus engine
  only watches for the shortcut.
- Code nothing could reach: the second recognition pass over kept audio, the debug
  capture that saved a WAV and a transcript timeline, the Moonshine research
  adapter, the OpenMP worker backend and the evaluation scripts for removed worker
  modes.
- AT-SPI from the package dependencies, and `docs/guide`, `docs/testing` and
  `docs/release-assets` from the package.
- ripgrep from CI and the scripts.

### Fixed

- In the GNOME top bar, the microphone stays still when the live bars open or close,
  and the tint fades in and out. GNOME's own privacy indicator can still shift the
  icons.
- The tray icon no longer changes size when dictation starts or stops, because
  Ready has no label either.
- Native capture fails a recording that loses a material amount of audio, or gets
  no audio within 5 seconds, instead of losing it silently.
- Messages no longer mention a Retry transcription control, or recovery after a
  stalled capture, that doesn't exist. A stalled capture ends the dictation and
  clears its audio and text.
- An empty or relative `XDG_STATE_HOME` is ignored, as the XDG spec requires, so
  the crash journal and logs no longer land in the working directory.
- The installer keeps its log, and says where it is, when it finishes but desktop
  setup still needs you (exit status 2).

## Earlier releases

The [GitHub releases](https://github.com/sergiopesch/voco/releases) page lists the
releases before 2026.0.60, each with its signed tag and assets.

[2026.0.60]: https://github.com/sergiopesch/voco/compare/voco.2026.0.59...voco.2026.0.60
