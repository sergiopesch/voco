export type UpdateChannel = "stable" | "beta";
/** Only chooses which update instructions Settings shows. */
export type InstallChannel = "github-release" | "source";

export interface AppConfig {
  hotkey: string;
  selectedMic: string | null;
  onboardingCompleted: boolean;
  updateChannel: UpdateChannel;
  automaticUpdateChecks: boolean;
  installChannel: InstallChannel;
}

export interface ConfigSnapshot {
  revision: number;
  config: AppConfig;
}

export type DictationStatus = "idle" | "starting" | "recording" | "processing" | "error";

export type CursorDeliveryState = "inactive" | "owned";

/** "" means desktop-input diagnostics have not loaded yet; the tray shows its
 * initializing presentation for it, not setup needed. */
export type CursorSetupState = "ready" | "not-enabled" | "";

export type AppSurface = "hidden" | "onboarding" | "settings" | "popover" | "review";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface ReleaseInfo {
  version: string;
  name: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "error";

export interface UpdateCheckState {
  status: UpdateCheckStatus;
  currentVersion: string | null;
  latestRelease: ReleaseInfo | null;
  lastCheckedAt: string | null;
  error: string | null;
}

export interface CachedUpdateCheck {
  channel: UpdateChannel;
  state: UpdateCheckState;
}

export interface InsertionSupport {
  available: boolean;
  requiredCommands: string[];
  missingCommands: string[];
  detail: string;
}

export interface ShortcutDiagnostics {
  hotkey: string;
  route: "ibus" | "global-shortcut" | "evdev" | "gnome-panel" | null;
  state: "available" | "focus-required" | "unavailable" | "unknown";
  detail: string;
}

export interface DesktopInputStatus {
  available: boolean;
  detail: string;
  /** Recommendation only: the GNOME Wayland companion is missing or outdated, so
   * the shortcut may also reach the focused app. It never blocks recording. */
  setupArea?: "panel";
}

/** Recording prerequisites only; each paste targets whatever has focus then. */
export interface DesktopPasteStatus {
  enabled: boolean;
  available: boolean;
  streamingEnabled: boolean;
  detail: string;
}

export interface RuntimeDiagnostics {
  desktopInput?: DesktopInputStatus;
  desktopPaste?: { enabled: boolean; available: boolean; detail: string };
  shortcut: ShortcutDiagnostics;
  sessionType: "wayland" | "x11-or-other";
  typeSimulation: InsertionSupport;
  clipboard: InsertionSupport;
  ibusShortcut: IbusShortcutStatus;
}

/** The optional IBus input source only takes the dictation shortcut. */
export interface IbusShortcutStatus {
  available: boolean;
  setupState:
    | "ready"
    | "not-enabled"
    | "not-installed"
    | "runtime-unavailable"
    | "incompatible"
    | "error";
  detail: string;
  error: string | null;
}

/** A Chromium exact-field receipt: only a matching receipt proves that the
 * field took the text. */
export interface BrowserFieldStatus {
  available: boolean;
  ready: boolean;
  setupState: "ready" | "safety-disabled";
  detail: string;
  sessionId: number | null;
  engineActive: boolean;
  focusLost: boolean;
  progressiveCommitActive: boolean;
  committedCharacterCount: number;
  ownershipIntact: boolean;
  finalizationOutcome: "uncertain" | null;
  error: string | null;
}

export type MicrophonePermission = "unknown" | "granted" | "denied";

export interface RuntimeStatusSnapshot {
  epoch: number;
  revision: number;
  runtimeInitialized: boolean;
  configurationError: boolean;
  microphoneReady: boolean;
  microphonePermission: MicrophonePermission;
  nativeMicrophoneReady?: boolean | null;
  dictationStatus: DictationStatus;
  dictationSessionId?: number;
  cursorDelivery: CursorDeliveryState;
  cursorRequired: boolean;
  cursorSetupState: CursorSetupState;
}
