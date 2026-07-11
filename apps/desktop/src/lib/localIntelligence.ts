import type { AppConfig } from "@/types";
import {
  askLocalLlmAgent,
  enhanceTranscript,
  showNotification,
} from "@/lib/tauri";

type Notify = (summary: string, body: string) => Promise<void>;

export interface LocalIntelligenceDeps {
  enhanceTranscript: typeof enhanceTranscript;
  askLocalLlmAgent: typeof askLocalLlmAgent;
  showNotification: Notify;
}

export interface TranscriptEnhancementOutcome {
  text: string;
  usedEnhancement: boolean;
  warning: string | null;
}

const DEFAULT_DEPS: LocalIntelligenceDeps = {
  enhanceTranscript,
  askLocalLlmAgent,
  showNotification,
};

export async function enhanceTranscriptForDictation(
  transcript: string,
  config: AppConfig | null,
  deps: LocalIntelligenceDeps = DEFAULT_DEPS,
): Promise<TranscriptEnhancementOutcome> {
  if (!config || config.transcriptEnhancement === "off") {
    return {
      text: transcript,
      usedEnhancement: false,
      warning: null,
    };
  }

  try {
    const enhancement = await deps.enhanceTranscript(
      transcript,
      config.transcriptEnhancement,
      config.localLlmEndpoint,
      config.localLlmModel,
    );
    const text = enhancement.text.trim().length > 0 ? enhancement.text : transcript;
    if (enhancement.warning) {
      await deps
        .showNotification(
          "Local enhancement skipped",
          "VOCO used the raw transcript because the local model was unavailable.",
        )
        .catch(() => {});
    }

    return {
      text,
      usedEnhancement: enhancement.usedEnhancement,
      warning: enhancement.warning,
    };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    await deps
      .showNotification(
        "Local enhancement failed",
        "VOCO used the raw transcript and continued dictation.",
      )
      .catch(() => {});

    return {
      text: transcript,
      usedEnhancement: false,
      warning,
    };
  }
}

export async function askLocalAssistantForDictation(
  transcript: string,
  config: AppConfig,
  deps: LocalIntelligenceDeps = DEFAULT_DEPS,
): Promise<string> {
  const result = await deps.askLocalLlmAgent(
    transcript,
    config.localLlmEndpoint,
    config.localLlmModel,
  );
  return result.response;
}
