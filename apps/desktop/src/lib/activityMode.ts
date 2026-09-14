import type {
  DictationStatus,
  MicrophonePermission,
  RealtimeStatus,
} from "@/types";

export type ActivityMode = "idle" | "dictation" | "realtime";

export function isDictationActive(status: DictationStatus): boolean {
  return status === "starting" || status === "recording" || status === "processing";
}

export function canActivateMode(
  current: ActivityMode,
  requested: Exclude<ActivityMode, "idle">,
): boolean {
  return current === "idle" || current === requested;
}

export function canToggleDictationWithPermission(
  status: DictationStatus,
  permission: MicrophonePermission,
): boolean {
  const dictationActive = isDictationActive(status);
  return dictationActive || permission !== "denied";
}

export function deriveActivityMode(
  dictationStatus: DictationStatus,
  realtimeStatus: RealtimeStatus,
): ActivityMode {
  if (isDictationActive(dictationStatus)) {
    return "dictation";
  }
  if (realtimeStatus !== "idle" && realtimeStatus !== "error") {
    return "realtime";
  }
  return "idle";
}
