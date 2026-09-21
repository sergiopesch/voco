import { describe, expect, it } from "vitest";
import { DiagnosticsRequestGate, microphoneLabel, shortcutPresentation, unknownShortcut } from "./shortcutPresentation";
import type { ShortcutDiagnostics } from "@/types";

const available: ShortcutDiagnostics = { hotkey: "Alt+D", route: "evdev", state: "available", detail: "Current keyboard is open." };

describe("shortcut presentation", () => {
  it("does not advertise missing, stale, unknown or route-less readiness", () => {
    for (const observation of [null, unknownShortcut("Alt+D"), { ...available, hotkey: "Alt+X" }, { ...available, route: null }]) {
      const result = shortcutPresentation("Alt+D", observation);
      expect(result.available).toBe(false);
      expect(result.instruction).toContain("Start dictation from the tray");
      expect(result.instruction).not.toContain("Press Alt+D");
    }
  });
  it("keeps IBus focus and explicit setup requirements visible", () => {
    expect(shortcutPresentation("Alt+D", { ...available, route: "ibus" }).instruction).toContain("Focus a supported text field");
    const focused = shortcutPresentation("Alt+D", { ...available, route: "ibus", state: "focus-required" });
    expect(focused.available).toBe(false);
    expect(focused.setup).toContain("VOCO Dictation selected");
    expect(shortcutPresentation("Alt+D", null).setup).toContain("never switches");
  });
  it("advertises only the matching verified configured key", () => {
    expect(shortcutPresentation("Alt+D", available).instruction).toBe("Press Alt+D to dictate at your cursor.");
  });
});

it("does not promise dictation when the shortcut works but input setup is missing", () => {
  const result = shortcutPresentation("Alt+D", available, { available: false, detail: "Start ydotoold." });
  expect(result.instruction).toBe("Desktop setup required. Start ydotoold.");
  expect(result.instruction).not.toContain("Press Alt+D");
});

describe("diagnostics request ownership", () => {
  it("rejects an older deferred response after a newer request", async () => {
    const gate = new DiagnosticsRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    await Promise.resolve();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
  it("invalidates a request across config changes even when the key returns to its old value", () => {
    const gate = new DiagnosticsRequestGate();
    const original = gate.begin();
    gate.invalidate(); // Save admission, before the authoritative config response.
    gate.invalidate(); // Another config revision restoring the original key.
    expect(original()).toBe(false);
    expect(gate.begin()()).toBe(true);
  });
  it("does not revive prior requests after unmount and remount", () => {
    const gate = new DiagnosticsRequestGate();
    const original = gate.begin();
    gate.dispose();
    gate.activate();
    expect(original()).toBe(false);
    expect(gate.begin()()).toBe(true);
  });
});

describe("microphone footer", () => {
  it("uses only the approved native identity, never the browser default", () => {
    const source = { label: "Remapped voco_test_sink_long.monitor", name: "source" };
    expect(microphoneLabel("native", source, null, [])).toBe(source.label);
    expect(microphoneLabel("native", null, null, [])).toBe("No native microphone selected");
    expect(microphoneLabel("pending", source, null, [])).toBe("Checking microphone setup");
    expect(microphoneLabel("webkit", source, null, [])).toBe("System default");
  });
});
