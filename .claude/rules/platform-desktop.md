# Desktop Platform Rules (Linux)

## General
- Linux is the only target platform
- Ubuntu is the primary reference environment
- The app must be installable and runnable locally without sign-in
- Use POSIX paths; never hardcode machine-specific paths
- Abstract platform-specific paths behind a utility

## Tauri Desktop Shell
- Tauri 2 is the desktop runtime
- Rust backend handles: config persistence, platform detection, ASR model lifecycle, text insertion
- WebView frontend handles: UI, audio capture via Web APIs, user interaction
- IPC via Tauri invoke commands with typed arguments

## Session Awareness
- Detect X11 vs Wayland via XDG_SESSION_TYPE
- Adapt text insertion strategy based on session type
- Do not assume one insertion method works everywhere

## Audio
- Microphone access depends on PulseAudio or PipeWire
- Handle `NotAllowedError` and `NotFoundError` from `getUserMedia`
- Flatpak/Snap may need portal permissions for mic access

## Desktop Environments
- Plan for GNOME, KDE, and common Wayland/X11 setups on Ubuntu
- Document unsupported cases honestly
- Do not claim all compositors or desktop environments work equally

## Text Insertion
- Wayland: ydotool (may require ydotoold, uinput access, or input group membership)
- X11: xdotool type simulation
- Fallback: clipboard-preserving paste
- Always provide a fallback path when possible
- Document dependencies, permissions, and limitations for each path

## Packaging
- Target formats: .deb (primary), AppImage
- Account for audio subsystem sandboxing
- Respect XDG directory conventions for config/data/cache
- Tauri must declare audio device permissions

## Distribution Support
- Optimise for Ubuntu first
- Debian-derived distributions are the nearest compatibility target
- Other distributions are best-effort until tested
- Distinguish between tested, likely compatible, and experimental

## Paths
- Config: XDG config dir (`~/.config/voco`)
- Data: XDG data dir (`~/.local/share/voco`)
- Cache: XDG cache dir (`~/.cache/voco`)
- Never write outside XDG-standard locations
