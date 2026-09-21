# Rich-editor review · 21 September 2026

## Problem and baseline

Installed .48 completed onboarding but inserted only the first word in the
owner's Codex attempt. Recognition continued into retained recovery. The helper
was available; the trace placed the failure about 3.2 seconds after paste began.
Read-only accessibility metadata showed a nested paragraph behind a U+FFFC root.
A private Chromium reproduction then pasted the first word successfully while
all five old observer polls remained pending. This isolated the confirmation bug
from speech recognition and Wayland helper installation.

Baseline source: `388d1fbaecc3d4703d6d3776127628127fcf4bb5`.
Installed baseline application SHA-256:
`2109b79ef11f59bf241449d54957a4bf3cdad3aa04ffabf211bebc34bac37f43`.
Private logs, screenshots, original failed attempts and artifact receipts stay
outside Git. No personal speech or recipient contents are included in this report.

## Changes and review coverage

| Area reviewed | Result / retained constraint |
| --- | --- |
| Onboarding and UI state | Recognition test remains local to onboarding; completion requires successful drain and desktop prerequisites. Stronger signal feedback changes display only. |
| Capture, source identity and Stop tail | Retain explicit device selection, sequence/sample checks, independent source limits and append-only tail forwarding. No capture/model tuning. |
| Recognition queue and native worker | Preserve session identity, bounded IPC, three-second backlog and safe-boundary restart. Lazy diagnostic fields and one-pass text metrics remove avoidable work. |
| Native input, focus and recovery | Fix nested paragraph confirmation, retain root/route identity and reject unsupported multi-paragraph selections before paste. Uncertain text is retained, never automatically replayed. |
| Error reporting | Remove repeated recovery wrapper; add finite observation-failure categories without logging field contents. |
| Shared audio helpers | Remove the unused allocating DC-offset variant; production callers retain the existing in-place function. |
| Config, lifecycle and packaging | Preserve private atomic configuration, single-instance ownership, pinned runtime/model and complete-package verification. New application bytes use .49. |
| Compatibility and docs | Keep Whisper, exact-field Chromium and IBus shortcut routes separate. Add rich-editor CI coverage; explain the failure in the guide while preserving its pinned source. |

This is a review of VOCO's authored runtime paths, contracts and verification
coverage. Passing checks do not establish correctness of every upstream library,
physical device or Linux application. Broad speculative refactoring was avoided.

## Verification

The original first-word reproduction is retained as a failing baseline. The new
real-browser suite checks first/subsequent chunks, a second session, disappearing
editor placeholders, formatted selection replacement, Unicode, one versus 1,000
paragraphs, paragraph departure, focus departure, wrong text and multi-paragraph
selection. Ten scenarios passed in the initial complete run. Earlier fixture
attempts and failures remain in private evidence; they were not discarded.

The built .49 application passed a fresh-profile journey on a private X11 display,
session bus and PulseAudio server. Onboarding completed using the pinned public
four-word speech fixture. Two Alt+D sessions delivered all eight expected words
through eight separately confirmed updates to a real Chromium rich editor.
A third session changed fields after the first update: recovery was retained and
the second field remained empty. The exact application hash and full receipts are
retained privately with the candidate. This is virtual-audio/application evidence,
not an owner-session Codex or physical Wayland trial.

Local checks passed: 36 focus and 58 observation regressions; TypeScript and lint;
445 frontend tests with two explicit skips; the full Python/Node suite; dictation,
microphone, native-capture and exact-field Chromium renderer checks; the five
brand/motion scenarios; guide regeneration and nine guide tests; and the patched
glib provenance and seven optimized iterator regressions. Rust all-target tests (523 passed, one explicitly ignored), Clippy with all targets
and features, and 66 native callback cases under ASan/UBSan also passed. The .49
complete Debian package was assembled with the pinned NVIDIA payload and passed
the package identity, dependency, desktop/AppStream and payload checks. Native
package-manager installation/removal passed in a disposable Ubuntu 24.04
container, including a clean `dpkg --verify` and removal of application, launcher
and runtime files. Its first attempt used the container's default documentation
exclusion policy and reported missing docs. A second fixture explicitly retained
VOCO documentation; both attempts remain recorded.

The exact packaged application was also rerun through the full fresh-profile
journey: onboarding passed, two sessions delivered all eight words through nine
confirmed updates (including punctuation), and focus departure retained recovery
without typing into the other field. The build-tree executable and packaged
executable differ only at Tauri's three-byte bundle marker, so both identities
are retained rather than treating their hashes as interchangeable.

Package SHA-256: `a7ae0a6333b3857171f22e4d35b626950b473e3526b5067284d7c51a203eaf51`.
Packaged executable SHA-256:
`4896ee2aa68e42e17ad62f0f7301ad26eaedd40fd03bbf3b1df0fa430284d236`.
The package's bundled docs retain their assembly snapshot before these final
receipts; the application/runtime bytes are identical to those tested.

The existing low-severity rand 0.7.3 advisory was rechecked against the current
feature tree. It remains a transitive build-generation dependency without the
required `log` feature; no exemption or forced major-version substitution was
added. See [the documented reachability assessment](../security/dependency-assessment-2026-09-04.md).
The npm audit reported zero vulnerabilities. Hosted RustSec and speech-accuracy
checks remain mandatory and are tracked on the pull request.

## Measurement boundaries

The transcript-metric benchmark uses public synthetic ASCII and Unicode strings,
eight alternating baseline/candidate batches of 500 calls after warmup. It tests
this calculation only, not recognition or speech-to-cursor latency. On this host,
median 500-call batch time fell from 276.6 to 102.2 ms for 72,000 UTF-16 units of
ASCII, and from 249.0 to 82.3 ms for the 54,000-unit Unicode case (63% and 67%).
These are small synthetic CPU experiments, not whole-app speed percentages. The real
clipboard suite reports preparation-to-observation timing separately from audio
and pixel paint. Five repeated deliveries per long-document case cannot support
p95 claims. No new accuracy, physical-microphone or universal compatibility claim
is made.

The visual curve previously rendered -32 dBFS at about 5.2 px in the center bar.
The candidate renders it at about 19.8 px, with silence stationary. These are
computed display responses, not measurements of the owner's microphone volume.
