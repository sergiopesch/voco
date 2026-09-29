/** Why the voice test failed; its audio is not kept. */
export interface DictationRecovery {
  reason: string;
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
