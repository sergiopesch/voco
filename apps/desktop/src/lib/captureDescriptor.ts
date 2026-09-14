export type CaptureSelection = { backend: "webkit" } | { backend: "native"; selectionToken: string | null };

/** Immutable format of retained source PCM, independent of a live capture graph. */
export interface CaptureDescriptor {
  readonly backend: "webkit" | "native";
  readonly sessionId: number;
  readonly generation: number;
  readonly sourceSampleRate: number;
  readonly sourceChannels: number;
  readonly deliveredChannels: 1;
  readonly sourceIdentity: string | null;
  readonly conversion: "webaudio-mono" | "s16le-stereo-average";
}

export function createCaptureDescriptor(value: CaptureDescriptor): CaptureDescriptor {
  if (!Number.isSafeInteger(value.sessionId) || value.sessionId <= 0 ||
      !Number.isSafeInteger(value.generation) || value.generation < 0 ||
      !Number.isSafeInteger(value.sourceSampleRate) || value.sourceSampleRate < 8000 || value.sourceSampleRate > 384000 ||
      value.deliveredChannels !== 1 ||
      (value.backend === "native" ? value.sourceChannels !== 2 || value.conversion !== "s16le-stereo-average" || !value.sourceIdentity :
        value.backend !== "webkit" || value.sourceChannels !== 1 || value.conversion !== "webaudio-mono")) {
    throw new Error("Invalid recording capture descriptor");
  }
  return Object.freeze({ ...value });
}

export function retainedSampleRate(descriptor: CaptureDescriptor | null, retainedSamples: number): number {
  if (descriptor) return descriptor.sourceSampleRate;
  if (retainedSamples !== 0) throw new Error("Retained audio has no capture format");
  // Empty startup/teardown diagnostics have no source samples to reinterpret.
  return 16000;
}
