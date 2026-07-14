import { describe, expect, it } from "vitest";
import { planStableCursorFallback } from "@/lib/dictationFinalizer";

describe("stable cursor finalizer fallback", () => {
  it("allows ordinary final insertion when stable streaming never touched the target", () => {
    expect(planStableCursorFallback(false, true)).toEqual({
      status: "normal-insertion",
    });
  });

  it("preserves progressively committed target text", () => {
    expect(planStableCursorFallback(true, true)).toEqual({
      status: "preserve-target",
    });
  });

  it("does not request insertion after the target lease becomes invalid", () => {
    expect(planStableCursorFallback(false, false)).toEqual({
      status: "preserve-target",
    });
  });

  it("preserves target text when both rejection conditions apply", () => {
    expect(planStableCursorFallback(true, false)).toEqual({
      status: "preserve-target",
    });
  });
});
