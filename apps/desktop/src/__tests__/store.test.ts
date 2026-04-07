import { describe, it, expect, beforeEach } from "vitest";
import { deriveSurfaceForConfig, useStore } from "@/store/useStore";

describe("useStore", () => {
  beforeEach(() => {
    useStore.setState({
      status: "idle",
      transcript: "",
      interimTranscript: "",
      error: null,
      selectedDeviceId: null,
      audioLevel: 0,
      config: null,
      surface: "hidden",
      onboardingStep: 0,
      availableDevices: [],
      microphonePermission: "unknown",
      updateState: {
        status: "idle",
        currentVersion: null,
        latestRelease: null,
        lastCheckedAt: null,
        error: null,
      },
    });
  });

  it("starts in idle state", () => {
    const state = useStore.getState();
    expect(state.status).toBe("idle");
    expect(state.transcript).toBe("");
    expect(state.error).toBeNull();
  });

  it("setStatus updates status and clears error", () => {
    useStore.getState().setError("some error");
    expect(useStore.getState().status).toBe("error");

    useStore.getState().setStatus("recording");
    expect(useStore.getState().status).toBe("recording");
    expect(useStore.getState().error).toBeNull();
  });

  it("setError sets error and status to error", () => {
    useStore.getState().setError("mic failed");
    expect(useStore.getState().error).toBe("mic failed");
    expect(useStore.getState().status).toBe("error");
  });

  it("setError with null clears error and sets idle", () => {
    useStore.getState().setError("something");
    useStore.getState().setError(null);
    expect(useStore.getState().error).toBeNull();
    expect(useStore.getState().status).toBe("idle");
  });

  it("setTranscript updates transcript", () => {
    useStore.getState().setTranscript("hello world");
    expect(useStore.getState().transcript).toBe("hello world");
  });

  it("clearTranscript resets both transcript fields", () => {
    useStore.getState().setTranscript("hello");
    useStore.getState().setInterimTranscript("typing...");
    useStore.getState().clearTranscript();
    expect(useStore.getState().transcript).toBe("");
    expect(useStore.getState().interimTranscript).toBe("");
  });

  it("setAudioLevel updates level", () => {
    useStore.getState().setAudioLevel(0.75);
    expect(useStore.getState().audioLevel).toBe(0.75);
  });

  it("setConfig stores config", () => {
    const config = {
      hotkey: "Alt+D",
      selectedMic: null,
      insertionStrategy: "auto" as const,
      onboardingCompleted: false,
      updateChannel: "stable" as const,
      installChannel: "github-release" as const,
      voiceProfile: "default" as const,
    };
    useStore.getState().setConfig(config);
    expect(useStore.getState().config).toEqual(config);
    expect(useStore.getState().surface).toBe("onboarding");
  });

  it("keeps the settings surface when saving an updated config", () => {
    const config = {
      hotkey: "Alt+D",
      selectedMic: null,
      insertionStrategy: "auto" as const,
      onboardingCompleted: true,
      updateChannel: "stable" as const,
      installChannel: "github-release" as const,
      voiceProfile: "default" as const,
    };

    useStore.setState({
      config,
      surface: "settings",
    });

    useStore.getState().setConfig({
      ...config,
      updateChannel: "beta",
    });

    expect(useStore.getState().surface).toBe("settings");
  });

  it("hides the window after onboarding is completed", () => {
    const previousConfig = {
      hotkey: "Alt+D",
      selectedMic: null,
      insertionStrategy: "auto" as const,
      onboardingCompleted: false,
      updateChannel: "stable" as const,
      installChannel: "github-release" as const,
      voiceProfile: "default" as const,
    };

    expect(
      deriveSurfaceForConfig("onboarding", previousConfig, {
        ...previousConfig,
        onboardingCompleted: true,
      }),
    ).toBe("hidden");
  });

  it("setUpdateState stores the latest release result", () => {
    const updateState = {
      status: "available" as const,
      currentVersion: "2026.0.6",
      latestRelease: {
        version: "2026.0.7",
        name: "VOCO 2026.0.7",
        url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.7",
        publishedAt: "2026-04-02T10:30:00Z",
        prerelease: false,
      },
      lastCheckedAt: "2026-04-02T11:00:00Z",
      error: null,
    };

    useStore.getState().setUpdateState(updateState);

    expect(useStore.getState().updateState).toEqual(updateState);
  });
});
