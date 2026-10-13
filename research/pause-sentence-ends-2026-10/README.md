# Ending sentences at pauses, October 2026

**Question.** When you pause between sentences, VOCO's recognizer often runs
them together ("friend go. Do you hear he was young"). Can the worker end a
sentence where you pause, using only the recognizer's own output, without
ending sentences where you only pause to think?

**Answer.** Not with this recognizer. No policy passed the
[pre-registered](PREREGISTRATION.md) bar, so VOCO keeps today's behaviour. The
recognizer usually writes a comma or full stop only once it hears the next
word, so while you pause, nothing in the text says whether the sentence is
over. Asking the library to end the utterance there writes a full stop at nine
or more in ten pauses between sentences, but also at seven or more in ten of
the pauses inside a sentence. On held-out speech the best dev policy fixed 18%
of the sentence ends where it acted and broke 54% of the mid-sentence pauses.

**Correction, 13 October 2026.** Review of this record (PR #176) found that its
first build gave the two kinds of pause different quiet. A between-sentence
junction kept both utterances' trimmed 150 ms edges, about 0.3 s, on top of its
inserted pause, while a cut between two words got only the inserted pause. At
the same nominal length a mid-sentence pause was about 0.3 s shorter, which
favoured the policies, and the statement that both kinds got the same lengths
was wrong. Measuring each pause with the policies' own tracker then showed a
second flaw, which affected both kinds: many fills weren't quiet to it. Its
noise floor follows a recording's quietest 60 ms, and many recordings fall far
below their room tone between phrases, so the room tone or pink noise in a
fill read as speech. At pauses of at least 1.2 s the energy policies never
fired at 12% to 33% of junctions.

The items were rebuilt so that every junction's quiet, as the tracker hears
it, is its inserted pause plus 0.3 s for both kinds
([quiet.txt](results/quiet.txt)). A fill now tops up the quiet a junction
already has, from the recording's own frames within 3 dB of its quietest 60 ms.
P0 and every policy were rerun, and the tables below are from the rebuild. The
pre-registration is unchanged, and the first build's results remain in this
record's history (commit `6cf87b1`). **The conclusion didn't change, and the
gap widened**: with every pause audible, the policies fixed more sentence ends
and broke more mid-sentence pauses. The best dev PA fell from 72.5% to 70.1%,
against 76.9% today, and on held-out test EWB at 1.0 s lost 13.7 points of PA,
where the first build showed 10.2.

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
| Dev | 37 | 203 | 57.2 | 201 | 92 inserted, 20 natural |
| Test | 35 | 197 | 56.8 | 195 | 92 inserted, 15 natural |

- **Between-sentence:** three consecutive utterances of one chapter, joined by
  pauses. A junction counts when the reference ends the first utterance with
  `.`, `?` or `!`; one that doesn't is a natural mid-sentence pause.
- **Mid-sentence:** one utterance cut at a quiet gap between two words that the
  reference doesn't separate with punctuation.
- **Pauses:** each junction gets 0, 0.4, 0.8, 1.2, 1.6, 2.0 or 2.5 s,
  round-robin, and its quiet, as the policies' tracker hears it, is that plus
  0.3 s for both kinds: a fill of the recording's own quietest frames tops up
  the quiet the junction already has, never digital zero. The measured quiet's
  median is its target; 100 of 639 junctions fall more than 0.06 s short, 2
  are more than 0.1 s long where the word gap itself was longer, and each
  kind's mean is within 0.05 s of the other's at every length
  ([quiet.txt](results/quiet.txt)).
- 14 dev and 9 test items are left out of every score, by a rule fixed
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
| Today (P0) | 62.7% | 91.1% | 76.9% | 3.97% | |
| E, T 0.8 s | 87.6% | 36.6% | 62.1% | 4.37% | 0.88 s |
| E, T 1.2 s | 81.6% | 44.6% | 63.1% | 4.17% | 1.28 s |
| EWB, T 0.8 s | 86.6% | 53.6% | **70.1%** | 4.23% | 0.88 s |
| EWB, T 1.0 s | 84.6% | 54.5% | 69.5% | 4.23% | 1.08 s |
| EWB, T 1.5 s | 76.1% | 63.4% | 69.8% | 4.22% | 1.58 s |
| E, T 2.0 s | 67.7% | 67.9% | 67.8% | 4.14% | 2.08 s |

Every policy's PA is below today's, with every 95% interval below zero, and
every one's M falls by 23 to 63 points, against the 5 points allowed
([dev-table.txt](results/dev-table.txt); "Full stop after" is the median time
from the end of speech). On held-out test, the dev best, EWB at 0.8 s, and
EWB at 1.0 s:

| Test | S | M | PA | WER | Words dropped near pauses |
| --- | --- | --- | --- | --- | --- |
| Today (P0) | 68.2% | 83.2% | 75.7% | 3.34% | 1.3 per 100 |
| EWB, T 0.8 s | 82.1% | 43.0% | 62.5% | 3.91% | 2.0 per 100 |
| EWB, T 1.0 s | 81.0% | 43.0% | 62.0% | 3.70% | 2.3 per 100 |

EWB at 0.8 s lost 13.2 points of PA, 95% interval 7.8 to 18.7, and its WER rose
0.57 points, interval 0.3 to 0.9. EWB at 1.0 s lost 13.7 points, 8.4 to 19.3,
and its WER rose 0.36 points, 0.1 to 0.6 ([test-table.txt](results/test-table.txt)).

Where a policy acts, on pauses of at least T, it trades sentence ends for
mid-sentence pauses ([break-even-dev.txt](results/break-even-dev.txt),
[break-even-test.txt](results/break-even-test.txt)):

| Policy | Sentence ends | Mid-sentence pauses | Breaks even when sentence-end pauses outnumber mid-sentence ones |
| --- | --- | --- | --- |
| EWB 0.8 s, dev | 64% → 97% | 88% → 32% | 1.7 to 1 |
| EWB 1.0 s, dev | 64% → 94% | 90% → 32% | 1.9 to 1 |
| EWB 0.8 s, test | 72% → 90% | 85% → 30% | 3.0 to 1 |
| EWB 1.0 s, test | 73% → 91% | 87% → 26% | 3.4 to 1 |
| E 1.2 s, dev | 64% → 95% | 90% → 3% | 2.8 to 1 |

Why it doesn't work:

- **The text is silent at a pause.** Of 4,588 decision points across the dev
  runs, 83 (1.8%) ended in a full stop and none in a comma: the recognizer
  usually writes its punctuation with the next word. So EC behaved exactly as
  E, and EWAT almost exactly as EWA.
- **Word lists catch fewer than half.** Of the 61 mid-sentence pauses that E at
  0.8 s got wrong and today got right, 26 ended in a comma or a listed word,
  and 35 in words such as "story", "cart" and "men"
  ([cue-analysis-E0.8.txt](results/cue-analysis-E0.8.txt)).
- **The flush decides.** Its +7.5 bonus writes a full stop at nearly every
  pause it ends: where it acted, E at 1.2 s got 97% of mid-sentence pauses
  wrong.
- **A reset costs words.** The next utterance loses the words before it as
  context: "the lean, sullen apprentice" became "the lean soul and
  apprentice", and WER rose by 0.15 to 0.41 points on dev.
- **The library's own end-of-utterance detector** (token silence, 800 or
  500 ms), in an exploratory run on the fixture clips, also dropped the word
  spoken as it fired ("He was young. Spear had touched him" for "young no
  spear").

Exploratory, outside the decision rule (addendum to the pre-registration),
rerun on the rebuilt items:

- **More look-ahead** doesn't end sentences at pauses. At 560 ms, S was 64.2%
  on dev and 66.7% on test, against today's 62.7% and 68.2%, and PA didn't
  change measurably; at 1.12 s, S was 61.2% on dev. It improves recognition
  elsewhere: WER 3.57% against 3.97% on dev (interval −0.72 to −0.08 points)
  and 2.99% against 3.34% on test (−0.66 to −0.04), and more full stops are
  found ([lookahead-dev.txt](results/lookahead-dev.txt),
  [lookahead-test.txt](results/lookahead-test.txt)), at about 0.18 s more
  delay per word ([engine benchmark](../engine-benchmark-2026-10/README.md)).
- **Digital silence** in the pauses, through the worker's own gate, left S at
  71.4% on 60 dev items, as with the recording's own quiet, and M fell from
  96.8% to 93.5% ([zero60.txt](results/zero60.txt)).
- **Pitch** before a pause hardly separates the two kinds: a lower final pitch
  marked a sentence end with an AUC of 0.60, and a falling slope 0.46
  ([prosody-dev.txt](results/prosody-dev.txt)).

## Limits

- Audiobook reading, not dictation, and pauses inserted at word gaps, not
  pauses people chose. Both kinds of pause got the same quiet; in real
  dictation, pauses between sentences may be longer or more frequent than
  pauses to think, which the break-even ratios above make concrete.
- A fill is the recording's own quietest frames. A real room's pause sounds
  like its noise, which the tracker's floor follows, so the policies would
  hear real pauses as the rebuild's do.
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
python3 quiet_check.py
python3 run_policies.py items.json dev runs/dev P0 E:1.2 EWB:1.0
python3 summarize.py runs/dev P0 E:1.2 EWB:1.0
VOCO_LAB_CONTEXT=6 VOCO_LAB_NO_UNCUT=1 python3 run_policies.py items.json dev runs/dev-R6 P0
python3 archive.py runs ../results/runs
```

The tables rebuild from the archive alone, with no audio or recognizer:

```bash
python3 harness/regenerate.py results
```

It says, for each table, whether the rebuilt one matches the committed one;
`prosody-dev.txt` needs the audio and isn't rebuilt.
[results/runs](results/runs) holds each run's final text, the time each of its
words took its final form, and its forced ends (`EWB-1.0` is policy
`EWB:1.0`); [results/items.json.xz](results/items.json.xz) holds each item's
references, pauses and measured quiet.
