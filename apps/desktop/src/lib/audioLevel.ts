const MIN_DISPLAY_DB = -44;
// A visual speech range, independent of capture gain and recognition samples.
const MAX_DISPLAY_DB = -12;
const MIN_RMS = 0.0001;

export function calculateCenteredRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;
  let squaredSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0;
    sum += sample;
    squaredSum += sample * sample;
  }

  const mean = sum / samples.length;
  const variance = squaredSum / samples.length - mean * mean;
  return Math.sqrt(Math.max(0, variance));
}

export function calculateVisualAudioLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const safeRms = Math.max(rms, MIN_RMS);
  const decibels = 20 * Math.log10(safeRms);
  const normalized =
    (decibels - MIN_DISPLAY_DB) / (MAX_DISPLAY_DB - MIN_DISPLAY_DB);
  const clamped = Math.min(1, Math.max(0, normalized));
  return Math.sqrt(clamped);
}

export function calculateVisualAudioLevelFromSamples(
  samples: ArrayLike<number>,
): number {
  return calculateVisualAudioLevel(calculateCenteredRms(samples));
}

/**
 * Forwards recording levels to the tray panel at most every 40 ms, one request
 * at a time. Silence is sent once: the panel already reads a level older than
 * 250 ms as zero, so repeating zero only costs IPC. Only a level that was
 * actually sent counts, so pass every frame, repeated zeros included: a zero
 * the throttle or an in-flight send dropped goes out with the next one. A
 * skipped zero does not use up the throttle, so the next sound is not delayed.
 */
export function createPanelLevelSender(
  send: (level: number) => Promise<unknown>,
  now: () => number = () => performance.now(),
): (level: number) => void {
  let pending = false;
  let lastSentAt = -Infinity;
  let lastSent: number | null = null;
  return (level) => {
    if (pending || (level === 0 && lastSent === 0)) return;
    const at = now();
    if (at - lastSentAt < 40) return;
    pending = true;
    lastSentAt = at;
    lastSent = level;
    void send(level)
      .catch(() => {})
      .finally(() => { pending = false; });
  };
}

export function removeDcOffsetInPlace(samples: Float32Array): Float32Array {
  if (samples.length === 0) {
    return samples;
  }

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] ?? 0;
  }

  const mean = sum / samples.length;
  if (Math.abs(mean) < 1e-6) {
    return samples;
  }

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = (samples[i] ?? 0) - mean;
  }

  return samples;
}
