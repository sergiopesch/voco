import { describe, expect, it } from "vitest";
import { browserStopReceipt, shouldMarkHotkeyHandlerReady, shouldProcessHotkeyEvent } from "@/hooks/useGlobalShortcut";
describe("global shortcut readiness", () => {
  it("replays only after dictation listener and runtime readiness, once", () => {
    expect(shouldMarkHotkeyHandlerReady(false, true, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, false, false)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, true)).toBe(false);
    expect(shouldMarkHotkeyHandlerReady(true, true, false)).toBe(true);
  });

  it("acknowledges only a processed directed browser Stop", () => {
    expect(browserStopReceipt("browser:current", "stop", true)).toBe("browser:current");
    expect(browserStopReceipt("browser:current", "stop", false)).toBeNull();
    expect(browserStopReceipt("browser:current", "start", true)).toBeNull();
    expect(browserStopReceipt("tray:stop", "stop", true)).toBeNull();
  });
  it("delivers browser Stop during paused readiness without admitting other events", () => {
    expect(shouldProcessHotkeyEvent(false, "browser:current", "stop")).toBe(true);
    expect(shouldProcessHotkeyEvent(false, "browser:current", "start")).toBe(false);
    expect(shouldProcessHotkeyEvent(false, "tray:stop", "stop")).toBe(false);
    expect(shouldProcessHotkeyEvent(false, "tray:stop", "stop", "1:2")).toBe(true);
    expect(shouldProcessHotkeyEvent(false, "tray:stop", "start", "1:2")).toBe(false);
    expect(shouldProcessHotkeyEvent(false, "tray:stop", "stop", "")).toBe(false);
    expect(shouldProcessHotkeyEvent(false)).toBe(false);
    expect(shouldProcessHotkeyEvent(true)).toBe(true);
  });
});
