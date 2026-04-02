import { create } from "zustand";
import type {
  AppConfig,
  AppSurface,
  AudioDeviceOption,
  DictationStatus,
  UpdateCheckState,
} from "@/types";

interface AppState {
  status: DictationStatus;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  selectedDeviceId: string | null;
  audioLevel: number;
  config: AppConfig | null;
  surface: AppSurface;
  onboardingStep: number;
  availableDevices: AudioDeviceOption[];
  microphonePermission: "unknown" | "granted" | "denied";
  updateState: UpdateCheckState;

  setStatus: (status: DictationStatus) => void;
  setTranscript: (transcript: string) => void;
  setInterimTranscript: (interim: string) => void;
  setError: (error: string | null) => void;
  setAudioLevel: (level: number) => void;
  setConfig: (config: AppConfig) => void;
  setSurface: (surface: AppSurface) => void;
  setOnboardingStep: (step: number) => void;
  setAvailableDevices: (devices: AudioDeviceOption[]) => void;
  setSelectedDeviceId: (deviceId: string | null) => void;
  setMicrophonePermission: (state: "unknown" | "granted" | "denied") => void;
  setUpdateState: (updateState: UpdateCheckState) => void;
  clearTranscript: () => void;
}

export const useStore = create<AppState>((set) => ({
  status: "idle",
  transcript: "",
  interimTranscript: "",
  error: null,
  selectedDeviceId: null,
  audioLevel: 0,
  config: null,
  surface: "hidden",
  onboardingStep: 0,
  availableDevices: [],
  microphonePermission: "unknown",
  updateState: {
    status: "idle",
    currentVersion: null,
    latestRelease: null,
    lastCheckedAt: null,
    error: null,
  },

  setStatus: (status) => set({ status, error: null }),
  setTranscript: (transcript) => set({ transcript }),
  setInterimTranscript: (interim) => set({ interimTranscript: interim }),
  setError: (error) => set({ error, status: error ? "error" : "idle" }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setConfig: (config) =>
    set({
      config,
      selectedDeviceId: config.selectedMic,
      surface:
        config.onboardingCompleted && useStore.getState().surface !== "settings"
          ? "hidden"
          : "onboarding",
    }),
  setSurface: (surface) => set({ surface }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
  setAvailableDevices: (devices) => set({ availableDevices: devices }),
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  setMicrophonePermission: (microphonePermission) => set({ microphonePermission }),
  setUpdateState: (updateState) => set({ updateState }),
  clearTranscript: () => set({ transcript: "", interimTranscript: "" }),
}));
