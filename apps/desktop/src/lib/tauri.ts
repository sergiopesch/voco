import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  CachedUpdateCheck,
  DictationStatus,
  DebugDictationCaptureResult,
  InsertionResult,
  LocalLlmAgentResult,
  LocalLlmTestResult,
  OpenClawAgentResult,
  OpenClawBrowserActionInput,
  OpenClawBrowserActionResult,
  OpenClawSpeechResult,
  OwnedPreeditStatus,
  PreviewTranscription,
  RealtimeClientSecretResult,
  RuntimeDiagnostics,
  TranscriptEnhancement,
  TranscriptEnhancementResult,
} from "@/types";

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export async function transcribeAudio(samples: Float32Array): Promise<string> {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  return invoke<string>("transcribe_audio", { audioBytes: bytes });
}

export async function previewTranscribeAudio(
  samples: Float32Array,
): Promise<PreviewTranscription | null> {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  return invoke<PreviewTranscription | null>("preview_transcribe_audio", {
    audioBytes: bytes,
  });
}

export async function debugDictationCaptureEnabled(): Promise<boolean> {
  return invoke<boolean>("debug_dictation_capture_enabled");
}

export async function saveDebugDictationCapture(
  samples: Float32Array,
  timeline: unknown,
): Promise<DebugDictationCaptureResult | null> {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  return invoke<DebugDictationCaptureResult | null>(
    "save_debug_dictation_capture",
    { audioBytes: bytes, timeline },
  );
}

export async function insertText(text: string, strategy: string): Promise<InsertionResult> {
  return invoke<InsertionResult>("insert_text", { text, strategy });
}

export async function getOwnedPreeditStatus(): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("get_owned_preedit_status");
}

export async function startOwnedPreedit(sessionId: number): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("start_owned_preedit", { sessionId });
}

export async function updateOwnedPreedit(
  sessionId: number,
  confirmedText: string,
  preeditText: string,
  provisionalText: string,
): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("update_owned_preedit", {
    sessionId,
    confirmedText,
    preeditText,
    provisionalText,
  });
}

export async function commitOwnedPreedit(
  sessionId: number,
  text: string,
): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("commit_owned_preedit", { sessionId, text });
}

export async function cancelOwnedPreedit(sessionId: number): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("cancel_owned_preedit", { sessionId });
}

export async function askOpenClawAgent(
  transcript: string,
  agent: string,
  promptPrefix: string,
): Promise<OpenClawAgentResult> {
  return invoke<OpenClawAgentResult>("ask_openclaw_agent", {
    transcript,
    agent,
    promptPrefix,
  });
}

export async function speakOpenClawResponse(text: string): Promise<OpenClawSpeechResult> {
  return invoke<OpenClawSpeechResult>("speak_openclaw_response", { text });
}

export async function enhanceTranscript(
  transcript: string,
  mode: TranscriptEnhancement,
  endpoint: string,
  model: string | null,
): Promise<TranscriptEnhancementResult> {
  return invoke<TranscriptEnhancementResult>("enhance_transcript", {
    transcript,
    mode,
    endpoint,
    model,
  });
}

export async function testLocalLlm(
  endpoint: string,
  model: string | null,
): Promise<LocalLlmTestResult> {
  return invoke<LocalLlmTestResult>("test_local_llm", { endpoint, model });
}

export async function askLocalLlmAgent(
  transcript: string,
  endpoint: string,
  model: string | null,
): Promise<LocalLlmAgentResult> {
  return invoke<LocalLlmAgentResult>("ask_local_llm_agent", {
    transcript,
    endpoint,
    model,
  });
}

export async function invokeOpenClawBrowserAction(
  request: OpenClawBrowserActionInput,
): Promise<OpenClawBrowserActionResult> {
  return invoke<OpenClawBrowserActionResult>("invoke_openclaw_browser_action", { request });
}

export async function createRealtimeClientSecret(): Promise<RealtimeClientSecretResult> {
  return invoke<RealtimeClientSecretResult>("create_realtime_client_secret");
}

export async function setDictationStatus(status: DictationStatus): Promise<void> {
  return invoke("set_dictation_status", { status });
}

export async function setMicrophoneReady(ready: boolean): Promise<void> {
  return invoke("set_microphone_ready", { ready });
}

export interface HotkeyTraceFields {
  audioLevelBucket?: "silent" | "low" | "medium" | "high";
  chunkCount?: number;
  responseDeltaCount?: number;
  selectedDeviceConfigured?: boolean;
  trackSampleRate?: number;
  trackChannelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  browserAction?: string;
  durationMs?: number;
  dictationSessionId?: number;
}

export async function traceHotkeyEvent(
  event: string,
  fields: HotkeyTraceFields | null = null,
): Promise<void> {
  return invoke("trace_frontend_hotkey_event", { event, fields });
}

export async function hasPendingHotkeyToggle(): Promise<boolean> {
  return invoke<boolean>("has_pending_hotkey_toggle");
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

export async function getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
  return invoke<RuntimeDiagnostics>("get_runtime_diagnostics");
}
