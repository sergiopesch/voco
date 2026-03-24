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

export interface ModelStatus {
  downloaded: boolean;
  path: string;
  sizeMb: number;
}

export async function getModelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("get_model_status");
}

export async function downloadModel(): Promise<string> {
  return invoke<string>("download_model");
}

export async function transcribeAudio(samples: number[]): Promise<string> {
  return invoke<string>("transcribe_audio", { samples });
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
