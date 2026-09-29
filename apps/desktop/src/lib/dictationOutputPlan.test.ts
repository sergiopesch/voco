import { describe, expect, it } from "vitest";
import { requiresVerifiedTextTarget } from "@/lib/dictationOutputPlan";
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
});
