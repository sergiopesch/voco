# Speech continuity regression

Run the unchanged pinned base English model through the real replay worker:

```bash
VOCO_MODEL_PATH=/path/to/ggml-base.en.bin npm run test:speech-continuity -- --report /path/to/continuity.json
```

This constructs a temporary PCM16 WAV from the existing licensed LibriSpeech
`84-121123-0000` fixture: eighteen repetitions, each followed by 250 ms of digital
silence. The deterministic result is 42.12 seconds and 72 independently referenced
words. Fixture, model, generated audio, runner and worker SHA-256 hashes identify
exactly what was evaluated. No model is downloaded or changed.

The fixed maximum word error rate is **15% for both full and canonical output**.
It was selected before evaluating the corrected merger, to catch the original
33.33% deletion failure while allowing the existing decoder's errors. It must not
be loosened to make a failed run pass. This small repeated-speech case is a
continuity regression, not a representative speech accuracy benchmark.

The current gate additionally requires the **exact normalized eighteen-phrase
sequence in both modes**. Word-error rate and phrase integrity are reported
separately; both must pass. This stronger requirement exposes the retained
nineteen-phrase result as a failure even though its four insertions pass the
historical WER threshold. The historical result is not relabeled retroactively.
Schema 2 reports include the integrity requirements and scorer hashes. An
existing report path is refused before inference and is never overwritten.

One persistent worker first runs the full pipeline, then sequential canonical
windows at 0–30 and 29–42.12 seconds. Every canonical response must preserve the
previous text byte for byte and equal `previous + appendText`; each next request
receives the preceding response. The report retains intermediate chunks and
records substitutions, deletions, insertions, recognized/reference word counts,
WER and elapsed time. Full timing includes initial process/model startup;
canonical timings use the already loaded model. This does not exercise native
IPC, microphone capture or application text insertion.

`node scripts/speech-continuity.test.mjs` verifies the exact fixture construction,
window coverage, rejection of rewritten or malformed canonical results, exact
repetition integrity and report preservation without running inference. It is also
part of `npm test`. CI and release checks execute the remaining independent speech
suites after a continuity failure, then fail the overall speech step.

The optional `token_timing_probe` Rust example compares identical decoder settings
with token timestamps disabled/enabled for a specified audio sample range. It is
a diagnostic only; application inference has not adopted token timestamps.
Estimated times do not establish an exact acoustic overlap boundary. Keep this
experiment separate from the fixed continuity gate.

## Repeated-speech phase diagnostic

The first continuity gate does not cover every alignment. The strict phase diagnostic
uses the same source phrase with ten predetermined 30-second windows: 0/50/100/250/500 ms
of leading silence or onset cropping. It reports every result and exits nonzero on any
empty speech result or WER above 25%. The fixed reference is thirteen repetitions; partially
cropped boundary words remain scored. Malformed replies and nonzero worker exits also fail.
Use a new evidence directory on each run:

```bash
CARGO_BUILD_JOBS=2 cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --example preview_replay_worker
VOCO_MODEL_PATH=/path/to/ggml-base.en.bin \
  python3 scripts/test-repeated-speech-phase.py --output-dir /path/to/new-phase-evidence
```

The iteration 3 baseline on 5 September returned empty text for leading 500 ms and onset
cropping 250 ms. Both reproduced with untouched `6ab2b2c` transcription source and identical
model/Whisper versions. Scoring also exposes the severe nonempty omission at onset cropping
500 ms. Historical results remain in the [iteration 3 record](foundations-iteration-3-2026-09-05.md);
they do not describe later candidates as passing. The original ten inputs are now included
unchanged in the broader [speech and hallucination evaluation](speech-adversarial-evaluation.md),
which also checks unseen offsets, natural/quiet speech, noise and complete utterances at
recording boundaries. Do not weaken its criteria or remove failing cases.

## Selecting the measured executable

The baseline and continuity runners accept `VOCO_SPEECH_WORKER` as an explicit
executable path. Use it to qualify the release replay worker built with the same
application features as the Debian package. Without it, the existing debug worker
path is used. Reports hash the executable actually invoked; a debug result does
not qualify a different release binary.

The report's `currentWorktree` records checkout context only. When overriding the
worker, use its retained build/source manifest to bind the reported executable
hash to source; do not attribute the checkout's transcription hash to an older
binary. Historical schema-1 and early schema-2 reports called this context `source`.
