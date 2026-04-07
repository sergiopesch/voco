# Security

## Design Principle: Local-First, Zero-Auth
The app runs entirely locally with no authentication and no cloud accounts. Network access is limited to first-run model download and optional GitHub Release checks for update awareness.

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
- ASR model loading (local files)
- First-run model download (HTTPS from Hugging Face)
- Optional GitHub Release checks (HTTPS to api.github.com)

## Current Protections
- **Minimal network**: First-run model download and optional GitHub Release checks only
- **Model integrity**: SHA256 verification of downloaded model before use
- **No auth**: No credentials to steal
- **Tauri CSP**: Restrictive content security policy, no remote scripts
- **Scoped permissions**: WebView permission grants restricted to UserMedia (microphone) only
- **Input validation**: Audio length limit (5 min), text size limit (100KB), empty input rejected
- **Local storage only**: Config in XDG dirs, no cloud sync
- **Shell safety**: Text passed as arguments (not interpolated), `--` separators used
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

## Privacy
- Audio is processed locally and never sent to external services
- No telemetry, analytics, or crash reporting
- Transcripts are not persisted (in-memory only)
- Config contains only user preferences, no PII
- whisper.cpp logging is suppressed (no audio content logged)
- Update checks only request GitHub release metadata; they do not upload audio or transcripts

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
