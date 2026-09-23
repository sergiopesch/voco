import type { CanonicalCursorSession } from "@/lib/canonicalCursorSession";

/** A single recovery slot; audio itself stays in the recording hook's memory. */
export interface DictationRecovery {
  kind?: "manual-copy" | "failure";
  reason: string;
  audioAvailable: boolean;
  retrying: boolean;
  targetMayContainText: boolean;
}

export const LIVE_LOCAL_TRANSCRIPTION = "Text delivery paused. VOCO is still transcribing. Finish recording, then open VOCO to copy your text.";

export const LIVE_DELIVERY_PAUSED = "Live delivery paused. Stop recording to recover your transcript; review the target before pasting again.";

// Cap source capture independently of device rate, including unusually high-rate devices.
export const MAX_CAPTURE_SAMPLES = 32 * 1024 * 1024; // 128 MiB of Float32 source audio.

export function captureSampleLimit(sampleRate: number, maximumSeconds = 600): number {
  return Math.min(Math.floor(sampleRate * maximumSeconds), MAX_CAPTURE_SAMPLES);
}

export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

/** Preserve pending/active recognition: wait for an active attempt, then retry owned bytes.
 * Recovery continues the exact prefix and never reactivates target delivery. */
export function resumeCanonicalForRecovery(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  return {
    ...state,
    phase: state.cacheReleased && state.phase === "complete" ? "complete" : "stopping",
    delivery: "uncertain",
    previewGeneration: state.previewGeneration + 1,
  };
}
