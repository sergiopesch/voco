import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ControlPanel,
  shouldOpenMicrophonePreview,
  shortcutFromKeyboardEvent,
} from "@/components/ControlPanel";
import type { AppConfig } from "@/types";

const config: AppConfig = {
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

afterEach(() => vi.unstubAllGlobals());

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ControlPanel>> = {},
) {
  const asyncNoop = vi.fn(async () => {});
  return renderToStaticMarkup(
    <ControlPanel
      surface="popover"
      onboardingStep={0}
      config={config}
      errorMessage={null}
      statusLabel="Ready to listen"
      updateState={{
        status: "idle",
        currentVersion: "2026.0.21",
        latestRelease: null,
        lastCheckedAt: null,
        error: null,
      }}
      runtimeDiagnostics={null}
      dictationStatus="idle"
      cursorDeliveryState="inactive"
      transcript=""
      requestedSection="General"
      requestedSectionRequestId={0}
      selectedDeviceId={null}
      availableDevices={[]}
      microphonePermission="unknown"
      onSurfaceChange={vi.fn()}
      onOnboardingStepChange={vi.fn()}
      onConfigChange={asyncNoop}
      onRefreshDevices={asyncNoop}
      onRequestMicrophoneAccess={async () => true}
      onCheckForUpdates={asyncNoop}
      onOpenReleasePage={asyncNoop}
      onRefreshRuntimeDiagnostics={asyncNoop}
      onOpenSettings={asyncNoop}
      {...overrides}
    />,
  );
}

describe("Silver Lens output guidance", () => {
  it("preserves readiness warnings rather than replacing them with Ready", () => {
    const markup = renderPanel({ statusLabel: "Microphone needs permission" });
    expect(markup).toContain("Microphone needs permission");
    expect(markup).not.toContain('>Ready</strong>');
  });
});

describe("ControlPanel", () => {
  it("keeps popover dictation focus-safe and names the microphone clearly", () => {
    const markup = renderPanel();
    expect(markup).toContain("Shortcut configured: Alt+D. Start dictation from the tray.");
    expect(markup).not.toContain("Press Alt+D to record and copy.");
    expect(markup).toContain("focus a text field");
    expect(markup).toContain("Alt+D");
    expect(markup).toContain("Microphone: System default");
    expect(markup).not.toContain("Start listening");
  });

  it("advertises the shortcut only with explicit current available diagnostics", () => {
    const support = { available: false, requiredCommands: [], missingCommands: [], optionalMissingCommands: [], detail: "Fixture" };
    const markup = renderPanel({ runtimeDiagnostics: {
      shortcut: { hotkey: "Alt+D", route: "global-shortcut", state: "available", detail: "Registered current shortcut" },
      sessionType: "wayland", typeSimulation: support, clipboard: support,
      ownedPreedit: { available: false, ready: false, setupState: "safety-disabled", detail: "Manual copy", sessionId: null, engineActive: false, focusLost: false, progressiveCommitActive: false, committedCharacterCount: 0, ownershipIntact: false, finalizationOutcome: null, error: null },
    } });
    expect(markup).toContain("Press Alt+D to record and copy.");
    expect(markup).toContain("focus a text field");
    expect(markup).not.toContain("Start listening");
  });

  it("offers explicit recovery for an unreconciled transcript", () => {
    const markup = renderPanel({
      cursorDeliveryState: "unreconciled",
      transcript: "A transcript that stayed safely inside VOCO.",
      statusLabel: "Transcript needs attention",
    });
    expect(markup).toContain("Transcript kept safely in VOCO");
    expect(markup).toContain("A transcript that stayed safely inside VOCO.");
    expect(markup).toContain("Copy transcript");
  });

  it("keeps a failed one-shot transcript recoverable and preserves the body row", () => {
    const markup = renderPanel({
      dictationStatus: "error",
      transcript: "A final transcript whose selected output failed.",
      errorMessage: "Local agent request failed.",
      statusLabel: "Needs attention",
    });
    expect(markup).toContain("voco-panel__error-slot");
    expect(markup).toContain("Local agent request failed.");
    expect(markup).toContain("The selected output did not complete");
    expect(markup).toContain("A final transcript whose selected output failed.");
    expect(markup).toContain("Copy transcript");
  });

  it("renders a compact, actionable settings navigation", () => {
    const markup = renderPanel({ surface: "settings" });
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Troubleshooting");
    expect(markup).toContain('aria-label="App settings"');
    expect(markup).not.toContain("Accent-aware recognition is planned");
  });

  it("explains the fail-closed live-cursor target boundary", () => {
    const settingsMarkup = renderPanel({
      surface: "settings",
      requestedSection: "Output",
    });
    expect(settingsMarkup).toContain("Keep the same field focused");
    expect(settingsMarkup).toContain("If delivery is interrupted");
    expect(settingsMarkup).toContain("your transcript stays available");

    const onboardingMarkup = renderPanel({
      surface: "onboarding",
      onboardingStep: 2,
    });
    expect(onboardingMarkup).toContain("focus a text field");
    expect(onboardingMarkup).toContain("Your words appear directly");
  });




});

describe("Crystal Sidebar settings", () => {
  it("prioritizes retained recovery over an earlier delivered result", () => {
    const markup = renderPanel({
      surface: "settings",
      lastDictationResult: { outcome: "delivered", completedAt: 2 },
      recoverableTranscripts: [{ id: "earlier", text: "Keep this text", createdAt: 1, reason: "delivery-unconfirmed", isPartial: false }],
    });
    expect(markup).toContain("A transcript needs attention");
    expect(markup).toContain("Review saved transcripts");
    expect(markup.indexOf("A transcript needs attention")).toBeLessThan(markup.indexOf("Your setup"));
    expect(markup).not.toContain("A dictation was delivered this session");
    expect(markup).not.toContain("Keep this text");
  });

  it("does not equate microphone permission with detected sound", () => {
    const markup = renderPanel({ surface: "settings", requestedSection: "Audio", microphonePermission: "granted" });
    expect(markup).toMatch(/<p[^>]*role="status"[^>]*>Waiting for sound<\/p>/);
    expect(markup).toContain("This checks microphone sound, not transcription");
    expect(markup).not.toContain("Audio detected during this check");
    expect(markup).not.toContain("Retry microphone access");
  });

  it("immediately explains denied microphone access and exposes recovery", () => {
    const markup = renderPanel({ surface: "settings", requestedSection: "Audio", microphonePermission: "denied" });
    expect(markup).toContain("Microphone access needs attention");
    expect(markup).toContain("Retry microphone access");
    expect(markup).not.toContain("Waiting for sound");
    expect(markup).not.toContain("Speak a few words");
  });


  it.each(["starting", "recording", "processing"] as const)("pauses the sound check during %s", (dictationStatus) => {
    const markup = renderPanel({ surface: "settings", requestedSection: "Audio", dictationStatus });
    expect(markup).toContain("Microphone check paused during dictation");
    expect(markup).not.toContain("Waiting for sound");
    expect(markup).toMatch(/<select[^>]*disabled=""/);
  });

  it.each([false, true])("uses glass regardless of the retired reduced-effects preference %s", (reduced) => {
    const getItem = vi.fn(() => String(reduced));
    vi.stubGlobal("window", { localStorage: { getItem }, matchMedia: () => ({ matches: true }) });
    for (const requestedSection of ["General"] as const) {
      const markup = renderPanel({ surface: "settings", requestedSection });
      expect(markup).toContain('data-visual-effects="full"');
      expect(markup).not.toContain('role="switch"');
      expect(markup).not.toContain("Glass effects");
      expect(markup).not.toContain("Reduce motion");
    }
    expect(getItem).not.toHaveBeenCalled();
    expect(renderPanel({ surface: "popover" })).not.toContain("Reduce visual effects");
  });



  it.each(["General", "Audio", "Output", "Hotkeys", "Updates", "Advanced"] as const)("keeps Hide to tray available in %s", (requestedSection) => {
    const markup = renderPanel({ surface: "settings", requestedSection });
    expect(markup.match(/>Hide to tray</g)).toHaveLength(1);
  });
});

describe("microphone preview gating", () => {

  it("opens only on the inactive onboarding or Audio surfaces", () => {
    expect(shouldOpenMicrophonePreview("onboarding", 1, "General")).toBe(true);
    expect(shouldOpenMicrophonePreview("settings", 0, "Audio")).toBe(true);
    expect(shouldOpenMicrophonePreview("settings", 0, "General")).toBe(false);
    expect(shouldOpenMicrophonePreview("popover", 0, "Audio")).toBe(false);
  });
});


describe("guided dictation and settings journeys", () => {
  it("does not equate permission with a completed microphone or dictation check", () => {
    const mic = renderPanel({ surface: "onboarding", onboardingStep: 1, microphonePermission: "granted" });
    expect(mic).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
    expect(mic).toContain("Set up microphone later");
    const firstTry = renderPanel({ surface: "onboarding", onboardingStep: 2, microphonePermission: "granted" });
    expect(firstTry).toContain("First dictation: not yet verified");
    expect(firstTry).toMatch(/<button[^>]*disabled=""[^>]*>Hide and try dictation<\/button>/);
    expect(firstTry).toContain("Set up later");
    expect(firstTry).not.toContain("Finish setup");
  });

  it("names and identifies the current setup step", () => {
    const markup = renderPanel({ surface: "onboarding", onboardingStep: 1 });
    expect(markup).toContain('aria-label="Setup progress"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("2. Microphone");
    expect(markup).toContain('aria-describedby="voco-hotkey-feedback"');
  });

  it("keeps configured shortcuts in the core guide and output instructions", () => {
    const custom = { ...config, hotkey: "Ctrl+Shift+V" };
    expect(renderPanel({ config: custom })).toContain("Ctrl+Shift+V");
    const output = renderPanel({ surface: "settings", requestedSection: "Output", config: custom });
    expect(output).toContain("Ctrl+Shift+V");
    expect(output).not.toContain("Alt+D");
  });



  it("does not resurrect a dismissed record from the current transcript", () => {
    const markup = renderPanel({ recoverableTranscripts: [], transcript: "Dismissed text", cursorDeliveryState: "unreconciled" });
    expect(markup).not.toContain("Dismissed text");
    expect(markup).not.toContain("Copy transcript");
  });

  it("keeps multiple retained transcripts reachable and marks incomplete text", () => {
    const markup = renderPanel({
      recoverableTranscripts: [
        { id: "one", text: "Earlier unreconciled text.", createdAt: 1, reason: "delivery-unconfirmed", isPartial: false },
        { id: "two", text: "Only the preserved prefix.", createdAt: 2, reason: "output-failed", isPartial: true },
      ],
      onDismissRecoverableTranscript: vi.fn(),
    });
    expect(markup).toContain("Earlier unreconciled text.");
    expect(markup).toContain("Only the preserved prefix.");
    expect(markup).toContain("Partial transcript");
    expect(markup).toContain("avoid duplicates");
    expect(markup).toContain("Kept until VOCO exits");
    expect(markup.match(/>Dismiss transcript</g)).toHaveLength(2);
  });

  it("puts update status and action before optional preferences", () => {
    const markup = renderPanel({ surface: "settings", requestedSection: "Updates" });
    expect(markup.indexOf("Check for updates")).toBeLessThan(markup.indexOf("Update preferences and installation details"));
    expect(markup.match(/>Check for updates</g)).toHaveLength(1);
  });

  it("never opens audio preview while dictation is starting or running", () => {
    for (const status of ["starting", "recording", "processing"] as const) {
      expect(shouldOpenMicrophonePreview("onboarding", 1, "General", status)).toBe(false);
      expect(shouldOpenMicrophonePreview("settings", 0, "Audio", status)).toBe(false);
    }
  });
});

describe("shortcut recording", () => {
  it("records modifier combinations and preserves named keys for native validation", () => {
    expect(shortcutFromKeyboardEvent({ key: "v", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe("Ctrl+Shift+V");
    expect(shortcutFromKeyboardEvent({ key: " ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: true })).toBe("Super+Space");
    expect(shortcutFromKeyboardEvent({ key: "ArrowUp", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe("Ctrl+ArrowUp");
  });
  it("does not accept unmodified typing, shift-only typing or a bare modifier", () => {
    expect(shortcutFromKeyboardEvent({ key: "a", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBeNull();
    expect(shortcutFromKeyboardEvent({ key: "A", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toBeNull();
    expect(shortcutFromKeyboardEvent({ key: "Control", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBeNull();
  });
});


describe("dictation-only product", () => {
  it("offers one cursor path and no assistant, enhancement or appearance controls", () => {
    for (const requestedSection of ["General", "Audio", "Output", "Hotkeys", "Updates", "Advanced"] as const) {
      const markup = renderPanel({ surface: "settings", requestedSection });
      for (const retired of ["OpenClaw", "Ask local", "Realtime", "Live cursor mode", "Transcript enhancement", "Appearance", "Integrations"]) expect(markup).not.toContain(retired);
    }
    const output = renderPanel({ surface: "settings", requestedSection: "Output" });
    expect(output).toContain("Direct to your cursor");
    expect(output).toContain("never presses Enter");
    expect(output).not.toContain("<select");
  });
  it("provides a dedicated accessible window move surface", () => {
    expect(renderPanel({ surface: "settings" })).toContain('aria-label="Move VOCO window"');
  });
});
