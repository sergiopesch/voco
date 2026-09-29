import type { CanonicalCursorSession } from "@/lib/canonicalCursorSession";

/** A single recovery slot; audio itself stays in the recording hook's memory. */
export interface DictationRecovery {
  reason: string;
  audioAvailable: boolean;
  retrying: boolean;
  targetMayContainText: boolean;
}


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

/** Ends a message with exactly one terminator so text can follow it. */
export function sentence(message: string): string {
  const text = message.trim().replace(/\.+$/, "");
  if (!text) return "";
  return /[!?…]$/.test(text) ? text : `${text}.`;
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
