# Using VOCO

These instructions describe the private **2026.0.60** candidate. Public **2026.0.59**
has the earlier in-memory recovery flow; these changes are not published yet.

A successful voice test is followed by a desktop input check
before onboarding completes. **Desktop setup required** means helpers or their
service need attention. Repair setup using the [installation guide](install.md),
then retry the check.

## First-time setup

Choose **Start test** and speak. The signal moves with microphone input and your
words appear here. Speech stays on this computer; the test never pastes into
other apps or changes the clipboard. Choose **Change microphone** to select a
different input within the same setup canvas. Applying
a microphone returns directly to the test; **Back to test** leaves the chooser
without applying a new choice. VOCO uses your selection, or the system
default if you have not selected a microphone.

Choose **Finish test** to stop capture and collect the final words. After a
successful test, VOCO checks desktop input automatically. **Your voice, ready.**
shows your shortcut and explains that VOCO stays in the tray. **Done** rechecks
readiness, saves completion and returns directly to the tray. There is no second
window to dismiss. Reopening VOCO from the launcher presents
the existing idle app. During capture it never takes focus from the app you are
dictating into. Changing microphones requires a new test. Silence,
recognition failures and incomplete desktop setup keep onboarding open with an
action to retry.

## Panel setup

The Debian package includes the GNOME 46 panel. The guided installer
activates it for the user running setup. Manual APT installs can choose **Enable
live panel** in onboarding or Help, or run `voco --setup-panel`. Package hooks do
not enable extensions. If setup says to sign out, save your work and sign out and
back in; installing files alone cannot reload a running Wayland Shell.

While recording, the panel shows the microphone and real input bars, without a
Listening label or Stop button. Click the icon or use your shortcut to stop.
Right-click for **Settings**, **Review**, and **Stop** during capture.
Other desktops use the native tray menu. `voco --check-panel` changes no preferences.
On GNOME Wayland the panel is recommended, not required. It keeps **Alt+D** and
**Alt+Shift+D** out of the focused app at every status. Without it dictation still
works, but the focused app also receives the shortcut: a browser focuses its
address bar and a terminal deletes a word. After an upgrade, run panel setup
again, then sign out and back in.

The fallback tray replaces its Ready label with
audio-driven bars while recording. Silence settles the bars; Stop restores the
normal status. The tray menu keeps a readable status and an explicit Stop action.
Smooth movement follows the desktop's animation preference.

## Dictation

Check your microphone during setup, then click where you want the text, in any
app: a text field, a browser address bar, an editor or a terminal such as Ghostty.
Press and release the recording shortcut (default **Alt+D**), wait for the input bars,
and speak.
Words appear progressively. Press and release the shortcut again to finish; the final words
and punctuation are delivered before VOCO returns to Ready.

Each chunk is pasted into whatever has keyboard focus when it is ready. VOCO
copies it to the clipboard and primary selection, then presses Shift+Insert, the
paste key shared by GTK, Qt, Chromium, Firefox, Electron apps and terminals. The
text stays on the clipboard. Line breaks become spaces and VOCO never presses
Enter, so it never submits a form or runs a command. Later chunks follow focus:
stop dictation before switching fields. VOCO cannot tell a password field or
prompt from any other field, so check what is focused before you speak.

If a paste types nothing, VOCO tries again with the next words. If a paste fails
any other way, VOCO stops typing, notifies you and keeps listening until you stop.
At Stop it copies the words it did not type to the clipboard and notifies you;
check the field, then paste them with Shift+Insert. VOCO cannot confirm that an
app displayed pasted text or retract text from another app. It appends text; it
does not rewrite earlier words after Stop.

A recording is currently bounded to ten minutes, with an additional source-audio
memory limit for high sample rates. Stop and start a new recording for longer work.
This is not an unlimited continuous-session guarantee.

## Settings

Right-click the tray icon and choose **Settings** for microphone controls. Shortcut has its own sidebar section,
with **Alt+D** as the default. Updates and Help are separate destinations; Help
groups troubleshooting by symptom. Drag the top bar or the VOCO brand area to move the window.
Resize using its edges. Hide to tray closes the panel without quitting.

There is one output behavior: dictation into the focused app. Assistant integrations,
conversation, enhancement and output-mode selectors are removed. Upgrades ignore
retired settings and preserve your microphone and shortcut. The interface follows
system motion, contrast and transparency preferences without an Appearance page.

Microphone choices apply immediately. Choosing a native microphone allows access
for this app session; no extra checkbox is required. Selecting a device does not start capture.
Choose **Change shortcut**, edit or record keys, then **Apply shortcut** or **Cancel**. If you
hide the window with unsaved edits, choose Save and hide, Discard and hide, or
Keep editing. Recording is paused while capturing a new shortcut.

## Crash Recovery

Normal dictation is not saved. A temporary owner-only local text checkpoint is
deleted after Stop, a handled failure, cancellation or a clean app exit. Audio is
never written by crash recovery. This does not clear the clipboard or text already
typed into an app.

After an unexpected app exit, right-click the tray icon and choose **Review**.
The resizable window keeps long text scrollable and Copy and Discard reachable.
Check the app you were dictating into first: some words may already be there. Copy never pastes,
retries delivery or removes the entry; Discard asks for confirmation.
Up to five interrupted transcripts are retained, each limited to 256 KiB. A sixth
crash replaces the oldest. Recovery includes only the last completed checkpoint,
not speech still awaiting recognition. Prior crash entries remain until discarded.

If typing is interrupted without an app crash, VOCO notifies you, stops typing
and keeps healthy recognition running through Stop. At Stop it copies the words it
did not type to the clipboard, clears the temporary text and audio and allows
another recording. VOCO never opens Review automatically or replays uncertain
output as keys.

## Optional browser integration

The packaged Chromium extension remains a separate dictation route for eligible
plain fields in an explicitly enabled tab. Its shortcut is **Alt+Shift+V**. It
checks the original field and stops on focus changes or edits. IBus supplies
consuming recording shortcuts; it never mutates text. See [delivery details](testing/desktop-paste.md).

[Diagnostics](testing/laptop-performance.md) explains optional local metrics.
