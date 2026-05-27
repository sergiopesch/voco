import { describe, expect, it } from "vitest";
import { shouldMarkHotkeyHandlerReady } from "@/hooks/useGlobalShortcut";

describe("global shortcut readiness", () => {
  it("waits for both dictation and realtime listeners before replaying buffered toggles", () => {
    expect(shouldMarkHotkeyHandlerReady(true, false, true, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(false, true, true, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, false, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, true, true)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, true, false)).toBe(true);
  });
});
