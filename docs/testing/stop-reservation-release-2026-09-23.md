# Stop reservation and installer release qualification — 23 September 2026

VOCO **2026.0.59** is published with signed assets. Application/package
build: `4bf7f5d135728a763a6011d6960246a8feec989f`. Tagged merged source:
`6aee7a8dd343700723ceecf6dec8f1639c154f8e`. The qualified build and tagged merged source have identical product bytes.

| Artifact | SHA-256 |
| --- | --- |
| Complete Debian package | `949b9a2550c6b5b3b58441b764b29f858a39bf9eb8b6b29678fab1f8150ac9d3` |
| Packaged app | `dd0fa34afcd186420c13b72ae094073d2849059c4f0e289fd13a350e22601dd7` |

## Findings and fixes

The final review-thread sweep after .58 publication found that a false GNOME
reservation reply was ignored. The latest rejected/error reply now releases the
grab; generation checks prevent older replies from revoking a newer renewal.
Real nested GNOME reproduced the failure before correction and passed afterward.
Post-merge CI then caught held Stop loss: a status revision could reject a renewal
for the same capture. A forced real-GNOME reproduction failed before correction.
Reservations now bind the epoch, capture and exact accelerator, independent of UI
revision. Explicit Stop carries its capture identity through native dispatch and
renderer admission; stale events cannot stop a replacement recording. A valid
session-bound Stop also survives ordinary hotkey readiness blocking. Both forced
reservation and Action revision races pass. The actual renderer passes 58 cases.

The final companion contract is version 4, including upgrade detection for version 3
source-development archives. Metadata and the setup helper move together, so old loaded code
requests sign-out/sign-in instead of being reported current.

Full installer checks exposed a second race: a progress child could receive TERM
before resetting inherited cleanup. Cleanup now checks its original BASHPID before
any terminal, file or process action. The observer inherits its private log
descriptor before fork, including early shutdown diagnostics. A deterministic
regression proves child cleanup is attempted without touching parent resources,
and that parent EXIT still removes its files/log and reaps its tracked process.
Independent Standards and Spec reviews found no remaining confirmed defects in
the final corrections. Earlier .58 review threads are resolved by the combined fixes.

## Final-byte qualification

- Six Brave Stop sessions across Wayland and X11 preserve the phrase, including
  held/repeated Stop; ten Ghostty/application cases pass.
- Ten browser cases pass, including **309.18 seconds** of public-fixture
  speech. The complete reference and 34 selected segments were fixed
  before inference: 677 reference words,
  672 hypothesis words, **2.07% WER** in this run.
  This is a regression result, not a general accuracy or hardware benchmark.
- Packaged GNOME tests cover rejected latest reservations, older replies, held and
  replaced sessions, upgrade/restart detection and bridge authorization.
- Native Wayland onboarding retains complete audio accounting and the private
  clipboard. Detached installer launch passes on X11 and Wayland without unsolicited capture.
- Clean Ubuntu 24.04 local-container install/remove verifies 414
  inventory entries, 10 ELF objects, 13 real installed-worker
  checks and removal of 336 package paths. Owned containers are stopped.
- 393 desktop unit tests, 286 Rust unit tests and 32 Rust integration tests pass; one existing fixture-export test
  remains ignored. Strict Clippy, source/renderer, dependency and DevOps checks pass.
  Installer coverage includes 12 performance tests, six journey groups and 20
  repeated animated/reduced-motion journeys. All four protected and exact merged
  CI jobs pass, including the pinned speech gate. No gate was waived.

[Protected CI](https://github.com/sergiopesch/voco/actions/runs/35910898321) ·
[Merged-source CI](https://github.com/sergiopesch/voco/actions/runs/35911568200) ·
[Signed release](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.59).

The signed tag, five signed manifests and all 18 assets were independently checked
locally, as draft downloads, and anonymously after publication, including latest
aliases and the tagged installer. Model/runtime and private input daemon bytes
match .58. Published validation/provenance bind source and package identities. GitHub reports
its immutable-release flag as disabled; published bytes are frozen by project
policy and checked against signatures and recorded hashes, not platform locking.

## Boundaries and retained attempts

Tests use private displays, buses, clipboard, profiles and public/synthetic audio.
They do not qualify physical microphone or evdev/uinput concurrency, default
PipeWire, Brave Snap confinement, or every desktop. Native key gestures remain
non-atomic with recipient changes. Terminal dispatch does not prove protected-input
state or caret/text readback. The current GNOME companion must be loaded to consume
Stop. Without it, selected continuations are retained for recovery rather than
replacing words. The ten-minute session bound remains; recovery is in memory until
copied, discarded or the app closes. The existing low Rand advisory remains visible;
its required feature/logger preconditions are absent, with no audit waiver.

Failed pre-fix tests, incomplete early fixture attempts, the missing-header-path
build, stale container staging, stale launch-fixture hash rejection, the failed
post-merge lifecycle gate and corrected renderer fixture mistakes remain
retained separately. The first authenticated draft download stalled; its failed
attempt was retained and a fresh full-byte verification was required before
publication. None count as passing final trials. Private desktop fixtures
were archived before cleanup; redundant copied fixture dependencies were removed.
The owner's installed .57 app and profile were preserved. Published .58 assets
remain unchanged; this release corrects the issue found after that cut.
