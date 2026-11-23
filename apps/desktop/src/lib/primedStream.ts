import type { DictationSessionPhase } from "./dictationSession";

/** How long a microphone stream opened ahead of a start waits for it. The
 * start it is for, a shortcut pressed while VOCO launched, is replayed as
 * soon as the window is ready. */
export const PRIMED_STREAM_MS = 5_000;

/** Closes a stream opened ahead of a start if no start has taken it after
 * `PRIMED_STREAM_MS`, so no microphone stream stays open while VOCO is idle.
 * A start in flight takes the stream or closes it when it ends, so it is
 * left to that start. */
export function expirePrimedStream(
  stream: MediaStream,
  primed: { current: MediaStream | null },
  phase: () => DictationSessionPhase,
): void {
  setTimeout(() => {
    if (primed.current !== stream || phase() === "starting") return;
    stream.getTracks().forEach((track) => track.stop());
    primed.current = null;
  }, PRIMED_STREAM_MS);
}
