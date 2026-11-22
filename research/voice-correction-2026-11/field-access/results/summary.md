# Field access through AT-SPI2: results

- Session: x11 (Xvfb) + openbox, one fresh session per run; AT-SPI client: libatspi through python3-gi on Python 3.12.3; at-spi2-core 2.52.0-1build1.
- `gsettings get org.gnome.desktop.interface toolkit-accessibility` in the fresh session: `false`. It was never changed.
- `org.a11y.Status` once the client had connected: `{'IsEnabled': False, 'ScreenReaderEnabled': False}`. Connecting a client did not change it. Only the configs named `status`/`screen-reader` set it.
- Result files: 174 runs over 18 app/field cases. Runs with no app window or a harness error: 0.
- Text pasted in three chunks: `Let's meet at the peer on Thursday afternoon.`; wanted after the correction: `Let's meet at the pier on Thursday afternoon.`.

## Summary

One row per app/field, under the launch config its scenarios ran with. Columns 3 to 8 and the timings are the `atspi` scenario; "blind" is the `blind` scenario in a fresh field. "Worked" always means the independent read (no AT-SPI) agreed. Lookup ms: median of 5 tree walks, cold / warm (libatspi's cache cleared before each walk / kept), with the nodes visited. Replace ms: the EditableText calls only.

| App / field | Config | Focused object found | Text readable | Caret readable | Text matched, caret at end | EditableText replace worked | Caret restored to end | Blind 27 BackSpace + paste exact | Lookup ms cold / warm | Replace ms | What had to be enabled (from the probes) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gnome-text-editor 46 (GTK4 GtkSourceView) | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 18.9 / 12.7 (22 nodes) | 7.1 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| synthetic GTK4 Gtk.TextView | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 2.6 / 2.1 (2 nodes) | 1.3 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| synthetic GTK4 Gtk.Entry | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 3.4 / 2.3 (2 nodes) | 1.4 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| gedit 46 (GTK3 GtkSourceView) | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 16.8 / 14.3 (62 nodes) | 0.6 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| mousepad 0.6 (GTK3 GtkSourceView) | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 77.8 / 63.3 (318 nodes) | 1.2 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| synthetic GTK3 Gtk.TextView | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 1.9 / 1.9 (2 nodes) | 0.6 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| synthetic GTK3 Gtk.Entry | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, after set_caret_offset (was at 22) | yes | 2.0 / 1.9 (2 nodes) | 1.3 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| FeatherPad 1.4 (Qt 5.15 QPlainTextEdit) | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 6.3 / 7.1 (7 nodes) | 1.1 | nothing under `plain`; readable under `bus-late-client`, `bus-late-client-qt-always-on`, `bus-late-client-status`, `late-client-qt-always-on`, `plain`; NOT under `late-client` |
| LibreOffice Writer 24.2 (gtk3 VCL plugin) | `plain` | yes | yes | yes | yes | yes: delete_text+insert_text | yes, by itself | yes | 376.8 / 335.1 (1718 nodes) | 5.3 | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| gnome-terminal 3.52 (VTE 0.76, GTK3), bash prompt | `plain` | yes | yes | yes | yes: the screen text before the caret ends with it, nothing after the caret | NO: no EditableText interface (calls tried and failed) | - | yes | 12.4 / 10.4 (49 nodes) | - | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| xfce4-terminal 1.1 (VTE 0.76, GTK3), bash prompt | `plain` | yes | yes | yes | yes: the screen text before the caret ends with it, nothing after the caret | NO: no EditableText interface (calls tried and failed) | - | yes | 16.7 / 12.6 (50 nodes) | - | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| xterm 390 (Xaw), bash prompt | `plain` | NO | - | - | - | - | - | yes | - | - | never readable (3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| Chrome for Testing 153 (Playwright) <textarea> | `status-force-renderer` | yes | yes | yes | yes | NO: no EditableText interface (calls tried and failed) | - | yes | 49.8 / 40.3 (154 nodes) | - | readable only under `bus-late-client-status-force-renderer`, `status-force-renderer`; NOT under `accessibility-enabled-env`, `bus-late-client`, `bus-late-client-force-renderer`, `bus-late-client-status`, `force-renderer`, `gnome-accessibility-env`, `late-client`, `plain`, `screen-reader`, `status`, `status-accessibility-enabled-env`, `status-screen-reader-after-launch` |
| Chrome for Testing 153 (Playwright) <input type=text> | `status-force-renderer` | yes | yes | yes | yes | NO: no EditableText interface (calls tried and failed) | - | yes | 54.5 / 36.5 (155 nodes) | - | readable only under `status-force-renderer`; NOT under `plain` |
| Chrome for Testing 153 (Playwright) contenteditable div | `status-force-renderer` | yes | yes | yes | only with U+00A0 read as a space: 1 no-break space(s) where a chunk began or ended with a space; caret at end | NO: no EditableText interface (calls tried and failed) | - | yes | 51.2 / 43.3 (156 nodes) | - | readable only under `status-force-renderer`; NOT under `plain` |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <textarea> | `plain` | yes | yes | yes | yes | NO: no EditableText interface (calls tried and failed) | - | yes | 21.7 / 22.6 (25 nodes) | - | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) <input type=text> | `plain` | yes | yes | yes | yes | NO: no EditableText interface (calls tried and failed) | - | yes | 22.6 / 17.7 (26 nodes) | - | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |
| Epiphany 46 (WebKitGTK 2.52, GTK4) contenteditable div | `plain` | yes | yes | yes | only with U+00A0 read as a space: 2 no-break space(s) where a chunk began or ended with a space; caret at end | NO: no EditableText interface (calls tried and failed) | - | yes | 25.5 / 22.5 (27 nodes) | - | nothing (readable under all 3 configs tried: `bus-late-client`, `late-client`, `plain`) |

## Replace methods, each from a fresh field

`atspi` tries delete_text+insert_text and falls back to set_text_contents; `atspi_settext` uses set_text_contents only; `atspi_selpaste` selects the word with Text.add_selection/set_selection and then pastes the right word VOCO's way (xclip CLIPBOARD and PRIMARY, Shift+Insert). The independent read is Ctrl+A, Ctrl+C (bash's READLINE_LINE in terminals).

| Case | Config | atspi | atspi_settext | atspi_selpaste |
|---|---|---|---|---|
| gnome-text-editor | `plain` | delete_text+insert_text: ok, 7.08 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 10.41 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: FAILED (error: set_selection: empty message); independent read: "Let's meet at the peer on Thursday afternoon." |
| gtk4-textview | `plain` | delete_text+insert_text: ok, 1.27 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 0.68 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: FAILED (error: set_selection: empty message); independent read: "Let's meet at the peer on Thursday afternoon." |
| gtk4-entry | `plain` | delete_text+insert_text: ok, 1.36 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 0.74 ms, caret then at 0; independent read: final text; caret at end after set_caret_offset (independent: yes) | Text.set_selection+paste: ok, 100.62 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| gedit | `plain` | delete_text+insert_text: ok, 0.56 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 0.29 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: ok, 80.74 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| mousepad | `plain` | delete_text+insert_text: ok, 1.16 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 0.34 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: ok, 81.8 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| gtk3-textview | `plain` | delete_text+insert_text: ok, 0.57 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 0.43 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: ok, 82.23 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| gtk3-entry | `plain` | delete_text+insert_text: ok, 1.26 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) | set_text_contents: ok, 0.82 ms, caret then at 0; independent read: final text; caret at end after set_caret_offset (independent: yes) | Text.set_selection+paste: ok, 81.99 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| featherpad | `plain` | delete_text+insert_text: ok, 1.08 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 0.43 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: ok, 82.35 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| libreoffice-writer | `plain` | delete_text+insert_text: ok, 5.26 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | set_text_contents: ok, 2.65 ms, caret then at 45; independent read: final text; caret at end by itself (independent: yes) | Text.set_selection+paste: ok, 81.17 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| gnome-terminal | `plain` | delete_text+insert_text: FAILED (returned False/False; text then "$ Let's meet at the peer on Thursday afternoon.\n\n\n\n\n\n\n\n\n\n\n…'); set_text_contents: FAILED (returned False; text then "$ Let's meet at the peer on Thursday afternoon.\n\n\n\n\n\n\n\n\n\n\n…'); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (returned False; text then "$ Let's meet at the peer on Thursday afternoon.\n\n\n\n\n\n\n\n\n\n\n…'); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: FAILED (returned True; text then "$ Let's meet at the peer on Thursday afternoon.peer\n\n\n\n\n\n\n\n\n…'); independent read: "Let's meet at the peer on Thursday afternoon.peer" |
| xfce4-terminal | `plain` | delete_text+insert_text: FAILED (returned False/False; text then "$ Let's meet at the peer on Thursday afternoon.\n\n\n\n\n\n\n\n\n\n\n…'); set_text_contents: FAILED (returned False; text then "$ Let's meet at the peer on Thursday afternoon.\n\n\n\n\n\n\n\n\n\n\n…'); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (returned False; text then "$ Let's meet at the peer on Thursday afternoon.\n\n\n\n\n\n\n\n\n\n\n…'); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: FAILED (returned True; text then "$ Let's meet at the peer on Thursday afternoon.peer\n\n\n\n\n\n\n\n\n…'); independent read: "Let's meet at the peer on Thursday afternoon.peer" |
| xterm | `plain` | no field found | no field found | no field found |
| chromium-textarea | `status-force-renderer` | delete_text+insert_text: FAILED (returned False/False; text then "Let's meet at the peer on Thursday afternoon."); set_text_contents: FAILED (returned False; text then "Let's meet at the peer on Thursday afternoon."); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (returned False; text then "Let's meet at the peer on Thursday afternoon."); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: ok, 80.75 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| chromium-input | `status-force-renderer` | delete_text+insert_text: FAILED (returned False/False; text then "Let's meet at the peer on Thursday afternoon."); set_text_contents: FAILED (returned False; text then "Let's meet at the peer on Thursday afternoon."); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (returned False; text then "Let's meet at the peer on Thursday afternoon."); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: ok, 81.66 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| chromium-contenteditable | `status-force-renderer` | delete_text+insert_text: FAILED (returned False/False; text then "Let's meet at the\xa0peer on Thursday afternoon."); set_text_contents: FAILED (returned False; text then "Let's meet at the\xa0peer on Thursday afternoon."); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (returned False; text then "Let's meet at the\xa0peer on Thursday afternoon."); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: ok, 82.08 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| epiphany-textarea | `plain` | delete_text+insert_text: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); set_text_contents: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: ok, 90.83 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| epiphany-input | `plain` | delete_text+insert_text: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); set_text_contents: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: ok, 84.2 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |
| epiphany-contenteditable | `plain` | delete_text+insert_text: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); set_text_contents: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); independent read: "Let's meet at the peer on Thursday afternoon." | set_text_contents: FAILED (error: No such interface “org.a11y.atspi.EditableText” on object at path /org/a11y/atspi/accessib); independent read: "Let's meet at the peer on Thursday afternoon." | Text.set_selection+paste: ok, 87.46 ms, caret then at 22; independent read: final text; caret at end after set_caret_offset (independent: yes) |

## Hazard: Home pressed after the pastes (one run each)

| Case | Config | AT-SPI path | Blind path left the field as |
|---|---|---|---|
| gnome-text-editor | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| gtk4-textview | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| gtk4-entry | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| gedit | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| mousepad | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| gtk3-textview | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| gtk3-entry | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| featherpad | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| libreoffice-writer | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| gnome-terminal | `plain` | caret seen at 2; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| xfce4-terminal | `plain` | caret seen at 2; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| xterm | `plain` | no readable field: nothing to check, nothing edited | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| chromium-textarea | `status-force-renderer` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| chromium-input | `status-force-renderer` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| chromium-contenteditable | `status-force-renderer` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| epiphany-textarea | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| epiphany-input | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |
| epiphany-contenteditable | `plain` | caret seen at 0; refuse: the text before the caret does not end with what was pasted; field untouched: yes | `pier on Thursday afternoon.Let's meet at the peer on Thursday afternoon.` |

## Finding the field: tree walk and focus events (`atspi` scenario)

The listener was registered for `object:state-changed:focused` and `focus:` before the app started. "Focused objects seen" counts the objects with STATE_FOCUSED the walk met before it returned.

| Case | Config | Object returned | Focus events received | Last event's source is that object | Focused objects seen; rule that picked | First found after |
|---|---|---|---|---|---|---|
| gnome-text-editor | `plain` | text (GTK 4.14.5) | 1 | yes | 1; picked focused+editable+Text | 0.11 s |
| gtk4-textview | `plain` | text (GTK 4.14.5) | 1 | yes | 1; picked focused+editable+Text | 0.1 s |
| gtk4-entry | `plain` | text (GTK 4.14.5) | 1 | yes | 1; picked focused+editable+Text | 0.11 s |
| gedit | `plain` | text (gtk 3.24.41) | 1 | yes | 1; picked focused+editable+Text | 0.12 s |
| mousepad | `plain` | text (gtk 3.24.41) | 2 | yes | 1; picked focused+editable+Text | 0.18 s |
| gtk3-textview | `plain` | text (gtk 3.24.41) | 2 | yes | 1; picked focused+editable+Text | 0.1 s |
| gtk3-entry | `plain` | text (gtk 3.24.41) | 2 | yes | 1; picked focused+editable+Text | 0.11 s |
| featherpad | `plain` | text (Qt 5.15.13) | 2 | yes | 1; picked focused+editable+Text | 0.11 s |
| libreoffice-writer | `plain` | paragraph (gtk 3.24.41) | 5 | yes | 1; picked focused+editable+Text | 0.44 s |
| gnome-terminal | `plain` | terminal (gtk 3.24.41) | 2 | yes | 1; picked focused+Text (not editable) | 0.11 s |
| xfce4-terminal | `plain` | terminal (gtk 3.24.41) | 2 | yes | 1; picked focused+Text (not editable) | 0.11 s |
| xterm | `plain` | none | 0 | - | 0; picked - | not within 4.0 s |
| chromium-textarea | `status-force-renderer` | entry (Chromium 1.0) | 1 | yes | 2; picked focused+editable+Text | 0.14 s |
| chromium-input | `status-force-renderer` | entry (Chromium 1.0) | 1 | yes | 2; picked focused+editable+Text | 0.15 s |
| chromium-contenteditable | `status-force-renderer` | section (Chromium 1.0) | 1 | yes | 2; picked focused+editable+Text | 0.15 s |
| epiphany-textarea | `plain` | entry (None None) | 3 | yes | 4; picked focused+editable+Text | 0.13 s |
| epiphany-input | `plain` | entry (None None) | 3 | yes | 4; picked focused+editable+Text | 0.13 s |
| epiphany-contenteditable | `plain` | entry (None None) | 3 | yes | 4; picked focused+editable+Text | 0.13 s |

## Probes: what each launch config exposed

`Client connects` = when the harness (the AT-SPI client) connected, before the app started or after the pastes. `Bus at start` = whether org.a11y.Bus had an owner when the app started. "Text read back" = the text before the caret ends with the pasted sentence.

| Case | Config | Client connects | Bus at start | IsEnabled at start | Env, args or status added by the config | Apps on the AT-SPI desktop | Focused object found | Text read back |
|---|---|---|---|---|---|---|---|---|
| gnome-text-editor | `bus-late-client` | after | yes | False | - | gnome-text-editor | yes | yes |
| gnome-text-editor | `late-client` | after | NO | - | - | gnome-text-editor | yes | yes |
| gnome-text-editor | `plain` | before | yes | False | - | gnome-text-editor | yes | yes |
| gtk4-textview | `bus-late-client` | after | yes | False | - | Unnamed | yes | yes |
| gtk4-textview | `late-client` | after | NO | - | - | Unnamed | yes | yes |
| gtk4-textview | `plain` | before | yes | False | - | Unnamed | yes | yes |
| gtk4-entry | `bus-late-client` | after | yes | False | - | Unnamed | yes | yes |
| gtk4-entry | `late-client` | after | NO | - | - | Unnamed | yes | yes |
| gtk4-entry | `plain` | before | yes | False | - | Unnamed | yes | yes |
| gedit | `bus-late-client` | after | yes | False | - | gedit | yes | yes |
| gedit | `late-client` | after | NO | - | - | gedit | yes | yes |
| gedit | `plain` | before | yes | False | - | gedit | yes | yes |
| mousepad | `bus-late-client` | after | yes | False | - | mousepad | yes | yes |
| mousepad | `late-client` | after | NO | - | - | mousepad | yes | yes |
| mousepad | `plain` | before | yes | False | - | mousepad | yes | yes |
| gtk3-textview | `bus-late-client` | after | yes | False | - | gtk_field.py | yes | yes |
| gtk3-textview | `late-client` | after | NO | - | - | gtk_field.py | yes | yes |
| gtk3-textview | `plain` | before | yes | False | - | gtk_field.py | yes | yes |
| gtk3-entry | `bus-late-client` | after | yes | False | - | gtk_field.py | yes | yes |
| gtk3-entry | `late-client` | after | NO | - | - | gtk_field.py | yes | yes |
| gtk3-entry | `plain` | before | yes | False | - | gtk_field.py | yes | yes |
| featherpad | `bus-late-client` | after | yes | False | - | FeatherPad | yes | yes |
| featherpad | `bus-late-client-qt-always-on` | after | yes | False | QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 | FeatherPad | yes | yes |
| featherpad | `bus-late-client-status` | after | yes | True | - | FeatherPad | yes | yes |
| featherpad | `late-client` | after | NO | - | - | none | NO | - |
| featherpad | `late-client-qt-always-on` | after | NO | - | QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 | FeatherPad | yes | yes |
| featherpad | `plain` | before | yes | False | - | FeatherPad | yes | yes |
| libreoffice-writer | `bus-late-client` | after | yes | False | - | soffice | yes | yes |
| libreoffice-writer | `late-client` | after | NO | - | - | soffice | yes | yes |
| libreoffice-writer | `plain` | before | yes | False | - | soffice | yes | yes |
| gnome-terminal | `bus-late-client` | after | yes | False | - | gnome-terminal-server, gnome-terminal | yes | yes |
| gnome-terminal | `late-client` | after | NO | - | - | gnome-terminal-server, gnome-terminal | yes | yes |
| gnome-terminal | `plain` | before | yes | False | - | gnome-terminal-server, gnome-terminal | yes | yes |
| xfce4-terminal | `bus-late-client` | after | yes | False | - | xfce4-terminal | yes | yes |
| xfce4-terminal | `late-client` | after | NO | - | - | xfce4-terminal | yes | yes |
| xfce4-terminal | `plain` | before | yes | False | - | xfce4-terminal | yes | yes |
| xterm | `bus-late-client` | after | yes | False | - | none | NO | - |
| xterm | `late-client` | after | NO | - | - | none | NO | - |
| xterm | `plain` | before | yes | False | - | none | NO | - |
| chromium-textarea | `accessibility-enabled-env` | before | yes | False | ACCESSIBILITY_ENABLED=1 | Google Chrome for Testing | NO | - |
| chromium-textarea | `bus-late-client` | after | yes | False | - | none | NO | - |
| chromium-textarea | `bus-late-client-force-renderer` | after | yes | False | --force-renderer-accessibility | none | NO | - |
| chromium-textarea | `bus-late-client-status` | after | yes | True | - | Google Chrome for Testing | NO | - |
| chromium-textarea | `bus-late-client-status-force-renderer` | after | yes | True | --force-renderer-accessibility | Google Chrome for Testing | yes | yes |
| chromium-textarea | `force-renderer` | before | yes | False | --force-renderer-accessibility | none | NO | - |
| chromium-textarea | `gnome-accessibility-env` | before | yes | False | GNOME_ACCESSIBILITY=1 | Google Chrome for Testing | NO | - |
| chromium-textarea | `late-client` | after | NO | - | - | none | NO | - |
| chromium-textarea | `plain` | before | yes | False | - | none | NO | - |
| chromium-textarea | `screen-reader` | before | yes | True | ScreenReaderEnabled=true before launch | Google Chrome for Testing | NO | - |
| chromium-textarea | `status` | before | yes | True | - | Google Chrome for Testing | NO | - |
| chromium-textarea | `status-accessibility-enabled-env` | before | yes | True | ACCESSIBILITY_ENABLED=1 | Google Chrome for Testing | NO | - |
| chromium-textarea | `status-force-renderer` | before | yes | True | --force-renderer-accessibility | Google Chrome for Testing | yes | yes |
| chromium-textarea | `status-screen-reader-after-launch` | before | yes | True | ScreenReaderEnabled=true after launch | Google Chrome for Testing | NO | - |
| chromium-input | `plain` | before | yes | False | - | none | NO | - |
| chromium-input | `status-force-renderer` | before | yes | True | --force-renderer-accessibility | Google Chrome for Testing | yes | yes |
| chromium-contenteditable | `plain` | before | yes | False | - | none | NO | - |
| chromium-contenteditable | `status-force-renderer` | before | yes | True | --force-renderer-accessibility | Google Chrome for Testing | yes | yes |
| epiphany-textarea | `bus-late-client` | after | yes | False | - | epiphany | yes | yes |
| epiphany-textarea | `late-client` | after | NO | - | - | epiphany | yes | yes |
| epiphany-textarea | `plain` | before | yes | False | - | epiphany | yes | yes |
| epiphany-input | `bus-late-client` | after | yes | False | - | epiphany | yes | yes |
| epiphany-input | `late-client` | after | NO | - | - | epiphany | yes | yes |
| epiphany-input | `plain` | before | yes | False | - | epiphany | yes | yes |
| epiphany-contenteditable | `bus-late-client` | after | yes | False | - | epiphany | yes | yes |
| epiphany-contenteditable | `late-client` | after | NO | - | - | epiphany | yes | yes |
| epiphany-contenteditable | `plain` | before | yes | False | - | epiphany | yes | yes |

## How each app was started

| Case | Command | Env the harness always adds | Before launch | Focus |
|---|---|---|---|---|
| gnome-text-editor | `gnome-text-editor --standalone --ignore-session` | - | - | click at 350,312 in the window |
| gtk4-textview | `python3.12 ./gtk_field.py 4 textview` | - | - | none (the app or page focuses it) |
| gtk4-entry | `python3.12 ./gtk_field.py 4 entry` | - | - | none (the app or page focuses it) |
| gedit | `gedit --standalone` | - | - | click at 455,453 in the window |
| mousepad | `mousepad --disable-server` | - | - | click at 320,288 in the window |
| gtk3-textview | `python3.12 ./gtk_field.py 3 textview` | - | - | none (the app or page focuses it) |
| gtk3-entry | `python3.12 ./gtk_field.py 3 entry` | - | - | none (the app or page focuses it) |
| featherpad | `featherpad --standalone` | - | - | click at 350,300 in the window |
| libreoffice-writer | `soffice --writer --norestore --nologo --nofirststartwizard -env:UserInstallation=file://./work/run.SD8lT9/lo-profile` | SAL_USE_VCLPLUGIN=gtk3 | - | click at 640,528 in the window |
| gnome-terminal | `gnome-terminal.real --wait -- bash --rcfile ./terminal.bashrc -i` | - | - | click at 368,229 in the window |
| xfce4-terminal | `xfce4-terminal --disable-server -x bash --rcfile ./terminal.bashrc -i` | - | - | click at 408,241 in the window |
| xterm | `xterm -e bash --rcfile ./terminal.bashrc -i` | - | - | click at 242,158 in the window |
| chromium-textarea | `chrome --force-renderer-accessibility --no-sandbox --no-first-run --no-default-browser-check --password-store=basic --user-data-dir=./work/run.ZNHLIs/chrome-profile --window-size=1100,700 file://./fields.html#ta` | CHROMIUM_FULL_AS_SHIPPED=1 | - | none (the app or page focuses it) |
| chromium-input | `chrome --force-renderer-accessibility --no-sandbox --no-first-run --no-default-browser-check --password-store=basic --user-data-dir=./work/run.20yEIW/chrome-profile --window-size=1100,700 file://./fields.html#in` | CHROMIUM_FULL_AS_SHIPPED=1 | - | none (the app or page focuses it) |
| chromium-contenteditable | `chrome --force-renderer-accessibility --no-sandbox --no-first-run --no-default-browser-check --password-store=basic --user-data-dir=./work/run.lKojSt/chrome-profile --window-size=1100,700 file://./fields.html#ce` | CHROMIUM_FULL_AS_SHIPPED=1 | - | none (the app or page focuses it) |
| epiphany-textarea | `epiphany-browser --private-instance file://./fields.html#ta` | - | gsettings set org.gnome.Epiphany ask-for-default false | click at 400,120 in the window |
| epiphany-input | `epiphany-browser --private-instance file://./fields.html#in` | - | gsettings set org.gnome.Epiphany ask-for-default false | click at 400,213 in the window |
| epiphany-contenteditable | `epiphany-browser --private-instance file://./fields.html#ce` | - | gsettings set org.gnome.Epiphany ask-for-default false | click at 400,300 in the window |

## Unavailable

- Firefox: not run. apt's only candidate is `1:1snap1-0ubuntu5`, a stub that pre-depends on snapd, and this container has no snapd. packages.mozilla.org and ppa.launchpadcontent.net were refused by the proxy (CONNECT 403), so no .deb build could be fetched.
- Thunderbird: not run, for the same reason (apt candidate `2:1snap1-0ubuntu3`, pre-depends on snapd).
- Electron apps: not run. None is installed, `apt-cache policy code` has no candidate, and hosts other than Ubuntu's archive are blocked.
- KWrite and Kate: not installed; FeatherPad is the Qt case (Qt 5.15). No Qt 6 app was run.

## Not measured

- Any Wayland session, GNOME Wayland included: every run is X11 under Xvfb with openbox.
- A strictly confined snap as the AT-SPI client: whether a confined VOCO can reach the accessibility bus at all was not tried.
- A real desktop session (GNOME Shell, its at-spi autostart, a running screen reader, a clipboard manager).
- Chromium page content without `--force-renderer-accessibility`: it was not exposed under the 12 other configs in the probes table; no other switch was tried.
- Whether an AT-SPI replace is one undo step in the app, and what the app's undo then restores.
- Text with more than one line or paragraph, non-ASCII text, text after the caret, an existing selection, password fields, read-only fields.
- Latency distributions: the timings are a median of 5 on one virtual machine, and a second pass of the same runs was up to about 2x slower (results-first-pass/ against results/).

## Limits of this measurement

- One run per app/field and scenario in results/ (174 runs). An earlier pass of 144 of them, with the harness still changing, is kept in results-first-pass/: 143 gave the same outcome fields, and the one that differs is a run from before a window-matching fix.
- Three first-pass runs found no window (results-first-pass/flakes/): openbox's log says it could not open the display. The likely cause, not proven, is Xvfb resetting as its first client left; xsession.sh now starts Xvfb with -noreset, and none of the 174 runs of the final pass failed to start.
- The three chunks are pasted as the task gives them, so chunk 1 ends and chunk 3 begins with a space. VOCO itself keeps spaces away from a paste's edges; the no-break spaces read back from the two contenteditable fields come from those edges.
- The independent read of GUI fields is Ctrl+Shift+Home, Ctrl+C (the text before the caret) and then Ctrl+A, Ctrl+C, read with xclip after the selections were left without an owner. In terminals it is bash's READLINE_LINE and READLINE_POINT through a bind -x key.
- XDG_RUNTIME_DIR is the run's folder bind-mounted on /run/user in a private mount namespace, so atk-bridge's socket path stays under 108 bytes.
- Here /usr/bin/python3 is Python 3.13 without python3-gi, so the harness and gnome-terminal's launcher run as /usr/bin/python3.12 and /usr/bin/gnome-terminal.real.
- The harness runs as root; Chromium therefore runs with --no-sandbox.

## Versions

```
at-spi2-core 2.52.0-1build1
bash 5.2.21-2ubuntu4
epiphany-browser 46.5-0ubuntu1
featherpad 1.4.1-0ubuntu4
gedit 46.2-2
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
mousepad 0.6.1-1build2
openbox 3.6.1-12build5
python3-gi 3.48.2-1
xclip 0.13-3
xdotool 1:3.20160805.1-5build1
xfce4-terminal 1.1.3-1build1
xterm 390-1ubuntu3
xvfb 2:21.1.12-1ubuntu1.9
Google Chrome for Testing 153.0.8010.12 
Linux 6.18.44-fc-v726
```
