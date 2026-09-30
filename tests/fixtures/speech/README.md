# Speech fixtures

Eight clips of read English from
[LibriSpeech dev-clean](https://www.openslr.org/12/), 71.01 seconds from eight
readers. `npm run test:speech-baseline` streams them through the speech worker
and the pinned Nemotron model to catch large recognition regressions, and
desktop tests play some of them into a virtual microphone. Four clips from other
speakers are in [adversarial/](adversarial/README.md).

## Source

LibriSpeech is by Vassil Panayotov and is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); `LICENSE.txt` keeps
the corpus notice. The selection is fixed: the first four speaker IDs, in
numeric order, in each of the corpus's F and M categories, and each speaker's
first utterance in lexicographic order, chosen before any recognition ran. Each
WAV holds the corpus FLAC's samples, untrimmed, as mono 16-bit PCM at 16 kHz.
The references are the corpus transcripts, in capitals without sentence
punctuation, never VOCO's output. `manifest.json` records the archive, its MD5,
the selection rule and `maxAggregateWer`, and for each clip the reader, speaker
ID, category, archive member, FLAC and WAV SHA-256, reference, length and
`maxWer`.

## Speech baseline

`scripts/test-speech-baseline.mjs` needs a provisioned `runtime/speech/`, as
[runtime provisioning](../../../docs/linux-packaging.md#runtime-provisioning)
describes, and never downloads a model. It stops unless
`runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`, or the
absolute path in `VOCO_NEMOTRON_MODEL`, matches the SHA-256 in
`runtime/speech/MODEL-IDENTITY.json`. It runs `runtime/speech/stream_worker.py`
with `/usr/bin/python3`, or the interpreter in `VOCO_PYTHON`, which needs NumPy
and psutil.

The runner checks the manifest's form, and each clip's SHA-256, that its path
stays in this folder, and that it is a complete mono 16 kHz PCM16 WAV of
`seconds` × 16,000 samples. It streams each clip in 100 ms packets, then asks
for the final transcript. The worker must answer each request within 120
seconds and only ever extend the text it has returned. The run passes when:

- each clip returns words, with a word error rate of at most its `maxWer`, 0.5;
- the rate over all clips together is at most `maxAggregateWer`, 0.25;
- `84-121123-0000`, repeated 18 times with 250 ms of silence after each, comes
  back word for word as 18 copies of its phrase;
- 10, 20 and 30 seconds of digital silence return no text;
- `84-121123-0000` still meets 0.5 at a tenth of its volume, and with one second
  of silence before or after it;
- the worker exits with status 0.

The word error rate counts substituted, deleted and inserted words against the
number of reference words, ignoring case and punctuation, as
`scripts/speech-score.mjs` computes it. Every clip ends with a packet shorter
than 100 ms, so each run covers the partial packet at Stop; the
`partial-stop-packet` variant repeats the short clip unchanged.

```bash
npm run test:speech-baseline -- --report /tmp/voco-speech-baseline.json
```

`--report` writes a new file and refuses an existing one. The report records
the SHA-256 of the model, the manifest, `stream_worker.py` and
`NATIVE-BUILD.json`, the Git commit and whether the tree had changes, and each
transcript, score, sample count and elapsed time. CI provisions the runtime
with `scripts/provision-ci-speech.sh`, runs the baseline with `--report` and
keeps the report for 7 days in the `speech-regression-evidence` artifact.

## Other tests

- `npm test` checks the manifest and the format and length of every WAV here,
  without a model, in `scripts/speech-score.test.mjs`, and uses
  `84-121123-0000.wav` in other tests.
- Desktop tests play `84-121123-0000.wav`, and `1462-170138-0000.wav` for longer
  recordings. With `VOCO_BROWSER_LONG_CAPTURE=1`, the browser tests join clips in
  manifest order to at least 37 seconds, with 250 ms of silence after each, and
  hold the typed text to `maxAggregateWer`.
- `scripts/evaluate-dictation-worker.py` replays these clips by default, as
  [TypeSafe evaluation](../../../docs/testing/typesafe-evaluation.md) describes.
  [Testing](../../../docs/testing/README.md) lists every suite.

## Known limits

- Eight clean clips of read English catch large regressions. They don't measure
  dictation accuracy, and say nothing about accents, noise, microphones,
  conversation, numbers or technical words.
- The bounds are broad on purpose and stay fixed, like the clips. Don't tune
  recognition to them.
- The references are in capitals without sentence punctuation, so nothing here
  scores case or punctuation.
- The baseline tests the worker alone, not capture, Tauri IPC or paste.
- The manifest's `modelSha256` identifies the recognizer the bounds were first
  set against, not Nemotron. The runner checks only its form; the pinned model's
  hash comes from `MODEL-IDENTITY.json`. The worker hash in the report covers
  `stream_worker.py`, not the modules it imports.
