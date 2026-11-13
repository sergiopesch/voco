# Architecture

VOCO is a Linux desktop app for local English dictation. You press a shortcut,
speak, and VOCO pastes your words into the app that has keyboard focus while
you talk. Recognition runs on the CPU with NVIDIA Nemotron Speech Streaming
0.6B. Audio and text stay on the computer. The only network request is a
check for new releases.

The [code map](code-map.md) lists every source file.
[Platform support](../platform/README.md) covers desktops and helper programs,
and [Security](../security/README.md) covers trust boundaries and data handling.

## Components

| Component | Location | Role |
| --- | --- | --- |
| Desktop shell | `apps/desktop/src-tauri/src/` | Rust on Tauri 2. Wayland capture, shortcuts, tray, sockets, paste, configuration, crash journal and the speech worker process. |
| Renderer | `apps/desktop/src/` | React and TypeScript in WebKitGTK. Window, onboarding, settings, recording orchestration and X11 capture. |
| Speech worker | `runtime/speech/` | Python process with a C++ bridge to the native recognizer. One warm worker serves every recording. |
| Native runtime | `runtime/native/` | Pinned, patched build of NeMo-Speech.cpp and ggml for x86-64 with AVX2, FMA and F16C. |
| Virtual keyboard | `apps/desktop/src-tauri/src/virtual_keyboard.rs`, `packaging/udev/` | VOCO's own uinput keyboard sends the Wayland paste keys when the GNOME companion doesn't. The package's udev rule gives the user of the active local session access to `/dev/uinput`. |
| GNOME companion | `integrations/gnome/` | Optional extension for GNOME 46, 48, 50 and 51: panel pill, live meter, Stop, a shortcut grab and the paste keys on Wayland. |
| IBus engine | `apps/desktop/src-tauri/resources/`, `packaging/ibus/` | Optional input source that consumes the shortcut in IBus-aware fields. It never edits text. |
| Chromium extension | `integrations/chromium/` | Optional delivery into one plain text field of an enabled tab, through `voco-browser-host`. |
| Packages | `packaging/`, `scripts/package-nvidia.py`, `scripts/rpm_package.py` | One staged tree becomes the Debian package and the Fedora RPM, with the same files; see [Linux packaging](../linux-packaging.md). |

## Production path

```text
microphone
   |   Wayland: native capture through libpulse (Rust)
   |   X11:     WebKit capture through an AudioWorklet
   v
renderer: useDictation.ts -> dictationRecording.ts
   |   capture health, in-memory audio for the Stop tail, crash journal
   |   100 ms packets; Stop flushes the partial packet
   v
speech_stream.rs          Tauri command `speech_stream`; NDJSON over stdin/stdout
   v
runtime/speech worker     Nemotron Speech Streaming 0.6B Q8 on the CPU
   |   answers with the whole transcript when it changes, otherwise null
   v
dictationStream.ts        append-only: only the new suffix moves on
   |
   +--> insertion.rs      clipboard, then Shift+Insert into the focused app
   +--> browser broker    exact-field append in an enabled Chromium tab
```

### Capture

On Wayland, Rust records through libpulse from PipeWire's PulseAudio service
as 16-bit stereo at 44,100 Hz. A microphone choice names one source by its
PipeWire `object.serial`, which PulseAudio itself doesn't set, so under plain
PulseAudio VOCO lists every source as unavailable. Rust pumps the stream every
5 ms while recording. Capture ends with "Renderer drain lease expired" if the
renderer stops draining for 5 seconds, and only VOCO's main page may call it.
On X11 the renderer captures through WebKit with an AudioWorklet. If WebKit
offers only the ScriptProcessor fallback, VOCO can't confirm it receives every
sample, so it doesn't type that recording.

For WebKit capture, `captureHealth.ts` checks every 250 ms. It cancels the
recording if the track ends, stays muted by the system for 3 seconds, or
delivers no samples for 5 seconds. Both capture paths stop normally after 600
seconds. The renderer keeps the recording's samples in memory only to forward
the Stop tail, and clears them when the recording ends.

### Recognition

`speech_stream.rs` owns one worker process behind a mutex. It runs
`/usr/bin/python3 -E -s -B /usr/lib/voco/speech/stream_worker.py`, whose
interpreter and script `VOCO_STREAM_PYTHON` and `VOCO_STREAM_WORKER` can
override. The flags make Python ignore `PYTHON*` variables and your own
site-packages, and write no bytecode. Just before Python starts,
`worker_sandbox.rs` marks every descriptor beyond the worker's standard streams
close-on-exec and installs a seccomp filter: the worker can open no socket or
socket pair, not even a Unix one, and no io_uring. If any of that fails, the
worker doesn't start. The worker gets only the variables it reads (`ENVIRONMENT`
in `worker_sandbox.rs`), none of the session's bus, display or agent addresses;
the full-application test checks the running worker's environment and filter. The worker has 30 seconds to report ready and 10 seconds for each response, and a response line
may be at most 1 MiB. VOCO warms the worker at startup before it reports ready.
The runtime needs AVX2, FMA and F16C, so `processor.rs` reads the first
`flags` line of `/proc/cpuinfo` once. When one is missing, no worker starts:
startup notifies once, the tray and panel read **Processor not supported**, and
every start, the voice test and Say it included, is refused with the message
that names what's missing before a microphone opens. A file without a `flags`
line, or none at all, counts as capable, as in the installer.
A worker that died while idle is replaced at the next warmup or start, never
during a recording.

The worker loads `nemotron-speech-streaming-en-0.6b.q8_0.gguf` and rejects it
if its SHA-256 doesn't match the pinned value. That file is NVIDIA's GGUF plus
one metadata entry, `asr.tokenizer.spm_model`: the SentencePiece tokenizer from
NVIDIA's checkpoint, which NeMo-Speech.cpp needs to turn boost phrases into the
model's pieces ([runtime provisioning](../linux-packaging.md#runtime-provisioning)).
It streams with 560 ms of look-ahead: before it writes a word, it hears that
much of what follows. On VOCO's public speech fixtures that writes fewer wrong
words and takes about a third less CPU than 160 ms, for words that show about
0.1 s later ([2026.0.65](../releases/2026.0.65.md)). `VOCO_NEMOTRON_CONTEXT`
selects 0, 1 or 6 (80, 160 or 560 ms) for research, and any other value stops
the worker. The [engine benchmark](../../research/engine-benchmark-2026-10/README.md)
compares the steps.
The worker sets `NEMO_SPEECH_CPU_THREADS`
to one less than the CPUs it may run on, between 1 and 4. The default
digital-silence gate skips long runs of exact zeros but keeps 640 ms before
sound and 1.5 seconds after it.

`DictationStream` groups audio into packets of `round(rate × 0.1)` samples and
sends one request at a time. It accepts only results that extend the previous
one. If the recognizer revises earlier words, or falls more than three seconds
behind, recognition stops for that recording.

Each start carries `spelling`: `british`, `american` or `as-recognised`.
`speech_stream.rs` sets it from the saved settings, read without the writer lock
or a save, so the webview can't choose another; a start without one is as
recognised. `spelling.py` converts the whole hypothesis with
`spelling-varcon.tsv`, the unambiguous forms of VarCon 2020.12.07, about 3,200
each way. Only lowercase words convert, so names stay even at the start of a
sentence, as do code-like tokens and words whose spelling depends on meaning. A
push returns only text no later hypothesis can change: an open word goes out up
to the first letter where a table word starting with it is spelled differently.
The generator leaves out any conversion that would make one of the most common
words wait (`NEVER_HELD`), so "he", "must", "will", "a" and "call" never do;
British keeps "hemoglobin" and the other hem- words, "mustache" and "willful" as
recognised, and American keeps "aetiology" and "callisthenics".
Finish returns the converted final text, which extends every push, so
`DictationStream`'s append-only check still holds, and a converter fault would
stop the recording rather than paste a revision.
`test_spelling.py` replays the [engine benchmark](../../research/engine-benchmark-2026-10/README.md)'s
hypotheses to check that few words wait.

Each start also carries `words`, the saved My words list, and `heard`, its
taught versions, which `speech_stream.rs` reads the same way and filters to what
Settings could save.
`mywords.py` skips any entry that still breaks the list rules, so a
hand-edited config can't stop dictation, and of two entries that match alike
it writes the first one's spelling. With entries left,
`adapters.py` starts the stream through the C API's own recognition options with
one speech context: the phrases and a pinned boost. NeMo-Speech.cpp tokenizes
them with the model's embedded SentencePiece tokenizer and, during greedy
decoding, adds a bias to the pieces that continue a listed phrase. Without
entries the start goes through `bench_start` as before, so recognition is
unchanged. The worker then writes each listed occurrence as listed, comparing
words without case or accents and joining words the recognizer split, before
spelling, which never converts a listed occurrence. A taught version matches
the same way and writes its entry, or the one word of it it was taught for; it
is never boosted, and full stops never join its words. Of the versions a list
can't hold, a hand-edited one or one that matches an entry or an earlier
version, the worker skips each. A push holds back any tail
that later text could still turn into a listed term or a taught version, and
the open last word while it could grow into one; finish writes the final text,
which extends every push.

Say it, in setup's words step and on the My words page, records like setup's
voice test: the `words:check` trigger keeps its text in VOCO's window, with no
paste, copy or crash journal, and its start asks for `words_check`, which
`speech_stream.rs` turns into a start with the saved list and taught versions
but no spelling, so the window shows what the recognizer heard.
`useWordCheck.ts` ends the check once the level has shown speech and then
quiet, once the words stop changing, or after eight seconds, and the shortcut
ends it too. `judgeCheck` in `lib/myWords.ts` then reads the text: the entry as
listed, nothing, part of it, something it can't learn, or a version to teach,
which is the one misheard word of a longer entry unless that word is an
everyday one, then the whole entry. `everyday-words.txt`, which
`scripts/generate-everyday-words.py` generates from the pinned 12dicts files,
says which words are everyday; it loads in its own chunk on the first check.

### Delivery

Each chunk the stream delivers goes to `insertion.rs`, one paste at a time:

1. VOCO checks that the screen isn't locked, then the clipboard helper, plus
   `xdotool` on X11 or access to `/dev/uinput` on Wayland. On Wayland it then
   picks the keyboard: the GNOME companion's while it's attached and its loaded
   copy asks VOCO for work, otherwise its own virtual keyboard, which it makes sure
   exists, so a missing device fails before the clipboard changes.
2. ASCII control characters, including newlines and tabs, become spaces, so a
   terminal never receives Enter.
3. Unless VOCO saw the app read the previous paste, it waits until 150 ms have
   passed after that paste's keys, so the app can read the clipboard first.
4. It copies the text to CLIPBOARD, then PRIMARY. PRIMARY is best effort; a
   failure there only logs a warning. On GNOME Wayland the helpers are xclip in
   the foreground (`selection_owner.rs`), which report each request they answer
   and keep their selection until the next copy. There PRIMARY goes first, then
   CLIPBOARD, and VOCO waits up to 100 ms for Mutter's clipboard manager to read
   the new CLIPBOARD. A helper reports owning its selection just before the X
   server gets its request, and an app pasting before the server has it gets the
   previous copy. The manager reads through the server, so its read, answered by
   the new helper, shows CLIPBOARD has switched; PRIMARY, which nothing reads
   that way, has only its head start.
5. It waits up to 1.5 seconds for the shortcut's modifier keys to be released.
   On Wayland it reads evdev, or asks the GNOME companion with a `modifiers`
   request; unknown state doesn't block. On X11 VOCO's grab receives
   every key while the chord is held, so the paste waits for the release. It
   also waits while the X server reports Shift, Control, Alt, Super or AltGr
   held: the Shift of Shift+Insert would turn a shortcut someone is pressing,
   such as Super+X, into Super+Shift+X, which nothing takes for the shortcut.
6. It sends Shift+Insert: through the companion or the virtual keyboard on
   Wayland, and with `xdotool key --clearmodifiers` on X11. Toolkits paste CLIPBOARD and terminals
   paste PRIMARY.
7. On GNOME Wayland it waits up to 300 ms after the Insert press, which the
   keyboard that sent it reports, for the app to read the paste. Mutter's clipboard
   manager reads each new CLIPBOARD once, right after the copy. When that read
   came by the Insert press, the next request either helper answers after the
   press is the app's, and the next paste can copy at once. A read only says
   the app asked for the text, so it never changes the paste's outcome.

Spaces travel inside pastes, never at their edge, and VOCO never types them as
keys: Chromium's address bar strips the spaces around pasted text, and its
rich-text fields turn a space pasted alone into a no-break space. So the
stream ends each live paste between two graphemes without whitespace and holds
the rest, usually the last letter, for the next hypothesis: "Hello" pastes as
"Hell", then "Hello linux" adds "o linu". One `Intl.Segmenter` finds the
graphemes, so a paste never separates a letter from its combining marks or
splits a ZWJ sequence. So the last letter doesn't stay hidden through a pause,
the held text goes out on its own once 0.75 s of audio has brought no new words
(`QUIET_RELEASE_S`); on the public speech fixtures recognition adds words every
0.6 s or sooner about four times in five, so in 100 ms packets this waits 0.8 s, and counting
audio rather than time keeps it from firing while the worker is behind. The
release goes through `deliver()`, so it waits for a paste in flight, keeps a
trailing space for the next words and never fires after Stop or cancel. The
next words then begin with their space, which is pasted alone, as the address
bar keeps a paste of only whitespace; a rich-text field turns that one into a
no-break space. The final text, which nothing extends, goes out whole after
such a space. A browser field appends the words exactly, but a trailing space, which a
push has when spelling or My words holds back the open word after it, waits for
the words it joins. A delivery record marks `partial` a delivery that reached
only part of its hypothesis. VOCO never restores the previous clipboard.

`desktop_session.rs` follows the screen lock of the session VOCO started in,
through logind's `LockedHint`: it subscribes to the session's changes, then
reads the first value on the same main context. While logind doesn't answer, it
keeps trying, up to every 30 s. While the screen is locked, a paste
fails with no change, checked before the copy and again just before keys on
every route, and no shortcut starts dictation. When the screen locks during a dictation, VOCO
stops it and notifies "Dictation stopped"; words it couldn't type go to the
clipboard as after any Stop.

`virtual_keyboard.rs` keeps one uinput keyboard per process, "VOCO virtual
keyboard", with only Shift and Insert. VOCO creates it at startup in a
Wayland session: the compositor sees a new device only after udev and libinput
add it, so a device made for each paste could lose its first keys. A keyboard
created later waits until it is 500 ms old before its first key. Each key event
goes out in its own report, 12 ms after the one before. If the device stops
accepting keys, VOCO releases Shift and drops it, and the next paste creates a
new one. The evdev shortcut listener ignores the device by name, so its keys
never count as the shortcut or a held modifier. When VOCO exits, the kernel
removes the device and releases any key it still held.

On GNOME with the companion attached, the companion types the keys instead.
VOCO never calls the Shell, because a confined VOCO can't: snapd's `dbus` slot
lets a snap receive from unconfined peers, never send to them. So the companion
asks VOCO for work. It keeps one `com.sergiopesch.voco.Panel1.NextRequest` call
pending, and VOCO answers it with each paste, modifier check and change of
its state, in order, or with nothing after 20 seconds. The call stays on the
thread that serves the panel, because gio's invocations can't cross threads;
the paste thread hands it work through that thread's main context, and takes
back work no call has taken there, so withdrawn work can never still be typed.

The companion types with one Clutter virtual keyboard per enable, inside the
Shell, so there's no device to settle. It refuses while a modifier is held or
another paste is in flight, and says why with `PasteRefused`. Otherwise it sends
Shift, Insert and their releases, 12 ms apart, and reports the Insert press's
monotonic time with `PasteDone`, which VOCO reads as the press for step 7. VOCO
accepts a report only from the attached Shell and only for its open request, and
waits up to 1 second for it. GNOME disables the companion at the lock screen,
and disabling it mid-gesture releases any key it holds and reports the paste
cut short. Until the attached companion's first `NextRequest`, the `.deb` and
RPM keep VOCO's own keyboard. The screen lock and origin checks run on this route too.

A failed paste has one of three outcomes:

| Outcome | Meaning | Result |
| --- | --- | --- |
| No change | No keys were sent. A helper is missing, VOCO can't open `/dev/uinput` or create its keyboard, the modifiers stayed held, or the companion refused or went away. | The text stays pending for the next result. Stop retries it 3 times, 250 ms apart. |
| Rejected | VOCO refused before touching the clipboard. Paste is off, or the text is outside 1 to 100,000 bytes. | Typing stops for this recording. |
| Uncertain | A helper failed after it started, the virtual keyboard stopped accepting keys, or the companion didn't answer within 1 second or was disabled mid-gesture, so the clipboard or the app may already hold the text. | Typing stops, and VOCO never replays that text. |

When typing stops, VOCO notifies "VOCO stopped typing" and keeps listening.
Recognition runs through Stop, so the full transcript is still available.

### Stop

Stop flushes capture, forwards the retained samples the stream hasn't received,
sends the partial packet and asks the worker to finish. The AudioWorklet must
confirm its flush within 80 ms, or VOCO doesn't finish the recording. Then:

- If every word was typed, VOCO clears the audio and deletes the journal entry.
  When the text ends a sentence, it first pastes one space on its own after it,
  so the next dictation or typing starts apart. That paste carries no
  correlation, so the stream's delivery records and the quality report never see
  it; a trace says whether it went out, and a failed one changes nothing else.
- If words are left, VOCO copies them, what waited included, to CLIPBOARD and
  PRIMARY, and notifies "Dictation copied to clipboard" with a prompt to press
  Shift+Insert or Ctrl+V. After an uncertain paste it also warns that some
  words may already be in the app.
- If that copy fails too, the text moves to Review ("Dictation saved in
  Review").
- A recognition failure or a capture interruption copies nothing. VOCO notifies
  "Dictation interrupted" and asks you to check the text field.

## Shortcuts

Every route ends in `admit_toggle`, which ignores a second toggle within 120 ms.
One toggle that arrives before the renderer is ready is kept and applied once
it is.

| Route | When | Behaviour |
| --- | --- | --- |
| GNOME companion | GNOME 46, 48, 50 or 51 on Wayland with the companion attached | Shell grabs Super+X, Alt+D or Alt+Shift+D at every status and calls `Action('shortcut', '')`. The focused app never sees the chord. |
| Passive evdev | Wayland with Super+X, Alt+D or Alt+Shift+D | Reads keyboards in `/dev/input` and needs read access to them. A keyboard counts for a preset only when it has that chord's modifier, Shift if it names Shift, and letter; the chord matches with exactly its own modifiers held on any keyboard. The focused app also receives the chord. |
| X11 grab | X11, any valid shortcut | A root-window key grab consumes the chord and toggles on release, so the paste keys reach the app. |
| IBus engine | The VOCO Dictation input source is selected | Protocol 6. Consumes the chord in IBus-aware fields and changes no text. |
| `voco --toggle` | Any desktop binding | Connects once to the owner-only socket. The connection itself is the request. |

The companion holds a 2.5-second lease on the exact configured accelerator and
renews it about once a second. While the lease is fresh, evdev ignores the
chord. While the IBus engine holds its 1-second lease, evdev ignores the chord
and VOCO releases its X11 grab so the engine receives it. On Wayland, a shortcut
other than the three presets needs a desktop binding that runs `voco --toggle`.

The presets are `Preset` in `lib.rs`: Super+X, the default, then Alt+D and
Alt+Shift+D, in the tray's order. The companion and GNOME's keyboard shortcuts
consume only the letter of a chord, so the focused app still sees its modifier
pressed and released alone. For Alt that opens the menu bar in Firefox,
Thunderbird, LibreOffice and Electron editors, and the menu takes the
Shift+Insert pastes that follow; a lone Super opens nothing, and mutter doesn't
open the overview once it has seen the X. A saved shortcut is never migrated,
and an invalid one resets to `config::DEFAULT_HOTKEY`.
Shortcut status text comes from `shortcut_readiness.rs`.

## Tray and GNOME companion

The tray menu shows the status, then Open VOCO, Start dictation, Stop dictation,
Settings, Review, Change shortcut and Quit VOCO. `tray_icons.rs` writes the state
icons and 64 meter frames once, to paths that stay valid for the process
lifetime, and the meter advances every 90 ms. Each launch first removes the
icons an earlier VOCO left behind, since an exit leaves them in place. The tray
icon is an AppIndicator, which GNOME shows only through an AppIndicator
extension: Ubuntu turns one on, Debian 13 and Fedora 44 don't.

The companion loads on GNOME 46, 48, 50 and 51, the majors in its metadata, and
`voco_gnome_panel.py` reports any other as unsupported. GNOME Shell loads a copy
of the UUID in the user's data folder in place of the package's, so the helper
reports one that isn't the current version, with its folder, and leaves it to
the user to remove. From GNOME 50 there is
no X11 session and no `Meta.is_wayland_compositor()`, so the companion treats a
Shell without it as Wayland. A primary click on the pill stops or opens
Settings, and other buttons, Menu and Shift+F10 open the menu; from GNOME 50 the
panel button's click gesture leaves primary presses and touches to the pill.

The companion talks to `com.sergiopesch.voco.Panel1` on the session bus at
`/com/sergiopesch/voco/Panel`. The name sits under the maintainer's own domain,
as the Snap Store requires of the snap's `dbus` slot. A VOCO or companion from
before version 19 speaks only `org.voco.Panel`, so neither reaches the other: a
companion GNOME loaded before an upgrade stays detached until the next login.
`Attach` succeeds only for the current owner of `org.gnome.Shell` and hides the
tray. When the companion calls `Detach`, or stops calling `GetState` for more
than 5 seconds, VOCO drops the lease and shows the tray again. The companion
also asks VOCO for work with `NextRequest`, which VOCO answers with pastes,
modifier checks and state changes (see [Delivery](#delivery)).
The [GNOME companion guide](../../integrations/gnome/README.md) describes the
full interface.

## Crash recovery and Review

While you dictate, each new result updates a text-only journal in
`$XDG_STATE_HOME/voco/crash-recovery`, owner-only and bounded to 256 KiB per
entry. A normal finish deletes the entry. After an unexpected exit, the next
start moves the unfinished entry to Review, which keeps up to five entries and
evicts the oldest. Review opens only from VOCO's menu, in the tray or the GNOME
panel. It lets you copy or discard each transcript, and never pastes or retries
by itself. If the journal
can't be created, dictation continues and VOCO notifies you.

WebKit runs the window in a separate web process. If that process crashes,
VOCO loads the window again. Like any new page, the new renderer gets a new
epoch, the unfinished entry moves to Review, native capture is cancelled, the
Chromium exact-field session ends, and shortcuts wait until the renderer says it
is ready. If a dictation was running, VOCO notifies you. If the window crashes
again after three reloads in five minutes, VOCO leaves it closed, ends all of
that itself, and asks you to quit and open VOCO again.

## Configuration

Settings live in `$XDG_CONFIG_HOME/voco/config.json` with ten fields:
`hotkey` (default `Super+X`), `selectedMic`, `onboardingCompleted`,
`startAtLogin` (on until the user turns it off), `updateChannel` (`stable` or
`beta`), `automaticUpdateChecks`, `installChannel`,
`englishSpelling` (`british`, `american` or `as-recognised`, and `null`
until someone chooses, which spells British), `myWords`, the My words list,
empty until the user adds one, and `myWordsHeard`, its taught versions, each a
`heard` version and the entry or word it `writes`. A save checks the list
against the worker's rules: at most 100 entries of at most four words and 40
characters, letters and digits, each with up to three combining marks, with
single spaces, hyphens, apostrophes and full stops, and no two that match
alike. It checks the versions too: each writes an
entry or one of its words, has the same limits without full stops, matches no
entry or other version, and an entry keeps at most five. The versions have their
own key, so an earlier VOCO still reads the file. Fields that older
files carry are ignored and dropped at the next save, while a settings update
that names an unknown field is refused. The directory is 0700 and the file
0600, written atomically. Each save writes the same settings to
`config.json.last`, keeping any that a later VOCO left there, and a start
rewrites it when it is missing or older than `config.json`. An earlier VOCO rewrites `config.json` without the fields
it doesn't know, so a load takes them back from that copy, unless a Reset, by
this VOCO or an earlier one, renamed the file after the copy was saved; that copy
is then deleted. Restored
taught versions that clash with the list are dropped. If the file doesn't
exist, VOCO copies `$XDG_CONFIG_HOME/voice/config.json` when present. When the
file can't be read, the recovery panel offers Retry, Open and Reset, and the
copy never replaces it. Only Reset keeps a backup copy, and it deletes
`config.json.last` and the backups of earlier resets.

## Start at login

`login_start.rs` keeps one XDG autostart entry, `voco-login.desktop`, in
`$XDG_CONFIG_HOME/autostart`: present while `startAtLogin` is on and
`onboardingCompleted` is true, absent otherwise. It runs `voco` with no
arguments, with `TryExec=voco`, so a session skips it once the package is
removed. Only the packages' `/usr/bin/voco` and the snap keep one;
`login_start_available` tells the renderer, which otherwise hides the switch
and doesn't say at setup's end that VOCO starts at login. A source build's
entry would start the packaged VOCO, or nothing.

Rust brings the entry in step at startup, on a thread that takes the
configuration lock, and after every committed write. It rewrites nothing that
is already right, removes only its own file name, and touches the entry only
when it is a regular file the user owns. A patch that changes `startAtLogin`
changes the entry before the save and fails without saving when it can't, and
puts the entry back if the save then fails. Any other write, such as setup's
completion, only warns on a failure, so a broken autostart folder never blocks
setup; the next start tries again.

In the snap `XDG_CONFIG_HOME` is `$SNAP_USER_DATA/.config`, and the recipe's
`autostart: voco-login.desktop` app key tells snapd's session agent to start
the app from that entry; snapd ignores the program in `Exec` and keeps its
arguments, of which there are none. A login start is never a launcher click
(`activation.rs`): the entry isn't `VOCO.desktop` and lives in an `autostart`
folder, so VOCO stays in the tray.

## Update checks

After startup, and when you change the update channel, the renderer reuses
an answer younger than 6 hours from `update-cache.json`, which Rust reads and
writes. Otherwise it asks the GitHub releases API for the 12 newest releases,
with a 15-second timeout. Both of those automatic checks happen only while
`automaticUpdateChecks` is on: with **Only when I choose**, neither runs, and
turning automatic checks back on checks at once. **Check for updates** in
Settings always asks. The check only tells you a release exists. In
the snap the Snap Store updates VOCO, so `store_updates` tells the renderer to
check nothing, and Settings shows only the installed version.

## Install update

`update_install.rs` owns Install update; the renderer only shows its stages.
`update_install_availability` offers it only where `/usr/bin/voco` is running
outside the snap and APT or DNF is present. `install_update` takes the version
the check found, refuses one that isn't newer than this build, and refuses
while the tray state says dictation is starting, recording or processing. One
install runs at a time, on its own thread, and reports each stage through
`voco:update-install` events: `downloading` (file, bytes and size),
`verifying`, `authorizing`, `installing`, `installed`, `restarting`,
`cancelled` or `failed` with the reason.

`update_download.rs` fetches the three assets with libsoup, the HTTP client
WebKit already links, following redirects by hand (`allowed_redirect`), with a
30-second idle timeout and size limits, into `$XDG_STATE_HOME/voco/update/`.
`cancel_update_install` cancels the `gio::Cancellable` under a waiting read,
and only until the download ends. `update_verify.rs` holds the checks shared
with the root helper: the `gpgv` signature by the release key's fingerprint,
the signed manifest, the SHA-256 and the package's identity.

`speech_stream` passes every recognition `start` through a gate in
`update_install.rs`, which remembers the open session until its `finish` or
`cancel`. After verifying, VOCO closes the gate unless the tray reports
dictation or a session started in the last 5 seconds (the renderer's report can
lag its start), so from the password prompt until VOCO exits no recognition
starts; a failure opens it again. Rust also keeps the last stage it reported,
which `update_install_status` returns, so the Updates page shows a running or
ended install when it opens again, until **Close** calls
`dismiss_update_install`. Then VOCO runs
`pkexec /usr/libexec/voco-update-helper <folder> <version>`. The helper
(`src/bin/voco-update-helper.rs`, built with the `update-helper` feature)
prints `VOCO-UPDATE` stage lines, which VOCO reads, and exits 10 when it
refuses, 11 when the package manager fails and 12 when the package manager
then reports another version; pkexec exits 126 when the prompt is dismissed and
127 when the action isn't allowed. [Security](../security/README.md#install-update)
lists what the helper checks. After a successful install, VOCO waits for any
dictation to end, then starts a detached shell in a new session that waits up to
10 seconds for this process to exit and runs `/usr/bin/voco`, and exits. The
instance lock goes with the old process, so the new one starts rather than
presenting the old.

## The snap

`confinement.rs` knows VOCO runs as its snap when snapd names it `voco`
(`SNAP_NAME`). At a clean exit its `end_clipboard_helpers` kills the xclip
processes still in this run's snapd scope (`snap.voco.voco-<id>.scope` in
`/proc/<pid>/cgroup`), because snapd holds a store refresh back while any
process of the app lives. Strict confinement gives it no `/dev/uinput`, `/dev/input`,
IBus engine, systemd user manager or network, so the snap skips what needs
them: the virtual keyboard, passive evdev, the IBus listener, the retired
`voco-ydotoold.service` and the update check. On GNOME Wayland the companion
types for it once it asks for work; otherwise GNOME's RemoteDesktop portal does.

`portal.rs` runs one thread with a private main context for every portal
request, session and signal, so neither GNOME's answer nor the person answering
GNOME's dialog ever blocks GTK's thread. `portal_keys.rs` opens a keyboard-only
RemoteDesktop session with `persist_mode` 2. Setup's **Allow typing** opens the
first one without a restore token, which shows GNOME's dialog, and saves the
token GNOME returns in `remote-desktop-token` beside the config, owner-only;
each later Start returns a new one, which replaces it. The renderer calls
`begin_desktop_typing` when a desktop dictation starts, which opens a session
from the token in the background (8–90 ms on GNOME 50), and
`update_runtime_status` closes it when the dictation status returns to idle,
after Stop's last paste and space; the lock watch, a replaced renderer and exit
close it too. GNOME
shows its orange remote-access icon while a session exists. Its Stop closes the
session: the `Closed` signal clears it and sends the tray's stop request, so the
dictation ends as Stop does and copies the rest. A paste sends Shift, Insert
and their releases; one before the session has started waits up to 400 ms, then
typed nothing.

On GNOME 48 and later, which `gnome_has_shortcut_portal` tells by the
GlobalShortcuts portal that came with it, `open_typing` then calls
`ConnectToEIS` on the session, and `portal_eis.rs` follows the socket GNOME
returns on its own thread, with the `reis` crate's implementation of libei's
protocol: it connects as a sender, binds the seat's keyboard and waits for
GNOME to resume the device, about 10 ms. The paste keys then go out on that
socket, each with its frame, between `start_emulating` and `stop_emulating`.
Before Insert it reads the reported modifiers again, and when one other than
its own Shift is down it releases Shift and returns `HeldBack`:
`paste_transaction` keeps that `no-mutation`, where any other failure at the
keys is uncertain, so the text stays pending.
From GNOME 50 the same socket carries `ei_keyboard.modifiers` whenever the
seat's modifier state changes, from any keyboard, so `modifiers_held` knows
whether Shift, Control, Alt, Super or AltGr is down, and the paste's modifier
wait uses that in place of the timing of the shortcut's calls. GNOME 50 sends the first
such event as it resumes the keyboard, and VOCO types through the connection
only once it has one. GNOME 46 sends none, so there, and wherever the
connection is refused, its keyboard isn't ready within 2 s or no report has
come 300 ms after that, the session types with `NotifyKeyboardKeycode` and the
timing of the shortcut's calls says how long to wait for its keys. A session that has connected no
longer accepts those calls, so `open_typing` closes it and opens a plain one,
and the process doesn't ask again.

`gnome_shortcut.rs` keeps the snap's shortcut as VOCO's own entry in GNOME's
custom keyboard shortcuts, which `gnome_custom_shortcut.rs` reads and writes
through GSettings: GNOME's media keys daemon grabs the keys in the Shell and
runs the entry's command. Nothing asks the person, so setup's last screen
calls `hold_gnome_shortcut` by itself, and `persist_config_patch` calls
`keep_in_step` before it applies a changed shortcut, from Settings, the tray
or setup: the entry is added or moved first, and GNOME's keys being taken, by
one of its window shortcuts or another custom shortcut, refuses the save.
`shortcut_chord.rs` spells a shortcut for GTK (`<Control><Alt>d`) by its key's
X keysym and reads GNOME's keys back into VOCO's spelling; `setup` watches the
entry's keys and, once setup is complete, saves a change made in GNOME
Settings as VOCO's shortcut. `hold` notes beside the config, in
`gnome-shortcut`, that VOCO added its entry, and a start adds none after that.
Where setup is complete and neither the note nor the entry exists, an earlier
VOCO's setup finished without the shortcut or held it through GNOME's
GlobalShortcuts portal, and `add_once` adds it at that start.

The entry's command calls `Toggle` on VOCO's bus name with `dbus-send`, for
the press and for each repeat GNOME makes while the chord is held, about every
30 ms after the keyboard's repeat delay. `panel.rs` hands each call to
`note_bus_press`. GNOME reports no release of either key, so `is_repeat` tells
a repeat by its timing: the first within 100 ms of the repeat delay after a
press, the rest sooner than that after the last. `bus_press` first asks
`portal_keys::modifiers_lifted_since`: while a dictation's typing session is
open, GNOME's keyboard connection says from GNOME 50 whether every modifier
was up since the last call, and a chord pressed after that is a new press
whatever its timing. A press toggles through
`eval_toggle_with_backend(…, "gnome_shortcut")` on GTK's thread. For a paste,
`modifiers_held` answers where GNOME reports the modifiers; elsewhere
`bus_held` keeps it waiting the repeat delay plus 400 ms after the last call,
and the paste's usual 1.5 s wait sends no keys while the chord counts as held:
keys under Super or Alt make another chord and paste nothing. Where the call
fails the command runs `voco --toggle`, and `note_command_press` treats one
within the repeat delay plus 400 ms of the last as a repeat, since each is a
snap launch that can arrive late; a paste waits as long after the last.

`voco --check-desktop-input` and `--check-panel` run apart from the VOCO the
companion works for, so they ask it with `CompanionAsking`, which answers any
caller; the portal path is ready when the token is saved. Until it is, setup
shows the portal step (`setupArea` `portal`); on other Wayland desktops, it
names the `.deb` or RPM instead. X11 sessions keep `xdotool` and `xclip`.

logind's session signals don't reach a snap, because `login-session-observe`
passes only the manager's, and `GetSessionByPID` is out of its reach. So the
snap binds the session it started in by `XDG_SESSION_ID`, or as the user's one
graphical login, and reads `LockedHint` once a second instead of following it.
It checks the session before the copy and before the keys on X11 too. Before
`login-session-observe` is connected, logind answers it with `AccessDenied`:
unlike a logind that doesn't answer, which leaves pasting allowed, a refusal
refuses each paste and the paste check, which names the `snap connect`
command. Until logind answers without refusing, each paste check finds out
again: it asks `snapctl` whether `login-session-observe` is connected, and logind
only once it is, so a refusal logs no AppArmor denial at each poll. So
`voco --check-desktop-input` sees the refusal, and a plug connected a moment
ago counts at once.

Until the store auto-connects `login-session-observe` and `audio-record`, a user
connects them. So before each recording, the voice test and Say it included, the snap
asks `snapctl is-connected audio-record` (`microphone_access`): while the plug
isn't connected, the recording fails before any microphone opens and names
`snap connect voco:audio-record`. A `snapctl` that can't answer leaves the
capture to report its own failure. Native capture asks the same before it
connects to PipeWire, which settles what a snap may record when it connects:
a connection opened before the plug was connected would record only silence
until VOCO restarted. So the snap lists no microphones until the plug is
connected, then connects, and the next recording works without a restart.
WebKit, which captures on X11, lists its microphones once, through its own
PipeWire connection, so there a plug connected after VOCO started needs a
restart. Its remedy says to quit and reopen VOCO after `snap connect`, and a
plug connected since startup is refused with "Quit VOCO and open it again" until
VOCO restarts. The microphone test and the access retry ask the same before
they open a microphone.

The snap can't ask GNOME Shell about extensions, nor enable one, so
`panel_setup.rs` reports its companion active once it asks for work, and
otherwise `optional`, with `COMPANION_PAGE`, its page on extensions.gnome.org,
which Help offers; setup never asks for it.
snapd installs the snap's desktop entry as `voco_voco.desktop`, which
`activation.rs` counts as VOCO's launcher in the snap only.

## Logs

`RUST_LOG` controls stderr logging. Two opt-in logs write metadata only, with no
dictated text, audio or window titles:

- `VOCO_PERFORMANCE_LOG=1` writes `$XDG_STATE_HOME/voco/performance/performance.jsonl`
  (8 MiB, then one previous file), and the worker writes
  `$XDG_STATE_HOME/voco/stream-performance/worker.jsonl` (8 MiB, three backups).
- `VOCO_HOTKEY_TRACE=1` writes `$XDG_STATE_HOME/voco/hotkey-trace.jsonl`
  (8 MiB, then one previous file).

With both off, the renderer sends no dictation traces or delivery quality
records.

## Design decisions

- **Tauri.** Rust holds OS authority (processes, sockets, files, D-Bus), while
  the interface stays a small web app in the system WebKitGTK.
- **Local CPU Nemotron.** Dictation works offline and needs no account or GPU.
  The worker stays loaded between recordings, so a recording starts without
  loading the model. The cost is an x86-64 floor with AVX2, FMA and F16C.
- **Paste instead of typed keys.** One Shift+Insert works across GTK, Qt,
  Chromium, Firefox, Electron and terminals, for any Unicode text. Control
  characters become spaces, so VOCO never submits a form or command.
- **VOCO's own virtual keyboard on Wayland.** A two-key uinput device in the
  app needs no daemon, socket or service, and the package's `uaccess` rule
  limits `/dev/uinput` to the user of the active local session, without a group.
- **The companion's keys on GNOME.** Typing inside the Shell needs no device to
  settle, no portal dialog and no screen-sharing indicator. CI's companion suite
  holds it within 1 ms of Mutter's RemoteDesktop API at the median and 2 ms at
  the 99th percentile. VOCO keeps its own keyboard for other Wayland sessions
  and whenever the companion isn't attached.
- **xclip on GNOME's XWayland.** GNOME lacks the wlroots data-control protocol,
  and `wl-copy`'s temporary focus surface can stall under focus-stealing
  prevention. XWayland bridges the clipboard without a focus-taking surface, so
  on GNOME with a `DISPLAY` VOCO sets both selections through xclip. Keys still
  go through the companion or VOCO's virtual keyboard.
- **No focus probe or per-app routing.** Each chunk goes to whatever has focus
  when it is ready. One path for every app is simpler to reason about than
  guessing a destination.
- **Explicit Review.** Recovered text may already be partly in an app, so VOCO
  never opens, pastes or retries it for you.
