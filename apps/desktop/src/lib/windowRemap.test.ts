import { describe, expect, it } from "vitest";
import { showInteractiveWindow, WindowRemapFocusGuard, isWaylandSession } from "./windowRemap";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("Wayland interactive window remap", () => {
  it("matches the actual runtime diagnostic session labels", () => {
    expect(isWaylandSession("wayland")).toBe(true);
    for (const value of [null, "x11-or-other", "Wayland", ""]) expect(isWaylandSession(value)).toBe(false);
  });
  it("unmaps before sizing, then shows and focuses, without changing X11 order", async () => {
    for (const wayland of [true, false]) {
      const events: string[] = [];
      const operation = (name: string) => async () => { events.push(name); };
      await showInteractiveWindow({ request: 1, wayland, guard: new WindowRemapFocusGuard(),
        isCurrent: () => true, hide: operation("hide"), resize: operation("resize"),
        position: operation("position"), show: operation("show"), focus: operation("focus"),
        isFocused: async () => true });
      expect(events).toEqual([...(wayland ? ["hide"] : []), "resize", "position", "show", "focus"]);
    }
  });

  it("never shows an escaped or superseded request after delayed hide", async () => {
    const guard = new WindowRemapFocusGuard();
    const hidden = deferred<void>();
    const events: string[] = [];
    let current = true;
    const run = showInteractiveWindow({ request: 1, wayland: true, guard,
      isCurrent: () => current, hide: () => hidden.promise,
      resize: async () => { events.push("resize"); }, position: async () => {},
      show: async () => { events.push("show"); }, focus: async () => {}, isFocused: async () => false });
    current = false;
    guard.invalidate(); // Escape/new surface is synchronous, before the React effect.
    hidden.resolve();
    await run;
    expect(events).toEqual([]);
    expect(await guard.shouldDismiss(async () => false)).toBe(true);
  });

  it("ignores its own blur and delayed blur after refocus, then dismisses genuine focus loss", async () => {
    const guard = new WindowRemapFocusGuard();
    guard.begin(1);
    expect(await guard.shouldDismiss(async () => false)).toBe(false);
    expect(await guard.shouldDismiss(async () => true)).toBe(false); // Old focus before show.
    guard.awaitFocus(1);
    expect(await guard.shouldDismiss(async () => false)).toBe(false); // Focus request not fulfilled yet.
    expect(await guard.shouldDismiss(async () => true)).toBe(false); // Actual refocus releases guard.
    expect(await guard.shouldDismiss(async () => true)).toBe(false); // Delayed old blur, currently focused.
    expect(await guard.shouldDismiss(async () => false)).toBe(true);
  });

  it("ignores stale focus queries across a new request and cancels declined focus on explicit dismissal", async () => {
    const guard = new WindowRemapFocusGuard();
    const query = deferred<boolean>();
    const old = guard.shouldDismiss(() => query.promise);
    guard.begin(2); guard.awaitFocus(2);
    query.resolve(false);
    expect(await old).toBe(false);
    expect(await guard.shouldDismiss(async () => false)).toBe(false);
    guard.invalidate();
    expect(await guard.shouldDismiss(async () => false)).toBe(true);
  });

  it("ignores an old blur reply after a newer focus observation", async () => {
    const guard = new WindowRemapFocusGuard();
    const oldBlur = deferred<boolean>();
    const old = guard.shouldDismiss(() => oldBlur.promise);
    expect(await guard.shouldDismiss(async () => true)).toBe(false);
    oldBlur.resolve(false);
    expect(await old).toBe(false);
    expect(await guard.shouldDismiss(async () => false)).toBe(true);
  });

  it("keeps the newest blur authoritative when focus replies arrive out of order", async () => {
    const guard = new WindowRemapFocusGuard();
    const oldFocus = deferred<boolean>();
    const old = guard.shouldDismiss(() => oldFocus.promise);
    expect(await guard.shouldDismiss(async () => false)).toBe(true);
    oldFocus.resolve(true);
    expect(await old).toBe(false);
  });

  it("clears suppression on transition failure", async () => {
    const guard = new WindowRemapFocusGuard();
    await expect(showInteractiveWindow({ request: 1, wayland: true, guard,
      isCurrent: () => true, hide: async () => { throw Error("resize failed"); }, resize: async () => {},
      position: async () => {}, show: async () => {}, focus: async () => {}, isFocused: async () => false,
    })).rejects.toThrow("resize failed");
    expect(await guard.shouldDismiss(async () => false)).toBe(true);
  });
  it("restores a hidden current window on resize failure but never reopens an escaped request", async () => {
    for (const escaped of [false, true]) {
      const guard = new WindowRemapFocusGuard();
      const resize = deferred<void>();
      const resizeStarted = deferred<void>();
      const events: string[] = [];
      let current = true;
      const running = showInteractiveWindow({ request: 1, wayland: true, guard,
        isCurrent: () => current, hide: async () => {},
        resize: async () => { resizeStarted.resolve(); await resize.promise; throw Error("resize failed"); },
        position: async () => {}, show: async () => { events.push("show"); },
        focus: async () => {}, isFocused: async () => true });
      await resizeStarted.promise;
      if (escaped) { current = false; guard.invalidate(); }
      resize.resolve();
      await expect(running).rejects.toThrow("resize failed");
      expect(events).toEqual(escaped ? [] : ["show"]);
    }
  });
});
