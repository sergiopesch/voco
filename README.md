<!-- markdownlint-disable MD031 MD033 MD041 MD060 -->
<p align="center">
  <img src="assets/voice-logo.svg" alt="Voice" width="400">
</p>

<p align="center">
  <strong>Free, local-first desktop dictation for Linux.</strong><br>
  Press a hotkey, speak, and your words appear wherever your cursor is.
</p>
<!-- markdownlint-enable MD041 -->

<p align="center">
  <a href="#requirements"><img src="https://img.shields.io/badge/platform-Linux-black?style=for-the-badge&logo=linux&logoColor=white" alt="Linux"></a>
  <a href="https://github.com/sergiopesch/voice/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sergiopesch/voice/ci.yml?style=for-the-badge&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0EA5E9?style=for-the-badge" alt="MIT License"></a>
</p>

---

### Install (pre-built, ~5 seconds)

```bash
bash <(curl -s https://raw.githubusercontent.com/sergiopesch/voice/master/install)
```

<details>
<summary>Build from source (~2 minutes)</summary>

```bash
git clone https://github.com/sergiopesch/voice.git
cd voice
./scripts/setup.sh --install
```
</details>

## How It Works

<p align="center">

```text
         ╭────────────╮          ╭────────────╮          ╭────────────╮
         │            │          │            │          │            │
         │  🎙️ Speak  │ ──────> │ 🔍 Transcribe ──────> │  ⌨️ Type   │
         │            │          │            │          │            │
         ╰────────────╯          ╰────────────╯          ╰────────────╯
          Press Alt+D            whisper.cpp              Text appears
          and speak              runs locally             at your cursor
```

</p>

1. **Launch Voice** — it appears in your system tray (no window).
2. **Press Alt+D** — speak naturally.
3. **Press Alt+D again** — your words are typed wherever your cursor is.

A small overlay appears near your cursor while Voice is listening and while it is transcribing, so the next step is always visible before text lands.

No account. No cloud. Audio never leaves your machine.

> First launch downloads the speech model (~142 MB, one-time). After that, fully offline.

## Features

| Feature                     | Details                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| **Fully local**             | whisper.cpp runs on your machine — audio never leaves it                       |
| **Global hotkey**           | Works from any app. Default `Alt+D`, customizable on install                   |
| **System tray**             | Mic icon shows readiness: gray (not ready), green (ready), red (recording)    |
| **Cursor-side status overlay** | Shows listening and transcribing states right beside your cursor            |
| **Smart insertion**         | Types directly into the focused app, clipboard fallback                         |
| **No account needed**       | No sign-up, no API key, no subscription, ever                                  |

## Requirements

The installer handles everything, but for reference:

| What                              | Why                      |
| --------------------------------- | ------------------------ |
| Ubuntu / Debian                   | Primary supported platform |
| PulseAudio or PipeWire            | Microphone access        |
| Wayland: `ydotool`, `wl-clipboard`| Text insertion + clipboard |
| X11: `xdotool`, `xclip`           | Text insertion + clipboard |

> Other Linux distributions may work but are not officially tested.

## Configuration

The installer lets you pick your hotkey. You can change it anytime from the **system tray menu** or by editing `~/.config/voice/config.json`:

```json
{
  "hotkey": "Alt+D",
  "insertionStrategy": "auto"
}
```

<details>
<summary>All settings</summary>

| Setting            | Default | Options                                            |
| ------------------ | ------- | -------------------------------------------------- |
| `hotkey`           | `Alt+D` | Any key combo (`Ctrl+Shift+V`, `Super+D`, etc.)   |
| `selectedMic`      | `null`  | Specific mic device ID, or null for system default |
| `insertionStrategy` | `auto` | `auto`, `clipboard`, `type-simulation`            |

</details>

> Hotkey note: on Wayland, `Alt+D` and `Alt+Shift+D` are the most reliable options because they use the evdev backend. Other custom combos use the global-shortcut backend and may behave differently depending on compositor/session support.

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

```text
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
