# Study C: the field ladder on Wayland

**Question.** Does one ordered procedure change the right text in the focused
field, and refuse otherwise, in a GNOME Shell session on Wayland?

**Answer.** In the seven [pre-registered](../PREREGISTRATION.md) scenarios,
yes. Over 462 runs the ladder changed the text in 186 and refused in 276, and
a read that doesn't use the accessibility interface agreed every time: the
right text in all 186, the field untouched in all 276, and no field damaged.
All three bars are met.

One hazard outside the pre-registered seven did damage. When focus had moved
to a window the accessibility interface doesn't expose, the pasted field
still reported itself focused in five toolkits, the check passed on it, and
the keys or the paste went to the other window: 29 of 54 runs. The ladder
reported every one of them as failed, never as changed. Refusing unless the
field's window is the active one removed the damage in the runs tried.

This ran on 22 November 2026 in a headless GNOME Shell 46 with one made-up
sentence. VOCO has no such capability and uses no accessibility interface.

## Setup

- **Session:** `gnome-shell --headless --wayland` from Ubuntu 24.04, one new
  session, D-Bus session and home folder for each run, with XWayland.
  [versions.txt](results/versions.txt) lists every package.
- **Keys:** Mutter's RemoteDesktop interface, as VOCO's CI sends them.
- **Copy:** xclip through XWayland, PRIMARY then CLIPBOARD, then Shift+Insert,
  which is VOCO's order on GNOME Wayland.
- **Text:** `Let's meet at the peer on Thursday afternoon.`, pasted in three
  parts that each begin with their space, to be corrected to `pier`.
- **Proof:** every field was read back by keyboard select and copy, and in the
  terminal by bash's `READLINE_LINE` and `READLINE_POINT`.
- **Runs:** each field and scenario three times, with the same outcome all
  three times in every cell.

## Results

C2, C3 and C4 mean changed by replacing in place, by select and paste, and by
Backspace and paste, with the corrected text read back. R means refused, with
the field read back untouched.

| Field | Untouched | Home | Typed after | Cleared | Other field | Text before | Text after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GNOME Text Editor, GTK 4 text view and entry | C2 | R | R | R | R | C2 | C2 |
| gedit, GTK 3 text view and entry | C2 | R | R | R | R | C2 | C2 |
| LibreOffice Writer | C2 | R | R | R | R | C2 | C2 |
| FeatherPad as a Wayland client | R, unreadable | R | R | R | R | R | R |
| FeatherPad through XWayland | C2 | R | R | R | R | C2 | C2 |
| GNOME Terminal, bash | C4 | R | R | R | R | C4 | R |
| Chromium `textarea`, `input`, editable `div` | C3 | R | R | R | R | C3 | C3 |
| Epiphany `textarea`, `input`, editable `div` | C3 | R | R | R | R | C3 | C3 |
| Electron `textarea`, `input`, editable `div` | C3 | R | R | R | R | C3 | C3 |

- **Safe, no damaged field:** met, 0 of 462.
- **Honest, nothing damaged or untouched reported as changed:** met, 0.
- **Useful, correct in the two scenarios that should change the text for at
  least 80% of fields:** met for 21 of the 22 rows run; the exception is
  FeatherPad as a Wayland client, which the ladder couldn't read.

[summary.md](results/summary.md) has every table, and
[runs.tar.xz](results/runs.tar.xz) the 731 result files.

### Outside the pre-registered scenarios

**Focus on a window the interface doesn't expose.** After the pastes, an
empty FeatherPad window took keyboard focus.

| Pasted field | What happened | Runs |
| --- | --- | --- |
| GTK 3 fields | Replaced in place in the pasted field; the other window untouched | 9 of 9 |
| GNOME Terminal | 27 Backspace and the corrected end went to the other window | 3 of 3 damaged |
| Chromium, Epiphany, Electron | `pier` was pasted into the other window | 26 of 27 damaged |
| GTK 4 fields, LibreOffice, FeatherPad through XWayland | Refused | 15 of 15 |

In every run that acted on the stale field, its window was not the active
one, and in every run of the seven scenarios where a field was found, it was.
A variant that refuses unless the window is active damaged nothing in 162
runs, and still corrected the untouched field in 54 of 54.

**What each application needed to be read.**

- GTK 4, GTK 3, LibreOffice Writer, GNOME Terminal and Epiphany: nothing.
- Chromium and Electron: the accessibility status turned on before they
  start, and `--force-renderer-accessibility` or, in Electron, the
  application's own call. Either alone exposed nothing.
- FeatherPad (Qt 5.15) as a Wayland client: nothing in 97 starts with the
  status off, and 9 of 53 with it on. Through XWayland it was read every time
  once the accessibility bus's address was set on the X root window.

**VOCO's snap**, read and not run: `packaging/snap/snapcraft.yaml.in` plugs
`audio-playback`, `audio-record` and `login-session-observe` and uses the
`gnome` extension, which `scripts/snap_package.py` lists as adding `desktop`,
`desktop-legacy`, `gsettings`, `opengl`, `wayland` and `x11`. Whether a
confined snap can reach the accessibility bus was not measured.

## Limits

- A headless Shell alone, without gnome-session, the settings daemon or
  portals, and no screen reader. Whether a real login turns the accessibility
  status on, or sets the bus address for XWayland, is not known from this.
- One sentence on one line. A wrong word that occurs twice, longer text,
  other scripts, an existing selection, password and read-only fields, and
  undo were not tried.
- Firefox, Thunderbird and VS Code were unavailable. Qt 6 and KDE
  applications weren't run.
- The active-window guard ran on three scenarios, not all eight. The other
  window in the damage runs was empty, so what Backspace deletes there is not
  shown.
- Why FeatherPad as a Wayland client is exposed only sometimes is unknown.
- The machine was shared with another job, so no timing is reported.
- One run set by a separate test. Five of its runs repeated afterwards by
  hand gave the same outcomes.

## Reproduce

On Ubuntu 24.04, as root, with the packages `harness/run_all.sh` names,
Playwright's Chromium at `/opt/pw-browsers/chromium` and, for the Electron
rows, `npm install` in `harness/electron-app`:

```bash
cd research/voice-correction-primitives-2026-11/field-ladder/harness
./run_all.sh                          # every run, about 50 minutes
./run.sh gedit plain                  # one run
/usr/bin/python3.12 ladder.py --list
```

The harness writes its results and a `work/` folder beside itself.
