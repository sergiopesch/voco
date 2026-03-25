# Security

## Design Principle: Local-First, Zero-Auth
The app runs entirely locally with no authentication, no cloud accounts, and no network calls after first-run model download.

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

## Current Protections
- **Minimal network**: Only first-run model download (HTTPS, with timeouts)
- **No auth**: No credentials to steal
- **Tauri CSP**: Restrictive content security policy, no remote scripts
- **Input validation**: Audio length limit (5 min), text size limit (100KB), empty input rejected
- **Local storage only**: Config in XDG dirs, no cloud sync
- **Shell safety**: Text passed as arguments (not interpolated), `--` separators used
- **Clipboard preservation**: Original clipboard contents restored after fallback insertion

## Data Storage Locations
| Data | Location |
|------|----------|
| Config | `~/.config/voice/config.json` |
| Models | `~/.local/share/voice/models/` |

## Privacy
- Audio is processed locally and never sent to external services
- No telemetry, analytics, or crash reporting
- Transcripts are not persisted (in-memory only)
- Config contains only user preferences, no PII
- whisper.cpp logging is suppressed (no audio content logged)

## Permissions Required
| Permission | Purpose |
|-----------|---------|
| Microphone | Audio capture for dictation |
| File system | Config and model storage (XDG dirs) |
| Input group (Wayland) | evdev hotkey listener, ydotool access |

## Known Gaps
- [ ] No model file integrity verification (checksum)
- [ ] Text insertion could interact with sensitive input fields
- [ ] ydotool requires uinput access which is a broad input privilege
