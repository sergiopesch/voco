import type {
  AppConfig,
  LiveCursorMode,
  TranscriptEnhancement,
  TranscriptTarget,
} from "@/types";

export interface DictationOutputSettings {
  transcriptTarget: TranscriptTarget;
  liveCursorMode: LiveCursorMode;
  transcriptEnhancement: TranscriptEnhancement;
}

export type CursorDeliveryPlan =
  | "canonical-owned-preedit"
  | "one-shot-final"
  | "not-cursor";

export function usesCanonicalCursorStreaming(
  config: Pick<
    AppConfig,
    "transcriptTarget" | "liveCursorMode" | "transcriptEnhancement"
  > | null | undefined,
): boolean {
  return (
    config?.transcriptTarget === "cursor" &&
    config.liveCursorMode === "stable-cursor-streaming" &&
    config.transcriptEnhancement === "off"
  );
}

export function cursorDeliveryPlan(
  config: DictationOutputSettings,
): CursorDeliveryPlan {
  if (config.transcriptTarget !== "cursor") {
    return "not-cursor";
  }
  return usesCanonicalCursorStreaming(config)
    ? "canonical-owned-preedit"
    : "one-shot-final";
}

export function keepsLivePreviewInVoco(
  config: DictationOutputSettings | null | undefined,
): boolean {
  return (
    config?.transcriptTarget === "cursor" &&
    config.liveCursorMode !== "final-text-only" &&
    !usesCanonicalCursorStreaming(config)
  );
}
