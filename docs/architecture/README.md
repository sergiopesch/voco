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
| Virtual keyboard | `apps/desktop/src-tauri/src/virtual_keyboard.rs`, `packaging/udev/` | VOCO's own uinput keyboard sends the Wayland paste keys. The package's udev rule gives the user of the active local session access to `/dev/uinput`. |
| GNOME companion | `integrations/gnome/` | Optional extension for GNOME 46, 48 and 50: panel pill, live meter, Stop and a shortcut grab on Wayland. |
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
PulseAudio VOCO lists every source as unavailable. It pumps the stream every
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
`/usr/bin/python3 /usr/lib/voco/speech/stream_worker.py`, which
`VOCO_STREAM_PYTHON` and `VOCO_STREAM_WORKER` can override. The worker has 30
seconds to report ready and 10 seconds for each response, and a response line
may be at most 1 MiB. VOCO warms the worker at startup before it reports ready.
A worker that died while idle is replaced at the next warmup or start, never
during a recording.

The worker loads `nemotron-speech-streaming-en-0.6b.q8_0.gguf` and rejects it
if its SHA-256 doesn't match the pinned value. It sets `NEMO_SPEECH_CPU_THREADS`
to one less than the CPUs it may run on, between 1 and 4. The default
digital-silence gate skips long runs of exact zeros but keeps 640 ms before
sound and 1.5 seconds after it.

`DictationStream` groups audio into packets of `round(rate × 0.1)` samples and
sends one request at a time. It accepts only results that extend the previous
one. If the recognizer revises earlier words, or falls more than three seconds
behind, recognition stops for that recording.

### Delivery

Each new suffix goes to `insertion.rs`, one paste at a time:

1. VOCO checks the clipboard helper, plus `xdotool` on X11 or access to
   `/dev/uinput` on Wayland. On Wayland it also makes sure its virtual keyboard
   exists, so a missing device fails before the clipboard changes.
2. ASCII control characters, including newlines and tabs, become spaces, so a
   terminal never receives Enter.
3. It waits until 150 ms have passed after the previous paste, so that app can
   read the clipboard first.
4. It copies the text to CLIPBOARD, then PRIMARY. PRIMARY is best effort; a
   failure there only logs a warning.
5. It waits up to 1.5 seconds for the shortcut's modifier keys to be released.
   On Wayland it reads evdev, or asks the GNOME companion through
   `ModifiersClear`; unknown state doesn't block. On X11 VOCO's grab receives
   every key while the chord is held, so the paste waits for the release.
6. It sends Shift+Insert, through the virtual keyboard on Wayland and with
   `xdotool key --clearmodifiers` on X11. Toolkits paste CLIPBOARD and terminals
   paste PRIMARY.

When a suffix starts with VOCO's single joining space, that space goes out as
its own Space key before Shift+Insert, because Chromium's address bar strips
pasted leading whitespace. VOCO never restores the previous clipboard.

`virtual_keyboard.rs` keeps one uinput keyboard per process, "VOCO virtual
keyboard", with only Shift, Insert and Space. VOCO creates it at startup in a
Wayland session: the compositor sees a new device only after udev and libinput
add it, so a device made for each paste could lose its first keys. A keyboard
created later waits until it is 500 ms old before its first key. Each key event
goes out in its own report, 12 ms after the one before. If the device stops
accepting keys, VOCO releases Shift and drops it, and the next paste creates a
new one. The evdev shortcut listener ignores the device by name, so its keys
never count as the shortcut or a held modifier. When VOCO exits, the kernel
removes the device and releases any key it still held.

A failed paste has one of three outcomes:

| Outcome | Meaning | Result |
| --- | --- | --- |
| No change | No keys were sent. A helper is missing, VOCO can't open `/dev/uinput` or create its keyboard, or the modifiers stayed held. | The text stays pending for the next result. Stop retries it 3 times, 250 ms apart. |
| Rejected | VOCO refused before touching the clipboard. Paste is off, or the text is outside 1 to 100,000 bytes. | Typing stops for this recording. |
| Uncertain | A helper failed after it started, or the virtual keyboard stopped accepting keys, so the clipboard or the app may already hold the text. | Typing stops, and VOCO never replays that text. |

When typing stops, VOCO notifies "VOCO stopped typing" and keeps listening.
Recognition runs through Stop, so the full transcript is still available.

### Stop

Stop flushes capture, forwards the retained samples the stream hasn't received,
sends the partial packet and asks the worker to finish. The AudioWorklet must
confirm its flush within 80 ms, or VOCO doesn't finish the recording. Then:

- If every word was typed, VOCO clears the audio and deletes the journal entry.
- If words are left, VOCO copies them, joining space included, to CLIPBOARD and
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
| GNOME companion | GNOME 46, 48 or 50 on Wayland with the companion attached | Shell grabs Alt+D or Alt+Shift+D at every status and calls `Action('shortcut', '')`. The focused app never sees the chord. |
| Passive evdev | Wayland with Alt+D or Alt+Shift+D | Reads keyboards in `/dev/input` and needs read access to them. The focused app also receives the chord. |
| X11 grab | X11, any valid shortcut | A root-window key grab consumes the chord and toggles on release, so the paste keys reach the app. |
| IBus engine | The VOCO Dictation input source is selected | Protocol 6. Consumes the chord in IBus-aware fields and changes no text. |
| `voco --toggle` | Any desktop binding | Connects once to the owner-only socket. The connection itself is the request. |

The companion holds a 2.5-second lease on the exact configured accelerator and
renews it about once a second. While the lease is fresh, evdev ignores the
chord. While the IBus engine holds its 1-second lease, evdev ignores the chord
and VOCO releases its X11 grab so the engine receives it. On Wayland, a shortcut
other than the two presets needs a desktop binding that runs `voco --toggle`.
Shortcut status text comes from `shortcut_readiness.rs`.

## Tray and GNOME companion

The tray menu shows the status, then Open VOCO, Start dictation, Stop dictation,
Settings, Review, Change shortcut and Quit VOCO. `tray_icons.rs` writes the state
icons and 64 meter frames once, to paths that stay valid for the process
lifetime, and the meter advances every 90 ms. Each launch first removes the
icons an earlier VOCO left behind, since an exit leaves them in place. The tray
icon is an AppIndicator, which GNOME shows only through an AppIndicator
extension: Ubuntu turns one on, Debian 13 and Fedora 44 don't.

The companion loads on GNOME 46, 48 and 50, the majors in its metadata, and
`voco_gnome_panel.py` reports any other as unsupported. GNOME 50 has no X11
session and no `Meta.is_wayland_compositor()`, so the companion treats a Shell
without it as Wayland. A primary click on the pill stops or opens Settings, and
other buttons, Menu and Shift+F10 open the menu; on GNOME 50 the panel button's
click gesture leaves primary presses and touches to the pill.

The companion talks to `org.voco.Panel1` on the session bus at `/org/voco/Panel`.
`Attach` succeeds only for the current owner of `org.gnome.Shell` and hides the
tray. When the companion calls `Detach`, or stops calling `GetState` for more
than 5 seconds, VOCO drops the lease and shows the tray again. When evdev can't
read the keyboards, VOCO calls back into the companion's
`org.voco.PanelInput1.ModifiersClear` before a Wayland paste.
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

## Configuration

Settings live in `$XDG_CONFIG_HOME/voco/config.json` with five fields:
`hotkey` (default `Alt+D`), `selectedMic`, `onboardingCompleted`,
`updateChannel` (`stable` or `beta`) and `installChannel`. Fields that older
files carry are ignored and dropped at the next save, while a settings update
that names an unknown field is refused. The directory is 0700 and the file
0600, written atomically. If the file doesn't exist, VOCO copies
`$XDG_CONFIG_HOME/voice/config.json` when present. When the file can't be read,
the recovery panel offers Retry, Open and Reset; only Reset keeps a backup copy.

## Update checks

After startup, and when you change the update channel, the renderer reuses
an answer younger than 6 hours from `update-cache.json`, which Rust reads and
writes. Otherwise it asks the GitHub releases API for the 12 newest releases,
with a 15-second timeout. **Check for updates** in Settings always asks. VOCO
only tells you a release exists; it never downloads or installs anything.

## Logs

`RUST_LOG` controls stderr logging. Two opt-in logs write metadata only, with no
dictated text, audio or window titles:

- `VOCO_PERFORMANCE_LOG=1` writes `$XDG_STATE_HOME/voco/performance/performance.jsonl`
  (8 MiB, then one previous file), and the worker writes
  `$XDG_STATE_HOME/voco/stream-performance/worker.jsonl` (8 MiB, three backups).
- `VOCO_HOTKEY_TRACE=1` writes `$XDG_STATE_HOME/voco/hotkey-trace.jsonl`
  (8 MiB, then one previous file).

## Design decisions

- **Tauri.** Rust holds OS authority (processes, sockets, files, D-Bus), while
  the interface stays a small web app in the system WebKitGTK.
- **Local CPU Nemotron.** Dictation works offline and needs no account or GPU.
  The worker stays loaded between recordings, so a recording starts without
  loading the model. The cost is an x86-64 floor with AVX2, FMA and F16C.
- **Paste instead of typed keys.** One Shift+Insert works across GTK, Qt,
  Chromium, Firefox, Electron and terminals, for any Unicode text. Control
  characters become spaces, so VOCO never submits a form or command.
- **VOCO's own virtual keyboard on Wayland.** A three-key uinput device in the
  app needs no daemon, socket or service, and the package's `uaccess` rule
  limits `/dev/uinput` to the user of the active local session, without a group.
- **xclip on GNOME's XWayland.** GNOME lacks the wlroots data-control protocol,
  and `wl-copy`'s temporary focus surface can stall under focus-stealing
  prevention. XWayland bridges the clipboard without a focus-taking surface, so
  on GNOME with a `DISPLAY` VOCO sets both selections through xclip. Keys still
  go through VOCO's virtual keyboard.
- **No focus probe or per-app routing.** Each chunk goes to whatever has focus
  when it is ready. One path for every app is simpler to reason about than
  guessing a destination.
- **Explicit Review.** Recovered text may already be partly in an app, so VOCO
  never opens, pastes or retries it for you.
