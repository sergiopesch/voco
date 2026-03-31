import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "@/types";

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
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

export async function setRecordingState(recording: boolean): Promise<void> {
  return invoke("set_recording_state", { recording });
}

export async function setMicrophoneReady(ready: boolean): Promise<void> {
  return invoke("set_microphone_ready", { ready });
}

export async function showStatusOverlay(
  width: number,
  height: number,
): Promise<void> {
  return invoke("show_status_overlay", { width, height });
}

export async function hideStatusOverlay(): Promise<void> {
  return invoke("hide_status_overlay");
}

export async function showNotification(summary: string, body: string): Promise<void> {
  return invoke("show_notification", { summary, body });
}
