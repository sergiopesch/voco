import type { CanonicalTranscription } from "@/types";

export const CANONICAL_SAMPLE_RATE = 16_000;
export const CANONICAL_CHUNK_SECONDS = 30;
export const CANONICAL_OVERLAP_SECONDS = 1;
export const CANONICAL_STRIDE_SECONDS =
  CANONICAL_CHUNK_SECONDS - CANONICAL_OVERLAP_SECONDS;
export const CANONICAL_CHUNK_SAMPLES =
  CANONICAL_SAMPLE_RATE * CANONICAL_CHUNK_SECONDS;
export const CANONICAL_OVERLAP_SAMPLES =
  CANONICAL_SAMPLE_RATE * CANONICAL_OVERLAP_SECONDS;
export const CANONICAL_STRIDE_SAMPLES =
  CANONICAL_SAMPLE_RATE * CANONICAL_STRIDE_SECONDS;

export interface CanonicalSampleRange {
  startSample: number;
  endSample: number;
}

export interface CanonicalSourceBlock extends CanonicalSampleRange {
  blockIndex: number;
  complete: boolean;
}

export interface CanonicalTranscriptionRange extends CanonicalSampleRange {
  chunkIndex: number;
  complete: boolean;
}

export type CanonicalDeliveryState =
  | "pending"
  | "owned"
  | "unavailable"
  | "uncertain";

export type CanonicalSessionPhase =
  | "recording"
  | "stopping"
  | "complete"
  | "failed";

export interface CanonicalCursorSession {
  sessionId: number;
  sourceSampleRate: number;
  phase: CanonicalSessionPhase;
  canonicalText: string;
  acknowledgedTargetText: string;
  delivery: CanonicalDeliveryState;
  processedSourceBlockCount: number;
  processedSourceEndSample: number;
  canonicalAudioEndSample: number;
  completedChunkCount: number;
  completedCanonicalEndSample: number;
  previewGeneration: number;
  checkpointSequence: number;
  inFlightRange: CanonicalTranscriptionRange | null;
}

export interface CanonicalPreviewToken {
  sessionId: number;
  generation: number;
}

export function createCanonicalCursorSession(
  sessionId: number,
  sourceSampleRate: number,
): CanonicalCursorSession {
  assertPositiveInteger(sessionId, "sessionId");
  assertSampleRate(sourceSampleRate);
  return {
    sessionId,
    sourceSampleRate,
    phase: "recording",
    canonicalText: "",
    acknowledgedTargetText: "",
    delivery: "pending",
    processedSourceBlockCount: 0,
    processedSourceEndSample: 0,
    canonicalAudioEndSample: 0,
    completedChunkCount: 0,
    completedCanonicalEndSample: 0,
    previewGeneration: 0,
    checkpointSequence: 0,
    inFlightRange: null,
  };
}

export function planNextCompleteSourceBlock(
  state: CanonicalCursorSession,
  capturedSourceSampleCount: number,
): CanonicalSourceBlock | null {
  const block = completeSourceBlock(
    state.processedSourceBlockCount,
    state.sourceSampleRate,
  );
  return normalizeSampleCount(capturedSourceSampleCount) >= block.endSample
    ? block
    : null;
}

export function planFinalSourceBlock(
  state: CanonicalCursorSession,
  capturedSourceSampleCount: number,
): CanonicalSourceBlock | null {
  const capturedEnd = normalizeSampleCount(capturedSourceSampleCount);
  if (capturedEnd <= state.processedSourceEndSample) {
    return null;
  }
  if (planNextCompleteSourceBlock(state, capturedEnd)) {
    throw new Error("complete canonical source blocks must be processed first");
  }
  return {
    blockIndex: state.processedSourceBlockCount,
    startSample: state.processedSourceEndSample,
    endSample: capturedEnd,
    complete: false,
  };
}

export function recordCanonicalSourceBlock(
  state: CanonicalCursorSession,
  block: CanonicalSourceBlock,
  canonicalSampleCount: number,
): CanonicalCursorSession {
  if (block.blockIndex !== state.processedSourceBlockCount) {
    throw new Error("canonical source blocks must be appended sequentially");
  }
  if (block.startSample !== state.processedSourceEndSample) {
    throw new Error("canonical source block does not extend the cached prefix");
  }
  if (block.endSample <= block.startSample) {
    throw new Error("canonical source block must contain audio");
  }
  const expectedCompleteBlock = completeSourceBlock(
    state.processedSourceBlockCount,
    state.sourceSampleRate,
  );
  if (
    block.startSample !== expectedCompleteBlock.startSample ||
    (block.complete && block.endSample !== expectedCompleteBlock.endSample) ||
    (!block.complete && block.endSample >= expectedCompleteBlock.endSample)
  ) {
    throw new Error("canonical source block does not match the planned boundary");
  }
  const appendedSamples = normalizeSampleCount(canonicalSampleCount);
  if (appendedSamples <= 0) {
    throw new Error("canonical source preprocessing produced no audio");
  }
  if (block.complete) {
    const expectedSamples =
      block.blockIndex === 0
        ? CANONICAL_CHUNK_SAMPLES
        : CANONICAL_STRIDE_SAMPLES;
    if (appendedSamples !== expectedSamples) {
      throw new Error(
        `canonical source block produced ${appendedSamples} samples; expected ${expectedSamples}`,
      );
    }
  }

  return {
    ...state,
    processedSourceBlockCount: state.processedSourceBlockCount + 1,
    processedSourceEndSample: block.endSample,
    canonicalAudioEndSample: state.canonicalAudioEndSample + appendedSamples,
  };
}

export function planNextCompleteCanonicalRange(
  state: CanonicalCursorSession,
): CanonicalTranscriptionRange | null {
  const startSample = state.completedChunkCount * CANONICAL_STRIDE_SAMPLES;
  const endSample = startSample + CANONICAL_CHUNK_SAMPLES;
  if (endSample > state.canonicalAudioEndSample) {
    return null;
  }
  return {
    chunkIndex: state.completedChunkCount,
    startSample,
    endSample,
    complete: true,
  };
}

export function planFinalCanonicalRange(
  state: CanonicalCursorSession,
): CanonicalTranscriptionRange | null {
  if (planNextCompleteCanonicalRange(state)) {
    throw new Error("complete canonical transcription ranges must be processed first");
  }
  if (state.canonicalAudioEndSample <= state.completedCanonicalEndSample) {
    return null;
  }
  const startSample = state.completedChunkCount * CANONICAL_STRIDE_SAMPLES;
  if (state.canonicalAudioEndSample <= startSample) {
    return null;
  }
  return {
    chunkIndex: state.completedChunkCount,
    startSample,
    endSample: state.canonicalAudioEndSample,
    complete: false,
  };
}

export function beginCanonicalTranscription(
  state: CanonicalCursorSession,
  range: CanonicalTranscriptionRange,
): CanonicalCursorSession {
  if (state.inFlightRange) {
    throw new Error("a canonical transcription is already in flight");
  }
  validateNextRange(state, range);
  return {
    ...state,
    previewGeneration: state.previewGeneration + 1,
    checkpointSequence: state.checkpointSequence + 1,
    inFlightRange: range,
  };
}

export function completeCanonicalTranscription(
  state: CanonicalCursorSession,
  result: CanonicalTranscription,
): CanonicalCursorSession {
  const range = state.inFlightRange;
  if (!range) {
    throw new Error("no canonical transcription is in flight");
  }
  if (!result.canonicalText.startsWith(state.canonicalText)) {
    throw new Error("canonical transcription revised its prior prefix");
  }
  if (result.canonicalText !== state.canonicalText + result.appendText) {
    throw new Error("canonical transcription append is not its exact suffix");
  }

  return {
    ...state,
    canonicalText: result.canonicalText,
    completedChunkCount: state.completedChunkCount + 1,
    completedCanonicalEndSample: range.endSample,
    inFlightRange: null,
  };
}

export function failCanonicalTranscription(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  if (!state.inFlightRange) {
    return state;
  }
  return { ...state, inFlightRange: null };
}

export function activateCanonicalDelivery(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  if (state.delivery === "uncertain") {
    throw new Error("uncertain canonical delivery cannot be reactivated");
  }
  return { ...state, delivery: "owned" };
}

export function markCanonicalDeliveryUnavailable(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  return state.delivery === "uncertain"
    ? state
    : { ...state, delivery: "unavailable" };
}

export function markCanonicalDeliveryUncertain(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  return { ...state, delivery: "uncertain" };
}

export function acknowledgeCanonicalDelivery(
  state: CanonicalCursorSession,
  expectedCommittedText: string,
  appendText: string,
): CanonicalCursorSession {
  if (state.delivery !== "owned") {
    throw new Error("canonical target delivery is not owned");
  }
  if (expectedCommittedText !== state.acknowledgedTargetText) {
    throw new Error("canonical target acknowledgement is out of sequence");
  }
  const acknowledgedTargetText = expectedCommittedText + appendText;
  if (acknowledgedTargetText !== state.canonicalText) {
    throw new Error("canonical target acknowledgement is not exact");
  }
  return { ...state, acknowledgedTargetText };
}

export function requestCanonicalStop(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  if (state.phase !== "recording") {
    return state;
  }
  return {
    ...state,
    phase: "stopping",
    previewGeneration: state.previewGeneration + 1,
  };
}

export function finishCanonicalSession(
  state: CanonicalCursorSession,
  capturedSourceSampleCount: number,
): CanonicalCursorSession {
  if (state.phase !== "stopping") {
    throw new Error("canonical session must be stopping before completion");
  }
  if (state.inFlightRange) {
    throw new Error("cannot finish while canonical transcription is in flight");
  }
  if (
    state.processedSourceEndSample !==
    normalizeSampleCount(capturedSourceSampleCount)
  ) {
    throw new Error("canonical source prefix is incomplete");
  }
  if (
    planNextCompleteCanonicalRange(state) ||
    state.canonicalAudioEndSample !== state.completedCanonicalEndSample
  ) {
    throw new Error("canonical audio has not been fully transcribed");
  }
  return { ...state, phase: "complete" };
}

export function failCanonicalSession(
  state: CanonicalCursorSession,
): CanonicalCursorSession {
  return {
    ...state,
    phase: "failed",
    previewGeneration: state.previewGeneration + 1,
    inFlightRange: null,
  };
}

export function createCanonicalPreviewToken(
  state: CanonicalCursorSession,
): CanonicalPreviewToken {
  return { sessionId: state.sessionId, generation: state.previewGeneration };
}

export function isCanonicalPreviewTokenActive(
  state: CanonicalCursorSession,
  token: CanonicalPreviewToken,
): boolean {
  return (
    state.phase === "recording" &&
    state.sessionId === token.sessionId &&
    state.previewGeneration === token.generation &&
    state.inFlightRange === null
  );
}

export function canonicalTranscriptionRanges(
  sampleCount: number,
): CanonicalTranscriptionRange[] {
  const end = normalizeSampleCount(sampleCount);
  const ranges: CanonicalTranscriptionRange[] = [];
  let chunkIndex = 0;
  while (chunkIndex * CANONICAL_STRIDE_SAMPLES < end) {
    const startSample = chunkIndex * CANONICAL_STRIDE_SAMPLES;
    const endSample = Math.min(startSample + CANONICAL_CHUNK_SAMPLES, end);
    ranges.push({
      chunkIndex,
      startSample,
      endSample,
      complete: endSample - startSample === CANONICAL_CHUNK_SAMPLES,
    });
    if (endSample === end) {
      break;
    }
    chunkIndex += 1;
  }
  return ranges;
}

function completeSourceBlock(
  blockIndex: number,
  sampleRate: number,
): CanonicalSourceBlock {
  const startSeconds =
    blockIndex === 0
      ? 0
      : CANONICAL_CHUNK_SECONDS +
        (blockIndex - 1) * CANONICAL_STRIDE_SECONDS;
  const endSeconds =
    CANONICAL_CHUNK_SECONDS + blockIndex * CANONICAL_STRIDE_SECONDS;
  return {
    blockIndex,
    startSample: Math.round(startSeconds * sampleRate),
    endSample: Math.round(endSeconds * sampleRate),
    complete: true,
  };
}

function validateNextRange(
  state: CanonicalCursorSession,
  range: CanonicalTranscriptionRange,
): void {
  if (range.chunkIndex !== state.completedChunkCount) {
    throw new Error("canonical transcription ranges must be processed sequentially");
  }
  const expectedStart = state.completedChunkCount * CANONICAL_STRIDE_SAMPLES;
  if (
    range.startSample !== expectedStart ||
    range.endSample <= range.startSample ||
    range.endSample > state.canonicalAudioEndSample ||
    range.endSample - range.startSample > CANONICAL_CHUNK_SAMPLES
  ) {
    throw new Error("canonical transcription range is invalid");
  }
}

function normalizeSampleCount(sampleCount: number): number {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new Error("sample count must be a non-negative safe integer");
  }
  return sampleCount;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("source sample rate must be positive");
  }
}
