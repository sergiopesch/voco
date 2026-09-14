import type {
  CursorDeliveryState,
  DictationStatus,
  MicrophonePermission,
  OwnedPreeditStatus,
  RealtimeStatus,
} from "@/types";

interface StatusLabelInput {
  configurationError: boolean;
  hasRecovery?: boolean;
  manualTranscriptReady?: boolean;
  hasRecoverableTranscript?: boolean;
  cursorDeliveryState: CursorDeliveryState;
  cursorRequired: boolean;
  cursorSetupState: OwnedPreeditStatus["setupState"];
  dictationStatus: DictationStatus;
  isRealtimeActive: boolean;
  microphonePermission: MicrophonePermission;
  nativeMicrophoneReady?: boolean | null;
  microphoneReady: boolean;
  realtimeMuted: boolean;
  realtimeStatus: RealtimeStatus;
}

export function deriveStatusLabel({
  configurationError,
  hasRecovery = false,
  manualTranscriptReady = false,
  hasRecoverableTranscript = false,
  cursorDeliveryState,
  cursorRequired,
  cursorSetupState,
  dictationStatus,
  isRealtimeActive,
  microphonePermission,
  nativeMicrophoneReady,
  microphoneReady,
  realtimeMuted,
  realtimeStatus,
}: StatusLabelInput): string {
  if (dictationStatus === "starting") {
    return "Starting microphone";
  }
  if (dictationStatus === "recording") {
    if (cursorDeliveryState === "pending") {
      return "Listening — verifying original field";
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
  if (hasRecovery) {
    return manualTranscriptReady ? "Transcript ready to copy" : "Recording needs recovery";
  }
  if (cursorDeliveryState === "unreconciled") {
    return "Transcript needs attention";
  }
  if (configurationError) {
    return "Settings need attention";
  }
  if (hasRecoverableTranscript) {
    return "Transcript needs attention";
  }
  if (dictationStatus === "error") {
    return "Needs attention";
  }
  if (realtimeStatus === "error") {
    return "Realtime voice needs attention";
  }
  if (nativeMicrophoneReady === false) return "Microphone setup required";
  if (nativeMicrophoneReady == null && microphonePermission === "denied") {
    return "Microphone needs permission";
  }
  if (cursorRequired && cursorSetupState !== "ready") {
    if (cursorSetupState === "safety-disabled") return "Ready — manual copy";
    return "Text delivery needs setup — manual copy available";
  }
  if (!microphoneReady) {
    return "Ready — microphone checks on first use";
  }
  return "Ready to listen";
}
