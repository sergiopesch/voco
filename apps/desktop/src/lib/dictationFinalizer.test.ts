import { describe, expect, it } from "vitest";
import { planLiveFinalCursorAction } from "@/lib/dictationFinalizer";

describe("dictation finalizer", () => {
  it("uses normal insertion when no live cursor text was committed", () => {
    expect(planLiveFinalCursorAction("", "Final transcript")).toEqual({
      status: "no-live-text",
      appendText: "",
    });
  });

  it("appends only the final suffix when final text safely extends live text", () => {
    expect(
      planLiveFinalCursorAction("Okay, let's give", "Okay, let's give it a try."),
    ).toEqual({
      status: "append-final-suffix",
      appendText: " it a try.",
    });
  });

  it("accepts punctuation and casing differences without rewriting live text", () => {
    expect(planLiveFinalCursorAction("Okay lets", "Okay, let's give it a try.")).toEqual({
      status: "append-final-suffix",
      appendText: " give it a try.",
    });
  });

  it("does not append duplicate final text when live text already matches", () => {
    expect(planLiveFinalCursorAction("Hello world", "hello, world")).toEqual({
      status: "already-final",
      appendText: "",
    });
  });

  it("keeps live text when final text would require a destructive rewrite", () => {
    expect(planLiveFinalCursorAction("Okay broken", "Okay, let's give it a try.")).toEqual({
      status: "keep-live-text",
      appendText: "",
    });
  });
});
