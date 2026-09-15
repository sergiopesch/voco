# Using VOCO

## Dictation

Check your microphone during setup, then hide VOCO and focus an editable field.
Press the recording shortcut (default **Alt+D**), wait for Listening, and speak.
Words appear progressively. Press the shortcut again to finish; the final words
and punctuation are delivered before VOCO returns to Ready.

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
inserting it. Clear or discard recovery before starting another recording.
Recovery stays in memory only and is lost when VOCO exits.

## Optional browser integration

The packaged Chromium extension remains a separate dictation route for eligible
plain fields in an explicitly enabled tab. Its shortcut is **Alt+Shift+V**. It
checks the original field and stops on focus changes or edits. IBus supplies
consuming recording shortcuts; it never mutates text. See [delivery details](testing/desktop-paste.md).

[Diagnostics](testing/laptop-performance.md) explains optional local metrics.
