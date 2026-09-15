import { describe, expect, it } from "vitest";
import { shouldMarkHotkeyHandlerReady } from "@/hooks/useGlobalShortcut";
describe("global shortcut readiness", () => {
  it("replays only after dictation listener and runtime readiness, once", () => {
    expect(shouldMarkHotkeyHandlerReady(false, true, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, false, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, true)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, false)).toBe(true);
  });
});
