import type {
  AppConfig,
  BrowserFieldStatus,
  CachedUpdateCheck,
  ConfigSnapshot,
  DesktopInputStatus,
  DesktopPasteStatus,
  RuntimeDiagnostics,
  RuntimeStatusSnapshot
} from "@/types";
import { invoke } from "@tauri-apps/api/core";
import type { PasteCorrelation } from "./dictationStream";

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

/** Whether the Snap Store updates VOCO, which then never checks for updates itself. */
export async function storeUpdates(): Promise<boolean> {
  return invoke<boolean>("store_updates");
}

/** Whether this VOCO can start at login: the packages and the snap can, a
 * source build can't. */
export async function loginStartAvailable(): Promise<boolean> {
  return invoke<boolean>("login_start_available");
}

export interface MicrophoneAccess {
  allowed: boolean;
  /** What to do about it, when not allowed. */
  detail?: string;
}

/** Refused only in the snap, until its audio-record plug is connected. */
export async function microphoneAccess(): Promise<MicrophoneAccess> {
  return invoke<MicrophoneAccess>("microphone_access");
}

/** Why the speech runtime can't run on this processor, or null when it can. */
export async function speechProcessorProblem(): Promise<string | null> {
  return invoke<string | null>("speech_processor_problem");
}

/** The account's full name, for setup's first My words entry; null without one. */
export async function getAccountName(): Promise<string | null> {
  return invoke<string | null>("get_account_name");
}

export async function saveConfigPatch(
  patch: Partial<AppConfig>,
): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("save_config_patch", { patch });
}

export async function debugNativeCaptureEnabled(): Promise<boolean> {
  return invoke<boolean>("debug_native_capture_enabled");
}

export async function saveDebugNativeRetainedSource(packet: Uint8Array): Promise<string | null> {
  return invoke<string | null>("save_debug_native_retained_source", packet);
}

export async function getDesktopInputStatus(): Promise<DesktopInputStatus> {
  return invoke("get_desktop_input_status");
}

export interface PanelSetupStatus {
  status: string;
  detail: string;
  canEnable: boolean;
  /** The companion's page, for the snap, which can't install it. */
  url?: string;
}
export function getPanelSetupStatus(): Promise<PanelSetupStatus> {
  return invoke("get_panel_setup_status");
}
export function enableGnomePanel(): Promise<PanelSetupStatus> {
  return invoke("enable_gnome_panel");
}
/** The snap's setup with GNOME (AGENTS.md): typing through GNOME's
 * RemoteDesktop portal, allowed once in GNOME's dialog, and the shortcut as
 * VOCO's own entry in GNOME's keyboard shortcuts, which asks nobody. */
export interface PortalSetupStatus {
  /** The snap on GNOME Wayland, where this setup applies. */
  applies: boolean;
  typingAllowed: boolean;
  /** The VOCO panel types instead. */
  panelAttached: boolean;
  /** The panel also holds the saved shortcut; one before version 23 holds
   * only Alt chords. */
  panelHoldsShortcut: boolean;
  /** VOCO can keep its shortcut in GNOME's keyboard shortcuts. */
  shortcutAvailable: boolean;
  /** GNOME's keyboard shortcuts hold VOCO's, for the saved keys. */
  shortcutBound: boolean;
}
export function getPortalSetupStatus(): Promise<PortalSetupStatus> {
  return invoke("get_portal_setup_status");
}
/** Opens GNOME's typing dialog and waits for the answer; rejects with why not. */
export function allowPortalTyping(): Promise<PortalSetupStatus> {
  return invoke("allow_portal_typing");
}
/** Adds VOCO's shortcut to GNOME's keyboard shortcuts with the saved keys,
 * which asks nobody. Rejects with what already uses them. */
export function holdGnomeShortcut(): Promise<PortalSetupStatus> {
  return invoke("hold_gnome_shortcut");
}
/** Saves another shortcut when GNOME can't hold the saved one; GNOME's
 * keyboard shortcuts take it with the save. Rejects with what already uses
 * those keys, and nothing changes. */
export function chooseGnomeShortcut(hotkey: string): Promise<PortalSetupStatus> {
  return invoke("choose_gnome_shortcut", { hotkey });
}
/** A desktop dictation starts: the snap opens its typing session with GNOME. */
export function beginDesktopTyping(): Promise<void> {
  return invoke("begin_desktop_typing");
}
export function takeLauncherActivation(): Promise<boolean> {
  return invoke("take_launcher_activation");
}

export async function getDesktopPasteStatus(): Promise<DesktopPasteStatus> {
  return invoke("get_desktop_paste_status");
}

/** Rejection value of paste_desktop_text and copy_desktop_text. "no-mutation"
 * typed nothing and is safe to retry; the other outcomes must not be replayed. */
export interface InsertionError {
  outcome: "no-mutation" | "uncertain" | "rejected";
  message: string;
  clipboardChanged: boolean;
}

export interface DesktopPasteMetrics {
  preflightMs: number;
  settleMs: number;
  modifierWaitMs: number;
  clipboardMs: number;
  keyboardMs: number;
  routedUtf8Bytes: number;
  payloadUtf8Bytes: number;
  payloadUnicodeScalars: number;
  payloadUtf16Units: number;
  /** The selection VOCO saw the focused app read after the keys; "none" if it
   * didn't within the wait, "unobserved" where the helpers can't tell. */
  selectionRead: "clipboard" | "primary" | "none" | "unobserved";
  selectionReadMs: number | null;
  /** Which keyboard sent the keys: the GNOME companion, VOCO's uinput device,
   * GNOME's RemoteDesktop portal (the snap) or xdotool. */
  pasteKeys: "companion" | "uinput" | "portal" | "xdotool";
}

/** Pastes into whatever has focus now; rejects with an InsertionError. */
export async function pasteDesktopText(text: string, correlation?: PasteCorrelation): Promise<{ outcome: "dispatched"; pasteMetrics: DesktopPasteMetrics }> {
  return invoke("paste_desktop_text", { text, correlation });
}

/** Sets CLIPBOARD and PRIMARY without sending keys; rejects with an InsertionError. */
export async function copyDesktopText(text: string): Promise<void> {
  await invoke("copy_desktop_text", { text });
}

export async function refreshShortcutHeartbeat(ready: boolean): Promise<void> {
  return invoke<void>("refresh_shortcut_heartbeat", { ready });
}

export async function startBrowserField(sessionId: number, triggerId: string): Promise<BrowserFieldStatus> {
  return invoke<BrowserFieldStatus>("start_browser_field", { sessionId, triggerId });
}

export async function appendBrowserField(
  sessionId: number,
  expectedCommittedText: string,
  appendText: string,
): Promise<BrowserFieldStatus> {
  return invoke<BrowserFieldStatus>("append_browser_field", {
    sessionId,
    expectedCommittedText,
    appendText,
  });
}

export async function cancelBrowserField(sessionId: number): Promise<BrowserFieldStatus> {
  return invoke<BrowserFieldStatus>("cancel_browser_field", { sessionId });
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
  selectedDeviceConfigured?: boolean;
  trackSampleRate?: number;
  durationMs?: number;
  dictationSessionId?: number;
}

export async function traceHotkeyEvent(
  event: string,
  fields: HotkeyTraceFields | null = null,
): Promise<void> {
  return invoke("trace_frontend_hotkey_event", { event, fields });
}

/** Which opt-in logs are recording. Rust drops dictation traces and quality
 * records unless one is, so the renderer need not send them. */
export async function getDiagnosticLogging(): Promise<{ trace: boolean; performance: boolean }> {
  return invoke("diagnostic_logging");
}

export async function hasPendingHotkeyToggle(): Promise<boolean> {
  return invoke<boolean>("has_pending_hotkey_toggle");
}

export async function hideStatusOverlay(): Promise<void> {
  return invoke("hide_status_overlay");
}

export async function showNotification(summary: string, body: string): Promise<void> {
  return invoke("show_notification", { summary, body });
}

/** Opens VOCO's bug form in the browser with the version, the package and
 * the desktop filled in. Rust builds the address; VOCO sends nothing. */
export async function openProblemReport(): Promise<void> {
  return invoke("open_problem_report");
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
