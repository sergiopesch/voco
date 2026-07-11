# Security

## Design Principle: Local-First, Zero-Auth
The app runs locally with no authentication by default. Network access is limited to first-run model download, optional GitHub Release checks for update awareness, optional user-enabled localhost local-model calls, optional user-enabled OpenClaw CLI/Gateway calls, and optional user-enabled OpenAI Realtime voice sessions.

## Threat Model

### Assets
- User audio data (transient, not persisted beyond current session)
- User configuration (stored locally)
- ASR model files (stored locally)
- Clipboard contents (temporarily modified during fallback insertion)

### Attack Surface
- Tauri IPC commands (frontend -> Rust)
- Audio capture (WebView getUserMedia)
- Text insertion via shell commands (ydotool, xdotool, xclip, wl-copy)
- Optional OpenClaw CLI execution when the transcript target is set to OpenClaw
- Optional localhost local-model calls for transcript enhancement or local assistant answers
- Optional OpenClaw Gateway browser tool invocation from realtime voice mode
- Optional OpenAI Realtime HTTPS/WebSocket connection when realtime conversation is started
- ASR model loading (local files)
- First-run model download (HTTPS from Hugging Face)
- Optional GitHub Release checks (HTTPS to api.github.com)

## Current Protections
- **Minimal default network**: First-run model download and optional GitHub Release checks only
- **Model integrity**: SHA256 verification of downloaded model before use
- **No auth**: No credentials to steal
- **Tauri CSP**: Restrictive content security policy, no remote scripts
- **Scoped permissions**: WebView permission grants restricted to UserMedia (microphone) only
- **Input validation**: Audio length limit (10 minutes), text size limit (100KB), empty input rejected
- **Bounded downloads**: Model downloads are streamed to disk with a 200 MiB ceiling before use
- **External link allowlist**: WebView-triggered external opens are limited to VOCO GitHub release pages
- **Local storage only**: Config in XDG dirs, no cloud sync
- **Shell safety**: Text passed as arguments (not interpolated), `--` separators used
- **OpenClaw bridge safety**: The OpenClaw agent id is validated, transcript and prompt sizes are bounded, the CLI is launched without shell interpolation, and the request is timed out
- **Loopback HTTP safety**: Local model and OpenClaw Gateway URLs are parsed structurally, require an explicit loopback host and port, reject credentials, and never follow redirects
- **Local model safety**: Transcript enhancement and local assistant mode only accept loopback HTTP endpoints and do not attach auth headers
- **OpenClaw browser safety**: Realtime browser control is routed through OpenClaw Gateway tool policy, uses the isolated `openclaw` browser profile by default, accepts only allowlisted actions, and rejects non-http(s) browser URLs
- **Realtime key handling**: The standard OpenAI API key is read only by the Tauri backend from the process environment or `~/.openclaw/realtime.env`; the frontend never receives the standard API key
- **Clipboard preservation**: Original clipboard contents restored after fallback insertion (only when prior content was text and save succeeded)
- **Socket security**: Unix socket restricted to owner (0600 permissions) with a private per-user fallback dir when `XDG_RUNTIME_DIR` is unavailable
- **Concurrency safety**: Transcription uses try_lock to fail fast if already in progress
- **Atomic downloads**: Model written to .tmp then renamed, preventing corrupt partial files
- **Structured logging**: No audio content logged, level-filtered output via env_logger

## Data Storage Locations
| Data | Location |
|------|----------|
| Config | `~/.config/voco/config.json` |
| Models | `~/.local/share/voco/models/` |
| Optional local model endpoint | `~/.config/voco/config.json` |
| Optional realtime API key | `~/.openclaw/realtime.env` |
| Optional OpenClaw Gateway token | OpenClaw-managed env/auth files under `~/.openclaw/` |

## Privacy
- Audio is processed locally and never sent to external services
- If local transcript enhancement or local assistant mode is enabled, transcript text is sent only to the configured localhost model endpoint
- In OpenClaw mode, the transcript text is sent to the configured local OpenClaw CLI agent; what happens after that depends on the user's OpenClaw provider and agent configuration
- In realtime conversation mode, microphone audio is streamed to OpenAI Realtime over WebSocket until the session is stopped
- In realtime browser collaboration, OpenAI receives compact browser tool results so it can speak back what is visible and suggest the next action
- No telemetry, analytics, or crash reporting
- Transcripts are not persisted (in-memory only)
- Config contains only user preferences, no PII
- whisper.cpp logging is suppressed (no audio content logged)
- Update checks only request GitHub release metadata; they do not upload audio or transcripts

Local model acceptance criteria are documented in [Local Intelligence](../local-intelligence-spec.md).

## Permissions Required
| Permission | Purpose |
|-----------|---------|
| Microphone | Audio capture for dictation |
| File system | Config and model storage (XDG dirs) |
| Input group (Wayland) | evdev hotkey listener, ydotool access |

## Known Gaps
- [x] ~~No model file integrity verification~~ — SHA256 verified on download
- [ ] Text insertion could interact with sensitive input fields
- [ ] ydotool requires uinput access which is a broad input privilege
