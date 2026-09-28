# Cloud reliability review — 28 September 2026

Baseline: `17aa642e8816b154a8af854579c3cb2a279d8f96` on `master`.
This work changes source only; the public installer remains 2026.0.59.
It does not install software on the owner's laptop or publish a new package.

## Confirmed findings

1. Post-paste verification called the ordinary admission probe. When separate
   accessibility count/caret replies briefly disagreed, that probe discarded the
   destination token before the receipt reader could classify the sample as
   pending. The real-probe fixture reproduced premature cancellation.
2. Three shell validation commands supplied several filenames to `bash -n`.
   Bash checked only the first and treated the rest as positional arguments.
   A valid first script followed by a syntactically invalid script passed.
3. `desktopPhraseStream.ts` and `liveCommitPolicy.ts` had no active callers apart
   from a shared event type. They and their dedicated tests duplicated retired
   recognition/reconciliation concepts. Removing them deletes 1,294 lines;
   the production event type now lives with `BenchmarkPhraseQueue`.

The prior discussion's hypothesis of two competing live transcript owners was
not substantiated. Native phrase assembly, accepted hypotheses, dispatched text
and visible recovery are distinct facts with necessary owners. The production
queue's recognition/dispatch accounting is preserved.

## Changes and invariants

Only post-dispatch verification may classify an inconsistent position as pending,
and only after fresh focus, ancestry, process, window and token checks. Ordinary
probe, Start, prepare and pre-dispatch validation stay strict. Pending is neither
delivery confirmation nor permission to paste. Known content/route mismatch and
backward progress still reject; a later uncertain sample must not erase already
observed progress. Rust retains the existing bounded polling deadline and never
replays uncertain output. Ghostty's canvas remains a distinct dispatch-only route.

One shared shell checker validates every supplied path without running it. The
DevOps preflight, release rehearsal and release verifier use it. Its regression
suite rejects invalid scripts in each position, a later missing path and empty
input; valid paths with spaces are accepted without executing their contents.

No model, thread count, queue bound, focus permission, shortcut policy, dependency
pin or release gate changes. The legacy modules' tests are removed with their
unused implementation; active queue safety tests remain.

## Review and evidence

Three GPT-6 Astra specialists reviewed recognition, delivery and DevOps through
diagnosis, cross-review and integration challenge. Cross-review rejected a first
candidate that could let an indeterminate second sample mask a definite mismatch.
Final challenge also required retaining known forward progress across an
indeterminate sample so a later regression cannot appear unchanged.

The initial seven real-probe regression attempts against baseline produced four
failures and three passes. These are synthetic accessibility fixtures, not an
observation of the owner's failing application. Additional negative tests cover
the review findings. Focus/observation and shell regressions run locally; the
candidate PR's exact-head CI is authoritative for final wider results.

The final local suites pass 88 focus tests, 70 observation tests and four shell
validator tests. Existing release-verifier checks pass. These counts exclude the
removed test-only legacy pipeline; they do not imply full frontend verification.

Local Node 24 and Python source checks also verify single speech-engine metadata,
the tray/shortcut backport inventories, release-verifier tests and Chromium
background/content lifecycle. The cloud workspace cannot reach npm/GitHub through
its shell network and has no Rust toolchain or frontend dependencies. Files were
read through the GitHub connector and checked against Git blob hashes. This is
not a local full build; hosted CI must run typecheck, lint, frontend/Rust tests,
renderer/native desktop fixtures and checksum-pinned speech tests before merge.
The local speech unittest discovery attempt ran six entries with three import
errors because `psutil` is absent; it is not a passed speech-runtime test run.

Baseline `master` CI run `36315891568` failed in screenshot capture during the
brand fixture; subsequent desktop stages were skipped. Its earlier successful
Rust/speech checks do not qualify this candidate. A failed-job rerun was requested
to distinguish a transient capture failure; no assertion or required gate was
removed. Retain the original failed attempt as part of the evidence.

## Remaining acceptance boundaries

The fix explains a reproducible code path, not the exact cause of the owner's
reported Codex/ChatGPT Stop incident: no incident trace was available. New source
needs a separately versioned complete package, pinned runtime, signatures and
fresh install/upgrade/removal checks before release. Physical microphone,
keyboard/compositor concurrency and the owner's actual Ghostty, Brave and Electron
applications remain distinct from cloud fixtures.

The [personalisation plan](../architecture/personalisation-plan.md) is proposal
only. It starts with explicit local corrections and held-out evaluation, and
requires a safe pre-commit boundary before any live transformation.
