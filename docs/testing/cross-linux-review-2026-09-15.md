# Cross-Linux review — 15 September 2026

This is the historical `+local5` source-level record for a bounded cleanup, security-hardening
and distribution review. This records the measured scope; unqualified desktop behavior remains explicit. The owner requested isolated
testing and deferred installation; `2026.0.37+local3` remains installed and unchanged.
The previously prepared `+local4` package is the baseline. `+local5` has been built and tested in isolation. The delayed-reader stress case
is blocked by a reproduced X11 focus-grab limitation; no release readiness is claimed. No release cut,
publication or owner-machine upgrade is implied by this document.

For the later `+local6` candidate, read [the current Stop-delivery review](stop-delivery-review-2026-09-15.md).
The measurements and failures below retain their original candidate scope.

See [release gates](../release-candidate.md), [architecture](../architecture/README.md)
and [code ownership](../architecture/code-map.md). The
[previous pre-release review](pre-release-review-2026-09-15.md) remains historical.

## Changes in the next candidate

| Area | Problem and resulting behavior |
| --- | --- |
| Startup | Normal enhancement-off Cursor dictation uses the packaged NVIDIA runtime, yet startup previously ensured Whisper too. Backend startup now warms the selected NVIDIA worker and marks readiness only after its actual ready response. It does not download Whisper when NVIDIA warmup fails. Configured legacy startup and explicit Whisper commands retain separate preparation. |
| Warmup ownership | Importing the queue previously requested warmup regardless of settings. Backend startup now owns eager preparation; session starts share its serialized worker slot. |
| Streaming cleanup | Removed unused phrase-recognizer callbacks, segmenter and cadence scaffolding from the active NVIDIA queue path. The worker retains acoustic segmentation; Stop-tail forwarding, sample accounting and old-session cancellation guards remain. This is not a change of model or a claim of measured latency improvement. |
| Worker diagnostics | Metrics reject non-private or non-real directories and open owned regular single-link files without following symlinks. Nonblocking open avoids FIFO startup hangs. Invalid paths disable metrics with a finite warning while recognition continues; no unrelated target is chmodded. |
| Trigger socket | Runtime paths, fallback roots, ownership and modes are checked before binding. Accepted peers must match the current UID. Cleanup checks registered inode identity and safe parent state before unlinking; unsafe or replaced paths are preserved. |
| Report classification | Successful dispatch and finished terminal records are outcomes rather than failures. Cancellation, uncertainty, true failure and unclassified records remain distinct. Reclassified historical logs are not a new app performance run. |
| Debian dependencies | Declare `at-spi2-core` explicitly alongside the GI typelib so minimal userspaces receive the accessibility service required for eligible-field observation. |
| Documentation | Updated startup/network behavior, filesystem and socket protections, component ownership, distribution evidence levels and pending release gates. |

The selected model, Q8 artifact, context, CPU threading, default shortcut and UI
direction are unchanged. There is still one model-status slot in the tray: a later
explicit legacy failure may affect it. Configuration changes after startup use
lazy model preparation on the newly selected path. These limits are separate from
the startup fix.

## Baseline userspace results

The five completed runs below exercised the exact `+local4` packaged application
with its real local model, GTK/X11 destination and virtual microphone inside each
distribution userspace. They share the host kernel. They do not run the distribution's
default compositor or establish physical microphone, native package-manager install,
GPU/CPU portability, universal application support or visual paint timing.

| Userspace | Frozen run | Result | Independent destination checks |
| --- | --- | --- | --- |
| Ubuntu 26 | `ubuntu26/desktop-local4-event-loop-03` | Passed | 258 observed characters matched dispatch; other field untouched |
| Debian 13 | `debian13/desktop-local4-event-loop-03` | Passed | 258 observed characters matched dispatch; other field untouched |
| Fedora 44 | `fedora44/desktop-local4-03` | Passed | 258 observed characters matched dispatch; other field untouched |
| Linux Mint 22.3 | `mint223/desktop-local4-01` | Passed | 258 observed characters matched dispatch; other field untouched |
| Omarchy 4.0.3 official ISO-derived installer userspace | `omarchy403/desktop-local4-04` | Passed | Verified SentencePiece/audio dependencies; no installed Hyprland compositor |

Every completed row reported a finished terminal outcome, accepted/dispatched text
agreement, reconciled samples, no unresolved dispatch and no dropped-event count in
its collected metadata. The finite forbidden-key audit found no matches; this is
not a general proof that every possible log payload is private. Screenshots exist
for the Debian and Mint runs; Ubuntu and Fedora do not have screenshot evidence in
this summary. Field readback does not require a screenshot and is not compositor
paint measurement.

All five rows identify application SHA-256:

```text
de0f1655772abf39e25dbddd69cd05b4f992c8d3d97b6d6f9998a5e51bea1be0
```

Their common fixture SHA-256 is:

```text
f14939f24b0d2b18c8e50cda0a6ffd6bf17747b27f8fee7314222b2a1a2eae8f
```

The frozen aggregate receipt is in the separate workspace evidence tree at
`cross-linux-review-2026-09-15/platform/five-distro-baseline-summary/summary.json`.
Those paths are not files shipped with this source repository. Failed/setup attempts
remain in that evidence tree; the five selected passing rows are not a denominator
for every attempted run or every distribution.

## Security and negative-path verification

Independent static review traced explicit-tab Chromium authorization, bounded
native transport, IBus mutation rejection, local-model loopback requests and gated
private audio retention. No exploitable defect was established in those reviewed
boundaries. Coverage was bounded: not every source file, dependency or attack surface
was fully reviewed. Filesystem and trigger hardening respond to concrete failure
modes without asserting that a default remote exploit was demonstrated.

The regression plan includes symlink, hardlink, FIFO, permissions, wrong-owner,
unsafe fallback-root and replacement-inode cases; selected-model startup success
and failure; serialized worker reuse; and queue import with no native warmup call.
An isolated pure-dispatcher harness passed three tests covering 144 configuration,
environment and live-cursor combinations plus both selected-model failure routes.
It used minimal configuration representations, so that receipt does not substitute
for full application compilation or packaged startup testing.

See [security boundaries](../security/README.md) for ongoing guarantees and limits.
Keep negative-path tests in isolated directories and processes. They must not bind
the owner's sockets, change the live desktop, record personal audio or replace the
running application.

## Final candidate verification

The tested `+local5` application executable SHA-256 is:

```text
29c730cea29c86f1cf13c21c6804edc005f6ffdb15f0b64deac1806562ad8a71
```

The source passes 480 Rust test executions, 437 frontend tests (two optional replay
tests skipped), the complete npm suite, typecheck, lint, formatting, all-target /
all-feature Clippy and production build. Eighteen assembler tests and eight native
staging tests pass. Package metadata and complete model/native payload verification
pass with external URL checks explicitly disabled in the network-isolated job.
Online AppStream URL checks remain a release validation step.

All five userspaces pass 13 actual-model lifecycle checks each (65 total) and normal
full-app capture-to-field dictation. The five normal cases reconcile 9,102 metadata
records, captured/enqueued/responded audio samples and accepted/dispatched text.
Each produces 258 independently observed/dispatched characters, leaves the other
field untouched and reports no malformed or dropped-event records. This tests
transport fidelity on one public fixture, not general recognition accuracy.

Every final runtime case uses fresh isolated XDG paths with no legacy model cache
and disabled network. A separate Fedora invalid-worker startup case also passes:
NVIDIA startup reports its actual failure, leaves no Whisper model/partial download
and does not fall back to downloading another recognizer.

The initial Ubuntu delivery/recovery matrix passes nine of ten cases: normal,
same-caret, prefilled, selection, idle-worker, midword, focus-switch, worker-crash
and observation-timeout. Delayed-read remains a recorded failure: Stop can coincide
with uncertain destination observation before a synthetic 1.8-second paste completes.
VOCO retains recovery audio and does not replay uncertain delivery. The 822-sample
queue/capture difference is retained audio after queue failure, not proof of lost
recording. Keeping the test's GLib loop responsive does not resolve the failure;
paired heartbeat data falsified synchronous-loop starvation as sufficient cause.
The delivery guards are byte-identical to the previous candidate. Passive X11, GTK
and AT-SPI traces establish Stop keyboard-grab focus loss/restoration about 12 ms
apart, invalidating the pending receipt. The same failure reproduces under Openbox;
it is not solely a bare-Xvfb artifact. A managed real focus-switch negative test
passes and leaves the other field empty. The release remains blocked. No focus
epoch, destination guard or timeout has been relaxed.

Native RPM/Arch recipe development passed exact payload install/remove verification
on the preceding candidate; definitive `+local5` package receipts are kept with the
new delivery. They wrap identical prebuilt bytes, not independently rebuilt native
code. Documentation-only delivery reassembly must prove executable and runtime hash
parity with the tested package. A revision label alone is insufficient.

Current full results, failed attempts and native-package receipts live in the
separate `cross-linux-review-2026-09-15` evidence directory. Static security report
`security/report.md` applies to the immutable pre-fix source; hardening tests and
final integration review are separate follow-up evidence.

## Remaining gates

- Resolve or explicitly gate the delayed-reader focus/Stop stress failure before release.
- Verify definitive native package receipts and public signing/provisioning separately.
- Retain default-compositor, physical microphone and owner application acceptance as
  distinct coverage gaps. In particular, X11 tests in Omarchy installer userspace do not qualify Hyprland.
- Preserve the owner's installed `+local3` and configuration until renewed installation
  instruction. Owner acceptance precedes release-cut approval.
- Complete release artifact and post-cut testing before public sharing. Source changes,
  successful tests and a version label alone do not authorize publication.
