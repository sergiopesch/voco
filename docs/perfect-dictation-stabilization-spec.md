# Perfect Dictation Stabilization Spec

## Goal

Stabilize VOCO's core dictation product so it is reliable, local-first, and testable before adding
more features.

"Perfect" means meeting the acceptance criteria in this spec, not abstract perfection.

## Non-Negotiables

- Core dictation remains local-first.
- No account, telemetry, subscription, or cloud dependency in the core flow.
- VOCO must not delete or rewrite user text in arbitrary target apps.
- If live cursor streaming cannot be made reliable, the product must fall back visibly and safely.
- Final dictation quality must remain the source of truth.
- Validation must include both automated checks and manual target-app QA.

## Stabilization Principles

1. Stop feature expansion until core dictation passes.
2. Prefer simpler behavior over complex heuristics.
3. Separate pure logic from React/Tauri orchestration.
4. Prove each behavior with tests before reinstalling the desktop app.
5. Use trace data to diagnose failures without logging transcript content.
6. Rebuild and test the installed app, not only the dev server.

## Required Audit Inputs

Before changing code, read:

- `docs/audits/2026-06-08-current-state-audit.md`
- `docs/audits/live-dictation-architecture-audit.md`
- `docs/audits/stabilization-risk-register.md`
- `docs/cursor-streaming-dictation-hardening-spec.md`
- `docs/testing/cursor-streaming-manual-qa.md`
- `docs/testing/cursor-streaming-qa-results.md`

## Phase 1: Establish A Clean Baseline

Actions:

- Stop all VOCO dev and installed processes.
- Rotate `~/.local/state/voco/hotkey-trace.jsonl`.
- Confirm `~/.local/bin/voco` launches the current installed binary through the clean wrapper.
- Confirm GStreamer elements are available outside Limux-polluted environment:
  - `appsink`
  - `appsrc`
  - `autoaudiosink`
- Confirm Wayland runtime prerequisites:
  - input group
  - `ydotool`
  - `ydotoold`
  - `wl-copy`
  - `wl-paste`

Commands:

```bash
npm run report:linux-runtime
npm run report:cursor-streaming
```

Exit criteria:

- Installed app starts.
- Frontend init completes.
- Hotkey handler is ready.
- No WebKit/GStreamer missing-element errors.

## Phase 2: Freeze And Simplify Core Dictation

Actions:

- Set config for baseline:
  - `transcriptTarget: "cursor"`
  - `liveCursorMode: "stable-cursor-streaming"`
  - `transcriptEnhancement: "off"`
- Do not test local model enhancement until core dictation passes.
- Ensure `useDictation.ts` does not grow further unless extracting modules.

Recommended refactors:

- Extract `liveCommitPolicy.ts`.
- Extract `audioCaptureBuffer.ts`.
- Extract `dictationFinalizer.ts`.

Exit criteria:

- The live commit policy is a pure module with fixture tests.
- Audio buffering can be tested independently.

## Phase 3: Prove Live Cursor Streaming

Manual QA cases:

- 10-second dictation.
- 30-second dictation.
- 1-minute dictation.
- 5-minute dictation.
- Existing text before cursor.
- Existing text after cursor.
- Cursor in middle of paragraph.
- Punctuation-heavy dictation.
- Stop while a preview is in flight.

Target apps:

- Text editor.
- Browser textarea.
- Chat input.
- Safe terminal prompt.

Trace pass criteria:

- `dictation_live_preview_completed` continues during recording.
- `dictation_live_cursor_insert_updated` continues after the first 10 seconds, or VOCO explicitly
  switches to overlay-only for that session.
- `dictation_live_cursor_insert_failed` is zero.
- `dictation_live_cursor_unsafe_rewrite_blocked` does not grow unbounded while previews continue.
- `dictation_stop_to_idle` is captured.

Product pass criteria:

- Existing target-app text is not deleted.
- No raw key codes appear.
- Live words do not silently stop appearing.
- Finalization does not duplicate the transcript.
- Stop returns to idle.

## Phase 4: Prove Final Long Dictation

Test with live cursor mode set to `Final text only` first.

Cases:

- 1-minute dictation.
- 5-minute dictation.
- 10-minute dictation.

Pass criteria:

- No recording-too-long error below 10 minutes.
- Final transcript is complete enough for daily use.
- Chunk boundaries do not obviously drop text.
- Stop-to-final timing is recorded.

## Phase 5: Reintroduce Enhancement

Only after core dictation passes:

1. Test `commands-only`.
2. Test `conservative` with localhost model available.
3. Test missing localhost model fallback.

Pass criteria:

- Enhancement failure never blocks raw dictation insertion.
- Local assistant failure never inserts stale text.
- Latency is traceable without content logging.

## Rebuild And Install Loop

After each fix:

```bash
npm run check
npm test
npm run lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
npm run verify:versions
npm run build -w apps/desktop
```

Then install local binary:

```bash
install -m 755 apps/desktop/src-tauri/target/release/voco "$HOME/.local/bin/voco-bin"
```

Then restart installed app through:

```bash
"$HOME/.local/bin/voco"
```

## Definition Of Done

VOCO is considered stabilized when:

- Automated checks pass.
- Installed app launches cleanly.
- Manual QA matrix passes on Ubuntu Wayland.
- Trace report supports the manual results.
- Docs accurately describe what is stable and what remains experimental.
- No new broad feature work was added during stabilization.
