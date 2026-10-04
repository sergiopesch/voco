import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTICS_TIMEOUT_MS,
  DiagnosticsRequestGate,
  microphoneLabel,
  sameJsonValue,
  shortcutPresentation,
  startLaunchDiagnostics,
  unknownShortcut,
  withTimeout,
} from "./shortcutPresentation";
import type { ShortcutDiagnostics } from "@/types";

const available: ShortcutDiagnostics = { hotkey: "Alt+D", route: "evdev", state: "available", detail: "Current keyboard is open." };

describe("sameJsonValue", () => {
  it("compares diagnostics payloads structurally, ignoring key order", () => {
    expect(sameJsonValue({ a: 1, b: { c: [1, 2], d: null } }, { b: { d: null, c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJsonValue({ ...available }, available)).toBe(true);
    expect(sameJsonValue(available, { ...available, state: "unknown" })).toBe(false);
    expect(sameJsonValue({ c: [1, 2] }, { c: [2, 1] })).toBe(false);
    expect(sameJsonValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJsonValue([1], { 0: 1 })).toBe(false);
    expect(sameJsonValue({ a: null }, { a: {} })).toBe(false);
  });
});

describe("withTimeout", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("settles with the operation and leaves no timer behind", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("ready"), DIAGNOSTICS_TIMEOUT_MS)).resolves.toBe("ready");
    await expect(withTimeout(Promise.reject(new Error("failed")), DIAGNOSTICS_TIMEOUT_MS)).rejects.toThrow("failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves null once a stalled operation runs out of time", async () => {
    vi.useFakeTimers();
    let result: string | null | undefined;
    void withTimeout(new Promise<string>(() => {}), DIAGNOSTICS_TIMEOUT_MS).then((value) => { result = value; });
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shortcut presentation", () => {
  it("does not advertise missing, stale, unknown or route-less readiness", () => {
    for (const observation of [null, unknownShortcut("Alt+D"), { ...available, hotkey: "Alt+X" }, { ...available, route: null }]) {
      const result = shortcutPresentation("Alt+D", observation);
      expect(result.available).toBe(false);
      expect(result.instruction).toContain("Start dictation from the tray");
      expect(result.instruction).not.toContain("Press Alt+D");
    }
  });
  it("presents the IBus input source as an optional shortcut route", () => {
    expect(shortcutPresentation("Alt+D", { ...available, route: "ibus" }).instruction).toBe("Press Alt+D to dictate at your cursor.");
    const focused = shortcutPresentation("Alt+D", { ...available, route: "ibus", state: "focus-required" });
    expect(focused.available).toBe(false);
    expect(focused.setup).toContain("optional VOCO Dictation input source");
    expect(focused.setup).toContain("To dictate into other apps, start dictation from the tray");
  });
  it("points an unavailable shortcut at the tray and voco --toggle", () => {
    const unavailable = shortcutPresentation("Alt+D", null).setup;
    expect(unavailable).toContain("start dictation from the tray");
    expect(unavailable).toContain("voco --toggle");
    expect(unavailable).not.toContain("Input Sources");
  });
  it("advertises the GNOME panel route", () => {
    expect(shortcutPresentation("Alt+D", { ...available, route: "gnome-panel" }).instruction).toBe("Press Alt+D to dictate at your cursor.");
  });
  it("advertises only the matching verified configured key", () => {
    expect(shortcutPresentation("Alt+D", available).instruction).toBe("Press Alt+D to dictate at your cursor.");
  });
});

it("does not promise dictation when the shortcut works but input setup is missing", () => {
  const result = shortcutPresentation("Alt+D", available, { available: false, detail: "Sign out and back in." });
  expect(result.instruction).toBe("Desktop setup needed. Sign out and back in.");
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

describe("launch diagnostics", () => {
  afterEach(() => { vi.useRealTimers(); });

  function launch(results: boolean[]) {
    let loaded = false;
    const refresh = vi.fn(async () => { loaded = results.shift() ?? false; });
    const onFailed = vi.fn();
    const dispose = startLaunchDiagnostics(refresh, () => loaded, onFailed);
    return { refresh, onFailed, dispose, load: () => { loaded = true; } };
  }

  it("reports nothing when the first check loads", async () => {
    vi.useFakeTimers();
    const run = launch([true]);
    await vi.runAllTimersAsync();
    expect(run.refresh).toHaveBeenCalledTimes(1);
    expect(run.onFailed).not.toHaveBeenCalled();
  });

  it("reports a failed check and retries it exactly once", async () => {
    vi.useFakeTimers();
    const run = launch([false, false]);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onFailed).toHaveBeenCalledTimes(1);
    expect(run.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(run.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.refresh).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(run.refresh).toHaveBeenCalledTimes(2);
    expect(run.onFailed).toHaveBeenCalledTimes(2);
  });

  it("skips the retry once another refresh has loaded diagnostics", async () => {
    vi.useFakeTimers();
    const run = launch([false]);
    await vi.advanceTimersByTimeAsync(0);
    run.load();
    await vi.runAllTimersAsync();
    expect(run.refresh).toHaveBeenCalledTimes(1);
  });

  it("cancels the retry when disposed", async () => {
    vi.useFakeTimers();
    const run = launch([false]);
    await vi.advanceTimersByTimeAsync(0);
    run.dispose();
    await vi.runAllTimersAsync();
    expect(run.refresh).toHaveBeenCalledTimes(1);
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
