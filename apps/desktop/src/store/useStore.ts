import { create } from "zustand";
import type { AppConfig, DictationStatus } from "@/types";

interface AppState {
  status: DictationStatus;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  selectedDeviceId: string | null;
  audioLevel: number;
  config: AppConfig | null;

  setStatus: (status: DictationStatus) => void;
  setTranscript: (transcript: string) => void;
  setInterimTranscript: (interim: string) => void;
  setError: (error: string | null) => void;
  setAudioLevel: (level: number) => void;
  setConfig: (config: AppConfig) => void;
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

  setStatus: (status) => set({ status, error: null }),
  setTranscript: (transcript) => set({ transcript }),
  setInterimTranscript: (interim) => set({ interimTranscript: interim }),
  setError: (error) => set({ error, status: error ? "error" : "idle" }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setConfig: (config) => set({ config }),
  clearTranscript: () => set({ transcript: "", interimTranscript: "" }),
}));
