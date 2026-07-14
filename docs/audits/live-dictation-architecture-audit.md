# Live Dictation Architecture Audit

## Core Finding

The current live cursor streaming design is built on repeated local Whisper preview transcriptions
over a rolling audio window. That can produce useful preview text, but the output is not a stable
streaming transcript. Whisper may:

- Change earlier words.
- Add or remove punctuation.
- Change casing.
- Drop words at the start of the rolling window.
- Rephrase the same recent audio differently across previews.
- Produce disjoint previews that do not share a reliable prefix or suffix.

The earlier cursor commit policy tried to infer globally appendable text from those previews. That
fragile compatibility path has been removed from stable mode.

## Current Data Flow

1. `Alt+D` starts recording.
2. WebView opens a microphone stream.
3. AudioWorklet posts batched samples to the frontend.
4. Frontend stores full-session samples in memory.
5. A timer collects the recent audio tail for preview ASR.
6. Frontend calls native `preview_transcribe_audio`.
7. Native Whisper transcribes the preview window.
8. Frontend seals timestamped segments and revises only the IBus-owned preedit tail.
9. The private IBus engine progressively commits sealed phrases as normal target text.
10. On stop, the complete audio recording always runs through authoritative final transcription.
11. If no normal text was committed, finalization may commit the still-owned preedit. If the final
    exactly matches normal commits, no target command is needed.
12. Every mismatch or invalid session/context preserves the target and keeps the final in VOCO. No
    global append or deletion command is available to stable mode.

## Design Constraints

The app does not own the target document. Generic Linux apps do expose an input-method preedit, but
IBus surrounding text has no fresh editor revision. VOCO can revise its preedit; it cannot safely
delete, rewrite, or append to normal target text during finalization.

The only safe generic cursor models are:

- Bounded owned preedit plus progressive normal commits.
- Owned overlay preview plus final-preserved output.
- Editor-specific adapters that can manage a known text range.

Current stable mode uses bounded preedit and fails closed to VOCO-owned output.

## Why Words Stop Appearing

Recent trace evidence shows repeated preview completion with no insertion. This means:

- Audio capture is active.
- Preview ASR is active.
- Native insertion has not failed.
- The commit policy is refusing to append.

Root cause:

The commit policy is trying to avoid corruption by rejecting anything it cannot reconcile with
already committed text. With real rolling Whisper previews, normal continuation can look like an
unsafe rewrite. Once that happens, visible cursor text stalls even though previews continue.

## Complexity Hotspots

### `useDictation.ts`

This file is too broad. It should not own every aspect of the product loop.

Candidate extraction boundaries:

- `audioCaptureBuffer.ts` - append samples, count samples, collect recent tail, merge final audio.
- `livePreviewScheduler.ts` - cadence, in-flight preview gating, adaptive delay.
- `liveCommitPolicy.ts` - pure append decision logic with extensive tests.
- `dictationFinalizer.ts` - final ASR, enhancement, final insertion/reconciliation.
- `dictationTrace.ts` - privacy-safe event helpers.

### Commit Policy

The current policy mixes:

- Stable prefix logic.
- Rolling suffix-prefix overlap.
- Normalized character matching.
- Normalized word matching.
- Disjoint rolling append fallback.
- Unsafe rewrite detection.

This should be isolated into a pure module with a fixture suite built from real anonymized trace
shapes. Tests should not need React or `useDictation`.

### Native Boundary

The native boundary correctly rejects deletion for live cursor streaming. That invariant should stay.

The current issue is not native insertion failure. It is frontend commit refusal.

## Recommended Architecture

### Near-Term Stabilization

Default to reliability:

- Keep final dictation as source of truth.
- Keep live cursor streaming append-only.
- Add a product-grade fallback when append confidence is low:
  - Continue showing live preview in VOCO overlay.
  - Stop trying to type uncertain live text at the cursor.
  - Final insertion still runs.

But if the user chooses `Stable cursor streaming`, the app should avoid silent stalls. It should
either append measured stable segments or explicitly switch to overlay-only for that session with a
single notification.

### Segmented Design Implemented

The direct-cursor path now uses the segmented model:

- Native Whisper previews return text plus segment start/end timestamps.
- Preview audio is anchored to the oldest uncommitted session sample and bounded to 20 seconds.
- Consecutive previews confirm whole timestamped Whisper segments; partial segments are never typed.
- The audio anchor advances only through confirmed segments that have already been typed.
- The direct-cursor policy cannot use disjoint rolling-window heuristics to jump over missing words.
- On stop, VOCO transcribes and appends the complete unsealed audio tail, so every source-audio range
  is covered without deleting target text. If tail insertion fails, full-session final transcription
  remains the non-destructive fallback.

This gives the app explicit audio-backed units of work instead of relying on string diff guesses
across arbitrary rolling windows. Overlay-only mode keeps its short rolling preview because it does
not mutate cursor text.

## Hard Product Decision

If generic append-only cursor streaming cannot pass the manual QA matrix, VOCO should not pretend it
is production-ready. The product should default to:

- `Preview overlay only` for long dictation confidence.
- `Final text only` for maximum reliability.
- `Stable cursor streaming` as an experimental mode until proven.

The product can still be excellent if the core final insertion path is fast, reliable, and local.

## July 2026 Captured-Session Evidence

A 152.475-second local capture completed with 133 preview transcriptions, 23 sealed window
advances, no insertion failure, no unsafe rewrite, no overlay fallback, and a successful tail flush.
The 338-word cursor output exactly matched the word sequence submitted from the target field. This
proves the anchored segmented path fixed the earlier transport stall and did not truncate the
session.

It did not meet the live-performance target:

- speech began within the first 150 ms of captured audio
- first cursor text appeared at 2.527 seconds
- preview inference was 668 ms p50 and 791 ms p95
- cursor update gaps were 6.519 seconds p50 and 10.265 seconds p95
- sealed Whisper segments were 6.640 seconds p50 and 9 seconds p95

The recognizer is fast enough; waiting for long Whisper segments to become immutable is the source
of the visible pauses. A preview-only experiment using word-aligned 24-character segments increased
cursor updates from 24 to 57 and reduced gap p95 to 4.598 seconds, but replay word error rose to 12%
and the result still missed the latency target. The experiment was rejected rather than exchanging
accuracy for an incomplete speed improvement.

### 133.953-Second Technical-Dictation Capture

A later one-shot capture contained 116 previews and completed without insertion failure, preview
failure, unsafe rewrite, an unreconciled final, or a missing tail. Stop-to-final transcription was
1.178 seconds and stop-to-idle was 2.644 seconds. The integrity path is therefore healthy for this
session, but the live experience still failed the product thresholds:

- first cursor text appeared after 5.608 seconds
- preview inference was 648 ms p50 and 758 ms p95
- cursor update gaps were 3.505 seconds p50 and 8.145 seconds p95
- only 31 cursor insertions occurred while 80 previews were waiting for a safe commit
- captured-WAV replay produced a 19.67% word-sequence disagreement against the independent
  full-session base.en transcript

The full-session transcript is an independent ASR reference, not a human-corrected ground truth, so
the disagreement rate is a regression signal rather than a claim of absolute WER. It nevertheless
exposed missing phrases and rolling-window substitutions in the cursor result.

Targeted A/B experiments were rejected:

- prompting each window with recently committed text increased replay disagreement to 29.61% and
  reduced cursor updates from 24 to 9
- forced word-aligned token segments improved cadence but increased disagreement to 27.95%; holding
  back four segments improved it only to 24.22%
- enabling token timestamps without forced splitting left output and cadence unchanged while making
  the replay take 162 seconds
- `small.en` exceeded the 180-second live replay timeout; its full-session pass took 44.94 seconds,
  used about 1.3 GB, and disagreed with the base.en full-session reference by 48.40%
- an older streaming Zipformer reached 1.5-second first text and 300 ms median updates but disagreed
  by 52.88%
- the 560 ms Nemotron streaming model reached 1.3-second first text and 600 ms median updates at a
  0.139 real-time factor, but still disagreed by 24.73%

These results rule out a scheduler-only fix, a larger Whisper model, and the tested drop-in online
models for direct append-only cursor output.

### Architecture Consequence

VOCO now owns only the changing cursor tail through an IBus preedit range. Sealed phrases
progressively become normal target text so the editor performs native wrapping; repeated stateless
Whisper windows can still revise the current candidate without synthetic deletion. Full-session
Whisper remains the final source of truth. Because IBus surrounding text is cached and has no
target-bound revision, the private engine never deletes, rewrites, or appends to progressively
committed text. A mismatch preserves target text and exposes the final transcript in VOCO.

Unsupported or invalidated fields use VOCO preview/final-preserved behavior. The former global
append-only ydotool/xdotool compatibility streamer is no longer part of stable cursor mode.
Long-session safeguards now include an exact 10-minute automatic cutoff, bounded 20-second preview
windows, indexed access to late-session audio chunks, 30-second overlapping final-ASR chunks, and a
captured-WAV replay that measures coverage, word error, and update gaps.
