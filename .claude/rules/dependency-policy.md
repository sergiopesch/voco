# Dependency Policy

## Principles
- Minimal dependency surface: every dependency must justify its inclusion
- Prefer stable, widely-used packages with active maintenance
- Prefer MIT/Apache-2.0 licensed packages
- No cloud SDKs in core — local-first by design

## Current Dependencies (Justified)

### Desktop App (apps/desktop)
| Package | Purpose | Justification |
|---------|---------|---------------|
| @tauri-apps/api | Desktop bridge | Tauri IPC for Rust backend communication |
| react/react-dom | UI | Lightweight UI framework for Tauri WebView |
| zustand | State | Lightweight, minimal API, no boilerplate |
| tailwindcss | Styling | Utility-first CSS |
| vite | Build | Fast dev server and bundler for Tauri frontend |

### Rust Backend (apps/desktop/src-tauri)
| Crate | Purpose | Justification |
|-------|---------|---------------|
| tauri | Desktop shell | Core desktop runtime |
| tauri-plugin-shell | Shell access | Process spawning for insertion tools |
| tauri-plugin-global-shortcut | Global hotkey | Register Alt+D system-wide shortcut |
| serde/serde_json | Serialization | Tauri command data exchange |
| dirs | Path resolution | XDG standard directory resolution |
| whisper-rs | ASR engine | Local speech-to-text via whisper.cpp bindings |
| reqwest | HTTP client | One-time model download from Hugging Face |
| evdev | Input events | Fallback global hotkey via raw keyboard on Wayland |
| log | Logging facade | Structured log levels (info, warn, error, debug) |
| env_logger | Log output | Level-filtered stderr logging, configurable via RUST_LOG |
| base64 | Binary encoding | Decode base64-encoded audio from frontend IPC |
| sha2 | Integrity check | SHA256 verification of downloaded model |
| webkit2gtk | WebView control | Auto-grant mic permissions in WebKitGTK |
| glib | GTK bindings | Required by webkit2gtk for type casting |

## Adding Dependencies
- Check if the need can be met with existing deps or native APIs first
- Run `npm audit` after adding JS deps
- Run `cargo audit` after adding Rust crates
- Document the justification in this table
- Avoid packages with >5 transitive dependencies when a lighter alternative exists

## Removing Dependencies
- Remove unused dependencies promptly
- Check for imports before removing
