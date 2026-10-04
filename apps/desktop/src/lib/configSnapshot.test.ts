import { describe, expect, it } from "vitest";
import { shouldApplyConfigSnapshot } from "@/lib/configSnapshot";

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
});
