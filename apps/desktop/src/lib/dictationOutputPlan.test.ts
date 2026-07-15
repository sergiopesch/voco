import { describe, expect, it } from "vitest";
import {
  cursorDeliveryPlan,
  keepsLivePreviewInVoco,
  usesCanonicalCursorStreaming,
} from "@/lib/dictationOutputPlan";
import type { AppConfig } from "@/types";

const baseline: AppConfig = {
  hotkey: "Alt+D",
  selectedMic: null,
  insertionStrategy: "auto",
  transcriptTarget: "cursor",
  liveCursorMode: "stable-cursor-streaming",
  openclawAgent: "main",
  openclawPromptPrefix: "",
  transcriptEnhancement: "off",
  localLlmEndpoint: "http://127.0.0.1:11434/v1",
  localLlmModel: null,
  onboardingCompleted: true,
  updateChannel: "stable",
  installChannel: "github-release",
  voiceProfile: "default",
};

describe("dictation output plan", () => {
  it("allows canonical cursor delivery only for enhancement-off stable mode", () => {
    expect(usesCanonicalCursorStreaming(baseline)).toBe(true);
    for (const transcriptEnhancement of ["commands-only", "conservative"] as const) {
      const config = { ...baseline, transcriptEnhancement };
      expect(usesCanonicalCursorStreaming(config)).toBe(false);
      expect(cursorDeliveryPlan(config)).toBe("one-shot-final");
      expect(keepsLivePreviewInVoco(config)).toBe(true);
    }
  });

  it("routes overlay and final-only cursor modes to one-shot final insertion", () => {
    expect(
      cursorDeliveryPlan({ ...baseline, liveCursorMode: "preview-overlay-only" }),
    ).toBe("one-shot-final");
    expect(
      cursorDeliveryPlan({ ...baseline, liveCursorMode: "final-text-only" }),
    ).toBe("one-shot-final");
  });

  it("does not claim cursor delivery for agent targets", () => {
    expect(cursorDeliveryPlan({ ...baseline, transcriptTarget: "local-agent" })).toBe(
      "not-cursor",
    );
  });
});
