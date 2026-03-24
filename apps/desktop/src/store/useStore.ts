import { create } from "zustand";
import type {
  AppConfig,
  DictationStatus,
  AudioDevice,
  PlatformInfo,
} from "@/types";

interface AppState {
  // Dictation state
  status: DictationStatus;
  transcript: string;
  interimTranscript: string;
  error: string | null;

  // Audio
  audioDevices: AudioDevice[];
  selectedDeviceId: string | null;
  audioLevel: number;

  // Config
  config: AppConfig | null;

  // Platform
  platform: PlatformInfo | null;

  // Model
  modelReady: boolean;

  // UI
  view: "main" | "settings";

  // Actions
  setModelReady: (ready: boolean) => void;
  setStatus: (status: DictationStatus) => void;
  setTranscript: (transcript: string) => void;
  setInterimTranscript: (interim: string) => void;
  setError: (error: string | null) => void;
  setAudioDevices: (devices: AudioDevice[]) => void;
  setSelectedDevice: (deviceId: string | null) => void;
  setAudioLevel: (level: number) => void;
  setConfig: (config: AppConfig) => void;
  setPlatform: (platform: PlatformInfo) => void;
  setView: (view: "main" | "settings") => void;
  clearTranscript: () => void;
}

export const useStore = create<AppState>((set) => ({
  status: "idle",
  transcript: "",
  interimTranscript: "",
  error: null,
  audioDevices: [],
  selectedDeviceId: null,
  audioLevel: 0,
  config: null,
  platform: null,
  modelReady: false,
  view: "main",

  setModelReady: (ready) => set({ modelReady: ready }),
  setStatus: (status) => set({ status, error: status === "error" ? undefined : null }),
  setTranscript: (transcript) => set({ transcript }),
  setInterimTranscript: (interim) => set({ interimTranscript: interim }),
  setError: (error) => set({ error, status: error ? "error" : "idle" }),
  setAudioDevices: (devices) => set({ audioDevices: devices }),
  setSelectedDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setConfig: (config) => set({ config }),
  setPlatform: (platform) => set({ platform }),
  setView: (view) => set({ view }),
  clearTranscript: () => set({ transcript: "", interimTranscript: "" }),
}));
