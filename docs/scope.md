# What VOCO doesn't do

VOCO is private, local dictation for Linux. Press a shortcut, speak, and your
words appear where you are typing. Keeping VOCO small is how it stays private,
predictable and safe to leave running. This page lists what VOCO deliberately
doesn't do, and why, so you know what to expect before you ask.

Some of these are choices VOCO keeps on purpose. A few are limits of what VOCO
does today. Where the difference matters, the page says which.

## Choices VOCO keeps on purpose

### VOCO never presses Enter

VOCO pastes text and stops there. It turns line breaks and tabs into spaces, so
a phrase can't run a terminal command or submit a form. You read the text and
press Enter yourself.

This also means you can't dictate a new line or a tab.

### No account, subscription, telemetry or cloud

VOCO has no account and no subscription. It sends no telemetry and never sends
your speech to a cloud service. Recognition runs on your computer.

The speech worker can't open network sockets. VOCO's only network request asks
GitHub which releases exist, and you can turn the automatic check off.

### VOCO doesn't download or install updates

VOCO tells you when a new release exists. It never downloads or installs
anything. You upgrade with your package manager or the installer, when you
choose.

Nothing is downloaded after installation, the speech model included.

### VOCO doesn't save your audio or keep a history

In normal use, VOCO saves no audio and no transcript. A normal dictation leaves
nothing behind. VOCO keeps text only to protect you from losing it: while you
dictate, and in Review when a dictation was interrupted or couldn't be pasted or
copied. You discard Review entries yourself.

Audio is saved only in a developer test mode that needs three separate settings
turned on.

### VOCO doesn't listen in the background

VOCO listens only after you start it, and it shows that it's listening. It
never records while idle and never switches your microphone during a dictation.
On GNOME the system microphone indicator stays visible while VOCO records, and
VOCO never hides it.

### VOCO writes what you said, not what it thinks you meant

VOCO doesn't rewrite, summarise or polish your words. It changes recognised
words in only two ways, and both are yours to control: British or American
spelling, and the names and terms on your My words list. Spelling never changes
names or words whose spelling depends on meaning, and it never changes your
choice of words.

VOCO only adds text. It can't go back and correct words it has already pasted.

### No assistant, conversation or chat

VOCO is dictation. It doesn't answer questions, hold a conversation or act on
your behalf.

### No per-app behaviour

VOCO treats every app the same. It pastes into whichever window has keyboard
focus, and it doesn't detect terminals, browsers or other apps to change what it
does. There are no per-app settings.

That's also why, when it pastes, VOCO can't tell a password field from any other
field, so don't dictate into one. The optional Chromium extension, which writes
into one field itself, refuses password fields.

### No appearance settings

VOCO's settings are the microphone, the shortcut, English spelling, My words,
the update channel and whether VOCO checks for updates at startup. VOCO follows
your system's accessibility preferences, such as reduced motion, instead of
adding its own theme options.

### VOCO doesn't restore your clipboard

Each phrase goes through the clipboard, and the last one stays there. VOCO never
puts back what you copied before. Putting it back could overwrite something you
copied in the meantime.

### VOCO doesn't change your system beyond one rule

The package installs one udev rule, which lets the user of the active local
session type through VOCO's virtual keyboard. VOCO runs no daemon or service. It
never changes users, groups or other device permissions, and it never touches a
service someone else set up. Package scripts never enable GNOME extensions. The
guided installer turns the VOCO panel on; if you install the package another
way, you turn it on yourself.

VOCO also never quietly replaces a desktop shortcut you already have.

### One speech engine

VOCO ships one speech model, NVIDIA Nemotron English, and runs it on your
processor with no GPU. VOCO doesn't offer a choice of engines. The reasons
VOCO keeps this engine are recorded in a [public benchmark](../research/engine-benchmark-2026-10/README.md).

## Limits of VOCO today

### English only

VOCO recognises English only today. It writes British spelling unless you choose
American, or ask it to leave spelling as recognised.

### Dictation only, for now

Dictation is the first step. VOCO doesn't edit text or run commands by voice. A
new capability like those would first change VOCO's product rules, together
with its own safety rules, in a reviewed change before any code is written.
Until something ships, VOCO doesn't describe it as a feature.

### Supported systems

VOCO supports Ubuntu 24.04 and 26.04, Debian 13 and Fedora 44 on GNOME, on
64-bit Intel and AMD processors with AVX2, FMA and F16C. Recognition can't run
on a processor without those features. Debian 13 and Fedora 44 have not been
tested on a real desktop yet.

Other systems that meet the package dependencies may run VOCO, but nobody tests
them. On other Wayland desktops, such as KDE Plasma or Hyprland, you bind a key
to `voco --toggle` yourself, and other GNOME versions use the tray instead of the
VOCO panel.

### Sentence ends where you pause

The speech model writes a comma or full stop only once it hears the next word,
so where you pause between sentences, the full stop often comes a word late or
not at all, and the next sentence starts without a capital. VOCO doesn't end a
sentence where you pause: in a [measurement on public speech](../research/pause-sentence-ends-2026-10/README.md),
every way of doing that also ended sentences where people only paused to think,
and got more pauses wrong than it fixed.

### Apps that don't take Shift+Insert

VOCO pastes with Shift+Insert. Apps that remap that key, remote desktops and
virtual machines may not accept the paste, and VOCO can't tell whether a paste
landed.

### Exact browser fields in Chrome and Chromium only

The optional browser extension, which writes straight into one text field, is
for Google Chrome and Chromium. It skips password, one-time code and card
fields, rich text editors, fields inside frames, and incognito tabs. In other
browsers, VOCO pastes as it does in any app.

### Length and list limits

A dictation stops after 10 minutes. My words holds up to 100 entries of up to
four words, and VOCO keeps up to five taught versions of each.

## Asking for something new

If something you need isn't here, open an issue on GitHub and say what you were
trying to do. Requests that fit VOCO's principles, private, local and under your
control, are the easiest to take on.
