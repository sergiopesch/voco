import type {
  AppSurface,
  DictationStatus,
  LiveCursorMode,
  TranscriptTarget,
} from "@/types";

export function shouldShowDictationOverlay(
  surface: AppSurface,
  status: DictationStatus,
  transcriptTarget: TranscriptTarget | null | undefined,
  liveCursorMode: LiveCursorMode | null | undefined,
): boolean {
  const streamsAtCursor =
    transcriptTarget === "cursor" &&
    liveCursorMode === "stable-cursor-streaming";

  return (
    surface === "hidden" &&
    !streamsAtCursor &&
    (status === "recording" || status === "processing")
  );
}
