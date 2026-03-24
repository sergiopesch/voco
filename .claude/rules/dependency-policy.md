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
| @tauri-apps/plugin-global-shortcut | Global hotkey | Alt+D shortcut registration from frontend (JS types) |
| @tauri-apps/plugin-shell | Shell access | Open URLs, spawn processes |
| react/react-dom | UI | Lightweight UI framework for Tauri WebView |
| zustand | State | Lightweight, minimal API, no boilerplate |
| tailwindcss | Styling | Utility-first CSS |
| vite | Build | Fast dev server and bundler for Tauri frontend |

### Rust Backend (apps/desktop/src-tauri)
| Crate | Purpose | Justification |
|-------|---------|---------------|
| tauri | Desktop shell | Core desktop runtime |
| tauri-plugin-shell | Shell access | Process spawning for ASR sidecars |
| tauri-plugin-global-shortcut | Global hotkey | Register Alt+D system-wide shortcut |
| serde/serde_json | Serialization | Tauri command data exchange |
| dirs | Path resolution | XDG/macOS standard directory resolution |
| whisper-rs | ASR engine | Local speech-to-text via whisper.cpp bindings |
| hound | WAV parsing | Audio format handling for whisper input |
| reqwest | HTTP client | One-time model download from Hugging Face |
| evdev (Linux) | Input events | Fallback global hotkey via raw keyboard on Wayland |
| webkit2gtk (Linux) | WebView control | Auto-grant mic permissions in WebKitGTK |
| glib (Linux) | GTK bindings | Required by webkit2gtk for type casting |

## Adding Dependencies
- Check if the need can be met with existing deps or native APIs first
- Run `npm audit` after adding JS deps
- Run `cargo audit` after adding Rust crates
- Document the justification in this table
- Avoid packages with >5 transitive dependencies when a lighter alternative exists

## Removing Dependencies
- Remove unused dependencies promptly
- Check for imports before removing
