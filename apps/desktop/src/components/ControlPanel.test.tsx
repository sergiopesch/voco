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
  openclawAgent: "main",
  openclawPromptPrefix: "Answer accurately.",
  transcriptEnhancement: "off",
  localLlmEndpoint: "http://127.0.0.1:8080/v1/chat/completions",
  localLlmModel: null,
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
      isRealtimeActive={false}
      isRealtimeMuted={false}
      realtimeActivationAllowed={true}
      realtimeStatus="idle"
      realtimeDetail="Ready"
      realtimeError={null}
      realtimeLevel={0}
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
      onToggleRealtime={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Silver Lens output guidance", () => {
  it("keeps spoken answers free of text-field instructions", () => {
    const markup = renderPanel({ config: { ...config, transcriptTarget: "openclaw-speech" } });
    expect(markup).toContain("OpenClaw spoken response");
    expect(markup).toContain("Hide, then press your shortcut to speak.");
    expect(markup).not.toContain("focus a text field");
  });
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
    expect(markup).toContain("focus a plain text field");
    expect(markup).toContain("Alt+Shift+V");
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
    expect(markup).toContain("focus a plain text field");
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
    expect(markup).toContain(">Appearance<");
    expect(markup).toContain('aria-label="App settings"');
    expect(markup).not.toContain("Accent-aware recognition is planned");
  });

  it("explains the fail-closed live-cursor target boundary", () => {
    const settingsMarkup = renderPanel({
      surface: "settings",
      requestedSection: "Output",
    });
    expect(settingsMarkup).toContain("authorizes the exact supported field");
    expect(settingsMarkup).toContain("Moving focus or editing the field ends automatic delivery");
    expect(settingsMarkup).toContain("a transcript for Copy elsewhere");

    const onboardingMarkup = renderPanel({
      surface: "onboarding",
      onboardingStep: 2,
    });
    expect(onboardingMarkup).toContain("Passwords and rich editors are unsupported");
    expect(onboardingMarkup).toContain("It does not insert text");
  });

  it("renders muted realtime as inactive while retaining the stop action", () => {
    const markup = renderPanel({
      statusLabel: "Realtime voice is muted",
      isRealtimeActive: true,
      isRealtimeMuted: true,
      realtimeActivationAllowed: false,
      realtimeStatus: "listening",
      realtimeDetail: "Muted. Press the mic button to speak again.",
      realtimeLevel: 0.9,
    });

    expect(markup).toContain("Realtime voice is muted");
    expect(markup).toContain('data-active="false"');
    expect(markup).toContain("Stop realtime");
    expect(markup).toContain("Realtime: Muted");
    expect(markup).not.toContain(">Start realtime<");
  });

  it("disables microphone changes and preview controls during realtime", () => {
    const markup = renderPanel({
      surface: "onboarding",
      onboardingStep: 1,
      isRealtimeActive: true,
      realtimeStatus: "listening",
    });

    expect(markup).toContain("Stop realtime to change microphone");
    expect(markup).toContain("Audio preview is paused");
    expect(markup).toMatch(/<select[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Retry microphone access<\/button>/);
  });

  it("keeps the Audio settings visible but locked while realtime owns the mic", () => {
    const markup = renderPanel({
      surface: "settings",
      requestedSection: "Audio",
      isRealtimeActive: true,
      realtimeStatus: "listening",
    });

    expect(markup).toContain('<h2 tabindex="-1">Microphone</h2>');
    expect(markup).toContain("Stop realtime to change microphone");
    expect(markup).toMatch(/<select[^>]*disabled=""/);
  });

  it("disables a new realtime session when runtime activation is blocked", () => {
    const markup = renderPanel({ realtimeActivationAllowed: false });
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Start realtime<\/button>/);
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

  it("associates output choices with their consequence descriptions", () => {
    const markup = renderPanel({ surface: "settings", requestedSection: "Output" });
    const describedSelects = [...markup.matchAll(/<select[^>]*aria-describedby="([^"]+)"/g)];
    expect(describedSelects).toHaveLength(3);
    for (const match of describedSelects) {
      expect(match[1]).toBeTruthy();
      for (const id of (match[1] ?? "").split(" ")) expect(markup).toContain(`id="${id}"`);
    }
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
    for (const requestedSection of ["General", "Appearance"] as const) {
      const markup = renderPanel({ surface: "settings", requestedSection });
      expect(markup).toContain('data-visual-effects="full"');
      expect(markup).not.toContain('role="switch"');
      expect(markup).not.toContain("Glass effects");
      expect(markup).toContain("Reduce motion");
      expect(markup).toContain("System setting");
      expect(markup).toContain(">On</span>");
    }
    expect(getItem).not.toHaveBeenCalled();
    expect(renderPanel({ surface: "popover" })).not.toContain("Reduce visual effects");
  });

  it("does not invent a system motion preference when it cannot be read", () => {
    const markup = renderPanel({ surface: "settings", requestedSection: "Appearance" });
    expect(markup).toContain(">Unavailable</span>");
    expect(markup).toContain("microphone sound meter remains active");
  });

  it("retains explicit group save controls and keeps setup restart in Troubleshooting", () => {
    const integrations = renderPanel({ surface: "settings", requestedSection: "Integrations" });
    expect(integrations).toMatch(/<button[^>]*disabled=""[^>]*>Save local model settings<\/button>/);
    expect(integrations).toMatch(/<button[^>]*disabled=""[^>]*>Save OpenClaw settings<\/button>/);
    expect(integrations).not.toContain("Choices save automatically");
    expect(integrations).not.toContain("Re-run onboarding");
    expect(renderPanel({ surface: "settings", requestedSection: "Advanced" })).toContain("Re-run onboarding");
  });

  it.each(["General", "Audio", "Output", "Hotkeys", "Appearance", "Integrations", "Updates", "Advanced"] as const)("keeps Hide to tray available in %s", (requestedSection) => {
    const markup = renderPanel({ surface: "settings", requestedSection });
    expect(markup.match(/>Hide to tray</g)).toHaveLength(1);
  });
});

describe("microphone preview gating", () => {
  it("never opens a second preview while realtime owns the microphone", () => {
    expect(shouldOpenMicrophonePreview("onboarding", 1, "General", true)).toBe(false);
    expect(shouldOpenMicrophonePreview("settings", 0, "Audio", true)).toBe(false);
  });

  it("opens only on the inactive onboarding or Audio surfaces", () => {
    expect(shouldOpenMicrophonePreview("onboarding", 1, "General", false)).toBe(true);
    expect(shouldOpenMicrophonePreview("settings", 0, "Audio", false)).toBe(true);
    expect(shouldOpenMicrophonePreview("settings", 0, "General", false)).toBe(false);
    expect(shouldOpenMicrophonePreview("popover", 0, "Audio", false)).toBe(false);
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

  it("keeps optional integration fields out of normal dictation settings", () => {
    const output = renderPanel({ surface: "settings", requestedSection: "Output" });
    expect(output).not.toContain("Local model endpoint");
    expect(output).not.toContain("OpenClaw instruction prefix");
    expect(output).toContain("Configure optional integrations");
    const integrations = renderPanel({ surface: "settings", requestedSection: "Integrations" });
    expect(integrations).toContain("Local model endpoint");
    expect(integrations).toContain("OpenClaw instruction prefix");
    expect(integrations).toContain("Normal dictation does not need an assistant");
  });

  it("puts dictation first and explains the separate realtime audio flow", () => {
    const markup = renderPanel();
    expect(markup.indexOf("Hide to dictate")).toBeLessThan(markup.indexOf("Realtime conversation · optional"));
    expect(markup).toContain("Streams microphone audio to OpenAI while active");
    expect(markup).toContain("Wait for Listening");
    const starting = renderPanel({ dictationStatus: "starting", statusLabel: "Starting microphone" });
    expect(starting).toMatch(/<button[^>]*disabled=""[^>]*>Hide to dictate<\/button>/);
    expect(starting).toMatch(/<button[^>]*disabled=""[^>]*>Start realtime<\/button>/);
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
      expect(shouldOpenMicrophonePreview("onboarding", 1, "General", false, status)).toBe(false);
      expect(shouldOpenMicrophonePreview("settings", 0, "Audio", false, status)).toBe(false);
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
