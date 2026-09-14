> Historical foundations architecture retained for provenance. The current application path is in [Architecture](README.md); manual-copy-only and Whisper-default statements below describe the earlier branch.

# Architecture

## Overview

VOCO is a voice-first, local-first desktop dictation app for Linux, built with Tauri 2.

```
User speaks -> Audio Capture -> Local ASR -> VOCO review -> Explicit Copy
Browser-authorized field -> Capture -> Canonical ASR -> Exact-element append receipt
User speaks -> Local ASR -> Optional enhancement or text assistant -> Same output boundary
User speaks -> Local ASR -> Optional OpenClaw TTS -> Local Playback
User speaks <-> Optional OpenAI Realtime WebSocket -> Local Playback
```

The current development implementation defaults to review and copying. Generic IBus insertion
is disabled after actual WebKit tests demonstrated that two fields can share one input context,
content metadata and cursor rectangle. A separate, explicitly enabled Chromium integration can
address a captured plain-text DOM element. Development builds and isolated evidence do not imply
that this change has been installed in the user's desktop or published as a release.

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
    src/owned_preedit.rs Fail-closed compatibility client for persistent IBus shortcuts
    src/browser_broker.rs Exact-field session and receipt validation
    src/browser_protocol.rs Bounded browser protocol
    src/bin/voco-browser-host.rs Chromium native-messaging executable
    resources/voco_ibus_* Persistent shortcut engine; text mutation disabled
integrations/chromium/   Explicit-tab exact-element adapter and service worker
```

## Data Flow

1. **Audio Capture**: WebView `getUserMedia` -> AudioWorklet -> Float32Array samples. The ScriptProcessorNode compatibility fallback retains received audio for manual recovery because it cannot confirm complete capture; see [speech recovery](speech-recovery.md).
2. **Resampling**: If mic sample rate != 16kHz, resample via OfflineAudioContext. Canonical
   cursor mode preprocesses stable, non-overlapping source blocks (`0-30`, `30-59`, `59-88`, ...)
   so later audio cannot alter an earlier cached block.
3. **ASR**: Float32Array bytes sent as a top-level binary Tauri request, validated and decoded
   to `Vec<f32>` -> whisper-rs -> transcript string. Enhancement-off stable cursor mode transcribes
   bounded ranges selected by the shared native [hybrid planner](hybrid-recognition.md).
   A supported numerical plateau permits a disjoint boundary; otherwise the session
   retains 30-second windows with one second of overlap. Prepared source blocks remain unchanged.
4. **Optional transcript enhancement**: When enabled, deterministic voice formatting commands are applied after ASR. Conservative polish can also call an OpenAI-compatible local model endpoint on `localhost` only; failures fall back to the raw transcript.
5. **Status Feedback**: A transparent overlay is moved near the cursor while recording or
   processing whenever delivery is panel-based. Stable cursor mode normally stays out of the way
   while ownership is proven, but a runtime ownership failure immediately makes the overlay visible
   for that session. The final transcript remains in frontend state for recovery instead of being
   redirected to an unverified target.
6. **Output target**: The ordinary text result remains in VOCO for explicit copying. Optional
   local-model and OpenClaw text modes transform the transcript before the same delivery boundary;
   OpenClaw speech uses playback. Those optional modes retain their own configuration/network rules.
7. **Exact-field authorization**: The user enables the Chromium extension in a tab and presses
   `Alt+Shift+V` in an eligible plain-text control. The extension captures that exact element and
   document instance, creates an opaque token, and sends an explicit start event through native
   messaging. The Rust broker allocates a distinct session ID and requires a recipient `claim`
   receipt before reporting ownership. Native hotkeys, tray and external socket triggers authorize
   recording for copying; they do not authorize a browser target.
8. **Canonical/final output**: Rolling hypotheses remain in VOCO. Browser checkpoints append only
   authoritative canonical text, with the exact acknowledged prefix, sequence and Unicode scalar
   count. Final-only and enhanced output use the same receipt boundary. The extension verifies the
   captured object, current focus, selection, value, eligibility and request expiry immediately
   before synchronous `setRangeText`. It checks again after cancelable page `beforeinput` handlers.
   No global key injection or clipboard paste substitutes for an addressed write. Direct element
   mutation has a native browser undo-history limitation and does not support rich-text editors.
9. **Recovery**: Focus leave/return, navigation, element replacement, field edits, selection changes,
   ineligibility or disconnection invalidate ownership. Rejection retains text for copying; uncertain
   mutation results are never replayed. A matching receipt proves only its exact append, and its
   acknowledged prefix is preserved even if a later operation fails. Generic GTK, WebKitGTK,
   terminals, Electron and other apps use manual copying until a suitable exact-field integration
   has its own evidence.

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
| `transcribe_canonical_chunk` | Frontend -> Rust | Legacy VCA1 canonical compatibility API |
| `transcribe_hybrid_chunk` | Frontend -> Rust | Validate a VCA2 request and return one prefix-preserving result with its actual coverage receipt |
| `enhance_transcript` | Frontend -> Rust | Apply optional formatting/local transcript polish |
| `test_local_llm` | Frontend -> Rust | Check an OpenAI-compatible localhost model endpoint |
| `ask_local_llm_agent` | Frontend -> Rust | Send transcript to a localhost model and return its answer |
| `insert_text` | Frontend -> Rust | Legacy compatibility helper; not automatic dictation |
| `ask_openclaw_agent` | Frontend -> Rust | Send a transcript to the configured OpenClaw CLI agent |
| `create_realtime_client_secret` | Frontend -> Rust | Mint a short-lived OpenAI Realtime client token |
| `set_dictation_status` | Frontend -> Rust | Update tray icon state |
| `set_microphone_ready` | Frontend -> Rust | Update tray readiness state |
| `sync_runtime_status` | Frontend -> Rust | Reconcile initialization, microphone permission/readiness, dictation, cursor delivery/setup, and realtime phase/mute state into one tray snapshot |
| `show_notification` | Frontend -> Rust | Desktop notification via notify-send |
| `start_owned_preedit` / `update_owned_preedit` | Frontend -> Rust -> Browser | Claim an exact-field token / read delivery status; preview stays in VOCO |
| `checkpoint_owned_preedit` | Frontend -> Rust -> Browser | Verify acknowledged prefix and request an exact-element canonical append |
| `finish_canonical_owned_preedit` | Frontend -> Rust -> Browser | Append final canonical suffix with a matching recipient receipt |
| `emit_to("main", "voco:toggle-dictation", ())` | Rust -> Frontend | Toggle dictation from hotkey |

## Trigger Mechanisms

The optional browser integration emits directed `start`/`stop` events carrying `browser:` tokens.
Stops retain the original session identity and cannot start a new recording. Expiring renderer
heartbeats prevent buffering a browser start while the frontend is unavailable.

Other recording triggers retain manual-copy output:

1. **Persistent IBus shortcut engine** — consumes configured shortcuts while the app is live;
   protocol v5 rejects every composition/text mutation operation.
2. **evdev listener** — Wayland fallback for supported hotkeys (`Alt+D`, `Alt+Shift+D`), suppressed
   while IBus is armed; may require the `input` group.
3. **Tauri global-shortcut plugin** — configurable native shortcut fallback.
4. **Unix socket** (`$XDG_RUNTIME_DIR/voco.sock` or a private per-user temporary directory) —
   external recording triggers.

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

## Automatic and compatibility delivery

Automatic browser text output requires an extension-origin token, broker-allocated session and
exact-element recipient receipt. A native input-context lease alone never authorizes a write.
The default and unsupported targets retain text in VOCO for an explicit Copy action.

The legacy `insert_text` API remains for compatibility but is not called by automatic dictation.
It selects ydotool on Wayland or xdotool on X11. `auto` may fall back to clipboard only when the
first helper never started; any post-spawn failure is uncertain and stops automatic retry. The
success outcome is `dispatched`, because helper completion cannot prove target consumption.
Clipboard insertion leaves the transcript in the clipboard. It never restores an old text-only
snapshot over newer clipboard ownership or pretends to preserve all MIME formats.

## Persistent IBus Input Source

The Debian package advertises a rank-zero input source; VOCO never selects or restarts it. It can
supply consuming recording shortcuts while the app is live, and normal keys pass through otherwise.
Private protocol v5 retains same-user socket checks and bounded messages, but rejects `start`,
preview updates, commits, checkpoints, finalization and cancellation of old text leases. This
operational block applies even when content metadata looks safe. Historical ownership algorithms
and tests are not authorization to reactivate generic IBus delivery.

## Exact-field Transport

The native host validates one fixed extension origin. Its private runtime socket at
`$XDG_RUNTIME_DIR/voco-browser/exact-field.sock` verifies ownership, restrictive modes and Linux
peer UID. One live browser connection owns a generation; tokens, document nonces and request IDs
cannot cross it. This is a same-user boundary, not protection from already-compromised same-user
processes. Browser field value/selection checks stay in the extension; existing page content is
not exported to Rust or a remote service.

Claims/appends expire 1,500 milliseconds after dispatch, while the broker waits two seconds. The
recipient checks the deadline before mutation, including after page hooks. This relies on the
shared host clock; arbitrary clock rollback is not covered. Expiry, invalidation and uncertain
transport outcomes never trigger automatic replay. See [broker acceptance](../testing/browser-broker.md).

## Packaging Boundary

The published binary artifact is the GitHub Release `.deb`. Ubuntu is the primary reference
environment; Debian-derived distributions are best-effort. AppImage publication is paused until its
complete packaging toolchain is immutable and checksum-pinned, and local AppImages do not install the desktop/browser registration files. Flatpak, Flathub, Snap, and Ubuntu App Center
material in the repository is development scaffolding, not a published release channel.

## Logging

Structured logging via `log` + `env_logger`. Default level: `info`. Set `RUST_LOG=debug` for verbose output.

## Key Decisions

- **Tauri over Electron**: Smaller binary, lower memory, better for utility app
- **Local ASR over cloud**: Privacy-first, no account needed, works offline
- **Tray-first UX**: Hidden by default, with a compact popover, settings panel, and status overlay when needed
- **AudioWorklet for capture**: Off-main-thread audio processing with acknowledged transport completion; ScriptProcessorNode fallback requires manual recovery and review.
- **Packed byte audio IPC**: avoids large base64 string construction while keeping a simple full-buffer Rust transcription path
- **Linux-only**: Ubuntu-first, no macOS code paths

## Product Specs

- [Local intelligence](../local-intelligence-spec.md)
- [Streaming ASR feel](../streaming-asr-spec.md)
- [Local intent router](../local-intent-router-spec.md)

## Speech recovery

The existing-model recovery controller, native diagnostics and evidence boundaries
are documented in [local speech recovery](speech-recovery.md).

Native worker waiting, graph cancellation and their evidence limits are described in
[native CPU synchronization](native-cpu-synchronization.md).
