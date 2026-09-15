# Pre-release review — 15 September 2026

This is a historical earlier .37 application review, not a release tag or publication approval.
Exact source, package, runtime and test receipts accompany the local delivery;
private audio/transcripts remain outside this repository.
For `+local6`, read [the current Stop-delivery review](stop-delivery-review-2026-09-15.md);
all measurements below retain their original candidate scope.

## Owner evidence

The owner reported fast, accurate Codex dictation on Debian .37+local3 after the
legacy Wayland Space-to-S correction. The associated 35.049-second session recorded
53 dispatches, matching captured/enqueued/responded sample counts at queue ingress,
no recorded failures and no dropped events. The editor did not expose recipient
readback, so visible correctness is owner-reported. No word-error-rate or universal
punctuation result can be calculated from content-free metadata.

## Reviewed scope and bounded changes

| Area | Finding and action | Evidence required |
| --- | --- | --- |
| Capture/Stop | Drained samples could remain only in recovery; forward the unstreamed tail before finish | Real hook/queue tests for drain, startup, cancellation and capture limit |
| Memory work | Stop copied the whole recording into an argument the queue ignored; remove the copy | Production-hook regression; no full-session copy on completed live input |
| Frontend lifetime | Delayed old paste callbacks could affect new-session diagnostics/cadence; bind callbacks to their originating session | Cancel/discard/restart regression |
| Worker recovery | A worker that exited while idle was treated as warm; check liveness at start/warmup and recreate only after known exit | Dead/live worker and no-replay tests, bounded failure metadata |
| Helper overhead | Wayland preflight scanned for the same daemon three times; reuse one fresh result per operation | One-scan/no-persistent-cache tests and isolated process-scan timing |
| Packaging | Missing browser-host detected only after model assembly; reject incomplete base first | Actual incomplete Debian fixture and unchanged final verification |
| Documentation | Version, delivery, installation and acceptance claims had drifted | Current guide alignment, links and release rehearsal |

The eliminated full-recording Float32 copy is 57.6 MB at five minutes/48 kHz
(115.2 MB at the ten-minute limit). This is avoided copying, not a measured reduction
in steady-state RSS or total retained audio. Audio recovery still retains samples.

A read-only process-scan microbenchmark measured median 63.864 ms for three scans
and 21.020 ms for one, eight trials per condition. That isolates redundant preflight
work; it is not a dictation or cursor-paint speedup. The model, CPU thread count,
key timings, shortcuts and UI direction are unchanged.

## Verification and delivery

Run focused regressions first, then full frontend/Rust/worker suites, types, lint,
format, dependency audits and the complete package verifier. Actual-model lifecycle
checks and controlled app field/recovery cases must use fresh output locations.
The reference laptop's `/usr/bin/python3` supplies NumPy/psutil/GI; do not assume a
bare Python executable resolves the same environment.

The complete local receipt names the exact tests and binary hashes. Repeated script
execution against frozen evidence directories is prohibited. No test that failed,
skipped or lacked a prerequisite should be counted as passing.

## Remaining release gates

- Obtain explicit release-cut approval after this review and candidate results.
- Retest the actual final candidate in intended applications; the positive Codex
  result belongs to .37+local3 and does not transfer automatically to another binary.
- Resolve/review the intended dictation-only public feature scope; optional assistant,
  OpenClaw and Realtime paths still exist and were not removed in this cleanup.
- Provision the pinned native runtime/model reproducibly for a clean release runner.
  Local bundled native libraries are not proof of portable distribution compatibility.
- Preserve dependency warning visibility: zero detected vulnerabilities does not
  remove the 7 unmaintained and 2 unsoundness upstream advisories.
- Keep publication separate from release-cut approval and verify downloaded/installed
  release assets before public sharing.

Whole-message refinement, universal rich-editor support, atomic desktop field
ownership, battery measurements and assistive-technology certification are outside
this review's evidence. Historical audits and model comparisons remain unchanged.
