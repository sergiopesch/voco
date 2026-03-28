import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/useStore";

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
    };
    useStore.getState().setConfig(config);
    expect(useStore.getState().config).toEqual(config);
  });
});
