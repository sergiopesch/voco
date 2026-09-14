import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrophoneRefresh, microphoneAccessFailure, queryMicrophonePermission } from "./microphoneRefresh";
import { probeMicrophoneAccess } from "./audioInput";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.unstubAllGlobals());
describe("microphone refresh ownership", () => {
  it("ignores a slow empty enumeration after a newer hotplug result", async () => {
    const owner = new MicrophoneRefresh(); const a = deferred<string[]>(); const b = deferred<string[]>();
    let devices: string[] = [];
    const run = async (pending: Promise<string[]>) => { const current = owner.beginRefresh(); const result = await pending; if (current()) devices = result; };
    const first = run(a.promise); const next = run(b.promise); b.resolve(["new mic"]); await next; a.resolve([]); await first;
    expect(devices).toEqual(["new mic"]);
  });
  it("fences deferred refresh and retry across disposal and reactivation", async () => {
    const owner = new MicrophoneRefresh(); const refresh = owner.beginRefresh(); const retry = owner.beginRetry();
    owner.dispose(); owner.activate(); expect(refresh()).toBe(false); expect(retry()).toBe(false); expect(owner.beginRefresh()()).toBe(true);
  });
  it("older failure cannot overwrite newer success and activity invalidates pending retry", async () => {
    const owner = new MicrophoneRefresh(); const a = deferred<void>(); const b = deferred<void>(); let ready = false;
    const run = async (pending: Promise<void>) => { const current = owner.beginRetry(); try { await pending; if (current()) ready = true; } catch { if (current()) ready = false; } };
    const first = run(a.promise); const next = run(b.promise); b.resolve(); await next; a.reject(new Error("old failure")); await first; expect(ready).toBe(true);
    const pending = deferred<void>(); const last = run(pending.promise); ready = false; owner.invalidateRetry(); pending.resolve(); await last; expect(ready).toBe(false);
  });
  it.each([undefined, {}, { query: () => { throw new Error("unsupported"); } }, { query: () => Promise.reject(new Error("unsupported")) }])("treats unsupported permission query as unavailable: %o", async (permissions) => {
    vi.stubGlobal("navigator", { permissions }); expect(await queryMicrophonePermission()).toBeNull();
  });
  it("keeps supported explicit denial distinct from missing devices and constraints", () => {
    expect(microphoneAccessFailure(new DOMException("no", "NotAllowedError")).denied).toBe(true);
    for (const name of ["NotFoundError", "OverconstrainedError", "NotReadableError", "Error"]) expect(microphoneAccessFailure(new DOMException("detail", name)).denied).toBe(false);
  });
  it("closes only the acquired probe stream even when its retry became stale", async () => {
    const stop = vi.fn(); const otherStop = vi.fn(); const pending = deferred<MediaStream>(); const owner = new MicrophoneRefresh();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => pending.promise } });
    const current = owner.beginRetry(); const operation = probeMicrophoneAccess(null); owner.invalidateRetry();
    pending.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream); await operation;
    expect(current()).toBe(false); expect(stop).toHaveBeenCalledTimes(1); expect(otherStop).not.toHaveBeenCalled();
  });
});
