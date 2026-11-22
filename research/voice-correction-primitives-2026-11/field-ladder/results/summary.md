# Field ladder on GNOME Wayland: results

- Session: wayland: gnome-shell --headless --virtual-monitor, keys through Mutter's RemoteDesktop API; GNOME Shell 46.0, headless with one 1280x800 virtual monitor, its own D-Bus session, a throwaway HOME and a short XDG_RUNTIME_DIR; one fresh session per run.
- Keys and clicks: Mutter's RemoteDesktop D-Bus API (NotifyKeyboardKeycode, NotifyPointerMotionRelative, NotifyPointerButton), as VOCO's CI sends them.
- Copy: xclip through XWayland, PRIMARY then CLIPBOARD, then Shift+Insert (VOCO's order on GNOME Wayland). wl-copy was not used.
- AT-SPI client: libatspi through python3-gi on Python 3.12; it connects and registers its focus listener before the app starts.
- In the fresh session: `toolkit-accessibility` = `false`, org.a11y.Bus running once the Shell is up: True, org.a11y.Status then: `{'IsEnabled': False, 'ScreenReaderEnabled': False}`. Only configs named `status`/`screen-reader` change it.
- Text: `Let's meet at the` + ` peer on Thursday` + ` afternoon.` pasted as three chunks; the ladder is asked to make `peer` into `pier`.
- Result files: 731.

## Headline counts

### The brief's seven scenarios, each field under the config its row names

- Runs: 462; with a ladder result and an independent read: 462; without: 0.
- Ladder said CHANGED-VERIFIED: 186; the independent read agrees (correct text): **186/186**; caret at the end of the corrected text by the independent read: 186/186.
  - by rung: rung 2: 72, rung 3: 108, rung 4: 6
- Ladder REFUSED: 276; the independent read shows the field untouched: 276/276.
  - reasons: moved or changed: 255, unreadable: 18, text after caret: 3
- Ladder FAILED-DETECTED: 0.
- **DAMAGED runs: 0/462**; DAMAGED and reported CHANGED-VERIFIED: **0**.
- UNVERIFIED (the independent read gave nothing): 0.
- Runs whose setup left other text than intended (the ladder refused, the field kept what it had): 0.
- Runs where the ladder's outcome and the independent class disagree: 0.

### Extra hazard `other-unreadable` (not in the brief): focus moved to a window AT-SPI does not expose

- Runs: 54; with a ladder result and an independent read: 54; without: 0.
- Ladder said CHANGED-VERIFIED: 9; the independent read agrees (correct text): **9/9**; caret at the end of the corrected text by the independent read: 9/9.
  - by rung: rung 2: 9
- Ladder REFUSED: 16; the independent read shows the field untouched: 16/16.
  - reasons: unreadable: 15, moved or changed: 1
- Ladder FAILED-DETECTED: 29; independent class: DAMAGED: 29.
- **DAMAGED runs: 29/54**; DAMAGED and reported CHANGED-VERIFIED: **0**.
  - `chromium-contenteditable.other-unreadable.status-force-renderer.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-contenteditable.other-unreadable.status-force-renderer.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-contenteditable.other-unreadable.status-force-renderer.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-input.other-unreadable.status-force-renderer.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-input.other-unreadable.status-force-renderer.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-input.other-unreadable.status-force-renderer.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-textarea.other-unreadable.status-force-renderer.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-textarea.other-unreadable.status-force-renderer.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `chromium-textarea.other-unreadable.status-force-renderer.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-contenteditable.other-unreadable.status-a11y-api.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-contenteditable.other-unreadable.status-a11y-api.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-contenteditable.other-unreadable.status-a11y-api.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-input.other-unreadable.status-a11y-api.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-input.other-unreadable.status-a11y-api.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-textarea.other-unreadable.status-a11y-api.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-textarea.other-unreadable.status-a11y-api.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `electron-textarea.other-unreadable.status-a11y-api.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-contenteditable.other-unreadable.plain.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-contenteditable.other-unreadable.plain.r2.json`: ladder FAILED-DETECTED (rung 4); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier on Thursday afternoon.`
  - `epiphany-contenteditable.other-unreadable.plain.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-input.other-unreadable.plain.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-input.other-unreadable.plain.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-input.other-unreadable.plain.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-textarea.other-unreadable.plain.r1.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-textarea.other-unreadable.plain.r2.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `epiphany-textarea.other-unreadable.plain.r3.json`: ladder FAILED-DETECTED (rung 3); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier`
  - `gnome-terminal.other-unreadable.plain.r1.json`: ladder FAILED-DETECTED (rung 4); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier on Thursday afternoon.`
  - `gnome-terminal.other-unreadable.plain.r2.json`: ladder FAILED-DETECTED (rung 4); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier on Thursday afternoon.`
  - `gnome-terminal.other-unreadable.plain.r3.json`: ladder FAILED-DETECTED (rung 4); field now `Let's meet at the peer on Thursday afternoon.`; other field now `pier on Thursday afternoon.`
- UNVERIFIED (the independent read gave nothing): 0.
- Runs whose setup left other text than intended (the ladder refused, the field kept what it had): 0.
- Runs where the ladder's outcome and the independent class disagree: 0.

### Variant with a guard (not the ladder as specified): refuse unless the field's window is ACTIVE; scenarios plain, other-field, other-unreadable

- Runs: 162; with a ladder result and an independent read: 162; without: 0.
- Ladder said CHANGED-VERIFIED: 54; the independent read agrees (correct text): **54/54**; caret at the end of the corrected text by the independent read: 54/54.
  - by rung: rung 2: 24, rung 3: 27, rung 4: 3
- Ladder REFUSED: 108; the independent read shows the field untouched: 108/108.
  - reasons: moved or changed: 59, window not ACTIVE: 34, unreadable: 15
- Ladder FAILED-DETECTED: 0.
- **DAMAGED runs: 0/162**; DAMAGED and reported CHANGED-VERIFIED: **0**.
- UNVERIFIED (the independent read gave nothing): 0.
- Runs whose setup left other text than intended (the ladder refused, the field kept what it had): 0.
- Runs where the ladder's outcome and the independent class disagree: 0.

## Field × scenario

Cell: the ladder's outcome → the independent read's class, runs/attempts. `changed (rung 2)` = EditableText; `rung 3` = AT-SPI selection + paste; `rung 4` = BackSpace + paste. "correct" = the field holds the corrected text; "untouched" = it holds what the setup left.

| Field (client) | Config | plain | home | typed-after | cleared | other-field | prefilled | text-after |
|---|---|---|---|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK4 Gtk.TextView (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK4 Gtk.Entry (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| gedit 46 (GTK3 GtkSourceView) (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK3 Gtk.TextView (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| synthetic GTK3 Gtk.Entry (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) (wayland) | `plain` — native Wayland client | refused (unreadable) → untouched 3/3 | refused (unreadable) → untouched 3/3 | refused (unreadable) → untouched 3/3 | refused (unreadable) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (unreadable) → untouched 3/3 | refused (unreadable) → untouched 3/3 |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) (x11) | `xwayland-root-property` — through XWayland, AT_SPI_BUS set on the X root window | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) (wayland) | `plain` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 2) → correct 3/3 | changed (rung 2) → correct 3/3 |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt (wayland) | `plain` | changed (rung 4) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 4) → correct 3/3 | refused (text after caret) → untouched 3/3 |
| Chrome for Testing 153 (Playwright) <textarea> (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Chrome for Testing 153 (Playwright) <input type=text> (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Chrome for Testing 153 (Playwright) contenteditable div (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> (wayland) | `plain` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> (wayland) | `plain` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div (wayland) | `plain` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app <textarea> (wayland) | `status-a11y-api` — IsEnabled=true + app.setAccessibilitySupportEnabled(true) | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app <input type=text> (wayland) | `status-a11y-api` — IsEnabled=true + app.setAccessibilitySupportEnabled(true) | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app contenteditable div (wayland) | `status-a11y-api` — IsEnabled=true + app.setAccessibilitySupportEnabled(true) | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app <textarea> (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility, no API call | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app <input type=text> (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility, no API call | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |
| Electron 45 minimal app contenteditable div (wayland) | `status-force-renderer` — IsEnabled=true + --force-renderer-accessibility, no API call | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 3/3 | changed (rung 3) → correct 3/3 | changed (rung 3) → correct 3/3 |

## Extra hazard: focus moved to a window AT-SPI does not expose

Not in the brief's list. After the pastes a FeatherPad window (native Wayland client, which exposed nothing here) takes keyboard focus; its text area is empty. "Old field still FOCUSED" = the ladder's step 0 accepted the field the text was pasted into; "its window ACTIVE" is recorded, and the ladder as specified does not look at it.

| Field | Config | Ladder → independent class | Step 0 found | Old field's window ACTIVE | Other window's text after | Runs where the other window was exposed after all |
|---|---|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) | `plain` | refused (unreadable) → untouched 3/3 | nothing 3 | - 3 | '' ×3 | 0/3 |
| synthetic GTK4 Gtk.TextView | `plain` | refused (unreadable) → untouched 3/3 | nothing 3 | - 3 | '' ×3 | 0/3 |
| synthetic GTK4 Gtk.Entry | `plain` | refused (unreadable) → untouched 3/3 | nothing 3 | - 3 | '' ×3 | 0/3 |
| gedit 46 (GTK3 GtkSourceView) | `plain` | changed (rung 2) → correct 3/3 | focus event 3 | False 3 | '' ×3 | 0/3 |
| synthetic GTK3 Gtk.TextView | `plain` | changed (rung 2) → correct 3/3 | focus event 3 | False 3 | '' ×3 | 0/3 |
| synthetic GTK3 Gtk.Entry | `plain` | changed (rung 2) → correct 3/3 | focus event 3 | False 3 | '' ×3 | 0/3 |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) | `xwayland-root-property` | refused (unreadable) → untouched 3/3 | nothing 3 | - 3 | '' ×3 | 0/3 |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) | `plain` | refused (unreadable) → untouched 3/3 | nothing 3 | - 3 | '' ×3 | 0/3 |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt | `plain` | FAILED-DETECTED (rung 4) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier on Thursday afternoon.' ×3 | 0/3 |
| Chrome for Testing 153 (Playwright) <textarea> | `status-force-renderer` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |
| Chrome for Testing 153 (Playwright) <input type=text> | `status-force-renderer` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |
| Chrome for Testing 153 (Playwright) contenteditable div | `status-force-renderer` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> | `plain` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> | `plain` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div | `plain` | FAILED-DETECTED (rung 3) → DAMAGED 2/3; FAILED-DETECTED (rung 4) → DAMAGED 1/3 | focus event 3 | False 3 | 'pier' ×2, 'pier on Thursday afternoon.' ×1 | 0/3 |
| Electron 45 minimal app <textarea> | `status-a11y-api` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |
| Electron 45 minimal app <input type=text> | `status-a11y-api` | FAILED-DETECTED (rung 3) → DAMAGED 2/3; refused (moved or changed) → untouched 1/3 | focus event 3 | False 2, True 1 | 'pier' ×2, '' ×1 | 1/3 |
| Electron 45 minimal app contenteditable div | `status-a11y-api` | FAILED-DETECTED (rung 3) → DAMAGED 3/3 | focus event 3 | False 3 | 'pier' ×3 | 0/3 |

In the runs of the last column FeatherPad did appear on the AT-SPI desktop as a Qt app (see the notes), so step 0 found its empty text area and the ladder refused as in `other-field`.

## Variant with a guard: refuse unless the field's top-level window is ACTIVE

Not the ladder as specified. After step 0 the variant climbs from the field to its top-level accessible and refuses when that has no STATE_ACTIVE. Everything else is the same code.

| Field | Config | plain | other-field | other-unreadable |
|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (unreadable) → untouched 3/3 (other window exposed after all in 0) |
| synthetic GTK4 Gtk.TextView | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (unreadable) → untouched 3/3 (other window exposed after all in 0) |
| synthetic GTK4 Gtk.Entry | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (unreadable) → untouched 3/3 (other window exposed after all in 0) |
| gedit 46 (GTK3 GtkSourceView) | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| synthetic GTK3 Gtk.TextView | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| synthetic GTK3 Gtk.Entry | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) | `xwayland-root-property+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (unreadable) → untouched 3/3 (other window exposed after all in 0) |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) | `plain+guard` | changed (rung 2) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (unreadable) → untouched 3/3 (other window exposed after all in 0) |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt | `plain+guard` | changed (rung 4) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| Chrome for Testing 153 (Playwright) <textarea> | `status-force-renderer+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 2/3; refused (moved or changed) → untouched 1/3 (other window exposed after all in 1) |
| Chrome for Testing 153 (Playwright) <input type=text> | `status-force-renderer+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| Chrome for Testing 153 (Playwright) contenteditable div | `status-force-renderer+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (moved or changed) → untouched 2/3; refused (window not ACTIVE) → untouched 1/3 (other window exposed after all in 2) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> | `plain+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> | `plain+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div | `plain+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |
| Electron 45 minimal app <textarea> | `status-a11y-api+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 2/3; refused (moved or changed) → untouched 1/3 (other window exposed after all in 1) |
| Electron 45 minimal app <input type=text> | `status-a11y-api+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 2/3; refused (moved or changed) → untouched 1/3 (other window exposed after all in 1) |
| Electron 45 minimal app contenteditable div | `status-a11y-api+guard` | changed (rung 3) → correct 3/3 | refused (moved or changed) → untouched 3/3 | refused (window not ACTIVE) → untouched 3/3 (other window exposed after all in 0) |

## What each field looked like to the ladder (the brief's scenarios)

| Field | Config | Client | AT-SPI object (app, toolkit) | Step 0 found by | Own window ACTIVE (scenarios without a second window) | U+00A0 in the text read | Ladder time, changed runs (median ms) |
|---|---|---|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) | `plain` | wayland | text (gnome-text-editor, GTK 4.14.5) ×18 | focus event 21 | True 18 | 0: 9 runs | 246 (n=9) |
| synthetic GTK4 Gtk.TextView | `plain` | wayland | text (Unnamed, GTK 4.14.5) ×18 | focus event 21 | True 18 | 0: 9 runs | 237 (n=9) |
| synthetic GTK4 Gtk.Entry | `plain` | wayland | text (Unnamed, GTK 4.14.5) ×18 | focus event 21 | True 18 | 0: 9 runs | 236 (n=9) |
| gedit 46 (GTK3 GtkSourceView) | `plain` | wayland | text (gedit, gtk 3.24.41) ×18 | focus event 21 | True 18 | 0: 9 runs | 242 (n=9) |
| synthetic GTK3 Gtk.TextView | `plain` | wayland | text (gtk_field.py, gtk 3.24.41) ×18 | focus event 21 | True 18 | 0: 9 runs | 231 (n=9) |
| synthetic GTK3 Gtk.Entry | `plain` | wayland | text (gtk_field.py, gtk 3.24.41) ×18 | focus event 21 | True 18 | 0: 9 runs | 235 (n=9) |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) | `plain` | wayland | none | nothing 18, focus event 3 | - | - | - |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) | `xwayland-root-property` | x11 | text (FeatherPad, Qt 5.15.13) ×18 | focus event 21 | True 18 | 0: 9 runs | 237 (n=9) |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) | `plain` | wayland | paragraph (soffice, gtk 3.24.41) ×18 | tree walk 18, focus event 3 | True 18 | 0: 9 runs | 519 (n=9) |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt | `plain` | wayland | terminal (gnome-terminal-server, gtk 3.24.41) ×18 | focus event 21 | True 18 | 0: 9 runs | 1334 (n=6) |
| Chrome for Testing 153 (Playwright) <textarea> | `status-force-renderer` | wayland | entry (Google Chrome for Testing, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 9 runs | 865 (n=9) |
| Chrome for Testing 153 (Playwright) <input type=text> | `status-force-renderer` | wayland | entry (Google Chrome for Testing, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 9 runs | 862 (n=9) |
| Chrome for Testing 153 (Playwright) contenteditable div | `status-force-renderer` | wayland | section (Google Chrome for Testing, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 3 runs, 1: 6 runs | 865 (n=9) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> | `plain` | wayland | entry (epiphany, GTK 4.14.5) ×18 | focus event 21 | True 18 | 0: 9 runs | 883 (n=9) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> | `plain` | wayland | entry (epiphany, GTK 4.14.5) ×18 | focus event 21 | True 18 | 0: 9 runs | 916 (n=9) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div | `plain` | wayland | entry (epiphany, GTK 4.14.5) ×18 | focus event 21 | True 18 | 2: 3 runs, 3: 6 runs | 884 (n=9) |
| Electron 45 minimal app <textarea> | `status-a11y-api` | wayland | entry (electron, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 9 runs | 873 (n=9) |
| Electron 45 minimal app <input type=text> | `status-a11y-api` | wayland | entry (electron, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 9 runs | 863 (n=9) |
| Electron 45 minimal app contenteditable div | `status-a11y-api` | wayland | section (electron, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 3 runs, 1: 6 runs | 858 (n=9) |
| Electron 45 minimal app <textarea> | `status-force-renderer` | wayland | entry (electron, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 9 runs | 860 (n=9) |
| Electron 45 minimal app <input type=text> | `status-force-renderer` | wayland | entry (electron, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 9 runs | 874 (n=9) |
| Electron 45 minimal app contenteditable div | `status-force-renderer` | wayland | section (electron, Chromium 1.0) ×18 | focus event 21 | True 18 | 0: 3 runs, 1: 6 runs | 870 (n=9) |

## What each app needed in order to be exposed

The `plain` scenario under each launch config tried. "Exposed" = the ladder's step 0 found a focused editable or terminal object with Text. Rows marked main are the configs of the table above (all their `plain` runs).

| Field | Config | What the config adds | Client | Apps on the AT-SPI desktop besides the Shell | Exposed | Ladder → independent class |
|---|---|---|---|---|---|---|
| chromium-contenteditable | `status-force-renderer` (main) | org.a11y.Status IsEnabled=true before launch; --force-renderer-accessibility | wayland | Google Chrome for Testing [Chromium, 3 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| chromium-input | `status-force-renderer` (main) | org.a11y.Status IsEnabled=true before launch; --force-renderer-accessibility | wayland | Google Chrome for Testing [Chromium, 3 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| chromium-textarea | `status-force-renderer` (main) | org.a11y.Status IsEnabled=true before launch; --force-renderer-accessibility | wayland | Google Chrome for Testing [Chromium, 3 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| chromium-textarea | `force-renderer` | --force-renderer-accessibility | wayland | none ×3 | 0/3 | refused (unreadable) → untouched 3/3 |
| chromium-textarea | `plain` | nothing | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| chromium-textarea | `screen-reader` | ScreenReaderEnabled=true before launch | wayland | Google Chrome for Testing [Chromium, 3 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| chromium-textarea | `status` | org.a11y.Status IsEnabled=true before launch | wayland | Google Chrome for Testing [Chromium, 3 window(s)] ×3 | 0/3 | refused (unreadable) → untouched 3/3 |
| chromium-textarea | `status-screen-reader` | org.a11y.Status IsEnabled=true before launch; ScreenReaderEnabled=true before launch | wayland | Google Chrome for Testing [Chromium, 3 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| electron-contenteditable | `status-a11y-api` (main) | org.a11y.Status IsEnabled=true before launch; app.setAccessibilitySupportEnabled(true) | wayland | electron [Chromium, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| electron-contenteditable | `status-force-renderer` (main) | org.a11y.Status IsEnabled=true before launch; --force-renderer-accessibility | wayland | electron [Chromium, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| electron-input | `status-a11y-api` (main) | org.a11y.Status IsEnabled=true before launch; app.setAccessibilitySupportEnabled(true) | wayland | electron [Chromium, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| electron-input | `status-force-renderer` (main) | org.a11y.Status IsEnabled=true before launch; --force-renderer-accessibility | wayland | electron [Chromium, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| electron-textarea | `status-a11y-api` (main) | org.a11y.Status IsEnabled=true before launch; app.setAccessibilitySupportEnabled(true) | wayland | electron [Chromium, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| electron-textarea | `status-force-renderer` (main) | org.a11y.Status IsEnabled=true before launch; --force-renderer-accessibility | wayland | electron [Chromium, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| electron-textarea | `a11y-api` | app.setAccessibilitySupportEnabled(true) | wayland | none ×3 | 0/3 | refused (unreadable) → untouched 3/3 |
| electron-textarea | `force-renderer` | --force-renderer-accessibility | wayland | none ×3 | 0/3 | refused (unreadable) → untouched 3/3 |
| electron-textarea | `force-renderer-a11y-api` | --force-renderer-accessibility; app.setAccessibilitySupportEnabled(true) | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| electron-textarea | `plain` | nothing | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| electron-textarea | `screen-reader` | ScreenReaderEnabled=true before launch | wayland | electron [Chromium, 1 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| electron-textarea | `screen-reader-a11y-api` | ScreenReaderEnabled=true before launch; app.setAccessibilitySupportEnabled(true) | wayland | electron [Chromium, 1 window(s)] ×1 | 1/1 | changed (rung 3) → correct 1/1 |
| electron-textarea | `status` | org.a11y.Status IsEnabled=true before launch | wayland | electron [Chromium, 1 window(s)] ×3 | 0/3 | refused (unreadable) → untouched 3/3 |
| electron-textarea | `status-screen-reader` | org.a11y.Status IsEnabled=true before launch; ScreenReaderEnabled=true before launch | wayland | electron [Chromium, 1 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| epiphany-contenteditable | `plain` (main) | nothing | wayland | epiphany [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| epiphany-input | `plain` (main) | nothing | wayland | epiphany [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| epiphany-textarea | `plain` (main) | nothing | wayland | epiphany [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 3) → correct 3/3 |
| featherpad | `plain` (main) | nothing | wayland | featherpad [gtk, 0 window(s)] ×3 | 0/3 | refused (unreadable) → untouched 3/3 |
| featherpad | `xwayland-root-property` (main) | run through XWayland; AT_SPI_BUS property set on the X root window | x11 | FeatherPad [Qt, 1 window(s)], featherpad [gtk, 0 window(s)], mutter-x11-frames [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| featherpad | `a11y-address-env` | AT_SPI_BUS_ADDRESS in the app's environment | wayland | featherpad [gtk, 0 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `qt-accessibility` | QT_ACCESSIBILITY=1 | wayland | featherpad [gtk, 0 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `qt-always-on` | QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 | wayland | featherpad [gtk, 0 window(s)] ×5 | 0/5 | refused (unreadable) → untouched 5/5 |
| featherpad | `qt-no-desktop-env` | XDG_CURRENT_DESKTOP='' | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `qt-no-desktop-env-always-on` | XDG_CURRENT_DESKTOP=''; QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `qt-no-desktop-env-screen-reader` | ScreenReaderEnabled=true before launch; XDG_CURRENT_DESKTOP='' | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `qt-no-desktop-env-status` | org.a11y.Status IsEnabled=true before launch; XDG_CURRENT_DESKTOP='' | wayland | none ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `root-property` | AT_SPI_BUS property set on the X root window | wayland | featherpad [gtk, 0 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `screen-reader` | ScreenReaderEnabled=true before launch | wayland | featherpad [gtk, 0 window(s)] ×4; FeatherPad [Qt, 1 window(s)], featherpad [gtk, 0 window(s)] ×1 | 1/5 | refused (unreadable) → untouched 4/5; changed (rung 2) → correct 1/5 |
| featherpad | `status` | org.a11y.Status IsEnabled=true before launch | wayland | featherpad [gtk, 0 window(s)] ×8; FeatherPad [Qt, 1 window(s)], featherpad [gtk, 0 window(s)] ×2 | 2/10 | refused (unreadable) → untouched 8/10; changed (rung 2) → correct 2/10 |
| featherpad | `xwayland` | run through XWayland | x11 | featherpad [gtk, 0 window(s)], mutter-x11-frames [GTK, 1 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `xwayland-qt-no-desktop-env` | XDG_CURRENT_DESKTOP=''; run through XWayland | x11 | mutter-x11-frames [GTK, 1 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| featherpad | `xwayland-qt-no-desktop-env-always-on` | XDG_CURRENT_DESKTOP=''; QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1; run through XWayland | x11 | mutter-x11-frames [GTK, 1 window(s)] ×1 | 0/1 | refused (unreadable) → untouched 1/1 |
| gedit | `plain` (main) | nothing | wayland | gedit [gtk, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| gnome-terminal | `plain` (main) | nothing | wayland | gnome-terminal [gtk, 0 window(s)], gnome-terminal-server [gtk, 1 window(s)] ×3 | 3/3 | changed (rung 4) → correct 3/3 |
| gnome-text-editor | `plain` (main) | nothing | wayland | gnome-text-editor [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| gtk3-entry | `plain` (main) | nothing | wayland | gtk_field.py [gtk, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| gtk3-textview | `plain` (main) | nothing | wayland | gtk_field.py [gtk, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| gtk4-entry | `plain` (main) | nothing | wayland | Unnamed [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| gtk4-textview | `plain` (main) | nothing | wayland | Unnamed [GTK, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |
| libreoffice-writer | `plain` (main) | nothing | wayland | soffice [gtk, 1 window(s)] ×3 | 3/3 | changed (rung 2) → correct 3/3 |

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
