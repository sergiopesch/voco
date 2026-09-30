# Held-out speech fixtures

Four clips of read English from
[LibriSpeech dev-clean](https://www.openslr.org/12/), 30.26 seconds from four
readers, two in each of the corpus's F and M categories. None of them reads in
the [development set](../README.md), so they give a small check of whether a
change that helps those eight speakers holds for others. Despite the folder's
name, they are ordinary clean recordings, not altered audio.

## Source

LibriSpeech is by Vassil Panayotov and is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); `LICENSE.txt` keeps
the corpus notice. The selection is fixed: leave out the eight development
speakers, take the next four speaker IDs in numeric order, 777, 1272, 1988 and
1993, and each speaker's first utterance in lexicographic order, chosen before
any recognition ran. Each WAV holds the corpus FLAC's samples, untrimmed, as
mono 16-bit PCM at 16 kHz, and the references are the corpus transcripts.

`manifest.json` records the archive with its MD5 and SHA-256, the license, the
selection rule and the excluded speaker IDs, and for each clip the reader,
speaker ID, category, archive member, SHA-256 of the FLAC, the WAV and its PCM
samples, reference, length and `maxWer`.

## Evaluate

`scripts/evaluate-dictation-worker.py` checks each clip's SHA-256, then streams
the clips into the worker of a provisioned `runtime/speech/`, as
[runtime provisioning](../../../../docs/linux-packaging.md#runtime-provisioning)
describes, without opening a microphone or audio device. It writes transcripts
and timings to a new directory, and `scripts/score-dictation-worker.mjs` scores
them. From the repository root:

```bash
/usr/bin/python3 scripts/evaluate-dictation-worker.py --runtime runtime/speech \
  --output /tmp/voco-held-out --split held-out
node scripts/score-dictation-worker.mjs /tmp/voco-held-out/run.json /tmp/voco-held-out/score.json
```

`--split all` adds the development clips. The evaluator sends 100 ms packets,
as VOCO does, unless `--packet-ms` says otherwise. Its Python needs NumPy and
psutil.
[TypeSafe evaluation](../../../../docs/testing/typesafe-evaluation.md) covers
the other options.

## Known limits

- Four clean clips from four readers are too few to rank models or settings,
  and say nothing about accents, noise, microphones or conversational speech.
- Neither `npm test` nor CI uses these clips, and no script applies their
  `maxWer` values.
- The references are in capitals without sentence punctuation, so scoring
  ignores case and punctuation.
