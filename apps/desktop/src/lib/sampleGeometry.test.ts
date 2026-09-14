import { expect, it } from "vitest";
import { resampledSampleCount } from "./sampleGeometry";

it("avoids spurious output samples at exact integer-rate durations", () => {
  expect(Math.ceil(6021 / 48000 * 16000)).toBe(2008);
  expect(resampledSampleCount(6021, 48000)).toBe(2007);
  expect(resampledSampleCount(6033, 48000)).toBe(2011);
  expect(resampledSampleCount(12042, 96000)).toBe(2007);
  expect(resampledSampleCount(2007, 16000)).toBe(2007);
});

it("matches integer quotient/remainder across the entire accepted capture rate interval", () => {
  for (let rate = 8000; rate <= 384000; rate++) {
    for (const frames of [1, 6021, rate * 600 - 1, rate * 600]) {
      const numerator = frames * 16000;
      const expected = Math.floor(numerator / rate) + (numerator % rate === 0 ? 0 : 1);
      if (resampledSampleCount(frames, rate) !== expected) {
        throw new Error(`Incorrect output count for ${frames} frames at ${rate} Hz`);
      }
    }
  }
});

it("preserves fractional metadata arithmetic and rejects invalid extents", () => {
  expect(resampledSampleCount(77777, 44100.5)).toBe(Math.ceil(77777 / 44100.5 * 16000));
  expect(resampledSampleCount(0, 48000)).toBe(0);
  for (const rate of [0, -1, NaN, Infinity]) {
    expect(() => resampledSampleCount(1, rate)).toThrow(RangeError);
    expect(() => resampledSampleCount(1, 48000, rate)).toThrow(RangeError);
  }
  for (const frames of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => resampledSampleCount(frames, 48000)).toThrow(RangeError);
  }
  expect(() => resampledSampleCount(Number.MAX_SAFE_INTEGER, 1, 16000)).toThrow(RangeError);
});
