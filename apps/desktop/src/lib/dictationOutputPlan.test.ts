import { describe, expect, it } from "vitest";
import {
  cursorDeliveryPlan,
  requiresVerifiedTextTarget,
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
  transcriptEnhancement: "off",
  onboardingCompleted: true,
  updateChannel: "stable",
  installChannel: "github-release",
  voiceProfile: "default",
};

describe("dictation output plan", () => {
  it("requires a verified original field for every automatic text output", () => {
    for (const transcriptTarget of ["cursor", "local-agent", "openclaw-agent"] as const) {
      for (const liveCursorMode of ["final-text-only", "preview-overlay-only", "stable-cursor-streaming"] as const) {
        expect(requiresVerifiedTextTarget({ ...baseline, transcriptTarget, liveCursorMode } as AppConfig)).toBe(true);
      }
    }
    expect(requiresVerifiedTextTarget({ transcriptTarget: "openclaw-speech" })).toBe(false);
    expect(requiresVerifiedTextTarget(null)).toBe(false);
  });
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
