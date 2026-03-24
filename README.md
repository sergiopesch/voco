# Voice Dictation

Free, local-first desktop dictation for Linux and macOS. Press a hotkey, speak, and your words appear wherever your cursor is. No account, no cloud, no subscription.

## Quick Start

```bash
git clone https://github.com/sergiopesch/voice.git
cd voice
./scripts/setup.sh   # installs all dependencies
npm run dev           # launches the app
```

On first launch, the app prompts to download the speech model (~142 MB, one-time). After that, press **Alt+D** to dictate.

## How It Works

1. The app lives in your **system tray** (top bar, next to volume/battery)
2. Press **Alt+D** → speak → press **Alt+D** again
3. Text is transcribed locally and inserted where your cursor is

No visible window. No network calls. Everything runs on your machine.

## Features

- **Fully local** — audio never leaves your machine
- **No sign-in** — works immediately after install
- **Global hotkey** (Alt+D) — works from any application
- **System tray** — white mic (idle), red mic (recording)
- **Local ASR** — whisper.cpp (base.en model)
- **Smart insertion** — types into the focused app, clipboard fallback

## Requirements

The setup script handles most of this, but for reference:

| | Linux | macOS |
|---|---|---|
| **Runtime** | Node.js 18+, Rust | Node.js 18+, Rust, Xcode CLI |
| **Text insertion** | ydotool (Wayland) or xdotool (X11) | — |
| **Hotkey (Wayland)** | User in `input` group | — |

<details>
<summary>Manual dependency install (if not using setup script)</summary>

**Linux (apt)**:
```bash
sudo apt install pkg-config libglib2.0-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev
```

**Wayland text insertion**:
```bash
sudo apt install ydotool wl-clipboard
sudo usermod -aG input $USER  # then log out/in
```

**X11 text insertion**:
```bash
sudo apt install xdotool xclip
```
</details>

## Commands

```bash
npm run dev       # Start Tauri dev (frontend + Rust backend)
npm run build     # Production build
npm run check     # TypeScript type-check
```

## Architecture

```
apps/desktop/
  src/                React frontend (model setup)
  src-tauri/          Rust backend
    src/lib.rs        App setup, hotkey, commands
    src/tray.rs       System tray icon + menu
    src/transcribe.rs whisper.cpp integration
    src/insertion.rs  Text insertion (ydotool/xdotool/clipboard)
    src/config.rs     Settings persistence
```

## Stack

Tauri 2 (Rust + WebView) · React 19 · Vite · TypeScript · Tailwind CSS 4 · Zustand · whisper.cpp via whisper-rs

## License

MIT
