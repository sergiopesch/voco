# Checking each step of correcting by voice: pre-registration

Fixed on 2026-11-23, after the [first](../voice-correction-2026-11/README.md)
and [second](../voice-correction-primitives-2026-11/README.md) studies and
before any recording of the fresh items below was recognized. Three
experiments, one for each step between a key press and a changed word. Each
changes that step as the second study's results suggest, adds a check the step
makes of itself, and is measured on data no earlier study used.

## The chain

Someone dictates, presses a key, says a few words again, and goes on
dictating. For the wrong word to be gone and nothing else changed, three steps
must each be right:

1. **The place.** A rule takes what the recognizer heard and the words typed
   so far, and finds the words to change.
2. **The moment.** The words said just before the key press must be typed
   when the rule looks for them.
3. **The field.** The change must be made in the application that holds the
   text, and only there.

The second study measured the three apart, each with its own made-up input.
Here each step's input is the step before's output, and the last step is read
back from the field without the interface that changed it.

## What was seen before this file

- Both earlier studies' results in aggregate; the first study's dev items and
  the second study's train-clean-100 said-again trials one by one; and the
  held-out said-again misses the second record quotes.
- **Rule 3**, below, was designed on those. On the second study's
  train-clean-100 pairs from another recording it made 0 collateral changes
  where rule 2 made 4, with the same right changes, 244 of 286 leaned. On the
  same-recording pairs it made 260 right changes of 288 where rule 2 made 262.
  On the second study's held-out said-again pairs (94 of 118), the first
  study's test split leaned (440 of 476) and its dev split heard plainly (444
  of 526), every outcome was rule 2's.
- Variants tried on the same data and dropped: the check applied to rule 1's
  decisions too (230 of 286 on the train pairs), a margin of 2 (240), ties
  accepted (rule 2's outcomes), and a change made only when the plain and the
  leaned hearing agree (240, and 426 of 476 on the first study's test split).
- Rule 2's misses on those data were read one by one. Nearly all are the
  recognizer writing a name or a rare word differently the second time, which
  no rule over words can mend, so rule 3 changes what rule 2 refuses, not what
  it finds.
- **The driver** ran on 12 items of the first study's dev split. The worker's
  text equalled that study's record in 24 of 24 sessions. A push can return
  text that ends inside a word.
- **The fresh items** were counted from the references alone: 380. No
  recording of an item below, and no recording of the fresh said-again
  groups, was recognized before this file.
- **Experiment 3's harness** was being built by a separate test when this
  file was fixed, from the procedure, scenarios and fields below. The cells
  its development ran are listed in the record. The second study's field
  harness could not be run as committed: the Shell extension it loads was
  never committed, and this study's harness carries a rewritten one.

## Data

LibriSpeech-PC references with LibriSpeech audio (CC BY 4.0).

- **Fresh items:** in dev-clean and dev-other, every utterance of 3 to 6
  words whose previous and next utterances exist, as the first study defines
  an item. Speakers of `tests/fixtures/speech`, and items that share an
  utterance with the second study's said-again groups, are left out. 380
  items: 152 from dev-clean, 228 from dev-other. The first study used
  test-clean and test-other, so no item here was an item there.
- **Fresh said-again groups:** the 190 train-clean-100 groups the second
  study's seed did not draw, of the 331 its search found. The recognizer may
  have been trained on this set, so it carries no bar on right changes.
- An item's utterance is the **phrase**; the previous utterance, the phrase
  and the next are the **passage**.

## Recognition

The real worker, `runtime/speech/stream_worker.py`, started as VOCO starts it
(`python3 -E -s -B`), with the pinned model and native runtime, its default
look-ahead, 4 threads and 100 ms packets at 16 kHz, unpaced. Sessions start
without a spelling, and without My words except where a session leans.

- **The passage**, one session, as one dictation: the previous utterance and
  the phrase, the last packet short as a Stop flushes it, then the next
  utterance. Every push's text is recorded with the seconds of audio sent, so
  the text typed at any moment is known. The **key press** is the end of the
  phrase's audio.
- **The correction** is the phrase's recording in a session of its own, in a
  second worker's place: heard plainly, and **leaned** toward a typed window,
  that window's words as its My words list.
- The fresh said-again groups go through the second study's pipeline
  unchanged: dictation on a lab stream with word times, its cuts, its trials
  with its seed, and corrections through the real worker.

## Trials

As the second study's own-text trials. The typed text is the passage as the
worker wrote it. An item is left out when the passage as recognized has no
word aligned to the last word before the phrase or the first word after it,
or the phrase's place holds under three words. Seed 20261123.

- **far** plants a random word of the items' vocabulary inside the phrase's
  place, and **near** the closest-spelled other word; **same** plants
  nothing; **elsewhere** gives the rule another item's typed text, the item
  seven places on.
- **Outcomes**, on the whole dictation's words after the change: **right**
  when they are the passage as recognized; **none** when nothing changed;
  **contained** when they differ only between the phrase's end words;
  **collateral** when they differ anywhere else. For same and elsewhere,
  right is no change.
- **Bars**, as before: **safe** when collateral outcomes are at most 1% of
  all trials, the four kinds together; **useful** when safe and right is at
  least 80% of far and near trials; **magic** when safe and at least 95%.

## Experiment 1: a checked place

**What the second study found.** Rule 2 raised the right changes and made the
record's first collateral changes: with a heard word dropped, the rest fitted
another place.

**Rule 3.** Rule 2, and before its change is made, a check of the place. All
the heard words, with none dropped and no end word excused, are fitted by
word edit distance to every run of typed words in the window. The change is
made only when the best run that covers the chosen place fits better, by at
least one, than the best run that shares no word with it. Rule 1's own
decisions, both end words found exactly, are not checked.
`harness/rules.py` is the rule.

**Run.** On the fresh items, with the window complete as in the second
study: the typed text up to 0, 4 or 8 words after the phrase in turn, and the
correction leaned toward that window. On the fresh said-again pairs, as the
second study ran its own.

**Primary.** Right, of far and near, on the fresh items with rule 3 and
leaning, against the three bars. And **the check holds** when, on the fresh
said-again pairs from another recording, rule 3's collateral outcomes are at
most 1% of trials, and on both fresh sets its right share is at most 1 point
under rule 2's. Reported beside them: rules 1, 2 and 3, plain and leaned, on
both sets and by subset; changes that leave a wrong word, contained and
collateral together; and same-recording pairs.

## Experiment 2: a checked moment

**What the second study found.** At the key press the typed text was
complete for 56.7% of items. Silence fed there brought the words out and
changed the dictation after it. Its record ends: a correction would have to
wait until the dictation's stream has written them.

**The change.** Nothing is fed at the key press, and the dictation is one
session. The correction's session starts at the key press, leaned toward the
window typed by then. The rule decides later: when the dictation has had 0.8
s more audio, or has ended. It then works on the last 30 words typed by that
moment, words of the next utterance among them.

**Run.** On the fresh items, from the passage's recorded pushes: the rule
decides on the text typed 0, 0.4, 0.8 and 1.2 s into the next utterance, and
for comparison on Experiment 1's complete window with the same hearing. A
planted word is in the typed text only where its place is typed yet; where
it is typed later, it stays.

**Measures and bars.**

- **Window complete:** the words typed 0.8 s into the next utterance hold
  every word of the passage up to the phrase's end. Bar: at least 95% of
  items. The shares at 0, 0.4 and 1.2 s are reported.
- **Waiting costs nothing:** right, of far and near, with rule 3 decided at
  0.8 s, is at most 2 points under right on the complete window with the same
  hearing.
- **Safe, useful, magic** at 0.8 s with rule 3, as above.
- Reported: every delay with rules 2 and 3, heard plainly and leaned; and the
  passages where a push returned text that the final text doesn't start with.

## Experiment 3: a checked change, end to end

**What the second study found.** The ladder damaged nothing in seven
scenarios and did damage in an eighth, where focus had moved to a window the
accessibility interface doesn't expose. Refusing unless the field's window is
the active one removed that damage in the runs tried, on three scenarios. A
wrong word that occurs twice, an existing selection, more than one line and
text outside ASCII were not tried, and the ladder changed one made-up word.

**Ladder 2.** Given the text VOCO pasted, a run of characters in it and what
to put there:

1. Find the focused field; refuse when it can't be read.
2. Refuse unless the field's window is the active one.
3. Refuse when anything in the field is selected.
4. Check that the text before the caret ends with what was pasted, with a
   no-break space read as a space; refuse otherwise.
5. Where the field can be edited through the accessibility interface,
   replace the run there.
6. Otherwise, outside a terminal, select the run through the interface and
   paste over it, when the selection reads back as asked.
7. Otherwise, when only blank follows the caret on its line, send Backspace
   to the run's start and paste the replacement and what followed it.
8. Read the field again, and report **changed and verified** only when all
   the pasted text reads as asked and the text around it is unchanged;
   **refused**; or **failed and detected**.
9. Refuse when the place of a character can't be told for sure, as it may not
   be after a character outside the Basic Multilingual Plane.

**Session.** As the second study's: a headless GNOME Shell on Wayland, one
new session for each run, keys through Mutter's RemoteDesktop interface,
copies with xclip through XWayland in VOCO's order, and every field read back
by keyboard select and copy, or in the terminal by bash's `READLINE_LINE`.

**Scenarios**, with the second study's sentence and `peer` to `pier`: its
eight (caret untouched; Home pressed; two characters typed after; the field
cleared; focus moved to another field; text before the pasted text; text
after the caret; focus moved to a window the interface doesn't expose), and
five more:

- **twice:** the wrong word occurs twice in the pasted text, and the second
  is to change.
- **two lines:** a first line stands above the pasted text. Not for
  one-line fields or the terminal.
- **selected:** everything is selected after the paste.
- **emoji before:** `Notes 🙂 café: ` stands before the pasted text.
- **non-ASCII:** the pasted text holds `Zoë's naïve café`.

**Fields.** GNOME Text Editor, GTK 4 and GTK 3 text views and entries,
gedit, LibreOffice Writer, FeatherPad through XWayland, GNOME Terminal, and
Chromium, Epiphany and Electron each with a `textarea`, an `input` and an
editable `div`. Each field and scenario three times.

**The chain.** 60 of the fresh far and near trials, drawn with seed
20261123, as Experiment 2 decides them with rule 3 at 0.8 s. Where the rule
makes a change, the trial runs once in each of three fields, one for each way
of changing: gedit, Chromium's `textarea` and GNOME Terminal. The text typed
by the decision, with the planted word, is pasted in three parts cut where
pushes ended; the ladder makes the rule's change; the rest of the passage is
pasted; and the field is read back.

**Form.** The rule compares words without case or punctuation. Its change is
written this way. With as many new words as replaced ones, each new word, as
the correction's session wrote it without the punctuation around it, takes
the place of one typed word and keeps that word's punctuation, and takes a
capital first letter when the typed word had one and began a sentence. With a
different number, the new words replace the run from the first replaced word
to the last, and keep the punctuation before the first and after the last.
With no replaced word they go in after the left end word. With no new word
the replaced run goes, with the space before it. A planted word takes its
place the same way.

**Measures and bars.** Every run's field is **correct** (the text asked
for), **untouched** or **damaged**.

- **Safe:** no damaged field in any run, scenarios and chain together.
- **Honest:** no damaged or untouched field reported as changed and
  verified.
- **Useful:** correct in the four scenarios that should change the text in
  every field (caret untouched, text before, twice, non-ASCII) for at least
  80% of the fields run.
- **Faithful:** in every chain run the ladder reports as changed and
  verified, the field holds exactly the text the rule asked for.
- **Right end to end:** for each of the three fields, the field's words at
  the end are the passage as recognized, the wrong word gone and nothing else
  changed, in at least 80% of the 60 drawn trials. A trial where the rule
  made no change, or the ladder refused, counts as not right. The share with
  the same text, character for character, is reported.

## Checks of the record

- Every run's line holds the SHA-256 of the audio it was given, and every
  chain run names the SHA-256 of its trial file.
- `harness/verify.py` recomputes every table from the recorded runs, builds
  the chain's trial files again from the runs and the rule, classifies every
  field run again from its raw reads, checks that rule 2 here gives the
  second study's rule 2 outcome on every trial that study recorded, and with
  the recognizer and the audio, recognizes 40 sessions again, drawn by seed,
  and compares their text. Its output is committed.

## What these cannot show

- Nobody says anything twice on the fresh items: the correction is the
  phrase's own recording. The fresh said-again pairs are a second saying, on
  data the recognizer may have been trained on, cut as the second study cut
  them.
- The key press is put at the end of the phrase's audio, and the next
  utterance follows at once. A person pauses, presses, speaks and resumes,
  and how long each takes is not measured. A second session ran in a second
  worker's place; VOCO's worker holds one.
- The planted word stands for a mishearing. A real mishearing may also be
  misheard the second time, which the first study measured.
- Experiment 3 runs in a headless session, without a screen reader or a
  logged-in desktop. Firefox, Thunderbird and VS Code are not available on
  the test machine.
- No experiment types into a person's application, and none has a listener.
  VOCO has no such capability.
