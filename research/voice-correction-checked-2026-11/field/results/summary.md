# Field ladder v2 on GNOME Wayland: results

- Session: wayland: gnome-shell --headless --virtual-monitor, keys through Mutter's RemoteDesktop API; GNOME Shell 46.0, headless with one 1280x800 virtual monitor, its own D-Bus session, a throwaway HOME and a short XDG_RUNTIME_DIR; one fresh session per run.
- Keys and clicks: Mutter's RemoteDesktop D-Bus API (NotifyKeyboardKeycode, NotifyPointerMotionRelative, NotifyPointerButton), as VOCO's CI sends them.
- Copy: xclip through XWayland, PRIMARY then CLIPBOARD, then Shift+Insert (VOCO's order on GNOME Wayland).
- AT-SPI client: libatspi through python3-gi on Python 3.12; it connects and registers its focus listener before the app starts.
- In the fresh session: `toolkit-accessibility` = `false`, org.a11y.Bus running once the Shell is up: True, org.a11y.Status then: `{'IsEnabled': False, 'ScreenReaderEnabled': False}`.
- Classes, from the read that doesn't use the accessibility interface: **correct** = the field holds the changed text; **untouched** = it holds everything pasted and nothing changed; **damaged** = anything else; unverified = that read gave nothing.
- Result files: 882 (702 of the matrix, 180 trial runs, 0 with `--before`).

## Headline counts

### The matrix: every field × every scenario

- Runs: 702; not applicable: 18; with a ladder report and an independent read: 684; without: 0.
- Ladder said CHANGED-VERIFIED: 333; independent class: correct: 333.
  - by rung: rung 2: 162, rung 3: 156, rung 4: 15
  - caret at the end of the changed text by the independent read: 327/333 of the correct ones
- Ladder said REFUSED: 351; independent class: untouched: 351.
  - reasons: moved or changed: 225, text selected: 51, window not ACTIVE: 36, selection did not read back: 18, unreadable: 15, offsets unsure: 3, text after caret: 3
- Ladder said FAILED-DETECTED: 0.
- **Damaged: 0/684**; of them, where the ladder sent nothing: 0.
- **Honesty violations (changed and verified on an untouched or damaged field): 0**.
- Unverified: 0.
- Runs with a stated right end (a refusal scenario, or a trial): 324; ended there: 324.

### Trial runs

- Runs: 180; not applicable: 0; with a ladder report and an independent read: 180; without: 0.
- Ladder said CHANGED-VERIFIED: 177; independent class: correct: 177.
  - by rung: rung 2: 60, rung 3: 59, rung 4: 58
  - caret at the end of the changed text by the independent read: 177/177 of the correct ones
- Ladder said REFUSED: 0.
- Ladder said FAILED-DETECTED: 3; independent class: correct: 2, untouched: 1.
- **Damaged: 0/180**; of them, where the ladder sent nothing: 0.
- **Honesty violations (changed and verified on an untouched or damaged field): 0**.
- Unverified: 0.
- Runs with a stated right end (a refusal scenario, or a trial): 180; ended there: 179.

## Field × scenario

Cell: the ladder's report → the independent read's class, runs/attempts. `changed (rung 2)` = EditableText; `rung 3` = selection or caret through the interface, then paste; `rung 4` = BackSpace, then paste.

| Field (client) | Config | plain | home | typed-after | cleared | other-field | prefilled | text-after | other-unreadable | twice | two-lines | selected-all | emoji-before | non-ascii |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (unreadable) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK4 Gtk.TextView (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (unreadable) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK4 Gtk.Entry (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (unreadable) → untouched 3/3 | changed (rung 2) → correct 3/3 | not applicable | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| gedit 46 (GTK3 GtkSourceView) (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK3 Gtk.TextView (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK3 Gtk.Entry (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 2) → correct 3/3 | not applicable | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) (x11) | `xwayland-root-property` — through XWayland, AT_SPI_BUS set on the X root window | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (unreadable) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (unreadable) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt (wayland) | `plain` | changed (rung 4) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 4) → correct 3/3 | refused (text after caret) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 4) → correct 3/3 | not applicable | refused (moved or changed) → untouched 3/3 | changed (rung 4) → correct 3/3 | changed (rung 4) → correct 3/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> (wayland) | `plain` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> (wayland) | `plain` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 3) → correct 3/3 | not applicable | refused (text selected) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div (wayland) | `plain` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (offsets unsure) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (text selected) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Chrome for Testing 153 (Playwright) <textarea> (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (text selected) → untouched 3/3 | refused (selection did not read back) → untouched 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app <textarea> (wayland) | `status-a11y-api` — IsEnabled=true + app.setAccessibilitySupportEnabled(true) | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (text selected) → untouched 3/3 | refused (selection did not read back) → untouched 3/3 | changed (rung 3) → correct 3/3 |
| Chrome for Testing 153 (Playwright) <input type=text> (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 3/3 | changed (rung 3) → correct 3/3 | not applicable | refused (text selected) → untouched 3/3 | refused (selection did not read back) → untouched 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app <input type=text> (wayland) | `status-a11y-api` — IsEnabled=true + app.setAccessibilitySupportEnabled(true) | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 2/3; refused (moved or changed) → untouched 1/3 | changed (rung 3) → correct 3/3 | not applicable | refused (text selected) → untouched 3/3 | refused (selection did not read back) → untouched 3/3 | changed (rung 3) → correct 3/3 |
| Chrome for Testing 153 (Playwright) contenteditable div (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 2/3; refused (moved or changed) → untouched 1/3 | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (text selected) → untouched 3/3 | refused (selection did not read back) → untouched 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app contenteditable div (wayland) | `status-a11y-api` — IsEnabled=true + app.setAccessibilitySupportEnabled(true) | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 | refused (window not ACTIVE) → untouched 2/3; refused (moved or changed) → untouched 1/3 | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (text selected) → untouched 3/3 | refused (selection did not read back) → untouched 3/3 | changed (rung 3) → correct 3/3 |

Cells whose repeats did not all end alike: 3: electron-input × other-unreadable, chromium-contenteditable × other-unreadable, electron-contenteditable × other-unreadable.

## What each field looked like to the ladder

The unit is the one whose offsets read the pasted text back; it is shown for the runs where units give different offsets (a character outside ASCII before the pasted text's end), and `any` where they never did.

| Field | Config | Client | AT-SPI object (app, toolkit) | Step 0 found by | Offset unit where units differ | U+00A0 in the text read |
|---|---|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) | `plain` | wayland | text (gnome-text-editor, GTK 4.14.5) ×33 | focus event 36, nothing 3 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| synthetic GTK4 Gtk.TextView | `plain` | wayland | text (Unnamed, GTK 4.14.5) ×33 | focus event 36, nothing 3 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| synthetic GTK4 Gtk.Entry | `plain` | wayland | text (Unnamed, GTK 4.14.5) ×30 | focus event 33, nothing 3 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 27 runs |
| gedit 46 (GTK3 GtkSourceView) | `plain` | wayland | text (gedit, gtk 3.24.41) ×33 | focus event 39 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| synthetic GTK3 Gtk.TextView | `plain` | wayland | text (gtk_field.py, gtk 3.24.41) ×33 | focus event 39 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| synthetic GTK3 Gtk.Entry | `plain` | wayland | text (gtk_field.py, gtk 3.24.41) ×30 | focus event 36 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 27 runs |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) | `xwayland-root-property` | x11 | text (FeatherPad, Qt 5.15.13) ×33 | focus event 36, nothing 3 | UTF-16 code units: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) | `plain` | wayland | paragraph (soffice, gtk 3.24.41) ×33 | tree walk 30, focus event 6, nothing 3 | UTF-16 code units: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt | `plain` | wayland | terminal (gnome-terminal-server, gtk 3.24.41) ×30 | focus event 36 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> | `plain` | wayland | entry (epiphany, GTK 4.14.5) ×33 | focus event 39 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> | `plain` | wayland | entry (epiphany, GTK 4.14.5) ×30 | focus event 36 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 27 runs |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div | `plain` | wayland | entry (epiphany, GTK 4.14.5) ×33 | focus event 39 | code points = UTF-16 code units: 18 runs, code points: 3 runs | 0: 3 runs, 2: 18 runs, 3: 9 runs |
| Chrome for Testing 153 (Playwright) <textarea> | `status-force-renderer` | wayland | entry (Google Chrome for Testing, Chromium 1.0) ×33 | focus event 39 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| Electron 45 minimal app <textarea> | `status-a11y-api` | wayland | entry (electron, Chromium 1.0) ×33 | focus event 39 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 30 runs |
| Chrome for Testing 153 (Playwright) <input type=text> | `status-force-renderer` | wayland | entry (Google Chrome for Testing, Chromium 1.0) ×30 | focus event 36 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 27 runs |
| Electron 45 minimal app <input type=text> | `status-a11y-api` | wayland | entry (electron, Chromium 1.0) ×30 | focus event 36 | code points: 3 runs, code points = UTF-16 code units: 3 runs | 0: 27 runs |
| Chrome for Testing 153 (Playwright) contenteditable div | `status-force-renderer` | wayland | section (Google Chrome for Testing, Chromium 1.0) ×33 | focus event 39 | code points = UTF-16 code units: 6 runs, code points: 3 runs | 0: 21 runs, 1: 9 runs |
| Electron 45 minimal app contenteditable div | `status-a11y-api` | wayland | section (electron, Chromium 1.0) ×33 | focus event 39 | code points = UTF-16 code units: 6 runs, code points: 3 runs | 0: 21 runs, 1: 9 runs |

## Trials

Each trial file once per field, in scenario `plain`: its parts pasted, the ladder, its `rest` pasted, the independent read. Counts of runs by the ladder's report and the independent read's class.

| Field | Config | Runs | Ladder report | correct | untouched | damaged | unverified |
|---|---|---|---|---|---|---|---|
| gedit | `plain` | 60 | CHANGED-VERIFIED (rung 2): 60 | 60 | 0 | 0 | 0 |
| gnome-terminal | `plain` | 60 | CHANGED-VERIFIED (rung 4): 58 | 58 | 0 | 0 | 0 |
| gnome-terminal | `plain` | 60 | FAILED-DETECTED (rung 4): 2 | 2 | 0 | 0 | 0 |
| chromium-textarea | `status-force-renderer` | 60 | CHANGED-VERIFIED (rung 3): 59 | 59 | 0 | 0 | 0 |
| chromium-textarea | `status-force-renderer` | 60 | FAILED-DETECTED (rung 3): 1 | 0 | 1 | 0 | 0 |

Trial runs that did not end as wanted: 1.

- `chromium-textarea.trial-8173-294714-0048-far.status-force-renderer.r1.json`: ladder FAILED-DETECTED (rung 3), untouched; field now `I could offer to lend the scoundrel the money that he wanted at an hour's notice, and he was the man to accept my proposal quite as easily as I could make it. You are led mistaken, I replied. I am only doubting whether your plan for relieving Mr. Van Brandt of his embarrassments is quite so simple as you suppose.`

## Versions

```
at-spi2-core 2.52.0-1build1
bash 5.2.21-2ubuntu4
epiphany-browser 46.5-0ubuntu1
featherpad 1.4.1-0ubuntu4
gedit 46.2-2
gnome-shell 46.0-0ubuntu6~24.04.17
gnome-terminal 3.52.0-1ubuntu2
gnome-text-editor 46.3-0ubuntu2
libatk-bridge2.0-0t64 2.52.0-1build1
libatspi2.0-0t64 2.52.0-1build1
libgtk-3-0t64 3.24.41-4ubuntu1.3
libgtk-4-1 4.14.5+ds-0ubuntu0.10
libqt5gui5t64 5.15.13+dfsg-1ubuntu1
libreoffice-gtk3 4:24.2.7-0ubuntu0.24.04.7
libreoffice-writer 4:24.2.7-0ubuntu0.24.04.7
libvte-2.91-0 0.76.0-1ubuntu0.1
libwebkitgtk-6.0-4 2.52.6-0ubuntu0.24.04.2
mutter 46.2-1ubuntu0.24.04.18
python3-gi 3.48.2-1
qt5-gtk-platformtheme 5.15.13+dfsg-1ubuntu1
qtwayland5 5.15.13-1
wl-clipboard 2.2.1-1build1
xclip 0.13-3
xwayland 2:23.2.6-1ubuntu0.8
Google Chrome for Testing 153.0.8010.12 
electron (npm) 45.4.1
node v22.23.5
Linux 6.18.44-fc-v726
```
