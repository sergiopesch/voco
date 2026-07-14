import { describe, expect, it } from "vitest";
import { shouldShowDictationOverlay } from "@/lib/dictationPresentation";

describe("dictation presentation", () => {
  it("keeps the overlay hidden while words stream at the cursor", () => {
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "recording",
        "cursor",
        "stable-cursor-streaming",
      ),
    ).toBe(false);
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "processing",
        "cursor",
        "stable-cursor-streaming",
      ),
    ).toBe(false);
  });

  it("shows the non-focusable overlay in preview mode", () => {
    expect(
      shouldShowDictationOverlay("hidden", "recording", "cursor", "preview-overlay-only"),
    ).toBe(true);
    expect(
      shouldShowDictationOverlay("hidden", "processing", "cursor", "preview-overlay-only"),
    ).toBe(true);
  });

  it("does not cover interactive app surfaces or idle state", () => {
    expect(shouldShowDictationOverlay("hidden", "idle", "cursor", "preview-overlay-only")).toBe(false);
    expect(shouldShowDictationOverlay("hidden", "error", "cursor", "preview-overlay-only")).toBe(false);
    expect(shouldShowDictationOverlay("popover", "recording", "cursor", "preview-overlay-only")).toBe(false);
    expect(shouldShowDictationOverlay("settings", "processing", "cursor", "preview-overlay-only")).toBe(false);
  });
});
