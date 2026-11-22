# Three changes to correcting by voice, November 2026

**Question.** The [first study](../voice-correction-2026-11/README.md) found
a fixed rule safe but short of its bar: the recognizer wrote a short phrase
differently the second time, a correction in a session of its own broke the
dictation's sentence, and changing text in another application was blind.
Does a change to each of the three move the result?

**Answer.** Each change helped, and each found a new limit.

- **Matching and leaning.** A looser rule, and a correction session leaned
  toward the words already typed, raised the right changes on the first
  study's test split from 82.4% to 92.4% (440/476) with no collateral change:
  safe and useful by the [pre-registered](PREREGISTRATION.md) bars, short of
  magic.
- **Said again (Study A).** With a second recording of the same words by the
  same speaker as the correction, the same configuration made the right
  change in 79.7% of held-out trials (94/118), where the first study's rule
  made 72.9%. That is one trial short of the 80% bar. The looser
  rule also made the record's first collateral changes: 4 of 572 trials on
  train-clean-100, all in one knitting pattern.
- **Two streams (Study B).** With the dictation's stream left open and the
  correction on a second, the resumed dictation was word for word what it
  was in one go, 100 of 100, and started with a capital no more often (26.5%
  both ways, against 97.5% in a session of its own). But at the key press the
  typed text was complete for only 56.7% of items; it took 0.8 s of silence
  to reach 97.5%, and feeding 0.4 s of silence changed the dictation's words
  in 19% of resumed items. The window bar is not met.
- **The field ladder (Study C).** In a GNOME Shell session on Wayland, one
  ordered procedure changed the text in 186 runs and refused in 276, with no
  field damaged in the seven pre-registered scenarios. An eighth, found
  during the run, did damage. [Its record](field-ladder/README.md) has the
  detail.

This record describes measurements of 22 November 2026. VOCO's documentation
describes how it works now. Neither `npm test` nor CI runs this harness, and
VOCO has no such capability.

## Setup

- **Machine:** the first study's cloud virtual machine, 4 CPUs, shared with
  other jobs, so no time here is a measurement of speed.
- **Recognizer:** VOCO's pinned Nemotron Speech Streaming English 0.6B (model
  SHA-256 `926495522ccd…`) with VOCO's look-ahead. Corrections ran through the
  real worker. Dictations in Study A, and everything in Study B, ran on lab
  streams opened as the worker opens them, because the worker's protocol
  gives no word times and holds one session at a time. Of 20 utterances put
  through both, 20 came out the same.
- **Data:** LibriSpeech test-clean, test-other, dev-clean, dev-other and
  train-clean-100, with LibriSpeech-PC references (CC BY 4.0). The test
  archives matched the SHA-256 the engine benchmark pins, and the dev and
  train archives the MD5 the corpus publishes.

## The two changes to recognition and matching

- **Rule 2** is the first study's rule, and only when that finds its two end
  words nowhere: end words nearly spelled alike, then one heard word dropped
  from either end, then both. `harness/rules.py` is the rule.
- **Leaning** starts the correction's session with the words of the typed
  window as its My words list.

On the first study's test split, against text the recognizer itself typed
(238 items, far and near trials together):

| | Right | Collateral, of all trials |
| --- | --- | --- |
| Rule 1, plain | 82.4% (392/476) | 0/952 |
| Rule 2, plain | 89.5% (426/476) | 0/952 |
| Rule 1, leaned | 87.6% (417/476) | 0/952 |
| Rule 2, leaned | 92.4% (440/476) | 0/952 |

**Safe** and **useful** are met; **magic**, at least 95%, is not. This is one
recording said once, as in the first study.

## Study A: said again

No speaker of LibriSpeech repeats a whole short utterance, but 390 clauses of
3 to 6 words, between two punctuation marks, are said by one speaker in two
different utterances. The study took all 59 held-out groups and 141 of
train-clean-100's, drawn by seed. A clause was cut from its recording in the
middle of pauses of at least 60 ms; 217 of 426 clauses could be cut that
way. The dictation is one utterance as recognized, and the correction
is the clause cut from the other.

| Rule 2, leaned | Other recording | Same recording |
| --- | --- | --- |
| Held out | 79.7% (94/118) | 87.9% (102/116) |
| train-clean-100 | 85.3% (244/286) | 91.0% (262/288) |

| Held out, other recording | Right | Collateral |
| --- | --- | --- |
| Rule 1, plain | 72.9% (86/118) | 0/236 |
| Rule 2, plain | 76.3% (90/118) | 0/236 |
| Rule 1, leaned | 76.3% (90/118) | 0/236 |
| Rule 2, leaned | 79.7% (94/118) | 0/236 |

- **Safe:** met on held-out data, 0 of 236. **Useful:** not met, 79.7%
  against 80%, one trial short. **Magic:** not met.
- **A second saying costs.** The clause from another recording made the
  right change 8 points less often than the clause from the dictation's own
  recording on held-out data, and 6 points less on train-clean-100.
- **Rule 2 can reach the wrong place.** On train-clean-100 it made 4
  collateral changes in 572 trials, 0.7%, where rule 1 made none. All four
  are one clause of a knitting pattern, "seventeenth row make one", near
  "sixteenth row seamed make one": with the first heard word dropped, the
  rest fitted the earlier row, and the rule took a word out of it.
- **Two attempts.** For the 7 train-clean-100 clauses said three times, near
  trials were right at the first attempt in 6, and a second attempt added
  none. Too few to say more.
- **train-clean-100 carries no bar:** the recognizer may have been trained
  on it.

[said-tables.txt](results/said-tables.txt) has every row. [confirmation.txt](results/confirmation.txt)
has the rows of the table before it.

### Post hoc

Of the 12 held-out near trials that rule 2 with leaning missed, at least 3
are clips the cut shortened ("to be or not", "you know" for "do you know",
"said m"), and most of the rest are names or words that sound like another
("as the kernel" for "asked the colonel", "here" for "hear").

## Study B: two streams

On the first study's test split, with lab streams.

| Typed text complete at the key press, after silence of | Items |
| --- | --- |
| 0 s | 56.7% (135/238) |
| 0.4 s | 89.9% (214/238) |
| 0.8 s | 97.5% (232/238) |
| 1.2 s | 97.9% (233/238) |

| Resumed dictation | Result |
| --- | --- |
| Same words as in one go, nothing fed at the key press | 100% (100/100) |
| Same text exactly | 100% (100/100) |
| Correction on the second stream, as on its own | 100% (100/100) |

| A resume item's first word starts with a capital | Share |
| --- | --- |
| In a session of its own (first study) | 97.5% (78/80) |
| After its previous utterance in one go | 26.5% (18/68) |
| On two streams, nothing fed at the key press | 26.5% (18/68) |
| On two streams, 0.4 s of silence fed there | 30.8% (24/78) |

- **Same words**, at least 95%: met. **Capital**, at most 10 points above one
  go: met. **Window complete** at 0.4 s, at least 95%: not met, 89.9%.
- **Silence is not free.** With 0.4 s of silence fed at the key press, the
  resumed items had the same words as in one go in 81.2% (65/80), against
  100% (80/80) with nothing fed.
- **What this means for a design.** The recognizer writes a word about half a
  second after it is said, so the last word or two are not typed when the key
  is pressed. Feeding silence to bring them out changes what follows. A
  correction would have to wait until the dictation's stream has written
  them, which it does once it gets more audio or the dictation stops.

[streams-tables.txt](results/streams-tables.txt) has the counts. Two resume
items had no previous utterance and were skipped. The capital shares in one
go and with nothing fed count the 68 items where the first word could be
placed in both texts.

## Limits

- Study A's clauses are read aloud in audiobooks, many of them "said the
  king" and its like, and are cut from longer recordings at short pauses.
  Half the clauses had no such pauses and were left out, and some cuts fell
  in the wrong pause. Its held-out result rests on 59 pairs from 38 clauses,
  so a few trials move it by several points.
- Study A shows a second saying of the same words by the same voice, not
  someone correcting. My words was empty.
- Study B's silence is digital zero and its correction a recording. A person
  pauses before pressing a key, and that pause is in the dictation's audio
  whatever VOCO feeds. Dev runs before the pre-registration showed a larger
  effect of silence on capitals (13 of 20) than the test split did.
- Two streams and word times came through lab access. VOCO's worker opens one
  session at a time.
- A right outcome compares words without case or punctuation.
- Rule 2 and leaning were designed on the first study's dev split and
  confirmed on its test split, whose aggregate results were already known.
- Nothing here types into a person's application, and none of it has a
  listener.

## Reproduce

With `runtime/speech` provisioned, Python 3 with NumPy, ffmpeg, and the first
study's results beside this record:

```bash
export VOCO_CORRECTION_LAB=/path/to/lab   # holds libri-pc/ and LibriSpeech/
cd research/voice-correction-primitives-2026-11/harness
python3 rules.py
python3 own.py ../../voice-correction-2026-11/results/items.json ../../voice-correction-2026-11/results/runs.jsonl ../results/own-trials.json
python3 lean.py ../results/own-trials.json ../results/lean-test.jsonl --splits test
python3 ownscore.py ../results/own-trials.json ../../voice-correction-2026-11/results/runs.jsonl ../results/lean-test.jsonl --splits test --leaned

python3 groups.py ../results/groups.json
python3 said.py select ../results/groups.json ../results/said-groups.json
python3 said.py dictate ../results/said-groups.json ../results/said-runs.jsonl
python3 cut.py ../results/said-groups.json ../results/said-runs.jsonl ../results/said-cuts.json
python3 said.py clips ../results/said-groups.json ../results/said-cuts.json ../results/said-runs.jsonl
python3 said.py trials ../results/said-groups.json ../results/said-cuts.json ../results/said-runs.jsonl ../results/said-trials.json
python3 said.py lean ../results/said-trials.json ../results/said-cuts.json ../results/said-runs.jsonl
python3 score_said.py ../results/said-trials.json ../results/said-runs.jsonl ../results

python3 streams.py ../../voice-correction-2026-11/results/items.json ../results/own-trials.json ../results/streams-runs.jsonl --splits test
python3 score_streams.py ../../voice-correction-2026-11/results/items.json ../results/own-trials.json ../../voice-correction-2026-11/results/runs.jsonl ../results/streams-runs.jsonl ../results
```

The scorers need neither the recognizer nor the audio: they read the recorded
runs in `results/`. `LibriSpeech/` holds the five sets named above.
