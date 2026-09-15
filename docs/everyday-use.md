# Everyday use

The 2026.0.37 local candidate combines the Crystal Sidebar interface with
CPU-local NVIDIA Nemotron English streaming. It is awaiting owner laptop acceptance;
see [candidate status](release-candidate.md).

## First dictation

Open Microphone settings and check the sound meter. A moving meter proves audio
arrives, not recognition or delivery. Finish setup, focus an editable destination,
then use the configured recording shortcut (default Alt+D). Wait for Listening,
speak, and keep that field focused until Stop has flushed the remaining words.
Dictation stays in the tray without automatically opening a preview window.

The default desktop route appends recognized words through clipboard paste. It
replaces clipboard text and leaves it there. Known terminals use the terminal paste
chord without keybinding changes. VOCO never sends Enter. Focus checks are best-effort;
no universal application support or exact-widget guarantee is claimed. Read-only,
protected, custom and rich fields need separate qualification. Stop appends the tail;
it does not safely rewrite the entire already-delivered message.

The optional Chromium exact-field extension is a separate route for eligible plain
controls in an explicitly enabled tab, using Alt+Shift+V. IBus supplies optional
consuming shortcuts and never mutates text. See [delivery policy](testing/desktop-paste.md).

## Recovery and daily controls

The panel shows normal Copy results separately from failed or interrupted recordings.
When available, **Retry transcription** uses retained audio without inserting text
automatically. Copy the text you need, then clear or discard the current recovery
before starting another recording. If older retained transcript entries are present,
review and dismiss them explicitly. Copying does not dismiss text.

Audio and transcript recovery are in memory only. Closing VOCO loses them. Review
the original field before pasting after uncertain delivery, since it may contain
some of your words already. Performance logs do not contain this audio or text.

**Hide to dictate** hides the panel without starting recording. The microphone name
opens Microphone settings. **More** contains guidance and optional Realtime
conversation. Escape inside More closes it and returns focus to its trigger.
Realtime streams audio to OpenAI while active; ordinary dictation stays local.

## Settings and appearance

Eight settings pages cover Overview, Microphone, Dictation, Shortcuts, Appearance,
Integrations, Updates and Troubleshooting. Choice controls save automatically.
Text edits have explicit Save actions. Hiding with pending edits offers Save and
hide, Discard and hide, or Keep editing. Shortcut capture cannot also start dictation.

The selected silver microphone, graphite surfaces, Crystal Sidebar and glass controls
are the default. There is no glass toggle. OS reduced motion, increased contrast,
forced colors and reduced transparency remain respected. The sound meter continues
to provide functional feedback. Small windows scroll, and section changes focus
headings. These checks do not establish assistive-technology certification.

See [laptop performance](testing/laptop-performance.md) for log collection and
[combined laptop testing](testing/combined-laptop-testing.md) for the test checklist.
