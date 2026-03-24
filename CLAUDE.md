# Voice Dictation - Claude Code Project Instructions

## Purpose
Free Linux- and macOS-native desktop dictation application. Local-first, privacy-conscious, no account or subscription required. Users speak, the app transcribes locally, and inserts text into the active application.

## Product Baseline
- Free core experience — no subscription, no account, no sign-in
- Local-first: local audio capture, local transcription, no telemetry
- No cloud dependency for core dictation flow
- Linux and macOS as first-class desktop targets
- Installable and usable immediately after download

## Stack
- **Desktop shell**: Tauri 2 (Rust backend + WebView frontend)
- **Frontend**: React 19, Vite, TypeScript 5, Tailwind CSS 4
- **State**: Zustand
- **Backend language**: Rust (Tauri commands, native integrations)
- **ASR engine**: whisper.cpp (via whisper-rs bindings, ggml-base.en model)
- **Text insertion**: Platform-specific (ydotool/xdotool on Linux, clipboard fallback)
- **Global hotkey**: Tauri global-shortcut plugin (primary), evdev (Linux fallback), Unix socket (external trigger)

## Core Commands
```bash
./scripts/setup.sh  # One-command setup (deps + npm install)
npm run dev          # Start Tauri dev (frontend + Rust backend)
npm run build        # Production Tauri build
npm run check        # TypeScript check
```

## Architecture
```
apps/desktop/              # Tauri desktop application
  src/                     # React frontend
    components/            # Overlay, ModelSetup
    hooks/                 # useDictation, useGlobalShortcut
    store/                 # Zustand store
    lib/                   # Tauri bridge
    types/                 # TypeScript types
  src-tauri/               # Rust backend
    src/lib.rs             # App setup, hotkey registration, commands
    src/tray.rs            # System tray icon and menu
    src/transcribe.rs      # whisper.cpp integration
    src/insertion.rs        # Text insertion (ydotool/xdotool/clipboard)
    src/config.rs          # Settings persistence
    capabilities/          # Tauri 2 permission declarations
scripts/
  setup.sh                 # One-command dependency setup
```

## Coding Conventions
- Functional React components only
- Zustand for global state; no prop drilling
- Tailwind utility classes; no CSS modules
- Path aliases via `@/` prefix in desktop app
- Rust: idiomatic Rust with serde for Tauri command serialization

## Testing Expectations
- Vitest for unit/integration tests
- Playwright for E2E tests
- Mock Tauri commands in frontend tests
- Create harnesses for system-level boundaries (mic, insertion)

## Documentation
- Keep README.md in sync with actual capabilities
- Document architectural decisions in `docs/decisions/`
- Security-sensitive changes require a note in `docs/security/`
- Platform-specific behavior documented in `docs/platform/`

## Security Constraints
- No authentication required — ever, for core functionality
- No network calls in default operation
- No telemetry by default
- Never commit `.env`, `.env.local`, or credential files
- Least privilege: only mic access and input insertion permissions
- Safe local storage with documented locations
- Dependency scrutiny: justify each significant addition

## Platform Requirements
### Linux
- Detect X11 vs Wayland session type and adapt insertion strategy
- Support PulseAudio and PipeWire for audio
- Handle GNOME, KDE, and common Wayland compositors
- Package targets: AppImage, .deb, Flatpak

### macOS
- Handle mic permission dialog (NSMicrophoneUsageDescription)
- Handle accessibility permissions for text insertion
- Package targets: .dmg, signed + notarized

## Completion Checklist
- [x] Tauri desktop app with Rust backend
- [x] Frontend builds with Vite (React + Tailwind)
- [x] Local ASR engine integrated (whisper.cpp via whisper-rs)
- [x] Text insertion works on Linux (ydotool/xdotool + clipboard fallback)
- [x] Global hotkey (Alt+D) via Tauri plugin + evdev + socket fallbacks
- [x] Tauri capabilities configured for window/event/shortcut permissions
- [x] Audio capture end-to-end (WebView getUserMedia → ScriptProcessorNode)
- [x] Full vertical slice: dictate → transcribe → insert (confirmed working 2026-03-24)
- [x] System tray integration with dynamic icon (white=idle, red=recording)
- [x] Invisible window — tray-only UX, no visible rectangle
- [x] Setup script for one-command installation
- [ ] Settings persist via Rust config
- [ ] macOS text insertion (Accessibility API)
- [ ] ydotoold setup documentation for Wayland text insertion
