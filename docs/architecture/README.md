# Architecture

## Overview

VOCO is a voice-first, local-first desktop dictation app for Linux, built with Tauri 2.

```
User speaks -> Audio Capture -> Local ASR -> Text Insertion
User speaks -> Preview ASR -> Revisable IBus preedit
User speaks -> Canonical 30s/1s-overlap ASR -> Exact IBus checkpoints -> Target field
User speaks -> Audio Capture -> Local ASR -> Optional Local Transcript Enhancement -> Text Insertion
User speaks -> Audio Capture -> Local ASR -> Optional Local Model Assistant -> Text Insertion
User speaks -> Audio Capture -> Local ASR -> OpenClaw Agent -> Text Insertion
User speaks -> Audio Capture -> Local ASR -> OpenClaw Agent -> OpenClaw TTS -> Local Playback
User speaks <-> OpenAI Realtime WebSocket session -> Local Playback
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
    src/owned_preedit.rs Private client for the persistent IBus engine
    resources/voco_ibus_* Persistent engine, protocol, and pure ownership model
```

## Data Flow

1. **Audio Capture**: WebView `getUserMedia` -> AudioWorklet (with ScriptProcessorNode fallback) -> Float32Array samples
2. **Resampling**: If mic sample rate != 16kHz, resample via OfflineAudioContext. Canonical
   cursor mode preprocesses stable, non-overlapping source blocks (`0-30`, `30-59`, `59-88`, ...)
   so later audio cannot alter an earlier cached block.
3. **ASR**: Float32Array bytes packed into a `Uint8Array`, sent to Rust via Tauri invoke, decoded
   to `Vec<f32>` -> whisper-rs -> transcript string. Enhancement-off stable cursor mode transcribes
   authoritative 30-second ranges with one second of overlap (`0-30`, `29-59`, `58-88`, ...).
4. **Optional transcript enhancement**: When enabled, deterministic voice formatting commands are applied after ASR. Conservative polish can also call an OpenAI-compatible local model endpoint on `localhost` only; failures fall back to the raw transcript.
5. **Status Feedback**: A transparent overlay is moved near the cursor while recording or
   processing whenever delivery is panel-based. Stable cursor mode normally stays out of the way
   while ownership is proven, but a runtime ownership failure immediately makes the overlay visible
   for that session. The final transcript remains in frontend state for recovery instead of being
   redirected to an unverified target.
6. **Output target**: Default target inserts the transcript directly. The local model target sends the transcript to the configured localhost model endpoint and inserts the answer. Optional OpenClaw targets send the transcript to `openclaw agent --agent <id> --message <text>` and either insert the agent response or convert it through `openclaw gateway call tts.convert` for local playback.
7. **Stable live cursor**: The Debian package advertises a persistent `VOCO Dictation` IBus input
   source. After the user selects it, Rust connects through a private same-user protocol-v3 socket.
   The exact real input context must freshly establish safe, non-sensitive content metadata and
   preedit support after each focus entry before rolling preview text may use the owned preedit. At
   30, 59, 88 seconds, and subsequent 29-second strides, canonical ASR appends one exact checkpoint
   after verifying the previously acknowledged prefix. Preview agreement never authorizes a
   normal-text commit.
   IBus 1.5 global-engine mode suppresses forwarding an unchanged purpose/hints tuple, so an
   otherwise normal consecutive focus with the same tuple cannot renew proof. Generic
   `FREE_FORM`/no-hint input is ambiguous and cannot establish proof at all.
8. **Final/other insertion**: In canonical cursor mode, cached checkpoint text is final truth and
   stop transcribes only deferred complete work plus the remaining partial canonical range.
   Final-text-only, enhancement modes, and non-cursor outputs use one-shot ydotool/xdotool typing or
   clipboard paste according to the selected strategy. Enhancement modes keep preview in VOCO's
   overlay until that one-shot final.
9. **Fallback and recovery**: Focus loss clears content-type proof; same-context re-entry and a
   synthetic global-engine proxy cannot reuse it. If the owned input source, fresh focus metadata,
   preedit capability, or session lease is not provable, stable cursor mode switches the current
   session to a visible overlay preview. Terminals, sensitive fields, and missing or ambiguous
   metadata are always ineligible. VOCO preserves any acknowledged canonical target prefix, leaves
   other target text unchanged, and reports the final as unreconciled. The tray then exposes a
   needs-attention state and the popover exposes the retained final through `Copy transcript`. It
   does not switch engines, retry an uncertain mutation, or use global keyboard injection as a
   hidden fallback.

Realtime conversation bypasses the local ASR/output target path. In 2026.0.21 it is voice-only: the
Realtime schema exposes no browser tool and VOCO sends no browser URL, tab metadata, page content,
or snapshot. The backend reads
`OPENAI_API_KEY` and mints a short-lived Realtime client token. The frontend uses that token to open
a WebSocket, streams 24 kHz PCM16 microphone chunks with `input_audio_buffer.append`, and plays
PCM16 `response.output_audio.delta` chunks through Web Audio. The same audio samples drive the
realtime VOCO mic visual, so the hidden overlay and popover reflect both user speech and assistant
playback. Frontend guards and tray action state make realtime and dictation mutually exclusive.

## Tauri IPC Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `get_config` | Frontend -> Rust | Load persisted settings |
| `save_config_patch` | Frontend -> Rust | Serialize and atomically persist a field patch; return and emit the authoritative config |
| `transcribe_audio` | Frontend -> Rust | Send packed audio bytes, get transcript |
| `preview_transcribe_audio` | Frontend -> Rust | Transcribe a bounded provisional preview window |
| `transcribe_canonical_chunk` | Frontend -> Rust | Transcribe one authoritative, prefix-preserving canonical range |
| `enhance_transcript` | Frontend -> Rust | Apply optional formatting/local transcript polish |
| `test_local_llm` | Frontend -> Rust | Check an OpenAI-compatible localhost model endpoint |
| `ask_local_llm_agent` | Frontend -> Rust | Send transcript to a localhost model and return its answer |
| `insert_text` | Frontend -> Rust | Insert transcript into active app |
| `ask_openclaw_agent` | Frontend -> Rust | Send a transcript to the configured OpenClaw CLI agent |
| `create_realtime_client_secret` | Frontend -> Rust | Mint a short-lived OpenAI Realtime client token |
| `set_dictation_status` | Frontend -> Rust | Update tray icon state |
| `set_microphone_ready` | Frontend -> Rust | Update tray readiness state |
| `sync_runtime_status` | Frontend -> Rust | Reconcile initialization, microphone permission/readiness, dictation, cursor delivery/setup, and realtime phase/mute state into one tray snapshot |
| `show_notification` | Frontend -> Rust | Desktop notification via notify-send |
| `start_owned_preedit` / `update_owned_preedit` | Frontend -> Rust -> IBus | Start a leased composition and revise provisional preview text |
| `checkpoint_owned_preedit` | Frontend -> Rust -> IBus | Atomically verify the acknowledged prefix and append a canonical checkpoint |
| `finish_canonical_owned_preedit` | Frontend -> Rust -> IBus | Commit the exact final canonical suffix and close the lease |
| `emit_to("main", "voco:toggle-dictation", ())` | Rust -> Frontend | Toggle dictation from hotkey |

## Trigger Mechanisms

All three call `eval_toggle()` which emits a targeted Tauri window event to the main webview:

1. **evdev listener** — preferred on Wayland for supported hotkeys (`Alt+D`, `Alt+Shift+D`), needs `input` group on many systems
2. **Tauri global-shortcut plugin** (configurable, default Alt+D) — primary outside the supported Wayland evdev path
3. **Unix socket** (`$XDG_RUNTIME_DIR/voco.sock` or `${TMPDIR:-/tmp}/voco-$(id -u)/voco.sock`, 0600) — external triggers

Realtime conversation uses a separate fixed hotkey, `Alt+Shift+R`, and emits `voco:toggle-realtime` instead of the dictation event. The backend debounces realtime toggles and buffers an early realtime toggle until the frontend handler is ready, matching the dictation hotkey startup behavior.

The native tray menu has separate dictation and realtime actions. Processing disables repeat
dictation requests; active dictation disables realtime; active realtime disables dictation. Opening
the compact popover is not a dictation trigger because the popover takes focus from the target
field. It instructs the user to focus a target and press the hotkey, closes on `Escape` or focus
loss, and exposes a retained unreconciled transcript for copying. The explicit `Open VOCO` menu
action always shows the popover, while a tray-icon click toggles it.

## Configuration Consistency

VOCO acquires a private, nonblocking per-user runtime lock before it creates sockets, registers
shortcuts, or initializes the tray. A second process exits without mutating the running instance's
state and raises a desktop notification when available.

The frontend sends only changed fields and queues its saves in issue order. In Rust, one writer lock
serializes frontend and native-tray changes. Each operation reloads the latest XDG config, applies
the patch, updates the live hotkey binding when required, atomically saves the result, and then
returns and emits the complete authoritative `AppConfig` as `voco:config-changed`. A failed disk
save restores the previous hotkey runtime binding. Opening Settings or the popover also refreshes
config, audio devices, and runtime diagnostics, so a native tray hotkey change cannot later be
overwritten by a stale whole-config save.

An invalid, unsafe, or unreadable config produces an explicit recovery surface instead of a blank
window. Manual retry reloads and validates the file, transactionally reconciles the live hotkey,
then emits a new authoritative revision. Reset first binds the safe default, preserves the prior
config entry under a unique recovery-backup name, writes private defaults atomically, and rolls the
hotkey back if persistence fails.

## Unified Tray State

The frontend synchronizes microphone readiness, dictation phase, cursor-delivery state, whether the
selected output requires owned cursor delivery, the IBus setup state, configuration failures, and
realtime phase as one epoch-and-revision-ordered runtime snapshot. Backend-owned speech-model
download state is merged into the same reducer. Rust alone renders the icon, tooltip, action labels,
and enabled actions, so model progress and a renderer reload cannot race a second tooltip writer or
leave stale recording controls. It distinguishes initialization, model checking/download, ready,
microphone not ready, live cursor needs setup, owned cursor recording, preview-only recording,
processing, unreconciled transcript, configuration recovery, and realtime
connecting/listening/speaking/error states.

## One-Shot Insertion Strategy

| Session | Primary | Fallback |
|---------|---------|----------|
| Wayland | ydotool type | wl-copy + ydotool Ctrl+V |
| X11 | xdotool type | xclip + xdotool Ctrl+V |

Clipboard contents are saved (if text) and restored after fallback insertion (300ms delay).
Enhancement-off stable cursor mode does not use either one-shot strategy: only the selected private
IBus engine may accept canonical checkpoints for its active lease.

## Persistent IBus Input Source

The Debian package installs immutable component, launcher, and Python engine files. IBus owns the
engine process; the VOCO app never spawns or kills it and never calls `SetGlobalEngine`. Outside an
active lease every key is passed through. Private protocol v3 uses
`$XDG_RUNTIME_DIR/voco/ibus-engine.sock`, checks owner-only filesystem permissions and Linux peer
credentials, accepts one controller, and carries no transcript text in status or error responses.
App disconnect invalidates the session and clears only VOCO-owned preedit.

Content-type authority is per focus, not per client identity. Every real focus entry discards prior
proof and must receive a fresh, established, non-sensitive content-type callback for the exact input
context before owned preedit can start. Same-context re-entry and synthetic/global proxy focus do not
restore that proof. Terminal purpose, password/PIN purpose, private/hidden hints, missing or
ambiguous metadata, and absent preedit capability fail closed to VOCO preview.

Rolling previews can revise only VOCO's preedit. Canonical checkpoint commands carry both the exact
previously acknowledged text and its exact append; the engine rejects an out-of-sequence prefix and
has no deletion API. Once a checkpoint succeeds, its cached text is immutable and becomes part of
the final transcript. Stop-time finalization commits only the suffix from the remaining canonical
range. A rejected command can be reported safely, but a timeout, disconnect, malformed response, or
other uncertain mutation result is never retried: Rust drops the socket and stable mode does not
fall back to global insertion.

The IBus engine is resident and an installed app upgrade cannot replace that running process in
place. After a private-protocol upgrade, quit VOCO and run `ibus restart`, or sign out and back in,
before reopening VOCO. Merely switching away from and back to `VOCO Dictation` is not a supported
engine reload procedure.

## Packaging Boundary

The published binary artifact is the GitHub Release `.deb`. Ubuntu is the primary reference
environment; Debian-derived distributions are best-effort. AppImage publication is paused until its
complete packaging toolchain is immutable and checksum-pinned, and it cannot install the host IBus
component needed for owned live cursor delivery. Flatpak, Flathub, Snap, and Ubuntu App Center
material in the repository is development scaffolding, not a published release channel.

## Logging

Structured logging via `log` + `env_logger`. Default level: `info`. Set `RUST_LOG=debug` for verbose output.

## Key Decisions

- **Tauri over Electron**: Smaller binary, lower memory, better for utility app
- **Local ASR over cloud**: Privacy-first, no account needed, works offline
- **Tray-first UX**: Hidden by default, with a compact popover, settings panel, and status overlay when needed
- **AudioWorklet for capture**: Off-main-thread audio processing, ScriptProcessorNode fallback
- **Packed byte audio IPC**: avoids large base64 string construction while keeping a simple full-buffer Rust transcription path
- **Linux-only**: Ubuntu-first, no macOS code paths

## Product Specs

- [Local intelligence](../local-intelligence-spec.md)
- [Streaming ASR feel](../streaming-asr-spec.md)
- [Model profiles and ASR benchmark](../model-profiles-and-asr-benchmark-spec.md)
- [Local intent router](../local-intent-router-spec.md)
