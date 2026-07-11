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

The current cursor commit policy tries to infer stable appendable text from those previews. That is
the fragile part of the product.

## Current Data Flow

1. `Alt+D` starts recording.
2. WebView opens a microphone stream.
3. AudioWorklet posts batched samples to the frontend.
4. Frontend stores full-session samples in memory.
5. A timer collects the recent audio tail for preview ASR.
6. Frontend calls native `preview_transcribe_audio`.
7. Native Whisper transcribes the preview window.
8. Frontend compares the new preview with the previous preview and already committed text.
9. If the policy finds appendable text, frontend calls native `replace_live_text` with zero deletion.
10. Native insertion uses Wayland/X11 typing or clipboard paths.
11. On stop, full audio is resampled and sent to final transcription.
12. Final text is inserted or reconciled by safe append only.

## Design Constraints

The app does not own the target text field. Generic Linux apps do not expose an owned composition
range. Therefore VOCO cannot safely delete or rewrite provisional cursor text.

The only safe generic cursor models are:

- Append-only stable text.
- Owned overlay preview plus final insertion.
- Editor-specific adapters that can manage a known text range.

Current work is attempting append-only stable text for arbitrary Linux apps.

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

### Better Long-Term Design

Move from "compare arbitrary rolling previews" to a segmented live transcript model:

- Audio is divided into time windows.
- Each preview result is associated with a time window.
- A segment becomes sealed only after it is seen consistently or has aged out of the unstable tail.
- Cursor commits sealed segments only.
- The unstable tail stays in VOCO-owned overlay.
- Final transcription replaces quality concerns, but never deletes target text.

This is closer to how a real streaming dictation system should behave. It gives the app explicit
units of work instead of relying on string diff guesses across rolling windows.

## Hard Product Decision

If generic append-only cursor streaming cannot pass the manual QA matrix, VOCO should not pretend it
is production-ready. The product should default to:

- `Preview overlay only` for long dictation confidence.
- `Final text only` for maximum reliability.
- `Stable cursor streaming` as an experimental mode until proven.

The product can still be excellent if the core final insertion path is fast, reliable, and local.
