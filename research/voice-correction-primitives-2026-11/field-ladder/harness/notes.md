## Notes (written by hand after reading the results above)

### Measured here, and confirmed by the independent read

- In the brief's seven scenarios the ladder never left a field in any state but "corrected" or "as the setup left it": 462 runs, 0 DAMAGED, and every CHANGED-VERIFIED and every REFUSED agrees with the independent read. The same outcome in all 3 repeats of every cell.
- Which rung each field took: rung 2 (EditableText) in GTK4, GTK3, LibreOffice Writer and FeatherPad through XWayland; rung 3 (AT-SPI selection + paste) in Chromium, Epiphany and Electron fields; rung 4 (BackSpace + paste) in gnome-terminal. With ` (draft)` after the caret rungs 2 and 3 still changed only the word, and the terminal refused.
- Extra hazard, not in the brief: when keyboard focus had moved to a window that AT-SPI did not expose, the ladder as specified damaged that window in 29 of 54 runs. The field the text had been pasted into still reported STATE_FOCUSED (GTK3, VTE, WebKitGTK, Chromium and Electron fields; not GTK4, LibreOffice or Qt), the last focus event was still its own, and step 1's check passed on it. Rung 2 then corrected the unfocused field (GTK3: the right text, 9/9, nothing in the other window). Rungs 3 and 4 sent their keys to the other window: `pier` pasted there (rung 3), or 27 BackSpace and `pier on Thursday afternoon.` (rung 4: gnome-terminal 3/3, and Epiphany's contenteditable once, where the selection did not read back). The other window was empty; BackSpace would have deleted text there. The ladder reported all 29 as FAILED-DETECTED, none as CHANGED-VERIFIED, and the pasted field's text was unchanged.
- In all of those runs the pasted field's top-level window had no STATE_ACTIVE, and in every run of the brief's scenarios where step 0 found a field (444) its window had it. The guard variant (refuse unless that window is ACTIVE) refused each of them: 0 DAMAGED in 162 runs, and it changed nothing in `plain` (54/54 still corrected).

### What differs from the earlier X11 (Xvfb + openbox) results

- FeatherPad (Qt 5.15) as a native Wayland client was not exposed in any of the 21 runs of the brief's scenarios, nor under QT_LINUX_ACCESSIBILITY_ALWAYS_ON (0/5), QT_ACCESSIBILITY, AT_SPI_BUS_ADDRESS or an empty XDG_CURRENT_DESKTOP. With org.a11y.Status IsEnabled=true before its start it was exposed in some runs only: 2/10 (`status`), 1/5 (`screen-reader`), and 6/36 when it was the second window of a Chromium or Electron session. Why it varies was not investigated. With IsEnabled=false it was exposed in 0 of 97 starts. Through XWayland it was exposed in every run once the X root window carried the AT_SPI_BUS property (set by the harness with xprop), and not without it (1 run each of 3 configs). Under Xvfb the earlier harness found that property set and FeatherPad readable with nothing added. Here nothing had set it: the Shell starts the accessibility bus itself.
- When it was not exposed, a GTK3 "featherpad" application with no windows was on the AT-SPI desktop (the Qt GTK platform theme's own bridge), and Qt's own connection to the accessibility bus had no root object (seen with `debug-a11y-bus.sh` in development runs that are not kept in results/).
- The accessibility bus was running before any app in every run (GNOME Shell is itself an AT-SPI application, about 1,300 objects, with a focused "window" object of its own). So the earlier "no bus when the app starts" case does not arise in this session, and step 0 must not take just any focused object.
- Chromium needed the same two things as on X11: IsEnabled=true before launch and --force-renderer-accessibility (3/3 for each of 3 fields). Neither alone exposed the page (0/3 each), nor did ScreenReaderEnabled=true (0/1, with or without IsEnabled). Setting ScreenReaderEnabled also turned IsEnabled on.
- GTK4, GTK3, LibreOffice Writer, gnome-terminal and Epiphany needed nothing, as on X11.
- The text read from contenteditable fields held U+00A0 where a chunk began with its space (Chromium and Electron 0 or 1, Epiphany 2 or 3); the ladder folds them, and the independent copy returned plain spaces.
- LibreOffice Writer's paragraph was found by the tree walk (about 0.3 s), not by the last focus event, whose object was not the paragraph. Every other exposed field was found from the last focus event.
- Copying with xclip through XWayland reached native Wayland clients in every run. Mutter's clipboard manager keeps CLIPBOARD's text after its owner exits, so the independent read copies a marker first instead of emptying the clipboard.

### Electron (45.4.1, native Wayland, --no-sandbox as root)

- Page fields were exposed only with IsEnabled=true before launch plus either `app.setAccessibilitySupportEnabled(true)` (3/3 per field) or --force-renderer-accessibility without the call (3/3 per field). The call alone: 0/3. The switch alone: 0/3. IsEnabled alone: 0/3. The switch and the call without IsEnabled: 0/1. ScreenReaderEnabled=true with the call: 1/1; without it: 0/1.
- Once exposed, its fields behaved as Chromium's: no EditableText, rung 3 in all 7 scenarios.
- Install: `npm install electron` exited 0 without the binary (this version downloads it on demand); the package's own `node node_modules/electron/install.js` failed once on a cut-off transfer and completed on the second run.

### Read, not run: what VOCO's snap plugs

- There is no `snapcraft.yaml` for VOCO's snap in the repository; `scripts/snap_package.py` renders `packaging/snap/snapcraft.yaml.in`. (The only file named `snapcraft.yaml` is the CI probe fixture `scripts/fixtures/snap-dbus-probe/snap/snapcraft.yaml`, which has one slot and no plugs.)
- The template's app `voco` has `plugs: [audio-playback, audio-record, login-session-observe]` and `extensions: [gnome]`, and one slot, `panel` (dbus, session bus, `com.sergiopesch.voco.Panel`).
- `scripts/snap_package.py` lists what the gnome extension adds and the built snap must have: app plugs `desktop`, `desktop-legacy`, `gsettings`, `opengl`, `wayland`, `x11`; content plugs `gtk-3-themes`, `icon-themes`, `sound-themes` (gtk-common-themes), `gnome-46-2404` and `gpu-2404` (mesa-2404).
- Whether a confined snap can reach the accessibility bus: not measured.

### Unavailable

- Firefox and Thunderbird: apt's only candidates are the snap stubs (`1:1snap1-0ubuntu5`, `2:1snap1-0ubuntu3`; Firefox pre-depends on snapd), and there is no snapd here. No other source was tried.
- VS Code: `apt-cache policy code` has no candidate. No other source was tried.

### Not run

- wl-copy as the copy path (it was installed; every copy was xclip through XWayland, as VOCO copies on GNOME Wayland).
- Chromium, Electron, GTK or LibreOffice through XWayland; only FeatherPad was run that way.
- A session with a screen reader running, with IsEnabled changed after an app started, or with gnome-session, gnome-settings-daemon or a portal. The Shell ran alone.
- A Qt 6 or KDE app. mousepad, xfce4-terminal and xterm from the earlier measurement.
- Text with more than one line, non-ASCII text, an existing selection, password or read-only fields, a wrong word that occurs twice.
- What an app's undo does after each rung.
- The hazard scenarios under the guard variant other than `other-field` and `other-unreadable`.
- A real hardware desktop and a confined snap.

### Unverified

- Why FeatherPad on native Wayland is exposed in some starts and not others with IsEnabled=true.
- What rung 3's misfire leaves selected in the unfocused field: the AT-SPI selection read back as the word in those runs, but the independent read only compares text.
- Whether a GNOME login sets the AT_SPI_BUS root property on XWayland or IsEnabled; this session is a bare headless Shell.
- Timings: one virtual machine whose 4 CPUs another job was using, 3 runs side by side. The "ladder time" column is a rough size only.

### Choices the harness made where the brief left room

- Step 0 polls for up to 4 s (10 s for the browsers and Electron) before refusing as unreadable. A target is focused, has Text, and is editable or a terminal.
- Rung 2 falls through to rung 3 only if the re-read shows text and caret exactly as before the EditableText calls; this never happened in these runs.
- After a failed selection rung 4 runs only if the text and caret still read as before (or the caret can be put back).
- A rung's verifying re-read is polled for up to 1.5 s. The ladder's rule is the brief's (the text before the caret ends with the corrected text); the stricter "whole text as expected" is recorded per run and held in every CHANGED-VERIFIED run.
- Classification uses only the independent read and the scenario's intended text. `text-after` first ran with a plain Home, which in gnome-text-editor and FeatherPad stops after the leading space; those 21 first-repeat files are in `results-superseded/`, and every `text-after` result in `results/` used Ctrl+Home (Home in the terminal).
- The second window of `other-field` is a synthetic GTK4 entry; of `other-unreadable`, FeatherPad as a native Wayland client. Where FeatherPad was exposed after all (6 of 108 such runs, guard variant included), the run behaved as `other-field`.
- Apps run with GSK_RENDERER=cairo and LIBGL_ALWAYS_SOFTWARE=1; Chromium and Electron with --no-sandbox, as root.

### Re-running

```
./run_all.sh                      # everything, 3 repeats, 3 sessions side by side (about 50 minutes here)
REPS=1 ./run_all.sh               # one repeat
RESUME=1 ./run_all.sh             # only the runs whose JSON is missing
./run.sh gedit plain              # one field + scenario -> results/gedit.plain.plain.r1.json
./run.sh chromium-input text-after --config status-force-renderer --rep 2
./run.sh gnome-terminal other-unreadable --config plain+guard
/usr/bin/python3.12 ladder.py --list   # cases, scenarios, configs
/usr/bin/python3.12 summarize.py       # results/*.json -> results/summary.md
/usr/bin/python3.12 show.py            # one line per result file
FIELD_LADDER_DEBUG="bash $PWD/debug-a11y-bus.sh" ./run.sh featherpad plain --config qt-always-on --rep dbg   # who is on the accessibility bus
```

Per-run logs: `work/<case>.<scenario>.<config>.r<rep>.log`; each run's Shell log, app log and screenshots: the `run_dir` its JSON names, under `work/`.

### How results/ was produced

- One `./run_all.sh` pass with REPS=1, then `RESUME=1 ./run_all.sh` twice as jobs were added (the guard variant, more repeats of the exposure probes). Between those passes the harness changed only in `text-after`'s Home key (above), the optional guard, and the rule that classifies a run; `summarize.py` classifies every file again from its raw reads with the current rule, so the tables do not depend on which pass wrote a file.
- 731 result files, none without a ladder result and an independent read. Nothing under /home/user/voco was written.
