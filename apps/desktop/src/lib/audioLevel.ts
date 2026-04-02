const MIN_DISPLAY_DB = -44;
const MAX_DISPLAY_DB = -2;
const MIN_RMS = 0.0001;

export function calculateVisualAudioLevel(rms: number): number {
  const safeRms = Math.max(rms, MIN_RMS);
  const decibels = 20 * Math.log10(safeRms);
  const normalized =
    (decibels - MIN_DISPLAY_DB) / (MAX_DISPLAY_DB - MIN_DISPLAY_DB);
  const clamped = Math.min(1, Math.max(0, normalized));
  return Math.pow(clamped, 1.9);
}
