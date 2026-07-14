# Cursor Streaming Dictation Hardening Spec

## Purpose

Make VOCO's cursor-visible live dictation feel fast, stable, and trustworthy on Linux without
corrupting text in the target application.

The current implementation proved that live ASR previews can be produced locally, but direct cursor
streaming is not yet product-quality. The main issue is not Whisper alone. It is the contract between
VOCO, synthetic keyboard insertion, and arbitrary Linux text fields.

## Product Goal

When the user presses `Alt+D` in a text field and speaks for anything from a short note to a long
dictation session:

1. Text should appear at the cursor quickly enough to feel live.
2. VOCO should not delete or corrupt existing user text.
3. Pressing `Alt+D` again should stop promptly.
4. The final text should be clean, complete, and not duplicated.
5. If live cursor streaming cannot be made safe in the current target app, VOCO should degrade to a
   stable non-destructive behavior instead of glitching.

The implementation must manage work as bounded windows. A 10-minute dictation must not cause live
preview latency, cursor reconciliation cost, or native ASR calls to grow without limit.

## Failure History To Account For

These failures have already occurred and must be designed out:

- Live transcript preview worked, but text was not visible at the cursor.
- Cursor streaming typed provisional words, but revisions used synthetic deletion and corrupted text.
- Raw `ydotool` key-state tokens leaked `1` characters into text fields.
- Finalization was slow when replacement deleted many characters.
- Extra `Alt+D` presses during finalization could queue another recording.
- Append-only streaming avoided deletion, but could commit unstable early ASR text.
- After a short period, words could stop appearing because later ASR previews no longer shared a safe
  prefix with already-typed text.

## Non-Negotiable Product Invariants

- VOCO must remain local-first.
- Core dictation must not require cloud services, accounts, telemetry, or subscriptions.
- Final dictation quality must not be worse than the bounded local Whisper transcription path.
- VOCO must not send destructive key sequences to arbitrary target apps during live streaming.
- Hotkey stop must remain responsive even while preview or insertion work is in progress.
- Logs and traces must not contain transcript text, audio samples, or target-app content.

## Core Design Principle

Arbitrary Linux applications do not provide VOCO with an owned document range, but IBus can provide
an app-owned composition (preedit) range at the active input context. VOCO must use that range for
provisional dictation instead of simulating destructive edits.

Therefore, VOCO cannot reliably "replace" provisional text in the target application using
Backspace/Delete unless it owns the target editor integration. Generic cursor streaming must use one
of these safe models:

1. **Bounded input-method preedit**: progressively commit sealed phrases for native target layout,
   while owning and revising only the changing tail at the cursor.
2. **Owned composition surface**: show provisional text in VOCO-controlled UI, then expose final text
   without mutating an unproven target.
3. **Editor-aware adapters**: for specific editors/apps, use their APIs to manage a known range.

The product uses model 1 for cursor streaming and model 2 when an owned preedit is unavailable or
invalidated. Generic synthetic append/delete compatibility is not part of stable mode. Model 3
remains out of scope until specific app integrations are planned.

## Recommended Architecture

### 1. Session State Machine

Create an explicit dictation session object that owns:

- `sessionId`
- recording phase
- preview generation
- insertion generation
- committed cursor text length
- last ASR preview metadata
- stop/finalization state
- cancellation state

Acceptance criteria:

- Every async preview, enhancement, and insertion operation checks the active `sessionId` before
  mutating state.
- Pressing `Alt+D` during `stopping`, `processing`, or `finalizing` is ignored or debounced; it never
  queues a new recording.
- A new recording cannot start until finalization has reached `idle` or `error`.
- The state machine has focused unit tests for rapid double-tap, stop during preview, preview after
  stop, and finalization failure.

### 2. Live ASR Preview Pipeline

Keep the final local Whisper transcription path as source of truth. Live preview is an assistive
stream, not final output.

Acceptance criteria:

- Live previews are cancellable by `sessionId`.
- At most one preview ASR request runs at a time.
- Preview cadence is adaptive:
  - initial preview target: 700-1200 ms after speech starts
  - steady preview target: 800-1400 ms depending on model latency
  - never overlap preview calls
- Preview input is bounded by a rolling audio window.
- Stable cursor preview input is anchored to the oldest uncommitted audio and advances only through
  committed timestamped Whisper segments; overlay-only preview may use a recent rolling window.
- Preview reconciliation supports rolling windows that no longer contain the full committed
  transcript prefix.
- Preview failures disable live cursor streaming for that session but do not break final dictation.
- Preview traces include durations and status only, never transcript content.

### 3. Owned Preedit Revision Policy

Display every usable preview in the owned preedit range. Use stable, timestamped segments to advance
the bounded audio window, while keeping the remaining words provisional and automatically revisable.

Recommended policy:

- Show the first non-empty preview immediately.
- Compare consecutive ASR previews and seal only whole timestamped segments for audio-window
  advancement.
- Progressively commit the sealed prefix as normal target text so the target editor controls wrapping
  and paragraph layout.
- Keep only the unsealed candidate and its leading separator in the VOCO-owned preedit range.
- On unsupported clients, keep preview/final text in VOCO rather than using global cursor injection.
- Keep final text quality through a full-session final ASR pass and optional enhancement.

Acceptance criteria:

- Unit tests cover:
  - stable prefix grows normally
  - ASR changes punctuation
  - ASR changes earlier words
  - ASR repeats words
  - ASR shortens the preview
  - no common stable prefix
- Live cursor streaming never synthesizes Backspace/Delete or asks the user to repair text.
- Generic IBus finalization never calls `DeleteSurroundingText`. Its cached surrounding-text API has
  no request nonce or editor revision and therefore cannot authorize destructive editing.
- Focus loss clears the provisional tail and preserves any already committed text rather than
  inserting a duplicate transcript into a different field.

### 4. Cursor Input Backend

Preferred live cursor streaming uses a private IBus engine owned by the VOCO process.

Acceptance criteria:

- The sidecar is child-process scoped, accepts only structured stdin commands, and never logs or
  returns transcript text.
- The sidecar does not request, retain, return, log, or persist surrounding target text.
- Start captures the previous global engine; commit, cancel, failure, and app exit restore it.
- Service-issued session generations reject renderer reloads and stale preview/finalization commands.
- Headless command-level tests assert that mismatch, prefix-only match, cursor/context reset,
  focus/context changes, session races, cancellation, target closure, and the long synthetic case
  emit no target command. The command model cannot represent deletion.
- Stable cursor mode has no ydotool/xdotool insertion command or destructive compatibility route.
- Settings diagnostics clearly show `ydotoold` status.

### 5. Finalization

Stopping dictation must be fast and predictable.

Acceptance criteria:

- Stop-to-final-visible target for ordinary dictation is measured and reported.
- Finalization never uses synthetic deletion or deletes an unverified target-app range.
- Preferred-path finalization always runs full-session local Whisper and clears only the bounded
  preedit tail. If no normal text was progressively committed, VOCO may commit the still-owned final
  preedit. If the final exactly equals progressively committed text, no target command is needed.
- Any final that would revise or extend normal target-app text is preserved in VOCO; generic IBus
  finalization does not delete, replace, or append to that text.
- Cancel, teardown, and error recovery clear only VOCO's provisional preedit; progressively committed
  target text is preserved.
- If final text cannot be safely reconciled with committed live text:
  - do not corrupt the field
  - preserve the committed live text
  - optionally expose final transcript in VOCO UI or clipboard as a non-destructive fallback
- Finalization must complete state transition to `idle` even if insertion fails.
- Pressing `Alt+D` repeatedly during finalization does not start a new recording.

### 6. Fallback Product Behavior

If cursor streaming is not safe or not supported for the current environment, VOCO should degrade
gracefully.

Acceptance criteria:

- If live cursor insertion fails once in a session, disable live cursor insertion for that session.
- Stable mode does not run generic final insertion after its owned target lease fails. The final
  transcript remains available in VOCO without risking another field.
- The user sees a concise notification only once per session.
- Settings can offer a mode choice:
  - `Stable cursor streaming`
  - `Preview overlay only`
  - `Final text only`
- Default should be the most reliable mode until cursor streaming passes QA.

## Performance Requirements

Acceptance criteria:

- Measure and document:
  - hotkey-to-recording-active
  - first speech-to-first-live-text
  - preview ASR duration p50/p95
  - stop-to-final-transcript
  - stop-to-idle
- The trace report fails stable cursor streaming when first live text exceeds 1500 ms or cursor
  update gap p95 exceeds 2000 ms.
- Live cursor updates should not block audio capture.
- No more than one live ASR request may run at a time.
- Live ASR requests must remain bounded by a small recent-audio window, independent of total
  dictation length.
- Final ASR must chunk long recordings so 10-minute dictation does not depend on one unbounded
  Whisper call.
- Recording must stop automatically at the 10-minute limit instead of accepting additional audio
  and failing after the user stops.
- Collecting a late anchored preview range must not scan every earlier audio chunk.
- No long synchronous loops on the UI thread.
- No per-character subprocess spawning.
- Preview cadence must back off when model latency exceeds the interval.

## Manual QA Matrix

Run every case in a disposable Ubuntu Wayland VM with IBus and the VOCO-owned preedit active:

- Empty text field, short sentence.
- Empty text field, 20-30 second paragraph.
- Existing text before cursor.
- Existing text after cursor.
- Cursor in middle of paragraph.
- User presses `Alt+D` twice quickly.
- User presses stop while a preview is in flight.
- User speaks, pauses, then continues.
- User says punctuation-heavy sentence.
- User says words that Whisper commonly revises.
- Target apps:
  - Text editor
  - Browser textarea
  - Chat input
  - Terminal text prompt where safe

Pass criteria:

- No existing text is deleted.
- No raw key codes or numbers appear.
- No duplicate final transcript appears.
- Stop returns to idle quickly.
- If live words stop appearing, trace explains why.
- Final text remains acceptable.

## Automated Test Requirements

Acceptance criteria:

- Unit tests for stable prefix policy.
- Unit tests proving a final suffix is preserved rather than injected after progressive commits.
- Unit tests for state machine transition gating.
- Rust/static tests proving stable mode exposes no deletion or global live-insertion command.
- Rust tests proving `ydotoold virtual device` is ignored.
- Frontend tests covering:
  - preview after stop ignored
  - insertion failure disables live stream for that session
  - repeated stop hotkey does not queue start

## Documentation Requirements

Acceptance criteria:

- `docs/streaming-asr-spec.md` links to this hardening spec.
- `docs/testing/README.md` links to the manual QA checklist.
- Settings copy accurately describes cursor streaming limitations.
- Troubleshooting explains `ydotoold`, Wayland caveats, and how to disable live cursor streaming.

## Out Of Scope

- Editor-specific range ownership integrations.
- Cloud ASR.
- Replacing Whisper final transcription.
- Telemetry.
- Packaging claims for stores or sandbox formats.

## Definition Of Done

Cursor streaming is product-ready only when:

- All acceptance criteria above pass.
- Manual QA is completed and documented.
- No known path can delete existing target-app text.
- Stop/finalization is consistently responsive.
- The user can choose a conservative fallback mode.
- The implementation is simpler and easier to reason about than the current experimental path.
