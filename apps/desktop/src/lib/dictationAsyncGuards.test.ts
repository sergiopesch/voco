import { describe, expect, it } from "vitest";
import { createCanonicalCursorSession } from "@/lib/canonicalCursorSession";
import {
  isCurrentAudioCaptureSource,
  isCurrentCanonicalTargetOperation,
} from "@/lib/dictationAsyncGuards";

describe("dictation async guards", () => {
  it("requires the dictation, canonical, and owned session identities", () => {
    const operation = {
      dictationSessionId: 7,
      canonicalSessionId: 7,
      ownedSessionId: 41,
    };
    const current = {
      dictationSessionId: 7,
      canonicalSession: createCanonicalCursorSession(7, 48_000),
      ownedSessionId: 41,
      ownedSessionActive: true,
    };

    expect(isCurrentCanonicalTargetOperation(operation, current)).toBe(true);
    expect(
      isCurrentCanonicalTargetOperation(operation, {
        ...current,
        dictationSessionId: 8,
      }),
    ).toBe(false);
    expect(
      isCurrentCanonicalTargetOperation(operation, {
        ...current,
        canonicalSession: createCanonicalCursorSession(8, 48_000),
      }),
    ).toBe(false);
    expect(
      isCurrentCanonicalTargetOperation(operation, {
        ...current,
        ownedSessionId: 42,
      }),
    ).toBe(false);
    expect(
      isCurrentCanonicalTargetOperation(operation, {
        ...current,
        ownedSessionActive: false,
      }),
    ).toBe(false);
  });

  it("rejects callbacks from a retired node or recording session", () => {
    const source = {};
    const replacement = {};

    expect(isCurrentAudioCaptureSource(source, 3, source, 3)).toBe(true);
    expect(isCurrentAudioCaptureSource(source, 3, replacement, 3)).toBe(false);
    expect(isCurrentAudioCaptureSource(source, 3, source, 4)).toBe(false);
    expect(isCurrentAudioCaptureSource(source, 3, null, 3)).toBe(false);
  });
});
