# Security

## Design Principle: Local-First, No VOCO Account

Core dictation runs locally and requires no VOCO account, sign-in, subscription, telemetry, or
third-party credential. The complete NVIDIA candidate bundles its model. Normal cursor
streaming with enhancement off warms the selected NVIDIA worker at startup without
an implicit Whisper download. Explicit legacy transcription
commands can download their separately pinned Whisper model. Automatic GitHub Releases metadata checks occur after startup. Assistant and realtime connections were removed in 2026.0.38.

## Threat Model

### Assets

- User audio data (normally transient; the explicit debug-capture mode persists one recording)
- User configuration (stored locally)
- ASR model files (stored locally)
- Dictated text retained in VOCO, delivered through default desktop paste, or sent to an explicitly authorized browser element
- Captured browser element value and selection checked transiently inside the extension
- Bounded accessible-field context held transiently by the native observation helper
- Clipboard contents (replaced by native desktop delivery or explicit Copy; clipboard managers may retain dictated text)

### Attack Surface

- Tauri IPC commands (frontend -> Rust)
- Private VOCO app -> persistent shortcut-only IBus engine socket
- Chromium extension, native-messaging host and exact-field broker socket
- Audio capture (WebView getUserMedia)
- Native desktop paste and compatibility insertion via external helpers (ydotool, xdotool, xclip, wl-copy)
- Local Python speech worker, bounded IPC, native CPU libraries and packaged model
- ASR model loading (local files)
- Legacy Whisper model preparation/download (HTTPS from Hugging Face)
- Automatic and manual GitHub Release checks (HTTPS to api.github.com)
- Optional debug WAV and transcript-timeline persistence when `VOCO_DEBUG_CAPTURE_AUDIO=1`

## Current Protections

- **Minimal core network**: Packaged NVIDIA inference stays local; legacy Whisper model downloads
  and GitHub Release metadata checks are separate. Successful update results are cached for up to six hours
- **Whisper cache integrity**: The pinned SHA-256 is verified for both existing caches and new downloads
  before the model is marked ready. Cached symlinks and non-regular files are rejected without being
  opened; oversized or digest-mismatched current-user-owned cache files are identity-checked before
  removal and verified redownload, while unsafe or changed paths are preserved with an error.
- **Single-instance ownership**: A private per-user runtime lock is acquired before sockets,
  shortcuts, tray state, or model work, preventing two VOCO processes from stealing shared runtime
  resources or overwriting configuration concurrently
- **No VOCO account**: Dictation requires no identity or credential.
- **Tauri CSP**: Restrictive content security policy, no remote scripts
- **Scoped permissions**: WebView permission grants restricted to UserMedia (microphone) only
- **Input validation**: Audio length limit (10 minutes), text size limit (100KB), empty input rejected
- **Bounded legacy downloads**: Whisper model downloads use a 200 MiB ceiling. This limit is not
  the packaged NVIDIA model size. The NVIDIA assembler verifies its separately pinned digest
- **External link allowlist**: WebView-triggered external opens are limited to VOCO GitHub release pages
- **Local core storage**: Config, models, state, and debug captures use local paths; VOCO does not
  provide cloud sync
- **Shell safety**: Text passed as arguments (not interpolated), `--` separators used
- **Explicit debug persistence**: Debug capture is disabled unless `VOCO_DEBUG_CAPTURE_AUDIO` is
  exactly `1`. At most the first completed dictation in an app process is saved. The capture
  directory is verified as a current-user-owned real directory and set to `0700`; new WAV and JSON
  files are created without overwrite at `0600`, and VOCO attempts to remove partial pairs after a
  write failure
- **Clipboard boundaries**: The current desktop route deliberately uses clipboard paste for
  progressive/final delivery. Text replaces the clipboard and stays there; leading join spaces
  can be typed separately. Helpers cannot atomically prove recipient consumption or preserve all
  MIME formats. No delayed clipboard restore or automatic uncertain replay is performed
- **Sampled desktop observation**: Eligible accessible controls permit bounded local-region
  readback after paste before the next clipboard replacement. Context is transient,
  excluded from metrics/frontend responses, and discarded after the transaction.
  Sampling does not provide atomic field ownership; unsupported controls remain
  unobserved. Timeout or inconsistent identity cannot authorize automatic replay.
- **Trigger socket safety**: Runtime directories must be absolute, real, private and
  current-user-owned. With no `XDG_RUNTIME_DIR`, the existing temporary-directory layout
  is retained only under a verified private root or a root-owned sticky temporary root.
  Unsafe existing paths are rejected without changing their permissions. Trigger sockets
  are `0600`, accepted peers require Linux `SO_PEERCRED` for the current user, and cleanup
  removes only the registered socket inode while its parent remains safe.
- **IBus socket security**: The separate IBus control socket requires a private `XDG_RUNTIME_DIR`, a 0700 VOCO directory, a 0600 socket, Linux `SO_PEERCRED` same-user verification on both ends, one app connection, bounded protocol-v6 JSON messages, ordered request IDs, and no `/tmp` fallback
- **Input-source safety**: VOCO never selects, switches, restores, registers, or restarts a desktop input source. Its package only advertises a rank-zero persistent component that the user explicitly enables
- **Safe default**: Generic IBus mutation is disabled at the native client and protocol-v6 engine
  dispatch boundaries. This does not disable the separately enabled desktop-paste route. Actual
  WebKit tests showed that focus can move between fields without changing IBus identity, metadata
  or cursor geometry; the old context-token mechanism is not sufficient authorization.
- **Exact-element browser authorization**: An explicit tab action enables the adapter. A trusted
  browser chord captures a concrete eligible DOM element and document lifetime. Existing value,
  selection, connectedness, focus and eligibility are checked locally before a synchronous
  `setRangeText`, including after cancelable page hooks. Leaving and returning to the same field
  does not revive ownership. Password controls and recognized sensitive metadata, rich editors and selected ranges are
  rejected. A plain text field can still contain sensitive information without declaring it;
  eligibility is not a universal sensitivity detector. A direct-element write has a native
  undo-history limitation.
- **Browser transport**: The host validates a fixed extension origin; both Unix endpoints check
  same-user kernel credentials and private runtime/socket modes. Frames are bounded to 1 MiB.
  Request IDs, document nonces, connection generations, one-use tokens, native-allocated session
  IDs, sequences and exact committed counts prevent stale requests from being rebound to a new
  authorized session. This does not isolate already-compromised same-user processes.
- **Bounded browser authorization**: Triggers expire after two seconds; sessions last at most ten
  minutes. Each claim/append expires after 1,500 milliseconds and is checked immediately before
  mutation, including after page hooks, while the broker waits two seconds. This assumes a shared
  trustworthy host clock and does not cover arbitrary clock rollback.
- **No uncertain mutation retry**: Matching recipient receipts prove individual browser appends.
  Timeout, disconnection, malformed/mismatched receipts or uncertain mutation outcomes cannot
  authorize replay or fallback insertion. An already acknowledged final receipt remains recorded
  even after a later disconnect. Recovery must not imply that an uncertain write definitely failed.
- **Concurrency safety**: Preview transcription uses `try_lock` to skip work while the decoder is busy; final and canonical requests serialize access to the cached Whisper context.
- **Atomic downloads**: Model written to .tmp then renamed, preventing corrupt partial files
- **Structured logging**: No audio content logged, level-filtered output via env_logger

## Candidate speech worker and diagnostics

The candidate starts a local worker from an absolute file path (default
`/usr/lib/voco/speech/stream_worker.py`) with bounded request/response framing and
session/sequence validation. Failed workers are reaped; no success is fabricated
from a missing or malformed response. Developer path/model overrides run inside
the same-user trust boundary and must not be treated as untrusted-code isolation.
Package model/native digests establish provenance, not safety of arbitrary replacements.

`VOCO_PERFORMANCE_LOG=1` enables bounded asynchronous metadata logs in both app and
worker. Fixed error categories, request stages, counts, timing and process resource
metrics omit audio, text, clipboard values, URLs and window titles. Sanitized startup
stderr may be the only available evidence before the metrics subsystem starts.
The worker checks its metrics directory with `lstat` and opens metric files with
no-follow and nonblocking flags. Opened files must be owned, private, regular and
single-linked; unsafe paths are rejected without chmodding their targets. A finite
`worker_metrics_unavailable` warning marks loss of coverage while recognition continues.
This is filesystem hardening, not isolation from an already-compromised same-user process.
General stderr and explicit debug captures are separate surfaces; review them before
sharing. Routine logger enablement never grants permission to record microphone audio
or publish personal benchmark transcripts. See [diagnostic retention](../testing/laptop-performance.md).

## Data Storage Locations

| Data | Location |
|------|----------|
| Config | `~/.config/voco/config.json` |
| Legacy Whisper models | `~/.local/share/voco/models/` |
| Packaged NVIDIA model/runtime | `/usr/lib/voco/speech/` |
| Opt-in application metrics | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/performance/` |
| Opt-in worker metrics | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/stream-performance/` |
| Update result cache | `~/.config/voco/update-cache.json` |
| Privacy-safe timing trace | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl` |
| Optional debug WAV and transcript timeline | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures/` |
| IBus app control | `$XDG_RUNTIME_DIR/voco/ibus-engine.sock` (transient socket only) |
| Browser broker | `$XDG_RUNTIME_DIR/voco-browser/exact-field.sock` (transient socket only) |

## Privacy

- Normal dictation audio is processed locally and is not sent to an external transcription service
- No telemetry, analytics, or crash reporting
- Dictation transcripts normally remain in memory. With debug capture explicitly enabled, the JSON
  timeline persists transcript, preview, canonical-chunk, and cursor-delivery diagnostic data next
  to the captured WAV until the user deletes both files
- whisper.cpp logging is suppressed (no audio content logged)
- Automatic and manual update checks request only GitHub release metadata; they do not upload audio
  or transcripts
- The input engine rejects transcript mutation requests. The browser extension retains its captured
  field checks and receipt journal in memory; existing page content, field names and URLs are not
  exported to the broker. Dictated append text is necessarily sent to the authorized extension.
- A malicious process already running as the same desktop user remains inside the local-user trust boundary

## Retention and Deletion

VOCO does not automatically delete completed debug captures. Treat their WAV and JSON files as
sensitive voice and transcript data. Delete all debug captures with:

```bash
rm -rf -- "${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures"
```

Removing the VOCO package does not remove per-user XDG data. See the uninstall commands in
[Install](../install.md) when local config, models, caches, timing traces, and captures should also
be removed.


## Permissions Required

| Permission | Purpose |
|-----------|---------|
| Microphone | Audio capture for dictation |
| File system | Config and model storage (XDG dirs) |
| Input group (Wayland, optional) | evdev hotkey fallback and legacy ydotool API, not required for manual copying |
| Browser activeTab/scripting/nativeMessaging | Explicit-tab adapter injection and local native host communication |



> The following dated reviews describe earlier revisions. Removed assistant surfaces
> are historical; retained delivery and dependency findings still need their stated checks.

## Current review scope

The current [`+local6` Stop-delivery work](../testing/stop-delivery-review-2026-09-15.md)
preserves focus-generation and recipient-content checks. A bounded recording scope
moves the existing X11 shortcut grab to the exact input-focus window; it does not
authorize delivery based on a matching PID, title, focus-loss duration or returned
focus. An initially valid target token is never refreshed. While scoped ownership
is registered, further writes require both the normal target check and a current,
active, healthy native scope. Wayland/unsupported no-op routes retain their prior contract.

Main-renderer reload advances a native epoch synchronously; old-scope cleanup then
runs under the delivery lock and selects only older epochs. Begin uses the epoch
captured before its preflight probe, validates it before/after acquisition and
cleans an acquisition overtaken by reload. This closes orphaned shortcut ownership
and stale Begin races. Generic paste IPC itself has no renderer epoch; do not infer
universal cancellation of every queued paste across reload from this bounded fix.

Arbitration does not conflate passive observation with consumed input. A real X11
callback from `owner_events=false` has already consumed the chord; the destination
IBus engine cannot consume that same grabbed event. Passive evdev keeps suppression
for in-flight polls and unexpired IBus authority. Registration/readiness depends on
completed Armed/Uncertain authority, not an arbitrary pending poll. Shared debounce,
stale plugin-generation rejection and the one-second IBus bound remain. New finite
input-event traces expose suppression/consumed-during-poll decisions without recording
keys, targets, titles or content, and do not emit on every poll.
The strict C matrix passed 34 selected cases from 35 attempts, including eight
proven focus-departure negatives. This is bounded isolated GTK/X11 evidence;
the excluded coverage-precondition attempt remains visible. Artifact integrity
and native installation are attested separately by external exact-SHA receipts,
not inferred from a package version or this packaged document.
Five selected userspace continuation cases passed from eight attempts and all 65
model-protocol checks passed. The three original root-only assertion failures are
retained; corrected fixtures proved the active IBus route with real Start/Stop.
This is not default-desktop or physical-device qualification. Active-owner full-app
reload remains unqualified despite passing deterministic epoch tests.

The native actor binds scope to manager, registration generation and nonce, with
fixed 650-second expiry and bounded command waits. Cancellation and end serialize
with in-flight observation; uncertain/restoration failures remain visible and
block ready claims. Automatic restoration proves cleanup, not continued delivery
authority. The watchdog requires a responsive actor/X connection; it is not an
atomic ownership or guaranteed-time assertion on a failed X server. Other X clients
may compete for bindings, so failed restoration must never be hidden.
The actor's event-driven X/command wait removes periodic idle polling; interrupted
waits recompute the remaining original expiry, and fd failure degrades active scope.
Readiness and bounded cleanup must remain correct under event backlogs, full wake
buffers and actor shutdown. Callback tests scheduled after an XSync acknowledgement
do not establish atomic focus-switch-plus-shortcut behavior in one server batch.

The existing dependency is pinned as `global-hotkey` 0.7.0, upstream commit
`dc7a755790ccbef1971b6c59eceb90d107df1feb`, with archive/file checksums and original
licenses in [vendor provenance](../../vendor/global-hotkey/VOCO-UPSTREAM.json)
and [patch documentation](../../vendor/global-hotkey/VOCO-PATCH.md). This introduces
no new engine or user shortcut/fallback configuration. Logical frontend lifecycle
events contain finite names and recording identity; they are not physical-scope
evidence on no-op routes and do not expose window IDs or target text. Final native
regressions and dependency review remain separate qualification gates.

The [cross-Linux review](../testing/cross-linux-review-2026-09-15.md) combines bounded
static boundary review with isolated negative-path tests. No exploitable defect was
established in the reviewed browser/native-worker boundaries; this is not a complete
repository or dependency security certification. Diagnostic file and trigger-path
hardening addresses concrete failure modes without claiming a demonstrated remote
attack. Final candidate and distribution receipts remain separate gates.

## Current dependency audit

Fresh isolated npm/Rust audits on 15 September exited 0 with zero vulnerability-class
findings. RustSec database commit was `e2e640471715167f73e22eaf761f2e547adafeec`.
Seven maintenance notices and two unsoundness notices remain visible; no exemption
was added. Native shared libraries, models and distro packages are outside this
lockfile-audit scope.

RUSTSEC-2026-0097 affects rand 0.7.3 under conditions including its `log` feature and
a logger re-entering thread RNG. The resolved feature tree does not enable that
feature; the dependency enters through phf generation/selector build dependencies.
This assessment must be revisited if the graph or logging changes. For
RUSTSEC-2024-0429, glib 0.18.5 remains pinned by GTK/WebKit/Tauri. A lexical search
found no `array_iter_str`/`VariantStrIter` use outside glib in the inspected VOCO and
cached lockfile sources. That is neither complete reachability proof nor a fix;
the upstream maintenance/backport work remains. The seven maintenance notices
cover fxhash, proc-macro-error and five unic crates. See [the current review](../testing/stop-delivery-review-2026-09-15.md)
for raw receipt locations and application acceptance limits.

## Known Limits and Verification

- Generic IBus input contexts do not establish per-widget identity; IBus mutation remains
  disabled. The separate desktop paste path uses best-effort focus metadata, not exact-widget
  ownership. It cannot universally detect protected/sensitive fields, user caret movement within
  the same field, or whether paste was consumed. Availability is not universal app support.
- Exact-field browser support is constrained to eligible plain-text controls. Direct mutation may
  bypass native browser undo history; framework-controlled and rich editors need separate evidence.
- The recipient expiry assumes the shared host clock; arbitrary clock changes are not covered.
- Desktop ydotool delivery uses broad input privileges and does not prove target consumption.
  Keep the target focused; never treat key-dispatch completion as a recipient receipt.
- Development package creation and isolated synthetic tests do not mean the candidate has been
  installed, published, or validated across all Linux desktops and physical microphones.

See [browser broker acceptance](../testing/browser-broker.md) and the current native evidence for
measured guarantees and remaining coverage. These are bounded engineering claims, not a claim of
world-leading or universal transcription quality.
