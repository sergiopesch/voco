# Foundations iteration 7 — input integrity and recognition comparison

This iteration makes replay evidence reject incomplete audio and ambiguous
requests, extends the Rust CI gate to every target, and tests recognition
alternatives against the existing base.en model. The production decoder has not
changed. Recognition acceptance and physical microphone qualification remain
open; this record does not establish worldwide superiority.

Evidence is retained in `foundations-evidence/iteration-7` beside this checkout.
The starting 803 source files matched the delivered iteration-6 inventory; the
archive SHA-256 is
`fb1342edcbd43ac71cda703261aff4a6521f14a2096a2aa452304abaf2f8c9a3`.
All three independent specialists use GPT-6 Astra. Native work is serialized,
with two build jobs and eight recognition threads. No stronger model, host
installation, physical recording, commit or publication was performed.

## Implemented replay input guarantees

The diagnostic replay worker previously truncated an incomplete WAV to its
available bytes and clamped an out-of-range request. A test against the retained
old parser reproduces the incomplete-file acceptance. Either behavior could
score a different recording from the one named in an evaluation plan.

The worker now requires the complete canonical mono 16 kHz PCM16 WAV layout,
matching RIFF/data/file sizes, whole nonempty samples, and consistent format,
byte-rate and block-alignment fields. It opens a regular file through one
descriptor, refuses Linux symlinks and special files, and bounds the read to
512 MiB of PCM plus the header. Combined evaluation corpora can exceed a single
recording's limit; the diagnostic bound does not change application capture.

Requests must select a nonempty in-file range. Full-session mode must select the
whole file and cannot also request canonical mode; only canonical mode accepts
a prior transcript prefix. Unknown fields and CLI arguments fail. JSON lines
are bounded to 1 MiB. A requested subwindow for a full-file peer CLI must first
be materialized as an explicitly bound, range-derived WAV.

Both CI and release validation now run `cargo test --all-targets`, including the
18 existing browser-fixture tests and 10 new worker-input tests that the previous
default-target command omitted. See the
[replay protocol](speech-adversarial-evaluation.md) for the exact contract.

Validation:

- 270 Rust tests pass across all targets; formatting, Clippy and DevOps checks
  pass. The existing vendored `unused_mut` build-script warning remains.
- The release example builds with the required `custom-protocol` feature. An
  earlier invocation without that feature failed and remains in the evidence.
- Ten malformed-file/argument CLI checks reject input before model inference.
  Seven invalid or oversized JSON requests exit without a transcript.
  Four additional boundary checks accept exactly 1 MiB and reject one extra
  byte, with and without a newline; these whitespace requests run no inference.
- Six actual recognition responses match the retained worker exactly: full,
  canonical and preview for each worker, including the complete diagnostic JSON.
  PCM conversion retains its original `/32767` normalization.

Retained worker SHA-256:
`b5936b6cae1ce4926818357e29b419f8e354a59b63fc6b81b413d0cf5fe4de89`.
The unchanged production `transcribe.rs` SHA-256 is
`259d688b9a74148dffef778b1127477329d27c4491a91f7513e828ab226ac19a`.
The iteration-6 Debian package remains the last qualified GUI package; this
example-only change does not replace it or constitute a new GUI qualification.

## Same-model Vibe file comparison

The official Vibe 3.2.2 Debian artifact and its bundled server 0.6.10 were
checksum-verified and extracted privately. Both file interfaces used the exact
existing model bytes and six independently verified audio slices. Neither
installed desktop application was exercised. Private namespaces had no network,
microphone or GPU access; the comparison needed no additional weights.

An initial 12-call batch failed preflight validity. Vibe's verbose flag also
enabled special-token serialization, and a misleadingly named continuity WAV
contained the entire 42.12-second recording rather than the intended 13.12-second
slice. Those outputs remain preserved and do not count as a fair comparison.
The prior native diagnostics had explicit correct sample-range arguments; an
independent range audit reconfirmed their bindings.

A corrected prospective plan removed the output-changing flag, derived the exact
continuity WAV, and independently verified all six references and all 12 command
lines before running once. All 12 processes exited successfully. Raw stdout is
retained; only terminal line endings are removed before the existing word scorer.

| Diagnostic case | VOCO S / D / I | Vibe S / D / I | Reference words |
| --- | --- | --- | ---: |
| Continuity second window | 0 / 0 / 4 | 0 / 0 / 5 | 23 |
| Isolated speaker 777 | 1 / 0 / 0 | 1 / 0 / 0 | 5 |
| Kirkleatham | 1 / 0 / 1 | 1 / 0 / 1 | 2 |
| Quiet speaker 1462, gain 0.01 | 3 / 1 / 0 | 3 / 1 / 0 | 33 |
| Natural speaker 251 | 0 / 0 / 0 | 0 / 0 / 0 | 14 |
| Natural speaker 174 | 0 / 0 / 0 | 0 / 0 / 0 | 8 |

Five cases have identical lexical output; Vibe adds one more word on continuity.
Single-trial wall time includes namespace launch, model load and process exit;
OS page caches were not cleared. GNU time's process-family maximum RSS is not
simultaneous summed process-tree memory or resource-cap qualification. Vibe's
PCM normalization (`/32768`), implementation and decoding defaults differ from
VOCO. These observations cannot isolate one decoder change or establish
population accuracy, statistical latency superiority or desktop experience.

`comparator/corrected/RESULTS.md` retains per-case timing/RSS and the full scope.
The corrected plan SHA-256 is
`a8e9595067e0617282d8f344fb042cb05f70bd092804659beacb246cbabde312`.

## Rejected timing-vote experiment

A fixed reference-blind rule compared six existing diagnostic utterances under
0, 5 and 20 ms leading-zero padding. All original PCM was retained and all 18
native calls completed once. Selecting the hypothesis with smallest total
pairwise word-edit distance regressed the repeated speaker-777 case by 17 edits;
mutually truncated hypotheses outvoted the less incorrect baseline. No case
improved under the frozen selection rule. Two exact natural controls stayed
exact, while the wrong isolated word and quiet-speech words remained stably wrong.

The repeated variants carried native failure flags and did not invoke production
recovery. This rejects the proposed diagnostic selection rule; it does not claim
the application emits those raw failures. Padding also crossed a native window
boundary, so the experiment does not isolate acoustic frame phase. All outputs,
flags and the rejected choice remain in `recognition-controls/`.

## Recognition ranking investigation

Ten teacher-forced sequences first tested five retained hypotheses on their
actual PCM and equal-length digital zeros. Both competing transcripts used the
same model prefix. The mean lexical log-probability difference between real and
zero audio favored the less incorrect transcript on two development pairs, but
also gave strong positive support to an incorrect isolated word. This is a
relative ranking hypothesis, not an absolute correctness test. Digital zeros are
an encoder ablation, not a representative nonspeech population.

A frozen prototype then retained the actual production canonical response as its
baseline and generated at most one full-context, temperature-zero, timestamp-free
alternative. It excluded production recovery routes. The alternative required
genuine end-of-text, no structural failure, and the existing log-probability and
no-speech checks. Entropy-only rejection remained an explicit annotation. Only a
strictly higher support difference could replace the baseline; references never
entered generation, eligibility, scoring or selection.

Independent review caught a representation defect in the first 19-call,
four-case experiment: production text was cleaned, while raw alternative text
retained a leading space. Tokenization therefore compared different surface
forms even for an otherwise identical transcript. That experiment remains an
invalid scoring preflight; its raw production and alternative decodes are retained.

The corrected v2 applies the exact production whitespace/tag cleanup to the
alternative before equality, scoring and selection. Seventeen pure tests cover
policy and cleanup. A frozen eight-call rescoring pass reused the original
decodes, with no regenerated hypotheses. All eight calls and summary-integrity
checks passed:

| Existing development case | Baseline S / D / I | Corrected selection S / D / I |
| --- | --- | --- |
| Continuity 13.12-second window | 0 / 0 / 4 | 0 / 0 / 0 |
| Quiet speaker 1462 | 3 / 1 / 0 | 2 / 1 / 0 |
| Leading 500 ms repeated speech | 0 / 1 / 0 | 0 / 1 / 0 |
| Isolated speaker 777 | 1 / 0 / 0 | 1 / 0 / 0 |

The repeated recovery case stays excluded, and the cleaned-identical isolated
word now skips scoring entirely. The continuity improvement is a window result;
it has not yet established correct joining across the full 42.12-second,
18-phrase recording. The quiet and isolated errors remain visible.

The corrected policy SHA-256 is bound by plan
`631e2aa63dd502ac5e9afa2561b25c641e006d01f7f178da978d8e89bfa30c21`.
The eight scorer processes took about 3.6 seconds per differing pair, in addition
to the earlier baseline and alternative decode costs. These process/model-load
measurements do not represent an optimized integrated application or its latency.

## Untouched-speaker validation

An independent source/reference inventory excluded all 28 previously evaluated
speakers from the 40-speaker archive. The remaining 12 speakers each contribute
one complete, deterministically selected utterance at original gain and gain
0.01. These are 24 paired recordings from 12 speakers, not 24 independent
subjects. They were unevaluated by this project; model-training exposure is not
known. The earlier 20-case qualification set was not rerun or used for tuning.

The original FLAC, complete PCM, quiet transformation, references and scored
ranges were independently verified before recognition. The plan is
`c527792ac9e473b1cdde1351b470c4baff4ca9e457f9df26b1dc48e2ab56a2fa`.
Acceptance requires successful nonempty output and no additional insertions,
deletions or total edits on **every** case compared with unchanged VOCO. Clean
and quiet strata are reported separately; aggregate gains cannot waive a failure.

Recognition consumes a reference-free input manifest; a separate scorer opens
references only after the selection file is finalized and hashed. Independent
review fixed nonfinite derived support, added raw-output hashes, and required
all twelve actual clean/quiet pairs. Five Python and seven JavaScript adapter
tests pass. Failed or timed-out experiments retain baseline text operationally
but count as measurement failures. No failed trial is replaced.

The independently reviewed adapter is frozen at
`142da00fc7cd18f95acd8386c18aef29e831d41ab5c28347123130bc2e65595b`.
All 24 relative non-regression gates and all 12 source-pair gates pass. Every
baseline was eligible; 21 alternatives were identical after cleanup and the
remaining three scored pairs retained the baseline. **No output was replaced.**
This is cold-set non-regression evidence, not a measured cold accuracy gain.

| Stratum | Recordings | Reference words | Baseline S / D / I | Selected S / D / I |
| --- | ---: | ---: | --- | --- |
| Clean | 12 | 233 | 5 / 0 / 3 | 5 / 0 / 3 |
| Quiet, gain 0.01 | 12 | 233 | 5 / 0 / 3 | 5 / 0 / 3 |

All 60 process attempts completed without errors or timeouts: 24 baseline,
24 alternative and 12 teacher-score calls. Summed process wall time is 53.251
seconds, including 20.657 seconds for baselines, 21.042 for alternatives and
11.553 for scoring. Complete per-case process costs have median 1.684 seconds,
p95 6.003 seconds and maximum 6.083 seconds on this host. These include fresh
process/model initialization and do not measure desktop response latency.

All raw-output and frozen source bindings were rechecked. Selection SHA-256,
frozen before reference scoring:
`5c70e7c39b61c9faf1a3a6a337873b3f8c477bbb02a2a8a67ae5f8e3cedc4d0f`.
The full report is `cold-controls/RESULTS.md`. No experimental selection rule is
enabled in the application.

## Next acceptance work

The corrected ranking policy now merits an isolated integrated candidate. It
still needs complete 42.12-second full/canonical accuracy, preserved recovery and
error behavior, the existing adversarial regression matrix, and persistent-model
latency/memory measurements. Timestamp-free text cannot inherit timestamps from
a different transcript: preview timing must stay on the qualified path until an
alignment method has separate evidence. The integration design is retained in
`decoder/integration-design/DESIGN.md`.

Historical recognition failures remain open. The six-case file comparison does
not replace representative peer application and human correction testing.
Physical microphones, installed GNOME/KDE sessions and real hardware lifecycle
qualification also remain open. Crabbox provider credentials are unavailable;
private local namespaces are useful evidence but do not provide a remote VM or
physical-device qualification. The quality goal remains active.
