import { create } from "zustand";
import type { DictationRecovery } from "@/lib/dictationRecovery";
import type { CaptureBackendMode, NativeCaptureSource } from "@/lib/nativeCaptureSettings";
import type {
  AppConfig,
  AppSurface,
  AudioDeviceOption,
  DictationStatus,
  DictationResult,
  RecoverableTranscript,
  MicrophonePermission,
  OwnedPreeditStatus,
  UpdateCheckState,
} from "@/types";

export function deriveSurfaceForConfig(
  currentSurface: AppSurface,
  previousConfig: AppConfig | null,
  nextConfig: AppConfig,
): AppSurface {
  if (!previousConfig) {
    return nextConfig.onboardingCompleted ? "hidden" : "onboarding";
  }

  if (currentSurface === "onboarding" && nextConfig.onboardingCompleted) {
    return "hidden";
  }

  if (currentSurface === "hidden" && !nextConfig.onboardingCompleted) {
    return "onboarding";
  }

  return currentSurface;
}

interface AppState {
  captureBackendMode: CaptureBackendMode;
  nativeCaptureSource: NativeCaptureSource | null;
  setCaptureBackendMode: (mode: CaptureBackendMode) => void;
  setNativeCaptureSource: (source: NativeCaptureSource | null) => void;
  dictationPurpose: "cursor" | "onboarding";
  onboardingTestPassed: boolean;
  setDictationPurpose: (purpose: "cursor" | "onboarding") => void;
  setOnboardingTestPassed: (passed: boolean) => void;
  status: DictationStatus;
  transcript: string;
  rawTranscript: string;
  recoverableTranscripts: RecoverableTranscript[];
  lastDictationResult: DictationResult | null;
  interimTranscript: string;
  error: string | null;
  recovery: DictationRecovery | null;
  captureNotice: string | null;
  selectedDeviceId: string | null;
  audioLevel: number;
  config: AppConfig | null;
  surface: AppSurface;
  onboardingStep: number;
  availableDevices: AudioDeviceOption[];
  microphonePermission: MicrophonePermission;
  microphoneReady: boolean;
  ownedPreeditSetupState: OwnedPreeditStatus["setupState"];
  updateState: UpdateCheckState;

  setRecovery: (recovery: DictationRecovery | null) => void;
  setCaptureNotice: (notice: string | null) => void;
  setStatus: (status: DictationStatus) => void;
  setTranscript: (transcript: string) => void;
  setRawTranscript: (transcript: string) => void;
  retainRecoverableTranscript: (entry: Omit<RecoverableTranscript, "createdAt">) => void;
  dismissRecoverableTranscript: (id: string) => void;
  setLastDictationResult: (result: DictationResult | null) => void;
  setInterimTranscript: (interim: string) => void;
  setError: (error: string | null) => void;
  setAudioLevel: (level: number) => void;
  setConfig: (config: AppConfig) => void;
  setSurface: (surface: AppSurface) => void;
  setOnboardingStep: (step: number) => void;
  setAvailableDevices: (devices: AudioDeviceOption[]) => void;
  setSelectedDeviceId: (deviceId: string | null) => void;
  setMicrophonePermission: (state: MicrophonePermission) => void;
  setMicrophoneReady: (ready: boolean) => void;
  setOwnedPreeditSetupState: (
    setupState: OwnedPreeditStatus["setupState"],
  ) => void;
  setUpdateState: (updateState: UpdateCheckState) => void;
  clearTranscript: () => void;
}

export const useStore = create<AppState>((set) => ({
  captureBackendMode: "pending",
  nativeCaptureSource: null,
  setCaptureBackendMode: (captureBackendMode) => set((state) => ({
    captureBackendMode,
    microphoneReady: captureBackendMode === "native" ? Boolean(state.nativeCaptureSource)
      : captureBackendMode === "pending" ? false : state.microphoneReady,
  })),
  setNativeCaptureSource: (nativeCaptureSource) => set((state) => ({
    nativeCaptureSource,
    microphoneReady: state.captureBackendMode === "native" ? Boolean(nativeCaptureSource) : state.microphoneReady,
  })),
  dictationPurpose: "cursor",
  onboardingTestPassed: false,
  setDictationPurpose: (dictationPurpose) => set({ dictationPurpose }),
  setOnboardingTestPassed: (onboardingTestPassed) => set({ onboardingTestPassed }),
  status: "idle",
  transcript: "",
  rawTranscript: "",
  recoverableTranscripts: [],
  lastDictationResult: null,
  interimTranscript: "",
  error: null,
  recovery: null,
  captureNotice: null,
  selectedDeviceId: null,
  audioLevel: 0,
  config: null,
  surface: "hidden",
  onboardingStep: 0,
  availableDevices: [],
  microphonePermission: "unknown",
  microphoneReady: false,
  ownedPreeditSetupState: "",
  updateState: {
    status: "idle",
    currentVersion: null,
    latestRelease: null,
    lastCheckedAt: null,
    error: null,
  },

  setRecovery: (recovery) => set({ recovery }),
  setCaptureNotice: (captureNotice) => set({ captureNotice }),
  setStatus: (status) => set({ status, error: null }),
  setTranscript: (transcript) => set({ transcript }),
  setRawTranscript: (rawTranscript) => set({ rawTranscript }),
  // Recovery is intentionally session-only and separate from the current capture.
  retainRecoverableTranscript: (entry) => set((state) => {
    if (!entry.text.trim()) return state;
    const existing = state.recoverableTranscripts.find((item) => item.id === entry.id);
    const retained = { ...entry, createdAt: existing?.createdAt ?? Date.now() };
    return {
      recoverableTranscripts: existing
        ? state.recoverableTranscripts.map((item) => item.id === entry.id ? retained : item)
        : [...state.recoverableTranscripts, retained],
    };
  }),
  dismissRecoverableTranscript: (id) => set((state) => ({
    recoverableTranscripts: state.recoverableTranscripts.filter((entry) => entry.id !== id),
  })),
  setLastDictationResult: (lastDictationResult) => set({ lastDictationResult }),
  setInterimTranscript: (interim) => set({ interimTranscript: interim }),
  setError: (error) => set({ error }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setConfig: (config) =>
    set((state) => ({
      config,
      selectedDeviceId: config.selectedMic,
      onboardingTestPassed: state.config?.onboardingCompleted && !config.onboardingCompleted ? false : state.onboardingTestPassed,
      surface: deriveSurfaceForConfig(state.surface, state.config, config),
    })),
  setSurface: (surface) => set({ surface }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
  setAvailableDevices: (devices) => set({ availableDevices: devices }),
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  setMicrophonePermission: (microphonePermission) => set({ microphonePermission }),
  setMicrophoneReady: (microphoneReady) => set({ microphoneReady }),
  setOwnedPreeditSetupState: (ownedPreeditSetupState) =>
    set({ ownedPreeditSetupState }),
  setUpdateState: (updateState) => set({ updateState }),
  clearTranscript: () => set({ transcript: "", rawTranscript: "", interimTranscript: "" }),
}));
