import { describe, expect, it } from "vitest";
import {
  deriveStatusLabel,
} from "@/lib/dictationPresentation";

describe("status label presentation", () => {
  const ready = {
    configurationError: false,
    cursorRequired: false,
    cursorSetupState: "ready" as const,
    dictationStatus: "idle" as const,
    microphonePermission: "granted" as const,
    microphoneReady: true,
  };

  it("shows startup without claiming the microphone is listening", () => {
    expect(deriveStatusLabel({ ...ready, dictationStatus: "starting" })).toBe("Starting microphone");
  });

  it("shows one listening label for every recording", () => {
    expect(deriveStatusLabel({ ...ready, dictationStatus: "recording" })).toBe("Listening");
  });

  it("presents a retained interruption calmly", () => {
    expect(deriveStatusLabel({ ...ready, hasRecovery: true, dictationStatus: "error" })).toBe("Dictation saved");
  });

  it("asks for text delivery setup only while desktop input is not ready", () => {
    expect(deriveStatusLabel({ ...ready, cursorRequired: true, cursorSetupState: "not-enabled" })).toBe("Text delivery needs setup");
    expect(deriveStatusLabel({ ...ready, cursorRequired: true, cursorSetupState: "ready" })).toBe("Ready to listen");
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
