import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, CachedUpdateCheck, DictationStatus } from "@/types";

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export async function transcribeAudio(samples: Float32Array): Promise<string> {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return invoke<string>("transcribe_audio", { audioBase64: btoa(binary) });
}

export async function insertText(text: string, strategy: string): Promise<void> {
  await invoke("insert_text", { text, strategy });
}

export async function setDictationStatus(status: DictationStatus): Promise<void> {
  return invoke("set_dictation_status", { status });
}

export async function setMicrophoneReady(ready: boolean): Promise<void> {
  return invoke("set_microphone_ready", { ready });
}

export async function showStatusOverlay(width: number, height: number): Promise<void> {
  return invoke("show_status_overlay", { width, height });
}

export async function hideStatusOverlay(): Promise<void> {
  return invoke("hide_status_overlay");
}

export async function showNotification(summary: string, body: string): Promise<void> {
  return invoke("show_notification", { summary, body });
}

export async function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

export async function loadCachedUpdateState(): Promise<CachedUpdateCheck | null> {
  return invoke<CachedUpdateCheck | null>("load_cached_update_state");
}

export async function saveCachedUpdateState(cache: CachedUpdateCheck): Promise<void> {
  return invoke("save_cached_update_state", { cache });
}
