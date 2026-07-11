# Codex Goal: Stabilize VOCO Core Dictation

Use this as the goal prompt for a focused Codex run.

## Objective

Review the VOCO audit files, test the current implementation, fix the highest-priority core
dictation issues, validate the fixes, rebuild the installed desktop app if needed, and repeat until
VOCO's core local dictation flow meets the stabilization spec.

## Required Reading

Read these first:

- `AGENTS.md`
- `README.md`
- `docs/audits/2026-06-08-current-state-audit.md`
- `docs/audits/live-dictation-architecture-audit.md`
- `docs/audits/stabilization-risk-register.md`
- `docs/perfect-dictation-stabilization-spec.md`
- `docs/cursor-streaming-dictation-hardening-spec.md`
- `docs/testing/cursor-streaming-manual-qa.md`
- `docs/testing/cursor-streaming-qa-results.md`

Then inspect:

- `apps/desktop/src/hooks/useDictation.ts`
- `apps/desktop/src/lib/dictationSession.ts`
- `apps/desktop/src/lib/audioInput.ts`
- `apps/desktop/public/audio-processor.js`
- `apps/desktop/src-tauri/src/insertion.rs`
- `apps/desktop/src-tauri/src/transcribe.rs`
- `apps/desktop/src-tauri/src/lib.rs`

## Operating Rules

- Do not add new product features.
- Do not broaden local intelligence or realtime assistant work during this goal.
- Prioritize core dictation reliability over live cursor ambition.
- Prefer extracting pure modules over adding more logic to `useDictation.ts`.
- Keep live cursor insertion append-only.
- Do not log transcript text, audio samples, or target-app content.
- Preserve local-first behavior.
- Preserve the installed app launcher wrapper unless there is a better documented replacement.

## Work Loop

Repeat until the definition of done is met:

1. Read the latest trace and QA docs.
2. Identify the highest-priority failing acceptance criterion.
3. Write or update a focused test that reproduces the issue when practical.
4. Implement the smallest durable fix.
5. Run focused validation.
6. Run full validation.
7. Rebuild and reinstall the local desktop app if runtime behavior changed.
8. Run or request the next manual QA pass.
9. Update the QA/audit docs with proven evidence and remaining risks.

## Validation Commands

```bash
npm run check
npm test
npm run lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
npm run verify:versions
npm run report:linux-runtime
npm run report:cursor-streaming
npm run build -w apps/desktop
desktop-file-validate "$HOME/.local/share/applications/VOCO.desktop"
```

## Manual QA Required

Do not mark the goal complete without manual QA evidence for:

- 10-second dictation.
- 30-second dictation.
- 1-minute dictation.
- Existing text before cursor.
- Existing text after cursor.
- Browser textarea.
- Chat input.

For long-dictation completion, also test:

- 5-minute dictation.
- 10-minute dictation.

## Completion Criteria

The goal is complete only when:

- Core dictation starts reliably.
- Live cursor words either keep appearing or VOCO visibly falls back instead of silently stalling.
- Final transcript insertion works.
- No target-app text is deleted.
- Automated checks pass.
- Installed app is rebuilt and running.
- Audit/QA docs are updated with current evidence.
