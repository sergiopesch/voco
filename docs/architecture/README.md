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
Explicit recovery uses a private Nemotron worker and keeps its completed result in
VOCO for review. No recognition result bypasses destination validation.

Shortcut arbitration separates completed IBus authority from a poll in flight.
Registration, config synchronization and readiness use only unexpired Armed/Uncertain
authority. Passive evdev also suppresses during a pending poll because it may observe
a chord consumed by IBus. X11 root/scoped grabs use `owner_events=false`: their
callback already consumed the chord and proceeds through the existing shared
debounce. A pending poll must neither discard that callback nor revoke an existing
registration. The one-second IBus bound and plugin-generation checks are unchanged.

## Current dictation path

1. The Tauri/React frontend owns microphone capture and dictation state. AudioWorklet
   capture supplies ordered audio; interruption and recovery are explicit states.
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
5. The frontend appends accepted live words through `insertion.rs`. `focus_probe.rs`
   checks the current destination and terminal category. Clipboard and key helpers
   perform paste. Eligible accessible controls provide bounded sampled local-region
   confirmation; unsupported controls have dispatch evidence only. Neither is
   compositor paint or atomic ownership. See [observation](../testing/delivery-observation.md).
6. Stop drains capture into the live stream before finishing and flushing the
   remaining suffix. Focus loss, revised already-delivered
   text or uncertain delivery preserves recovery instead of blindly replaying text.

The candidate batches released silence-preroll frames into at most one second per
native call, preserving every released sample and its order. This reduces call
count; the benchmark did not demonstrate a material first-word latency improvement.
The zero gate detects digital silence, not speech onset or arbitrary background noise.

## Delivery contracts

Desktop paste/streaming are enabled unless their launcher overrides are `0`.
The application fixes cursor output, stable streaming and enhancement off.
Desktop paste replaces clipboard text and leaves it there; a leading join space can
be typed separately to preserve address-bar separators. Known terminals use their
paste chord. VOCO does not submit Enter or rewrite arbitrary editor text after Stop.
Focus metadata is a best-effort guard, not exact per-widget ownership or protection
from every sensitive field. See [delivery policy](../testing/desktop-paste.md).

Only a new dictation's first delivery can replace a selection. Later chunks reject
selected text; prepared position and bounded surrounding context are sampled again
after clipboard preparation, immediately before keys. These checks prevent a Stop
shortcut's select-all from replacing earlier text. They cannot make a native key
gesture atomic with another application's focus or selection changes.

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

For eligible desktop streams, `desktopShortcutSession.ts` owns a UUID from before
capture until final queue drain. Native `desktop_shortcut.rs` uses the existing
global-hotkey actor to move the configured X11 passive grab from root to the exact
input-focus window. The root ancestor grab caused the observed GTK/AT-SPI focus
loss during Stop; an exact-window grab avoids that mechanism in the isolated
proof. Full candidate/toolkit qualification is separate. No focus event is ignored
and no target token is exempted from verification. Only an initially unavailable
target is probed once more after acquisition; valid initial tokens never refresh.

The actor restores root scope on finish, real focus departure, window loss,
registration change or fixed 650-second expiry (600 seconds of capture plus
50 seconds for finalization). This does not extend delivery deadlines. Automatic
restoration ends session authority; degraded restoration blocks further delivery
and cannot be advertised as shortcut-ready. Begin/end serialize with recipient
observation. The frontend cleans uncertain begin replies and prevents stale
completion from releasing a newer UUID. Unsupported routes retain their existing
delivery checks.

On GNOME Wayland, the panel companion reserves the configured Alt+D or
Alt+Shift+D while the authoritative app state is starting, recording or processing.
The compositor consumes the chord before a browser can select its address bar.
The companion waits for modifier release and sends an explicit, token-checked Stop,
never a delayed toggle. During processing it consumes repeated chords without an
action. Only the authenticated Shell can renew a 250 ms native reservation that
suppresses duplicate passive evdev observations. Existing active-state polling
renews it; idle, disconnect and extension disable release the grab, and missing app
state expires it after two seconds. A failed grab leaves the guarded delivery and
saved-text fallback available. This is GNOME-specific, not a general Wayland grab.

The main renderer's PageLoad Started event synchronously increments a native epoch
before scheduling old-scope cleanup off the UI thread. Preflight captures that
epoch before its blocking target probe; Begin checks the immutable epoch before
and after acquisition, releasing any scope obtained across a reload. Background
cleanup selects only older epochs, and delivery readiness rejects registered old
ownership immediately. UUIDs still isolate recordings within a renderer. Generic
paste IPC is not epoch-bound; this is shortcut-lifetime protection, not a universal
guarantee that all previously queued renderer work is cancelled.

This is a pinned patch to the existing `global-hotkey` 0.7.0 dependency, not a new
hotkey engine. See [upstream provenance and patch boundaries](../../vendor/global-hotkey/VOCO-PATCH.md).
The actor waits on the X11 fd and a nonblocking command signal with `libc::poll`;
it has no periodic idle wakeup. Buffered X events are drained before waiting,
commands are queued before signaling, and the sole scheduled deadline is the
original lease expiry. Interrupted waits preserve that deadline; failed fds
close the actor and degrade any active lease. This removes the former artificial
50 ms polling ceiling, while root restoration remains asynchronous with respect
to other X clients. The existing locked libc version is unchanged.

`useDictation.ts` coordinates capture, delivery and recovery; `config.rs` serializes
field-level settings updates and writes private atomic configuration. Single-instance
ownership prevents two VOCO processes from competing for sockets or shortcuts.
`trigger_socket.rs` owns trigger-path validation, same-UID peer checks and cleanup
of only the socket inodes registered by this process.
The backend tray reducer combines microphone, model and dictation states.
Normal dictation stays out of the way without opening a transcript preview. The
Crystal Sidebar and rounded glass controls retain OS accessibility preferences.
A hotkey should be used with the intended destination focused. Automatic desktop
insertion requires a nonempty destination token; unavailable focus metadata
rejects startup after shortcut acquisition and independently rejects paste at the
Rust boundary. GNOME X11's separate `mutter-x11-frames` accessibility application
is excluded from active-client discovery. Other active-client ambiguity remains a
rejection. A window-level token is still weaker than exact-control observation.

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
