import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, PlatformInfo } from "@/types";

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("get_platform_info");
}

export async function transcribeAudio(samples: Float32Array): Promise<string> {
  // Send audio as base64-encoded little-endian f32 bytes instead of a JSON number array.
  // This is ~60% smaller and orders of magnitude faster to serialize/deserialize.
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const audioBase64 = btoa(binary);
  return invoke<string>("transcribe_audio", { audioBase64 });
}

export interface InsertResult {
  strategy: string;
  success: boolean;
}

export async function insertText(
  text: string,
  strategy: string,
): Promise<InsertResult> {
  return invoke<InsertResult>("insert_text", { text, strategy });
}

export async function setRecordingState(recording: boolean): Promise<void> {
  return invoke("set_recording_state", { recording });
}

export async function showNotification(
  summary: string,
  body: string,
): Promise<void> {
  return invoke("show_notification", { summary, body });
}
