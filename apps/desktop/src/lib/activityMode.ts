import type {
  DictationStatus,
  MicrophonePermission,
  RealtimeStatus,
} from "@/types";

export type ActivityMode = "idle" | "dictation" | "realtime";

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
  const dictationActive = status === "recording" || status === "processing";
  return dictationActive || permission !== "denied";
}

export function deriveActivityMode(
  dictationStatus: DictationStatus,
  realtimeStatus: RealtimeStatus,
): ActivityMode {
  if (dictationStatus === "recording" || dictationStatus === "processing") {
    return "dictation";
  }
  if (realtimeStatus !== "idle" && realtimeStatus !== "error") {
    return "realtime";
  }
  return "idle";
}
