# Test Insertion Strategy

Analyse the codebase and recommend where to add tests.

## Steps
1. Inventory all testable units:
   - Rust: `transcribe.rs`, `insertion.rs`, `config.rs`, `tray.rs`
   - Frontend: `useDictation.ts`, `useGlobalShortcut.ts`, `useStore.ts`
   - Bridge: `tauri.ts`
   - Types: `types/index.ts`
2. Prioritise by risk and complexity:
   - High: insertion logic (shell command construction, fallback chain)
   - High: transcription flow (audio format conversion, model loading)
   - Medium: dictation hook (state machine, audio capture lifecycle)
   - Medium: config persistence (round-trip serialisation)
   - Low: store (simple Zustand actions)
3. For each target, recommend:
   - Test file location
   - Key test cases
   - Required mocks (Tauri commands, system tools)
   - Testing library (Vitest for frontend, cargo test for Rust)
4. Output a concrete test insertion plan
