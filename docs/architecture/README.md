# Architecture

VOCO provides local, direct-cursor dictation. Read [the code map](code-map.md)
and [release status](../release-candidate.md) for navigation and qualification.

## Startup and recognizer selection

The backend warms the bundled Nemotron worker before reporting model readiness.
Desktop dictation, explicit browser dictation and onboarding all send captured
samples through the same bounded streaming queue. A missing runtime or failed
warmup reports an error; the app does not download another model.

Browser delivery uses a separately authorized field lease. Each append requires an
exact prefix receipt and Stop finalizes the acknowledged text without replaying it.
Review exposes the last text checkpoint from an unexpected process or renderer
exit, or from a Stop that could neither paste nor copy its remainder, with explicit
Copy and Discard. Normal Stop and handled failures clear text/audio and remove the
active checkpoint. A checkpoint failure never blocks dictation. Review has no
delivery or retranscription action.

Shortcut arbitration separates completed IBus authority from a poll in flight.
Registration, config synchronization and readiness use only unexpired Armed/Uncertain
authority. Passive evdev also suppresses during a pending poll because it may observe
a chord consumed by IBus. X11 root grabs use `owner_events=false`: their
callback already consumed the chord and proceeds through the existing shared
debounce. A pending poll must neither discard that callback nor revoke an existing
registration. The one-second IBus bound and plugin-generation checks are unchanged.

## Current dictation path

1. The Tauri/React frontend orchestrates microphone capture and dictation state.
   Native Pulse capture on Wayland and AudioWorklet capture on X11 supply ordered
   audio; interruption and crash Review are explicit states.
2. `apps/desktop/src/lib/benchmarkPhraseQueue.ts` transports bounded streaming audio
   and session/sequence metadata to the Rust `benchmark_stream` command.
3. `apps/desktop/src-tauri/src/benchmark_stream.rs` serializes worker access, starts
   an explicit local Python entrypoint, validates bounded newline-delimited JSON
   responses and session identity, and reaps failed workers. It is production
   candidate code despite its historical module name.
4. `runtime/speech/stream_worker.py` starts `worker_main.py`. The worker owns a
   reusable local Nemotron recognizer, validates requests and drains hypotheses.
   `streaming.py` handles warmup, silence gating, sample accounting and metrics;
   `adapters.py` bridges the packaged CPU native library. The default is the Q8
   English 0.6B model, context 1, four CPU threads and the pool backend.
5. The frontend appends accepted live words through `insertion.rs`, which pastes
   each chunk into whatever has keyboard focus. VOCO records that the keys were
   dispatched; it does not observe what the application did with them.
6. Stop drains capture into the live stream before finishing and flushing the
   remaining suffix. A paste that typed nothing (`no-mutation`) is retried with
   the next chunk or at Stop. Revised already-delivered text, or an uncertain or
   rejected paste, stops insertion without replay. Healthy recognition continues
   through Stop, which copies any undelivered remainder to the clipboard and
   notifies the user, or moves the dictation into Review when that copy fails.
   A Chromium exact-field session whose field stopped taking text ends the same way.

The candidate batches released silence-preroll frames into at most one second per
native call, preserving every released sample and its order. This reduces call
count; the benchmark did not demonstrate a material first-word latency improvement.
The zero gate detects digital silence, not speech onset or arbitrary background noise.

## Delivery contracts

Desktop paste/streaming are enabled unless their launcher overrides are `0`.
The application fixes cursor output, stable streaming and enhancement off.
Desktop paste copies each chunk to CLIPBOARD, then PRIMARY (best effort), and
sends Shift+Insert to every application: GUI toolkits paste CLIPBOARD and
terminals paste PRIMARY. A leading joining space is its own Space key because
Chromium's address bar trims pasted leading whitespace. ASCII control characters
become spaces, so VOCO never submits Enter, and it does not rewrite text after
Stop. The paste replaces any selection, as a manual paste would. VOCO does not
inspect the focused control, so it cannot tell a sensitive field from any other.
See [delivery policy](../testing/desktop-paste.md).

The explicitly enabled Chromium adapter is a separate, stronger exact-element
contract: element/document identity, caret and acknowledged prefix are checked
before edits. Password fields, rich editors and unsupported fields are rejected.
IBus remains shortcut-only; protocol 6 rejects text mutation. Neither integration
establishes universal desktop or Wayland qualification.

Whisper and its downloader, native dependencies and alternate recognition commands
were removed in the .51 release. Earlier evaluation documents describe
historical implementations. Assistant, OpenClaw, conversation and enhancement
capabilities remain retired; see [security boundaries](../security/README.md).

## State, UI and lifecycle

On X11 the configured shortcut is an exclusive global grab, so the focused
application does not receive it. Passive Wayland evdev observes the chord
without consuming it.

On GNOME Wayland the panel companion is recommended, not required. Without it,
the focused application also receives Alt+D: browsers focus the address bar and
terminals delete a word. Since v11 the companion grabs the configured Alt+D or Alt+Shift+D
at every status, idle included, and each press sends `Action('shortcut', '')`.
`ReserveShortcut` keeps a 2.5-second lease for the exact accelerator in the
`shortcutAccelerator` snapshot field. Only the authenticated Shell can renew it,
about once a second. While the lease is fresh, VOCO ignores the passive evdev
duplicate and the action toggles through the `gnome_panel` backend; otherwise
the action is refused and evdev toggles. Rejection, disconnect and disable
release the grab. The v10 `ReserveStopShortcut` is kept only for compatibility.
Users re-run panel setup, then sign out and back in to load v12. This is
GNOME-specific, not a general Wayland grab.

The main renderer's PageLoad Started event increments a native epoch, so crash
journal writes from the previous renderer become stale.

VOCO pins a patched `global-hotkey` 0.8.0; see
[upstream provenance and patch boundaries](../../vendor/global-hotkey/VOCO-PATCH.md).
Its X11 actor waits on the X11 fd and a nonblocking command signal with
`libc::poll`, with no periodic idle wakeup. The application no longer uses the
patch's focus-lease API.

`useDictation.ts` coordinates capture, delivery and recovery; `config.rs` serializes
field-level settings updates and writes private atomic configuration. Single-instance
ownership prevents two VOCO processes from competing for sockets or shortcuts.
`trigger_socket.rs` owns trigger-path validation, same-UID peer checks and cleanup
of only the socket inodes registered by this process.
The backend tray reducer combines microphone, model and dictation states.
Normal dictation stays out of the way without opening a transcript preview. The
Crystal Sidebar and rounded glass controls retain OS accessibility preferences.
Each chunk goes to whatever has keyboard focus when it is ready. Moving to
another field during dictation sends the later chunks there.

## Diagnostics and package identity

`performance.rs` records bounded application timing/resource metadata;
`runtime/speech/streaming.py` records worker stages. Both are opt-in through
`VOCO_PERFORMANCE_LOG=1`. Session hashes correlate app IPC and worker requests;
this is not yet an end-to-end cursor paint clock. Successful native dispatches and
finished terminals are reported as outcomes, not failures; missing/unknown records
remain explicit. Worker metrics reject unsafe file targets and fail independently
of recognition. See
[measurement scope and retention](../testing/laptop-performance.md).

The complete Debian package combines Tauri's base package with `runtime/speech`,
model, native libraries and notices through `scripts/package-nvidia.py`.
It installs `/usr/lib/voco/speech/stream_worker.py`, which is the default worker
entrypoint, and retains a payload manifest. Runtime path overrides are development
controls; installing an old binary with a new worker does not establish a new
whole-app candidate identity.

## Navigation

- [Current candidate and release gates](../release-candidate.md)
- [Local comparison and limitations](../testing/model-comparison-2026-09-14.md)
- [Testing](../testing/README.md)
- [Historical foundations architecture](foundations-history.md)
- [Speech recovery](speech-recovery.md)
- [Browser broker acceptance](../testing/browser-broker.md)
