export type InsertionStrategy = "auto" | "clipboard" | "type-simulation";
export type TranscriptTarget =
  | "cursor"
  | "local-agent"
  | "openclaw-agent"
  | "openclaw-speech";
export type TranscriptEnhancement = "off" | "conservative" | "commands-only";
export type LiveCursorMode =
  | "stable-cursor-streaming"
  | "preview-overlay-only"
  | "final-text-only";
export type UpdateChannel = "stable" | "beta";
export type InstallChannel =
  | "github-release"
  | "appimage"
  | "source"
  | "flatpak"
  | "snap";
export type VoiceProfile = "default" | "accent-aware";

export interface AppConfig {
  hotkey: string;
  selectedMic: string | null;
  insertionStrategy: InsertionStrategy;
  transcriptTarget: TranscriptTarget;
  liveCursorMode: LiveCursorMode;
  transcriptEnhancement: TranscriptEnhancement;
  onboardingCompleted: boolean;
  updateChannel: UpdateChannel;
  installChannel: InstallChannel;
  voiceProfile: VoiceProfile;
}

export interface ConfigSnapshot {
  revision: number;
  config: AppConfig;
}

export type DictationStatus = "idle" | "starting" | "recording" | "processing" | "error";

export interface RecoverableTranscript {
  id: string;
  text: string;
  createdAt: number;
  reason: "delivery-unconfirmed" | "output-failed";
  isPartial: boolean;
}

export interface DictationResult {
  completedAt: number;
  outcome: "delivered" | "needs-recovery";
}
export type CursorDeliveryState =
  | "inactive"
  | "pending"
  | "owned"
  | "preview-only"
  | "unreconciled";

export type AppSurface = "hidden" | "onboarding" | "settings" | "popover";

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
  optionalMissingCommands: string[];
  detail: string;
}

export interface TranscriptionSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface PreviewTranscription {
  text: string;
  segments: TranscriptionSegment[];
}

export interface CanonicalTranscription {
  canonicalText: string;
  appendText: string;
  chunkText: string;
}

export interface DebugDictationCaptureResult {
  audioPath: string;
  timelinePath: string;
}

export interface ShortcutDiagnostics {
  hotkey: string;
  route: "ibus" | "global-shortcut" | "evdev" | null;
  state: "available" | "focus-required" | "unavailable" | "unknown";
  detail: string;
}

export interface DesktopInputStatus {
  available: boolean;
  detail: string;
}

export interface RuntimeDiagnostics {
  desktopInput?: DesktopInputStatus;
  desktopPaste?: { enabled: boolean; available: boolean; detail: string };
  shortcut: ShortcutDiagnostics;
  sessionType: string;
  typeSimulation: InsertionSupport;
  clipboard: InsertionSupport;
  ownedPreedit: OwnedPreeditStatus;
}

export interface OwnedPreeditStatus {
  available: boolean;
  ready: boolean;
  setupState:
    | "ready"
    | "safety-disabled"
    | "not-enabled"
    | "not-installed"
    | "runtime-unavailable"
    | "incompatible"
    | "error"
    | "";
  detail: string;
  sessionId: number | null;
  engineActive: boolean;
  focusLost: boolean;
  progressiveCommitActive: boolean;
  committedCharacterCount: number;
  ownershipIntact: boolean;
  finalizationOutcome:
    | "none"
    | "committed"
    | "discarded"
    | "preserved"
    | "uncertain"
    | null;
  error: string | null;
}

export type MicrophonePermission = "unknown" | "granted" | "denied";

export interface RuntimeStatusSnapshot {
  epoch: number;
  revision: number;
  runtimeInitialized: boolean;
  hasRecoverableTranscript: boolean;
  configurationError: boolean;
  microphoneReady: boolean;
  microphonePermission: MicrophonePermission;
  nativeMicrophoneReady?: boolean | null;
  dictationStatus: DictationStatus;
  cursorDelivery: CursorDeliveryState;
  cursorRequired: boolean;
  cursorSetupState: OwnedPreeditStatus["setupState"];
  manualTranscriptReady: boolean;
  recoveryAvailable: boolean;
}
