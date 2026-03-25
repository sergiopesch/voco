# Testing

## Current State
No automated test suite exists yet. This document outlines the planned testing strategy.

## Planned Stack
- **Unit/Integration**: Vitest (frontend), cargo test (Rust)
- **E2E**: Playwright or Tauri's WebDriver support
- **Manual**: Socket-based trigger testing

## Priority Test Targets

### High Priority
1. **Rust insertion logic** (`insertion.rs`) — Strategy selection, shell command construction, fallback chain
2. **Rust transcription** (`transcribe.rs`) — Model loading, audio processing, hallucination filtering
3. **Rust config** (`config.rs`) — Serialize/deserialize, default creation, XDG path resolution

### Medium Priority
4. **Frontend dictation hook** (`useDictation.ts`) — State machine, audio capture lifecycle, resampling
5. **Zustand store** (`useStore.ts`) — All actions produce correct state transitions
6. **Frontend bridge** (`tauri.ts`) — Invoke contracts match Rust command signatures

### Lower Priority (system boundaries)
7. **Tray state** — Recording/idle transitions, menu text updates
8. **E2E dictation flow** — Requires mic + ASR + insertion (manual or mocked)

## Manual Verification
For system-level features that are hard to automate:
- Trigger via Unix socket: `printf "toggle" | socat - UNIX-CONNECT:$XDG_RUNTIME_DIR/voice.sock`
- Check tray icon state visually
- Verify insertion in a text editor
- State the distro, desktop environment, compositor, and insertion path used

## Setup Required
- Install: `npm install -D vitest`
- Add `vitest.config.ts` to apps/desktop
- Add `test` script to apps/desktop/package.json
- Add `#[cfg(test)]` modules in Rust code
