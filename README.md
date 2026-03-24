# Voice Dictation

Free, local-first desktop dictation for Linux and macOS. Speak, and your words are transcribed locally and inserted into the active application. No account, no subscription, no cloud dependency.

## How It Works

1. Launch the app — it lives in the **system tray** (top bar, next to volume/battery)
2. Press **Alt+D** to start dictating
3. Speak into your microphone — the tray icon turns red while recording
4. Press **Alt+D** again to stop
5. Text is transcribed locally via whisper.cpp and inserted where your cursor is

No visible window. The app runs entirely from the system tray.

## Features

- **Fully local** — audio never leaves your machine
- **No account or sign-in required**
- **System tray app** — no visible window, only a tray icon
- **Global hotkey** (Alt+D) works from any application
- **Local ASR** via whisper.cpp (base.en model, ~142 MB one-time download)
- **Smart text insertion** — types directly into the focused app (ydotool/xdotool), falls back to clipboard paste
- **Tray icon feedback** — white mic (idle), red mic (recording)

## Requirements

### Linux
- System dependencies for building:
  ```bash
  sudo apt install pkg-config libglib2.0-dev libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev
  ```
- For text insertion: `ydotool` (Wayland) or `xdotool` (X11), with `wl-copy`/`xclip` as clipboard fallback
- For evdev hotkey fallback (Wayland): add user to `input` group and log out/in:
  ```bash
  sudo usermod -aG input $USER
  ```
- Rust toolchain (rustup)
- Node.js 18+

### macOS
- Xcode command line tools
- Rust toolchain (rustup)
- Node.js 18+

## Getting Started

```bash
# Clone and install
git clone <repository-url>
cd voice
npm install

# Start in development mode
npm run dev

# On first launch, click "Download Model" to fetch the whisper base.en model (~142 MB)
# Then press Alt+D to start dictating
```

## Commands

```bash
npm run dev       # Start Tauri dev (frontend + Rust backend)
npm run build     # Production build
npm run check     # TypeScript check all workspaces
```

## Architecture

```
apps/desktop/               Tauri 2 desktop application
  src/                      React frontend (model setup UI)
  src-tauri/                Rust backend
    src/lib.rs              App setup, hotkey registration, commands
    src/tray.rs             System tray icon and menu
    src/transcribe.rs       whisper.cpp integration
    src/insertion.rs        Text insertion (ydotool/xdotool/clipboard)
    src/config.rs           Settings persistence
    capabilities/           Tauri 2 permission declarations

packages/                   Shared libraries (types, audio, config, etc.)
```

### Global Hotkey

Three mechanisms ensure Alt+D works across environments:

| Mechanism | Platform | Notes |
|-----------|----------|-------|
| Tauri global-shortcut plugin | X11, XWayland | Primary — registers via GDK/X11 |
| evdev raw input listener | Linux (any) | Reads hardware keyboard directly, needs `input` group |
| Unix socket | Linux | External trigger via `$XDG_RUNTIME_DIR/voice-dictation.sock` |

### Text Insertion

| Session | Primary | Fallback |
|---------|---------|----------|
| Wayland | ydotool type | wl-copy + ydotool Ctrl+V |
| X11 | xdotool type | xclip + xdotool Ctrl+V |

Clipboard contents are saved and restored after paste fallback.

## Stack

- **Desktop shell**: Tauri 2 (Rust + WebView)
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS 4
- **State**: Zustand
- **ASR**: whisper.cpp via whisper-rs
- **Audio capture**: Web Audio API (getUserMedia + ScriptProcessorNode)

## License

MIT
