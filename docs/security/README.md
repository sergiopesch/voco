# Security

## Design Principle: Local-First, No VOCO Account

Core dictation runs locally and requires no VOCO account, sign-in, subscription, telemetry, or
third-party credential. The complete NVIDIA candidate bundles its model; legacy Whisper setup can download
its separate model. Automatic GitHub Releases metadata checks occur after startup. Local-model, OpenClaw, and OpenAI Realtime
connections occur only when the user explicitly configures or starts those optional modes.

## Threat Model

### Assets

- User audio data (normally transient; the explicit debug-capture mode persists one recording)
- User configuration (stored locally)
- ASR model files (stored locally)
- Dictated text retained in VOCO, delivered through default desktop paste, or sent to an explicitly authorized browser element
- Captured browser element value and selection checked transiently inside the extension
- Clipboard contents (replaced by native desktop delivery or explicit Copy; clipboard managers may retain dictated text)
- Optional OpenAI and OpenClaw credentials managed outside VOCO's core configuration

### Attack Surface

- Tauri IPC commands (frontend -> Rust)
- Private VOCO app -> persistent shortcut-only IBus engine socket
- Chromium extension, native-messaging host and exact-field broker socket
- Audio capture (WebView getUserMedia)
- Native desktop paste and compatibility insertion via external helpers (ydotool, xdotool, xclip, wl-copy)
- Local Python speech worker, bounded IPC, native CPU libraries and packaged model
- Optional OpenClaw CLI execution when the transcript target is set to OpenClaw
- Optional localhost local-model calls for transcript enhancement or local assistant answers
- Optional OpenAI Realtime HTTPS/WebSocket connection when realtime conversation is started
- ASR model loading (local files)
- First-run model download (HTTPS from Hugging Face)
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
- **No VOCO account**: Core dictation has no VOCO identity or credential; optional third-party
  credentials are needed only for the corresponding OpenAI or OpenClaw feature
- **Tauri CSP**: Restrictive content security policy, no remote scripts
- **Scoped permissions**: WebView permission grants restricted to UserMedia (microphone) only
- **Input validation**: Audio length limit (10 minutes), text size limit (100KB), empty input rejected
- **Bounded legacy downloads**: Whisper model downloads use a 200 MiB ceiling. This limit is not
  the packaged NVIDIA model size. The NVIDIA assembler verifies its separately pinned digest
- **External link allowlist**: WebView-triggered external opens are limited to VOCO GitHub release pages
- **Local core storage**: Config, models, state, and debug captures use local paths; VOCO does not
  provide cloud sync
- **Shell safety**: Text passed as arguments (not interpolated), `--` separators used
- **OpenClaw bridge safety**: The OpenClaw agent id is validated, transcript and prompt sizes are bounded, the CLI is launched without shell interpolation, and the request is timed out
- **Loopback HTTP safety**: Local model URLs are parsed structurally, require an explicit loopback
  host and port, reject credentials, and never follow redirects
- **Local model safety**: Transcript enhancement and local assistant mode only accept loopback HTTP endpoints and do not attach auth headers. Their dedicated client ignores proxies, disables redirects, and pins `localhost` resolution to IPv4/IPv6 loopback. Incomplete, truncated, refused, or tool-call responses are rejected; enhancement failures preserve the raw recognition
- **Realtime browser safety**: Browser collaboration remains disabled in this candidate. The Realtime
  schema advertises no browser tool, the frontend returns a fixed unavailable result for any
  unexpected function call without invoking OpenClaw, and the backend compatibility command rejects
  every action without a network or browser call. This prevents authenticated-tab disclosure and
  avoids claiming an SSRF guarantee that VOCO cannot enforce across OpenClaw DNS resolution,
  redirects, final URLs, or private-network overrides. A strict public-URL parser remains covered as
  defense in depth, but passing it does not authorize navigation
- **Realtime key handling**: The standard OpenAI API key is read only by the Tauri backend from the
  process environment or `~/.openclaw/realtime.env`; the frontend never receives the standard API
  key. On Unix, the file must be a current-user-owned regular file with no group or world access;
  symlinks and files larger than 64 KiB are rejected, and nonblocking/no-controlling-terminal open
  flags prevent FIFO or device paths from hanging the check
- **Explicit debug persistence**: Debug capture is disabled unless `VOCO_DEBUG_CAPTURE_AUDIO` is
  exactly `1`. At most the first completed dictation in an app process is saved. The capture
  directory is verified as a current-user-owned real directory and set to `0700`; new WAV and JSON
  files are created without overwrite at `0600`, and VOCO attempts to remove partial pairs after a
  write failure
- **Clipboard boundaries**: The current desktop route deliberately uses clipboard paste for
  progressive/final delivery. Text replaces the clipboard and stays there; leading join spaces
  can be typed separately. Helpers cannot atomically prove recipient consumption or preserve all
  MIME formats. No delayed clipboard restore or automatic uncertain replay is performed
- **Socket security**: The trigger socket is owner-only. The separate IBus control socket requires a private `XDG_RUNTIME_DIR`, a 0700 VOCO directory, a 0600 socket, Linux `SO_PEERCRED` same-user verification on both ends, one app connection, bounded protocol-v5 JSON messages, ordered request IDs, and no `/tmp` fallback
- **Input-source safety**: VOCO never selects, switches, restores, registers, or restarts a desktop input source. Its package only advertises a rank-zero persistent component that the user explicitly enables
- **Safe default**: Generic IBus mutation is disabled at the native client and protocol-v5 engine
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
| Optional local model endpoint | `~/.config/voco/config.json` |
| Optional realtime API key | `~/.openclaw/realtime.env` |
| Optional OpenClaw Gateway token | OpenClaw-managed env/auth files under `~/.openclaw/` |
| IBus app control | `$XDG_RUNTIME_DIR/voco/ibus-engine.sock` (transient socket only) |
| Browser broker | `$XDG_RUNTIME_DIR/voco-browser/exact-field.sock` (transient socket only) |

## Privacy

- Normal dictation audio is processed locally and is not sent to an external transcription service
- If local transcript enhancement or local assistant mode is enabled, transcript text is sent only to the configured localhost model endpoint
- In OpenClaw mode, the transcript text is sent to the configured local OpenClaw CLI agent; what happens after that depends on the user's OpenClaw provider and agent configuration
- Only after the user starts realtime conversation, microphone audio is streamed to OpenAI
  Realtime over WebSocket until the session is stopped
- Realtime requests use neutral user wording and do not send a universal person-specific safety
  identifier shared across VOCO installations
- Realtime browser collaboration is disabled: OpenAI receives no browser URL, tab metadata, page
  content, or snapshot from VOCO
- No telemetry, analytics, or crash reporting
- Dictation transcripts normally remain in memory. With debug capture explicitly enabled, the JSON
  timeline persists transcript, preview, canonical-chunk, and cursor-delivery diagnostic data next
  to the captured WAV until the user deletes both files
- Config stores preferences and user-supplied values such as local endpoints, prompts, model names,
  and OpenClaw agent names. Review it before sharing; optional API keys are not stored there
- whisper.cpp logging is suppressed (no audio content logged)
- Automatic and manual update checks request only GitHub release metadata; they do not upload audio
  or transcripts
- The input engine rejects transcript mutation requests. The browser extension retains its captured
  field checks and receipt journal in memory; existing page content, field names and URLs are not
  exported to the broker. Dictated append text is necessarily sent to the authorized extension.
  Browser integration does not enable Realtime browser tools or page disclosure to OpenAI.
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

`~/.openclaw/realtime.env` and other files under `~/.openclaw/` are outside VOCO's XDG state and
may be shared with OpenClaw or other tools. VOCO neither creates nor removes them during package
installation or uninstall, and it only reads the realtime key file. Delete that key file separately
only after confirming nothing else uses it.

Local model acceptance criteria are documented in [Local Intelligence](../local-intelligence-spec.md).

## Permissions Required

| Permission | Purpose |
|-----------|---------|
| Microphone | Audio capture for dictation |
| File system | Config and model storage (XDG dirs) |
| Input group (Wayland, optional) | evdev hotkey fallback and legacy ydotool API, not required for manual copying |
| Browser activeTab/scripting/nativeMessaging | Explicit-tab adapter injection and local native host communication |

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
