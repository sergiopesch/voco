# Candidate history and release gates — 15 September 2026

**Current status:** +local7 was installed and positively owner-tested; the owner then
explicitly approved a 2026.0.37 release cut. [The current cut record](releases/2026.0.37.md)
supersedes historical pending-approval statements below. This approval covers a
private frozen cut for final benchmarking, not public sharing or new features.

Current follow-up: private **+local7** contains the [bounded legacy keyboard optimization](testing/keyboard-delivery-2026-09-15.md). +local6 was installed and successfully owner-tested. Older revision results below remain historical; use exact artifact receipts for the new candidate.

The application uses **2026.0.37**. Debian `+localN` revisions identify each
complete candidate package separately. It carries forward bounded diagnostics,
sampled field observation, conservative sentence joining and the corrected legacy
Wayland separator syntax. The pre-release review adds Stop-tail forwarding, idle
worker recovery and fewer repeated helper checks.
See [the observation contract](testing/delivery-observation.md). The unchanged
model/runtime is pinned. Installation and actual field results must be verified
separately; this source description is not a passing release gate.

The intended next public release is dictation-only. Deferred assistant/integration
paths are still present in this diagnostic build; hiding or disabling them remains
a separately tested release milestone. This is not a release cut or permission to
publish. See [quality diagnostics](testing/dictation-quality.md).

## Current candidate preparation

`+local6` was installed after the isolated review and positively owner-tested. `+local5` is the frozen
cross-Linux baseline, with passing normal five-userspace tests and a reproduced
delayed-reader Stop release blocker in bare and Openbox-managed X11.

`+local6` validation C passed its recorded fixtures. It scopes the existing X11 shortcut to the exact focused
window for the recording and final queue drain. It preserves target identity and
receipt checks; the earlier focus-loss exception proposal is superseded. The fixed
650-second scope, cleanup/degraded-health handling and request-copy reduction
require their own exact-artifact checks. See [the current review](testing/stop-delivery-review-2026-09-15.md)
and [the original failure and acceptance plan](testing/x11-stop-delivery-followup.md).
The final actor uses event-driven X/command waits; paired mechanism tests observed
36/36 callbacks versus 9/36 with the prior polling actor. This is controlled
callback availability evidence, not final recipient delivery or an atomic guarantee.
The strict isolated Stop matrix passed 34 selected cases from 35 attempts, including
20 overlaps and eight focus negatives. Model protocol passed 65 cases across five
userspaces. Normal route-specific continuation passed five selected cases from eight
attempts; native artifact qualification is reported in each artifact's external receipts.
active-owner full-app renderer reload remains unqualified because the packaged UI
provided no supported reload action. Deterministic epoch tests are separate proof.
Do not transfer `+local5`
passes to this later binary or resume owner-machine installation without renewed
instruction.

Renderer reload now invalidates shortcut ownership synchronously by epoch and
cleans only older scopes asynchronously; stale Begin cannot acquire or orphan a
new recording's scope. Generic paste IPC is not universally epoch-bound. Final
source checks passed 498 Rust test executions, 459 frontend tests with 2 optional
skips, full npm/20 assembler tests and static checks. The production build passed;
complete-package identity/install/remove acceptance is a separate per-artifact gate.
Fresh dependency audits found zero vulnerability-class findings; seven maintenance
and two unsoundness notices remain, with [bounded applicability analysis](security/README.md#current-dependency-audit).

Validation B attempted two native cases: its first 25 ms case completed under the
then-current harness; the next 250 ms case failed before capture became active.
Both remain historical evidence, and the first is not retrospectively credited
against C's stricter overlap/focus-negative gates. C separates consuming X11 callbacks
from passive evdev suppression during IBus polls, preserving debounce and authority
bounds. C's excluded original gap attempt lacked suffix-coverage preconditions;
the corrected fixture was rerun with identical production bytes. Report 34 selected
passes from 35 attempts, not 34/34 total attempts. Final package qualification is
recorded in external exact-artifact SHA/parity/install/remove receipts; packaged
docs do not embed their own package hash or automatically qualify another revision.

## Delivery sequence

1. Prepare a complete, traceable local candidate and record automated validation.
2. The owner tests it on the laptop, including the actual intended applications.
3. Resolve the owner's findings and obtain release-cut approval.
4. Cut the release, then run further artifact/installed testing before public sharing.

The candidate is not ready merely because model tests pass. Confirm these gates
against the accompanying candidate receipts; unrecorded results remain pending:

| Gate | Required evidence |
| --- | --- |
| Source/provenance | Baseline identity, exact changes, source/runtime/model hashes |
| Regression checks | Frontend, Rust, worker/protocol, privacy and error-path results |
| Complete package | NVIDIA assembler validation, payload manifest, package hash, notices/dependencies |
| Runtime replay | Capture-to-recognition-to-field assertions, completion/recovery, resource/timing scope |
| X11 Stop integration | Validation C strict matrix:34 selected passes/35 attempts;20 overlaps,8 focus negatives,2 held-Start,2 gaps,2 ordinary. Separate reload and uncovered scenarios need their own receipts. |
| Owner laptop acceptance | +local7 English session accepted; current-revision Brave/Ghostty and broader long-duration coverage remain separately scoped |
| Release cut | Owner explicitly approved after successful +local7 English laptop test; exact source and draft receipts required |
| Public sharing | Post-cut downloaded/installed artifact checks and owner sign-off |

## Source and evidence map

The `codex/dictation-delivery-2026.0.37` branch is the application source for this milestone. Local build and
installation receipts are recorded in the separately supplied delivery directory;
those absolute paths are not portable repository paths. The earlier candidate
`BASELINE.json`, validation reports and package receipts remain frozen evidence.
Consult the delivery index for exact artifact locations and checksums. A matching
version label alone does not prove a package or running executable has these changes.

Model weights and compiled native runtime artifacts are excluded from GitHub source.
The local candidate has the tested payload; fresh clones need separately provisioned
pinned artifacts before a complete build. See [runtime provisioning](linux-packaging.md#runtime-provisioning).
Updating a branch or review PR does not create or authorize a release tag.

The prior frozen `personal-benchmark-2026-09-14/round3` evidence contains the PDF,
63 selected trial records, configuration identities, rejected attempts, charts and
`DELIVERY-SHA256SUMS.json` (422 pinned files). It remains outside this source tree.
Do not copy personal audio/transcripts into public documentation or alter those
receipts to match a newer candidate. [This summary](testing/model-comparison-2026-09-14.md)
provides shareable aggregate measurements with their limits.

## Dependency checks for 2026.0.35

The 14 September 2026 audit identified and patched the Vitest development-tool
advisory GHSA-82fw-gwwq-j7x9 (Vitest and related packages now 4.1.11) and
RUSTSEC-2026-0285 (rustls now 0.23.45; rustls-webpki 0.103.15). No audit exemptions
were added. The fresh npm and Rust audits report zero vulnerabilities; the Rust
audit still reports seven unmaintained and two unsoundness warnings in upstream
dependencies. These warnings remain follow-up work, not evidence of a warning-free
or universally secure release. Dated security assessments retain their historical
counts. Re-run both audits for the eventual release commit.

## Legacy Whisper regression gate

The [14 September repetition-recovery investigation](testing/whisper-repetition-recovery-2026-09-14.md)
records the reproduced CI failure, rejected experiment and focused 12/12 candidate
result. All 76 broader unchanged-plan cases, baseline and continuity checks also
passed locally without worsened case scores. The .35 pre-merge and post-merge CI runs passed; .36 requires its own checks.
The owner requires the failure to be fixed and the required checks to pass before
merging; no waiver is authorized. This does not qualify all Whisper accuracy or
replace laptop acceptance and release-cut approval.

## Current boundaries

The local default is English NVIDIA Nemotron CPU streaming. Generic desktop paste uses bounded sampled readback for eligible accessible controls; unsupported controls still have best-effort focus checks and no recipient acknowledgement. Whole-message
post-Stop rewrite, universal editor support and physical Wayland acceptance are
not established. Qwen, Moonshine and Parakeet are research comparison adapters;
Whisper also remains legacy application code, but its tested offline adapter is
not the current streaming default. Model rankings are specific to the recorded
workloads and this hardware.

Dated documents under `docs/audits`, `docs/testing` and `docs/decisions` are historical
receipts or proposals unless explicitly referenced as the current contract. In
particular, early manual-copy-only and 30-second Whisper streaming limits must
not be presented as the current NVIDIA application's behavior.

## Latest owner acceptance and review

The .37+local2 Codex owner test failed because legacy Wayland ydotool interpreted
`space` as S. After installing .37+local3, the owner reported fast, accurate
streaming in Codex and supplied a correctly spaced transcript. Local metadata for
the corresponding 35.049-second session has matching queue-ingress sample totals,
53 dispatches and no recorded failures/drops. All recipient-content observations
were unavailable: the positive field result is owner evidence, not automated readback.

This supports that application/session only. A subsequent code revision requires
fresh candidate regression checks. Current-revision Brave/Ghostty, long-duration
physical use and broader accessibility coverage remain separate acceptance work.
No whole-message post-Stop rewrite was added or qualified.

See [the bounded pre-release review](testing/pre-release-review-2026-09-15.md) for
fixes, test coverage and unresolved release gates. Dependency audits on 15 September
report zero vulnerabilities; Cargo retains 7 unmaintained and 2 unsoundness advisory
warnings. These are not waived or reported as resolved.
