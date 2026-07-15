# Security

## Design Principle: Local-First, No VOCO Account

Core dictation runs locally and requires no VOCO account, sign-in, subscription, telemetry, or
third-party credential. Normal network access is limited to the first-run model download and an
automatic GitHub Releases metadata check after startup. Local-model, OpenClaw, and OpenAI Realtime
connections occur only when the user explicitly configures or starts those optional modes.

## Threat Model

### Assets

- User audio data (normally transient; the explicit debug-capture mode persists one recording)
- User configuration (stored locally)
- ASR model files (stored locally)
- Dictated text carried transiently to the owned IBus preedit engine
- Clipboard contents (temporarily modified during fallback insertion)
- Optional OpenAI and OpenClaw credentials managed outside VOCO's core configuration

### Attack Surface

- Tauri IPC commands (frontend -> Rust)
- Private VOCO app -> persistent IBus engine socket
- Audio capture (WebView getUserMedia)
- Text insertion via shell commands (ydotool, xdotool, xclip, wl-copy)
- Optional OpenClaw CLI execution when the transcript target is set to OpenClaw
- Optional localhost local-model calls for transcript enhancement or local assistant answers
- Optional OpenAI Realtime HTTPS/WebSocket connection when realtime conversation is started
- ASR model loading (local files)
- First-run model download (HTTPS from Hugging Face)
- Automatic and manual GitHub Release checks (HTTPS to api.github.com)
- Optional debug WAV and transcript-timeline persistence when `VOCO_DEBUG_CAPTURE_AUDIO=1`

## Current Protections

- **Minimal default network**: First-run model download and automatic GitHub Release metadata checks
  only; successful update results are cached for up to six hours
- **Model integrity**: The pinned SHA-256 is verified for both existing caches and new downloads
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
- **Bounded downloads**: Model downloads are streamed to disk with a 200 MiB ceiling before use
- **External link allowlist**: WebView-triggered external opens are limited to VOCO GitHub release pages
- **Local core storage**: Config, models, state, and debug captures use local paths; VOCO does not
  provide cloud sync
- **Shell safety**: Text passed as arguments (not interpolated), `--` separators used
- **OpenClaw bridge safety**: The OpenClaw agent id is validated, transcript and prompt sizes are bounded, the CLI is launched without shell interpolation, and the request is timed out
- **Loopback HTTP safety**: Local model URLs are parsed structurally, require an explicit loopback
  host and port, reject credentials, and never follow redirects
- **Local model safety**: Transcript enhancement and local assistant mode only accept loopback HTTP endpoints and do not attach auth headers
- **Realtime browser safety**: Browser collaboration is fully disabled in 2026.0.21. The Realtime
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
- **Clipboard preservation**: Original clipboard contents restored after fallback insertion (only when prior content was text and save succeeded)
- **Socket security**: The trigger socket is owner-only. The separate IBus control socket requires a private `XDG_RUNTIME_DIR`, a 0700 VOCO directory, a 0600 socket, Linux `SO_PEERCRED` same-user verification on both ends, one app connection, bounded protocol-v3 JSON messages, ordered request IDs, and no `/tmp` fallback
- **Input-source safety**: VOCO never selects, switches, restores, registers, or restarts a desktop input source. Its package only advertises a rank-zero persistent component that the user explicitly enables
- **Canonical preedit ownership**: With enhancement off, rolling previews remain revisable preedit and never become normal text merely through preview agreement. Every canonical checkpoint atomically supplies the exact previously acknowledged prefix and one exact append; an out-of-sequence prefix is rejected. The engine never reads surrounding text or exposes a deletion command. Every real focus entry requires a fresh, established, non-sensitive content-type report for that exact input context; focus loss clears the proof, and neither same-context re-entry nor a synthetic global-engine proxy may reuse it. Terminals, password/PIN fields, private/hidden hints, missing or ambiguous metadata, and clients without preedit capability fail closed to VOCO preview. Focus, context, target destruction, input-source, session, ordinary-key, renderer reload, and connection changes invalidate the lease and preserve acknowledged canonical text
- **No uncertain mutation retry**: Ordered engine rejection is distinguishable from an uncertain timeout, disconnect, malformed response, or response-order failure. After an uncertain IBus mutation, the app drops the private socket and never retries the checkpoint or falls back to global insertion, avoiding duplicate text in an unknown target state
- **Concurrency safety**: Transcription uses try_lock to fail fast if already in progress
- **Atomic downloads**: Model written to .tmp then renamed, preventing corrupt partial files
- **Structured logging**: No audio content logged, level-filtered output via env_logger

## Data Storage Locations

| Data | Location |
|------|----------|
| Config | `~/.config/voco/config.json` |
| Models | `~/.local/share/voco/models/` |
| Update result cache | `~/.config/voco/update-cache.json` |
| Privacy-safe timing trace | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl` |
| Optional debug WAV and transcript timeline | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures/` |
| Optional local model endpoint | `~/.config/voco/config.json` |
| Optional realtime API key | `~/.openclaw/realtime.env` |
| Optional OpenClaw Gateway token | OpenClaw-managed env/auth files under `~/.openclaw/` |
| IBus app control | `$XDG_RUNTIME_DIR/voco/ibus-engine.sock` (transient socket only) |

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
- The persistent input engine does not log, return, or store transcript payloads; a malicious process already running as the same desktop user remains inside the local-user trust boundary

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
| Input group (Wayland) | evdev hotkey listener, ydotool access |

## Known Gaps

- [x] ~~No model file integrity verification~~ — pinned SHA-256 verified on cached files and downloads
- [ ] Text insertion could interact with sensitive input fields
- [ ] ydotool requires uinput access which is a broad input privilege
