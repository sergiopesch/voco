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
  it("keeps onboarding Start and Stop bound to their own test", () => {
    expect(admitsDictationTrigger("idle", undefined, "onboarding:test", "start")).toBe(true);
    expect(admitsDictationTrigger("recording", "onboarding:test", "onboarding:test", "start")).toBe(false);
    expect(admitsDictationTrigger("recording", "onboarding:test", "onboarding:test", "stop")).toBe(true);
    expect(admitsDictationTrigger("recording", "browser:a", "onboarding:test", "stop")).toBe(false);
  });
  it("retains native toggle semantics and rejects unqualified directed messages", () => {
    expect(admitsDictationTrigger("recording", undefined)).toBe(true);
    expect(admitsDictationTrigger("idle", undefined, "ibus:a", "start")).toBe(false);
    expect(admitsDictationTrigger("idle", undefined, undefined, "start")).toBe(false);
  });
  it("admits explicit native tray Stop only while capture can stop", () => {
    for (const origin of [undefined, "browser:a", "onboarding:test"]) {
      for (const phase of ["starting", "recording"] as const) {
        expect(admitsDictationTrigger(phase, origin, "tray:stop", "stop")).toBe(true);
      }
      for (const phase of ["idle", "error", "stopping", "processing", "finalizing"] as const) {
        expect(admitsDictationTrigger(phase, origin, "tray:stop", "stop")).toBe(false);
        expect(admitsDictationTrigger(phase, origin, "tray:stop", "start")).toBe(false);
      }
    }
  });
});
