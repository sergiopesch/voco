# Architecture Decision Records

Document significant technical decisions here using the format below.

## Template

### ADR-NNN: Title
- **Date**: YYYY-MM-DD
- **Status**: proposed / accepted / deprecated / superseded
- **Context**: What prompted the decision
- **Decision**: What was decided
- **Consequences**: What follows from the decision

---

## Decisions

### ADR-001: Tauri over Electron for desktop shell
- **Date**: 2026-03-24
- **Status**: accepted
- **Context**: Need a desktop runtime for a utility dictation app targeting Linux
- **Decision**: Use Tauri 2 with Rust backend and WebView frontend
- **Consequences**: Smaller binary (~10MB vs ~150MB), lower memory footprint, Rust for performance-sensitive code. Trade-off: smaller ecosystem than Electron, WebKitGTK rendering constraints on Linux.

### ADR-002: Local-first ASR over cloud transcription
- **Date**: 2026-03-24
- **Status**: accepted
- **Context**: Core product must be free and privacy-conscious, no accounts or subscriptions
- **Decision**: Use whisper.cpp via whisper-rs as the primary transcription engine
- **Consequences**: No network dependency, no API costs, works offline after first-run model download. Trade-off: ~142MB model download, higher CPU usage, potentially lower accuracy than cloud ASR.

### ADR-003: Zustand for state management
- **Date**: 2026-03-24
- **Status**: accepted
- **Context**: Need global state for dictation status, config, audio devices
- **Decision**: Use Zustand instead of Redux, Jotai, or React Context
- **Consequences**: Simple API, small bundle, no boilerplate. Sufficient for this app's complexity.

### ADR-004: Monorepo with npm workspaces
- **Date**: 2026-03-24
- **Status**: accepted
- **Context**: Need clean module boundaries between frontend and Tauri backend
- **Decision**: Use npm workspaces with apps/desktop for the Tauri app
- **Consequences**: Clean dependency graph, testable in isolation. Trade-off: slightly more complex build setup.

### ADR-005: WebView audio capture over native Rust audio
- **Date**: 2026-03-24
- **Status**: accepted
- **Context**: Need microphone capture for dictation; could use Web APIs or native Rust audio libs (cpal, etc.)
- **Decision**: Use WebView getUserMedia + ScriptProcessorNode for audio capture
- **Consequences**: Simpler implementation, well-tested browser APIs, automatic device enumeration. Audio data passed to Rust as Float32Array for whisper-rs. Trade-off: requires WebKitGTK window to be "shown" (1x1 transparent off-screen) for getUserMedia to work.

### ADR-006: Linux-only scope
- **Date**: 2026-03-25
- **Status**: accepted
- **Context**: macOS support was planned but never implemented; focus should match reality
- **Decision**: Target Linux only, with Ubuntu as the primary reference environment
- **Consequences**: Simpler codebase, no dead macOS code paths, honest documentation. Debian-derived distros are best-effort. Other distributions are experimental.

### ADR-007: Suppress whisper.cpp C-level logging
- **Date**: 2026-03-25
- **Status**: accepted
- **Context**: whisper.cpp outputs verbose per-token debug info (`whisper_full_with_state`) to stderr
- **Decision**: Set a no-op log callback via `whisper_rs::set_log_callback` and enable `suppress_nst` to prevent non-speech token hallucinations
- **Consequences**: Clean app output. Hallucination tags like `[Music]` also filtered in post-processing as safety net.
