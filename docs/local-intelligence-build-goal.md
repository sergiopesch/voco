# Local Intelligence Build Goal

## Goal

Build VOCO's next local intelligence milestone: make the new localhost model feature production-ready
for daily dictation by hardening UX, tests, and manual QA around transcript enhancement and the
local assistant target.

## Primary Objective

Starting from the current implementation, deliver a polished v1 where a user can:

1. Run an OpenAI-compatible local model server on localhost.
2. Enable `Voice formatting commands` or `Conservative local polish`.
3. Dictate normally with `Alt+D`.
4. Get either formatted/polished text inserted at the cursor or a local model answer inserted via
   `Ask local model and type answer`.
5. Fall back cleanly to raw dictation when the local model server is missing.

## Acceptance Criteria

- Settings clearly communicate that the feature is optional, localhost-only, and bring-your-own
  model.
- `Test local model` reports success and actionable failure messages.
- Enhancement failure never blocks direct dictation insertion.
- Local assistant failure never inserts stale or partial output.
- Existing OpenClaw and realtime behavior remain unchanged.
- Tests cover config defaults, endpoint validation, local model response parsing, formatting
  commands, settings state, and dictation fallback behavior.
- Docs link the local intelligence spec from relevant install, architecture, and security notes.

## Suggested Next Work Order

1. Add focused frontend tests for dictation enhancement fallback by mocking the Tauri bridge.
2. Add a lightweight manual QA script or checklist for local `llama-server` validation.
3. Improve local model status copy in settings with the exact endpoint being tested.
4. Add timing trace fields for enhancement and local assistant latency without transcript content.
5. Review and refine UX copy after testing with a real Gemma/llama.cpp server.

## Out Of Scope For This Goal

- Bundled model downloads.
- Remote model providers.
- Replacing Whisper.
- Streaming/windowed ASR.
- Intent routing.
- Packaging claims for Snap, Flatpak, Flathub, or Ubuntu App Center.

## Manual QA Reference

Use [testing/local-intelligence-manual-qa.md](testing/local-intelligence-manual-qa.md) for the
localhost model validation checklist.
