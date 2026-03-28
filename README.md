<p align="center">
  <img src="assets/voice-logo.svg" alt="Voice" width="400">
</p>

<p align="center">
  <strong>Free, local-first desktop dictation for Linux.</strong><br>
  Press a hotkey, speak, and your words appear wherever your cursor is.
</p>

<p align="center">
  <a href="#requirements"><img src="https://img.shields.io/badge/platform-Linux-black?style=for-the-badge&logo=linux&logoColor=white" alt="Linux"></a>
  <a href="https://github.com/sergiopesch/voice/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sergiopesch/voice/ci.yml?style=for-the-badge&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0EA5E9?style=for-the-badge" alt="MIT License"></a>
</p>

---

```bash
git clone https://github.com/sergiopesch/voice.git
cd voice
./scripts/setup.sh --install
```

## What It Does

- **Speak to type** — press a hotkey, speak naturally, text appears in any app
- **Fully local** — audio never leaves your machine, no cloud, no account
- **System tray** — mic icon turns red while recording, shows download progress
- **Smart insertion** — types directly into the focused app, clipboard fallback with notification
- **Configurable hotkey** — default Alt+D, change in `~/.config/voice/config.json`

> Tested on Ubuntu. Likely to work on similar Debian/Ubuntu-based systems. Other distributions are experimental.

## How It Works

```
Press hotkey → Mic captures audio → whisper.cpp transcribes locally → Text inserted at cursor
```

1. Open **Voice** from your app launcher — it appears in the **system tray**
2. Press **Alt+D** — speak — press **Alt+D** again
3. Text is transcribed locally and typed where your cursor is

No visible window. Everything runs on your machine. First launch downloads the speech model (~142 MB, one-time, SHA256-verified). After that, fully offline.

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
# ydotool v1.0+ also requires ydotoold running:
ydotoold &  # or: systemctl --user enable --now ydotoold
```

**X11 text insertion**:
```bash
sudo apt install xdotool xclip
```
</details>

## Configuration

Settings in `~/.config/voice/config.json`:

```jsonc
{
  "hotkey": "Alt+D",
  "selectedMic": null,
  "insertionStrategy": "auto"
}
```

| Setting | Default | Options |
|---------|---------|---------|
| `hotkey` | `Alt+D` | Any Tauri-compatible shortcut |
| `selectedMic` | `null` (system default) | Device ID string |
| `insertionStrategy` | `auto` | `auto`, `clipboard`, `type-simulation` |

## Architecture

```
apps/desktop/
  src/                  React frontend (hooks, store, types)
    hooks/              useDictation (AudioWorklet capture), useGlobalShortcut
    __tests__/          Vitest unit tests
  public/               AudioWorklet processor
  src-tauri/            Rust backend
    src/lib.rs          App setup, hotkey, commands, model download
    src/tray.rs         System tray icon + menu
    src/transcribe.rs   whisper.cpp integration
    src/insertion.rs    Text insertion (ydotool/xdotool/clipboard)
    src/config.rs       Settings persistence
```

**Stack**: Tauri 2 · React 19 · Vite · TypeScript · Zustand · whisper.cpp

**Audio pipeline**: getUserMedia → AudioWorklet → base64 IPC → whisper-rs → text

**Insertion**: ydotool (Wayland) / xdotool (X11) → clipboard fallback → desktop notification

## Development

```bash
./scripts/setup.sh    # install deps only (no build)
npm run dev           # run in dev mode with hot reload
npm run build         # production build
npm run check         # TypeScript type-check
npm run lint          # ESLint
npm test              # frontend tests (Vitest)
cargo test            # Rust unit tests (from apps/desktop/src-tauri/)
```

## Debugging

```bash
RUST_LOG=debug npm run dev    # verbose logging
RUST_LOG=warn npm run dev     # warnings and errors only
```

## CI

GitHub Actions runs on every push and PR: TypeScript check, ESLint, Vitest, cargo check, cargo clippy, cargo test.

## Known Limitations

- **Wayland insertion** depends on ydotool and may require `ydotoold` running or `input` group membership. Behaviour varies by compositor.
- **First launch requires internet** to download the whisper model (~142 MB). After that, fully offline.
- Only tested on Ubuntu. Other distributions and desktop environments may have different behaviour.

## License

MIT
