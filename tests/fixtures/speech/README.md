# Speech regression fixtures

Eight untrimmed utterances from [LibriSpeech dev-clean](https://www.openslr.org/12/),
copyright 2014 Vassil Panayotov, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Reader names, original paths, references, and checksums are in `manifest.json`.
Original corpus notice: `LICENSE.txt`. Audio was decoded losslessly from FLAC to
16 kHz mono PCM16 WAV; words, timing, and samples were not edited.

Selection was fixed before inference: first four speaker IDs numerically in each
F/M category supplied by the corpus, then the first lexicographic utterance for
each. This covers eight readers and 71.01 seconds, but only read English speech.
It is a small smoke/regression corpus, **not** an independently representative
dictation benchmark, demographic assessment, or evidence of category leadership.
The reference comes from the corpus, never VOCO's output. Normalized WER ignores
case/punctuation, retains lexical negation and digits, and reports S/D/I counts.

Predeclared smoke bounds: aggregate final-mode WER <=25%; each utterance <=50% in final
and canonical modes, and in preview mode when the complete clip fits the native
0.7–20 second preview range; no empty speech results. The 20.22-second clip
`422-122949-0000` therefore has no preview score. Silence checks cover final and
canonical output at 10, 20, and 30 seconds, and preview output at 10 and 20 seconds.
These deliberately broad bounds detect major regressions;
they are not the desired accuracy target for the product. Extend the independent
corpus with consented conversational speech, accents, quiet/noisy microphones,
technical vocabulary, numbers, long pauses, and chunk boundaries before choosing
any stronger model. Do not tune recognition to these eight clips.

Run `npm run test:speech-baseline` with `VOCO_MODEL_PATH` pointing to the existing
SHA-256-pinned `ggml-base.en.bin`. No model is changed/downloaded by the test.
The runner accepts `--report /path/to/report.json`. CI fetches only the existing
model with checksum verification and runs this gate; ordinary `npm test` covers
the scorer, transport, signal gate (Rust suite), and session policies separately.

The gate rejects unknown manifest schemas, empty/duplicate fixture sets, unsafe
paths, malformed checksums, invalid/missing limits, and references without words.
Reports include the model, manifest, and actual worker SHA-256; checkout HEAD and
dirty state at report time; Node/Rust/kernel/architecture details; and the modes
tested for each clip. A checkout identity does not prove an independently supplied
worker was built from that checkout: the executable hash records what actually ran.
These are direct recognition-engine checks. Native Tauri IPC, microphone capture,
and target delivery require separate integration evidence.
