# Ending sentences at pauses: pre-registration

Written 2026-10-13 before any dev or test run of the policies below. Exploratory
runs before this file (`eou.py`, `midpause.py`, recorded in the team thread)
used only the 20 clips in `tests/fixtures/speech`, which are LibriSpeech
dev-clean speakers; no item below shares a speaker with them.

## Question

VOCO's recognizer runs one utterance per dictation. When a speaker pauses
between sentences, the streaming model loses the sentence end ("friend go. Do
you hear he was young"). Forcing an end of utterance (the library's
`nemo_speech_asr_stream_force_endpoint`, whose flush raises the logits of
`.`/`?` by 7.5) restores sentence ends but also ends sentences at
mid-sentence pauses. Is there a policy, using only the recognizer's own
output and VOCO's own view of the audio, that ends sentences at
between-sentence pauses without adding false sentence ends at mid-sentence
pauses?

## Data

Source: LibriSpeech-PC manifests (`test-clean.json`, `test-other.json`;
punctuated, cased references in `text`) with the LibriSpeech test-clean and
test-other audio. Public, CC BY 4.0.

Split by speaker, fixed now: within each of test-clean and test-other, sort
speaker IDs numerically and assign them alternately to dev and test, starting
with dev. Dev is for tuning; test is run once per policy named below, after the
dev choice is fixed.

Items (seed 20261013, all choices deterministic):

- **Between items**: three consecutive utterances of one chapter
  (consecutive utterance numbers present in the PC manifest), each 1.5-20 s,
  total at most 45 s. Up to 3 per speaker, chosen at random among the
  speaker's windows that do not overlap. Each of the two junctions is labelled
  by the reference's last character of the earlier utterance, after stripping
  closing quotes and brackets: **S** for `.?!`, **C** for `,;:` or a dash,
  **N** otherwise (LibriSpeech cut the sentence at a pause).
- **Within items**: one utterance of 5-25 s with at least 10 words, up to 3
  per speaker, split once between two words at least 3 words from either end
  where the reference has no punctuation between them. The cut is the quietest
  20 ms frame between the recognizer's emission of the two words (word times
  from an unpaused pass, shifted 160 ms earlier), and must be at least 12 dB
  below the utterance's median frame energy; gaps without such a dip are
  skipped. These junctions are labelled **M**. The **N** junctions of between
  items are mid-sentence pauses too and are reported with them as M-natural.
- **Edges and pauses**: each utterance's leading and trailing silence is
  trimmed to 150 ms (first and last frame more than 15 dB above its 5th
  percentile). Each junction gets an inserted pause from
  {0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.5} s, assigned round-robin in a seeded order.
  The pause is the recording's own room tone (its quietest 300 ms, tiled with
  20 ms crossfades from random offsets) when that exists, else pink noise at
  the utterance's 5th-percentile frame level, clamped to -65..-45 dBFS. Never
  digital zero.
- **Exclusion** (policy-independent, fixed before policy runs): a within item
  is dropped if the no-policy hypothesis of the paused audio differs from the
  no-policy hypothesis of the uncut utterance within one word of the cut,
  case and punctuation ignored (a damaged cut).

## Policies

Audio is pushed in 100 ms packets at 16 kHz, as VOCO does. The pause detector
sees each packet in 20 ms frames: frame energy in dBFS; noise floor = the
minimum, over the last 5 s, of the 60 ms moving average; a frame is speech when
it is more than D = 9 dB above the floor and above -70 dBFS. Two consecutive
speech frames end a pause. A pause is eligible once the current utterance has
at least 0.2 s of speech frames and some recognized text. Each pause forces at
most one end of utterance, when its length reaches T.

- **P0**: no forcing (VOCO today).
- **E(T)**: force at T; T in {0.6, 0.8, 1.0, 1.2, 1.5, 2.0}.
- **EC(T)**: E, but not when the utterance's text ends with `,;:` or a dash;
  T in {0.8, 1.0, 1.2, 1.5}.
- **EWA(T)**: EC, and not when the last word is in cue set A: a an the and or
  but nor of to that which than my your his her its our their this these
  those; T in {0.8, 1.0, 1.2, 1.5}.
- **EWB(T)**: EWA plus cue set B: is are was were be been being am has have
  had do does did will would shall should can could may might must in on at
  by for with from into about as; T in {0.8, 1.0, 1.2, 1.5}.
- **EWAT(T)**: EWA, and not when the text already ends with `.?!`;
  T in {1.0, 1.2}.
- D sensitivity, dev only: D in {6, 12} for the dev choice.

## Metrics

Words are aligned by edit distance after lowercasing and stripping
punctuation (apostrophes inside words kept). A junction's hypothesis word h is
the hypothesis word aligned to the reference word before the pause (the
nearest earlier aligned word if that one was deleted). A terminator is `.?!`
at the end of a word, allowing closing quotes.

- **S correct**: terminator on h, the next hypothesis word capitalised, and
  no terminator on the next two hypothesis words unless the reference has one
  there.
- **M correct**: no terminator on h, the next word not capitalised unless the
  reference's is, and no terminator on h-1..h+2 unless the reference has one
  there.
- **C**: reported as comma kept, terminator, or nothing.
- **Pause accuracy (PA)** = mean of S accuracy and M accuracy (M = M-inserted
  and M-natural together); sensitivity weights 1:2 and 2:1 reported.
- WER, case-insensitive without punctuation; deletions within two reference
  words of a junction; terminator precision and recall over all words;
  capital errors on matched words.
- Delay: audio time from the last speech frame before a junction to the
  push that first carries the terminator on h.
- Append-only: every push extends the previous one; violations counted.
- Recognizer wall time per audio second.

Statistics: paired bootstrap over items, 10 000 resamples, seed 20261013,
95% percentile intervals.

## Decisions

Dev choice: the policy with the highest PA such that dev M accuracy is at
most 5 points below P0, WER at most 0.3 points above P0, and no append-only
violation; ties go to the larger T.

Ship the dev choice only if, on test against P0, all hold:

1. PA gains at least 10 points with the 95% interval above 0;
2. M accuracy falls at most 5 points, with the interval's bound on the fall at
   most 10 points;
3. the WER difference's upper bound is at most +0.3 points;
4. no append-only violation, and junction deletions at most 1 per 100
   junctions above P0;
5. p90 delay at forced S junctions at most T + 0.4 s;
6. wall time per audio second at most 5% above P0;
7. `scripts/check-speech.sh` passes its accuracy and My words gates with the
   policy.

Otherwise VOCO keeps P0 and this report says so.

## Addendum, 2026-10-13 12:55 UTC (after dev runs of E, EC, EWA, EWB and EWAT at T 0.6-1.2; before any run below)

No dev policy so far meets the M constraint, so the pre-registered decision is
heading to "keep P0". The runs below are exploratory, outside the decision rule,
and reported as such:

1. P0 with right context 6 (560 ms) and 13 (1.12 s), dev then test, scored
   with the same metrics. A larger right context is a user-visible latency
   change (+0.18 s, and about +0.8 s per word); it would not ship from this test.
2. Digital silence: P0 through the worker's own StreamingSession (gate
   included) on 60 dev items (a seeded sample of those with an inserted pause
   of at least 1.2 s), with each inserted pause replaced by exact zeros.
3. Descriptive only: the dev policy with the highest PA, M constraint
   ignored, run once on test against P0.
