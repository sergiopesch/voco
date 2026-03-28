export type InsertionStrategy = "auto" | "clipboard" | "type-simulation";

export interface AppConfig {
  hotkey: string;
  selectedMic: string | null;
  insertionStrategy: InsertionStrategy;
}

export type DictationStatus = "idle" | "recording" | "processing" | "error";
