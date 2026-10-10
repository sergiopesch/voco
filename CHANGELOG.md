# Changelog

This file records the notable changes in each VOCO release, newest first. It
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), but VOCO doesn't
use Semantic Versioning: a version has the form `YYYY.0.N`, the year and then a
number that grows with each release, and its signed Git tag is `voco.<version>`.
The [release process](docs/release-process.md) describes how a release is made.

## [2026.0.62] - 2026-10-10

VOCO introduces itself as the voice layer for Linux, starting with dictation.
Locking the screen now stops dictation, the speech worker can't open network
sockets, update checks can wait until you ask, and the GNOME panel runs on GNOME
51. VOCO's app framework and build tools are up to date. The [release notes](docs/releases/2026.0.62.md)
explain how to upgrade.

### Added

- VOCO follows the screen lock of the session it started in, through logind's
  `LockedHint`. Locking the screen stops a dictation with "Dictation stopped",
  and while the screen is locked VOCO sends no paste keys and no shortcut starts
  dictation.
- The speech worker runs confined. Python starts with `-E -s -B`, so it ignores
  `PYTHON*` variables and the user's site-packages and writes no bytecode; every
  descriptor beyond the worker's pipes closes on exec; and a seccomp filter
  refuses io_uring and every socket except a Unix one. The full-application test
  checks the running worker's filter.
- **Update checks** on the **Updates** page: **When VOCO starts**, the default,
  or **Only when I choose**, which asks GitHub only when you choose **Check for
  updates**.
- The GNOME panel supports GNOME 51, which Fedora 45 ships. Its code is
  unchanged; the metadata and setup admit the new major after the companion
  suite passed on GNOME Shell 51.0. A GNOME 51 Companion CI job builds that Shell
  from a digest-pinned Fedora 45 image and runs the suite in rootless Podman, and
  AGENTS.md now asks for each new GNOME major within four weeks of its release.
- The [engine benchmark](research/engine-benchmark-2026-10/README.md) behind
  VOCO's choice of Nemotron English at a 160 ms step: the report, the harness
  and every run's per-utterance results, on 311 public utterances.

### Changed

- VOCO's message is "Dictation is the first step. We're building the voice layer
  for Linux: private, local, and under your control.", followed by where VOCO is
  today: private dictation. The README, the banner, the installer header, the
  release page and the package, AppStream and desktop entry descriptions use it,
  and the desktop entry gains search keywords: dictation, voice, speech,
  speech-to-text and typing.
- The space that joins a phrase to the previous one is pasted with the words,
  not sent as its own Space key, so VOCO's virtual keyboard declares only Shift
  and Insert. A Space key press can activate a focused button or checkbox; a
  paste can't. Chromium's address bar trims the pasted space, so there a
  continuing phrase now joins the previous word.

- Tauri 2.12.2, tauri-build 2.7.1 and tauri-plugin-global-shortcut 2.4.0. Tauri
  2.12 uses tray-icon 0.25 and muda 0.20, so the vendored tray-icon is now 0.25.1,
  with the same patch for fixed, caller-owned icon files.
- Rust 1.99.0, CI's toolchain, and Tauri CLI 2.12.1, which builds the Debian
  package.
- `@tauri-apps/api` 2.12.1, Vite 8.3.3, `@vitejs/plugin-react` 6.1.2, ESLint
  10.12.0, typescript-eslint 8.71.1 and Vitest 5.0.3.
- CI pulls its Debian 13 image from Docker's mirror on Amazon ECR Public, because
  Docker Hub rate-limits hosted runners, and Frontend Checks and GNOME 50 Companion
  allow for a slow apt mirror.

### Fixed

- Opening VOCO from the app menu when it isn't running shows its popover, as it
  does when VOCO is running. Before, VOCO started silently in the tray, so the
  click seemed to do nothing. A start from a terminal or a login autostart still
  stays in the tray.

## [2026.0.61] - 2026-10-09

VOCO types on Wayland through its own virtual keyboard and supports Ubuntu 24.04
and 26.04, Debian 13 and Fedora 44. This release also brings the changes prepared
for 2026.0.60, which wasn't published: dictation pastes into the focused app, and
Review keeps a dictation VOCO couldn't finish. The
[release notes](docs/releases/2026.0.61.md) explain how to upgrade.

### Added

- Fedora 44 support: `voco-<version>-1.x86_64.rpm`, built from the same files as
  the Debian package and covered by the same signed checksums. The guided
  installer installs it with DNF.
- Ubuntu 26.04 and Debian 13 support, alongside Ubuntu 24.04.
- VOCO's own virtual keyboard for Wayland paste keys, "VOCO virtual keyboard".
  The package installs a udev rule that gives the person at the computer access
  to `/dev/uinput`, so there is no input service, daemon or group to set up.
- Before copying and sending Wayland paste keys, VOCO checks its originating
  desktop session and stops the paste if logind reports it inactive. Unavailable
  status permits pasting; a switch after the check can still redirect keys.
- **Your shortcut can't reach VOCO yet**, once per launch on Wayland, when no
  keyboard is readable and neither the GNOME panel nor the IBus input source
  takes Alt+D. It names the fix.
- **VOCO has no icon in the top bar**, once per launch, when neither the GNOME
  panel nor a tray host is running, as on stock Debian 13 and Fedora 44 GNOME.
- CI runs the companion regression on GNOME 50, the speech runtime, IBus and
  worker tests and the speech baseline in Debian 13 and Fedora 44 containers,
  and both GNOME Wayland delivery suites through the real virtual keyboard.
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
- **Your shortcut also reached the app**, once per launch on Wayland, when Alt+D or
  Alt+Shift+D also acted in the app you were typing in. It names the fix: enable or
  reconnect the GNOME panel, or bind another shortcut to `voco --toggle`.
- `/usr/share/doc/voco/copyright` in the package: VOCO's MIT License, with a pointer
  to the runtime, model and patched-library notices beside it.
- CI installs its packages without Recommends, and the application suites
  start as soon as VOCO reports ready rather than after a fixed wait.
- A CI job, Application, that runs the release build of `voco` and
  `voco-browser-host` with the speech runtime through the GNOME panel,
  full-application, Wayland, Chromium field and toolbar suites. The delivery suites
  also run on a nested GNOME Wayland desktop, and the speech baseline checks a Stop
  packet of one sample.

### Changed

- Dictation pastes into the app that has keyboard focus. VOCO puts each phrase on
  the clipboard and the primary selection and presses Shift+Insert, with `xdotool`
  on X11 and its own virtual keyboard on Wayland, so terminals, browsers and native
  text fields take the same path and text follows focus. A paste VOCO can't
  confirm stops live typing and is never replayed as keys.
- GNOME companion 15, for GNOME 46, 48 and 50. It is one pill that shares GNOME's
  hover, focus and open-menu highlight and carries VOCO's tint, with even margins
  in both text directions. A primary click anywhere on it stops dictation or opens
  Settings; other buttons, the Menu key and Shift+F10 open the menu. On Wayland it
  keeps Alt+D and Alt+Shift+D out of the focused app at every status, idle
  included, and it is recommended rather than required. After upgrading, run
  `voco --setup-panel` again, then sign out and back in.
- The guided installer installs only the VOCO package, with APT or DNF, then
  checks the paste prerequisites without sending keys. It no longer writes or
  migrates VOCO's settings: VOCO creates `~/.config/voco/config.json` at first
  launch and copies an older `~/.config/voice/config.json` then. Before it
  downloads anything, it refuses glibc older than 2.39 or a processor without
  AVX2, FMA or F16C, and names what is missing.
- A recording that stops before any words were recognized says **Nothing was
  typed** and why, instead of that some words may be missing. VOCO logs the reason
  capture stopped.
- Before it pastes, VOCO waits up to 1.5 seconds for the shortcut's keys to be
  released, so a held Alt can't turn Shift+Insert into another shortcut. On X11 the
  shortcut acts when you release it.
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
- On Wayland, VOCO no longer registers a custom shortcut through XWayland, which
  reported it as working when the desktop might never deliver it. Bind a custom
  shortcut to `voco --toggle` in your desktop's keyboard settings; Settings and
  **Help** say so.
- VOCO wakes less often. Each speech request reaches the worker in one write
  rather than thousands of small ones, and with `VOCO_PERFORMANCE_LOG` and
  `VOCO_HOTKEY_TRACE` unset the window no longer sends diagnostics that VOCO
  discarded. Each paste notices its clipboard and key helpers exit within 1 ms
  rather than 5 ms. Idle native capture polls the sound server every 250 ms
  rather than 5 ms; the desktop check reuses a GNOME companion check for up to
  20 seconds, or 2 seconds after a failure, and isn't run at all outside GNOME; the tray meter ticks every 90 ms rather
  than 33 ms, and only while the tray icon is visible; and the window doesn't
  re-render for each audio level, recognition update or unchanged status poll.
- Settings → Updates gives instructions for GitHub Release and Source installs. An
  install channel saved as AppImage, Flatpak or Snap reads as GitHub Release.
- `apt show voco` describes VOCO as the AppStream listing does.
- Releases are assembled, verified and signed on the maintainer's computer with
  `scripts/assemble-release.sh`, from a signed tag whose commit passed CI. It writes
  provenance and validation records and signed checksum manifests for both
  packages, and uploads nothing.
- `bash scripts/setup.sh --install` checks the provisioned speech runtime, never
  downloading one, then builds, assembles, verifies and installs the complete
  package with APT. Setup installs the worker's NumPy and the C compiler the build
  needs, installs Tauri CLI 2.10.1 when it is missing and warns about any other
  version, and names rustup rather than piping its installer into a shell. It asks
  for the sudo password before its progress line, shows APT's errors when APT
  fails, skips APT when nothing is missing in development mode, and no longer
  writes a linker override into the checkout.
- `npm test` runs `scripts/test-unit.sh`. `package.json` and `Cargo.toml` declare
  the MIT license and the repository, and `Cargo.toml` sets `rust-version` to
  1.94.0, CI's toolchain.
- Tauri 2.11.6 and Vite 8.3.1.
- The third-party notices name the vendored tray-icon 0.24.2 and global-hotkey
  0.8.0.

- The VOCO window no longer holds global-shortcut and window-decoration
  permissions it never used, and the VOCO Dictation input source accepts requests
  of up to 64 KiB rather than 4 MB.
- `report-speech-performance.py` names speech worker failures with the same codes
  in both record types, and still counts older logs' codes.
- `VOCO_SILENCE_GATE` accepts only `off` and `zero`. Any other value stops the
  speech worker at startup instead of reporting Ready and failing every Start.

### Removed

- Wayland paste through ydotool: `voco-ydotoold.service`, its launcher and
  migration, the private legacy `ydotoold`, `voco --setup-desktop-input`, and the
  `ydotool` and `ydotoold` package recommendations. On its first Wayland launch
  after the upgrade, VOCO removes its own old service's enablement and stops it.
- The `procps` and `python3-psutil` dependencies. The speech worker's opt-in
  performance log reads CPU and memory use from the kernel.
- The Flatpak, Snap, AppImage and Arch recipes, the previous RPM recipe and the
  SentencePiece companion recipes. VOCO ships the Debian package and the Fedora
  RPM, both from one staged tree, and keeps its libsentencepiece0 dependency.
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
- The dated test reports, audits, decision records and benchmark assets in `docs/`,
  and the release notes before 2026.0.61. Each release's tag keeps the documents
  its notes link to.
- ripgrep from CI and the scripts.
- The undocumented `VOCO_TRAY_DEBUG` and `VOICE_TRAY_DEBUG` variables. The tray's
  update line is logged at `RUST_LOG=debug`.
- The popover's Cancel dictation button and in-dictation cues, which no way of
  opening the popover during a dictation could reach.

### Fixed

- Opening VOCO from the app menu left GNOME's busy cursor spinning for about 15
  seconds after every start, because the desktop entry asked for startup
  notification, which a tray app that starts without a window never completes.
  The entry now turns it off.
- After a distribution upgrade to a newer GNOME, panel setup reported the old
  copy GNOME had marked out of date as **GNOME could not load the VOCO panel** and
  couldn't turn the panel on, so setup had to be run again after signing in. It now
  turns the panel on and says to sign out and back in.
- After an upgrade to Ubuntu 26.04, whose `ydotool` package starts its own
  `ydotool.service`, VOCO's input service could restart in a loop and VOCO
  refused to start, saying the service had a pending transition. VOCO no longer
  uses that service.
- With no microphone chosen, the tray and the GNOME panel said **Microphone setup
  required** and the tray disabled Start until you chose one, although Start
  uses the system default microphone. VOCO now reads **Ready · microphone checks
  on first use**.
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
- On Wayland, the Alt+D shortcut could miss a press while VOCO looked for an IBus
  input source that wasn't running, or waited for a slow one to answer.
- Unplugging a keyboard while VOCO resynchronized it could leave the Alt+D
  shortcut dead on the other keyboards.
- A shortcut press through the IBus input source while the window reloaded was
  lost. It now applies once the window is ready, as on every other route.
- While a VOCO window was open, VOCO reset the permissions of `~/.config/voco` and
  `config.json` every second, so a private settings folder or file that was
  read-only failed to load. VOCO now changes a mode only when it isn't private.
- Saving the update check's cache blocked the tray and the window while the file
  synced to disk.
- The GNOME panel looked ready while the speech model was still warming up. It
  now reads **Starting VOCO** until the model is ready.
- Each launch left about 70 tray icon files in `$XDG_RUNTIME_DIR/voco` until
  logout. VOCO now removes the folders earlier runs left there.
- If VOCO couldn't write its tray icons at startup, it failed later, when its
  window loaded. It now says **VOCO could not start** with the reason.
- On X11 the microphone meters read nearly flat for ordinary speech. They now use
  the same scale as on Wayland.
- In a Chromium exact field, Stop reported **Dictation interrupted** when every
  word was typed and the field then lost focus or changed.
- Opening VOCO from the app menu, the tray or Review just as a dictation started
  could show a window over it.
- After a microphone failed to start, choosing a microphone from the old list
  seemed to work, then the next Start failed. The choice now fails at once with
  **Source selection is stale**.
- When restoring the previous shortcut also failed, the error said "the previous
  hotkey" instead of naming it.
- **Record keys** in Settings saved a shifted digit or symbol, or a letter on a
  non-Latin layout, as the typed character, which the shortcut check rejects. It
  now records the key you press, such as Ctrl+Shift+1 or Ctrl+Alt+D on a
  Cyrillic layout.
- When a shortcut or microphone couldn't be saved, Settings said only that VOCO
  could not save those settings. It now gives VOCO's reason under the field.
- After an upgrade from 2026.0.59 with the GNOME panel on, the installer showed a
  generic warning that said the tray menu remains available, which isn't true on
  Debian 13 or Fedora 44. It now says to sign out and back in to load the panel.
- The docs said plain PulseAudio is enough. On Wayland VOCO needs PipeWire's
  PulseAudio service, `pipewire-pulse`, which all four supported systems use by
  default.

## Earlier releases

The [GitHub releases](https://github.com/sergiopesch/voco/releases) page lists the
releases before 2026.0.61, each with its signed tag and assets.

[2026.0.62]: https://github.com/sergiopesch/voco/compare/voco.2026.0.61...voco.2026.0.62
[2026.0.61]: https://github.com/sergiopesch/voco/compare/voco.2026.0.59...voco.2026.0.61
