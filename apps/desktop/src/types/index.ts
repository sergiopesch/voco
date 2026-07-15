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
  openclawAgent: string;
  openclawPromptPrefix: string;
  transcriptEnhancement: TranscriptEnhancement;
  localLlmEndpoint: string;
  localLlmModel: string | null;
  onboardingCompleted: boolean;
  updateChannel: UpdateChannel;
  installChannel: InstallChannel;
  voiceProfile: VoiceProfile;
}

export interface ConfigSnapshot {
  revision: number;
  config: AppConfig;
}

export type DictationStatus = "idle" | "recording" | "processing" | "error";
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

export type ActiveInsertionStrategy = "ydotool" | "xdotool" | "clipboard";

export interface InsertionResult {
  strategy: ActiveInsertionStrategy;
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

export interface RuntimeDiagnostics {
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
    | null;
  error: string | null;
}

export interface OpenClawAgentResult {
  agent: string;
  response: string;
}

export interface OpenClawSpeechResult {
  audioPath: string;
  provider: string | null;
  outputFormat: string | null;
}

export interface TranscriptEnhancementResult {
  text: string;
  usedEnhancement: boolean;
  warning: string | null;
}

export interface LocalLlmTestResult {
  ok: boolean;
  detail: string;
}

export interface LocalLlmAgentResult {
  response: string;
}

export interface RealtimeClientSecretResult {
  value: string;
  expiresAt: number | null;
}

export type RealtimeStatus = "idle" | "connecting" | "listening" | "speaking" | "error";
export type MicrophonePermission = "unknown" | "granted" | "denied";

export interface RuntimeStatusSnapshot {
  epoch: number;
  revision: number;
  runtimeInitialized: boolean;
  configurationError: boolean;
  microphoneReady: boolean;
  microphonePermission: MicrophonePermission;
  dictationStatus: DictationStatus;
  cursorDelivery: CursorDeliveryState;
  cursorRequired: boolean;
  cursorSetupState: OwnedPreeditStatus["setupState"];
  realtimeStatus: RealtimeStatus;
  realtimeMuted: boolean;
}
