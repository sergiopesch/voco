# Cursor Streaming Dictation Hardening Spec

## Purpose

Make VOCO's cursor-visible live dictation feel fast, stable, and trustworthy on Linux without
corrupting text in the target application.

The protocol-v3 canonical implementation is complete in the workspace and has automated ownership,
boundary, and captured-replay evidence. Direct cursor streaming is not yet product-quality because
the new build has not completed installed-package manual QA across supported Linux target fields.

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
- Normal operational logs and privacy-safe timing traces must not contain transcript text, audio
  samples, or target-app content. The explicitly enabled `VOCO_DEBUG_CAPTURE_AUDIO=1` developer
  capture is the documented exception: it persists one private WAV and transcript timeline for
  local diagnosis until the user deletes them.

## Core Design Principle

Arbitrary Linux applications do not provide VOCO with an owned document range, but IBus can provide
an app-owned composition (preedit) range at the active input context. VOCO must use that range for
provisional dictation instead of simulating destructive edits.

Therefore, VOCO cannot reliably "replace" provisional text in the target application using
Backspace/Delete unless it owns the target editor integration. Generic cursor streaming must use one
of these safe models:

1. **Bounded input-method preedit plus canonical checkpoints**: keep preview text revisable, then
   commit only exact, prefix-checked results from authoritative audio chunks.
2. **Owned composition surface**: show provisional text in VOCO-controlled UI, then expose final text
   without mutating an unproven target.
3. **Editor-aware adapters**: for specific editors/apps, use their APIs to manage a known range.

The product uses model 1 only for enhancement-off stable cursor streaming. Enhancement modes use
model 2 followed by a one-shot enhanced final insertion. Model 2 is also the fail-closed behavior
when an owned preedit is unavailable or invalidated. Generic synthetic append/delete compatibility
is not part of stable mode. Model 3 remains out of scope until specific app integrations are planned.

## Protocol-v3 Canonical Architecture

### 1. Session State Machine

Create an explicit dictation session object that owns:

- `sessionId`
- recording phase
- preview generation
- insertion generation
- cached canonical text
- target-acknowledged canonical prefix
- processed source and canonical audio boundaries
- completed canonical chunk count
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

Keep canonical local Whisper chunks as source of truth. Live preview is an assistive stream, not
final output and not commit authority.

Acceptance criteria:

- Live previews are cancellable by `sessionId`.
- At most one preview ASR request runs at a time.
- Preview cadence is adaptive:
  - initial preview target: 700-1200 ms after speech starts
  - steady preview target: 800-1400 ms depending on model latency
  - never overlap preview calls
- Preview input is bounded by a rolling audio window.
- Stable cursor preview input remains bounded and is re-anchored after canonical checkpoint work;
  overlay-only preview may use a recent rolling window.
- Preview reconciliation supports rolling windows that no longer contain the full committed
  transcript prefix.
- Preview failures may pause provisional cursor updates but do not alter cached canonical truth or
  authorize a different final path.
- Preview traces include durations and status only, never transcript content.

### 3. Owned Preedit Revision Policy

Display every usable preview in the owned preedit range. Timestamped segments may advance the
bounded preview window, but all preview wording remains provisional and automatically revisable.
Only canonical audio checkpoints can advance normal target text.

Recommended policy:

- Show the first non-empty preview immediately.
- Keep preview text inside the VOCO-owned preedit; repeated preview agreement is never commit proof.
- Preprocess stable, non-overlapping source blocks ending at 30, 59, 88 seconds, and subsequent
  29-second strides.
- Transcribe authoritative 30-second canonical ranges with one second of overlap: `0-30`, `29-59`,
  `58-88`, and so on.
- Append each result to an immutable canonical prefix and checkpoint only its exact new suffix.
- After a checkpoint, retain only the newer provisional candidate in preedit while the acknowledged
  canonical prefix is ordinary target text.
- On unsupported clients, leave the target unchanged and report the final as unreconciled rather
  than using global cursor injection.
- At stop, reuse cached exact chunks as final truth and transcribe only unprocessed complete ranges
  plus the remaining partial range.
- Keep enhancement separate: enhancement modes use overlay preview and one-shot final insertion.

Acceptance criteria:

- Unit tests cover exact 29.9, 30, 30.1, 59, 66.5339375, and 600-second boundaries; immutable
  canonical prefixes; exact target acknowledgement; stop completion; and retrying transcription
  work without retrying an uncertain target mutation.
- Live cursor streaming never synthesizes Backspace/Delete or asks the user to repair text.
- Generic IBus finalization never calls `DeleteSurroundingText`. Its cached surrounding-text API has
  no request nonce or editor revision and therefore cannot authorize destructive editing.
- Focus loss clears the provisional tail and preserves any already committed text rather than
  inserting a duplicate transcript into a different field.

### 4. Cursor Input Backend

Preferred live cursor streaming uses the persistent `VOCO Dictation` IBus input source. The Debian
package advertises it, IBus owns its process, and the user explicitly enables/selects it. VOCO never
changes the global engine or input-source settings.

Acceptance criteria:

- The engine accepts one same-user app connection over a private, versioned, bounded Unix-socket
  protocol and never logs or returns transcript text.
- App and engine both require protocol v3. Canonical `checkpoint` and `finish-canonical` commands
  carry an exact expected committed prefix plus one exact append.
- The runtime directory is 0700, the socket is 0600, both peers verify `SO_PEERCRED`, and an absent
  or unsafe `XDG_RUNTIME_DIR` fails closed.
- The engine does not request, retain, return, log, or persist surrounding target text.
- The app never spawns, stops, registers, selects, switches, or restores an IBus engine.
- Service-issued session generations reject stale preview/finalization commands, and a renderer page
  reload closes the backend socket so the engine clears only its preedit before accepting a new one.
- App disconnect, focus/source/context changes, normal key input, and missing preedit capability
  clear only preedit and invalidate the active generation. Every real focus entry clears prior
  content-type proof and requires a fresh, established, non-sensitive callback for that exact input
  context before a lease can start; same-context re-entry and a synthetic global-engine proxy cannot
  reuse or renew earlier proof.
- IBus 1.5 global-engine mode suppresses forwarding an unchanged content tuple. Consecutive focuses
  with identical purpose/hints therefore remain preview-only until a changed explicit safe tuple is
  forwarded; `FREE_FORM` with no hints is ambiguous and never establishes proof.
- Terminal purpose, password/PIN purpose, private/hidden content hints, and missing or ambiguous
  content metadata are ineligible for live cursor streaming and fail closed to VOCO preview.
- Headless command-level tests assert that invalid ownership, an unexpected committed prefix,
  cursor/context reset, focus/context changes, session races, cancellation, input-source
  replacement, and target closure emit no canonical target command. The command model cannot
  represent deletion.
- An ordered engine rejection is a known failure. A timeout, disconnect, malformed response, request
  mismatch, or other uncertain mutation outcome closes the socket and is never retried.
- Stable cursor mode has no ydotool/xdotool insertion command or destructive compatibility route.
- Settings diagnostics distinguish missing, not-enabled, ready, runtime-unavailable, and
  version-incompatible input-source states.

### 5. Finalization

Stopping dictation must be fast and predictable.

Acceptance criteria:

- Stop-to-final-visible target for ordinary dictation is measured and reported.
- Finalization never uses synthetic deletion or deletes an unverified target-app range.
- Enhancement-off stable cursor finalization never reruns or revises a successful canonical chunk.
  It waits for checkpoint work, transcribes any deferred complete range, transcribes the remaining
  partial range once, and commits the exact suffix after the acknowledged prefix.
- Cached exact chunks plus the final partial result are final truth. A separate full-session result
  cannot overwrite them.
- Enhancement modes do not emit canonical checkpoints. They keep preview in VOCO's overlay, run the
  full final transcription and enhancement after stop, then use a one-shot insertion.
- Cancel, teardown, and error recovery clear only VOCO's provisional preedit; acknowledged canonical
  target text is preserved.
- If canonical target delivery cannot be proven:
  - do not delete or rewrite the field
  - do not retry an uncertain mutation
  - do not use generic insertion against a possibly different target
  - report the canonical final as unreconciled
- Finalization must complete state transition to `idle` even if insertion fails.
- Pressing `Alt+D` repeatedly during finalization does not start a new recording.

### 6. Fallback Product Behavior

If cursor streaming is not safe or not supported for the current environment, VOCO should degrade
gracefully.

Acceptance criteria:

- If live cursor insertion fails once in a session, disable live cursor insertion for that session.
- Stable mode does not run generic final insertion after its owned target lease fails. It reports
  the final as unreconciled without risking another field.
- Enhancement-on cursor modes use overlay preview and one-shot final insertion by design; they do
  not partially use the stable canonical route.
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
- Canonical ASR must cache bounded chunks as recording progresses so 10-minute dictation does not
  depend on one unbounded Whisper call or rerun already accepted chunks at stop.
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
- Boundary dictations ending just before, at, and just after 30 and 59 seconds.
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
  - Terminal text prompt (verify preview-only fallback; live cursor is intentionally unavailable)

Pass criteria:

- No existing text is deleted.
- No raw key codes or numbers appear.
- No duplicate final transcript appears.
- Stop returns to idle quickly.
- If live words stop appearing, trace explains why.
- Successful checkpoint traces occur at the expected 30/59/88 cadence for long enough recordings.
- Final target text exactly matches canonical cached text.
- Focus loss followed by the same real context remains preview-only until that focus receives a
  fresh safe content-type callback; fake/global proxy focus cannot preserve the earlier proof.
- Terminals and sensitive or ambiguous targets emit no owned-preedit start or checkpoint command.

## Automated Test Requirements

Acceptance criteria:

- Unit tests for immutable canonical prefix and exact-suffix policy.
- Stateful tests for the pinned 44.1 kHz / 66.5339375-second capture and complete 10-minute source,
  overlap, and final-tail sequences.
- Unit tests for state machine transition gating.
- Rust tests proving canonical commands atomically carry the expected prefix and append, protocol v3
  mismatches fail closed, uncertain mutation outcomes are not retried, and stable mode exposes no
  deletion or global live-insertion command.
- Python ownership/protocol/engine tests proving exact canonical appends and invalidation behavior.
- Pinned WAV replay proving exact `0-30`, `29-59`, and `58-final` outputs and cumulative hashes.
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
- Replacing local Whisper as the canonical and final recognizer.
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

Focused v3 state, bridge, ownership/protocol, and pinned-replay checks are passing in the workspace.
Installed Debian-package manual QA remains pending, so the product-ready definition is not yet
satisfied.
