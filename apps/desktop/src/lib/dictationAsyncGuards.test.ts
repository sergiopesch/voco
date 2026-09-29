import { describe, expect, it } from "vitest";
import { isCurrentAudioCaptureSource } from "@/lib/dictationAsyncGuards";

describe("dictation async guards", () => {
  it("rejects callbacks from a retired node or recording session", () => {
    const source = {};
    const replacement = {};

    expect(isCurrentAudioCaptureSource(source, 3, source, 3)).toBe(true);
    expect(isCurrentAudioCaptureSource(source, 3, replacement, 3)).toBe(false);
    expect(isCurrentAudioCaptureSource(source, 3, source, 4)).toBe(false);
    expect(isCurrentAudioCaptureSource(source, 3, null, 3)).toBe(false);
  });
});
