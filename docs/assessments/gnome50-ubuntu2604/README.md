# Ubuntu 26.04 / GNOME 50 candidate assessment

**Decision: do not install the unchanged candidate as a qualified GNOME 50 upgrade.**
The speech architecture remains a good fit. The immediate work is desktop
compatibility: package resolution, input-service coexistence, the Shell companion,
and a test environment that actually exercises GNOME 50.

This is a review and implementation proposal requested on **3 October 2026**.
Only assessment documents are changed. Nothing in this branch implements the
proposal or authorizes changes to the owner's desktop. No package was installed
or removed; no service, extension, shortcut, microphone or clipboard was changed.
Tests used mocks, metadata probes and public audio passed directly to a private
worker process. They did not play audio or inject keys into the desktop.

## Read this handoff

1. This file: findings, priorities and architecture judgment.
2. [Upgrade approach](upgrade-approach.md): alternatives, work packages and decisions.
3. [Validation plan](validation-plan.md): exact evidence boundaries and acceptance gates.
4. [Upstream research](upstream-research.md): GNOME/Ubuntu primary sources and API probes.
5. [Evidence summary](evidence-summary.json): sanitized machine-readable observations,
   test results, runtime identities and unavailable checks.

All source line references below refer to candidate commit
`2045dd7391ece5815d70a5fd42e1cb6fd14ae2a6`. Recheck them after implementation.
The requested dated handoff lives here separately from the product documentation.

## Findings, highest priority first

### F1 — P1: the guided Wayland installer cannot resolve Ubuntu 26.04 dependencies

**Confirmed through source and a non-mutating APT simulation.**
`scripts/lib/install-common.sh:314–338` unconditionally requests both `ydotool`
and `ydotoold` on Wayland. The generated root `install` repeats this at line 386,
and its prefetch loop at line 1135 also assumes two packages. Ubuntu 26.04's
`ydotool` 1.0.4-3 supplies both `/usr/bin/ydotool` and `/usr/bin/ydotoold`; no
separate `ydotoold` candidate exists in the configured repositories.

`apt-get --simulate install ydotool ydotoold` fails with
`E: Package 'ydotoold' has no installation candidate`, even though the daemon
executable is already installed. This reproduces the offending dependency request,
not a complete installer attempt. The public .59 installer also has this old
assumption; reverting to that release does not solve this operating-system change.

The correction must cover package selection, prefetch, source-install path,
generated installer, package recommendations and verification fixtures together.
`scripts/verify-deb-package.sh:62` currently demands the exact recommendation
string `ydotool, ydotoold`. Preserve Ubuntu 24.04's split-package support; do not
simply remove the daemon requirement on every distribution. Verify the actual
system executables and service after APT resolves the distro-appropriate packages.

### F2 — P1: two input services compete, and the startup guard can reject the app

**Live collision confirmed; app-start consequence established by source and a
read-only guard probe, not by launching the GUI.**

The distro's `ydotool.service` runs `/usr/bin/ydotoold` successfully. VOCO's
enabled `voco-ydotoold.service` runs the same modern daemon and repeatedly fails
because the socket is already in use. One observation counted **1,012 restarts**;
the unit uses `Restart=on-failure` and `RestartSec=3`. This is unnecessary repeated
process creation and logging, not a measured claim about battery drain or CPU
percentage. The single `CPUUsageNSec` sample is not the loop's cumulative cost.

The installed and candidate launchers have the same relevant behavior:
`packaging/ydotool/voco-ydotool-launcher:87–89,131–133` classifies
`activating/auto-restart` as `MigrationInFlight` before considering whether the
other provider is usable. A read-only call to `unit_state` and `require_settled`
reproduced that exception. Its exit category is 70; `desktop_input_setup.rs:19–22`
marks it as potentially changing, and `lib.rs:1952–1954` returns before creating
the GUI. Thus, **when startup samples this observed state, it refuses launch**.

Meanwhile the installed `voco --check-desktop-input` reports ready. That command
does include a client compatibility probe (`insertion.rs:207–225`); it is not
merely `pgrep`. But it does not reconcile the competing unit or exercise the
startup migration guard. Readiness and launchability can therefore disagree.
The latest candidate's package replacement alone would leave the enabled-unit
state in place. Preserve the strict guard for real pending migrations; do not
fix this by ignoring every exit 70 or killing arbitrary daemons.

### F3 — P1: GNOME 50 support requires a real companion port

**Two compatibility gates and one missing API are confirmed.**

- Candidate metadata supports only Shell `46`; the laptop's installed companion
  v12 is enabled but `OUT OF DATE`. Candidate v13 still supports only `46`.
- `voco_gnome_panel.py:18–20` independently rejects any other Shell major.
- `extension.js:257` calls `Meta.is_wayland_compositor()`. The installed
  Mutter 18 introspection API does not expose it. Merely adding `50` to metadata
  would reach this missing call after Attach and before rendering the indicator.

The existing error path predicts a bounded two-second detach/retry cycle, not a
demonstrated timer leak. See the [source trace and probe](upstream-research.md#why-a-metadata-only-change-would-fail).
The shortcut-grab and modifier primitives still exist, which supports a narrow
port instead of a wholesale rewrite. Preserve versioned support, authenticated
Shell ownership, late-reply guards, loaded-version checks, and cleanup.

Until the port is qualified, the default `Alt+D` route can reach the focused
application as well as VOCO. The saved laptop shortcut is `Alt+D`, and the login
can read input events. The code explicitly warns that browsers may focus the
address bar and terminals may delete a word (`panel_setup.rs:35–64`). This is
known behavior of the fallback, not a newly reproduced desktop injection bug.
A tray icon showing up would not resolve it.

### F4 — P1 qualification gap: green CI does not exercise GNOME 50

**Confirmed test infrastructure mismatch.** All five jobs of
[candidate CI run 36696756805](https://github.com/sergiopesch/voco/actions/runs/36696756805)
passed for the exact candidate. Their runners are `ubuntu-24.04`.
`test-gnome-panel.py:83,109,122`, `test-native-gnome.py:48` and
`test-application-delivery.sh:76` launch `gnome-shell --nested`.
The laptop's Shell help lists `--devkit` and no `--nested`; both private probe
extensions also declare only `46`.

Current Wayland delivery fixtures additionally replace `/usr/bin/ydotool` with a
nested-input adapter (`test-application-delivery.sh:26–30`). They test delivery
logic but cannot prove the real modern daemon's socket, uinput events or service
coexistence. GNOME 50 devkit has clipboard integration: replacing one CLI flag
without rechecking isolation could expose the owner's clipboard or input.
Port the harness in an isolated environment, then require an installed VM and
physical laptop acceptance. Do not mark old tests as GNOME 50 coverage.

### F5 — P2 qualification gap: new system libraries are only partly exercised

**No speech-runtime ABI failure was found in the checks performed.** System
Python is 3.14.4, NumPy 2.3.5, psutil 7.1.0, SentencePiece 0.2.1,
WebKitGTK 2.52.6 and PipeWire 1.6.2. The installed native library resolves its
dependencies and loads successfully. Candidate Python source with the
hash-verified pinned native payload passes 13/13 real-worker protocol checks and
completes 8/8 development speech fixtures: 4 lexical edits / 160 reference words
(**2.5% WER**). This is affirmative evidence for retaining the recognizer.

It does not qualify the packaged Rust/WebKit app, Pulse/PipeWire capture, real
input events, fractional scaling, suspend/resume or microphone hardware.
The native callback regression attempt was blocked before compilation by missing
`libpulse.pc`. GTK, WebKit and AppIndicator development pkg-config entries are
also absent. The machine can run installed libraries without being a complete
build environment. No dependencies were installed to hide that limitation.

## Candidate and laptop identities

| Item | Verified state |
| --- | --- |
| Candidate | `master` at `2045dd7391ece5815d70a5fd42e1cb6fd14ae2a6`, source 2026.0.60 |
| Origin of latest changes | [Merged PR #88](https://github.com/sergiopesch/voco/pull/88), incorporating PR #86/#87; their topic branches are no longer remote branches |
| Public installer | [2026.0.59](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.59), published September 23; no published .60 installer found |
| Installed application | `2026.0.60+pr87.20260929.1`; prior package receipt records source `f8883ec3a3d62177229ad142ce1e2eb9e6fd46e1`; current `dpkg --verify voco` is clean |
| Desktop | Ubuntu 26.04.1, GNOME Shell 50.1, Mutter 50.1, Wayland, XWayland available |
| Kernel / CPU | `6.17.0-1032-oem`; Ryzen 7 PRO 8840HS, 16 logical CPUs, required AVX2/FMA/F16C present |
| Input state | Modern `ydotool` 1.0.4-3; owner socket mode 0600; `/dev/uinput` writable for this login; distro service active, VOCO service retrying |
| Presentation fallback | Ubuntu AppIndicators active; custom VOCO companion out of date |
| Existing profile | Onboarding completed; default `Alt+D`; no explicitly selected microphone. Profile contents were not modified or copied into Git |
| Build tools | Node 24.21.0, Rust 1.94.0; required native development libraries missing |

This is an existing laptop state, not evidence of a clean Ubuntu 26.04 reference
installation. The retained VOCO package, enabled services and OEM kernel matter
to the upgrade path. Qualification needs both this migration state and a fresh VM.

## Architecture judgment: retain the core, fix the integration boundaries

The latest candidate uses `speech_stream.rs` and `dictationStream.ts`, replacing
the older historical `benchmark_*` names. It deliberately pastes each chunk into
whatever has focus, with no desktop destination token or focus-probe machinery.
Read the candidate's committed AGENTS and architecture docs before implementation;
older checkout instructions describe a different delivery contract. This review
does not propose reintroducing the retired route as part of a GNOME port.

Retain one warm CPU Nemotron worker; the four-thread affinity-aware cap; 100 ms
packets and Stop-tail flush; the three-second backlog bound; native Wayland capture;
and the nonblocking separation between capture, recognition and paste. Keep the
tray-first interface, authentic microphone indicator, reduced motion, bounded
text-only recovery and no automatic replay after uncertain input.

The observed worker median service real-time factor is **0.235** on eight unpaced
clips, with about **965 MiB** peak sampled worker RSS. Neither is a full-app result,
an idle-memory measurement or a cross-OS speed comparison. There is no evidence
here that a new model, GPU backend, PipeWire-native rewrite, Electron migration,
or higher thread count is needed. Those changes would confound compatibility
verification and expand maintenance costs.

## Risks that remain decisions or experiments, not confirmed new defects

| Area | Current contract / evidence | Required treatment |
| --- | --- | --- |
| Focus changes | Every chunk goes to current focus; a successful helper call proves dispatch, not visible text | Test browser/editor/terminal switching explicitly. Do not promise destination ownership or password-field protection |
| PRIMARY clipboard | Failure to update PRIMARY warns but continues (`insertion.rs:763–776`); terminals may read PRIMARY | Test stale/unsupported PRIMARY and document outcome. Any change to failure policy needs a separate behavior decision |
| Unknown modifier state | Delivery proceeds when both evdev and companion knowledge are unavailable (`insertion.rs:368–375,393–405`) | Test restricted logins and held chords. Stronger fail-closed behavior is a safety/usability decision, not an invisible port edit |
| Lock and modal surfaces | Companion allows NORMAL/OVERVIEW; raw evdev is outside Shell routing | Test locking, unlocking, modal prompts and companion loss. No accidental capture/delivery to protected session surfaces; resolve policy explicitly if behavior fails |
| Clipboard bridge | This GNOME Wayland login has XWayland and candidate selects xclip | Keep the path until measured evidence justifies changing it; test native/XWayland recipients and failure when the bridge is unavailable |
| System permissions | Login currently has broad input-device read access and uinput access | Do not broaden groups or install permissive rules just to pass setup. Test standard-user and denied-permission paths |
| Layout and accessibility | Companion uses Shell's internal right/center panel boxes | Require visual, reduced-motion, large-text, RTL and crowded-panel evidence; no unmeasured redesign |

See the [phased proposal](upgrade-approach.md) for how these concerns stay contained
and the [validation gates](validation-plan.md) for what must be true before a
new package is called ready for this laptop.
