import { describe, expect, it } from "vitest";
import {
  appendAudioSamples,
  clearAudioCaptureBuffer,
  collectRecentAudioSamples,
  createAudioCaptureBuffer,
  drainAudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";

function values(samples: Float32Array): number[] {
  return Array.from(samples);
}

describe("audio capture buffer", () => {
  it("tracks appended sample count without storing empty chunks", () => {
    const buffer = createAudioCaptureBuffer();

    appendAudioSamples(buffer, new Float32Array());
    appendAudioSamples(buffer, new Float32Array([1, 2]));
    appendAudioSamples(buffer, new Float32Array([3]));

    expect(buffer.sampleCount).toBe(3);
    expect(buffer.chunks).toHaveLength(2);
  });

  it("collects a bounded recent tail across chunk boundaries", () => {
    const buffer = createAudioCaptureBuffer();
    appendAudioSamples(buffer, new Float32Array([1, 2, 3]));
    appendAudioSamples(buffer, new Float32Array([4]));
    appendAudioSamples(buffer, new Float32Array([5, 6, 7, 8]));

    expect(values(collectRecentAudioSamples(buffer, 5))).toEqual([4, 5, 6, 7, 8]);
    expect(values(collectRecentAudioSamples(buffer, 20))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(values(collectRecentAudioSamples(buffer, 0))).toEqual([]);
  });

  it("drains full-session audio in order and clears the buffer", () => {
    const buffer = createAudioCaptureBuffer();
    appendAudioSamples(buffer, new Float32Array([0.1, 0.2]));
    appendAudioSamples(buffer, new Float32Array([0.3, 0.4]));

    expect(values(drainAudioCaptureBuffer(buffer))).toEqual([
      0.10000000149011612,
      0.20000000298023224,
      0.30000001192092896,
      0.4000000059604645,
    ]);
    expect(buffer.sampleCount).toBe(0);
    expect(buffer.chunks).toHaveLength(0);
  });

  it("clears without replacing the buffer object", () => {
    const buffer = createAudioCaptureBuffer();
    appendAudioSamples(buffer, new Float32Array([1, 2, 3]));

    clearAudioCaptureBuffer(buffer);

    expect(buffer.sampleCount).toBe(0);
    expect(buffer.chunks).toEqual([]);
  });
});
