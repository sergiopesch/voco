# Three changes to correcting by voice: pre-registration

Written 2026-11-22, after the [first study](../voice-correction-2026-11/README.md)
and before any run named below on held-out data. Three studies, each for one
change the first study pointed to.

## What was seen before this file

- The first study's results on both of its splits, in aggregate, and its dev
  items one by one. Its test items were not read one by one, except the three
  its record quotes.
- **Rule 2**, below, was designed on the first study's dev split against text
  the recognizer itself typed: 84.4% right (444/526) where rule 1 gave 80.6%,
  with no collateral change.
- **Leaning**, below, was tried on that dev split: with rule 2, 89.0% right
  (468/526), with no collateral change, and in none of the misses did the
  leaned session write the planted word. Leaning toward pairs of neighbouring
  words was started on dev and stopped unfinished; it is not used here.
- **Two streams** were tried on 12 dev items: the resumed dictation and the
  correction came out as in one go and on its own in all 12. The recognizer
  returned one alternative when asked for five, so no study uses alternatives.
- **Said again:** the references of LibriSpeech-PC were searched for clauses
  one speaker says in two utterances. No recording of them was recognized.
- **The field ladder** (Study C) was given to a separate test with the
  procedure and scenarios below before it ran. It was running when this file
  was written, and none of its results had been seen.

## The two changes to recognition and matching

**Rule 2.** Rule 1 of the first study first, unchanged. Only when rule 1 finds
its two end words nowhere in the window, these steps in turn, the first that
finds a place deciding, change or not:

1. End words nearly spelled alike count as found: one letter apart from four
   letters, two from eight.
2. One heard word is dropped from the start, the end or both, with exact end
   words, while three heard words remain.
3. Both.

The typed end words always stay as typed. `harness/rules.py` is the rule.

**Leaning.** The correction's session starts with the words of the typed
window, the last 30 words, each once as typed, as its My words list, so the
worker boosts them at its pinned strength. Nothing else of the session
changes.

**Confirmation.** On the first study's test split, against text the
recognizer itself typed (that study's passage as recognized, with the phrase
on its own as the correction): right, of far and near, with rule 2 and
leaning, against the bars. This is the same recording said once, so it shows
the two changes on the first study's ground, not a second saying.

**Bars**, as in the first study: **safe** when collateral outcomes are at most
1% of all trials; **useful** when safe and right is at least 80% of far and
near trials; **magic** when safe and at least 95%.

## Study A: said again

**Question.** The first study replayed one recording. When the same person
says the same words in another recording, does the correction land?

**Data.** LibriSpeech-PC references with LibriSpeech audio (CC BY 4.0). A
clause is the words between two punctuation marks of the reference, or an end
of the utterance, 3 to 6 words after normalization. A group is one speaker
and one clause said in two or more different utterances. Speakers of
`tests/fixtures/speech` are left out.

- **Held out:** every group of test-clean, test-other, dev-clean and
  dev-other: 59 groups.
- **train-clean-100:** 141 of its 331 groups, drawn with seed 20261122. The
  recognizer may have been trained on this set, so it is reported apart and
  carries no bar.

**Cuts.** A timing pass (lab access, look-ahead 1, word times) finds each
clause in its recording. A clause is cut out at the quietest 20 ms frame
between it and its neighbour on each side, as the pause study cut, with the
search widened by 80 ms either way; the frame must be at least 12 dB below the
recording's median frame. An end of the recording needs no cut. A clause
without such a quiet point, whose edge words the timing pass didn't recognize,
or shorter than 0.3 s, is left out before any correction is recognized.

**Pairs.** With a group's first two utterances in ID order, both ways round:
the dictation is one utterance, whole, through the real worker as in the first
study; the correction is the clause cut from the other. **Same recording**
pairs, the clause cut from the dictation's own recording, show what the
cutting and the first study's method give on these clauses. Where a third
utterance exists, the first utterance is also paired with the clause cut from
the third.

**Trials.** The typed text is the dictation as recognized, up to 0, 4 or 8
words after the clause in turn. `far` and `near` plant a word inside the
clause's place as in the first study; `same` plants nothing; `elsewhere`
gives the rule another clause's typed text. A pair is left out when the
clause's place in the typed text is unknown or under three words. The clause
is recognized plainly, and leaned toward each trial's window.

**Primary.** Right, of far and near, for other-recording pairs on held-out
data with rule 2 and leaning, against the bars; collateral over the four
kinds of trial. Reported beside it: rule 1 and rule 2, plain and leaned, for
other-recording and same-recording pairs, on both sets; and for clauses said
three times, near trials right at the first attempt and within two.

## Study B: two streams

**Question.** A correction in a session of its own split the dictation: the
first study's resumed dictations started with a capital mid-sentence. If the
dictation's stream stays open, a second stream hears the correction, and the
dictation goes on in the first, is the dictation's text what it would have
been in one go, and is the typed text complete when the key is pressed?

**Data.** The first study's test split: its items that have a place in the
passage as recognized, and its resume items.

**Run.** Lab access to the pinned recognizer, opened as the worker opens it,
with VOCO's look-ahead, 100 ms packets.

- **Passage:** the first stream gets the previous utterance and the phrase;
  then up to 1.2 s of digital silence, the text read at 0, 0.4, 0.8 and 1.2 s;
  a second stream gets the phrase and finishes; the first stream gets the next
  utterance and finishes.
- **Resume item:** the item's previous utterance and the item in one stream,
  in one go; and the previous utterance, 0.8 s of silence, a correction on a
  second stream, then the item on the first.

**Measures and bars.**

- **Window complete:** the first stream's words at 0.8 s of silence hold the
  typed text up to the phrase's end, as the first study's passage has it. Bar:
  at least 95% of passages.
- **Same words:** the first stream's final words equal the first study's
  passage. Bar: at least 95%. The share with the same text exactly is reported.
- **Capital:** the share of resume items whose first word starts with a
  capital on two streams. Bar: at most 10 points above the share in one go.
  The first study's share in a session of its own is reported beside them.
- The share of corrections whose text on the second stream equals the first
  study's phrase on its own.

## Study C: the field ladder on Wayland

**Question.** The first [field measurement](../voice-correction-2026-11/field-access/README.md)
ran separate steps in an X11 test session. Does one ordered procedure change
the right text, and refuse otherwise, in a GNOME Shell session on Wayland?

**Procedure.** Given the text VOCO pasted, the wrong word's place in it and
the right word:

1. Find the focused field; refuse when it can't be read.
2. Check that the text before the caret ends with what was pasted, with a
   no-break space read as a space; refuse otherwise.
3. Where the field can be edited through the accessibility interface, replace
   the word there.
4. Otherwise, outside a terminal, select the word through the interface and
   paste over it, when the selection reads back as asked.
5. Otherwise, when only blank follows the caret on its line, send Backspace to
   the wrong word and paste the corrected end.
6. Read the field again, and report **changed and verified**, **refused** or
   **failed and detected**.

**Scenarios.** For each field: caret untouched; Home pressed; two characters
typed after; the field cleared; focus moved to another field; text before the
pasted text; text after the caret.

**Fields.** GNOME Text Editor, GTK 4 and GTK 3 test fields, a GTK 3 editor,
FeatherPad, LibreOffice Writer, GNOME Terminal, Chromium and Epiphany with a
`textarea`, an `input` and an editable `div`, and an Electron window with the
same three. Firefox, Thunderbird and VS Code can't be installed on the test
machine.

**Measures and bars.** Every run's field is read back without the
accessibility interface where possible, and is **correct**, **untouched** or
**damaged**.

- **Safe:** no damaged field in any run.
- **Honest:** no damaged or untouched field reported as changed and verified.
- **Useful:** correct in the two scenarios that should change the text (caret
  untouched, text before) for at least 80% of the fields run.

## What these cannot show

- Study A's clauses are read aloud in audiobooks, many of them "said the
  king" and its like, and are cut from longer recordings. They show a second
  saying of the same words by the same voice, not someone correcting.
- Study B's silence is digital zero, and its correction is a recording, not
  speech that follows a key press.
- Study C runs in a headless session with one made-up sentence.
- No study types into a person's application, and none has a listener.
