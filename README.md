# Voice

Free, local-first desktop dictation for Linux. Press a hotkey, speak, and your words appear wherever your cursor is. No account, no cloud, no subscription.

> Tested on Ubuntu. Likely to work on similar Debian/Ubuntu-based systems. Other distributions are experimental.

## Install

```bash
git clone https://github.com/sergiopesch/voice.git
cd voice
./scripts/setup.sh --install
```

This installs dependencies, builds the app, and adds **Voice** to your application launcher. Find it next to your other apps, double-click to launch, and it appears in the system tray.

> First launch downloads the speech model (~142 MB, one-time). After that, everything runs offline.

## How It Works

1. Open **Voice** from your app launcher — it appears in the **system tray**
2. Press **Alt+D** — speak — press **Alt+D** again
3. Text is transcribed locally and typed where your cursor is

No visible window. Everything runs on your machine.

## Features

- **Fully local** — audio never leaves your machine
- **No sign-in** — works immediately
- **Global hotkey** (Alt+D) — works from any application
- **System tray** — mic icon turns red while recording
- **Local ASR** — whisper.cpp (base.en model)
- **Smart insertion** — types into the focused app, clipboard fallback

## Requirements

The setup script handles most of this, but for reference:

| Requirement | Details |
|---|---|
| **Runtime** | Node.js 20+, Rust |
| **Text insertion (Wayland)** | ydotool, wl-clipboard; user in `input` group |
| **Text insertion (X11)** | xdotool, xclip |
| **Audio** | PulseAudio or PipeWire |

<details>
<summary>Manual dependency install (Ubuntu/Debian)</summary>

**System libraries**:
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

## Development

```bash
./scripts/setup.sh    # install deps only (no build)
npm run dev           # run in dev mode with hot reload
npm run build         # production build
npm run check         # TypeScript type-check
```

## Architecture

```
apps/desktop/
  src/                React frontend (hooks, store, types)
  src-tauri/          Rust backend
    src/lib.rs        App setup, hotkey, commands
    src/tray.rs       System tray icon + menu
    src/transcribe.rs whisper.cpp integration
    src/insertion.rs  Text insertion (ydotool/xdotool/clipboard)
    src/config.rs     Settings persistence
```

## Stack

Tauri 2 · React 19 · Vite · TypeScript · Tailwind CSS 4 · Zustand · whisper.cpp

## Known Limitations

- **Wayland insertion** depends on ydotool and may require `ydotoold` running or `input` group membership. Behaviour varies by compositor.
- **First launch requires internet** to download the whisper model (~142 MB). After that, fully offline.
- Only tested on Ubuntu. Other distributions and desktop environments may have different behaviour with text insertion, audio, or tray integration.

## License

MIT
