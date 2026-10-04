# Everyday use

This guide covers dictating, VOCO's controls, Review and what VOCO keeps on
your computer. To set VOCO up, see [Install VOCO](install.md).

## Dictate

1. Click where you want the text.
2. Press `Alt+D` and wait until VOCO shows **Listening**.
3. Speak. Your words appear a phrase at a time, with punctuation and capital
   letters.
4. Press `Alt+D` again to finish.

You can also start and stop from the tray menu. The GNOME panel replaces the
tray icon and can stop a dictation, but you start with the shortcut. If a VOCO
window is open when you press the shortcut, VOCO hides it instead of starting.
Click in your app and press the shortcut again.

## Where your words go

VOCO pastes each phrase into the window that has keyboard focus. It puts the
phrase on the clipboard and the primary selection, then presses Shift+Insert.

- Text follows focus. If you switch windows while you speak, the next phrase
  goes to the new window.
- Dictation replaces what you copied last. The last phrase stays on the
  clipboard, and clipboard managers may keep copies.
- VOCO never presses Enter. It turns line breaks and tabs into spaces, so a
  phrase can't run a terminal command. Read terminal text before you press
  Enter.

### If a paste fails

VOCO shows **VOCO stopped typing** and keeps listening. When you stop, it
copies the words it didn't type to the clipboard and shows
**Dictation copied to clipboard**. Some words may already be in the field, so
check it first, then press Shift+Insert or Ctrl+V. If the copy also fails,
VOCO saves the text in [Review](#review) and shows **Dictation saved in Review**.

## Controls

| Control | What it does |
| --- | --- |
| Shortcut | Starts and stops dictation. It is `Alt+D` unless you change it. |
| Tray icon | Click to stop while you dictate, or to open the VOCO popover. |
| Tray menu | **Open VOCO**, **Start dictation** or **Stop dictation**, **Settings**, **Review**, **Change shortcut** and **Quit VOCO** |
| GNOME panel | Seven bars move with your voice. Click to stop while you dictate, or to open Settings. |
| GNOME panel menu | Right-click or middle-click the panel, or press Menu or Shift+F10 on it, for **Settings**, **Review** and **Stop dictation**. |
| Popover | Shows VOCO's status, your shortcut and your microphone, with **Help** and **Hide to tray**. |

On GNOME the tray icon needs an AppIndicator extension. Ubuntu includes one;
Debian 13 and Fedora 44 don't turn one on, so there the GNOME panel is VOCO's
place in the top bar.

Settings has four pages: **Settings** for your microphone, **Shortcut**,
**Updates** and **Help**, which has setup steps and runtime checks. Opening
VOCO from your app menu shows the popover, except while you dictate. The panel
menu has no quit item, so with the panel, finish dictating and run
`pkill -x voco` to quit VOCO.

## Microphone

VOCO uses your system's default microphone unless you choose another on the
**Settings** page.

- **Wayland:** choose from **Microphone**. **System default (current device)**
  follows your system setting. **Refresh devices** updates the list, and
  **Retry capture setup** checks microphone access again.
- **X11:** choose from **Input device**. **Test microphone** opens a sound check
  with a live level. If the chosen microphone is missing, VOCO uses the system
  default and shows **Microphone changed**.

VOCO has no volume control, so set the input level in your system's sound
settings. If the microphone disconnects or stops sending audio while you
dictate, VOCO stops and tells you.

## Shortcut

To change the shortcut, choose **Change shortcut** in the tray menu, then
**Alt+D**, **Alt+Shift+D** or **Custom shortcut…**. On the **Shortcut** page,
choose **Change shortcut**, type a shortcut or choose **Record keys**, then
choose **Apply shortcut**. A shortcut needs Alt, Ctrl or Super plus another key.
If your saved shortcut isn't valid, VOCO sets it back to `Alt+D` and shows
**Shortcut reset**.

| Desktop | How the shortcut reaches VOCO |
| --- | --- |
| X11 | VOCO registers the shortcut with the desktop. |
| GNOME 46, 48 or 50 on Wayland | The [VOCO panel](install.md#gnome-panel) handles an `Alt+D` or `Alt+Shift+D` shortcut and keeps it from the app you are typing in. |
| Other Wayland desktops | Bind a key to `voco --toggle`, as described in [Wayland compositor shortcuts](install.md#wayland-compositor-shortcuts). |

On Wayland without the panel, VOCO can still watch for `Alt+D` and
`Alt+Shift+D` if your account can read keyboard devices, but the key press also
reaches your app. See
[The shortcut also reaches your app, or does nothing](troubleshooting.md#the-shortcut-also-reaches-your-app-or-does-nothing)
for fixes.

## Browser fields

With the optional [Chromium extension](install.md#chromium-extension), VOCO
writes straight into one text field in Google Chrome or Chromium instead of
pasting.

1. Click the extension's toolbar button in the tab. Each new page needs this.
2. Click in a text field and press `Alt+Shift+V`.
3. Speak, then press `Alt+Shift+V` again to finish.

It works in multi-line text boxes and in text, search, URL and phone number
fields on the main page, with no text selected. It rejects password, one-time
code and card fields, rich text editors, fields inside frames and incognito
tabs.

If focus leaves the field, VOCO stops writing into it but keeps listening. At
Stop, it copies any words the field didn't take to the clipboard. Closing or
leaving the page stops dictation. Browser undo may not remove dictated text. To
turn the extension off for the tab, click its toolbar button again.

## Review

Review keeps text that didn't reach your app: a dictation that was running when
VOCO closed unexpectedly, or one VOCO could neither paste nor copy. Choose
**Review** in the tray menu or the GNOME panel menu. Each
**Interrupted dictation** has **Copy transcript** and **Discard**, and some of
its words may already be in your app. VOCO keeps the five most recent entries
until you discard them.

## What VOCO keeps

| Location | Contents |
| --- | --- |
| `~/.config/voco/` | Settings, the last update check, and a backup of old settings if you reset them |
| `~/.local/state/voco/crash-recovery/` | A copy of the text while you dictate, deleted when the dictation ends normally, and Review entries |
| `~/.local/state/voco/` | Diagnostic logs, only if you turn them on (see [Performance logs](troubleshooting.md#performance-logs)) |
| `~/.local/share/com.sergiopesch.voco/` | Data and cache for VOCO's window |

Only your account can read VOCO's settings and recovery files. VOCO doesn't
save audio in normal use. It also uses private sockets in your session's runtime
folder, which your system clears when you sign out.

VOCO's only network request asks GitHub which releases exist. It runs when VOCO
starts, reusing an answer for up to six hours, and when you choose
**Check for updates**. VOCO never downloads or installs updates. To upgrade,
see [Upgrade](install.md#upgrade).

After you [remove VOCO](install.md#remove), delete its folders to remove your
data:

```bash
rm -rf ~/.config/voco ~/.local/state/voco ~/.local/share/com.sergiopesch.voco
```

## Limits

- VOCO recognizes English only.
- A dictation stops after 10 minutes, or sooner if your microphone records
  above about 56 kHz.
- VOCO can't tell a password field from other fields. Don't dictate into one.
- VOCO only adds text. It can't correct words after it pastes them.
- If recognition falls more than three seconds behind, or revises words it has
  already given, VOCO stops transcribing and shows **Dictation interrupted**.
- On Wayland, typing needs access to `/dev/uinput`, which the package gives only
  the user of the active local session. Outside GNOME 46, 48 and 50, the
  shortcut also needs a desktop binding.
- Apps that remap Shift+Insert, remote desktops and virtual machines may not
  accept the paste.
