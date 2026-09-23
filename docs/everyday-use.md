# Using VOCO

These instructions describe public **2026.0.57**, including direct tray handoff
after onboarding and saved dictation opened only when requested.

A successful voice test is followed by a desktop input check
before onboarding completes. **Desktop setup required** means helpers or their
service need attention; it is different from **No text cursor available**. Repair
setup using the [installation guide](install.md), then retry the check.

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
the existing idle app. During capture it keeps your destination focused. Changing
microphones requires a new test. Silence,
recognition failures and incomplete desktop setup keep onboarding open with an
action to retry.

## Panel setup

The Debian package includes the GNOME 46 panel. The guided installer
activates it for the user running setup. Manual APT installs can choose **Enable
live panel** in onboarding or Help, or run `voco --setup-panel`. Package hooks do
not enable extensions. If setup says to sign out, save your work and sign out and
back in; installing files alone cannot reload a running Wayland Shell.

The panel shows real microphone bars, Listening and Stop. Other desktops and a
disabled companion use the native tray, with status labels where supported and a
status row plus Stop in its menu. `voco --check-panel` changes no preferences.

The fallback tray replaces its Ready label with
audio-driven bars while recording. Silence settles the bars; Stop restores the
normal status. The tray menu keeps a readable status and an explicit Stop action.
Smooth movement follows the desktop's animation preference.

## Dictation

Check your microphone during setup, then focus an editable field.
Press and release the recording shortcut (default **Alt+D**), wait for Listening,
and speak.
Words appear progressively. Press and release the shortcut again to finish; the final words
and punctuation are delivered before VOCO returns to Ready.

VOCO binds dictation to a text field or supported terminal pane. If it cannot
identify the typing destination, it shows a desktop notification and does not
record. Focus the intended destination and press the shortcut again. Fields
identified as passwords are excluded. The [.56 release](releases/2026.0.56.md)
supports Ghostty's focused terminal canvas even though it exposes no text caret.

Stop dictation before switching fields. VOCO uses clipboard paste, replaces
clipboard text, leaves it there and never presses Enter. A focus change during
a paste gesture can redirect a fragment before VOCO detects it; recovery cannot
retract text from another app. Recognized terminals use their
paste chord without changing terminal settings. Protected, custom, remote and rich
editors need individual testing. The generic desktop route appends text; it does
not rewrite the entire message after Stop.

Terminal delivery cannot confirm that pasted text appeared or identify every
password prompt. Read-only terminal mode can reject input. Review terminal text
before submitting it; VOCO never submits commands for you.

A recording is currently bounded to ten minutes, with an additional source-audio
memory limit for high sample rates. Stop and start a new recording for longer work.
This is not an unlimited continuous-session guarantee.

## Settings

Settings contains microphone controls. Shortcut has its own sidebar section,
with **Alt+D** as the default. Updates and Help are separate destinations; Help
groups troubleshooting by symptom. Drag the top bar or the VOCO brand area to move the window.
Resize using its edges. Hide to tray closes the panel without quitting.

There is one output behavior: direct cursor dictation. Assistant integrations,
conversation, enhancement and output-mode selectors are removed. Upgrades ignore
retired settings and preserve your microphone and shortcut. The interface follows
system motion, contrast and transparency preferences without an Appearance page.

Browser microphone choices save immediately. Native capture requires session
consent and **Use this microphone**. Selecting a device does not start capture.
Choose **Change shortcut**, edit or record keys, then **Apply shortcut** or **Cancel**. If you
hide the window with unsaved edits, choose Save and hide, Discard and hide, or
Keep editing. Recording is paused while capturing a new shortcut.

## Recovery

If delivery is interrupted, a notification tells you immediately. When recognition
is still healthy, VOCO continues transcribing locally through Stop, without sending
more text to the destination. A recognition or capture failure instead retains the
received audio for recovery; it cannot promise a complete transcript.

After Stop, VOCO notifies you and stays in the tray. Open VOCO when you want to review
or copy the saved dictation. **What happened** contains the interruption details.
Check the destination before pasting: it may already contain some of your words or
manual edits. VOCO never blindly retries uncertain delivery. Copying does not dismiss
a transcript. If desktop notifications are disabled, recovery remains accessible
through the VOCO tray or launcher.

Where available, Retry transcription uses retained audio without automatically
inserting it. Desktop and browser dictation recover with the same bundled local
Nemotron model, including while offline. The result identifies the recognizer used.
Cancel stops waiting immediately and keeps the audio; an outstanding native
request may finish before its worker is released. Clear or discard recovery before starting another recording.
Recovery stays in memory only and is lost when VOCO exits.

## Optional browser integration

The packaged Chromium extension remains a separate dictation route for eligible
plain fields in an explicitly enabled tab. Its shortcut is **Alt+Shift+V**. It
checks the original field and stops on focus changes or edits. IBus supplies
consuming recording shortcuts; it never mutates text. See [delivery details](testing/desktop-paste.md).

[Diagnostics](testing/laptop-performance.md) explains optional local metrics.
