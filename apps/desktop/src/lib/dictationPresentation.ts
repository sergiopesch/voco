import type {
  AppSurface,
  CursorDeliveryState,
  DictationStatus,
  LiveCursorMode,
  MicrophonePermission,
  OwnedPreeditStatus,
  RealtimeStatus,
  TranscriptEnhancement,
  TranscriptTarget,
} from "@/types";

interface StatusLabelInput {
  configurationError: boolean;
  cursorDeliveryState: CursorDeliveryState;
  cursorRequired: boolean;
  cursorSetupState: OwnedPreeditStatus["setupState"];
  dictationStatus: DictationStatus;
  isRealtimeActive: boolean;
  microphonePermission: MicrophonePermission;
  microphoneReady: boolean;
  realtimeMuted: boolean;
  realtimeStatus: RealtimeStatus;
}

export function deriveStatusLabel({
  configurationError,
  cursorDeliveryState,
  cursorRequired,
  cursorSetupState,
  dictationStatus,
  isRealtimeActive,
  microphonePermission,
  microphoneReady,
  realtimeMuted,
  realtimeStatus,
}: StatusLabelInput): string {
  if (dictationStatus === "recording") {
    if (cursorDeliveryState === "pending") {
      return "Listening — preparing live cursor";
    }
    return cursorDeliveryState === "preview-only"
      ? "Listening — preview only"
      : "Listening";
  }
  if (dictationStatus === "processing") {
    return "Processing";
  }
  if (isRealtimeActive) {
    if (realtimeMuted) {
      return "Realtime voice is muted";
    }
    if (realtimeStatus === "connecting") {
      return "Connecting realtime voice";
    }
    return realtimeStatus === "speaking"
      ? "Realtime voice is speaking"
      : "Realtime voice is listening";
  }
  if (cursorDeliveryState === "unreconciled") {
    return "Transcript needs attention";
  }
  if (configurationError) {
    return "Settings need attention";
  }
  if (dictationStatus === "error") {
    return "Needs attention";
  }
  if (realtimeStatus === "error") {
    return "Realtime voice needs attention";
  }
  if (microphonePermission === "denied") {
    return "Microphone needs permission";
  }
  if (cursorRequired && cursorSetupState !== "ready") {
    return "Live cursor needs setup — preview fallback available";
  }
  if (!microphoneReady) {
    return "Ready — microphone checks on first use";
  }
  return "Ready to listen";
}

export function shouldShowDictationOverlay(
  surface: AppSurface,
  status: DictationStatus,
  transcriptTarget: TranscriptTarget | null | undefined,
  liveCursorMode: LiveCursorMode | null | undefined,
  transcriptEnhancement: TranscriptEnhancement | null | undefined,
  cursorDeliveryState?: CursorDeliveryState,
): boolean {
  const streamsAtCursor =
    transcriptTarget === "cursor" &&
    liveCursorMode === "stable-cursor-streaming" &&
    transcriptEnhancement === "off" &&
    (cursorDeliveryState === undefined ||
      cursorDeliveryState === "pending" ||
      cursorDeliveryState === "owned");

  return (
    surface === "hidden" &&
    !streamsAtCursor &&
    (status === "recording" || status === "processing")
  );
}
