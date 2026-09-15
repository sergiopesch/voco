import { describe, expect, it, vi } from "vitest";
import { DesktopShortcutSession } from "./desktopShortcutSession";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("bounded desktop shortcut ownership", () => {
  it("acquires and releases one UUID once, with no renewal", async () => {
    const api = { begin: vi.fn(async () => {}), end: vi.fn(async () => {}) };
    const report = vi.fn();
    const session = new DesktopShortcutSession(api, 7, report);
    await Promise.all([session.acquire(), session.acquire()]);
    expect(api.begin).toHaveBeenCalledExactlyOnceWith(session.id, 7);
    expect(session.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
    expect(api.end).not.toHaveBeenCalled();
    expect(await session.dispose()).toBe(true);
    expect(await session.dispose()).toBe(true);
    expect(api.end).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(report).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("waits for a pending begin before ending only that owner", async () => {
    const begun = deferred();
    const api = { begin: vi.fn(() => begun.promise), end: vi.fn(async () => {}) };
    const old = new DesktopShortcutSession(api, 7, vi.fn());
    const fresh = new DesktopShortcutSession(api, 8, vi.fn());
    const acquiring = expect(old.acquire()).rejects.toThrow("no longer active");
    const disposed = old.dispose();
    await Promise.resolve();
    expect(api.end).not.toHaveBeenCalled();
    begun.resolve();
    await acquiring;
    expect(await disposed).toBe(true);
    expect(api.end).toHaveBeenCalledExactlyOnceWith(old.id);
    expect(api.end).not.toHaveBeenCalledWith(fresh.id);
  });

  it("cleans an uncertain failed begin before returning its error", async () => {
    const released = deferred();
    const api = { begin: vi.fn(async () => { throw new Error("unconfirmed begin"); }), end: vi.fn(() => released.promise) };
    const session = new DesktopShortcutSession(api, 7, vi.fn());
    const rejected = vi.fn();
    const acquired = session.acquire().catch(rejected);
    await vi.waitFor(() => expect(api.end).toHaveBeenCalledWith(session.id));
    expect(rejected).not.toHaveBeenCalled();
    released.resolve(); await acquired;
    expect(rejected).toHaveBeenCalledWith(new Error("unconfirmed begin"));
    expect(api.end).toHaveBeenCalledOnce();
  });

  it("reports a failed release once without rejecting cleanup or exposing errors", async () => {
    const api = { begin: vi.fn(async () => {}), end: vi.fn(async () => { throw new Error("private native detail"); }) };
    const report = vi.fn();
    const session = new DesktopShortcutSession(api, 7, report);
    await session.acquire();
    expect(await session.dispose()).toBe(false);
    expect(await session.dispose()).toBe(false);
    expect(report).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("does not acquire after early disposal and contains reporter exceptions", async () => {
    const api = { begin: vi.fn(async () => {}), end: vi.fn(async () => {}) };
    const early = new DesktopShortcutSession(api, 7, vi.fn());
    expect(await early.dispose()).toBe(true);
    await expect(early.acquire()).rejects.toThrow("no longer active");
    expect(api.begin).not.toHaveBeenCalled();
    const active = new DesktopShortcutSession(api, 7, () => { throw new Error("report failure"); });
    await active.acquire();
    expect(await active.dispose()).toBe(true);
  });
});
