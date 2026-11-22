# Reading and changing the focused field, November 2026

**Question.** A correction replaces a word VOCO pasted a moment ago. VOCO
pastes blind today, so the only way would be to send Backspace and paste the
corrected end. Could VOCO instead find the focused field through the Linux
accessibility interface (AT-SPI2), check that it still holds what VOCO pasted,
and replace the word there? In which applications does each step work?

**Answer.** Checking works almost everywhere; changing works in about half.
AT-SPI found the focused field and read its text and caret in 17 of 18 fields.
It replaced the word in place in 9, all the GTK 3, GTK 4, Qt and LibreOffice
fields. Chromium, WebKitGTK and the VTE terminals offer no way to edit, and
xterm offers nothing at all. A mixed way, where AT-SPI selects the wrong word
and VOCO's own paste replaces it, also worked in all six browser fields, so
15 of 18 fields had some replacement that needs no Backspace.

The check is what matters for safety. With the caret moved to the start
before the correction, blind Backspace and paste left
`pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` in
all 18 fields. The AT-SPI check saw that the text before the caret no longer
ended with what was pasted, and refused, in all 17 fields it could read.

This was not pre-registered. It ran once, on 21 and 22 November 2026, in an
X11 session under Xvfb, and says nothing about GNOME on Wayland or about
VOCO's snap. VOCO has no such capability and uses no accessibility interface.

## Setup

- **Session:** Xvfb with openbox, one new session, D-Bus session and home
  folder for each run, on Ubuntu 24.04 with at-spi2-core 2.52.0.
  [versions.txt](results/versions.txt) lists every package.
- **Text:** the made-up sentence `Let's meet at the peer on Thursday
  afternoon.`, pasted VOCO's way in three parts (xclip to CLIPBOARD and
  PRIMARY, then Shift+Insert with xdotool), to be corrected to `pier`.
- **Proof:** every result that says a field holds some text was read back
  without AT-SPI: Ctrl+Shift+Home, Ctrl+C, then Ctrl+A, Ctrl+C in a window, and
  bash's `READLINE_LINE` and `READLINE_POINT` in a terminal.
- **Runs:** 174, over 18 fields. None failed to start.

## Results

| Field | Found, text and caret read | Replaced in place | Select, then paste | Blind Backspace, caret untouched |
| --- | --- | --- | --- | --- |
| GNOME Text Editor 46 (GTK 4) | yes | yes | no, nothing changed | exact |
| GTK 4 text view (made for the test) | yes | yes | no, nothing changed | exact |
| GTK 4 entry (made for the test) | yes | yes | yes | exact |
| gedit 46 (GTK 3) | yes | yes | yes | exact |
| Mousepad 0.6 (GTK 3) | yes | yes | yes | exact |
| GTK 3 text view (made for the test) | yes | yes | yes | exact |
| GTK 3 entry (made for the test) | yes | yes | yes | exact |
| FeatherPad 1.4 (Qt 5.15) | yes | yes | yes | exact |
| LibreOffice Writer 24.2 | yes | yes | yes | exact |
| GNOME Terminal 3.52 (VTE), bash | yes, the whole screen | no | no, it added `peer` | exact |
| Xfce Terminal 1.1 (VTE), bash | yes, the whole screen | no | no, it added `peer` | exact |
| xterm 390, bash | no | no | no | exact |
| Chrome for Testing 153, `textarea` | yes | no | yes | exact |
| Chrome for Testing 153, `input` | yes | no | yes | exact |
| Chrome for Testing 153, editable `div` | yes | no | yes | exact |
| Epiphany 46 (WebKitGTK), `textarea` | yes | no | yes | exact |
| Epiphany 46 (WebKitGTK), `input` | yes | no | yes | exact |
| Epiphany 46 (WebKitGTK), editable `div` | yes | no | yes | exact |

[summary.md](results/summary.md) has every table, and
[runs.tar.xz](results/runs.tar.xz) the 174 result files.

- **Speed.** Replacing in place took 0.6 to 7.1 ms. Finding the field by
  walking the tree took 2 to 78 ms, and 377 ms in LibreOffice Writer, whose
  tree has 1,718 nodes; a listener for focus events named the same field
  without a walk in all 17.
- **The caret.** After a replacement the caret was back at the end by itself
  in 8 of the 9 fields, and after one more call in the GTK 3 entry. After
  select and paste it sat after the new word until moved.
- **What had to be turned on.** GTK, LibreOffice, WebKitGTK and the VTE
  terminals needed nothing. FeatherPad needed nothing when the accessibility
  bus was running before it started. Chromium exposed its pages only when the
  accessibility status was on before it started and it ran with
  `--force-renderer-accessibility`, in 2 of the 14 ways tried.
- **Select, then paste, can do harm.** In both VTE terminals the selection
  took PRIMARY, which Shift+Insert pastes there, so the line ended
  `afternoon.peer`. In the two GTK 4 text views the selection call failed and
  nothing was pasted.
- **No-break spaces.** The two editable `div` fields stored the space at a
  part's edge as a no-break space, so their text matched only with that read
  as a space. VOCO keeps spaces away from a paste's edges, which this test's
  three parts didn't.

## Limits

- X11 under Xvfb with openbox, not a real desktop. No Wayland session was
  tried, GNOME's included.
- Whether a strictly confined snap can reach the accessibility bus was not
  tried.
- Firefox, Thunderbird and every Electron application were unavailable: the
  machine had no snapd and couldn't reach their other sources. KWrite, Kate
  and Qt 6 weren't run.
- One sentence on one line. Longer text, other scripts, text after the caret,
  an existing selection, password and read-only fields, and what undo does
  after such a change were not tried.
- One run for each field and way, on a shared virtual machine. An earlier
  pass of 144 of the runs agreed in 143; the one that differed came before a
  fix to the harness. Five runs repeated afterwards by hand agreed.
- Chromium ran without its sandbox, as root.

## Reproduce

On Ubuntu 24.04, as root, with the packages `harness/run_all.sh` names and
Playwright's Chromium at `/opt/pw-browsers/chromium`:

```bash
cd research/voice-correction-2026-11/field-access/harness
./run_all.sh                     # every run, about 25 minutes
./run.sh gedit atspi             # one run
/usr/bin/python3.12 measure.py --list
```

The harness writes its results and a `work/` folder beside itself.
