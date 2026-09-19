# Linux release development · 19 September 2026

**Not a release qualification or publication receipt.** Public/installed .42 stays
unchanged. The .43 candidate adds compositor control and packaging foundations;
hidden-window audio and the full desktop matrix remain open.

## Hyprland experiments

Booted KVM guest: Omarchy 4.0.3 ISO-derived userspace, Linux 7.2.6, Hyprland 0.56.2,
minimal Lua configuration, virtual audio and a native GTK recipient. This is not a
clean Omarchy installer/default-desktop acceptance run. No host microphone,
keyboard or clipboard was exposed to the guest.

| Trial | Application / change | Result |
| --- | --- | --- |
| Baseline hidden-window assertion | Frozen .42 | Failed: VOCO still mapped as a tiled window after Hide |
| Hide before recording | .42 with diagnostic GTK native hide | Tile removed; microphone request did not reach capture-active within 25 seconds |
| First delayed-hide setup | .42 diagnostic | Failed before onboarding; timer fired too early. Retained, not counted as dictation evidence |
| Hide after first delivered phrase | .42 with signal-triggered diagnostic hide | 14/14 words, second field empty, unmapped tile, Stop-to-idle 313 ms |
| Compositor `voco --toggle` | .43 development executable; native capture compiled but disabled | 14/14 words, second field empty, two socket triggers, Stop-to-idle 261 ms |

These are five attempts, including two deliberate negative controls and one setup
failure. The two completed dictation trials use one short public fixture; their
Stop times are single observations, not percentiles or a performance ranking.
The diagnostic preload is confined to the guest and is not a shipped fix.
No ten-minute continuity or physical-microphone claim follows from these results.

The observed failure boundary is a new WebKit microphone request while the window
is unmapped. At that stage native capture was a gated development option. Its promotion was
subsequently approved and qualified separately below.

## Native RPM profile tests

Native builds wrap the exact signed-public .42 Debian payload, not a .43 package.
Fedora 44 and openSUSE Tumbleweed ran in separate local Crabbox containers. They
share the host kernel and do not establish installed GNOME/KDE desktop readiness.

Both profiles passed native install, upgrade, reinstall and removal; full payload
comparison covered 218 entries and nine ELF objects. User settings survived
removal. RPM integrity checks passed. Under a minimal `nodocs` policy, all 14
explicit license files remained installed. Full-document parity was checked
separately with `--includedocs`.

The initial parity attempts failed because container policies excluded documentation.
The first specs also classified bundled license files as ordinary documentation;
those obligations could be excluded. The corrected generator uses `%license` and
tests the minimal-install case explicitly. Failed attempts remain in local receipts.
Test artifacts were unsigned and installed only in disposable test containers;
this does not establish a production signing or download channel.

openSUSE repository inspection found no provider of `libsentencepiece.so.0`.
A companion RPM builds the existing dependency from upstream commit
`31646a467d2051eb904e0b45de3a73e91fe1c1e3`, with an exact archive hash and source RPM.
The inherited test option `SPM_ENABLE_TEST` was ineffective. Corrected recipes use
`SPM_BUILD_TEST=ON`; CTest ran its upstream suite successfully and now fails if no
tests are discovered. The revised Arch 0.2.1-2 companion was also built in a fresh
local Crabbox lease: its one CTest suite passed, a disposable container signing key
was used for native installation, and `pacman -Qkk` reported 23 files with none
altered. The shared library resolved all dependencies. This test key is not a
public release trust root.

Both installed RPM workers subsequently completed the eight development and four
held-out public fixtures with context 1, four worker threads and 20 ms packets.
Each run had 238 reference words, six normalized lexical edits (2.52% WER), and
zero failed trials. These were unpaced worker-protocol checks under separate
two-CPU container limits, using the .43 evaluation harness at `9f8819d` against
the repackaged .42 runtime. They do not measure microphone startup, text appearing
in a recipient, punctuation accuracy or performance under a default desktop.

## Source validation

- 331 Rust library tests passed, including 11 trigger-transport tests.
- 15 native staging tests passed.
- Type check, Clippy, frontend build, version consistency and DevOps checks passed.
- ESLint: zero errors, four existing `no-explicit-any` warnings in recording orchestration.
- Full release CI, exact .43 artifacts and the complete compositor/application matrix
  remain separate gates. No TypeSafe live scores were generated for package checks.

## Outstanding release gates

Resolve hidden microphone startup, shortcut readiness presentation and output-service
setup; qualify the chosen capture path, actual Omarchy configuration and GNOME/KDE/X11
application matrix; exercise long sessions, failures and device lifecycle; build and
sign exact per-distribution artifacts; verify public downloads and only then upgrade
the reference installation. Physical microphone acceptance is recorded independently.

The public guide explains these boundaries. See [Linux support](../linux-support.md)
and [TypeSafe evaluation](typesafe-evaluation.md) for the distinct metric contracts.

## Native Wayland follow-up

The .43 candidate now includes native capture by default and selects it for
Wayland sessions. X11 retains WebKit capture. Explicit source selection and
app-session permission remain required; there is no idle recording or automatic
source switch. This product change is approved; release qualification is ongoing.

The work fixed two observed defects: browser-preview-only onboarding blocked an
approved native input, and an inline native source catalog exhausted the debug
capture thread stack. The renderer regression exercises the original blocked
Continue step; the catalog is now allocated and initialized on the heap, including
a small-stack regression check. The actual-App native renderer suite passes 42
cases with mocked native boundaries. Rust tests pass 380 cases with one explicit
offline export helper ignored, and frontend unit tests pass 438 with two existing
skips. These are code checks, distinct from the real VM tests below.

| Trial | Build and conditions | Outcome |
| --- | --- | --- |
| 04 | Diagnostic native capture and native-hide shim | Fresh setup and hidden Start; 14/14 normalized words; Stop 326 ms. Audit could not write under an untrusted ancestor. |
| 05 | Same diagnostic build; private runtime directory | Two recordings, 28/28 normalized words; Stops 382 and 285 ms; second field unchanged. |
| 06 | Diagnostic build, 577.68-second public repetition | 1,162/1,162 normalized words; Stop 4,444 ms. Harness terminated before audit persistence; no retained-audio qualification. |
| 07 | Production build; no development flag or hide shim | Fresh setup and native hidden Start; 14/14 normalized words; Stop 236 ms; second field unchanged. |

Trial 01 preserved a stack crash, and trials 02/03 exposed stale harness assumptions
about native accessible controls before recording. Trial 08 was not launched on its
first attempt because a harness replacement assertion failed. Failed attempts are
retained rather than reclassified as passes. Timings are single observations in a
four-vCPU software-rendered guest. Punctuation normalization is not punctuation
accuracy, field mutation is not painted text, and the minimal Hyprland session is
not a complete default Omarchy installation.

## Installed candidate and upgrade follow-up

The packaged executable is SHA-256
`f559d61b44c68d62cd0e9c3c1b3d3a066faceded3c5b45277551c9b3c6a7ad9c`.
The pre-package executable used for trials 09–12 is
`d091792369fdc8c55aa017d04d36e1c73bbd44def1d2381f32403c874c319e95`;
Tauri strips its packaged copy. Keep those identities distinct.

| Trial | Conditions | Outcome |
| --- | --- | --- |
| 09 | Pre-package production build; 577.68 seconds | 1,162 normalized words, Stop 1,102 ms; completed native/renderer audit and full-reference waveform pass |
| 10 | Same build; repeated sessions | 28 normalized words; Stops 240 and 233 ms |
| 11 | Same build; focus departure | Delivery halted; second field unchanged |
| 12 | Same build; virtual source removed | Explicit recovery and Copy passed without destination replay |
| 14 | Installed Arch package; Omarchy packaged defaults | Fresh onboarding and hidden Start; 14 normalized words; Stop 244 ms |
| 15 | Same installed package/defaults; 577.68 seconds | 1,162 normalized words; Stop 920 ms; complete audio verification below |
| 16 | Same installed package/defaults; repeated sessions | 28 normalized words; Stops 246 and 235 ms |
| 17 | Same installed package/defaults; focus departure | Delivery halted after the initial partial phrase; second field unchanged |
| 20 | Same installed package/defaults; source removal | Real tray Retry/Copy passed; zero automatic paste requests or field mutations during recovery |

The installed long trial verified all 25,508,763 frames and 26,171 blocks against
renderer retention, using an independently planned descriptor. Source waveform
correlation exceeded 0.9995 in all four quarters; the predeclared threshold was
0.90. Offline resampling was used only for waveform analysis. This proves neither
physical microphone quality nor the application's resampler in isolation.

Preserved failures include trial 08's small runtime-filesystem exhaustion, trial
13's stale compositor instance selection, trial 18's assumption that the harness
owned tray discovery, and trial 19's stale accessibility node. Corrected tests use
disk storage, the live compositor instance, the actual Quickshell tray and guarded
accessibility traversal. Trial 20 recovery took 52.65 seconds during concurrent
VM/container work; this is a measured slow observation, not a recovery-speed claim.
The guest has Omarchy 4.0.4/Hyprland 0.56.2 with packaged desktop defaults, but uses
direct kernel boot without an ESP. Limine hooks reported that limitation; missing
base services and pending Omarchy migrations preclude clean-installer acceptance.

Fedora 44 and openSUSE Tumbleweed local-container packages passed upgrade,
reinstall/remove, 225-entry/nine-ELF parity and 14-license checks. Their installed
workers each processed 12 public fixtures: 238 words, six normalized edits (2.52%
WER), with matching runtime hashes and transcripts. These are userspace/worker
checks, not default desktop or hardware-latency evidence.

Ubuntu 26.04, Debian 13 and Mint 22.3 upgrades exposed a real packaging defect:
dpkg retained legacy root-owned `0775` directories despite archive modes of `0755`.
The reviewed .43 postinst now repairs only that known mode on listed VOCO-owned
directories, preserving administrator overrides and user files. Six focused tests
cover idempotence, custom permissions, filtered docs, symlinks, ownership and hook
verification. All three corrected upgrade/reinstall/remove trials passed complete
225-entry/nine-ELF parity and settings-marker preservation. Their original minimal
image documentation filters were recorded; full parity explicitly retained docs.

Local Debian revision `2026.0.43+local2` has SHA-256
`35f692e0f224f7d8b05961c8054e47ff1ca25c8337154d02d4e2c15adcbdf829`.
It changes package metadata/documentation, retaining the same application bytes.
None of these local candidates is a signed public release. Final artifacts still
need exact-identity checks, required CI and the remaining desktop matrix.

## Two-core Ubuntu GNOME finding

A fresh account in the Ubuntu 24.04 GNOME Wayland VM exposed two additional gaps.
Ubuntu packages `ydotool` and `ydotoold` separately; the candidate now recommends
both and documents the required service without automatically widening input
permissions. The first trial correctly rejected an unavailable paste route.

With two virtual CPUs, the fixed four-thread recognizer took 35.37 seconds to load
and warm, exceeding the application's startup deadline. A controlled two-thread
run took 1.53 seconds (model load about 412 ms in both). The default worker count
now respects CPU affinity, capped at four, while explicit research overrides remain
unchanged. This is a startup result in one constrained VM, not an accuracy or
hardware speed claim. Previous trials retain their earlier worker identity.

The CPU-aware `+local3` Debian package has SHA-256
`762ed95dd2b4d089f41c4a982192c2f7099f53c16723c69852a38445beadbaf3`.
Its installed workers completed all 12 public fixtures on Fedora, openSUSE and
the two-core Ubuntu guest: 238 reference words, six edits (2.52% normalized WER)
and identical transcripts across those runs. The separate four-thread Ubuntu
corpus control was stopped after one fixture and is not a completed comparison.
No new TypeSafe semantic score or punctuation claim follows from lexical WER.

| Trial | Installed local3 desktop | Outcome |
| --- | --- | --- |
| 22 | Ubuntu 24.04 GNOME Wayland | Fresh setup, 14 words; Stop 385 ms; automatic two-thread warmup 2.11 seconds |
| 23 | Same guest, repeated sessions | 28 words, second field unchanged |
| 24 | Same guest, focus switch | Delivery halted, second field unchanged |
| 25 | Omarchy packaged defaults, Arch revision 3 | Repeated sessions, 28 words |
| 26 | Ubuntu GNOME X11 | Fresh setup, 14 words |
| 27 | Same X11 guest, repeated sessions | 28 words |
| 28 | Same X11 guest, focus switch | **Failed:** later words entered the second field |
| 29 | Repeated X11 failure with bounded diagnostics | **Failed again:** both client and Mutter decoration reported active |

## X11 destination regression

GNOME X11 exposes `mutter-x11-frames` as a separate active accessibility
application alongside the focused client. VOCO treated the pair as unavailable
focus metadata. A second defect allowed automatic paste with no bound destination
token, so the existing mismatch check could not protect the receiving field.

The fix excludes the identified decoration process from destination discovery;
other ambiguous active applications still fail closed. Startup rejects a missing
destination after shortcut acquisition, and the Rust insertion boundary rejects
missing or empty tokens before any desktop operation. Window-level identities
remain available for controls without accessible text readback; that limited
scope does not establish exact-field receipt.

Both the decoration regression and startup admission test failed before the fix
and passed afterward. The complete focus suite is now included in `npm test`.
Installed local4 trial 30 reran the original X11 scenario successfully: the first
field retained its already delivered prefix, the second remained empty, and
recovery was retained. The packaged executable is SHA-256
`47af238ffe96490f8a0b3a61587c5c75c65ed7d521aeab7eb203556a7117ea35`;
the local4 Debian package is
`aed0b9a7e00edf4ea33fdc58f10dbb1a45f82c108ba87241da54bad463861aeb`.
These are unsigned qualification candidates, not public release assets.

Local4 trial 31 passed two X11 recordings (28 normalized words); trial 32 passed
the same repeated-session scenario after restoring GNOME Wayland. The second
field remained empty in both. Code gates passed 381 Rust library tests (one
explicit export helper ignored), 438 frontend unit tests (two existing skips),
71 renderer lifecycle scenarios and 42 native-capture renderer scenarios. The
renderer suites mock OS/media boundaries; the VM trials exercise actual delivery.
Clippy and formatting pass. ESLint retains four existing orchestration warnings.

A fresh Fedora 44 cloud guest with installed GNOME required its packaged
AppIndicator extension to provide the tray. The Fedora package now recommends
that extension conditionally on GNOME, and installation guidance explains the
explicit user enable step. Trial 33 failed in fixture setup because a desktop
restart removed the virtual source; it is retained as a failed attempt and is
not dictation evidence.


## Fedora GNOME event backlog and openSUSE KDE

Fresh Fedora 44 GNOME trial 37 reached the real compositor shortcut but refused
capture because destination discovery had not settled. Instrumented trials 38–39
isolated a queue of approximately 970 accessibility events after hiding setup;
the previous 256-event limit could not drain it before the second startup probe.
A diagnostic-only larger cap passed trial 40. The product fix allows up to 4,096
events within 50 ms, returning unavailable if work remains. Regression tests cover
a queued focus change and an unbounded/slow queue; both failed before the fix and
passed afterward. All 27 focus tests and 41 delivery-observation tests pass.

Uninstrumented installed local5 packages contain executable SHA-256
`3573574ed4b0e6aac7401db5100cb1525e6da20730f4689361b02b22e32ee29b`.
Their complete Debian source payload is
`8e5ba40fa26933518ec5dc19239a991386191ef68fb604c6fd39a344c83987a6`.
Both native RPMs passed 225-entry/nine-ELF installed parity in their booted guests.
openSUSE full parity explicitly used `--includedocs`; its initial nodocs mismatch
remains recorded. These packages are unsigned local qualification artifacts.

| Trial | Installed desktop | Outcome |
| --- | --- | --- |
| 41 | openSUSE Tumbleweed KDE, local4 | Fresh setup, 14 normalized words; Stop 290 ms |
| 42 | Fedora 44 GNOME, local5 | Two sessions, 28 words; Stop 389/378 ms |
| 43 | Fedora GNOME, local5 | Focus change halted delivery; second field empty |
| 44 | openSUSE KDE, local5 | Two sessions, 28 words; Stop 470/496 ms |
| 46 | openSUSE KDE, local5 | Focus change halted delivery; second field empty |
| 50 | openSUSE KDE, local5 | Source removal, retained audio, explicit Retry/Copy; no automatic replay |
| 51 | Fedora GNOME, local5 | Same source-removal and explicit recovery scenario passed |

Failed attempts remain in the denominator: trials 34–36 encountered the GNOME
Overview rather than a focused recipient; trials 45, 47 and 49 exposed test-harness
tray discovery assumptions. GNOME's extension uses an `@` separator in registered
tray identities; correcting that parser preserves exact application-PID checks.
Trial 48 ran after KDE powered down its display; waking and unlocking the owned
guest preceded trial 50. These setup/harness failures are not successful dictation.

Both are cloud-image guests with distribution desktop packages, virtual audio and
GTK recipients, not physical microphone or complete ISO installation tests. Fedora
uses its packaged AppIndicator extension. openSUSE uses packaged Plasma branding,
SDDM and the full kernel's uinput module. The wider application matrix and final
signed-artifact acceptance remain required before publication. No new TypeSafe
semantic scores were generated by these system tests.

## Native application recipients

Installed local5 on Omarchy passed repeated dictation (trial 55), focus departure
(trial 57) and source-removal/manual recovery (trial 59). On openSUSE KDE, trial 58
passed 14-word delivery into the actual Kate editor with independent AT-SPI
readback. Trial 62 passed the same fixture into Konsole, with a private terminal
receiver recording actual PTY bytes; the text was never executed as a shell command.
The terminal received no Enter. These tests do not imply support for every editor.

Recipient adapter attempts 52–54 are retained: Kate forks its own application
process, requiring identity checks against the exact private document, and the
Python AT-SPI Text interface requires an explicit interface call. Failed adapter
cleanup left two test applications running before trial 56, exhausting the guest's
4 GiB memory and triggering a recorded OOM kill. Those owned processes were removed
before trial 58. Trial 56 is a failed trial, not a successful Kate result.

### Browser shortcut and CPU controls

Firefox trials exposed two independent failures. Alt+D activated its menu; an
instrumented DOM event trace and VM screenshot preserved that result (60, 63–65).
A Ctrl+Meta+D compositor binding allowed initial delivery, but held modifiers at
Stop interfered with the final clipboard gesture (66–68). An unused F8 binding
removed modifier interference, while the two-thread recognizer still exceeded the
bounded queue age in the two-core guest (69). The queue limit was not relaxed.

With F8 and an explicit one-thread control, trials 70 and 71 delivered all 14
normalized words, including final punctuation, into Firefox. Stop-to-idle was
2,004 and 3,033 ms; these are slow observed completions, not speed claims.
Trials 64 and 67 retained the earlier conflicting bindings and failed despite
using one thread; tuning alone did not fix the shortcut problem.

The next candidate leaves one CPU from process affinity available for desktop
work, with at least one recognizer thread and a maximum of four. Explicit research
overrides remain unchanged. New default cases failed before the implementation
and passed afterward; the 30 runtime tests and 33 control-panel tests pass.
Package acceptance and the full worker corpus must be repeated on these defaults.
Desktop integration guidance recommends an unused key without modifiers. It does
not silently change existing user shortcuts or grant keyboard-device access.

Installed Omarchy local5 trial 61 separately completed 577.68 seconds of repeated
public speech: 1,162/1,162 normalized words, the second field empty, Stop 829 ms.
All 25,512,291 frames matched retained renderer audio; offline full-waveform
alignment passed, with quarter correlations 0.9949–0.9951. This retains local5's
four-thread identity and does not qualify the changed default by itself.
