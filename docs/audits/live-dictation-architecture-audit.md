# Live Dictation Architecture Audit

## Core Finding

The pre-v3 live cursor design was built on repeated local Whisper preview transcriptions over a
rolling audio window. That produced useful provisional text, but not a stable transcript. Whisper
may:

- Change earlier words.
- Add or remove punctuation.
- Change casing.
- Drop words at the start of the rolling window.
- Rephrase the same recent audio differently across previews.
- Produce disjoint previews that do not share a reliable prefix or suffix.

The earlier cursor commit policy tried to infer globally appendable text from those previews. That
fragile compatibility path has been removed from stable mode. In v3, previews remain revisable IBus
preedit and only authoritative canonical chunks can become normal target text.

## Current Data Flow

1. `Alt+D` starts recording.
2. WebView opens a microphone stream.
3. AudioWorklet posts batched samples to the frontend.
4. Frontend stores full-session samples in memory.
5. A timer transcribes a bounded recent window and displays the result as revisable IBus preedit.
6. In parallel, the frontend preprocesses stable, non-overlapping source blocks ending at 30, 59,
   88 seconds, and subsequent 29-second strides.
7. Native Whisper transcribes authoritative 30-second ranges with one second of overlap: `0-30`,
   `29-59`, `58-88`, and so on.
8. Each result must preserve the cached canonical prefix and identify its exact append.
9. Protocol v3 atomically verifies the target's acknowledged canonical prefix and commits only that
   exact append. A preview hypothesis is never committed merely because it appears stable.
10. On stop, VOCO waits for in-flight work, finishes every complete canonical range, then transcribes
    the remaining partial range once.
11. Previously cached exact chunks are reused as final truth; there is no separate enhancement-off
    full-session pass that can disagree with earlier checkpoints.
12. The engine commits the exact remaining canonical suffix and closes the lease. If a mutating IPC
    outcome is uncertain, VOCO never retries it or falls back to global keyboard insertion.

## Design Constraints

The app does not own the target document. Generic Linux apps do expose an input-method preedit, but
IBus surrounding text has no fresh editor revision. VOCO can revise its preedit; it cannot safely
delete, rewrite, or append to normal target text during finalization.

The only safe generic cursor models are:

- Bounded owned preedit plus immutable, prefix-checked canonical commits.
- Owned overlay preview plus one-shot final output.
- Editor-specific adapters that can manage a known text range.

Enhancement-off stable mode uses the first model. Enhancement modes use the second so an enhanced
one-shot final is never mixed with unenhanced canonical checkpoints.

## Why Words Stopped Appearing In V2

Historical trace evidence showed repeated preview completion with no insertion. This meant:

- Audio capture is active.
- Preview ASR is active.
- Native insertion has not failed.
- The commit policy is refusing to append.

The root cause was:

The commit policy was trying to avoid corruption by rejecting anything it could not reconcile with
already committed text. With real rolling Whisper previews, normal continuation can look like an
unsafe rewrite. Once that happens, visible cursor text stalls even though previews continue.

V3 removes this preview-consensus gate from normal-text commits. Preview updates may continue to
revise, while canonical checkpoint cadence is determined only by exact audio boundaries.

## Complexity Hotspots

### `useDictation.ts`

This file is too broad. It should not own every aspect of the product loop.

Candidate extraction boundaries:

- `audioCaptureBuffer.ts` - append samples, count samples, collect recent tail, merge final audio.
- `livePreviewScheduler.ts` - cadence, in-flight preview gating, adaptive delay.
- `liveCommitPolicy.ts` - pure append decision logic with extensive tests.
- `dictationFinalizer.ts` - final ASR, enhancement, final insertion/reconciliation.
- `dictationTrace.ts` - privacy-safe event helpers.

### Retired Preview Commit Policy

The retired policy mixed:

- Stable prefix logic.
- Rolling suffix-prefix overlap.
- Normalized character matching.
- Normalized word matching.
- Disjoint rolling append fallback.
- Unsafe rewrite detection.

These heuristics are no longer an authority for direct-cursor commits. Preview reconciliation stays
pure and provisional; canonical session and delivery state are separately testable.

### Native Boundary

The native boundary correctly rejects deletion for live cursor streaming. That invariant should stay.

The v2 issue was not native insertion failure. It was frontend preview-commit refusal.

## Canonical Architecture Implemented

The direct-cursor v3 path has two explicitly separate streams:

- Preview ASR supplies low-latency, revisable text inside VOCO's leased IBus preedit.
- Canonical ASR owns transcript truth. Stable source blocks are resampled once, canonical ranges are
  at most 30 seconds with one second of overlap, and every result extends an immutable cached prefix.

At a complete boundary, the target receives an atomic `(expected prefix, exact append)` checkpoint.
At stop, the same coordinator catches up any deferred complete work and processes only the final
partial range. This makes the text already checkpointed at the cursor byte-for-byte identical to the
corresponding canonical cache; a later global reconciliation pass is neither needed nor allowed.

When transcript enhancement is enabled, VOCO does not start canonical IBus delivery. Preview stays
in the VOCO overlay and the enhanced transcript is inserted once after stop.

## Hard Product Decision

The v3 design has automated state, protocol, ownership, and pinned-replay evidence. It is not
product-ready until a newly built Debian package passes the installed Ubuntu/Wayland manual matrix.
The older installed results below do not validate v3.

## Pre-v3 July 2026 Captured-Session Evidence

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

### V3 Architecture Consequence

VOCO owns the changing preview through an IBus preedit range, but preview-confirmed phrases no longer
become normal text. Only exact canonical checkpoints do. Cached canonical text is therefore final
truth for enhancement-off stable cursor mode, and each successful target acknowledgement proves the
same prefix exists on both sides of the private protocol-v3 boundary.

Unsupported or invalidated fields remain overlay-only and report canonical delivery as unreconciled.
The former global ydotool/xdotool compatibility streamer is not part of stable cursor mode. A
rejected IPC command may be handled as a known failure; an uncertain mutating outcome closes the
socket and is never retried.

Long-session safeguards include an exact 10-minute automatic cutoff, bounded 20-second preview
windows, indexed access to late-session audio chunks, authoritative 30-second ranges with one second
of overlap, cached exact chunk results, and a pinned WAV replay that proves the 30/59/final boundary
sequence. Installed-package manual QA for v3 remains pending.
