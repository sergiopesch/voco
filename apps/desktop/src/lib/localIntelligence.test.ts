import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askLocalAssistantForDictation,
  enhanceTranscriptForDictation,
} from "@/lib/localIntelligence";
import * as tauri from "@/lib/tauri";
import type { AppConfig } from "@/types";

vi.mock("@/lib/tauri", () => ({
  enhanceTranscript: vi.fn(),
  askLocalLlmAgent: vi.fn(),
  showNotification: vi.fn(),
}));

const BASE_CONFIG: AppConfig = {
  hotkey: "Alt+D",
  selectedMic: null,
  insertionStrategy: "auto",
  transcriptTarget: "cursor",
  liveCursorMode: "stable-cursor-streaming",
  openclawAgent: "main",
  openclawPromptPrefix: "Teach safely.",
  transcriptEnhancement: "conservative",
  localLlmEndpoint: "http://127.0.0.1:8080/v1/chat/completions",
  localLlmModel: "gemma-local",
  onboardingCompleted: true,
  updateChannel: "stable",
  installChannel: "github-release",
  voiceProfile: "default",
};

describe("local dictation intelligence", () => {
  beforeEach(() => {
    vi.mocked(tauri.enhanceTranscript).mockReset();
    vi.mocked(tauri.askLocalLlmAgent).mockReset();
    vi.mocked(tauri.showNotification).mockReset();
    vi.mocked(tauri.showNotification).mockResolvedValue();
  });

  it("leaves dictation untouched when enhancement is off", async () => {
    const result = await enhanceTranscriptForDictation("raw transcript", {
      ...BASE_CONFIG,
      transcriptEnhancement: "off",
    });

    expect(result).toEqual({
      text: "raw transcript",
      usedEnhancement: false,
      warning: null,
    });
    expect(tauri.enhanceTranscript).not.toHaveBeenCalled();
  });

  it("uses enhanced text when the localhost model succeeds", async () => {
    vi.mocked(tauri.enhanceTranscript).mockResolvedValue({
      text: "Hello, world.",
      usedEnhancement: true,
      warning: null,
    });

    const result = await enhanceTranscriptForDictation("hello world", BASE_CONFIG);

    expect(result.text).toBe("Hello, world.");
    expect(result.usedEnhancement).toBe(true);
    expect(tauri.enhanceTranscript).toHaveBeenCalledWith(
      "hello world",
      "conservative",
      "http://127.0.0.1:8080/v1/chat/completions",
      "gemma-local",
    );
  });

  it("falls back to raw dictation when enhancement rejects", async () => {
    vi.mocked(tauri.enhanceTranscript).mockRejectedValue(
      new Error("connection refused"),
    );

    const result = await enhanceTranscriptForDictation("raw transcript", BASE_CONFIG);

    expect(result.text).toBe("raw transcript");
    expect(result.usedEnhancement).toBe(false);
    expect(result.warning).toBe("connection refused");
    expect(tauri.showNotification).toHaveBeenCalledWith(
      "Local enhancement failed",
      "VOCO used the raw transcript and continued dictation.",
    );
  });

  it("falls back to raw dictation when enhancement returns empty text", async () => {
    vi.mocked(tauri.enhanceTranscript).mockResolvedValue({
      text: "",
      usedEnhancement: false,
      warning: "Local model returned no text",
    });

    const result = await enhanceTranscriptForDictation("raw transcript", BASE_CONFIG);

    expect(result.text).toBe("raw transcript");
    expect(result.warning).toBe("Local model returned no text");
    expect(tauri.showNotification).toHaveBeenCalledWith(
      "Local enhancement skipped",
      "VOCO used the raw transcript because the local model was unavailable.",
    );
  });

  it("returns the local assistant answer from the same localhost provider settings", async () => {
    vi.mocked(tauri.askLocalLlmAgent).mockResolvedValue({
      response: "A concise local answer.",
    });

    const response = await askLocalAssistantForDictation("answer this", BASE_CONFIG);

    expect(response).toBe("A concise local answer.");
    expect(tauri.askLocalLlmAgent).toHaveBeenCalledWith(
      "answer this",
      "http://127.0.0.1:8080/v1/chat/completions",
      "gemma-local",
    );
  });

  it("propagates local assistant failures so callers cannot insert stale output", async () => {
    vi.mocked(tauri.askLocalLlmAgent).mockRejectedValue(
      new Error("local model unavailable"),
    );

    await expect(
      askLocalAssistantForDictation("answer this", BASE_CONFIG),
    ).rejects.toThrow("local model unavailable");
  });
});
