# Ending sentences at pauses, October 2026

**Question.** When you pause between sentences, VOCO's recognizer often runs
them together ("friend go. Do you hear he was young"). Can the worker end a
sentence where you pause, using only the recognizer's own output, without
ending sentences where you only pause to think?

**Answer.** Not with this recognizer. No policy passed the
[pre-registered](PREREGISTRATION.md) bar, so VOCO keeps today's behaviour. The
recognizer usually writes a comma or full stop only once it hears the next
word, so while you pause, nothing in the text says whether the sentence is
over. Asking the library to end the utterance there writes a full stop at about
nine in ten pauses between sentences, but also at about half of the pauses
inside a sentence. On held-out speech the best policy fixed 13% of sentence
ends where it acted and broke 46% of mid-sentence pauses.

The pre-registration was fixed at 11:34 UTC, before any policy ran (SHA-256
`401f2bd9…`); its addendum, for the exploratory runs, at 12:55 UTC. This record
describes measurements of 13 October 2026; VOCO's documentation describes how
it works now. Neither `npm test` nor CI runs this harness.

## Setup

- **Machine:** a laptop with an AMD Ryzen 7 PRO 8840HS, 4 threads per worker,
  shared with other work, so wall times are rough.
- **Recognizer:** VOCO's pinned Nemotron Speech Streaming English 0.6B
  (model SHA-256 `926495522ccd…`) on NeMo-Speech.cpp `a5b6953`, opened exactly
  as the worker's `bench_start` does, 100 ms packets at 16 kHz, right context 1.
  The worker code was byte-identical to master `c77e53d`.
- **Ending an utterance:** `nemo_speech_asr_stream_force_endpoint`, which the
  shipped C library exports. Its flush raises the logits of `.` and `?` by 7.5
  (`rnnt_greedy_decoder.cpp`), and the next utterance starts afresh.
- **Determinism:** repeated runs gave identical text and identical forced
  ends, so a policy's run is reused, exactly, for items where its decisions
  match an earlier run's at every point.

## Data

Public LibriSpeech-PC (CC BY 4.0), punctuated and cased, with the LibriSpeech
test-clean and test-other audio. Speakers alternate between dev and test, so
no speaker is in both, and none is a speaker of `tests/fixtures/speech`.

| Split | Speakers | Items scored | Minutes | Between-sentence pauses | Mid-sentence pauses |
| --- | --- | --- | --- | --- | --- |
| Dev | 37 | 206 | 56.6 | 201 | 95 inserted, 20 natural |
| Test | 35 | 198 | 56.2 | 195 | 93 inserted, 15 natural |

- **Between-sentence:** three consecutive utterances of one chapter, joined by
  pauses. A junction counts when the reference ends the first utterance with
  `.`, `?` or `!`; one that doesn't is a natural mid-sentence pause.
- **Mid-sentence:** one utterance cut at a quiet gap between two words that the
  reference doesn't separate with punctuation.
- **Pauses:** each junction gets 0, 0.4, 0.8, 1.2, 1.6, 2.0 or 2.5 s on top of
  0.3 s of the recording's own edges, filled with its own room tone (or pink
  noise at its noise level), never digital zero. Both kinds of pause get the
  same lengths.
- 11 dev and 8 test items are left out of every score, by a rule fixed
  beforehand that uses only today's output: the cut changed the words next to
  it.

## Policies

The worker hears a pause from the audio's energy against an adaptive noise
floor ([pauses.py](harness/pauses.py)), never from a lack of new words, so no
word still in the recognizer's look-ahead reaches the flush. Once a pause
reaches T after speech, the policy ends the utterance unless its text says the
sentence goes on:

- **E:** always;
- **EC:** not after a comma, colon, semicolon or dash;
- **EWA:** EC, and not after a, the, and, of, to, that, my and similar words;
- **EWB:** EWA, and not after auxiliaries (is, was, will…) or prepositions
  (in, for, with…);
- **EWAT:** EWA, and not when the text already ends a sentence.

T ran from 0.6 to 2.0 s.

## Results

S counts a between-sentence pause right when the text has a sentence end there
and a capital after it. M counts a mid-sentence pause right when it has
neither. PA is their mean.

| Dev | S | M | PA | WER | Full stop after |
| --- | --- | --- | --- | --- | --- |
| Today (P0) | 60.7% | 93.0% | 76.9% | 4.13% | |
| E, T 0.8 s | 82.1% | 49.6% | 65.8% | 4.43% | 0.88 s |
| E, T 1.2 s | 78.6% | 55.7% | 67.1% | 4.37% | 1.28 s |
| EWB, T 0.8 s | 81.6% | 62.6% | 72.1% | 4.38% | 0.88 s |
| EWB, T 1.0 s | 78.1% | 67.0% | **72.5%** | 4.40% | 1.08 s |
| EWB, T 1.5 s | 72.6% | 69.6% | 71.1% | 4.24% | 1.58 s |
| E, T 2.0 s | 67.7% | 73.9% | 70.8% | 4.21% | 2.08 s |

Every policy's PA is below today's, and every one's M falls by 19 to 47
points, against the 5 points allowed ([dev-table.txt](results/dev-table.txt),
with 95% intervals; "Full stop after" is the median time from the end of
speech). The best, EWB at 1.0 s, on held-out test:

| Test | S | M | PA | WER | Words dropped near pauses |
| --- | --- | --- | --- | --- | --- |
| Today (P0) | 67.2% | 87.0% | 77.1% | 3.27% | 0.7 per 100 |
| EWB, T 1.0 s | 75.4% | 58.3% | 66.9% | 3.46% | 1.7 per 100 |

Its PA fell 10.2 points, 95% interval 5.8 to 15.0 ([test-table.txt](results/test-table.txt)).

Where a policy acts, on pauses of at least T, it trades sentence ends for
mid-sentence pauses ([break-even-dev.txt](results/break-even-dev.txt),
[break-even-test.txt](results/break-even-test.txt)):

| Policy | Sentence ends | Mid-sentence pauses | Breaks even when sentence-end pauses outnumber mid-sentence ones |
| --- | --- | --- | --- |
| EWB 1.0 s, dev | 64% → 90% | 92% → 45% | 1.8 to 1 |
| EWB 1.0 s, test | 70% → 83% | 90% → 44% | 3.6 to 1 |
| E 1.2 s, dev | 64% → 90% | 92% → 23% | 2.7 to 1 |

Why it doesn't work:

- **The text is silent at a pause.** Of 2,859 decision points across the dev
  runs, 32 (1.1%) ended in a full stop and none in a comma: the recognizer
  usually writes its punctuation with the next word. So EC behaved exactly as
  E, and EWAT almost exactly as EWA.
- **Word lists catch a third.** Of the 50 mid-sentence pauses that E at 0.8 s
  got wrong and today got right, 19 ended in a comma or a listed word, and 31
  in words such as "story", "cart" and "difficult"
  ([cue-analysis-E0.8.txt](results/cue-analysis-E0.8.txt)).
- **The flush decides.** Its +7.5 bonus writes a full stop at most pauses
  either way.
- **A reset costs words.** The next utterance loses the words before it as
  context: "the lean, sullen apprentice" became "the lean soul and
  apprentice", and WER rose by 0.1 to 0.6 points.
- **The library's own end-of-utterance detector** (token silence, 800 or
  500 ms), in an exploratory run on the fixture clips, also dropped the word
  spoken as it fired ("He was young. Spear had touched him" for "young no
  spear").

Exploratory, outside the decision rule (addendum to the pre-registration):

- **More look-ahead** doesn't end sentences at pauses. At 560 ms, S was 61.7%
  on dev and 68.2% on test, against today's 60.7% and 67.2%. At 1.12 s, S was
  60.7% on dev. It improves recognition elsewhere: WER 3.73% against 4.13% on
  dev (interval −0.75 to −0.05 points) and 2.98% against 3.27% on test
  (−0.57 to +0.01), and more full stops are found
  ([lookahead-dev.txt](results/lookahead-dev.txt),
  [lookahead-test.txt](results/lookahead-test.txt)), at about 0.18 s more delay per word
  ([engine benchmark](../engine-benchmark-2026-10/README.md)).
- **Digital silence** in the pauses, through the worker's own gate, left S at
  65.1% against 63.5% on 59 dev items ([zero60.txt](results/zero60.txt)).
- **Pitch** before a pause hardly separates the two kinds: a lower final pitch
  marked a sentence end with an AUC of 0.60, and a falling slope 0.46
  ([prosody-dev.txt](results/prosody-dev.txt)).

## Limits

- Audiobook reading, not dictation, and pauses inserted at word gaps, not
  pauses people chose. Both kinds of pause got the same lengths; in real
  dictation, pauses between sentences may be longer or more frequent than
  pauses to think, which the break-even ratios above make concrete.
- One recognizer at one setting. A recognizer with more look-ahead for
  punctuation, or an explicit way to end a sentence, wasn't tested here.
- With no dev choice, the noise-margin variants (6 and 12 dB), the CPU
  comparison and `scripts/check-speech.sh` weren't run.
- Mid-sentence items avoid utterances already used in that speaker's
  between-sentence items, a choice the pre-registration doesn't name.

## Reproduce

With a copy of the installed speech payload and the LibriSpeech-PC downloads:

```bash
export VOCO_LAB_RUNTIME=/path/to/speech-payload VOCO_PAUSE_DOWNLOADS=/path/to/downloads \
  VOCO_PAUSE_AUDIO=/path/to/scratch NEMO_SPEECH_CPU_THREADS=4
cd harness
python3 build_items.py items.json
python3 run_policies.py items.json dev runs/dev P0 E:1.2 EWB:1.0
python3 summarize.py runs/dev P0 E:1.2 EWB:1.0
VOCO_LAB_CONTEXT=6 VOCO_LAB_NO_UNCUT=1 python3 run_policies.py items.json dev runs/dev-R6 P0
```

`archive.py` writes runs to [results/runs](results/runs): each run's final
text, the time each of its words took its final form, and its forced ends
(`EWB-1.0` is policy `EWB:1.0`). [results/items.json.xz](results/items.json.xz)
holds each item's references and pauses. The tables rebuild from those files
alone, with no audio or recognizer:

```bash
python3 harness/regenerate.py results
```

It says, for each table, whether the rebuilt one matches the committed one;
`prosody-dev.txt` needs the audio and isn't rebuilt.
