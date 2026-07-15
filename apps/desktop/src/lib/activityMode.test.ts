import { describe, expect, it } from "vitest";
import {
  canActivateMode,
  canToggleDictationWithPermission,
  deriveActivityMode,
} from "@/lib/activityMode";

describe("activity mode arbitration", () => {
  it("allows a mode to start or stop itself but blocks the opposite mode", () => {
    expect(canActivateMode("idle", "dictation")).toBe(true);
    expect(canActivateMode("dictation", "dictation")).toBe(true);
    expect(canActivateMode("dictation", "realtime")).toBe(false);
    expect(canActivateMode("realtime", "dictation")).toBe(false);
  });

  it("gives an existing dictation priority if states ever overlap", () => {
    expect(deriveActivityMode("recording", "listening")).toBe("dictation");
    expect(deriveActivityMode("idle", "connecting")).toBe("realtime");
    expect(deriveActivityMode("error", "error")).toBe("idle");
  });

  it("blocks denied starts but always permits an active dictation to stop", () => {
    expect(canToggleDictationWithPermission("idle", "denied")).toBe(false);
    expect(canToggleDictationWithPermission("error", "denied")).toBe(false);
    expect(canToggleDictationWithPermission("recording", "denied")).toBe(true);
    expect(canToggleDictationWithPermission("processing", "denied")).toBe(true);
    expect(canToggleDictationWithPermission("idle", "unknown")).toBe(true);
    expect(canToggleDictationWithPermission("idle", "granted")).toBe(true);
  });
});
