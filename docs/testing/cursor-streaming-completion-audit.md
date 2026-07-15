# Historical Cursor Streaming Completion Audit

> Historical pre-canonical-v3 audit. Its live-commit policy, local launcher, and trace-event notes
> describe the superseded append-only preview architecture and are retained only for provenance.
> Use [Cursor Streaming QA Results](./cursor-streaming-qa-results.md) for current evidence and
> [Cursor Streaming Dictation Hardening](../cursor-streaming-dictation-hardening-spec.md) for the
> active protocol-v3 design.
>
> **Do not use the procedures, paths, event names, or completion gate below for a current build.**
> Every section after this notice describes the archived pre-v3 snapshot.

This audit tracked the evidence available at that time for
[`cursor-streaming-dictation-hardening-spec.md`](../cursor-streaming-dictation-hardening-spec.md).

## Proven By Historical Evidence

- Stable cursor commit policy has unit coverage in
  `apps/desktop/src/__tests__/liveCursorStreaming.test.ts`.
- Final suffix reconciliation has unit coverage in
  `apps/desktop/src/__tests__/liveCursorStreaming.test.ts`.
- Session transition gating has unit coverage in `apps/desktop/src/lib/dictationSession.test.ts`.
- Live preview cancellation uses session/generation tokens in
  `apps/desktop/src/lib/dictationSession.ts` and `apps/desktop/src/hooks/useDictation.ts`.
- Live insertion is append-only at the native boundary; Rust tests prove nonzero deletion requests
  are rejected.
- The evdev listener ignores the `ydotoold virtual device`; Rust tests cover this behavior.
- Wayland runtime prerequisites are present on this machine: input group, `ydotoold`, `ydotool`,
  `wl-copy`, and `wl-paste`.
- The local launcher binary has been rebuilt and refreshed from the current release build.
- Current trace evidence includes privacy-safe latency samples for first live text, preview ASR,
  stop-to-final-transcript, and stop-to-idle, with no live insertion failure events recorded.

## Partially Proven

- Preview cadence is adaptive and bounded in code. Current trace evidence contains preview p50/p95
  and first-live-text timing samples, but the visible target-app behavior still needs manual
  confirmation.
- Stop/finalization has automated state coverage and timing instrumentation, including
  stop-to-final-transcript and stop-to-idle samples. Visible target-app behavior still needs manual
  confirmation.
- Fallback modes are implemented and documented, but preview-only and final-text-only modes still
  need target-app manual QA.

## Not Yet Proven

- Live words remain visible and stable over the full manual QA matrix.
- No existing target-app text is deleted in text editor, browser textarea, chat input, and terminal
  prompt cases.
- No raw key codes, stray numbers, or duplicate final transcript appear in target apps.
- Stop-to-final-visible timing in target applications is not separately proven beyond the
  stop-to-final-transcript and stop-to-idle trace events.

## Blocking Condition

The remaining completion requirement is manual QA in visible Linux target applications with live
speech and cursor focus. This cannot be proven from repository inspection or automated terminal
checks alone.
