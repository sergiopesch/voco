import { describe, expect, it } from "vitest";
import {
  deriveStatusLabel,
  shouldShowDictationOverlay,
} from "@/lib/dictationPresentation";

describe("dictation presentation", () => {
  it("keeps the overlay hidden while words stream at the cursor", () => {
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "recording",
        "cursor",
        "stable-cursor-streaming",
        "off",
        "owned",
      ),
    ).toBe(false);
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "processing",
        "cursor",
        "stable-cursor-streaming",
        "off",
        "owned",
      ),
    ).toBe(false);
  });

  it("shows the fallback when a configured cursor stream is not actually owned", () => {
    for (const delivery of ["preview-only", "unreconciled"] as const) {
      expect(
        shouldShowDictationOverlay(
          "hidden",
          "recording",
          "cursor",
          "stable-cursor-streaming",
          "off",
          delivery,
        ),
      ).toBe(true);
    }
  });

  it("does not flash the overlay while cursor ownership is still being established", () => {
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "recording",
        "cursor",
        "stable-cursor-streaming",
        "off",
        "pending",
      ),
    ).toBe(false);
  });

  it("shows the non-focusable overlay in preview mode", () => {
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "recording",
        "cursor",
        "preview-overlay-only",
        "off",
      ),
    ).toBe(true);
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "processing",
        "cursor",
        "preview-overlay-only",
        "off",
      ),
    ).toBe(true);
  });

  it("shows enhanced stable-mode previews in VOCO until one-shot insertion", () => {
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "recording",
        "cursor",
        "stable-cursor-streaming",
        "conservative",
      ),
    ).toBe(true);
  });

  it("does not cover interactive app surfaces or idle state", () => {
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "idle",
        "cursor",
        "preview-overlay-only",
        "off",
      ),
    ).toBe(false);
    expect(
      shouldShowDictationOverlay(
        "hidden",
        "error",
        "cursor",
        "preview-overlay-only",
        "off",
      ),
    ).toBe(false);
    expect(
      shouldShowDictationOverlay(
        "popover",
        "recording",
        "cursor",
        "preview-overlay-only",
        "off",
      ),
    ).toBe(false);
    expect(
      shouldShowDictationOverlay(
        "settings",
        "processing",
        "cursor",
        "preview-overlay-only",
        "off",
      ),
    ).toBe(false);
  });
});

describe("status label presentation", () => {
  const ready = {
    configurationError: false,
    cursorDeliveryState: "inactive" as const,
    cursorRequired: false,
    cursorSetupState: "ready" as const,
    dictationStatus: "idle" as const,
    isRealtimeActive: false,
    microphonePermission: "granted" as const,
    microphoneReady: true,
    realtimeMuted: false,
    realtimeStatus: "idle" as const,
  };

  it("prioritizes transcript recovery over stale activity errors", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "unreconciled",
        dictationStatus: "error",
        realtimeStatus: "error",
      }),
    ).toBe("Transcript needs attention");
  });

  it("prioritizes an active realtime session while retaining transcript recovery", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "unreconciled",
        isRealtimeActive: true,
        realtimeStatus: "listening",
      }),
    ).toBe("Realtime voice is listening");
  });

  it("presents a muted realtime session explicitly", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        isRealtimeActive: true,
        realtimeMuted: true,
        realtimeStatus: "listening",
      }),
    ).toBe("Realtime voice is muted");
  });

  it("distinguishes pending and preview-only cursor delivery", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "pending",
        cursorRequired: true,
        dictationStatus: "recording",
      }),
    ).toBe("Listening — preparing live cursor");
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "preview-only",
        cursorRequired: true,
        dictationStatus: "recording",
      }),
    ).toBe("Listening — preview only");
  });

  it("surfaces realtime errors and idle cursor setup failures", () => {
    expect(
      deriveStatusLabel({ ...ready, realtimeStatus: "error" }),
    ).toBe("Realtime voice needs attention");
    expect(
      deriveStatusLabel({
        ...ready,
        cursorRequired: true,
        cursorSetupState: "not-enabled",
      }),
    ).toBe("Live cursor needs setup — preview fallback available");
  });

  it("matches the tray by prioritizing a dictation failure when both modes failed", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        dictationStatus: "error",
        realtimeStatus: "error",
      }),
    ).toBe("Needs attention");
  });

  it("surfaces a configuration failure without turning it into a dictation error", () => {
    expect(
      deriveStatusLabel({ ...ready, configurationError: true }),
    ).toBe("Settings need attention");
    expect(
      deriveStatusLabel({
        ...ready,
        configurationError: true,
        dictationStatus: "error",
      }),
    ).toBe("Settings need attention");
  });

  it("prioritizes denied microphone permission over idle cursor setup", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        cursorRequired: true,
        cursorSetupState: "not-enabled",
        microphonePermission: "denied",
        microphoneReady: false,
      }),
    ).toBe("Microphone needs permission");
  });
});
