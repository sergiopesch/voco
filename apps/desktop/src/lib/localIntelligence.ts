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
    // A successful deterministic "scratch that" can intentionally clear the text.
    // Any failed enhancement must recover the original recognition, even if a
    // partial transformation was returned by an older backend.
    const intentionalEmpty = enhancement.usedEnhancement && !enhancement.warning;
    const text = enhancement.warning
      ? transcript
      : enhancement.text.trim().length > 0 || intentionalEmpty
        ? enhancement.text
        : transcript;
    if (enhancement.warning) {
      await deps
        .showNotification(
          "Local enhancement skipped",
          "VOCO used the raw transcript because local enhancement did not complete.",
        )
        .catch(() => {});
    }

    return {
      text,
      usedEnhancement: enhancement.warning ? false : enhancement.usedEnhancement,
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
