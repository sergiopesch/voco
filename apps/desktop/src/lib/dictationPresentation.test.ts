import { describe, expect, it } from "vitest";
import {
  deriveCursorSetupState,
  deriveNativeMicrophoneReady,
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

  it("keeps desktop setup pending until the first diagnostics settle", () => {
    const pending = deriveCursorSetupState({ desktopInputReady: false, diagnosticsLoaded: false, diagnosticsFailed: false });
    const failed = deriveCursorSetupState({ desktopInputReady: false, diagnosticsLoaded: false, diagnosticsFailed: true });
    const missing = deriveCursorSetupState({ desktopInputReady: false, diagnosticsLoaded: true, diagnosticsFailed: false });
    const ready = deriveCursorSetupState({ desktopInputReady: true, diagnosticsLoaded: true, diagnosticsFailed: true });
    expect([pending, failed, missing, ready]).toEqual(["", "not-enabled", "not-enabled", "ready"]);
  });

  it("shows initializing while desktop diagnostics are pending, never setup needed", () => {
    expect(deriveStatusLabel({ ...ready, cursorRequired: true, cursorSetupState: "" })).toBe("Initializing…");
    expect(deriveStatusLabel({ ...ready, cursorRequired: true, cursorSetupState: "not-enabled" })).toBe("Desktop setup needed");
    expect(deriveStatusLabel({ ...ready, cursorRequired: false, cursorSetupState: "ready" })).toBe("Ready to listen");
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

describe("native microphone readiness", () => {
  const idle = {
    configurationError: false,
    cursorRequired: false,
    cursorSetupState: "ready" as const,
    dictationStatus: "idle" as const,
    microphonePermission: "unknown" as const,
  };

  it("lets Start pick the system default when no microphone is chosen", () => {
    const unchosen = deriveNativeMicrophoneReady({ mode: "native", selected: false, lost: false, microphoneReady: false, defaultAvailable: true });
    expect(unchosen).toBeNull();
    expect(deriveStatusLabel({ ...idle, nativeMicrophoneReady: unchosen, microphoneReady: false }))
      .toBe("Ready — microphone checks on first use");
  });

  it("asks for setup only when there is no usable microphone", () => {
    const none = deriveNativeMicrophoneReady({ mode: "native", selected: false, lost: false, microphoneReady: false, defaultAvailable: false });
    expect(none).toBe(false);
    expect(deriveStatusLabel({ ...idle, nativeMicrophoneReady: none, microphoneReady: false })).toBe("Microphone setup required");
    expect(deriveNativeMicrophoneReady({ mode: "pending", selected: false, lost: false, microphoneReady: false, defaultAvailable: true })).toBe(false);
  });

  it("keeps a chosen microphone that failed or disappeared not ready until a new choice", () => {
    const lost = deriveNativeMicrophoneReady({ mode: "native", selected: false, lost: true, microphoneReady: false, defaultAvailable: true });
    expect(lost).toBe(false);
    expect(deriveStatusLabel({ ...idle, nativeMicrophoneReady: lost, microphoneReady: false })).toBe("Microphone setup required");
  });

  it("is ready with a chosen microphone and leaves WebKit to its permission prompt", () => {
    expect(deriveNativeMicrophoneReady({ mode: "native", selected: true, lost: false, microphoneReady: true, defaultAvailable: false })).toBe(true);
    expect(deriveNativeMicrophoneReady({ mode: "native", selected: true, lost: false, microphoneReady: false, defaultAvailable: true })).toBe(false);
    expect(deriveNativeMicrophoneReady({ mode: "webkit", selected: false, lost: true, microphoneReady: false, defaultAvailable: false })).toBeNull();
  });
});
