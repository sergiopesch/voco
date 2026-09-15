import { describe, expect, it } from "vitest";
import {
  deriveStatusLabel,
} from "@/lib/dictationPresentation";

describe("status label presentation", () => {
  const ready = {
    configurationError: false,
    cursorDeliveryState: "inactive" as const,
    cursorRequired: false,
    cursorSetupState: "ready" as const,
    dictationStatus: "idle" as const,
    microphonePermission: "granted" as const,
    microphoneReady: true,
  };

  it("shows startup without claiming the microphone is listening", () => {
    expect(deriveStatusLabel({ ...ready, dictationStatus: "starting" })).toBe("Starting microphone");
  });

  it("keeps recovery visible across later successful captures until dismissal", () => {
    expect(deriveStatusLabel({ ...ready, hasRecoverableTranscript: true })).toBe("Transcript needs attention");
    expect(deriveStatusLabel({ ...ready, cursorDeliveryState: "inactive", hasRecoverableTranscript: false })).toBe("Ready to listen");
  });

  it("prioritizes transcript recovery over stale activity errors", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "unreconciled",
        hasRecoverableTranscript: true,
        dictationStatus: "error",
      }),
    ).toBe("Transcript needs attention");
  });



  it("distinguishes pending and preview-only cursor delivery", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "pending",
        cursorRequired: true,
        dictationStatus: "recording",
      }),
    ).toBe("Listening — verifying original field");
    expect(
      deriveStatusLabel({
        ...ready,
        cursorDeliveryState: "preview-only",
        cursorRequired: true,
        dictationStatus: "recording",
      }),
    ).toBe("Listening — preview only");
  });


  it("treats completed manual dictation as a usable result", () => {
    expect(deriveStatusLabel({ ...ready, hasRecovery: true, manualTranscriptReady: true })).toBe("Transcript ready to copy");
    expect(deriveStatusLabel({ ...ready, cursorRequired: true, cursorSetupState: "safety-disabled" })).toBe("Ready — manual copy");
  });

  it("matches the tray by prioritizing a dictation failure when both modes failed", () => {
    expect(
      deriveStatusLabel({
        ...ready,
        dictationStatus: "error",
      }),
    ).toBe("Needs attention");
  });

  it("surfaces a configuration failure without turning it into a dictation error", () => {
    expect(
      deriveStatusLabel({ ...ready, configurationError: true }),
    ).toBe("Settings need attention");
    expect(
      deriveStatusLabel({ ...ready, configurationError: true, hasRecoverableTranscript: true }),
    ).toBe("Settings need attention");
    expect(
      deriveStatusLabel({
        ...ready,
        configurationError: true,
        dictationStatus: "error",
      }),
    ).toBe("Settings need attention");
  });

  it("keeps native dictation readiness separate from browser permission", () => {
    expect(deriveStatusLabel({ ...ready, nativeMicrophoneReady: true, microphonePermission: "denied" }))
      .toBe("Ready to listen");
    expect(deriveStatusLabel({ ...ready, nativeMicrophoneReady: false, microphonePermission: "granted" }))
      .toBe("Microphone setup required");
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
