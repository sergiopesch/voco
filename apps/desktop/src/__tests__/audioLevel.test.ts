import { describe, expect, it } from "vitest";
import {
  calculateCenteredRms,
  calculateVisualAudioLevelFromSamples,
  removeDcOffset,
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

  it("centers recorded samples before downstream processing", () => {
    const samples = new Float32Array([0.35, 0.15, 0.35, 0.15]);
    const centered = removeDcOffset(samples);

    const average =
      centered.reduce((sum, sample) => sum + sample, 0) / centered.length;

    expect(average).toBeCloseTo(0, 6);
    expect(Array.from(centered)).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.1, 6),
        expect.closeTo(-0.1, 6),
        expect.closeTo(0.1, 6),
        expect.closeTo(-0.1, 6),
      ]),
    );
  });
});
