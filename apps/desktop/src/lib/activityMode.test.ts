import { describe, expect, it } from "vitest";
import {
  canToggleDictationWithPermission,
} from "@/lib/activityMode";

describe("activity mode arbitration", () => {


  it("blocks denied starts but always permits an active dictation to stop", () => {
    expect(canToggleDictationWithPermission("idle", "denied")).toBe(false);
    expect(canToggleDictationWithPermission("error", "denied")).toBe(false);
    expect(canToggleDictationWithPermission("recording", "denied")).toBe(true);
    expect(canToggleDictationWithPermission("starting", "denied")).toBe(true);
    expect(canToggleDictationWithPermission("processing", "denied")).toBe(true);
    expect(canToggleDictationWithPermission("idle", "unknown")).toBe(true);
    expect(canToggleDictationWithPermission("idle", "granted")).toBe(true);
  });
});
