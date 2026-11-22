# Three changes to correcting by voice: pre-registration

Fixed on 2026-11-22, after the [first study](../voice-correction-2026-11/README.md)
and before any run of Studies A and B, or of the confirmation, on held-out
data. Three studies, each for one change the first study pointed to. A draft
of this file was committed earlier the same day; what changed since is listed
at the end.

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
- **Two streams** were tried on dev items. With nothing fed at the key press,
  the resumed dictation had the words of the dictation in one go in 20 of 20
  resume items, and its first word started with a capital in 5 of 19, against
  6 of 20 in one go. With 0.4 or 0.8 s of silence fed there, it started with a
  capital in 13 and 14 of 20, and had the same words in 13 and 14. The typed
  text was complete at the key press in 4 of 6 passages with no silence and 6
  of 6 after 0.4 s. The recognizer returned one alternative when asked for
  five, so no study uses alternatives.
- **Said again:** the references of LibriSpeech-PC were searched for clauses
  one speaker says in two utterances. The cut below was calibrated on ten
  train-clean-100 groups that the seed did not draw, and the whole pipeline
  ran on them once. No recording of a drawn or held-out group was recognized.
- **The field ladder** (Study C) was given to a separate test with the
  procedure, scenarios and fields below before it ran, and the draft of this
  file fixed its bars while it ran. Its report arrived before this file was
  fixed. Nothing of Study C was changed after it.

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

**Dictation.** Each utterance whole, on a lab stream opened as the worker
opens it, with VOCO's look-ahead, because the worker's protocol gives no word
times. The first 20 utterances also go through the real worker, and the
record says how many of them came out the same.

**Cuts.** A pause is a run of 20 ms frames, 10 ms apart, each at least 12 dB
below the recording's median frame, at least 60 ms long. The cut before a
word is the middle of the longest pause whose middle lies 150 to 800 ms
before the start time the dictation pass gives that word. A clause is cut
before its first word and before the word after it; an end of the recording
needs no cut. A clause without such a pause on a side that needs one, whose
first word or the word after it the dictation pass didn't write, or shorter
than 0.3 s, is left out before any correction is recognized.

**Pairs.** With a group's first two utterances in ID order, both ways round:
the dictation is one utterance; the correction is the clause cut from the
other, recognized through the real worker. **Same recording** pairs, the
clause cut from the dictation's own recording, show what the cutting and the
first study's method give on these clauses. Where a third utterance exists,
the first utterance is also paired with the clause cut from the third.

**Trials.** The typed text is the dictation as recognized, up to 0, 4 or 8
words after the clause in turn. `far` and `near` plant a word inside the
clause's place as in the first study; `same` plants nothing; `elsewhere`
gives the rule another clause's typed text. A pair is left out when the
clause's place in the typed text is unknown or under three words. The clause
is recognized plainly, and leaned toward each far and near trial's window;
the two controls use the plain recognition.

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
been in one go? Is the typed text complete when the key is pressed? And what
does silence at the key press cost?

**Data.** The first study's test split: its items that have a place in the
passage as recognized, and its resume items.

**Run.** Lab access to the pinned recognizer, opened as the worker opens it,
with VOCO's look-ahead, 100 ms packets.

- **Typed text at the tap**, every item: a stream gets the previous utterance
  and the phrase, then up to 1.2 s of digital silence, its text read at 0,
  0.4, 0.8 and 1.2 s. The stream is then thrown away.
- **Passage**, the first 100 items in ID order: the first stream gets the
  previous utterance and the phrase; with nothing fed at the tap, a second
  stream gets the phrase and finishes; the first stream gets the next
  utterance and finishes.
- **Resume item:** the item's previous utterance and the item in one stream,
  in one go; and on two streams with a correction on the second between
  them, once with nothing fed at the tap and once with 0.4 s of digital
  silence.

**Measures and bars.**

- **Window complete:** the stream's words after 0.4 s of silence hold the
  typed text up to the phrase's end, as the first study's passage has it. Bar:
  at least 95% of items. The shares at 0, 0.8 and 1.2 s are reported.
- **Same words:** with nothing fed, the first stream's final words equal the
  first study's passage. Bar: at least 95%. The share with the same text
  exactly is reported.
- **Capital:** the share of resume items whose first word starts with a
  capital on two streams with nothing fed. Bar: at most 10 points above the
  share in one go. Reported beside them: the share with 0.4 s of silence fed,
  the first study's share in a session of its own, and the share of resume
  items with the same words as in one go, with nothing and with silence fed.
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
  king" and its like, and are cut from longer recordings at short pauses. A
  cut in the wrong pause gives a clip with a word too many or too few, which
  can only lower its results. They show a second saying of the same words by
  the same voice, not someone correcting.
- Study B's silence is digital zero, and its correction is a recording, not
  speech that follows a key press. A person pauses before pressing a key, and
  that pause is in the dictation's own audio whatever VOCO feeds.
- Study C runs in a headless session with one made-up sentence.
- No study types into a person's application, and none has a listener.

## Changed since the draft

- **Study A:** the dictation runs on a lab stream with word times instead of
  through the worker, with a check against the worker. The cut uses pauses of
  at least 60 ms found 150 to 800 ms before a word's start time, in place of
  the pause study's single quiet frame, which found a cut for 2 of 22 practice
  clauses. Clause positions are counted as the whole reference's words are
  counted, after a dash joined two words and moved one clause's place.
- **Study B:** nothing is fed at the tap in the runs that carry the same-words
  and capital bars, after dev showed that fed silence itself starts a
  sentence; the silence is measured beside them. The typed text at the tap is
  read on a stream of its own, with its bar at 0.4 s instead of 0.8 s. The
  whole passage runs for the first 100 items.
- **Study C:** nothing.
