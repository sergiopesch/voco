import { describe, expect, it } from "vitest";
import { admitsDictationTrigger } from "./dictationTrigger";

describe("directed browser recording triggers", () => {
  it("never treats a second start as a stop", () => {
    expect(admitsDictationTrigger("idle", undefined, "browser:a", "start")).toBe(true);
    for (const phase of ["starting", "recording", "stopping", "processing", "finalizing"] as const) {
      expect(admitsDictationTrigger(phase, "browser:a", "browser:a", "start")).toBe(false);
    }
  });
  it("only stops the recording belonging to the exact trigger", () => {
    for (const phase of ["starting", "recording"] as const) {
      expect(admitsDictationTrigger(phase, "browser:a", "browser:a", "stop")).toBe(true);
      expect(admitsDictationTrigger(phase, "browser:a", "browser:b", "stop")).toBe(false);
      expect(admitsDictationTrigger(phase, undefined, "browser:a", "stop")).toBe(false);
    }
    for (const phase of ["idle", "error", "stopping", "processing", "finalizing"] as const) {
      expect(admitsDictationTrigger(phase, "browser:a", "browser:a", "stop")).toBe(false);
    }
  });
  it("retains native toggle semantics and rejects unqualified directed messages", () => {
    expect(admitsDictationTrigger("recording", undefined)).toBe(true);
    expect(admitsDictationTrigger("idle", undefined, "ibus:a", "start")).toBe(false);
    expect(admitsDictationTrigger("idle", undefined, undefined, "start")).toBe(false);
  });
});
