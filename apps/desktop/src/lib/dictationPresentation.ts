import type {
  CursorSetupState,
  DictationStatus,
  MicrophonePermission,
} from "@/types";

interface StatusLabelInput {
  configurationError: boolean;
  hasRecovery?: boolean;
  cursorRequired: boolean;
  cursorSetupState: CursorSetupState;
  dictationStatus: DictationStatus;
  microphonePermission: MicrophonePermission;
  nativeMicrophoneReady?: boolean | null;
  microphoneReady: boolean;
}

/** Desktop input setup for the tray: "" until the first diagnostics load, which the
 * tray presents as initializing. A failed launch check reports not enabled. */
export function deriveCursorSetupState({
  desktopInputReady,
  diagnosticsLoaded,
  diagnosticsFailed,
}: {
  desktopInputReady: boolean;
  diagnosticsLoaded: boolean;
  diagnosticsFailed: boolean;
}): CursorSetupState {
  if (desktopInputReady) return "ready";
  return diagnosticsLoaded || diagnosticsFailed ? "not-enabled" : "";
}

export function deriveStatusLabel({
  configurationError,
  hasRecovery = false,
  cursorRequired,
  cursorSetupState,
  dictationStatus,
  microphonePermission,
  nativeMicrophoneReady,
  microphoneReady,
}: StatusLabelInput): string {
  if (dictationStatus === "starting") {
    return "Starting microphone";
  }
  if (dictationStatus === "recording") {
    return "Listening";
  }
  if (dictationStatus === "processing") {
    return "Processing";
  }
  if (hasRecovery) {
    return "Dictation saved";
  }
  if (configurationError) {
    return "Settings need attention";
  }
  if (dictationStatus === "error") {
    return "Needs attention";
  }
  if (nativeMicrophoneReady === false) return "Microphone setup required";
  if (nativeMicrophoneReady == null && microphonePermission === "denied") {
    return "Microphone needs permission";
  }
  // Recording refuses to start without desktop input, so there is no copy fallback.
  // cursorRequired already means desktop input is not ready; while its diagnostics
  // are pending, mirror the tray's initializing state instead of setup needed.
  if (cursorRequired) return cursorSetupState === "" ? "Initializing…" : "Desktop setup needed";
  if (!microphoneReady) {
    return "Ready — microphone checks on first use";
  }
  return "Ready to listen";
}
