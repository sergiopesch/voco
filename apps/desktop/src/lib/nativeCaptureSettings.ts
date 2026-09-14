import { invoke } from "@tauri-apps/api/core";

export type CaptureBackendMode = "pending" | "webkit" | "native";

export interface NativeCaptureSource {
  selectionToken: string;
  name: string;
  label: string;
  index: number;
  objectSerial: string | null;
  isMonitor: boolean;
}

export interface NativeCaptureSourceList {
  revision: string;
  sources: NativeCaptureSource[];
  defaultSelectionToken: string | null;
}

function checkedSource(value: unknown): NativeCaptureSource {
  if (!value || typeof value !== "object") throw new Error("Invalid native microphone response.");
  const source = value as NativeCaptureSource;
  if (typeof source.selectionToken !== "string" || !source.selectionToken ||
      typeof source.name !== "string" || !source.name || typeof source.label !== "string" ||
      !Number.isSafeInteger(source.index) || source.index < 0 ||
      (source.objectSerial !== null && typeof source.objectSerial !== "string") ||
      typeof source.isMonitor !== "boolean") {
    throw new Error("Invalid native microphone identity.");
  }
  return source;
}

export async function nativeCaptureEnabled(): Promise<boolean> {
  const result = await invoke<unknown>("native_capture_capabilities");
  if (!result || typeof result !== "object" || !("enabled" in result) ||
      typeof result.enabled !== "boolean") throw new Error("Capture backend could not be verified.");
  return result.enabled;
}

export async function listNativeCaptureSources(): Promise<NativeCaptureSourceList> {
  const result = await invoke<NativeCaptureSourceList>("native_capture_list_sources");
  if (!result || typeof result.revision !== "string" || !Array.isArray(result.sources) ||
      result.sources.length > 256 ||
      (result.defaultSelectionToken !== null && typeof result.defaultSelectionToken !== "string")) {
    throw new Error("Invalid native microphone list.");
  }
  const sources = result.sources.map(checkedSource);
  if (new Set(sources.map((source) => source.selectionToken)).size !== sources.length ||
      (result.defaultSelectionToken !== null &&
       !sources.some((source) => source.selectionToken === result.defaultSelectionToken))) {
    throw new Error("Native microphone list contains conflicting identities.");
  }
  return { ...result, sources };
}

export async function selectNativeCaptureSource(selectionToken: string): Promise<NativeCaptureSource> {
  const source = checkedSource(await invoke<unknown>("native_capture_select_source", {
    selectionToken,
    acknowledged: true,
  }));
  if (source.selectionToken !== selectionToken) throw new Error("Native microphone selection changed.");
  return source;
}
