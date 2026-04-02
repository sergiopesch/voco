const MIN_DISPLAY_DB = -44;
const MAX_DISPLAY_DB = -2;
const MIN_RMS = 0.0001;

export function calculateCenteredRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] ?? 0;
  }

  const mean = sum / samples.length;
  let squaredSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const centered = (samples[i] ?? 0) - mean;
    squaredSum += centered * centered;
  }

  return Math.sqrt(squaredSum / samples.length);
}

export function calculateVisualAudioLevel(rms: number): number {
  const safeRms = Math.max(rms, MIN_RMS);
  const decibels = 20 * Math.log10(safeRms);
  const normalized =
    (decibels - MIN_DISPLAY_DB) / (MAX_DISPLAY_DB - MIN_DISPLAY_DB);
  const clamped = Math.min(1, Math.max(0, normalized));
  return Math.pow(clamped, 1.9);
}

export function calculateVisualAudioLevelFromSamples(
  samples: ArrayLike<number>,
): number {
  return calculateVisualAudioLevel(calculateCenteredRms(samples));
}

export function removeDcOffset(samples: Float32Array): Float32Array {
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

  const centered = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    centered[i] = (samples[i] ?? 0) - mean;
  }

  return centered;
}
