import { useMemo } from "react";
import type { FocusEventHandler, PointerEventHandler } from "react";

interface GlassPointerHandlers<T extends HTMLElement> {
  onPointerEnter: PointerEventHandler<T>;
  onPointerMove: PointerEventHandler<T>;
  onPointerLeave: PointerEventHandler<T>;
  onPointerCancel: PointerEventHandler<T>;
  onBlur: FocusEventHandler<T>;
}

function resetHighlight(element: HTMLElement): void {
  element.style.removeProperty("--glass-x");
  element.style.removeProperty("--glass-y");
}

/** Pointer-only decoration. Keyboard focus and activation remain native. */
export function useGlassPointer<T extends HTMLElement = HTMLButtonElement>(): GlassPointerHandlers<T> {
  return useMemo(() => {
    const move: PointerEventHandler<T> = (event) => {
      const element = event.currentTarget;
      const canTrack = event.pointerType === "mouse" &&
        !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" &&
        !element.closest('[data-visual-effects="reduced"]') &&
        typeof window !== "undefined" && typeof window.matchMedia === "function" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        !window.matchMedia("(prefers-reduced-transparency: reduce)").matches &&
        !window.matchMedia("(prefers-contrast: more)").matches &&
        !window.matchMedia("(forced-colors: active)").matches;
      if (!canTrack) {
        resetHighlight(element);
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        resetHighlight(element);
        return;
      }
      const percentage = (offset: number, dimension: number) =>
        `${Math.min(100, Math.max(0, offset / dimension * 100)).toFixed(2)}%`;
      element.style.setProperty("--glass-x", percentage(event.clientX - rect.left, rect.width));
      element.style.setProperty("--glass-y", percentage(event.clientY - rect.top, rect.height));
    };
    const reset: PointerEventHandler<T> & FocusEventHandler<T> = (event) => {
      resetHighlight(event.currentTarget);
    };
    return {
      onPointerEnter: move,
      onPointerMove: move,
      onPointerLeave: reset,
      onPointerCancel: reset,
      onBlur: reset,
    };
  }, []);
}
