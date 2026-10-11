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

Locking your screen stops a dictation, and VOCO shows **Dictation stopped**.
Words it hadn't typed go to the clipboard, as when you stop. While the screen
is locked, the shortcut doesn't start VOCO.

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
- Don't dictate while a terminal program is waiting for an answer, such as a
  coding agent's permission prompt. The terminal passes your words to the
  program, and unless the program turns on bracketed paste, it reads them as
  typed keys: a phrase that starts with "y" or a digit can answer the prompt.
  Some prompts take a short paste as an answer even with bracketed paste on.

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
| Tray menu | Open the tray icon's menu for **Open VOCO**, **Start dictation** or **Stop dictation**, **Settings**, **Review**, **Change shortcut** and **Quit VOCO**. |
| GNOME panel | Seven bars move with your voice. Click to stop while you dictate, or to open Settings. |
| GNOME panel menu | Right-click or middle-click the panel, or press Menu or Shift+F10 on it, for **Settings**, **Review** and **Stop dictation**. |
| Popover | Shows VOCO's status, your shortcut and your microphone, with **Help** and **Hide to tray**. |

On GNOME the tray icon needs an AppIndicator extension. Ubuntu includes one;
Debian 13 and Fedora 44 don't turn one on, so there the GNOME panel is VOCO's
place in the top bar.

Settings has five pages: **Settings** for your microphone and spelling, **My words**,
**Shortcut**, **Updates** and **Help**, which has setup steps and runtime checks. Opening
VOCO from your app menu shows the popover, even when VOCO wasn't running, except
while you dictate. Started from a terminal or by your desktop's startup apps,
VOCO stays in the tray. The panel
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

## Spelling

VOCO writes British spelling unless you choose otherwise, at setup or on the
**Settings** page: **British English** (colour, organise, travelling),
**American English** (color, organize, traveling) or **Leave spelling as
recognised**, the recognizer's own mix. A change applies from your next
dictation.

- Only words spelled one way in each variety change. Words whose spelling
  depends on meaning stay as recognised, such as program, check, practice,
  licence, kerb, storey and gray. American English still turns cheque into
  check, tyre into tire and metre into meter, because American spells each of
  them one way in every meaning.
- Names stay too. A word with a capital letter never changes, because it may
  be a name, so Pearl Harbor stays. That includes the first word of a sentence:
  a sentence that starts with "Color" keeps that spelling.
- Words that sound different in each variety stay as you said them, such as
  aluminium, maths and learnt.
- VOCO pastes a word only once its spelling can't change, so the end of a word
  such as "recognise" can appear a moment after the rest. The most common words,
  such as a, he, must and will, never wait. For that, a few rare words keep the
  recognizer's spelling: British English leaves hemoglobin and the other hem-
  words, mustache and willful as recognised, and American English leaves
  aetiology and callisthenics.

## My words

On the **My words** page, list the names and words you want VOCO to write your
way. Add each one as you want it written, with its capitals and accents. The
list holds up to 100 entries of up to four words each, and a change applies from
your next dictation. Setup offers the full name on your account as the first
one, after the voice test; you can change it, add more, or skip it.

- VOCO listens out for the words on your list and writes each one as listed,
  whether it hears "git hub", "Github" or "GitHub". It joins letters you spell
  out, so "G T K" becomes GTK, and it writes the accents you typed, so "Zoe"
  becomes Zoë.
- Type an ordinary word in lower case, like "router", so it keeps its usual
  capitals. VOCO still capitalises it at the start of a sentence.
- A word that sounds exactly like another, such as Stephen and Steven, can still
  come out as the other, and so can a word VOCO hears as a different one.
- Spelling never changes a word on your list.
- A word that might still become part of a listed name waits for the next word,
  so with New Zealand on your list, "New" appears once the next word does.
- The list stays in your settings file on this computer. VOCO never logs it or
  sends it anywhere.

### Say it

Choose **Say it** beside a word and say it the way you usually do. VOCO stops
listening when you stop speaking, or when you choose **Done** or press your
shortcut, and shows what it heard. It shows it only in its own window: nothing
is typed or copied, and your spelling choice doesn't apply.

- **VOCO writes** with your word means dictation writes it as listed.
- If VOCO heard something else, choose **Teach VOCO**. From then on VOCO writes
  your word wherever it hears that version. When only one word of a longer entry
  came out wrong, VOCO learns that word, so it's fixed when you say it on its
  own too. Say it again to check: VOCO may hear a word differently another time,
  and you can teach it each version.
- If what VOCO heard is made only of everyday words, such as "tiger" for Tadhg,
  VOCO asks you to say it again first: teaching it would change those words every
  time you say them. **Teach anyway** teaches it.
- VOCO keeps up to five versions of each word, under **Heard as**. Choose ×
  beside one to forget it. Removing a word removes its versions.
- VOCO can't learn a version that is one of your other words, or another
  word's version.
- The versions VOCO learns stay in your settings file with the list.

## Shortcut

To change the shortcut, choose **Change shortcut** in the tray menu, then
**Alt+D**, **Alt+Shift+D** or **Custom shortcut…**. On the **Shortcut** page,
choose **Change shortcut**, type a shortcut or choose **Record keys**, then
choose **Apply shortcut**. A shortcut needs Alt, Ctrl or Super plus another key.
**Record keys** names the key you press rather than the symbol it types, so
Ctrl+Shift+1 records as `Ctrl+Shift+1`, and a letter on a non-Latin layout as
its Latin key.
If your saved shortcut isn't valid, VOCO sets it back to `Alt+D` and shows
**Shortcut reset**.

| Desktop | How the shortcut reaches VOCO |
| --- | --- |
| X11 | VOCO registers the shortcut with the desktop. |
| GNOME 46, 48, 50 or 51 on Wayland | The [VOCO panel](install.md#gnome-panel) handles an `Alt+D` or `Alt+Shift+D` shortcut and keeps it from the app you are typing in. |
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
**Check for updates**. To check only when you choose, open **Update settings**
on the **Updates** page and set **Update checks** to **Only when I choose**.
VOCO never downloads or installs updates. To upgrade, see
[Upgrade](install.md#upgrade).

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
  the user of the active local session. Outside GNOME 46, 48, 50 and 51, the
  shortcut also needs a desktop binding.
- Apps that remap Shift+Insert, remote desktops and virtual machines may not
  accept the paste.
- In Chromium's address bar, a phrase that continues the previous one joins its
  last word, because the address bar trims the pasted space.
