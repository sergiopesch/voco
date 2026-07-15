import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ControlPanel,
  shouldOpenMicrophonePreview,
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
      onRequestMicrophoneAccess={asyncNoop}
      onCheckForUpdates={asyncNoop}
      onOpenReleasePage={asyncNoop}
      onRefreshRuntimeDiagnostics={asyncNoop}
      onOpenSettings={asyncNoop}
      onToggleRealtime={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ControlPanel", () => {
  it("keeps popover dictation focus-safe and names the microphone clearly", () => {
    const markup = renderPanel();
    expect(markup).toContain("focus a text field");
    expect(markup).toContain("Alt+D");
    expect(markup).toContain("Microphone: System default");
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
    expect(markup).toContain("Latest transcript available to recover");
    expect(markup).toContain("A final transcript whose selected output failed.");
    expect(markup).toContain("Copy transcript");
  });

  it("renders a compact, actionable settings navigation", () => {
    const markup = renderPanel({ surface: "settings" });
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Advanced");
    expect(markup).not.toContain(">Appearance<");
    expect(markup).not.toContain("Accent-aware recognition is planned");
  });

  it("explains the fail-closed live-cursor target boundary", () => {
    const settingsMarkup = renderPanel({
      surface: "settings",
      requestedSection: "Output",
    });
    expect(settingsMarkup).toContain("current field freshly confirms");
    expect(settingsMarkup).toContain("terminals and sensitive or unverified fields");
    expect(settingsMarkup).toContain("VOCO preview everywhere else");

    const onboardingMarkup = renderPanel({
      surface: "onboarding",
      onboardingStep: 2,
    });
    expect(onboardingMarkup).toContain("Terminals, password/PIN fields");
    expect(onboardingMarkup).toContain("intentionally preview-only");
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

    expect(markup).toContain("<h2>Audio</h2>");
    expect(markup).toContain("Stop realtime to change microphone");
    expect(markup).toMatch(/<select[^>]*disabled=""/);
  });

  it("disables a new realtime session when runtime activation is blocked", () => {
    const markup = renderPanel({ realtimeActivationAllowed: false });
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Start realtime<\/button>/);
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
