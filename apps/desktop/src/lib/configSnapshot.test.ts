import { describe, expect, it } from "vitest";
import {
  shouldApplyConfigSnapshot,
  shouldBlockRuntimeForConfigErrors,
} from "@/lib/configSnapshot";

describe("config snapshots", () => {
  it("accepts the current or a newer authoritative revision", () => {
    expect(shouldApplyConfigSnapshot(-1, 0)).toBe(true);
    expect(shouldApplyConfigSnapshot(4, 4)).toBe(true);
    expect(shouldApplyConfigSnapshot(4, 5)).toBe(true);
  });

  it("rejects stale and malformed revisions", () => {
    expect(shouldApplyConfigSnapshot(5, 4)).toBe(false);
    expect(shouldApplyConfigSnapshot(5, Number.NaN)).toBe(false);
    expect(shouldApplyConfigSnapshot(5, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it("blocks an unreadable startup config but not a rolled-back settings save", () => {
    expect(
      shouldBlockRuntimeForConfigErrors("Config could not be loaded", null),
    ).toBe(true);
    expect(
      shouldBlockRuntimeForConfigErrors(null, "Settings could not be saved"),
    ).toBe(false);
    expect(
      shouldBlockRuntimeForConfigErrors(
        "Config could not be loaded",
        "Settings could not be saved",
      ),
    ).toBe(true);
    expect(shouldBlockRuntimeForConfigErrors(null, null)).toBe(false);
  });
});
