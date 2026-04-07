export type InsertionStrategy = "auto" | "clipboard" | "type-simulation";
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
  onboardingCompleted: boolean;
  updateChannel: UpdateChannel;
  installChannel: InstallChannel;
  voiceProfile: VoiceProfile;
}

export type DictationStatus = "idle" | "recording" | "processing" | "error";

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

export interface RuntimeDiagnostics {
  sessionType: string;
  typeSimulation: InsertionSupport;
  clipboard: InsertionSupport;
}
