import type {
  AppConfig,
  CachedUpdateCheck,
  ConfigSnapshot,
  DebugDictationCaptureResult,
  DesktopInputStatus,
  OwnedPreeditStatus,
  RuntimeDiagnostics,
  RuntimeStatusSnapshot
} from "@/types";
import { invoke } from "@tauri-apps/api/core";
import type { PasteCorrelation } from "./benchmarkPhraseQueue";

export async function getConfig(): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("get_config");
}

export async function reloadConfigFromDisk(): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("reload_config_from_disk");
}

export async function resetConfigToDefaults(): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("reset_config_to_defaults");
}

export async function openConfigDirectory(): Promise<void> {
  return invoke("open_config_directory");
}

export async function saveConfigPatch(
  patch: Partial<AppConfig>,
): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("save_config_patch", { patch });
}

export async function debugDictationCaptureEnabled(): Promise<boolean> {
  return invoke<boolean>("debug_dictation_capture_enabled");
}

export async function debugNativeCaptureEnabled(): Promise<boolean> {
  return invoke<boolean>("debug_native_capture_enabled");
}

export async function saveDebugNativeRetainedSource(packet: Uint8Array): Promise<string | null> {
  return invoke<string | null>("save_debug_native_retained_source", packet);
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

export async function getDesktopInputStatus(): Promise<DesktopInputStatus> {
  return invoke("get_desktop_input_status");
}

export interface PanelSetupStatus {
  status: string;
  detail: string;
  canEnable: boolean;
}
export function getPanelSetupStatus(): Promise<PanelSetupStatus> {
  return invoke("get_panel_setup_status");
}
export function enableGnomePanel(): Promise<PanelSetupStatus> {
  return invoke("enable_gnome_panel");
}
export function takeLauncherActivation(): Promise<boolean> {
  return invoke("take_launcher_activation");
}

export async function getDesktopPasteStatus(): Promise<{ enabled: boolean; available: boolean; detail: string; shortcutEpoch: number; streamingEnabled?: boolean; targetToken?: string | null; failureReason?: "setup" | "cursor" | null }> {
  return invoke("get_desktop_paste_status");
}

export async function beginDesktopShortcutSession(sessionId: string, shortcutEpoch: number): Promise<void> {
  return invoke("begin_desktop_shortcut_session", { sessionId, shortcutEpoch });
}

export async function endDesktopShortcutSession(sessionId: string): Promise<void> {
  return invoke("end_desktop_shortcut_session", { sessionId });
}

export async function pasteDesktopText(text: string, expectedTargetToken?: string | null, correlation?: PasteCorrelation): Promise<{ strategy: "clipboard"; outcome: "dispatched"; pasteMetrics?: { terminal: boolean; targetProbeMs: number; preflightMs: number; clipboardMs: number; keyboardMs: number } }> {
  return invoke("paste_desktop_text", { text, expectedTargetToken: expectedTargetToken ?? null, correlation: correlation ?? null });
}

export async function getOwnedPreeditStatus(): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("get_owned_preedit_status");
}

export async function refreshShortcutHeartbeat(ready: boolean): Promise<void> {
  return invoke<void>("refresh_shortcut_heartbeat", { ready });
}

export async function startOwnedPreedit(sessionId: number, triggerId?: string): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("start_owned_preedit", { sessionId, triggerId });
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

export async function checkpointOwnedPreedit(
  sessionId: number,
  expectedCommittedText: string,
  appendText: string,
): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("checkpoint_owned_preedit", {
    sessionId,
    expectedCommittedText,
    appendText,
  });
}

export async function finishCanonicalOwnedPreedit(
  sessionId: number,
  expectedCommittedText: string,
  appendText: string,
): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("finish_canonical_owned_preedit", {
    sessionId,
    expectedCommittedText,
    appendText,
  });
}

export async function cancelOwnedPreedit(sessionId: number): Promise<OwnedPreeditStatus> {
  return invoke<OwnedPreeditStatus>("cancel_owned_preedit", { sessionId });
}

export async function releaseBrowserRecording(triggerId: string): Promise<void> {
  return invoke("release_browser_recording", { triggerId });
}

export async function ackBrowserStop(triggerId: string): Promise<void> {
  return invoke("ack_browser_stop", { triggerId });
}

export async function syncRuntimeStatus(snapshot: RuntimeStatusSnapshot): Promise<void> {
  return invoke("sync_runtime_status", { snapshot });
}

export async function beginRuntimeStatusSession(): Promise<number> {
  return invoke<number>("begin_runtime_status_session");
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

export async function syncPanelLevel(epoch: number, level: number): Promise<void> {
  return invoke("sync_panel_level", { epoch, level });
}
