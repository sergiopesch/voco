import { describe, expect, it } from "vitest";
import {
  calculateCenteredRms,
  calculateVisualAudioLevelFromSamples,
  calculateVisualAudioLevel,
  removeDcOffsetInPlace,
} from "@/lib/audioLevel";

describe("audioLevel", () => {
  it("ignores a constant DC offset when computing RMS", () => {
    const samples = new Float32Array([0.22, 0.22, 0.22, 0.22]);

    expect(calculateCenteredRms(samples)).toBeCloseTo(0, 6);
    expect(calculateVisualAudioLevelFromSamples(samples)).toBe(0);
  });

  it("preserves the AC component after removing DC offset", () => {
    const original = new Float32Array([0.12, -0.12, 0.12, -0.12]);
    const biased = new Float32Array([0.37, 0.13, 0.37, 0.13]);

    expect(calculateCenteredRms(biased)).toBeCloseTo(
      calculateCenteredRms(original),
      6,
    );
  });

  it("makes quiet speech visible while leaving silence still", () => {
    const levels = [-40, -32, -24, -12].map(db => calculateVisualAudioLevel(10 ** (db / 20)));
    expect(levels[0]).toBeGreaterThan(0.3);
    expect(levels[1]).toBeGreaterThan(0.55);
    expect(levels[2]).toBeGreaterThan(levels[1]!);
    expect(levels[3]).toBe(1);
    for (const rms of [0, -1, NaN, Infinity, 10 ** (-50 / 20)]) {
      expect(calculateVisualAudioLevel(rms)).toBe(0);
    }
  });

  it("centers owned recording buffers without allocating a replacement", () => {
    const samples = new Float32Array([0.35, 0.15, 0.35, 0.15]);

    const centered = removeDcOffsetInPlace(samples);

    expect(centered).toBe(samples);
    expect(Array.from(samples)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(-0.1, 6),
      expect.closeTo(0.1, 6),
      expect.closeTo(-0.1, 6),
    ]);
  });
});
