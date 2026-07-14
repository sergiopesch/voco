import { describe, expect, it } from "vitest";
import {
  appendAudioSamples,
  appendAudioSamplesUpTo,
  clearAudioCaptureBuffer,
  collectAudioSamplesRange,
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
    expect(buffer.chunkStartSamples).toEqual([0, 2]);
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

  it("collects an anchored bounded range without dropping its oldest samples", () => {
    const buffer = createAudioCaptureBuffer();
    appendAudioSamples(buffer, new Float32Array([1, 2, 3]));
    appendAudioSamples(buffer, new Float32Array([4]));
    appendAudioSamples(buffer, new Float32Array([5, 6, 7, 8]));

    expect(values(collectAudioSamplesRange(buffer, 2, 4))).toEqual([3, 4, 5, 6]);
    expect(values(collectAudioSamplesRange(buffer, 6, 20))).toEqual([7, 8]);
    expect(values(collectAudioSamplesRange(buffer, -4, 2))).toEqual([1, 2]);
    expect(values(collectAudioSamplesRange(buffer, 20, 2))).toEqual([]);
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
    expect(buffer.chunkStartSamples).toHaveLength(0);
  });

  it("retains and drains a two-minute 48 kHz AudioWorklet session", () => {
    const sampleRate = 48_000;
    const totalSamples = sampleRate * 120;
    const workletBatchSize = 2_048;
    const buffer = createAudioCaptureBuffer();

    for (let offset = 0; offset < totalSamples; offset += workletBatchSize) {
      const chunk = new Float32Array(
        Math.min(workletBatchSize, totalSamples - offset),
      );
      if (offset === 0) {
        chunk[0] = 0.25;
      }
      if (offset + chunk.length === totalSamples) {
        chunk[chunk.length - 1] = -0.25;
      }
      appendAudioSamples(buffer, chunk);
    }

    expect(buffer.sampleCount).toBe(totalSamples);
    expect(collectAudioSamplesRange(buffer, 0, sampleRate * 20)).toHaveLength(
      sampleRate * 20,
    );

    const fullSession = drainAudioCaptureBuffer(buffer);
    expect(fullSession).toHaveLength(totalSamples);
    expect(fullSession[0]).toBe(0.25);
    expect(fullSession[fullSession.length - 1]).toBe(-0.25);
    expect(buffer.sampleCount).toBe(0);
    expect(buffer.chunks).toHaveLength(0);
  });

  it("clears without replacing the buffer object", () => {
    const buffer = createAudioCaptureBuffer();
    appendAudioSamples(buffer, new Float32Array([1, 2, 3]));

    clearAudioCaptureBuffer(buffer);

    expect(buffer.sampleCount).toBe(0);
    expect(buffer.chunks).toEqual([]);
    expect(buffer.chunkStartSamples).toEqual([]);
  });

  it("finds a late anchored range across many long-session chunks", () => {
    const buffer = createAudioCaptureBuffer();
    for (let index = 0; index < 20_000; index += 1) {
      appendAudioSamples(buffer, new Float32Array([index, index + 0.5]));
    }

    expect(values(collectAudioSamplesRange(buffer, 39_994, 6))).toEqual([
      19_997,
      19_997.5,
      19_998,
      19_998.5,
      19_999,
      19_999.5,
    ]);
  });

  it("caps an append exactly at the session sample limit", () => {
    const buffer = createAudioCaptureBuffer();
    appendAudioSamples(buffer, new Float32Array([1, 2, 3]));

    expect(
      appendAudioSamplesUpTo(
        buffer,
        new Float32Array([4, 5, 6, 7]),
        5,
      ),
    ).toEqual({ appendedSampleCount: 2, reachedLimit: true });
    expect(values(drainAudioCaptureBuffer(buffer))).toEqual([1, 2, 3, 4, 5]);
  });
});
