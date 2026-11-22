# Correcting by voice, November 2026

**Question.** Someone presses a key during a dictation, says a few words
again, and VOCO changes what it typed a moment ago. Without a language model,
that needs three things. Is a short phrase said on its own written right? Does
saying it on its own fix what running dictation got wrong? And does a fixed
rule then change the right words and nothing else?

**Answer.** The rule is safe and the hearing is the limit. On held-out public
speech the [pre-registered](PREREGISTRATION.md) rule never changed a word
outside the ones said again, in 976 trials, and it made the right change in
72.8% of the trials that asked for one. That misses the pre-registered bar of
80%, so this record doesn't show the capability to be useful as measured.
Almost every miss is the recognizer writing the short phrase differently from
the reference, most often a name, an old spelling or a word that sounds like
another. Where the recognizer heard the phrase right, the rule made the right
change in 178 and 177 of 179 trials.

Three more results shape a design:

- **The same recording on its own rarely fixes a mishearing.** Where the
  passage had the phrase wrong, the phrase on its own was right in 8 of 62
  cases. Saying a word again won't correct a word the recognizer always
  mishears; that is what My words is for.
- **A session of its own changes the form.** Every phrase on its own came back
  starting with a capital, and all but one ending a sentence, where the
  reference did neither. A dictation resumed in a new session started with a
  capital in 80 of 82 mid-sentence starts.
- **Recognition is not the slow part.** The final text came a median 236 ms
  after the last packet, 396 ms at the 95th percentile.

A second measurement, [reading and changing the focused
field](field-access/README.md), asks where such a change could be made safely
in another application.

This record describes measurements of 21 and 22 November 2026. VOCO's
documentation describes how it works now. Neither `npm test` nor CI runs this
harness, and VOCO has no such capability.

## Setup

- **Machine:** a cloud virtual machine with 4 CPUs (Intel Xeon, 2.1 GHz),
  shared with other work during the run, so times are rough. The 1,171
  sessions, 2.55 hours of audio, ran 3.5 times faster than real time.
- **Recognizer:** VOCO's real worker, `runtime/speech/stream_worker.py`,
  started with `python3 -E -s -B`, with the pinned Nemotron Speech Streaming
  English 0.6B (model SHA-256 `926495522ccd…`), its default look-ahead, 4
  threads and 100 ms packets at 16 kHz. Sessions start without a spelling or My
  words. The worker code was that of commit `c3f869d`.
- **Payload:** the native runtime of `scripts/provision-ci-speech.sh`. The
  model came from the published 2026.0.75 package, since the machine couldn't
  reach the tokenizer's source, and matched the pinned SHA-256.
- **Check:** the repository's speech baseline passed on this machine before
  the study ran.

## Data

Public LibriSpeech-PC (CC BY 4.0), punctuated and cased, with the LibriSpeech
test-clean and test-other audio. Speakers alternate between dev and test, and
none is a speaker of `tests/fixtures/speech`.

| Split | Items | From test-clean | From test-other | Resume items |
| --- | --- | --- | --- | --- |
| Dev | 270 | 106 | 164 | 61 |
| Test | 244 | 81 | 163 | 82 |

- **Item:** an utterance of 3 to 6 words, the phrase, whose previous and next
  utterances exist. The three together are the passage.
- **Resume item:** an utterance whose reference starts with a lower-case
  letter, so it starts inside a sentence.

## What ran

- **On its own:** the phrase's recording in a session of its own.
- **In a passage:** the previous utterance, the phrase and the next, in one
  session.
- **Resumed:** each resume item in a session of its own.
- **The rule:** given the last 30 words typed and the words heard, it looks
  for the first and last heard words in the typed text and replaces the words
  between them, only when exactly one place fits best and at most half the
  words between differ. Otherwise it changes nothing. `harness/rule.py` is the
  whole rule.
- **The rule's trials:** the typed text is the references of the passage, cut
  0, 4 or 8 words after the phrase. `far` plants a random other word inside the
  phrase and `near` the closest-spelled other word; `same` plants nothing; and
  `elsewhere` gives the rule another passage's text. The words heard are what
  the recognizer wrote for the phrase on its own.

## Results

Pre-registered, on the test split ([tables.txt](results/tables.txt) has dev,
which agrees):

| Measure | Test |
| --- | --- |
| Phrase on its own written right | 73.4% (179/244) |
| … where the passage had it right | 94.0% (171/182) |
| … where the passage had it wrong | 12.9% (8/62) |
| Starts with a capital where the reference doesn't | 100% (15/15) |
| Ends a sentence where the reference doesn't | 97.4% (37/38) |
| Interior words in the reference's form, among right | 67.6% (121/179) |
| Resumed mid-sentence, starts with a capital | 97.6% (80/82) |
| Last packet to final text | median 236 ms, p95 396 ms |

| Trial | Right | No change | Contained | Collateral |
| --- | --- | --- | --- | --- |
| far | 178 | 47 | 19 | 0 |
| near | 177 | 48 | 19 | 0 |
| same | 218 | 0 | 26 | 0 |
| elsewhere | 244 | 0 | 0 | 0 |

- **Safe, at most 1% collateral:** met, 0 of 976.
- **Useful, at least 80% right of far and near:** not met, 72.8% (355/488).
- **Magic, at least 95%:** not met.

A contained outcome is a change between the two words the speaker said first
and last that left a wrong word there. In `same` it is the rule replacing a
right word with what the recognizer misheard, 26 of 244.

### Post hoc

Not pre-registered, so read these as leads.

- **The harder recordings carry the misses.** The phrase on its own was right
  for 82.9% of test-clean items (155/187) and 65.7% of test-other items
  (215/327), dev and test together.
- **Many misses are spelling, not hearing.** On dev the wrong phrases include
  "Tomorrow" for the reference's "To morrow", "Muhammad" for "Mohammed",
  "patience" for "patients" and several attempts at "Fauchelevent".
- **Against text the recognizer itself typed, the rule does better.** In use
  the typed text is VOCO's own, so the phrase only has to come out as it did
  the first time, right or wrong. With the passage as the recognizer wrote it
  as the typed text, the rule made the right change in 82.4% of test trials
  (392/476) and 93.5% on test-clean alone (344/368, dev and test), again with
  no collateral change ([consistency.txt](results/consistency.txt)).

## Limits

- Nobody says anything twice here. A phrase on its own is the same recording
  without its sentence, so the 12.9% is a floor for mishearings that a clearer
  second attempt would fix, and nothing here shows how people speak when they
  correct.
- The phrases are whole utterances of read audiobooks, with a pause on both
  sides, many from the 19th century, with names and spellings a dictation
  rarely meets. A correction said mid-thought, after "no" or "I meant", in a
  noisy room, is not measured.
- The pre-registered trials build the typed text from the references, with
  one planted error. The post hoc run uses the recognizer's own text, and was
  designed after the first results.
- A right outcome compares words without case or punctuation. The form
  results above show that case and punctuation would still need a rule.
- Nothing here types, deletes or pastes. [Reading and changing the focused
  field](field-access/README.md) measures, in an X11 test session, where the
  change could be checked and made in another application.
- My words was empty. A list with the speaker's names would change both what
  the passage and what the phrase come out as.

## Reproduce

With `runtime/speech` provisioned, Python 3 with NumPy, and ffmpeg:

```bash
export VOCO_CORRECTION_LAB=/path/to/lab   # holds libri-pc/ and LibriSpeech/
cd research/voice-correction-2026-11
python3 harness/rule.py
python3 harness/items.py results/items.json
python3 harness/trials.py results/items.json results/trials.json
python3 harness/run.py results/items.json results/runs.jsonl
python3 harness/score.py results/items.json results/trials.json results/runs.jsonl results
python3 harness/consistency.py results/items.json results/runs.jsonl results/consistency.txt
```

`libri-pc/` holds the LibriSpeech-PC manifests and `LibriSpeech/` the
test-clean and test-other audio, from the archives
`research/engine-benchmark-2026-10/harness/setup-box.sh` pins by SHA-256.
`score.py` and `consistency.py` need neither the recognizer nor the audio:
they read the recorded [runs](results/runs.jsonl). Recognition was
deterministic in earlier records; this one ran each session once.
