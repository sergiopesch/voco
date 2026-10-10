# VOCO agent guide

VOCO is building the voice layer for Linux, and dictation is the first step: press
a shortcut, speak, and the words are pasted into whichever app has keyboard focus. This guide is for coding agents
and maintainers. Before changing code, read the [README](README.md), the
[architecture overview](docs/architecture/README.md) and the
[code map](docs/architecture/code-map.md). [CONTRIBUTING](CONTRIBUTING.md) covers
setup and pull requests.

## Product contract

- Direction: the voice layer for Linux, private, local and under the user's
  control ([branding](docs/branding.md)). The rest of this contract is today's
  product, dictation. A capability beyond it, such as voice editing or commands,
  first changes this contract in its own reviewed pull request, with its safety
  rules, before any code.
- No account, subscription, telemetry or cloud transcription. Update checks read
  GitHub's public releases API and never download or install anything.
- One output path: streaming dictation pasted into whatever has keyboard focus.
  The optional Chromium exact field uses the same recognizer with its own delivery.
- No assistant, conversation, enhancement, appearance or per-app settings.
- Tray first. Respect system accessibility preferences such as reduced motion.
  The desktop entry keeps `StartupNotify=false`: VOCO usually starts without a
  window, so it can't complete a launcher's startup sequence, and GNOME would
  show its busy cursor until a 15 s timeout.
- Settings are the microphone, the shortcut and the update channel. Onboarding
  state and the installation method are stored alongside them.
- A normal session keeps nothing. Review only holds text that survived a crash, or
  that a Stop could neither paste nor copy.

## Architecture

The production path is `runtime/speech/` → Rust `speech_stream.rs` →
`dictationStream.ts` → `insertion.rs`. The recognizer is NVIDIA Nemotron English 0.6B Q8 on the CPU.
The default worker count is at most four threads and leaves one CPU of the process
affinity free for the desktop (minimum one); keep explicit research overrides and
record the actual count. Desktop and Chromium exact-field dictation share this
recognizer; browser field ownership is a delivery concern.

Rust owns OS integration, files, processes, the tray, packaging and validation.
React owns presentation and recording orchestration. Keep both typed and
state-driven. Comment invariants and non-obvious decisions; don't narrate lines.

Capture is native Pulse/PipeWire on Wayland and a WebKit AudioWorklet on X11
(`VOCO_DEV_NATIVE_CAPTURE=1` selects native capture for development). A hidden
window really hides with native capture; WebKit capture needs a mapped webview, so
its hidden surface is a 1 px window off-screen.

Development and CI use Node 24 LTS (`.nvmrc`) and the Rust toolchain named by
`rust-version` in `Cargo.toml`; `scripts/check-devops.sh` fails if CI's toolchain
differs. `.editorconfig` sets the formatting basics. Keep Vite 8 and the React plugin 6
together, keep explicit output targets, and keep root renderer fixtures on the
desktop's Vite resolution. Check both dev rendering and packaged WebKit.

The config (`config.rs`) holds the shortcut, the microphone, onboarding state,
the update channel and the installation method. Retired keys are ignored on read
and dropped on the next save, and patches that name them are rejected. Retired
package channels read as GitHub Release. VOCO never overwrites a config it cannot
read: Settings shows a recovery panel, and only Reset renames the file to a
`config.recovery-backup-*` copy before writing defaults.

VOCO vendors narrow patches ([vendor/README.md](vendor/README.md)): glib 0.18.5
with the exact upstream RUSTSEC-2024-0429 fix ([backport](vendor/glib/VOCO-PATCH.md)),
global-hotkey and tray-icon. Keep every GTK/WebKit consumer on the single
patched glib; adding glib 0.20 directly leaves GTK behind. Verify source
provenance and the optimized iterator regression before accepting a dependency
change.

## Invariants

### Recognition and capture

- Warm the selected worker before reporting readiness; imports don't start it.
- Flush Stop audio into the same live stream before finishing; never copy or
  replay a whole recording. Recreate a dead worker only at a session boundary.
- Keep bounded queues, deadlines and sequence/sample accounting. Worker IPC groups
  100 ms of audio and Stop flushes the partial packet. Keep the three-second
  backlog bound and account for every sample.
- Native Pulse ticks drain ready transport events within bounded work and time.
  Pulse's playback overflow callback doesn't report recording drops, so keep the
  bounded duration-deficit guard and the complete-reference waveform tests;
  healthy local ACKs alone don't prove source continuity.
- Audio from the unverified ScriptProcessor fallback never enters automatic
  delivery.
- VOCO never recognizes audio a second time. A failed recording notifies and
  returns to idle; the voice test's "Test again" records anew.
- Select the default microphone automatically only on an explicit Start test or
  recording when no microphone is chosen. No idle recording, and no silent device
  switching during capture.

### Delivery

- Each chunk pastes into whatever has keyboard focus when it is ready. There is no
  destination token, focus probe, terminal detection or per-app route. Desktop
  setup checks the paste prerequisites, never a caret or an app.
- Copy CLIPBOARD, then PRIMARY (best effort; a failure only warns), then send one
  Shift+Insert: toolkits paste CLIPBOARD and terminals paste PRIMARY. A leading
  joining space is its own Space key, because Chromium's address bar trims pasted
  leading whitespace. ASCII controls become spaces. Never send Enter and never
  restore the previous clipboard.
- Wayland paste keys are raw key events, so wait at most 1.5 s for the shortcut's
  modifiers to be released (evdev, else the companion's `ModifiersClear`). Unknown
  state doesn't block; a timeout sends no keys. On X11 the passive grab takes every
  key while the chord is held, so a paste waits for its release, at most 1.5 s
  after the press.
- Wayland keys go through VOCO's own uinput device, "VOCO virtual keyboard"
  (`virtual_keyboard.rs`); X11 keeps `xdotool`. Keep one device per process,
  created at startup and reused for the process lifetime, never one per paste:
  the compositor adds a new device late and could lose its first keys, so a
  device younger than 500 ms waits before its first key. It declares only Shift,
  Insert and Space and sends each event in its own report, 12 ms apart. Ensure it
  exists before the clipboard copy, so a missing device is a `no-mutation`
  failure; after an emit error, release Shift and drop it so the next paste
  recreates it.
- Keys reach seat0's active session. Bind the originating local graphical login
  at startup through process membership, a validated session ID, or a unique
  graphical user session for apps launched by the user manager. Never select
  logind's elected user Display or whichever login is active. Retain that identity
  for the process; a departed, ambiguous, foreign or wrong-seat origin rejects.
  Check before the clipboard copy (`no-mutation`) and again just before keys.
  Resolution has a 16-session cap and a 750 ms logind lookup budget. Genuine
  unavailable logind state retains the existing fail-open policy.
- The paste check opens `/dev/uinput`; it never creates the device, sends keys or
  starts a process. The evdev listener ignores the virtual keyboard by name (and
  another tool's `ydotoold virtual device`), so its keys never count as the
  shortcut or a held modifier.
- `/dev/uinput` access comes only from the packaged `uaccess` udev rule: the user
  of the active local session, with no group, daemon, socket or service. Package
  hooks apply it only by loading `uinput` and reloading and re-triggering udev;
  they never touch users, groups or session services.
- At a Wayland start, retire only VOCO's own `voco-ydotoold.service` enablement:
  remove the link only if it points at the old packaged unit and that file is
  gone, then stop the unit and reload the user manager off the startup path.
- Start is refused while paste is unavailable, and when `VOCO_DESKTOP_PASTE=0` or
  `VOCO_DESKTOP_STREAM=0` is set.
- Only a `no-mutation` failure, which typed nothing, keeps its text pending for the
  next chunk or for Stop's bounded retries (three, 250 ms apart). A rejected or
  uncertain paste stops automatic delivery; recognition keeps running until Stop.
  A paste rejection keeps microphone readiness; only a capture failure clears it.
- Stop copies the undelivered remainder, joining space included, with
  `copy_desktop_text`, then notifies. It never replays that text as keys. If the
  copy fails too, `keep_crash_journal` moves the text into Review; only if the
  journal can't keep it does Stop report an interruption. A Chromium exact-field
  session whose field stopped taking text ends the same way.
- Closing or navigating an enabled browser tab, or losing its native connection,
  stops that tab's recording. Field focus loss revokes delivery but keeps the
  session's explicit Stop; stale tokens can't stop a newer session.

### Shortcut

- Toggles are debounced for 120 ms (`TOGGLE_DEBOUNCE_MS`).
- The GNOME Wayland companion is recommended, not required. Without it the focused
  app also receives Alt+D (browsers focus the address bar, terminals delete a
  word), and an evdev toggle while the chord leaks sends one notification per
  launch with the panel remedy, which Settings also shows. When no keyboard is
  readable and neither the panel nor IBus takes the chord, it does nothing at
  all: 20 s after the listener starts, VOCO notifies once with the same remedy.
- The companion grabs the configured Alt+D or Alt+Shift+D at every status, idle
  included; each press sends `Action('shortcut', '')`. `ReserveShortcut` holds a
  2.5 s lease for the exact `shortcutAccelerator` that only the authenticated Shell
  can renew, about once a second. While it is fresh, passive evdev ignores the
  chord and the action toggles through the `gnome_panel` backend; otherwise the
  action is refused and evdev toggles. Release the grab on rejection, disconnect or
  disable; late replies about an earlier grab never act on a newer one.
  `ReserveStopShortcut` remains for older loaded companions.
- A completed IBus decision differs from a poll in flight. Consuming X11 callbacks
  go through the debounce; passive evdev keeps its duplicate guard. The listener
  posts fallback arbitration only when the config revision or the decision changes,
  otherwise once a second, and the main-thread closure re-checks its inputs.
- IBus protocol 6 is shortcut-only; older helpers must reconnect after an upgrade. Never
  restore text mutation there.
- `voco --toggle` connects once to the owner-only socket. Don't add retries or
  launch/focus side effects; it doesn't prove a compositor binding exists. Document
  modifier-independent Hyprland bindings, or explicitly checked Ctrl/Shift variants
  on other compositors, and never silently overwrite desktop shortcuts.

### GNOME companion and tray

- Both packages bundle the companion for GNOME 46, 48 and 50. Its metadata's
  `shell-version` and `SUPPORTED_SHELLS` in `voco_gnome_panel.py` name the same
  majors, and setup reports any other as `unsupported`; admit a major only after
  testing it. A Shell without `Meta.is_wayland_compositor()` (GNOME 50) is
  Wayland-only. Enable the companion only through the user-run setup
  (`voco --setup-panel`); package hooks never change enabled extensions. Keep
  "sign out and back in" feedback distinct from active status.
- Bump the companion metadata and the setup contract together when loaded code
  must change, and compare GNOME's loaded metadata so an in-place upgrade can't
  report old code as current. After an upgrade, users re-run panel setup and sign
  out and back in. A copy Shell marked out of date at login (after a
  distribution upgrade, for example) awaits that login: setup may enable it and
  reports `restart`, never a load error.
- The diagnostics poll, the setup input check and the once-per-launch shortcut
  notice may reuse a companion check for up to 20 s, or 2 s after a failed or
  unavailable check. Attach, Detach, name loss and explicit enabling clear it;
  explicit setup status always re-checks.
- While the companion is attached, VOCO hides its fallback tray icon. The
  companion's menu is Settings, Review and Stop dictation. On every supported
  Shell a primary click on the pill stops or opens Settings, and other buttons,
  Menu and Shift+F10 open the menu: GNOME 50's panel click gesture must leave
  primary presses and touches to the pill.
- On GNOME the fallback tray needs an AppIndicator extension. Ubuntu turns one
  on; Debian 13 and Fedora 44 don't, so there the companion is VOCO's only
  top-bar presence. When 20 s after startup neither the companion is attached nor
  a StatusNotifier host owns its name, VOCO notifies once with the remedy.
- Active presentation is the microphone plus waves only. Stop lives in the menus,
  the companion pill's primary click and the shortcut (the fallback tray's
  AppIndicator reports no clicks); Settings and Review are explicit menu
  destinations.
- VOCO's own layout never moves the microphone when dictation starts or stops: the
  companion's meter opens on its left, and the fallback tray shows no label at
  Ready or while dictating. Only startup and setup labels add width.
- GNOME's privacy microphone indicator appears while the capture stream exists and
  shifts the indicators on its left, VOCO included. Never hide it or hold a stream
  open to avoid that.
- Keep tray PNG paths immutable for the process lifetime, and keep explicit Stop
  actions.

### Onboarding

- The voice test uses the production recognition queue with local-only output.
  Never paste or copy onboarding output. The test keeps its local retry.
- Finish must flush capture and recognition successfully. Check the desktop input
  prerequisites without sending keys or changing the clipboard; only then save
  completion. Done returns straight to the hidden tray surface without presenting
  or focusing a Ready window.

### Review and the crash journal

- Normal completion and handled failures clear text and audio and delete the
  active checkpoint; they never expose a saved transcript.
- Only an earlier unexpected exit, or a Stop that could neither paste nor copy its
  remainder, puts text into Review. Review never opens, pastes or retries by itself.
- The journal is owner-only, bounded, local and text only, never audio. Keep
  earlier entries until the user discards them: at most five, the oldest evicted
  by a sixth. Without a checkpoint dictation continues and notifies.

### Privacy and logs

- Logs are optional, private and bounded. Performance logs never contain dictated
  text, audio, clipboard values, URLs or window titles. Reject unsafe log and
  socket targets.
- The developer capture audit needs all three flags (`VOCO_DEV_NATIVE_CAPTURE`,
  `VOCO_DEBUG_CAPTURE_AUDIO`, `VOCO_DEBUG_NATIVE_CAPTURE`) and completed private
  bundles; wait for their COMMIT receipts before ending an audited test process.

### Installer and packages

- The guided installer installs only the verified local package: the `.deb` with
  APT when `apt-get` and `dpkg-query` exist, otherwise the RPM with DNF (`dnf`
  and `rpm`). Both are checked against the same signed `voco_checksums.txt`,
  and the package manager must then report exactly that release, once. Then it
  runs `voco --check-desktop-input`. A successful install alone is not desktop
  readiness.
- After setup succeeds, request one detached launch as the invoking desktop user;
  never launch a GUI from root or package hooks. Distinguish a launch request from
  readiness and keep the manual guidance when launching fails. The installer checks
  `/usr/bin/voco`, not an earlier PATH entry.
- Source excludes model weights and compiled runtime payloads. Follow
  [runtime provisioning](docs/linux-packaging.md#runtime-provisioning) and never
  replace missing pinned artifacts with mutable downloads. A base Tauri `.deb` is
  incomplete: assemble and verify the NVIDIA payload before calling it installable.
- One staged tree becomes both packages (`package-nvidia.py --rpm`), so they
  carry the same files; `verify-rpm-package.sh` proves it against the `.deb`.
  Every Debian dependency needs its Fedora name in `DEBIAN_TO_FEDORA`
  (`scripts/rpm_package.py`), and the spec requires exactly those. The RPM's
  only scriptlet is `packaging/rpm/post.sh`, the same best-effort rule
  application as the Debian `postinst`. It owns only VOCO's folders and the
  shared ones no dependency creates, declares no weak dependencies or
  configuration files, and keeps automatic requires and provides off for the
  private speech runtime. `check-devops.sh` checks the spec and the mapping, and
  `verify-rpm-package.sh` the built package. CI's Debian 13 and Fedora 44 jobs
  install the dependencies by those names (`scripts/distro-dependencies.py`) and
  run the speech runtime there; hosted CI never builds a package.

## Working practices

Inspect first, make a concrete plan, and change only what the task requires.
Preserve unrelated uncommitted work. User instructions authorize product changes;
otherwise discuss significant behaviour, security, privacy or stack tradeoffs
first. Don't add dependencies without a concrete need.

Documentation describes how VOCO works now. Update it in the same change as the
behaviour: user-visible behaviour in the README, `docs/everyday-use.md` and
`docs/troubleshooting.md`; setup in `docs/install.md` and `docs/platform/README.md`;
internals in `docs/architecture/`; security in `docs/security/README.md`; packaging
and releases in `docs/linux-packaging.md` and `docs/release-process.md`. Keep dates,
run IDs, superseded designs and test narratives out of the docs; they belong in pull
request descriptions. Summarize each release in `CHANGELOG.md` and
`docs/releases/<version>.md`. The [code guide](docs/guide/README.md) is pinned to a
commit; re-pin and regenerate it when the code it cites changes.

## Validation

Run focused checks first, then the relevant wider gates:

```bash
npm run verify:versions
npm run verify:devops
npm run check
npm run lint
npm test
npm run test:dictation-renderer
npm run test:microphone-renderer
npm run test:native-capture-renderer
npm run test:chromium-exact-field
npm run test:browser-delivery
npm run test:application-delivery
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm --workspace @voco/desktop run build:frontend
cargo clippy --locked --all-targets --all-features --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
python3 scripts/verify-glib-backport.py
python3 scripts/test-glib-variant.py --output "$(mktemp -d)/voco-glib-check"
cargo test --locked --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build
```

`npm test` (`scripts/test-unit.sh`) runs the checks that need no microphone, speech
model or desktop session. `verify:devops` checks the CI gates, installer sync and a
release rehearsal.

- Use isolated audio, input, clipboard and desktop fixtures. Never inject test
  speech into a live user session.
- Use public or synthetic fixtures only; keep personal audio, transcripts and
  private raw evidence out of the repository and out of CI logs.
- Python worker tests need NumPy; protocol tests also need the pinned model and
  runtime (`scripts/provision-ci-speech.sh`).
- Record unavailable checks as unavailable, never passed. Report failures and
  attempted-trial denominators, not just successes.
- Keep diagnostic DOM logging separate from latency measurements in browser tests:
  repeatedly copying a growing transcript can stall the recipient.
- For optimization work, follow [the TypeSafe evaluation protocol](docs/testing/typesafe-evaluation.md).
  Keep deterministic timing and accuracy separate from optional semantic judgments.
  The TypeSafe client is research tooling: explicit public or synthetic text, never
  personal speech or live delivery. Keep baseline and candidate identities, missing
  measurements and rejected experiments, and run `npm run test:dictation-evaluation`.

## Release

- Source version: **2026.0.62**. Latest published release: **2026.0.61**.
  GitHub Releases is authoritative for publication and the package manager for the
  installed version; a version in source proves neither.
- `packaging/published-release.json` records the published version. Keep the README
  install command pinned to it until a new publication is verified, then update both.
- New product bytes need a new version and fresh checks. Pass every CI gate,
  including the pinned Nemotron accuracy and continuity checks; no waiver is
  authorized. Keep a clean commit, exact package and source hashes, licenses,
  checksums and release notes.
- CI's `application` job tests the release build of both executables in isolated
  desktops, but hosted CI never packages the NVIDIA runtime or signs anything;
  `check-devops.sh` enforces this. On the maintainer's Linux machine,
  `scripts/assemble-release.sh` builds, verifies and signs a signed tag's release.
  The assets go to a draft release, which is published only after the downloaded
  assets verify. See the [release process](docs/release-process.md).
- The signing machine runs Ubuntu 24.04, whose glibc 2.39 and GCC 13 set both
  packages' floors, with `rpmbuild` from the `rpm` package. Each release carries
  the RPM and `voco_latest_x86_64.rpm` with their own checksum lists, signed
  like the Debian ones; `voco_checksums.txt` lists the RPM too, and
  `voco_latest_checksums.txt` stays Debian-only. The RPM itself isn't
  OpenPGP-signed: the signed checksums authenticate it. The validation record
  doesn't cover DNF, so try the RPM on Fedora 44 before publishing.
- Userspace checks, native install and removal, physical audio and
  compositor/application behaviour are distinct evidence levels, and each covers
  only the system and GNOME version it ran on. Never claim fastest, most
  accurate, universal compatibility or stability from a limited test corpus.
