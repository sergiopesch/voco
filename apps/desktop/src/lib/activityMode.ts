import type {
  DictationStatus,
  MicrophonePermission,
} from "@/types";


export function isDictationActive(status: DictationStatus): boolean {
  return status === "starting" || status === "recording" || status === "processing";
}

export function canToggleDictationWithPermission(
  status: DictationStatus,
  permission: MicrophonePermission,
): boolean {
  const dictationActive = isDictationActive(status);
  return dictationActive || permission !== "denied";
}
