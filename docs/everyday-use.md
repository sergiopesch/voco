# Using VOCO

In the .46 candidate, a successful voice test is followed by a desktop input check
before onboarding completes. **Desktop setup required** means helpers or their
service need attention; it is different from **No text cursor available**. Repair
setup using the [installation guide](install.md), then retry the check.

## First-time setup (design candidate)

Choose **Start test** and speak. The signal moves with microphone input and your
words appear here. Speech stays on this computer; the test never pastes into
other apps or changes the clipboard. Choose **Change microphone** to select a
different input, then **Back to setup**. VOCO uses your selection, or the system
default if you have not selected a microphone.

Choose **Finish test** to stop capture and collect the final words. After a
successful test, **Done** checks desktop input and saves completion. Silence,
recognition failures and incomplete desktop setup keep onboarding open with an
action to retry. These interface changes are on the isolated design branch and
are not an installed or published release.

## Dictation

Check your microphone during setup, then hide VOCO and focus an editable field.
Press the recording shortcut (default **Alt+D**), wait for Listening, and speak.
Words appear progressively. Press the shortcut again to finish; the final words
and punctuation are delivered before VOCO returns to Ready.

If no editable cursor can be verified, VOCO shows a desktop notification and does
not record. Click in a text field and press the shortcut again. Password fields
are excluded. Some custom controls do not expose an accessible caret.

Keep the intended field focused. VOCO uses clipboard paste, replaces clipboard
text, leaves it there and never presses Enter. Recognized terminals use their
paste chord without changing terminal settings. Protected, custom, remote and rich
editors need individual testing. The generic desktop route appends text; it does
not rewrite the entire message after Stop.

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

If delivery is interrupted, open VOCO to review the retained transcript. Check the
destination before pasting: it may already contain some of your words. VOCO never
blindly retries uncertain delivery. Copying does not dismiss a transcript.

Where available, Retry transcription uses retained audio without automatically
inserting it. Normal NVIDIA dictation recovers with the bundled local model,
including while offline; it does not download Whisper. The result identifies the
recognizer used. Browser/legacy dictation retains its separate Whisper recovery.
Cancel stops waiting immediately and keeps the audio; an outstanding native
request may finish before its worker is released. Clear or discard recovery before starting another recording.
Recovery stays in memory only and is lost when VOCO exits.

## Optional browser integration

The packaged Chromium extension remains a separate dictation route for eligible
plain fields in an explicitly enabled tab. Its shortcut is **Alt+Shift+V**. It
checks the original field and stops on focus changes or edits. IBus supplies
consuming recording shortcuts; it never mutates text. See [delivery details](testing/desktop-paste.md).

[Diagnostics](testing/laptop-performance.md) explains optional local metrics.
