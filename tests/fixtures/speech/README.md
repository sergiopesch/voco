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

Predeclared smoke bounds: aggregate WER <=25%; each utterance <=50%; no empty
speech results. The current gate uses the production Nemotron streaming worker
with 100 ms packets and a final Stop flush. It also checks 18 repeated utterances
for continuity, empty output for 10, 20 and 30 seconds of digital silence, and
quiet speech, leading/trailing silence and a partial Stop packet. Retained
canonical and preview settings in the manifest belong to historical decoder tests;
the current runner does not exercise those retired modes.
These deliberately broad bounds detect major regressions;
they are not the desired accuracy target for the product. Extend the independent
corpus with consented conversational speech, accents, quiet/noisy microphones,
technical vocabulary, numbers, long pauses, and chunk boundaries before choosing
any stronger model. Do not tune recognition to these eight clips.

Provision the [pinned Nemotron model and native payload](../../../docs/linux-packaging.md#runtime-provisioning),
then run `npm run test:speech-baseline`. The default model path is
`runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`;
`VOCO_NEMOTRON_MODEL` may point to another absolute path containing the same
SHA-256-pinned bytes. No model is changed or downloaded by the test. The runner
uses `/usr/bin/python3` by default (`VOCO_PYTHON` can select another interpreter)
and requires NumPy and psutil as well as the native runtime dependencies.

The runner accepts `--report /path/to/new-report.json` and refuses to overwrite
existing evidence. CI uses `scripts/provision-ci-speech.sh` to extract the exact
checksum-verified versioned release payload, then runs this gate and
`runtime/speech/test_worker_protocol.py`. Ordinary `npm test` runs the source-level
scorer, signal-gate, diagnostics and session-policy tests; Python unittest discovery
does not execute the real-model protocol script. Rust tests are a separate gate.

The gate rejects unknown manifest schemas, empty/duplicate fixture sets, unsafe
paths, malformed checksums, invalid/missing limits, and references without words.
Reports include the model, fixture manifest, worker entry script and native-build
manifest SHA-256; checkout HEAD and dirty state at report time; per-clip transcripts,
WER, sample and hypothesis counts, elapsed times; and continuity, silence and
variant results. The entry-script hash does not cover its imported Python modules,
and the native-build manifest hash does not independently verify native binaries;
payload verification and the recorded source identity provide that context.
These are direct recognition-engine checks. Native Tauri IPC, microphone capture,
and target delivery require separate integration evidence.
