# Field ladder v2: harness notes

Research tooling. It runs only in the headless sessions it creates, and VOCO
uses none of it. These notes are what was learned while the harness was built,
before any measurement: nothing here is a result.

## What changed from the first ladder

The harness is a copy of
`research/voice-correction-primitives-2026-11/field-ladder/harness`, changed
as follows.

- The request is a span of the pasted text and its replacement, not one word.
- Every run refuses unless the field's top-level window is ACTIVE, and when
  the field reports selected text.
- A change is reported as verified only when the whole text reads as the
  changed one, the caret stands at the end of the changed text and nothing is
  selected.
- Outside a terminal, a span that can't be selected through the interface is
  refused. Backspace and paste is the terminal's rung only.
- Offsets are checked against the interface before they are used (below).
- `--trial FILE.json` pastes a trial's parts, runs the ladder, pastes its
  `rest` at the caret whatever the ladder reported, and compares the field
  with the trial's `expected`.
- Five scenarios are new: `twice`, `two-lines`, `selected-all`, `emoji-before`
  and `non-ascii`.

The rungs keep their old numbers so results compare: rung 2 is EditableText,
rung 3 selection or caret through the interface and then paste, rung 4
Backspace and then paste.

## The probe extension

`probe/` is a GNOME Shell 46 extension, `field-ladder-probe@test.invalid`,
copied into each run's throwaway home. It exports `org.fieldladder.Probe` at
`/org/fieldladder/Probe` on the Shell's own bus connection: the windows with
their frame rectangles, focus and client type, whether the Shell is still
starting, the overview, the pointer, a screenshot and window activation. It
sends no key and changes no text.

The first study's harness copied this folder but it was never committed, so
that harness can't run as it stands. This one was written again from what
`ladder.py` calls. Its window rectangles are the frame's; whether the lost
one reported the same rectangle is not known. The clicks that focus a field
landed in every case tried.

## What each toolkit's offsets count

The accessibility interface says nowhere what its offsets count. The ladder
tries code points, UTF-16 code units and UTF-8 bytes: the caret must fall on a
character with the pasted text before it, and the pasted text and the span
must read back at the offsets that unit gives. One unit, or several that give
the same offsets, is an answer; anything else is a refusal. After the change
the unit is settled again on the changed text, since a replacement can hold
characters the old text didn't.

Seen with `Notes 🙂 café: ` before the pasted text, with the é also as e and
U+0301, and with an emoji in the replacement:

| Field | Reads: caret and text | What the ladder set or edited |
| --- | --- | --- |
| GTK 3.24: gedit, text view, entry | Code points | EditableText and caret: code points |
| GTK 4.14: Text Editor, text view, entry | Code points | EditableText: code points |
| Qt 5.15: FeatherPad through XWayland | UTF-16 code units | EditableText: UTF-16 code units |
| LibreOffice Writer 24.2, which names its toolkit `gtk` | UTF-16 code units | EditableText and caret: UTF-16 code units |
| VTE 0.76: GNOME Terminal | Code points | Nothing: keys only |
| WebKitGTK 2.52: Epiphany's three fields | Code points | Selection and caret: code points |
| Chromium 153 and Electron 45: their three fields | Code points | Selection and caret: code points, but see below |

- A combining mark is one offset of its own in every row: none counts what a
  person sees as one character.
- **Chromium and Electron.** `add_selection` selects the code points asked
  for, but `get_selection` then reads one lower for each character outside
  the Basic Multilingual Plane before it; the caret reads right. The ladder
  can't tell that from a wrong selection, so it refuses there: with an emoji
  before the pasted text these six fields are refused, untouched. A draft that
  tried the next unit when the selection didn't read back got a read-back that
  matched and a paste one character off, in four of four runs; the ladder
  reported each as failed. It now sets a selection once, in the unit its reads
  use, and wants three reads to agree: the selection's offsets, the text
  between them and the caret at one of its ends.
- **EditableText's own unit** can't be read. Where units give different
  offsets, the ladder first asks `copy_text` for the pasted text at its
  offsets and wants it back on the clipboard; otherwise it refuses. It came
  back right in GTK 3, GTK 4, Qt and LibreOffice.
- **LibreOffice** leaves the range `copy_text` copied selected, and removing
  that selection sends the caret to the paragraph's start. The ladder removes
  it and puts the caret back before it edits. After that the field's text and
  the place of the next paste were right, but the first Ctrl+Shift+Home
  selected nothing, so the keyboard read of the text before the caret came
  back empty in those runs.
- **Qt's InsertText** resizes the text to the length given, in UTF-16 code
  units, and pads with NUL when the length is longer. ATK and GTK take bytes,
  as libatspi documents. The ladder gives Qt UTF-16 code units and everything
  else bytes. A draft that gave Qt bytes left a NUL after `café` once, and
  reported the run as failed.
- **VTE** counts `get_character_count` in bytes while its caret and text
  offsets are code points. Lines the terminal wraps read as one line.
- **The terminal's rung** sends one Backspace for each character from the
  span's start to the pasted text's end, so it refuses when one of those is a
  combining mark, a joiner or outside the Basic Multilingual Plane.
- **bash 5.2** counts `READLINE_POINT` in characters.

## Other things seen

- With the window check built in, `other-unreadable` refused in the three
  fields tried, two of which the first ladder damaged there.
- After Return in a Chromium or Electron editable `div`, the pasted text is
  in a child the focused object shows only as U+FFFC, and the ladder refuses:
  `two-lines` there is a refusal with the field untouched. Epiphany's editable
  `div` gave one text with a newline and was changed.
- In LibreOffice Writer the first line is another paragraph, and the ladder
  sees only the pasted one.
- A replacement that is empty is refused at rung 3, which can only paste.
- `rest` is pasted even after a failed change. When a draft failed with the
  caret left after the replacement, `rest` landed there and the field read
  damaged, twice.

## Unavailable

Nothing the cases need. Electron 45.4.1 installed with `npm install electron`
and `node node_modules/electron/install.js`; `run_all.sh` leaves its cases out
with a message when it isn't installed, or with `ELECTRON=0`. Firefox,
Thunderbird and VS Code were unavailable to the first study and were not
looked for again.

## Runs made while this was built

159 ladder sessions and 16 sessions of throwaway probes, on one machine whose
4 CPUs another job was using. One ran the first ladder with the new probe
(gedit, `plain`, changed and correct). The other 158 ran v2 as it stood at
the time, so the earlier ones ran drafts. None is a result, and none is kept.

C2, C3 and C4 mean changed at that rung and read back correct; R refused and
read back untouched; F failed and detected. A count follows where a cell ran
more than once.

| Field | plain | home | typed-after | cleared | other-field | prefilled | text-after | other-unreadable | twice | two-lines | selected-all | emoji-before | non-ascii |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gnome-text-editor | C2 |  |  |  |  |  |  |  |  | C2 | R | C2 |  |
| gtk4-textview | C2 |  |  |  |  |  |  |  |  | C2 | R | C2 |  |
| gtk4-entry |  |  |  |  |  |  |  |  |  | not applicable |  | C2×2 |  |
| gedit | C2×6 |  |  | R |  |  |  | R | C2 | C2 | R | C2×3 | C2 |
| gtk3-textview | C2 |  |  |  | R |  |  |  |  |  |  |  |  |
| gtk3-entry |  |  |  |  |  |  |  |  |  |  | R | C2 |  |
| libreoffice-writer | C2 |  |  |  |  | C2 |  |  |  | C2 | R | C2×3 | C2 |
| featherpad | C2×2 |  |  |  |  |  |  |  |  |  | R | C2×3 | C2 |
| gnome-terminal | C4×3 | R |  |  |  |  | R | R | C4 |  | R | C4×2 | C4 |
| chromium-textarea | C3×3 |  |  |  |  |  | C3 | R | C3 |  | R | R×2, F3 damaged |  |
| chromium-input | C3×2 |  |  |  |  |  |  |  |  |  |  | R, F3 damaged | C3 |
| chromium-contenteditable | C3 |  |  |  |  |  |  |  |  | R | R | R×2, F3 damaged |  |
| epiphany-textarea | C3 |  | R |  |  |  |  |  |  | C3 |  | C3×2 |  |
| epiphany-input | C3 |  |  |  |  |  |  |  |  |  |  | C3 |  |
| epiphany-contenteditable | C3 |  |  |  |  |  |  |  |  | C3 | R | C3 |  |
| electron-textarea | C3 |  |  |  |  |  |  |  |  |  |  | R, F3 damaged |  |
| electron-input |  |  |  |  |  |  |  |  |  |  |  | R |  |
| electron-contenteditable | C3 |  |  |  |  |  |  |  |  | R |  |  |  |

Six trial files written for this, none of them kept: `dev-long`, 409
characters with a five-word replacement and a `rest`; `dev-remove`, a single
space for `, um, `; `dev-insert`, an empty span and a `rest`; `dev-combining`,
a combining mark after the span; `dev-accent`, é and ë in the text and the
replacement; `dev-emoji-replacement`, an emoji in the replacement.

| Field | dev-long | dev-remove | dev-insert | dev-combining | dev-accent | dev-emoji-replacement |
|---|---|---|---|---|---|---|
| gnome-text-editor |  |  |  |  | C2 |  |
| gtk4-textview |  |  |  |  | C2 |  |
| gtk4-entry |  |  |  |  | C2 | F2 with the field correct, C2 |
| gedit | C2×2 | C2×2 | C2×3 | C2×2 | C2×2 | F2 with the field correct, C2×2 |
| gtk3-entry |  |  |  |  | C2 |  |
| libreoffice-writer |  |  |  |  | C2 | C2×2 |
| featherpad |  |  |  | C2 | F2 damaged, C2 | C2×2 |
| gnome-terminal | C4×2 | C4 | C4 | R | C4 | C4×2 |
| chromium-textarea | C3 | C3 | C3 | C3 |  | F3 damaged, C3 |
| chromium-contenteditable |  |  |  |  | C3 | C3 |
| epiphany-input |  |  |  |  |  | C3 |
| epiphany-contenteditable |  |  |  |  | C3 | F3 damaged, C3 |

One of gedit's three `dev-insert` runs asked for `--refuse-expected`, to see
that the flag is recorded.

`emoji-before` with other text first (`--before`), once each:

| Field | Emoji and e + U+0301 | The eleven characters `\U0001F642` and e + U+0301 |
|---|---|---|
| gtk4-textview | C2 | C2 |
| gedit | C2 | C2 |
| libreoffice-writer | C2 | C2 |
| featherpad | C2 | C2 |
| gnome-terminal | C4 | C4 |
| chromium-textarea | R | C3 |
| epiphany-textarea | C3 | C3 |
| epiphany-contenteditable | C3 | C3 |

The second column was a mistake in the command that turned out useful: no
emoji, so it shows the combining mark alone.

**Damage seen, seven runs, all with drafts and all reported as failed:**

- Four `emoji-before` runs in Chromium and Electron, from the retry in
  another unit described above. The field read
  `…meet at the ppieron Thursday afternoon.`
- FeatherPad, `dev-accent`: the NUL after `café`, from the length given to
  Qt.
- Chromium `textarea` and Epiphany's editable `div`, `dev-emoji-replacement`:
  the change itself was right, the draft's check of the unit on the changed
  text failed where a read past the text's end is cut off, and `rest` was then
  pasted after the replacement, not at the end. The same draft reported gedit
  and the GTK 4 entry as failed with the field correct.

No run reported a change as verified on a field that read back untouched or
damaged.

The probes, 16 sessions with the same text before the pasted sentence:
`copy_text` in each unit (GTK 3 and 4 text views, GTK 4 entry, LibreOffice,
FeatherPad); what a selection and a caret set through the interface really
select, by typing over them (Chromium and Epiphany `textarea`; the GTK 4 text
view's `add_selection` gave an error); and LibreOffice after `copy_text`, eight
sessions.

## Unverified

- The full matrix and the trials. Most cells ran once or not at all: 166 of
  the 234 never.
- `home`, `typed-after`, `cleared`, `other-field`, `prefilled` and
  `text-after` ran in one or two fields each; their code is the first
  ladder's.
- Electron ran in five cells. `gtk3-textview` and `gtk3-entry` ran in two each.
- The refusals and failures no field here produces: a field whose selections
  can't be read, `copy_text` that doesn't return the pasted text, a selection
  or caret that can't be put back, two units that read back with different
  offsets.
- Whether Chromium's selection reads back wrongly in other versions, and why.
- Why LibreOffice ignores the first Ctrl+Shift+Home after a selection made
  and removed through the interface, and what else that state changes.
- A trial on Epiphany's `textarea`, on Electron and on the GTK 3 text view.
- `FIELD_LADDER_SLOW` ran once, at 2, on gedit.
- Timings. The machine was shared, so none is reported.

## Running it

```bash
./run_all.sh                          # every case x 13 scenarios x 3 repeats
REPS=1 ./run_all.sh                   # one repeat
RESUME=1 ./run_all.sh                 # only the runs whose JSON is missing
ELECTRON=0 ./run_all.sh               # without the Electron cases
./run_all.sh --list                   # the jobs, nothing run
./run_all.sh --trials DIR gedit gnome-terminal   # every DIR/*.json once on each case
./run.sh gedit plain                  # one run -> results/gedit.plain.plain.r1.json
./run.sh chromium-input text-after --config status-force-renderer --rep 2
./run.sh gedit plain --trial t.json   # -> results/gedit.trial-<id>.plain.r1.json
/usr/bin/python3.12 ladder.py --list  # cases, scenarios, configs
/usr/bin/python3.12 summarize.py      # results/*.json -> summary.md, summary.json
/usr/bin/python3.12 show.py           # one line per result file
```

- A trial file's name must hold no space. `--refuse-expected` beside
  `--trial` says the right end is the untouched field; `run_all.sh --trials`
  doesn't pass it.
- `--before TEXT` with `emoji-before` puts other text in the field first. Give
  such a run its own `--rep`: the summary lists it apart from the matrix.
- `FIELD_LADDER_SLOW=2` doubles every fixed wait on a busy machine.
- Per-run logs are `work/<case>.<scenario>.<config>.r<rep>.log`; each run's
  Shell log, app log and screenshots are in the `run_dir` its JSON names.
