import { describe, expect, it } from "vitest";
import {
  resampleAudioForTranscription,
  TRANSCRIPTION_RESAMPLE_CHUNK_SECONDS,
} from "@/lib/audioResampling";
import type { AudioResampler } from "@/lib/audioResampling";

function values(samples: Float32Array): number[] {
  return Array.from(samples);
}

describe("audio resampling", () => {
  it("uses one resampling call for short audio", async () => {
    const calls: number[] = [];
    const resampler: AudioResampler = async (input) => {
      calls.push(input.length);
      return new Float32Array([input.length]);
    };

    const output = await resampleAudioForTranscription(
      new Float32Array(1_000),
      48_000,
      16_000,
      resampler,
    );

    expect(calls).toEqual([1_000]);
    expect(values(output)).toEqual([1_000]);
  });

  it("chunks ten-minute transcription resampling into bounded windows", async () => {
    const fromRate = 48_000;
    const toRate = 16_000;
    const inputSeconds = 600;
    const maxChunkLength = fromRate * TRANSCRIPTION_RESAMPLE_CHUNK_SECONDS;
    const calls: number[] = [];
    const resampler: AudioResampler = async (input) => {
      calls.push(input.length);
      return new Float32Array(Math.round((input.length / fromRate) * toRate)).fill(
        calls.length,
      );
    };

    const output = await resampleAudioForTranscription(
      new Float32Array(fromRate * inputSeconds),
      fromRate,
      toRate,
      resampler,
    );

    expect(calls).toHaveLength(20);
    expect(calls.every((length) => length <= maxChunkLength)).toBe(true);
    expect(calls).toEqual(Array.from({ length: 20 }, () => maxChunkLength));
    expect(output).toHaveLength(toRate * inputSeconds);
    expect(output[0]).toBe(1);
    expect(output[toRate * TRANSCRIPTION_RESAMPLE_CHUNK_SECONDS]).toBe(2);
    expect(output[output.length - 1]).toBe(20);
  });

  it("keeps a partial tail chunk when duration is not a multiple of the window", async () => {
    const calls: number[] = [];
    const resampler: AudioResampler = async (input) => {
      calls.push(input.length);
      return new Float32Array([input[0] ?? 0, input[input.length - 1] ?? 0]);
    };
    const input = Float32Array.from(
      Array.from({ length: 65 }, (_, index) => index + 1),
    );

    const output = await resampleAudioForTranscription(input, 2, 1, resampler);

    expect(calls).toEqual([60, 5]);
    expect(values(output)).toEqual([1, 60, 61, 65]);
  });
});
