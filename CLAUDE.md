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
npm run dev       # Start Tauri dev (frontend + Rust backend)
npm run build     # Production Tauri build
npm run lint      # ESLint (desktop frontend)
npm run check     # TypeScript check all workspaces
npm run test      # Run tests across workspaces
```

## Architecture
```
apps/
  desktop/              # Tauri desktop application
    src/                # React frontend
      components/       # UI components
      hooks/            # React hooks
      store/            # Zustand store
      lib/              # Tauri bridge, utilities
      types/            # TypeScript types
    src-tauri/          # Rust backend
      src/              # Tauri commands, config, platform logic

packages/
  shared/               # Shared types and constants
  audio/                # Microphone capture, device enumeration, buffering
  asr/                  # ASR engine abstraction, local transcription
  insertion/            # Text insertion strategies (X11, Wayland, macOS, clipboard)
  formatting/           # Transcript cleanup, punctuation
  config/               # Typed config, defaults
  logging/              # Structured logging

docs/
  architecture/         # Architecture docs
  security/             # Security docs
  testing/              # Testing docs
  decisions/            # ADRs
  platform/             # Platform-specific docs
```

## Coding Conventions
- Functional React components only
- Zustand for global state; no prop drilling
- Tailwind utility classes; no CSS modules
- Path aliases via `@/` prefix in desktop app
- Rust: idiomatic Rust with serde for Tauri command serialization
- Packages expose types and functions via `src/index.ts`
- npm workspaces for monorepo management

## Testing Expectations
- Vitest for unit/integration tests
- Playwright for E2E tests
- Test packages independently
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
- [x] Monorepo structure with Tauri app and packages
- [x] Rust backend compiles with config commands
- [x] Frontend builds with Vite (React + Tailwind)
- [x] TypeScript checks pass across all packages
- [x] Local ASR engine integrated (whisper.cpp via whisper-rs)
- [x] Text insertion works on Linux (ydotool/xdotool + clipboard fallback)
- [x] Global hotkey (Alt+D) via Tauri plugin + evdev + socket fallbacks
- [x] Tauri capabilities configured for window/event/shortcut permissions
- [ ] Tauri dev mode runs (needs system deps: pkg-config, libglib2.0-dev)
- [ ] Audio capture tested end-to-end
- [ ] Settings persist via Rust config
- [ ] Full vertical slice: dictate → transcribe → insert
- [ ] macOS text insertion (Accessibility API)
