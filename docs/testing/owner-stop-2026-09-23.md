# Owner-session Stop follow-up — 23 September 2026

The owner installed 2026.0.59 after clearing VOCO and reported saved-text
recovery after dictating in Brave's address bar, plus incomplete text and an
error after Stop in Codex. This record separates observed session state from
possible causes. No personal transcript or audio is included.

## Observed locally

- The installed package and running app are 2026.0.59. Desktop input and an
  editable Codex composer both passed read-only preflight when the composer had
  focus. When focus moved to Codex's document, cursor preflight correctly
  rejected it.
- The packaged GNOME 46 companion is present and its UUID is in the user's
  persistent enabled list. The running Shell began before package installation
  and does not report that extension. `voco --check-panel` requests sign-out and
  sign-in. The Wayland input service is active.
- The owner's app had no opt-in hotkey or performance trace enabled and sent
  standard output/error to `/dev/null`. The journal does not contain a VOCO
  delivery event for either reported attempt. There is no evidence of an app
  crash. Do not attribute a specific rejection code or speech backlog to the
  owner's sessions without a new trace.

## Cause and change

GNOME must consume Alt+D before Brave can select its address bar. Without the
loaded companion, the native listener sees the chord passively. The known
reproducible failure path is that a later speech suffix encounters Brave's
selection; VOCO rejects it to avoid replacing earlier dictation and retains
text for review. The current session matches the prerequisites for the
documented unconsumed-Stop condition in
[Brave Stop qualification](brave-stop-2026-09-23.md).

On GNOME Wayland, VOCO now requires a loaded and attached companion before
declaring Alt+D or Alt+Shift+D ready for desktop dictation. Start also waits
for the authenticated Shell shortcut reservation for this dictation session
before opening the microphone. Onboarding's desktop setup check and Start
preflight report the reason. A pre-capture setup rejection returns to
idle with a tray notification rather than displaying a recording error. Other
desktops and shortcuts retain their existing preflight. The selection guard,
destination identity checks and no-replay rule remain in force.

The installer's `--check-desktop-input` remains an input-helper check. It runs
before the new GNOME extension can load into the current Shell, so making it a
live Stop-reservation check would incorrectly fail a fresh installation. The
running app checks attachment and reservation at onboarding and Start.

Codex's exact reported failure is not established from the available logs. Its
composer can be a valid target, but a focus change, editor readback change or
recognition backlog can still pause delivery. A private metadata trace and an
isolated Codex composer reproduction must distinguish these paths before a
Codex-specific insertion change. The current app session should not be
restarted until any in-memory recovery the owner needs has been reviewed.

## Candidate verification

- 288 Rust unit tests passed (one pre-existing ignored); strict Clippy,
  formatting and diff checks passed. Reservation tests reject an old session
  token, a failed grab, and microphone selection while reservation is pending.
- 398 frontend tests passed, including the onboarding setup state and failed
  reservation path. TypeScript and ESLint passed. The installer helper suite
  passed after preserving its original scope.
- Private native application and rich-editor delivery suites passed. The real
  Chromium address-bar selection case still rejects unsafe continuation, while
  normal contenteditable cases preserve observed text.
- The app renderer dictation suite passed, including a rejected and a delayed
  Stop-reservation ACK before microphone capture. Its five-minute audio cases
  use synthetic capture and a worker double, so they do not establish the
  owner's Codex result or sustained physical-device performance.
- The production source build succeeded. The raw Tauri Debian bundle is not a
  complete distributable package because it omits the speech model. It was not
  installed or published. The mocked native-capture renderer suite and nested
  GNOME panel suite passed against the candidate source binary. These tests do
  not prove physical keyboard consumption on the owner's current login.

The owner-session Codex Stop cause remains open until a content-free trace can
separate destination rejection, recognizer backlog, and prefix revision. The
existing three-second queue bound safely retains source audio on overload, but
can leave only a prefix in the target. Its value should not be relaxed on this
unattributed report alone; a slow-worker Stop test and natural long-speech
qualification are follow-up release gates.
