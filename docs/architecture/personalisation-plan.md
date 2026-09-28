# Personalisation after delivery reliability

Status: proposal only. No personal profile, model change or new runtime dependency
is introduced by the September reliability cleanup.

## Foundation

Keep the pinned Nemotron English 0.6B Q8 CPU recognizer, warm worker, bounded
transport and one production queue. The native adapter assembles recognition;
the queue distinguishes the accepted hypothesis from the dispatched prefix;
delivery validates the recipient. The removed legacy queue was not a competing
production owner. Do not rebuild it as a personalisation pipeline.

The current native wrapper exposes transcript text and a phrase-final flag to
Python. Its worker response exposes cumulative append-only text, not decoder
logits, alternative candidates or calibrated word confidence. NeMo/Parakeet GPU
phrase-boosting APIs cannot be assumed to exist in this pinned CPU ABI. Audit the
exact native source before proposing decoder biasing; changing engines is outside
this plan.

## Smallest useful experiment

1. Add an optional local vocabulary/profile experiment, outside automatic delivery.
   Ask for names and terms the person actually uses. A short calibration passage
   can suggest observed confusions, but cannot establish a reliable accent model
   or justify automatic correction from one example.
2. Present the original recognition beside proposed corrections in an explicit
   review surface. Store only corrections the user approves, with profile/schema
   version, source phrase, replacement, observation count and optional explicit
   context. Never infer edits by monitoring arbitrary application text.
3. Evaluate on separate calibration and held-out recordings, including ordinary
   words resembling personal names. Keep audio and raw transcripts local and
   outside the public repository. Provide view, edit, disable and delete controls.
4. Admit live use only after a matched experiment establishes benefit without
   unacceptable false substitutions or latency. The empty/disabled profile must
   preserve baseline output exactly.

Common ambiguities such as “free”/“three” and “cloud”/a product name must not become
global substitutions. Repetition counts are evidence counts, not calibrated
probabilities. Explicit vocabulary alone also does not reveal pronunciation.

## Live boundary, if the experiment passes

Personalisation belongs before irreversible delivery commitment, with one immutable
profile snapshot per recording. Retain raw recognition separately from transformed
output for explicit review. Never transform already dispatched text or repair a
phrase by replaying it into another application.
Retain the profile version and raw-to-transformed commit mapping with recovery.
Reprocessing retained audio with a changed profile requires explicit review; it
must not silently reinterpret the original recording or infer a safe paste suffix.

The present queue dispatches append-only updates immediately, including partial
words. A cumulative string-replacement hook would revise earlier prefixes as
words grow; it is not a safe drop-in feature. First define one explicit stable
boundary contract between the worker and queue. Options to measure are native
phrase-final boundaries (greater waiting time) or a bounded uncommitted token tail
with conservative word-boundary rules. Do not claim either is zero-latency. Keep
the identity/no-profile path unchanged and do not add a second phrase recognizer.

Candidate transform rules must be deterministic, bounded and conservative: exact
approved terms, longest-match precedence, explicit casing/punctuation rules,
no recursive replacements, and hard limits on profile size and pending text.
Uncertainty keeps raw text. If a transform fails, fall back only for text not yet
committed; preserve the already committed mapping. Stop flushes the tail once;
cancel, recognition failure and delivery rejection retain the existing contracts.

## Acceptance experiment

Use identical audio, source rates, package/model hashes, CPU affinity and thread
count in baseline/profile runs. Freeze the corpus and profile before testing;
report every attempted session, including failures. Include varied English
accents, unfamiliar terms, negative controls, silence, short utterances and long
natural speech. Calibration recordings must not count as held-out evidence.

Measure word error rate, personal-term error rate, false substitutions, exact
unchanged negative controls, CPU/RSS, and p50/p95 onset-to-first-word and
speech-end-to-final-delivery latency. Separately measure pure transform cost and
the waiting time introduced by its commit boundary. Proposed engineering targets
are under 1 ms p95 transform time per update and under 100 ms extra p95 delivery
latency on the reference CPU; these are targets to test, not measured results.

Run the same session semantics through Ghostty, a Brave text field and an
Electron editor. Preserve their actual assurance levels: Ghostty canvas dispatch
does not provide an editable-caret or content receipt. Test focus departure and
return, first-paste selection replacement, Stop during pending output, cancelled
startup, slow worker, profile edits during a recording and explicit recovery.

Ship only after delivery regression and pinned speech gates pass and a separately
qualified package demonstrates the benefit. No cloud speech, training, background
capture or new selectable model is needed for this experiment.
