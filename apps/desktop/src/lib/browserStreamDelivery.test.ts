import { expect, it, vi } from "vitest";
import { BrowserStreamDelivery } from "./browserStreamDelivery";
import type { BrowserFieldStatus } from "@/types";

function harness() {
  let current = true;
  let committed = "";
  const status = (extra: Partial<BrowserFieldStatus> = {}): BrowserFieldStatus => ({
    available: true, ready: true, setupState: "ready", detail: "", sessionId: 17,
    engineActive: true, focusLost: false, progressiveCommitActive: true,
    committedCharacterCount: Array.from(committed).length, ownershipIntact: true,
    finalizationOutcome: null, error: null, ...extra,
  });
  const api = {
    startBrowserField: vi.fn(async () => status()),
    appendBrowserField: vi.fn(async (_id: number, expected: string, suffix: string) => {
      expect(expected).toBe(committed);
      committed += suffix;
      return status();
    }),
    finishBrowserField: vi.fn(async (_id: number, expected: string) => {
      expect(expected).toBe(committed);
      return status({ finalizationOutcome: "committed" });
    }),
    cancelBrowserField: vi.fn(async () => status()),
  };
  const delivery = new BrowserStreamDelivery(() => current, api);
  return { delivery, api, status, replace: () => { current = false; } };
}

it("delivers Nemotron suffixes under one exact browser lease and finishes without replay", async () => {
  const h = harness();
  await h.delivery.start(1, "browser:fixture");
  await h.delivery.append("Hello 🦀");
  await h.delivery.append(" world.");
  await h.delivery.finish();
  expect(h.api.appendBrowserField.mock.calls).toEqual([[17, "", "Hello 🦀"], [17, "Hello 🦀", " world."]]);
  expect(h.api.finishBrowserField).toHaveBeenCalledExactlyOnceWith(17, "Hello 🦀 world.");
  expect(h.api.cancelBrowserField).not.toHaveBeenCalled();
  await expect(h.delivery.append("Again")).rejects.toThrow("no longer active");
});

it.each([
  { focusLost: true }, { ownershipIntact: false }, { engineActive: false },
  { sessionId: 99 }, { committedCharacterCount: 99 },
])("stops after an uncertain receipt and never retries it: %j", async patch => {
  const h = harness();
  await h.delivery.start(1, "browser:fixture");
  h.api.appendBrowserField.mockResolvedValue(h.status(patch));
  await expect(h.delivery.append("Words.")).rejects.toThrow("exact text");
  await expect(h.delivery.append("Later")).rejects.toThrow("no longer active");
  // Stop reports the delivery failure itself, not only the released lease.
  await expect(h.delivery.finish()).rejects.toThrow("exact text");
  expect(h.api.appendBrowserField).toHaveBeenCalledOnce();
  expect(h.api.finishBrowserField).not.toHaveBeenCalled();
  expect(h.api.cancelBrowserField).toHaveBeenCalledExactlyOnceWith(17);
});

it("releases a late start lease after the recording was cancelled", async () => {
  const h = harness();
  let resolve!: (value: BrowserFieldStatus) => void;
  h.api.startBrowserField.mockReturnValue(new Promise(done => { resolve = done; }));
  const start = h.delivery.start(1, "browser:fixture");
  await h.delivery.cancel();
  resolve(h.status());
  await expect(start).rejects.toThrow("no longer active");
  expect(h.api.cancelBrowserField).toHaveBeenCalledExactlyOnceWith(17);
});

it("rejects a late receipt after replacement and does not mutate the replacement field", async () => {
  const h = harness();
  await h.delivery.start(1, "browser:fixture");
  h.api.appendBrowserField.mockImplementation(async () => { h.replace(); return h.status({ committedCharacterCount: 6 }); });
  await expect(h.delivery.append("Words.")).rejects.toThrow("no longer active");
  expect(h.api.cancelBrowserField).toHaveBeenCalledExactlyOnceWith(17);
});

it("requires a final receipt even after every append was acknowledged", async () => {
  const h = harness();
  await h.delivery.start(1, "browser:fixture");
  h.api.finishBrowserField.mockResolvedValue(h.status());
  await expect(h.delivery.finish()).rejects.toThrow("exact text");
  expect(h.api.cancelBrowserField).toHaveBeenCalledExactlyOnceWith(17);
});
