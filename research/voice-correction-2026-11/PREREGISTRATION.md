# Correcting by voice: pre-registration

Written 2026-11-21 before any run on the items below. The only recognition run
before this file was the repository's speech baseline
(`npm run test:speech-baseline`) on `tests/fixtures/speech`, to check that the
provisioned recognizer works; those clips are LibriSpeech dev-clean, and no
item below shares a speaker with them. The item counts quoted here come from
the reference transcripts alone.

## Question

VOCO only adds text. A proposed capability would let someone press a key
during a dictation, say a few words again, and have VOCO change what it typed
a moment ago. Three things must hold for that to work without a language
model, and this study measures each on public speech:

1. **Is a short phrase said on its own written right?** A correction is a
   few words in a recognition session of its own, without the sentence around
   them.
2. **Does saying it on its own fix what running dictation got wrong?** Only
   for the same recording: public read speech has nobody saying a phrase
   twice.
3. **Does a fixed rule then change the right words and nothing else?** The
   rule below takes what the recognizer heard and the text already typed.

It also measures how a dictation that resumes in a new session begins, since
a correction would split one dictation into several sessions.

## Data

LibriSpeech-PC manifests (`test-clean.json`, `test-other.json`; punctuated,
cased references in `text`) with the LibriSpeech test-clean and test-other
audio. Public, CC BY 4.0. The archives are the ones the engine benchmark pins
by SHA-256 (`research/engine-benchmark-2026-10/harness/setup-box.sh`).

Split by speaker, fixed now, as in the pause study: within each of test-clean
and test-other, sort speaker IDs numerically and assign them alternately to dev
and test, starting with dev. The rule below is fixed, so both splits are run
once with it. Variants of the rule may be explored on dev only, and are
reported as exploratory.

- **Items:** every utterance whose reference has 3 to 6 words (split on
  whitespace) and whose previous and next utterance numbers in the same
  chapter are in the manifest. 514 items: 187 from test-clean, 327 from
  test-other. The item's utterance is the **phrase**; with its neighbours it
  forms the **passage**.
- **Resume items:** every utterance of the two manifests whose reference
  starts with a lower-case letter, so it starts inside a sentence. 143
  utterances.

## Recognition

The real worker, `runtime/speech/stream_worker.py`, started as VOCO starts it
(`python3 -E -s -B`), with the pinned model and native runtime, its default
look-ahead, 4 threads, 100 ms packets at 16 kHz, unpaced. Each session starts
without a spelling or My words, so text is as recognized. Audio is the corpus
FLAC decoded by ffmpeg to mono 16 kHz float, untrimmed.

- **Arm S, on its own:** the phrase's recording in a session of its own.
- **Arm P, in a passage:** the previous utterance, the phrase and the next
  utterance, concatenated untrimmed, in one session.
- **Arm R, resumed:** each resume item in a session of its own.

## Scoring

Words are compared after `norm`: lower case, with everything but letters,
digits and apostrophes removed, and empty results dropped.

- **S right:** the normalized hypothesis equals the normalized reference.
- **P right:** the passage hypothesis is aligned to the passage reference by
  word edit distance; every word of the phrase aligns to an equal word, and
  those hypothesis words are consecutive.
- **Primary:** the share of S right; the 2 × 2 table of P right by S right;
  the share of S right among P wrong (the same recording, on its own, fixing a
  mishearing) and among P right (saying it again breaking nothing).
- **Form:** among items, the share of S hypotheses that start with a capital
  where the reference starts lower-case, and that end in `.`, `?` or `!` where
  the reference doesn't (closing quotes and brackets stripped). Among S right,
  the share whose interior words (all but the first and last) equal the
  reference's interior words exactly, case and punctuation included.
- **Arm R:** the share of hypotheses that start with a capital letter.
- **Latency:** for arm S, the time from sending the last packet to the final
  text, median and 95th percentile. The machine is shared, so this is rough.

## The correction rule and its trials (arm M)

Arm M needs no further recognition: the words heard are arm S's hypothesis.
The typed text is built from the references, so the rule is tested on what the
recognizer really writes for a short phrase said on its own.

**Rule (anchor rule 1).** Given the window, the last 30 words VOCO typed, and
the heard words, both normalized:

1. With fewer than 3 heard words, change nothing.
2. A candidate is a pair of window positions `p < q` where the word at `p`
   equals the first heard word and the word at `q` equals the last heard word,
   and the number of words strictly between them differs from the number of
   interior heard words by at most 1.
3. A candidate's cost is the word edit distance between the window's words
   strictly between `p` and `q` and the interior heard words.
4. If exactly one candidate has the lowest cost, and that cost is at least 1
   and at most half the number of interior heard words, rounded up, replace
   the window's words strictly between `p` and `q` with the interior heard
   words. Otherwise change nothing.

**Trials.** For each item the typed text is the references of the previous
utterance, the phrase and the first `k` words of the next utterance, with `k`
taken from 0, 4, 8 in turn over the items in ID order. Seed 20261121.

- **far:** one interior word of the phrase, chosen at random, is replaced in
  the typed text by a random word of the two manifests' vocabulary that
  differs from it and from both its neighbours. Stands for words the speaker
  wants to change.
- **near:** the same position is replaced by the vocabulary word closest to it
  in letter edit distance (at least 1; ties broken at random). Stands for a
  mishearing.
- **same:** the typed text is unchanged, so the phrase repeats what is there.
- **elsewhere:** the typed text is another item's, the next item in ID order
  from a different chapter, built the same way.

**Outcomes.** For far and near: **right** when the window after the rule
equals the reference window; **none** when the rule changed nothing;
**contained** when the result differs from the reference only between the
phrase's first and last words, the words the speaker said again;
**collateral** when it differs anywhere else. For same: **right** when nothing
changed, and contained or collateral as above. For elsewhere: **right** when
nothing changed, **collateral** otherwise.

## Bars

Judgment bars, fixed now, on the test split:

- **Safe:** collateral outcomes are at most 1% of all trials, the four kinds
  together.
- **Useful:** safe, and right is at least 80% of far and near trials together.
- **Magic:** safe, and right is at least 95% of them.

## What this cannot show

- Nobody says anything twice here. Arm S replays the same recording without
  its sentence, which is a floor for mishearings a clearer second attempt
  would fix, and says nothing of how people speak when they correct.
- The phrases are whole utterances of read audiobooks, where a reader paused
  on both sides. A correction said mid-thought, with "no" or "I meant" before
  it, in a room with noise, is not measured.
- The typed text is built from references, so arm M has no errors but the one
  planted, and the passage's own mishearings play no part in it.
- Nothing here types, deletes or pastes. Whether the right change can be made
  safely in another application is a separate question.
