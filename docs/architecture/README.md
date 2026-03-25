# Architecture

## Overview

Voice is a free, local-first desktop dictation app for Linux, built with Tauri 2.

```
User speaks -> Audio Capture -> Local ASR -> Text Insertion
```

## Module Layout

```
apps/desktop/           Tauri application
  src/                  React + TypeScript frontend (Vite)
  src-tauri/            Rust backend
    src/lib.rs          App setup, hotkey registration, commands, model download
    src/tray.rs         System tray icon and menu (dynamic state)
    src/transcribe.rs   whisper.cpp integration via whisper-rs
    src/insertion.rs    Text insertion (ydotool/xdotool/clipboard)
    src/config.rs       Settings persistence (XDG config dir)
```

## Data Flow

1. **Audio Capture**: WebView `getUserMedia` -> ScriptProcessorNode -> Float32Array samples
2. **ASR**: Samples sent to Rust via Tauri invoke -> whisper-rs -> transcript string
3. **Insertion**: Transcript -> ydotool/xdotool type simulation or clipboard paste
4. **Fallback**: If direct typing fails, text is placed on clipboard and Ctrl+V is simulated

## Tauri IPC Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `get_config` | Frontend -> Rust | Load persisted settings |
| `save_config` | Frontend -> Rust | Persist settings |
| `get_platform_info` | Frontend -> Rust | Session type, desktop env |
| `transcribe_audio` | Frontend -> Rust | Send samples, get transcript |
| `insert_text` | Frontend -> Rust | Insert transcript into active app |
| `set_recording_state` | Frontend -> Rust | Update tray icon and menu |
| `window.eval()` | Rust -> Frontend | Toggle dictation from hotkey |

## Trigger Mechanisms

All three call `eval_toggle()` which runs `window.__toggleDictation()` via JS eval:

1. **Tauri global-shortcut plugin** (Alt+D) — primary
2. **evdev listener** — Linux fallback for Wayland, needs `input` group
3. **Unix socket** (`$XDG_RUNTIME_DIR/voice.sock`) — external triggers

## Insertion Strategy

| Session | Primary | Fallback |
|---------|---------|----------|
| Wayland | ydotool type | wl-copy + ydotool Ctrl+V |
| X11 | xdotool type | xclip + xdotool Ctrl+V |

Clipboard contents are saved and restored after fallback insertion.

## Key Decisions

- **Tauri over Electron**: Smaller binary, lower memory, better for utility app
- **Local ASR over cloud**: Privacy-first, no account needed, works offline
- **Tray-only UX**: No visible window, app runs from system tray
- **WebView audio capture**: Simpler than native audio bindings, sufficient for dictation
- **Linux-only**: Ubuntu-first, no macOS code paths
