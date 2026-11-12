# VOCO agent guide

VOCO is building the voice layer for Linux, and dictation is the first step: press
a shortcut, speak, and the words are pasted into whichever app has keyboard focus. This guide is for coding agents
and maintainers. Before changing code, read the [README](README.md), the
[architecture overview](docs/architecture/README.md) and the
[code map](docs/architecture/code-map.md). [CONTRIBUTING](CONTRIBUTING.md) covers
setup and pull requests.

## Product contract

- Direction: the voice layer for Linux, private, local and under the user's
  control ([branding](docs/branding.md)). The rest of this contract is today's
  product, dictation. A capability beyond it, such as voice editing or commands,
  first changes this contract in its own reviewed pull request, with its safety
  rules, before any code.
- No account, subscription, telemetry or cloud transcription. Update checks read
  GitHub's public releases API and download nothing. The automatic check at
  startup has an off switch. Only **Install update**, which the user chooses,
  downloads: the newer release's package for this installation and its signed
  checksums, from that release on GitHub. VOCO installs it only after the
  signature verifies with its release key and the package's SHA-256 matches,
  through the system package manager, after the system's own password prompt,
  and then restarts itself. It never updates on its own. The snap has no
  network access at all: the Snap Store updates it, so it never checks.
- One output path: streaming dictation pasted into whatever has keyboard focus.
  The optional Chromium exact field uses the same recognizer with its own delivery.
- No assistant, conversation, enhancement, appearance or per-app settings.
- English spelling and My words are the only changes to recognized words.
  Spelling writes British (the default) or American spelling for VarCon's
  unambiguous forms only, or leaves words as recognized. It never changes names,
  words whose spelling depends on meaning, or word choice.
- My words is the user's list of up to 100 names and terms, each at most four
  words. The recognizer leans toward the listed words, and the worker writes
  each occurrence the way it is listed, matching without case, accents, or the
  spaces and hyphens inside a term. Spelling never converts a listed word. An
  empty list leaves recognition exactly as it is without the feature.
- Say it checks one entry: VOCO listens once and shows, in its own window only,
  what it heard. When it heard the entry wrong, the user can teach VOCO that
  version, without the punctuation around it: up to five for each entry, each at
  most four words and 40 characters of letters, digits, apostrophes, single
  spaces and hyphens. A version never spans a pause's comma, which the worker
  doesn't match across; VOCO asks the user to say it again instead. Whichever is
  saved second, a version that matches an entry or another version, or an entry
  that matches a version, is refused before it is saved, so no text has two
  spellings. The worker then writes the entry, or the one word of it VOCO
  misheard, wherever the recognizer writes a taught version, matching it as it
  matches the entry. Taught versions are never boosted, and VOCO warns before
  teaching one made only of everyday words, which it would then change whenever
  the user says them. The list and its taught versions stay in the owner-only
  config and never reach logs, metrics, the crash journal or Review.
- Tray first. Respect system accessibility preferences such as reduced motion.
  A click on VOCO's launcher opens the popover whether or not VOCO was running:
  `activation.rs` counts a start as a launcher click only when GIO names
  `VOCO.desktop` and this process, and reads that before GTK removes
  `DESKTOP_AUTOSTART_ID`. A start from a terminal or a login autostart stays in
  the tray. The desktop entry keeps `StartupNotify=false`: a tray start shows no
  window, so it can't complete a launcher's startup sequence, and GNOME would
  show its busy cursor until a 15 s timeout.
- Settings are the microphone, the shortcut, English spelling, My words with
  its taught versions, whether VOCO starts at login, the update channel and
  whether VOCO checks for updates at startup. Onboarding state and the
  installation method are stored alongside them. The snap has no update
  settings.
- VOCO starts at login unless the user turns it off, and only once setup is
  complete. It keeps one XDG autostart entry in `$XDG_CONFIG_HOME/autostart` in
  step with that setting, with `TryExec` so a removed package leaves no failing
  entry. In the snap `XDG_CONFIG_HOME` is the snap's own folder, where snapd's
  `autostart:` app key finds the entry. A login start stays in the tray.
- A normal session keeps nothing. Review only holds text that survived a crash, or
  that a Stop could neither paste nor copy.

## Architecture

The production path is `runtime/speech/` → Rust `speech_stream.rs` →
`dictationStream.ts` → `insertion.rs`. The recognizer is NVIDIA Nemotron English 0.6B Q8 on the CPU.
The default worker count is at most four threads and leaves one CPU of the process
affinity free for the desktop (minimum one); keep explicit research overrides and
record the actual count. Desktop and Chromium exact-field dictation share this
recognizer; browser field ownership is a delivery concern.

Rust owns OS integration, files, processes, the tray, packaging and validation.
React owns presentation and recording orchestration. Keep both typed and
state-driven. Comment invariants and non-obvious decisions; don't narrate lines.

Capture is native Pulse/PipeWire on Wayland and a WebKit AudioWorklet on X11
(`VOCO_DEV_NATIVE_CAPTURE=1` selects native capture for development). A hidden
window really hides with native capture; WebKit capture needs a mapped webview, so
its hidden surface is a 1 px window off-screen.

Development and CI use Node 24 LTS (`.nvmrc`) and the Rust toolchain named by
`rust-version` in `Cargo.toml`; `scripts/check-devops.sh` fails if CI's toolchain
differs. `.editorconfig` sets the formatting basics. Keep Vite 8 and the React plugin 6
together, keep explicit output targets, and keep root renderer fixtures on the
desktop's Vite resolution. Check both dev rendering and packaged WebKit.

The config (`config.rs`) holds the shortcut (`DEFAULT_HOTKEY`, Super+X, until
the user saves another), the microphone, English spelling
(null until someone chooses; dictation then spells British), My words and its
taught versions (empty until the user adds one), onboarding state, whether
VOCO starts at login (on until the user turns it off), the update channel, the
startup update check and the installation method. Retired keys are ignored on read
and dropped on the next save, and patches that name them are rejected. Retired
package channels read as GitHub Release. Each save also writes `config.json.last`,
keeping the keys a later VOCO left in it, and a start rewrites it when it is
missing or older than the config. An earlier VOCO rewrites the config without the keys it doesn't know, so
a load restores them from that copy, unless a Reset by any version renamed the
config after the copy was saved (a backup's name carries the time of its reset);
that copy is then deleted.
Restored taught versions that clash with the list are dropped, and only their
count is logged. VOCO never overwrites a config it cannot read, nor repairs one
from the copy: Settings shows a recovery panel, and only Reset renames the file
to a `config.recovery-backup-*` copy before writing defaults. Reset also deletes
`config.json.last` and the backups of earlier resets. The snap keeps its portal
restore token and its record of a bound shortcut beside the config, owner-only;
Reset deletes both, and setup then asks GNOME again.

VOCO vendors narrow patches ([vendor/README.md](vendor/README.md)): glib 0.18.5
with the exact upstream RUSTSEC-2024-0429 fix ([backport](vendor/glib/VOCO-PATCH.md)),
global-hotkey and tray-icon. Keep every GTK/WebKit consumer on the single
patched glib; adding glib 0.20 directly leaves GTK behind. Verify source
provenance and the optimized iterator regression before accepting a dependency
change.

VOCO ships a `.deb`, an RPM and a strict snap, `voco` in the Snap Store, from one
staged tree. The snap serves GNOME on Wayland, typing through GNOME's
RemoteDesktop portal or the companion, and X11 sessions. It leaves out what strict confinement forbids: the uinput keyboard
and its udev rule, evdev, the IBus engine, the companion itself, the Chromium host
and the update check. [The snap](#the-snap) lists its rules.

## Invariants

### Recognition and capture

- Warm the selected worker before reporting readiness; imports don't start it.
- Start the worker as `python3 -E -s -B`, never `-I`, which drops the script's
  directory and with it the worker's own modules. `worker_sandbox.rs` marks every
  descriptor beyond its standard streams close-on-exec and installs a seccomp
  filter that refuses every socket, socket pair and io_uring; a step that fails
  fails the spawn. The worker starts with only the variables it reads
  (`ENVIRONMENT` in `worker_sandbox.rs`), never the session bus, display,
  runtime directory or an agent socket. Never give the worker a network path,
  not even a Unix socket, which reaches services that can start unconfined
  processes, or a Unix datagram pair, which can still address other sockets.
- Flush Stop audio into the same live stream before finishing; never copy or
  replay a whole recording. Recreate a dead worker only at a session boundary.
- Keep bounded queues, deadlines and sequence/sample accounting. Worker IPC groups
  100 ms of audio and Stop flushes the partial packet. Keep the three-second
  backlog bound and account for every sample.
- Native Pulse ticks drain ready transport events within bounded work and time.
  Pulse's playback overflow callback doesn't report recording drops, so keep the
  bounded duration-deficit guard and the complete-reference waveform tests;
  healthy local ACKs alone don't prove source continuity.
- Audio from the unverified ScriptProcessor fallback never enters automatic
  delivery.
- VOCO never recognizes audio a second time. A failed recording notifies and
  returns to idle; the voice test's "Test again" records anew.
- Spelling never breaks append-only delivery. `speech_stream.rs` adds the saved
  spelling to each session start, and a start without one is as recognized. The
  worker converts the whole hypothesis (`spelling.py`), a push returns only text
  no later hypothesis can change, and finish converts the final text, which
  extends every push. Generate `spelling-varcon.tsv` only with
  `scripts/generate-spelling-table.py` from the pinned VarCon file, and keep its
  notices and those in `vendor/THIRD-PARTY-NOTICES.txt`.
- The My words rules exist three times: `config.rs` checks a save,
  `runtime/speech/mywords.py` decides what the worker uses, and `myWords.ts`
  checks what the user types. Keep them one rule, Unicode's letters and digits
  with up to three combining marks each, and change all three with
  `tests/fixtures/mywords/entries.json`, which each suite runs.
- My words never breaks append-only delivery either. `speech_stream.rs` adds the
  saved list and its taught versions to each session start, and a start without
  them is as recognized. The worker boosts the listed phrases in the recognizer
  at a pinned strength and writes listed occurrences and taught versions into the
  whole hypothesis. A push holds back any word that a later word could still join
  to a listed term or a taught version, and finish rewrites the
  final text, which extends every push. Boosting needs the model's own
  SentencePiece tokenizer: the shipped model is NVIDIA's pinned file with only
  that metadata key added, and its other entries and every tensor copied
  unchanged.
- Generate `everyday-words.txt` only with `scripts/generate-everyday-words.py`
  from the pinned 12dicts files, and keep its notices and those in
  `vendor/THIRD-PARTY-NOTICES.txt`.
- Before a change to the boost, the phrases sent to the recognizer or the list
  limits ships, rerun the My words gates on public audio with
  `scripts/check-speech.sh`. An empty list must give identical output. Listed
  words must gain. Wrong words, wrong capitals and invented terms must stay within
  the pinned bar. Taught versions never change what the recognizer hears, and a
  list without them gives the output it gave before.
- Select the default microphone automatically only on an explicit Start test,
  Say it or recording when no microphone is chosen. No idle recording, and no silent device
  switching during capture.

### Delivery

- Each chunk pastes into whatever has keyboard focus when it is ready. There is no
  destination token, focus probe, terminal detection or per-app route. Desktop
  setup checks the paste prerequisites, never a caret or an app.
- Copy CLIPBOARD, then PRIMARY (best effort; a failure only warns; on GNOME
  Wayland PRIMARY goes first, as below), then send one Shift+Insert: toolkits
  paste CLIPBOARD and terminals paste PRIMARY. Spaces travel inside pasted
  text, never as a key or at a paste's edge: Chromium's address bar strips the
  spaces around pasted text, and its rich-text fields turn a space pasted alone
  into a no-break space. So each live desktop paste
  ends between two graphemes without whitespace (`desktopChunk`, with one
  `Intl.Segmenter`, so a letter keeps its combining marks) and the rest waits
  for the next hypothesis. After 0.75 s of audio with no new hypothesis
  (`QUIET_RELEASE_S`, above recognition's usual gaps), the held text goes out
  through `deliver()`, but not a trailing space and never after Stop or cancel;
  the next words then begin with their space, pasted alone, which the address
  bar keeps, so a rich-text field gets at most one no-break space after each
  pause. The final text, which nothing extends, goes out whole after such a
  space. Browser field delivery appends exactly, but a trailing space waits for
  the words it joins: the extension refuses a url field left with one. ASCII
  controls become spaces. Never send Enter and never restore the previous
  clipboard.
- Give the app time to read a paste before the next copy replaces it. On GNOME
  Wayland (`selection_owner.rs`) each copy runs xclip in the foreground with
  `-verbose`, which reports every request it answers except TARGETS, and keeps
  the selection until the next copy; it ignores SIGPIPE, so it outlives VOCO
  holding the text, as a forked xclip does. A helper reports owning its
  selection just before the X server gets its request, and until the server
  has it an app pastes the previous copy. So before the keys VOCO waits up to
  100 ms for Mutter's clipboard manager, which reads each new CLIPBOARD once
  through the server: the new helper answering it proves the switch. Nothing
  reads PRIMARY that way, so PRIMARY is copied first and its request is usually
  out well before CLIPBOARD's, but that isn't proof. Without the read in time
  the keys go anyway. A CLIPBOARD helper
  that never starts is a `no-mutation` failure whose error says when PRIMARY
  already holds the text. The keyboard that sends the keys reports when its
  Insert press went out. When Mutter's read is in by the Insert press, the
  next answer after the press, on either selection, is the app's read: the
  paste ends there, or 300 ms after the press with none. A read before it,
  during the wait for a young keyboard or the gap after Shift, never counts.
  Otherwise, and with wl-copy or on X11, the next copy waits until 150 ms after
  the keys. A read is not proof of insertion, and never changes a paste's outcome.
- Wayland paste keys are raw key events, so wait at most 1.5 s for the shortcut's
  modifiers to be released (evdev, else the companion's modifier check). Unknown
  state doesn't block; a timeout sends no keys. On X11 the passive grab takes every
  key while the chord is held, so a paste waits for its release, at most 1.5 s
  after the press. Through the RemoteDesktop portal VOCO can't read modifiers, so
  a portal shortcut press counts as held until its `Deactivated`, then 400 ms
  for the modifier's own release, which people often let go of a moment after
  the letter, and the same 1.5 s wait sends no keys while
  it is: keys sent under Super or Alt make another chord, which pastes nothing.
  A press with no `Deactivated` after 5 s reads as unknown, so a lost signal
  can't hold back every paste. After a `voco --toggle` in the snap, which
  reports no release, a paste waits 400 ms, or the repeat delay plus 400 ms
  when it is longer, after the last one, its repeats included. An X11 paste also waits, at most 1.5 s, while the X server's
  pointer state holds Shift, Control, Alt, Super or AltGr: xdotool's Shift under a
  shortcut being pressed makes it another chord, which neither IBus nor the grab
  takes, and the press is lost.
- On GNOME Wayland, while the companion is attached and GNOME has loaded a
  version that asks VOCO for work, the companion types the paste keys. VOCO never
  calls the Shell, because a confined VOCO can't: snapd's `dbus` slot lets a snap
  receive from unconfined peers on classic systems, never send to them. So the
  companion keeps one `com.sergiopesch.voco.Panel1.NextRequest` call pending
  and re-arms it as soon as VOCO answers. VOCO answers it with each paste, modifier check and
  change of its state, in order, or with nothing after 20 s. For a paste the
  companion types from inside the Shell with one Clutter virtual keyboard per
  enable: no device to settle, no portal dialog and no screen-sharing indicator.
  It refuses while a modifier is held or another paste is in flight. Otherwise
  it sends Shift, Insert and their releases, 12 ms apart and never another key,
  then reports the Insert press's monotonic time with `PasteDone`; a refusal
  reports its reason with `PasteRefused`. VOCO accepts a report only from the
  attached Shell and only for its open request. A refusal, a companion that isn't
  attached, or one without a pending request, typed nothing: `no-mutation`. No
  report within 1 s, or a gesture cut short when the companion is disabled, is
  uncertain; disabling releases any key it holds. GNOME disables the companion
  at the lock screen, since its metadata names no session modes and
  `ScreenShield.activate()` pushes `unlock-dialog`. VOCO's origin and lock checks
  still run before the copy and before the request.
- In the snap on GNOME Wayland without that companion, the keys go through
  GNOME's RemoteDesktop portal (`portal_keys.rs`), in a keyboard-only session
  with `persist_mode` 2 so GNOME asks once. VOCO opens the session when desktop
  dictation starts and closes it when that dictation ends, after Stop's last
  paste and space, at a lock, when the renderer is replaced and at quit; it never
  holds one while idle. GNOME shows its orange remote-access icon while a session
  exists, at least 5 s, and its Stop closes the session: VOCO then stops the
  dictation as Stop does, copying the rest. Each paste sends Shift, Insert and
  their releases with `NotifyKeyboardKeycode`, 12 ms apart, never another key. A
  paste before the session has started, a session that failed to start, or one
  GNOME closed, typed nothing: `no-mutation`. A call that fails after Shift went
  out is uncertain, and VOCO then releases Shift. Only setup's and Settings'
  explicit button starts a session without a restore token, which shows GNOME's
  dialog; dictation without a token is refused with that remedy. Each Start's new
  token replaces the saved one. A session that waits for GNOME's dialog, because
  the user revoked the permission, types nothing until the user answers.
- Otherwise, outside the snap, Wayland keys go through VOCO's own uinput device, "VOCO virtual
  keyboard" (`virtual_keyboard.rs`); X11 keeps `xdotool`. Keep one device per
  process, created at startup and reused for the process lifetime, never one per
  paste: the compositor adds a new device late and could lose its first keys, so
  a device younger than 500 ms waits before its first key. It declares only Shift
  and Insert and sends each event in its own report, 12 ms apart. Ensure it
  exists before the clipboard copy, so a missing device is a `no-mutation`
  failure; after an emit error, release Shift and drop it so the next paste
  recreates it.
- CI's companion suite proves this protocol on each Shell it runs. Every paste
  lands with its exact text in a GTK field on Wayland and under XWayland. From
  VOCO's answer to the Insert press reaching the field, taking turns with
  Mutter's RemoteDesktop API sending the same gesture over at least 200 pastes
  each, the companion's median is at most 1 ms, and its p99 at most 2 ms, above
  Mutter's. A paste answered with a modifier held, while another is in flight,
  in the `unlock-dialog` session mode or after the companion is disabled sends
  no key. The application job's GNOME Wayland delivery runs through the
  companion as well as through uinput. CI's snap probe proves the confinement
  the protocol relies on: a strict snap with a session `dbus` slot answers an
  unconfined caller's pending call and receives its calls, and its own calls to
  that caller are refused.
- CI's portal suite proves the snap's portal path in a headless GNOME 50 with the
  real xdg-desktop-portal and its GNOME backend, which names VOCO by the snap's
  app ID: the first typing session shows GNOME's dialog and later ones restore
  without it; every paste lands with its exact text in a GTK field on Wayland and
  under XWayland; dictation opens a session and its end closes it; the
  indicator's Stop stops the dictation with no key after it; the shortcut toggles
  through `Activated` and the next paste waits for `Deactivated`; a chord held
  past the repeat delay toggles once, and the next press toggles again.
- Keys reach seat0's active session. Bind the originating local login at startup
  through process membership or a validated session ID, where it is graphical or
  the text console a compositor such as Sway was started from (logind types that
  `tty`), or else a unique graphical user session for apps launched by the user
  manager. Never select logind's elected user Display or whichever login is
  active. Retain that identity for the process; a departed, ambiguous, foreign or
  wrong-seat origin rejects.
  Check before the clipboard copy (`no-mutation`) and again just before keys.
  Resolution has a 16-session cap and a 750 ms logind lookup budget. Genuine
  unavailable logind state retains the existing fail-open policy.
- A locked origin rejects too. Read logind's `LockedHint` with `Active` and
  follow its changes: while it is set, both checks reject (`no-mutation`) and no
  shortcut route starts dictation, a toggle that waited for the renderer is
  dropped, and the change to locked stops a running one. Subscribe, then read
  the first value on the same main context, so the read can't undo a newer
  change. While logind doesn't answer, or the origin isn't bound yet, keep
  trying, up to every 30 s. A logind that answers without the property reads as
  unlocked.
- The paste check opens `/dev/uinput`; it never creates the device, sends keys or
  starts a process. The evdev listener ignores the virtual keyboard by name (and
  another tool's `ydotoold virtual device`), so its keys never count as the
  shortcut or a held modifier.
- `/dev/uinput` access comes only from the packaged `uaccess` udev rule: the user
  of the active local session, with no group, daemon, socket or service. Package
  hooks apply it only by loading `uinput` and reloading and re-triggering udev;
  they never touch users, groups or session services.
- At a Wayland start, retire only VOCO's own `voco-ydotoold.service` enablement:
  remove the link only if it points at the old packaged unit and that file is
  gone, then stop the unit and reload the user manager off the startup path.
- Start is refused while paste is unavailable, and when `VOCO_DESKTOP_PASTE=0` or
  `VOCO_DESKTOP_STREAM=0` is set.
- Only a `no-mutation` failure, which typed nothing, keeps its text pending for the
  next chunk, a quiet release, or Stop's bounded retries (three, 250 ms apart). A rejected or
  uncertain paste stops automatic delivery; recognition keeps running until Stop.
  A paste rejection keeps microphone readiness; only a capture failure clears it.
- Stop copies the undelivered remainder, what waited included, with
  `copy_desktop_text`, then notifies. It never replays that text as keys. If the
  copy fails too, `keep_crash_journal` moves the text into Review; only if the
  journal can't keep it does Stop report an interruption. A Chromium exact-field
  session whose field stopped taking text ends the same way.
- When a desktop dictation's whole final text went out, with no cancel or
  failed or uncertain paste, and it ends a sentence (`endsSentence`: . ? ! or …,
  perhaps before closing quotes or brackets), Stop pastes one space on its own
  after it, through the same desktop paste, so the next dictation or typing
  starts apart. Never in a browser field, the voice test or Say it. It passes no
  correlation, so it reaches no hypothesis and no quality record; only
  `dictation_desktop_stop_space_dispatched` or `_failed` traces it. A failed
  space loses no words, so Stop says nothing and copies nothing.
- Closing or navigating an enabled browser tab, or losing its native connection,
  stops that tab's recording. Field focus loss revokes delivery but keeps the
  session's explicit Stop; stale tokens can't stop a newer session.

### Shortcut

- Toggles are debounced for 120 ms (`TOGGLE_DEBOUNCE_MS`).
- The presets (`Preset` in `lib.rs`, in the tray's order) are Super+X, the
  default for a new setup and for a reset or repair, then Alt+D and
  Alt+Shift+D; any other valid chord is custom. Never migrate a saved shortcut.
  The companion's grab and the GlobalShortcuts portal take only the chord's
  letter, so the focused app sees its modifier pressed and released alone. A
  lone Alt opens the menu bar in Firefox, Thunderbird, LibreOffice and VS Code,
  and the menu swallows the pastes that follow, so the default never pairs Alt
  with a letter. Passive evdev and the IBus engine match the shortcut with
  exactly its own modifiers held, on any keyboard: Super+X never with Alt, Control or
  Shift, Alt+D never with Super or Shift.
- In the snap on GNOME 48 and later without the companion, the GlobalShortcuts
  portal holds the shortcut (`portal_shortcut.rs`): one `toggle` shortcut whose
  preferred trigger is the saved chord, in the shortcuts specification's
  spelling (`LOGO+x` for Super+X). Only setup's and Settings' explicit
  button binds it the first time, which shows GNOME's dialog; VOCO records that,
  and later starts bind it again, which GNOME answers without one. An
  `Activated` toggles through the debounce, unless it repeats a held chord:
  GNOME's grab, unlike the companion's, repeats the press about every 30 ms
  after the keyboard's repeat delay, so one that comes before `Deactivated` and
  within the repeat delay, at least 900 ms, plus 100 ms of the last is ignored.
  GNOME Settings, under Apps, changes
  the trigger: VOCO saves each trigger GNOME reports, at a bind or a
  `ShortcutsChanged`, as its shortcut when it can take it, so its labels name the
  key GNOME listens for, and its tray presets are disabled while GNOME holds it. While the
  companion's lease is fresh VOCO closes the portal session, so one grab holds the
  chord, and binds again when the lease lapses. On GNOME 46, which has no
  GlobalShortcuts portal, setup's button adds a GNOME custom shortcut that runs
  `voco --toggle` for the saved chord, only when neither GNOME's window shortcuts
  nor another custom shortcut uses it, and never changes another. GNOME's schema
  for those keys isn't in the snap's runtime, so the snap carries one with the
  same IDs, paths and types (`packaging/snap/schemas`), and Reset removes VOCO's.
  That shortcut runs `voco --toggle` for each repeat too, so in the snap a
  `voco --toggle` within the keyboard's repeat delay plus 400 ms of the last
  one is a repeat and toggles nothing: each is a snap launch, so repeats arrive
  late and unevenly. VOCO reads GNOME's repeat setting once.
- The GNOME Wayland companion is recommended, not required. Without it the focused
  app also receives the chord (on Alt+D browsers focus the address bar and
  terminals delete a word; few apps act on Super+X), and an evdev toggle while
  the chord leaks sends one notification per launch with the panel remedy,
  which Settings also shows. When no keyboard is readable and neither the panel
  nor IBus takes the chord, it does nothing at all: 20 s after the listener
  starts, VOCO notifies once with the same remedy.
- The companion grabs the configured preset, Super+X, Alt+D or Alt+Shift+D, at
  every status, idle included; each press sends `Action('shortcut', '')`.
  `ReserveShortcut` holds a 2.5 s lease for the exact `shortcutAccelerator`
  that only the authenticated Shell can renew, about once a second. While it is
  fresh, passive evdev ignores the chord and the action toggles through the
  `gnome_panel` backend; otherwise the action is refused and evdev toggles. Release the grab on rejection, disconnect or
  disable; late replies about an earlier grab never act on a newer one.
- A completed IBus decision differs from a poll in flight. Consuming X11 callbacks
  go through the debounce; passive evdev keeps its duplicate guard. The listener
  posts fallback arbitration only when the config revision or the decision changes,
  otherwise once a second, and the main-thread closure re-checks its inputs.
- IBus protocol 6 is shortcut-only; older helpers must reconnect after an upgrade. Never
  restore text mutation there.
- `voco --toggle` connects once to the owner-only socket. Don't add retries or
  launch/focus side effects; it doesn't prove a compositor binding exists. Document
  modifier-independent Hyprland bindings, or explicitly checked Ctrl/Shift variants
  on other compositors, and never silently overwrite desktop shortcuts.

### GNOME companion and tray

- The `.deb` and RPM bundle the companion for GNOME 46, 48, 50 and 51 as
  `voco-panel@sergiopesch.com`, and extensions.gnome.org publishes the same code
  under that UUID for the snap, which can't ship it. Its metadata's
  `shell-version` and `SUPPORTED_SHELLS` in `voco_gnome_panel.py` name the same
  majors, and setup reports any other as `unsupported`; admit a major only after
  testing it. A Shell without `Meta.is_wayland_compositor()` (GNOME 50 and later)
  is Wayland-only. Enable the companion only through the user-run setup
  (`voco --setup-panel`), which also moves an enabled `voco-panel@voco.local` to
  the new UUID; package hooks never change enabled extensions. The snap can't
  enable extensions, since GNOME's Extensions interface is out of its reach. For
  the snap the companion is optional: setup never asks for it, and Settings offers
  its page on extensions.gnome.org, opened through the portal, as a top-bar meter
  without GNOME's remote-access icon, reporting it active once it attaches. Keep
  "sign out and back in" feedback distinct from active status.
- VOCO owns `com.sergiopesch.voco.Panel` on the session bus, under the
  maintainer's own domain as the Snap Store requires of a slot's bus name, and
  every interface, object path and error the two sides use sits under it. A
  VOCO or companion from before this name speaks only `org.voco.Panel`, so
  neither reaches the other, and neither side keeps code for one. After an
  upgrade, a companion GNOME loaded earlier stays detached until the next
  login, and VOCO pastes and takes the shortcut as it does without one.
- Bump the companion metadata's `version-name` and the setup contract together
  when loaded code must change, and compare GNOME's loaded metadata so an
  in-place upgrade can't report old code as current. The metadata has no
  `version`: extensions.gnome.org replaces it with its own upload number and
  keeps `version-name`. After an upgrade, users re-run panel setup and sign
  out and back in. A copy Shell marked out of date at login (after a
  distribution upgrade, for example) awaits that login: setup may enable it and
  reports `restart`, never a load error. GNOME loads a per-user copy of the
  UUID in place of the package's, so setup reports one whose `version-name`
  isn't the current one as `blocked`, naming its folder; it never removes it.
- extensions.gnome.org reviews every upload. Upload the release's companion zip
  there only when `version-name` changed, and follow its
  [best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html):
  a small entry point, a class per job that cleans up what it creates, no
  lifecycle flags, each timeout removed beside its re-creation, and Shell version
  checks rather than optional calls on Shell APIs. The snap's VOCO and its
  companion come from different stores and update separately, so a protocol
  change keeps working with the companion published there and with the VOCO the
  store serves until both have moved.
- The diagnostics poll, the setup input check and the once-per-launch shortcut
  notice may reuse a companion check for up to 20 s, or 2 s after a failed or
  unavailable check. Attach, Detach, name loss and explicit enabling clear it;
  explicit setup status always re-checks.
- While the companion is attached, VOCO hides its fallback tray icon. The
  companion's menu is Settings, Review, Stop dictation and Quit VOCO, which it
  offers only when VOCO sends `canQuit` and enables only while VOCO isn't
  dictating; VOCO quits as from its tray's Quit VOCO. On every supported
  Shell a primary click on the pill stops or opens Settings, and other buttons,
  Menu and Shift+F10 open the menu: from GNOME 50, the panel's click gesture must
  leave primary presses and touches to the pill.
- Support each new GNOME major within four weeks of its release, ahead of other
  feature work. Run the companion suite on it in CI (a job like GNOME 51
  Companion builds a digest-pinned image when no hosted runner ships that
  Shell), fix what breaks, then admit the major in the metadata,
  `SUPPORTED_SHELLS` and the docs together. Dictation keeps working without the
  companion until then.
- On GNOME the fallback tray needs an AppIndicator extension. Ubuntu turns one
  on; Debian 13 and Fedora 44 don't, so there the companion is VOCO's only
  top-bar presence. When 20 s after startup neither the companion is attached nor
  a StatusNotifier host owns its name, VOCO notifies once with the remedy.
- Active presentation is the microphone plus waves only. Stop lives in the menus,
  the companion pill's primary click and the shortcut (the fallback tray's
  AppIndicator reports no clicks); Settings and Review are explicit menu
  destinations.
- VOCO's own layout never moves the microphone when dictation starts or stops: the
  companion's meter opens on its left, and the fallback tray shows no label at
  Ready or while dictating. Only startup and setup labels add width.
- GNOME's privacy microphone indicator appears while the capture stream exists and
  shifts the indicators on its left, VOCO included. Never hide it or hold a stream
  open to avoid that.
- Keep tray PNG paths immutable for the process lifetime, and keep explicit Stop
  actions.

### Onboarding

- Setup first asks which English to write, British preselected, unless a choice
  is saved; Run setup again asks again. A choice saves at once, and the voice
  test shows it.
- The voice test uses the production recognition queue with local-only output.
  Never paste or copy onboarding output. The test keeps its local retry.
- After the voice test, setup offers My words with the user's name as its
  default entry: the full name of their account, read locally, when the list is
  empty and the name could be an entry; otherwise the name starts empty. Until
  they change or save it, setup says the name came from their account on this
  computer, so nobody wonders how VOCO knows it. It is
  saved only if they keep it and continue, or say it, and a name they edit is
  checked like any entry. Run setup again keeps the saved list and its versions:
  the account's name, if listed, shows as saved, and the step changes only the
  name and the words added in it, never the rest of the list. Anything else is
  theirs to type; setup suggests no kinds of words. If they say no word, or
  leave nothing listed, setup says they can personalise VOCO in Settings later.
- Say it, in setup and Settings, uses the same queue with local-only output and
  the saved list, as recognized, without spelling. Never paste or copy it.
- In the snap on GNOME Wayland without the companion, setup's desktop step asks
  for GNOME's permissions from the user's clicks, one at a time: typing, through
  the RemoteDesktop dialog, then the shortcut, through GlobalShortcuts' dialog or,
  on GNOME 46, the custom shortcut. It says before each what GNOME will show and
  what to choose, and that GNOME shows an orange icon while VOCO types. Nothing
  outside VOCO and GNOME is needed. With the companion attached, setup skips
  the typing step, and skips the shortcut step only while the companion's lease
  holds the saved chord: a companion before version 23 grabs only Alt chords,
  so with Super+X GNOME's shortcut is still asked for. A refusal keeps the step, says what happened
  and offers the button again; setup completes only once typing is allowed.
- Setup's last step names the shortcut to press and, for a Super chord, says
  Super is the key with the Windows or logo symbol. Where VOCO will start at
  login, it says first that VOCO is running now: "starts when you sign in" on
  its own reads as a request to sign in again.
- Finish must flush capture and recognition successfully. Check the desktop input
  prerequisites without sending keys or changing the clipboard; only then save
  completion. Done returns straight to the hidden tray surface without presenting
  or focusing a Ready window.

### Review and the crash journal

- Normal completion and handled failures clear text and audio and delete the
  active checkpoint; they never expose a saved transcript.
- Only an earlier unexpected exit, a replaced renderer, or a Stop that could neither
  paste nor copy its remainder, puts text into Review. Review never opens, pastes
  or retries by itself.
- When WebKit's web process crashes, VOCO reloads the window, at most three times
  in five minutes. `renderer_replaced` runs on every main page load and on a
  refused reload: toggles wait for the next renderer, the active entry moves to
  Review, and native capture and the Chromium exact-field session end. The
  full-app `web-process` case covers it.
- The journal is owner-only, bounded, local and text only, never audio. Keep
  earlier entries until the user discards them: at most five, the oldest evicted
  by a sixth. Without a checkpoint dictation continues and notifies.

### Privacy and logs

- Logs are optional, private and bounded. Performance logs never contain dictated
  text, audio, My words or its taught versions, the account's name, clipboard
  values, URLs or window titles. Reject unsafe log and
  socket targets.
- The developer capture audit needs all three flags (`VOCO_DEV_NATIVE_CAPTURE`,
  `VOCO_DEBUG_CAPTURE_AUDIO`, `VOCO_DEBUG_NATIVE_CAPTURE`) and completed private
  bundles; wait for their COMMIT receipts before ending an audited test process.

### Installer and packages

- The guided installer installs only the verified local package: the `.deb` with
  APT when `apt-get` and `dpkg-query` exist, otherwise the RPM with DNF (`dnf`
  and `rpm`). Both are checked against the same signed `voco_checksums.txt`,
  and the package manager must then report exactly that release, once. Then it
  runs `voco --check-desktop-input`. A successful install alone is not desktop
  readiness.
- After setup succeeds, request one detached launch as the invoking desktop user;
  never launch a GUI from root or package hooks. Distinguish a launch request from
  readiness and keep the manual guidance when launching fails. The installer checks
  `/usr/bin/voco`, not an earlier PATH entry.
- **Install update** follows the installer's verification, in VOCO's own code:
  download the release's `voco_checksums.txt`, its signature and the one
  package for this system (the `.deb` where `apt-get` and `dpkg-query` exist,
  otherwise the RPM), only from that release's GitHub assets, into an
  owner-only folder; check the signature with `gpgv` against the release key
  VOCO carries and its fingerprint, then the package's SHA-256 and its name,
  version and architecture. A failure installs nothing, deletes the download
  and says why. Only `pkexec` runs the packaged helper
  `/usr/libexec/voco-update-helper`, with its own polkit action that always
  asks for an administrator's password: it accepts only that folder, owned by
  the user who asked, and the release version, copies the three files the
  version names where VOCO's user can no longer change them, checks the
  signature and checksum again, refuses a release not newer than the installed
  one, and runs exactly `apt-get install` or `dnf install` on that copy, with
  no other argument from VOCO. The package
  manager must then report exactly that release. Never install while
  dictating, a recording is finishing or a Stop's text is still being pasted or
  copied; Review's journal survives the restart. Restart
  only after the install succeeds, through the same detached launch as the
  installer, and keep the manual upgrade guidance when anything fails. The
  source build and the snap have no Install update.
- Source excludes model weights and compiled runtime payloads. Follow
  [runtime provisioning](docs/linux-packaging.md#runtime-provisioning) and never
  replace missing pinned artifacts with mutable downloads. A base Tauri `.deb` is
  incomplete: assemble and verify the NVIDIA payload before calling it installable.
- One staged tree becomes both packages (`package-nvidia.py --rpm`) and the
  snap (`--snap`), so they carry the same files; `verify-rpm-package.sh` proves
  it for the RPM against the `.deb`.
  Every Debian dependency needs its Fedora name in `DEBIAN_TO_FEDORA`
  (`scripts/rpm_package.py`), and the spec requires exactly those. The RPM's
  only scriptlet is `packaging/rpm/post.sh`, the same best-effort rule
  application as the Debian `postinst`. It owns only VOCO's folders and the
  shared ones no dependency creates, declares no weak dependencies or
  configuration files, and keeps automatic requires and provides off for the
  private speech runtime. `check-devops.sh` checks the spec and the mapping, and
  `verify-rpm-package.sh` the built package. CI's Debian 13 and Fedora 44 jobs
  install the dependencies by those names (`scripts/distro-dependencies.py`) and
  run the speech runtime there; hosted CI never builds a package.

### The snap

- The snap is strictly confined on `core24` for amd64, with the packages' pinned
  speech runtime. `verify-snap-package.sh` proves it carries the `.deb`'s files
  except those strict confinement can't use: the uinput rule and module file, the
  IBus engine and its component, the companion, and `voco-browser-host` with its
  manifests and the Chromium extension. It plugs only what it uses, never
  `network` or `home`, and has one slot, a session `dbus` slot for
  `com.sergiopesch.voco.Panel`; `check-devops.sh` checks both lists.
- The Ubuntu programs the snap runs, Python 3.12 with NumPy and SentencePiece
  for the worker, and xclip, xdotool and notify-send, live with their libraries
  in private folders under `/usr/lib/voco/snap` and run through the reviewed
  wrappers in `packaging/snap/wrappers`, so none shadows the GNOME platform's
  libraries in the app. `VOCO_STREAM_PYTHON` names the worker's wrapper, which
  adds only `LD_LIBRARY_PATH` for those folders, found from its own path, and
  runs that Python with VOCO's flags.
- It types through the companion when it asks for work, otherwise through the
  RemoteDesktop portal on GNOME Wayland, and through `xdotool` on X11. Elsewhere
  Start is refused, and setup names the build that supports that desktop. Only
  the running VOCO knows whether the companion asks it for work, so
  `voco --check-desktop-input` and `--check-panel` ask it with
  `com.sergiopesch.voco.Panel1.CompanionAsking`, the one method any caller
  may use, and with no VOCO to ask they claim neither; the portal path is ready
  when a restore token is saved. Its shortcut is the companion's grab or the
  GlobalShortcuts portal on GNOME Wayland (a custom shortcut on GNOME 46), VOCO's
  grab on X11 or a desktop binding of `voco --toggle`; it has no evdev or IBus
  route.
- logind's session signals don't reach a snap, because `login-session-observe`
  receives only the manager's, and `GetSessionByPID` is out of its reach. So the
  snap binds its origin through a validated session ID or the user's sessions,
  reads `LockedHint` and `Active` at each check and `LockedHint` once a second,
  and stops dictation and closes any portal session when it reads locked. Until `login-session-observe` is
  connected, both checks reject (`no-mutation`), on X11 as on Wayland, and
  Start is refused with the `snap connect` remedy.
- Its config, journal and logs live in `$SNAP_USER_DATA`. It never reads a
  package's config, and a package never reads its.
- The store updates it. The maintainer builds it with the release
  (`VOCO_RELEASE_SNAP=1 scripts/assemble-release.sh`) and uploads it from the
  signing machine after the same checks as the packages, to `edge` first; hosted
  CI never builds VOCO's snap. Try it on Ubuntu 24.04 and the latest Ubuntu before promoting it past
  `edge`. VOCO's snap declaration allows the `dbus` slot for
  `com.sergiopesch.voco.Panel` and auto-connects `audio-record` and
  `login-session-observe`, so an upload that asks for the same plugs and slot
  passes the store's automated review; a new plug, slot or bus name needs a store
  request first. The portals need no plug beyond `desktop`. Before promoting,
  install it from the store's channel in fresh Ubuntu 24.04 and latest Ubuntu
  desktop VMs, as a new user, through setup, dictation, a lock and a restart. Where they aren't connected, as after a `--dangerous` install,
  setup shows their `snap connect` commands. On X11, where WebKit captures, `audio-record` connected after VOCO
  started needs a restart, and VOCO says so rather than open a microphone.

## Working practices

Inspect first, make a concrete plan, and change only what the task requires.
Preserve unrelated uncommitted work. User instructions authorize product changes;
otherwise discuss significant behaviour, security, privacy or stack tradeoffs
first. Don't add dependencies without a concrete need.

Documentation describes how VOCO works now. Update it in the same change as the
behaviour: user-visible behaviour in the README, `docs/everyday-use.md` and
`docs/troubleshooting.md`; setup in `docs/install.md` and `docs/platform/README.md`;
internals in `docs/architecture/`; security in `docs/security/README.md`; packaging
and releases in `docs/linux-packaging.md` and `docs/release-process.md`. Keep dates,
run IDs, superseded designs and test narratives out of the docs; they belong in pull
request descriptions. Dated studies, such as the engine benchmark, live in
`research/` with the harness and raw results behind them; correct one with a dated
note, never by rewriting its results, and link to it from the docs instead of
restating it. Summarize each release in `CHANGELOG.md` and
`docs/releases/<version>.md`. The [code guide](docs/guide/README.md) is pinned to a
commit; re-pin and regenerate it when the code it cites changes.

## Validation

Run focused checks first, then the relevant wider gates:

```bash
npm run verify:versions
npm run verify:devops
npm run check
npm run lint
npm test
npm run test:dictation-renderer
npm run test:microphone-renderer
npm run test:native-capture-renderer
npm run test:chromium-exact-field
npm run test:browser-delivery
npm run test:application-delivery
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm --workspace @voco/desktop run build:frontend
cargo clippy --locked --all-targets --all-features --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
python3 scripts/verify-glib-backport.py
python3 scripts/test-glib-variant.py --output "$(mktemp -d)/voco-glib-check"
cargo test --locked --all-targets --features update-helper --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build
```

`npm test` (`scripts/test-unit.sh`) runs the checks that need no microphone, speech
model or desktop session. `verify:devops` checks the CI gates, installer sync and a
release rehearsal.

`scripts/check-privacy.sh` measures the network and microphone claims end to end,
on Linux with podman or docker, a release build and the provisioned speech runtime.
It runs the build twice in a pinned Ubuntu 26.04 image and dictates a public clip
each time: offline with update checks off, where no process may reach the internet
or DNS, and online with them on, where only `api.github.com` may be resolved and
reached and the speech worker reaches nothing. In both, a microphone stream exists
only while dictation runs. Run it after a change that could touch the network, the
update check, the worker sandbox or capture, and keep its evidence folder out of
the repository.

`scripts/check-speech.sh` measures recognition through the real worker after
`scripts/provision-ci-speech.sh`: the accuracy gate, word error rate and latency on
the 12 public clips, and My words in six conditions from
`tests/fixtures/mywords/benchmark.json`. With `--against voco.2026.0.62` it measures
that release's worker beside this one. It fails when this checkout misses a My
words gate above, against the bar pinned in that fixture. Recognition is
deterministic here, so any changed word is real. Run it after a change to the
worker, My words or the speech payload, and keep its evidence folder out of the
repository.

- Use isolated audio, input, clipboard and desktop fixtures. Never inject test
  speech into a live user session.
- Use public or synthetic fixtures only; keep personal audio, transcripts and
  private raw evidence out of the repository and out of CI logs.
- Python worker tests need NumPy; protocol tests also need the pinned model and
  runtime (`scripts/provision-ci-speech.sh`).
- Record unavailable checks as unavailable, never passed. Report failures and
  attempted-trial denominators, not just successes.
- Keep diagnostic DOM logging separate from latency measurements in browser tests:
  repeatedly copying a growing transcript can stall the recipient.
- For optimization work, follow [the TypeSafe evaluation protocol](docs/testing/typesafe-evaluation.md).
  Keep deterministic timing and accuracy separate from optional semantic judgments.
  The TypeSafe client is research tooling: explicit public or synthetic text, never
  personal speech or live delivery. Keep baseline and candidate identities, missing
  measurements and rejected experiments, and run `npm run test:dictation-evaluation`.

## Release

- Source version: **2026.0.70**. Latest published release: **2026.0.70**.
  GitHub Releases is authoritative for publication and the package manager for the
  installed version; a version in source proves neither.
- `packaging/published-release.json` records the published version. Keep the README
  install command pinned to it until a new publication is verified, then update both.
- New product bytes need a new version and fresh checks. Pass every CI gate,
  including the pinned Nemotron accuracy and continuity checks; no waiver is
  authorized. Keep a clean commit, exact package and source hashes, licenses,
  checksums and release notes.
- CI's `application` job tests the release build of both executables in isolated
  desktops, but hosted CI never packages the NVIDIA runtime or signs anything;
  `check-devops.sh` enforces this. CI's Rust job also runs the worker protocol
  test from only the worker files packages ship
  (`scripts/stage-speech-worker.py`), as release assembly runs the packaged
  worker. On the maintainer's Linux machine,
  `scripts/assemble-release.sh` builds, verifies and signs a signed tag's release.
  The assets go to a draft release, which is published only after the downloaded
  assets verify. See the [release process](docs/release-process.md).
- The signing machine runs Ubuntu 24.04, whose glibc 2.39 and GCC 13 set both
  packages' floors, with `rpmbuild` from the `rpm` package. Each release carries
  the RPM and `voco_latest_x86_64.rpm` with their own checksum lists, signed
  like the Debian ones; `voco_checksums.txt` lists the RPM too, and
  `voco_latest_checksums.txt` stays Debian-only. The RPM itself isn't
  OpenPGP-signed: the signed checksums authenticate it. The validation record
  doesn't cover DNF, so try the RPM on Fedora 44 before publishing.
- Userspace checks, native install and removal, physical audio and
  compositor/application behaviour are distinct evidence levels, and each covers
  only the system and GNOME version it ran on. Never claim first, only, fastest,
  most accurate, universal compatibility or stability from a limited test corpus.
