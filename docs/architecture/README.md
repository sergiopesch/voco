# Architecture

## Overview

VOCO is a voice-first, local-first desktop dictation app for Linux, built with Tauri 2.

```
User speaks -> Audio Capture -> Local ASR -> Text Insertion
```

## Module Layout

```
apps/desktop/           Tauri application
  src/                  React + TypeScript frontend (Vite)
    components/         Cursor-side status overlay UI
    hooks/              useDictation (audio capture), useGlobalShortcut
    store/              Zustand state management
    lib/                Tauri IPC bridge
    __tests__/          Vitest unit tests
  public/               Static assets (AudioWorklet processor)
  src-tauri/            Rust backend
    src/lib.rs          App setup, hotkey, commands, model download
    src/tray.rs         System tray icon and menu (dynamic state)
    src/transcribe.rs   whisper.cpp integration via whisper-rs
    src/insertion.rs    Text insertion (ydotool/xdotool/clipboard)
    src/config.rs       Settings persistence (XDG config dir)
```

## Data Flow

1. **Audio Capture**: WebView `getUserMedia` -> AudioWorklet (with ScriptProcessorNode fallback) -> Float32Array samples
2. **Resampling**: If mic sample rate != 16kHz, resample via OfflineAudioContext
3. **ASR**: Float32Array bytes base64-encoded, sent to Rust via Tauri invoke, decoded to `Vec<f32>` -> whisper-rs -> transcript string
4. **Status Feedback**: Transparent overlay window is moved near the cursor while recording and processing so the user can see that VOCO is listening or processing
5. **Insertion**: Transcript -> ydotool/xdotool type simulation or clipboard paste
6. **Fallback**: If direct typing fails, text is placed on clipboard and Ctrl+V is simulated. Desktop notification informs user.

## Tauri IPC Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `get_config` | Frontend -> Rust | Load persisted settings |
| `save_config` | Frontend -> Rust | Persist settings |
| `transcribe_audio` | Frontend -> Rust | Send base64-encoded audio, get transcript |
| `insert_text` | Frontend -> Rust | Insert transcript into active app |
| `set_recording_state` | Frontend -> Rust | Update tray icon and menu |
| `show_notification` | Frontend -> Rust | Desktop notification via notify-send |
| `emit_to("main", "voco:toggle-dictation", ())` | Rust -> Frontend | Toggle dictation from hotkey |

## Trigger Mechanisms

All three call `eval_toggle()` which emits a targeted Tauri window event to the main webview:

1. **Tauri global-shortcut plugin** (configurable, default Alt+D) — primary
2. **evdev listener** — Linux fallback for Wayland, needs `input` group
3. **Unix socket** (`$XDG_RUNTIME_DIR/voco.sock`, 0600) — external triggers

## Insertion Strategy

| Session | Primary | Fallback |
|---------|---------|----------|
| Wayland | ydotool type | wl-copy + ydotool Ctrl+V |
| X11 | xdotool type | xclip + xdotool Ctrl+V |

Clipboard contents are saved (if text) and restored after fallback insertion (300ms delay).

## Logging

Structured logging via `log` + `env_logger`. Default level: `info`. Set `RUST_LOG=debug` for verbose output.

## Key Decisions

- **Tauri over Electron**: Smaller binary, lower memory, better for utility app
- **Local ASR over cloud**: Privacy-first, no account needed, works offline
- **Tray-only UX**: No visible window, app runs from system tray
- **AudioWorklet for capture**: Off-main-thread audio processing, ScriptProcessorNode fallback
- **Base64 audio IPC**: ~60% smaller than JSON number arrays, much faster serialization
- **Linux-only**: Ubuntu-first, no macOS code paths
