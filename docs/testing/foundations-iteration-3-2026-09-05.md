# Foundations iteration 3 — approved exact-field boundary

Date: 2026-09-05. Worktree: `codex/foundations`, based on `6ab2b2c`.
This is an uncommitted development candidate. It has not replaced the installed
application or been published. The iteration 2 package remains a blocked historical
artifact; it does not contain this fix.

## What changed

The project owner approved suspending automatic IBus mutation and implementing local
application adapters on 5 September. IBus protocol 5 now rejects public mutation
commands in Rust and Python, and guards actual engine mutation sinks. It still
supports consuming recording shortcuts. Completed native dictation opens a neutral
**Transcript ready to copy** result; failure recovery remains visibly distinct.
The transcript cannot be silently replaced by another recording before explicit
Clear/Discard. In-memory audio, cancellation, retry, capture health and raw recognition
preservation continue to apply.

The first adapter is an explicitly enabled Chromium tab. It retains a concrete
DOM element and document nonce, checks focus, eligibility, value and collapsed
caret immediately before editing, and addresses that element with `setRangeText`.
It checks again after cancelable page `beforeinput` handlers. Hypotheses stay in
VOCO; only a completed result or canonical checkpoint reaches the adapter.
Password, readonly, disabled, private-marked and rich-editor fields are unsupported.

The local native messaging host authenticates the fixed extension origin and uses
same-user private Unix sockets. Native session generations prevent renderer reload
collisions. Exact token/document/request/sequence/Unicode-count receipts determine
completion. An uncertain edit is never retried automatically. Dispatch deadlines
reject ordinary queued edits after timeout under a shared-host-clock assumption.
Terminal recording cleanup addresses its original token, including rejected claims
and blocked starts; late cleanup cannot cancel a newer recording.

## Regressions found and repaired during this iteration

- Re-enabling a tab kept its old stop token.
- Browser newline normalization changed supplied text before reporting uncertainty.
- URL inputs also trim leading/trailing ASCII whitespace; the adapter rejects a
  proposed value that would be normalized before calling the browser edit API.
- Fast Stop before claim disconnected the browser transport.
- Replies from an old native connection could reach a new connection.
- Renderer counters could alias old native sessions after reload.
- Delayed page event handlers could outlive the broker's receipt timeout.
- A completed/rejected recording did not always release its browser token.
- Microphone or AudioContext startup failure could leave an unclaimed browser token
  waiting for a Stop forever; terminal failure now releases its original token, and
  stale cleanup after a replacement session cannot release the new origin.
- The extension badge could remain enabled after navigation or disconnection.
- Temporary removal/reinsertion and ancestor privacy/inert changes could regain
  eligibility; mutation history now permanently invalidates the captured session.
- Disabled fieldsets were not covered by an input element's own disabled property.
- Successful manual results still carried failure language/styling.
- The trace event test used a copied event list and missed new capture/result events;
  it now extracts actual frontend literal emissions.

Each production fix has focused regression coverage.

## Acceptance results

- TypeScript, ESLint, frontend production build and DevOps/release rehearsal pass.
- 220 frontend tests pass; two tests requiring private captured-user audio remain
  explicitly skipped. The fixtures were not fabricated or silently replaced.
- 200 Rust library tests and 18 native-host/socket tests pass; all-target strict Clippy passes.
- 104 Python tests pass. Private IBus/GTK/WebKit tests reject all automatic mutations,
  including identical-position fields and both shortcut/claim focus races.
- 34 renderer scenarios pass with explicit native/clipboard mocks and synthetic audio;
  the AudioWorklet path also exercises a real generated MediaStream in Chromium.
- 204 real Chromium recipient/native transport cases pass: 39 destination/lifecycle
  cases plus a 165-case normalization matrix across all five supported field types,
  11 control/whitespace codepoints and three insertion positions. Worker lifecycle
  tests also pass.
- The final rebuilt package passes final-only browser delivery, focus-loss recovery,
  actual accessible Discard, and another successful recording. Canonical delivery
  produced a 401-scalar checkpoint, preserved it exactly after focus loss, kept the
  alternate field empty through final idle, and accepted another recording after
  Discard. The canonical routing fixture
  concatenates five existing natural-speech fixtures in manifest order, each once:
  84, 1462, 1673, 1919 and 174, with 250 ms gaps, totaling 39.755 seconds. Selection,
  references and input/output checksums are recorded before inference. The nonempty
  checkpoint, unchanged acknowledged prefix and empty alternate-field gates remain.
- The final rebuilt package passes native final-only, canonical and focus-switch manual-Copy cases:
  actual clipboard contents match, both GTK fields stay empty, and zero mutations occur.
- Serial native checks render the full neutral result card and complete recognition
  in 740–743 ms; stop-to-idle is 834–841 ms on the four-word fixture. Three concurrent app
  instances plus browser tests took 22–24 seconds and produced one partially painted
  intermediate screenshot. Those stress observations are retained, not reported as a
  latency pass. The serial result is a measured fixture result, not a production SLA.
- The unchanged model scores 4/160 word errors (2.5%) on the small baseline and 4/72
  errors (5.56%) on the repetition-continuity fixture; the latter stays below the fixed
  15% regression threshold. Neither corpus proves general recognition quality.
- npm audit reports zero vulnerabilities. Rust audit reports zero vulnerabilities,
  17 unmaintained warnings and two unsoundness advisories. The existing
  [reachability assessment](../security/dependency-assessment-2026-09-04.md) is retained;
  warnings are not suppressed and a stack migration is not claimed.

The final development package is
`VOCO-foundations-iteration-3_2026.0.21_amd64.deb`, SHA-256
`3260f1195c2cb9fddd63275aaf3bc6f7248dbb6c6abd500216f517f5dfc53102`.
Its GUI executable is SHA-256
`7cbd6532a7203774705afad4c59312190a5ee9918cc1cd9ba3fc1e0bfec850a8`;
its native host is SHA-256
`6aae493e5992a092728401a5d2ba67ef081e89e72989a3b896ca3c02fdf981f9`.
These identities and evidence hashes are recorded in the
[final evidence manifest](../../../foundations-evidence/iteration-3/validation.json).
The report separates earlier intermediate packages, final exact-package browser
proof, and serial GUI proof. No GitHub hosted run or physical compositor test is
implied by a locally passing script.

## Existing-model failure discovered during acceptance

A live 37.44-second artificial repetition test acknowledged an empty first checkpoint.
The failing live run did not save its waveform, so its exact input cannot be replayed.
Subsequent captured runs preserved the fixture waveform and their saved checkpoint
matched direct replay. The original failed run remains in the evidence.

A fixed ten-case offline experiment then reproduced empty results on clean repeated
speech with 500 ms leading silence and a 250 ms onset crop. Both cases fail again
with the current worker **and the untouched `6ab2b2c` transcription source**, using
the same pinned model, Whisper dependency versions, decoder parameters and cleanup.
Eight other offsets produce text. This establishes a pre-existing recognition
limitation without involving microphone capture, IPC or browser delivery. It supports
an explanation for the live symptom, but cannot reconstruct the unsaved live waveform.

The stricter [phase diagnostic](../../scripts/test-repeated-speech-phase.py) records
all ten cases and exits nonzero on any empty result. Its known failures are separate
from the passing baseline/continuity and destination-delivery gates. The original
repeated browser fixture remains available with `VOCO_BROWSER_LONG_FIXTURE=repeated`.
No recognition parameters, speech model or silence policy were tuned to this fixture.
This limitation must be addressed and re-evaluated before claiming top-tier recognition
accuracy; the foundational delivery work does not resolve it.

## Measured boundaries

The speech model and decoder are unchanged. The checked small regression corpus is
not a representative dictation benchmark or evidence of a world ranking. The local
namespace harness exercises real WebKit microphone capture, native Whisper, GTK,
Chromium and native messaging without using the active desktop input session.
It is not an installed distribution/compositor certification or a remote VM.

The browser adapter supports only top-frame textareas and text/search/url/tel inputs
with a collapsed selection. Canonical streaming retains the existing 30-second
checkpoint windows; short recordings deliver when stopped, not as speculative text
in the field. It does not preserve browser-native undo history, support
rich editors, or certify confined browser packages. A page can read text deliberately
inserted into its own field. No semantic private-field classifier is claimed.
Browser tests disclose a localhost-only test grant in place of a physical toolbar
permission click. Physical Wayland/GNOME/KDE input, browser-store distribution,
real microphone/noise/accent diversity and a broad application matrix remain separate
qualification work. No stronger speech model was introduced.

## Reproduction

Use `npm test`, `npm run check`, `npm run lint`, Rust tests and strict Clippy first.
`npm run test:dictation-renderer` tests renderer lifecycle with explicitly mocked
native operations; `npm run test:chromium-exact-field` uses actual isolated-world
extension code. The `--native` browser option also uses the real native host/broker.

Build through `bash scripts/build-desktop.sh`, then verify the `.deb` with
`scripts/verify-deb-package.sh`. Extract it into a disposable directory and pass
its executable/native host/extension paths to the native application fixtures.
The release workflow runs manual Copy and browser capture-to-field gates against
that extracted candidate, preserving evidence and refusing a failed gate.

See [adapter contract](../../integrations/chromium/README.md),
[broker contract](browser-broker.md), [approved decision](targeted-delivery-decision.md)
and [native isolation](native-isolated.md). The
[evidence index](../../../foundations-evidence/iteration-3/README.md) distinguishes
the final package from intermediate and failed artifacts, and includes an archive
of the uncommitted source snapshot.
