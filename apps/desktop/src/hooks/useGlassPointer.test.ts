import { createElement } from "react";
import type { FocusEvent, PointerEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGlassPointer } from "./useGlassPointer";

function createHandlers() {
  let handlers: ReturnType<typeof useGlassPointer> | undefined;
  function Probe() {
    handlers = useGlassPointer();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!handlers) throw new Error("Expected glass pointer handlers");
  return handlers;
}

function createElementFixture(options: { disabled?: boolean; ariaDisabled?: boolean; reduced?: boolean; width?: number } = {}) {
  const properties = new Map<string, string>();
  const element = {
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
    matches: () => options.disabled ?? false,
    getAttribute: () => options.ariaDisabled ? "true" : null,
    closest: () => options.reduced ? {} : null,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: options.width ?? 200, height: 100 }),
  } as unknown as HTMLButtonElement;
  return { element, properties };
}

function pointerEvent(element: HTMLButtonElement, pointerType = "mouse", clientX = 60, clientY = 95) {
  return { currentTarget: element, pointerType, clientX, clientY } as PointerEvent<HTMLButtonElement>;
}

function mediaPreferences({ motion = false, fine = true, transparency = false, contrast = false, forced = false } = {}) {
  const preferences: Record<string, boolean> = {
    "(hover: hover) and (pointer: fine)": fine,
    "(prefers-reduced-motion: reduce)": motion,
    "(prefers-reduced-transparency: reduce)": transparency,
    "(prefers-contrast: more)": contrast,
    "(forced-colors: active)": forced,
  };
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: preferences[query] ?? false }),
  });
}

describe("glass pointer highlight", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("positions the highlight relative to each control and clamps outside coordinates", () => {
    mediaPreferences();
    const handlers = createHandlers();
    const first = createElementFixture();
    const second = createElementFixture();
    handlers.onPointerMove(pointerEvent(first.element));
    expect(first.properties.get("--glass-x")).toBe("25.00%");
    expect(first.properties.get("--glass-y")).toBe("75.00%");
    expect(second.properties.size).toBe(0);
    handlers.onPointerEnter(pointerEvent(second.element, "mouse", 400, -20));
    expect(second.properties.get("--glass-x")).toBe("100.00%");
    expect(second.properties.get("--glass-y")).toBe("0.00%");
  });

  it.each([
    { disabled: true },
    { ariaDisabled: true },
    { reduced: true },
    { width: 0 },
  ])("skips disabled, reduced-effect, and unmeasurable controls: %j", (options) => {
    mediaPreferences();
    const handlers = createHandlers();
    const { element, properties } = createElementFixture(options);
    properties.set("--glass-x", "80%");
    handlers.onPointerMove(pointerEvent(element));
    expect(properties.size).toBe(0);
  });

  it.each([
    { motion: true, fine: true, pointer: "mouse" },
    { motion: false, fine: false, pointer: "mouse" },
    { motion: false, fine: true, pointer: "touch" },
    { motion: false, fine: true, pointer: "pen" },
    { transparency: true, pointer: "mouse" },
    { contrast: true, pointer: "mouse" },
    { forced: true, pointer: "mouse" },
  ])("does not track unsupported pointer or motion preferences: %j", ({ pointer, ...preferences }) => {
    mediaPreferences(preferences);
    const handlers = createHandlers();
    const { element, properties } = createElementFixture();
    handlers.onPointerMove(pointerEvent(element, pointer));
    expect(properties.size).toBe(0);
  });

  it("resets decoration on leave, cancellation, and keyboard blur", () => {
    mediaPreferences();
    const handlers = createHandlers();
    const { element, properties } = createElementFixture();
    handlers.onPointerMove(pointerEvent(element));
    handlers.onPointerLeave(pointerEvent(element));
    expect(properties.size).toBe(0);
    handlers.onPointerMove(pointerEvent(element));
    handlers.onPointerCancel(pointerEvent(element));
    expect(properties.size).toBe(0);
    handlers.onPointerMove(pointerEvent(element));
    handlers.onBlur({ currentTarget: element } as FocusEvent<HTMLButtonElement>);
    expect(properties.size).toBe(0);
  });

  it("rechecks preferences during interaction and drops an existing highlight", () => {
    mediaPreferences();
    const handlers = createHandlers();
    const { element, properties } = createElementFixture();
    handlers.onPointerMove(pointerEvent(element));
    mediaPreferences({ motion: true });
    handlers.onPointerMove(pointerEvent(element));
    expect(properties.size).toBe(0);
  });
});
