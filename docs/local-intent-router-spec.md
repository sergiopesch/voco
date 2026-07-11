# Local Intent Router Specification

This document defines a future local routing layer that decides what VOCO should do with a
transcript after ASR.

## Scope

The router is a post-ASR decision layer. It does not replace hotkeys, ASR, insertion, OpenClaw, or
Realtime.

- The router runs only when explicitly enabled.
- The router may classify a transcript as dictation, formatting command, local assistant request,
  OpenClaw request, or no-op.
- The router must be explainable and reversible in settings.

The product promise is:

> VOCO can feel more like a voice-native interface while keeping user control clear and avoiding
> surprising actions.

## Routing Requirements

### Explicit Enablement

The router must not surprise existing users.

Acceptance criteria:

- Routing is off by default.
- Existing output target behavior remains unchanged while routing is off.
- Enabling routing shows a clear settings description of what may happen after dictation.
- Users can return to fixed output-target behavior without deleting config.

### Allowed Intents

The initial router supports a small allowlist.

Acceptance criteria:

- `insert_text`: insert the transcript or enhanced transcript.
- `format_text`: apply deterministic spoken formatting commands.
- `ask_local_model`: send the transcript to the localhost local assistant target.
- `ask_openclaw`: send the transcript to the configured OpenClaw text target.
- `no_op`: do nothing for empty, cancelled, or intentionally discarded input.

### Safety Boundaries

The router must not silently perform high-impact actions.

Acceptance criteria:

- The router never performs purchases, login, deletion, form submission, messaging, or account
  changes.
- Browser or app-control actions remain gated by the existing Realtime/OpenClaw browser policies.
- Ambiguous utterances default to `insert_text`.
- Router decisions do not include hidden chain-of-thought or unbounded model output.

## Technical Requirements

### Decision Shape

Router output must be structured.

Acceptance criteria:

- Router output includes `intent`, `confidence`, `text`, and optional `reason`.
- Unknown intents are rejected and fall back to `insert_text`.
- Low confidence falls back to `insert_text`.
- The implementation logs intent and confidence only, never transcript content.

### Implementation Strategy

The first router should be deterministic before it is model-assisted.

Acceptance criteria:

- Explicit command phrases are handled with local rules first.
- A local model router may be added only after deterministic routing tests pass.
- The local model router, if added, uses the same localhost endpoint policy as local intelligence.
- Router prompts must require structured JSON and reject non-JSON responses.

## Validation

Before enabling the router in product settings:

- Unit tests cover every allowed intent, unknown intents, low confidence, and malformed model output.
- Integration tests cover routing with enhancement off, commands-only, and conservative polish.
- Manual QA verifies that ambiguous normal dictation is inserted as text.
- Manual QA verifies that local model/OpenClaw failures do not insert stale output.
- Security docs are updated before release.
