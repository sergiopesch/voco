# Checking each step of correcting by voice, November 2026

**Question.** The [second study](../voice-correction-primitives-2026-11/README.md)
measured the three steps of correcting by voice apart, each with made-up
input, and each found a limit: a change in the wrong place, words not yet
typed when the key is pressed, and a field damaged when focus had moved. Does
a check at each step remove those limits, and does the chain hold from a
recording to a changed field?

**Answer.** On this data two of the three limits are gone, and the chain
holds. The check of the place met its bar without being put to the test.

- **The moment.** At the key press the typed text held every word of the
  phrase for 54.6% of 370 fresh items, and 0.8 s into the next utterance for
  99.7%. Deciding then, the rule made the right change in 91.1% of trials
  (674/740), exactly as often as on the complete text, where deciding at the
  key press made 73.4%. No trial of 1,480 changed a word elsewhere.
- **The field.** Over 684 runs in 18 fields and 13 scenarios the second
  ladder changed the text in 333 and refused in 351, and a read that doesn't
  use the accessibility interface agreed every time. No field was damaged,
  the scenario that did damage before among them.
- **The place.** With the text complete, the checked rule made the right
  change in 91.5% of trials (677/740) and a collateral one in 2 of 1,480:
  safe and useful by the [pre-registered](PREREGISTRATION.md) bars, short of
  magic. With another recording of the same words as the correction, on 191
  fresh pairs, it made the right change in 87.2% (333/382) and no collateral
  one in 764 trials. But the rule it guards made none there either, and on
  the fresh items the check stopped neither of the two.
- **End to end.** With 60 trials drawn from the fresh items and run from the
  recording to a field, the field's words at the end were the passage as
  recognized, the wrong word gone and nothing else changed, in 58 of 60 in
  gedit, 57 in Chromium and 58 in GNOME Terminal. The three misses were
  never reported as changes, and no field was damaged.

This record describes measurements of 23 November 2026. VOCO's documentation
describes how it works now. Neither `npm test` nor CI runs this harness, and
VOCO has no such capability.

## Setup

- **Machine:** a cloud virtual machine with 4 CPUs, which the three
  experiments' jobs shared, so no time here is a measurement of speed.
- **Recognizer:** VOCO's real worker, `runtime/speech/stream_worker.py`,
  started with `python3 -E -s -B`, with the pinned Nemotron Speech Streaming
  English 0.6B (model SHA-256 `926495522ccd…`), its default look-ahead, 4
  threads and 100 ms packets at 16 kHz. The model and the native runtime came
  from the published 2026.0.75 package, whose worker files are this
  checkout's. The repository's speech baseline passed before the runs.
- **Data:** LibriSpeech dev-clean, dev-other and train-clean-100 with
  LibriSpeech-PC references (CC BY 4.0). The archives matched the MD5 the
  corpus publishes, and the references the SHA-256 the engine benchmark pins.
- **Fresh items:** 380 utterances of 3 to 6 words in dev-clean and dev-other
  with a previous and a next utterance, 1.5 hours of passages. 10 were left
  out because the phrase's place in the recognized passage was unknown or
  under three words: 370 items, 150 from dev-clean and 220 from dev-other.
  The first study's items came from test-clean and test-other.
- **Field session:** `gnome-shell --headless --wayland` 46 from Ubuntu
  24.04, one new session, D-Bus session and home folder for each run, with
  XWayland. Keys go through Mutter's RemoteDesktop interface, and copies
  through xclip, PRIMARY then CLIPBOARD, then Shift+Insert, VOCO's order on
  GNOME Wayland. [versions.txt](field/results/versions.txt) lists every
  package.

## What ran

Each step's input is the step before's output.

1. **The passage**, the previous utterance, the phrase and the next, goes
   through the worker in one session, as one dictation. Every push's text is
   kept with the seconds of audio sent, so the text typed at any moment is
   known. The key press is the end of the phrase's audio.
2. **The correction** is the phrase's recording in a session of its own,
   leaned toward the last 30 words typed.
3. **A trial** plants one wrong word inside the phrase's place in the typed
   text: a random word (`far`) or the closest-spelled one (`near`). `same`
   plants nothing, and `elsewhere` gives the rule another item's text.
4. **The rule** takes the heard words and the typed words and changes some,
   or nothing.
5. **The field:** the typed text is pasted into an application as VOCO
   pastes, the ladder makes the rule's change there, the rest of the
   dictation is pasted, and the field is read back by keyboard select and
   copy.

## Experiment 1: a checked place

**Rule 3** is the second study's rule 2 and one check before its change is
made: all the heard words, with none dropped and no end word excused, must
fit the chosen place better than any run of typed words that shares no word
with it. Rule 1's own decisions, both end words found exactly, are not
checked. `harness/rules.py` is the rule.

On the fresh items, with the text complete up to 0, 4 or 8 words after the
phrase and the correction leaned toward it:

| | Right | Collateral, of all trials | Changes that leave a wrong word |
| --- | --- | --- | --- |
| Rule 1, plain | 83.4% (617/740) | 1/1480 | 62 |
| Rule 2, plain | 88.6% (656/740) | 2/1480 | 67 |
| Rule 3, plain | 88.6% (656/740) | 2/1480 | 67 |
| Rule 1, leaned | 87.8% (650/740) | 1/1480 | 49 |
| Rule 2, leaned | 91.5% (677/740) | 2/1480 | 53 |
| Rule 3, leaned | 91.5% (677/740) | 2/1480 | 53 |

- **Safe:** met, 2 of 1,480, 0.14%. **Useful:** met, 91.5%. **Magic**, at
  least 95%: not met. On dev-clean alone the share is 95.7% (287/300), and on
  dev-other 88.6% (390/440).
- **Rule 3 decided as rule 2 in every one of these trials.** The check
  refused nothing here, and it stopped neither collateral change.
- **The two collateral changes.** In one the dictation had typed "Pier
  Pierre" for one "Pierre", and the correction, heard right, took the doubled
  word out. That is rule 1's own decision, which the check doesn't cover, and
  it counts as collateral because the phrase's last word went. In the other,
  an `elsewhere` trial, "don't you well I do" was heard, both its end words
  were dropped, and "you well I" fitted "tell you I" in another item's text:
  the rule put "well" in. The check passed it, because nothing else in that
  text fitted better.

### Said again

The 190 train-clean-100 groups the second study's seed did not draw, through
that study's pipeline unchanged: one speaker says a clause of 3 to 6 words in
two recordings, the dictation is one recording and the correction the clause
cut from the other. 217 of 427 clauses could be cut at pauses. Of 20
dictations put through both the lab stream and the worker, 20 came out the
same. The recognizer may have been trained on this set, so it carries no bar
on right changes.

| Other recording, 191 pairs | Right | Collateral | Changes that leave a wrong word |
| --- | --- | --- | --- |
| Rule 1, leaned | 76.2% (291/382) | 0/764 | 11 |
| Rule 2, leaned | 87.4% (334/382) | 0/764 | 15 |
| Rule 3, leaned | 87.2% (333/382) | 0/764 | 14 |
| Rule 2, plain | 85.3% (326/382) | 0/764 | 16 |
| Rule 3, plain | 84.8% (324/382) | 0/764 | 12 |

- **The check holds,** by its bar: rule 3's collateral changes are at most 1%
  of the said-again trials, 0 of 764, and its right share is at most 1 point
  under rule 2's on both fresh sets, 0.2 points here and none on the items.
- **It was not put to the test.** Rule 2 made no collateral change on these
  pairs, so the check had none to stop. What it refused was one right change
  and one that left a wrong word, leaned, and two and four heard plainly.
  The four collateral changes it was designed on, all in one knitting
  pattern, remain the only ones it is known to stop with the text complete.
- **Same recording**, the clause cut from the dictation's own recording:
  90.2% (348/386) with rule 3 leaned, 3 points above another recording. The
  second study found 6 points on its train-clean-100 pairs.

[said-tables.txt](results/said-tables.txt) has every row.

## Experiment 2: a checked moment

Nothing is fed at the key press and the dictation is one session. The
correction's session starts at the key press, leaned toward the text typed by
then. The rule decides later, on the last 30 words typed by that moment.

| The typed text holds every word of the phrase | Items |
| --- | --- |
| at the key press | 54.6% (202/370) |
| 0.4 s into the next utterance | 93.0% (344/370) |
| 0.8 s | 99.7% (369/370) |
| 1.2 s | 100% (370/370) |

| Rule 3, leaned at the key press, decided | Right | Collateral, of all trials |
| --- | --- | --- |
| at the key press | 73.4% (543/740) | 0/1480 |
| 0.4 s into the next utterance | 89.9% (665/740) | 0/1480 |
| 0.8 s | 91.1% (674/740) | 0/1480 |
| 1.2 s | 91.1% (674/740) | 1/1480 |
| on the complete text, the same hearing | 91.1% (674/740) | 2/1480 |

- **Window complete** at 0.8 s, at least 95%: met, 99.7%. **Waiting costs
  nothing**, at most 2 points under the complete text: met, the same 674
  trials of 740. **Safe** and **useful** at 0.8 s: met. **Magic:** not met.
- **Deciding at the key press loses one trial in five.** The second study
  found nearly the same share of complete windows there, 56.7%, and brought
  the words out with silence, which changed the dictation after it. Here
  they come out because the dictation goes on.
- **Leaning at the key press is enough.** The correction leaned toward the
  text typed at the key press, which often lacks the phrase's last word, and
  the rule made 674 right changes; leaned toward the complete text it made
  677.
- **A push can end inside a word.** At the key press the typed text ended
  inside a word for 72 of the 370 items, "Hom" where "Homer" followed. The
  rule reads the half word as a word that doesn't match.
- **Every push was the start of the final text**, in 380 of 380 passages.
- **Rule 2 at the key press** made 2 collateral changes of 1,480 that rule 3
  refused, at the cost of 4 right changes. From 0.4 s on the two rules
  decided alike.

[own-tables.txt](results/own-tables.txt) has every row of both experiments,
by subset.

## Experiment 3: a checked change, end to end

**Ladder 2** takes a run of characters of the pasted text and what to put
there, where the first ladder took one word. It refuses unless the field's
window is the active one, and when anything in the field is selected. It
settles what the interface's offsets count before it uses one, and refuses
when it can't. It reports a change as verified only when the whole text reads
as asked, the caret stands at the end of the changed text and nothing is
selected. `field/harness/ladder.py` is the procedure, and
[NOTES.md](field/harness/NOTES.md) what was learned building it.

### Every field and scenario

C2, C3 and C4 mean changed by replacing in place, by select and paste, and by
Backspace and paste, with the changed text read back. R means refused, with
the field read back untouched. Each cell ran three times.

| Field | Untouched, text before, twice, non-ASCII | Home, typed after, cleared, other field, other window, selected | Text after | Two lines | Emoji before |
| --- | --- | --- | --- | --- | --- |
| GNOME Text Editor, GTK 4 text view, gedit, GTK 3 text view, LibreOffice Writer, FeatherPad through XWayland | C2 | R | C2 | C2 | C2 |
| GTK 4 and GTK 3 entries | C2 | R | C2 | one line | C2 |
| GNOME Terminal, bash | C4 | R | R | one line | C4 |
| Epiphany `textarea` and editable `div` | C3 | R | C3 | C3 | C3 |
| Epiphany `input` | C3 | R | C3 | one line | C3 |
| Chromium and Electron `textarea` | C3 | R | C3 | C3 | R |
| Chromium and Electron `input` | C3 | R | C3 | one line | R |
| Chromium and Electron editable `div` | C3 | R | C3 | R | R |

- **Safe, no damaged field:** met, 0 of 684. **Honest, nothing damaged or
  untouched reported as changed:** met, 0. **Useful, correct in the four
  scenarios that should change the text for at least 80% of fields:** met,
  18 of 18.
- **The scenario that did damage before refuses now.** With focus on a
  window the interface doesn't expose, all 54 runs refused and both windows
  were untouched. The first ladder damaged 29 of 54 there.
- **The second of two equal words changed, and only it,** in every field.
- **Chromium and Electron refuse after an emoji.** With a character outside
  the Basic Multilingual Plane before the pasted text, their selection reads
  back one place lower than it was set. The ladder can't tell that from a
  wrong selection, so the six fields refused, 18 of 18 runs.
- **Toolkits count differently.** GTK, VTE, WebKitGTK and Chromium count
  code points. Qt and LibreOffice count UTF-16 code units. None counts what
  a person sees as one character.
- **An editable `div` with two lines** in Chromium and Electron shows the
  ladder only the first line, and it refused.
- Three cells refused for two different reasons across their three runs,
  every run untouched. The caret stood at the end of the changed text by the
  independent read in 327 of the 333 changed runs; the other six are
  LibreOffice Writer, where the keyboard read of the text before the caret
  came back empty after the ladder's own check of its offsets.

[summary.md](field/results/summary.md) has every cell, and
[runs.tar.xz](field/results/runs.tar.xz) the result files.

### The chain

60 far and near trials were drawn by seed, as Experiment 2 decides them with
rule 3 at 0.8 s. The rule made a change in all 60, and the right one in 58.
Each ran once in three fields, one for each way of changing: the text typed by the
decision, with the planted word, pasted in three parts; the ladder; the rest
of the passage pasted; and the field read back.

| Field | The ladder reported changed and verified | Field as the rule asked | Right end to end | Exact text |
| --- | --- | --- | --- | --- |
| gedit, replaced in place | 60 | 60 | 96.7% (58/60) | 58 |
| Chromium `textarea`, select and paste | 59 | 59 | 95.0% (57/60) | 57 |
| GNOME Terminal, Backspace and paste | 58 | 60 | 96.7% (58/60) | 58 |

- **Safe:** met, no damaged field in 180 runs. **Honest** and **faithful:**
  met, every run reported as changed held exactly the text the rule asked
  for. **Right end to end**, at least 80% of the 60 in each field: met.
- **The rule's two wrong changes** are the misses in every field: the
  correction's session heard "to" for "a", and "Guys" for "Griggs", and the
  ladder wrote what the rule asked.
- **Three runs were reported as failed.** In Chromium one selection read
  back empty, nothing was pasted, and the field held the text unchanged.
  In the terminal two changes were made and right, but the ladder could not
  settle what the terminal's offsets count afterwards, where the changed
  line with its prompt was 78 and 79 characters long. Why was not looked
  into.
- **The form held.** Wherever the words were right, so was the text,
  character for character. Three of the 60 changes carried their place's
  punctuation.

[chain-tables.txt](results/chain-tables.txt) has the counts, and
[chain.json](results/chain/chain.json) each drawn trial with the SHA-256 of
the file the field was given.

## Post hoc

Not pre-registered, so read these as leads.

- **A bound on the fit would have stopped the `elsewhere` change.** There the
  five heard words fitted the chosen place with three of them wrong. Rule 3
  with one more refusal, when more than half the heard words don't fit the
  place, makes 675 right changes of 740 on the complete text and 670 at 0.8
  s, where rule 3 makes 677 and 674, and 1 collateral change where it makes
  2.
- **The recordings that are harder to hear carry the misses,** as in the
  first study: 95.7% right on dev-clean and 88.0% on dev-other, decided at
  0.8 s.
- **Changes that leave a wrong word** are 49 of 1,480 at 0.8 s, and 17 of
  them are `same` trials: the phrase said again as typed, where the
  correction's session heard a word differently and the rule wrote that.
  No check here looks at them. A person would see the change.

## What this means for a design

VOCO has no such capability, and one would first change the product contract
in a pull request of its own. These measurements support five rules for it.

1. **Decide after the dictation has had 0.8 s more audio, or has ended,**
   never at the key press. Feed nothing at the key press.
2. **Start the correction's session at the key press,** leaned toward the
   words typed by then.
3. **Change only between two typed words the correction also holds,** and
   refuse when another place fits the heard words as well.
4. **Refuse in the field** unless its window is the active one, nothing is
   selected, the text before the caret ends with what was pasted, and the
   place of every character is sure. Report a change only when the whole
   text reads back as asked.
5. **Treat a refusal as the normal case.** In the field half the runs
   refused by design, and each left the text as it was.

## Limits

- Nobody says anything twice on the fresh items: the correction is the
  phrase's own recording, so these shares are for words that come out the
  second time as they did the first. The second study measured a second
  saying, 8 points lower on held-out data.
- The key press is put at the end of the phrase's audio and the next
  utterance follows at once. A person pauses, presses, speaks and resumes.
  The 0.8 s is audio of the dictation going on; what happens when the person
  says nothing more until Stop is the complete text's row.
- The correction ran in a session of its own beside the dictation's. VOCO's
  worker holds one session.
- The planted word stands for a mishearing. The first study measured how
  often a mishearing is misheard again.
- The phrases are whole utterances of read audiobooks, with a pause on both
  sides. My words was empty except for leaning.
- A right outcome compares words without case or punctuation, except the
  chain's count of exact text.
- The field ran in a headless Shell alone, without a screen reader or a
  logged-in desktop, and Chromium and Electron were started so that the
  interface exposes them. Firefox, Thunderbird and VS Code could not be
  installed. Password and read-only fields, undo, and scripts written right
  to left were not tried.
- The chain pasted in three parts cut where pushes ended, not as VOCO's
  desktop cuts its pastes, and the ladder ran with no paste arriving
  meanwhile.
- Nothing here types into a person's application, and none of it has a
  listener.

## What happened along the way

- **The second study's field harness could not run as committed.** It loads
  a Shell extension that was never committed. This study's harness carries a
  rewritten one, and that record has a dated note.
- **The field harness's development** ran 159 sessions before the
  pre-registered runs, listed in [NOTES.md](field/harness/NOTES.md). Seven of
  them, on drafts, damaged a field: four pasted one character off after an
  emoji in Chromium and Electron, one left a NUL in FeatherPad, and two
  pasted the rest of the dictation in the wrong place after a change that
  was right. The ladder reported all seven as failed. The causes were fixed
  before the harness was committed, and the pre-registered runs came after.
- **Verified means more than the pre-registration said:** also that the
  caret stands at the end of the changed text and nothing is selected, since
  the dictation's next paste lands at the caret.
- **Three finished results were overwritten.** The chain's first start used
  trial names the field harness refuses, and its error took the file names
  of three finished `plain` runs. Those three ran again with the outcome the
  first summary showed, the names were changed, and the harness can no
  longer write a failed trial over a scenario's file.

## Checks of the record

`harness/verify.py` checks the record against itself, and
[verify.txt](results/verify.txt) is its output: every check passed.

- **Every table** is computed again from the recorded runs and is the
  committed one, byte for byte: the trials, both experiments' tables, the
  said-again tables, the chain's score and the field's two summaries.
- **The chain is tied end to end.** Each run's line holds the SHA-256 of the
  audio it was given. The 60 trial files are built again from the runs and
  the rule, byte for byte. Each of the 180 field runs names its trial file
  by SHA-256, and pasted, asked for and expected what that file holds.
- **The rules are the earlier ones.** Rules 1 and 2 here decide as the
  second study's on all 4,059 trials that study and the first recorded, and
  rule 3 differs from rule 2 only by refusing, 12 times there.
- **Recognition repeats.** 40 sessions drawn by seed, 6 passages, 6 phrases
  and 28 leaned corrections, were recognized again: the same audio, the same
  text and the same pushes in 40 of 40.

## Reproduce

With `runtime/speech` provisioned, `/usr/bin/python3` with NumPy and
SentencePiece, ffmpeg, and the first two studies' records beside this one:

```bash
export VOCO_CORRECTION_LAB=/path/to/lab   # holds libri-pc/ and LibriSpeech/
cd research/voice-correction-checked-2026-11
python3 harness/rules.py
python3 harness/items.py results/items.json
/usr/bin/python3 harness/run.py results/items.json results/runs.jsonl
python3 harness/trials.py results/items.json results/runs.jsonl results/trials.json
/usr/bin/python3 harness/lean.py results/items.json results/trials.json results/runs.jsonl results/lean.jsonl
python3 harness/score.py results/trials.json results/runs.jsonl results/lean.jsonl results

python3 harness/said.py select results/said-groups.json
R=$PWD/results
(cd ../voice-correction-primitives-2026-11/harness
 /usr/bin/python3 said.py dictate $R/said-groups.json $R/said-runs.jsonl
 /usr/bin/python3 cut.py $R/said-groups.json $R/said-runs.jsonl $R/said-cuts.json
 /usr/bin/python3 said.py clips $R/said-groups.json $R/said-cuts.json $R/said-runs.jsonl
 /usr/bin/python3 said.py trials $R/said-groups.json $R/said-cuts.json $R/said-runs.jsonl $R/said-trials.json
 /usr/bin/python3 said.py lean $R/said-trials.json $R/said-cuts.json $R/said-runs.jsonl)
python3 harness/said.py score results/said-trials.json results/said-runs.jsonl results

python3 harness/chain.py results/trials.json results/runs.jsonl results/lean.jsonl results/chain
python3 harness/verify.py
```

The field runs need Ubuntu 24.04, as root, with the packages
`field/harness/run_all.sh` names, Playwright's Chromium at
`/opt/pw-browsers/chromium` and Electron installed in
`field/harness/electron-app`:

```bash
cd research/voice-correction-checked-2026-11/field/harness
./run_all.sh
./run_all.sh --trials ../../results/chain/trials gedit chromium-textarea gnome-terminal
python3 ../../harness/score_chain.py ../../results/chain/chain.json results ../../results
```

`libri-pc/` holds the LibriSpeech-PC manifests and `LibriSpeech/` the
dev-clean, dev-other and train-clean-100 audio. The scorers, the chain
builder and the verifier need neither the recognizer nor the audio: they read
the recorded runs.
