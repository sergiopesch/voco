# Using VOCO

In the .46 candidate, a successful voice test is followed by a desktop input check
before onboarding completes. **Desktop setup required** means helpers or their
service need attention; it is different from **No text cursor available**. Repair
setup using the [installation guide](install.md), then retry the check.

## First-time setup (.44 candidate)

VOCO selects your system microphone and speaker. **Test speaker** plays a short
sound through the default output. Click **Start Test** and speak: the signal band
moves with microphone input and your words appear inside setup. This test does not
paste into other apps or change the clipboard. Microphone capture begins only when
you start the test.

When words appear, click **Finish Onboarding**. VOCO stops capture, collects the
final words and saves completion only if the test succeeded. **Stop Test** lets you
review the result first. Silence and recognition failures keep setup incomplete;
retry after checking the displayed message. This flow is in the local .44 candidate,
not the previously published .43 package.

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

Settings cover Overview, Microphone, Dictation, Shortcuts, Updates and
Troubleshooting. Drag the top bar or the VOCO brand area to move the window.
Resize using its edges. Hide to tray closes the panel without quitting.

There is one output behavior: direct cursor dictation. Assistant integrations,
conversation, enhancement and output-mode selectors are removed. Upgrades ignore
retired settings and preserve your microphone and shortcut. The interface follows
system motion, contrast and transparency preferences without an Appearance page.

Microphone choices save immediately. Shortcut edits have a Save action. If you
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
