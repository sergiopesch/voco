/** Exact ceiling at integer rates; retain legacy arithmetic for fractional metadata. */
export function resampledSampleCount(frames: number, fromRate: number, toRate = 16_000): number {
  if (!Number.isSafeInteger(frames) || frames < 0 || !Number.isFinite(fromRate) || fromRate <= 0 ||
      !Number.isFinite(toRate) || toRate <= 0) throw new RangeError('Invalid sample geometry');
  let result: number;
  if (Number.isSafeInteger(fromRate) && Number.isSafeInteger(toRate)) {
    const denominator = BigInt(fromRate);
    result = Number((BigInt(frames) * BigInt(toRate) + denominator - 1n) / denominator);
  } else {
    result = Math.ceil(frames / fromRate * toRate);
  }
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('Output sample extent is too large');
  return result;
}
