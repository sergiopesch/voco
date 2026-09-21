import type { PreviewTranscription } from "@/types";
import type { CanonicalTranscriptionRange } from "./canonicalCursorSession";
import type { HybridResponse } from "./hybridSession";

export interface DebugPreviewFrame {
  sequence: number;
  sourceSampleRate: number;
  capturedSampleCount: number;
  previewStartSample: number;
  preview: PreviewTranscription;
  stateAfter: {
    candidateText: string;
    committedWindowText: string;
    committedCursorText: string;
    nextPreviewStartSample: number;
    blockedCommitCount: number;
    cursorInsertionDisabled: boolean;
  };
}

export interface PendingDebugCapture {
  audio: Float32Array;
  completedTranscript: string;
  committedCursorText: string;
  cursorInsertionDisabled: boolean;
  needsFullAudioReference: boolean;
  previewFrames: DebugPreviewFrame[];
  sessionId: number;
  canonicalChunks?: DebugCanonicalChunk[];
}

export interface DebugCanonicalChunk {
  sequence: number;
  range: CanonicalTranscriptionRange;
  result: HybridResponse;
}

