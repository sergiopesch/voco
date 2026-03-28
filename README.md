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

## Install

```bash
bash <(curl -s https://raw.githubusercontent.com/sergiopesch/voice/master/install)
```

That's it. The installer checks your system, downloads the app, and walks you through setup.

<details>
<summary>Build from source instead</summary>

```bash
git clone https://github.com/sergiopesch/voice.git
cd voice
./scripts/setup.sh --install
```
</details>

## How It Works

```
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│  Alt+D  │───>│  Microphone  │───>│  whisper.cpp │───>│  Text typed  │
│ (hotkey)│    │  captures    │    │  transcribes │    │  at cursor   │
│         │<───│  your voice  │    │  locally     │    │              │
│  Alt+D  │    └─────────────┘    └─────────────┘    └──────────────┘
│ (stop)  │
└─────────┘         Your machine — nothing leaves it.
```

1. **Launch** — open Voice from your app launcher. It lives in the system tray.
2. **Press Alt+D** — start speaking.
3. **Press Alt+D again** — text appears wherever your cursor is.

No window. No account. No cloud. Everything runs locally.

> First launch downloads the speech model (~142 MB, one-time). After that, fully offline.

## Features

| Feature | Details |
|---------|---------|
| **Local transcription** | whisper.cpp runs on your machine — audio never leaves it |
| **Global hotkey** | Works from any app. Default `Alt+D`, customizable |
| **System tray** | Mic icon turns red while recording |
| **Smart insertion** | Types directly into focused app, clipboard fallback |
| **No account** | No sign-up, no API key, no subscription |

## Requirements

The installer handles everything, but for reference:

| What | Why |
|------|-----|
| Ubuntu / Debian | Primary supported platform |
| PulseAudio or PipeWire | Microphone access |
| Wayland: `ydotool`, `wl-clipboard` | Text insertion + clipboard |
| X11: `xdotool`, `xclip` | Text insertion + clipboard |

> Other Linux distributions may work but are not officially tested.

## Configuration

Settings are in `~/.config/voice/config.json`. The installer lets you pick your hotkey, or change it later:

```json
{
  "hotkey": "Alt+D",
  "insertionStrategy": "auto"
}
```

You can also change the hotkey from the **system tray icon** menu.

<details>
<summary>All settings</summary>

| Setting | Default | Options |
|---------|---------|---------|
| `hotkey` | `Alt+D` | Any key combo (e.g. `Ctrl+Shift+V`, `Super+D`) |
| `selectedMic` | `null` | Specific mic device ID, or null for system default |
| `insertionStrategy` | `auto` | `auto`, `clipboard`, `type-simulation` |

</details>

## Development

```bash
git clone https://github.com/sergiopesch/voice.git
cd voice
./scripts/setup.sh       # install deps
npm run dev              # dev mode with hot reload
npm run check            # type-check
npm run lint             # lint
npm test                 # frontend tests
cargo test               # rust tests (from apps/desktop/src-tauri/)
```

<details>
<summary>Project structure</summary>

```
apps/desktop/
  src/                  React + TypeScript frontend
  public/               AudioWorklet processor
  src-tauri/            Rust backend
    src/lib.rs          App setup, hotkey, commands
    src/tray.rs         System tray
    src/transcribe.rs   whisper.cpp integration
    src/insertion.rs    Text insertion
    src/config.rs       Settings
```

**Stack**: Tauri 2 · React 19 · TypeScript · Zustand · whisper.cpp

</details>

## Known Limitations

- **Wayland text insertion** depends on `ydotool` and may vary by compositor.
- **First launch needs internet** to download the model (~142 MB). After that, fully offline.
- **Ubuntu is the tested platform.** Other distros may behave differently.

## License

MIT
