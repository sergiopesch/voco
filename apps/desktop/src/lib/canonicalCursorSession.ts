import {
  beginHybridAttempt, completeHybridAttempt, createHybridSession, failHybridAttempt,
  invalidateHybridGeneration, nextHybridRange, prepareHybridRequest,
  type HybridAttempt, type HybridResponse, type HybridSession, type PendingHybridRequest,
} from "@/lib/hybridSession";
import {
  beginPreparation, completePreparation, createLedger, rawPreviewAnchor,
  type Ledger, type PreparationTicket,
} from "@/lib/preprocessingLedger";

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
  recognition: HybridSession;
  ledger: Ledger | null;
  cacheReleased: boolean;
  acknowledgedTargetText: string;
  delivery: CanonicalDeliveryState;
  processedSourceBlockCount: number;
  processedSourceEndSample: number;
  canonicalAudioEndSample: number;
  previewGeneration: number;
  checkpointSequence: number;
}

export interface CanonicalPreviewToken {
  sessionId: number;
  generation: number;
}

export function createCanonicalCursorSession(
  sessionId: number,
  sourceSampleRate: number,
  generation = 0,
): CanonicalCursorSession {
  assertPositiveInteger(sessionId, "sessionId");
  assertSampleRate(sourceSampleRate);
  return {
    sessionId,
    sourceSampleRate,
    phase: "recording",
    recognition: createHybridSession(sessionId, generation),
    ledger: createLedger({sessionId, generation}, sourceSampleRate),
    cacheReleased: false,
    acknowledgedTargetText: "",
    delivery: "pending",
    processedSourceBlockCount: 0,
    processedSourceEndSample: 0,
    canonicalAudioEndSample: 0,
    previewGeneration: 0,
    checkpointSequence: 0,
  };
}

export function planNextCompleteSourceBlock(
  state: CanonicalCursorSession,
  capturedSourceSampleCount: number,
): CanonicalSourceBlock | null {
  requireCanonicalCache(state);
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
  requireCanonicalCache(state);
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
  ticket: PreparationTicket,
): CanonicalCursorSession {
  requireCanonicalCache(state);
  if (ticket.sourceStart !== block.startSample || ticket.sourceEnd !== block.endSample ||
      ticket.final !== !block.complete) throw new Error("Preparation ticket does not match source block");
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
    ledger: completePreparation(state.ledger!, ticket, appendedSamples),
    processedSourceBlockCount: state.processedSourceBlockCount + 1,
    processedSourceEndSample: block.endSample,
    canonicalAudioEndSample: state.canonicalAudioEndSample + appendedSamples,
  };
}

function requireCanonicalCache(state: CanonicalCursorSession): asserts state is CanonicalCursorSession & {ledger: Ledger} {
  if (state.cacheReleased || !state.ledger) throw new Error("Canonical audio cache has been released");
  if (state.ledger.identity.sessionId !== state.recognition.sessionId ||
      state.ledger.identity.generation !== state.recognition.generation)
    throw new Error("Canonical cache generation does not match recognition");
}

export function captureCanonicalPreparation(state: CanonicalCursorSession,
  block: CanonicalSourceBlock): PreparationTicket {
  requireCanonicalCache(state);
  if (state.phase !== "recording" && state.phase !== "stopping")
    throw new Error("Canonical session cannot prepare source audio");
  if (block.blockIndex !== state.processedSourceBlockCount)
    throw new Error("Source block is out of sequence");
  return beginPreparation(state.ledger, block.startSample, block.endSample, !block.complete);
}

export type CanonicalWork =
  | {kind: "retry"; pending: PendingHybridRequest}
  | {kind: "range"; range: CanonicalSampleRange; finalizing: boolean};

/** An active attempt must settle. A retry uses owned bytes, never the source cache. */
export function planCanonicalWork(state: CanonicalCursorSession, finalizing: boolean): CanonicalWork | null {
  requireCanonicalCache(state);
  if (state.phase !== "recording" && state.phase !== "stopping")
    throw new Error("Canonical session is not accepting recognition work");
  if (typeof finalizing !== "boolean") throw new Error("Invalid finalizing flag");
  if (state.recognition.active) return null;
  if (state.recognition.pending) return {kind: "retry", pending: state.recognition.pending};
  const range = nextHybridRange(state.recognition, state.canonicalAudioEndSample, finalizing);
  return range ? {kind: "range", range, finalizing} : null;
}

export function beginCanonicalTranscription(state: CanonicalCursorSession,
  samples?: Float32Array, finalizing = false): CanonicalCursorSession {
  const work = planCanonicalWork(state, finalizing);
  if (!work) throw new Error("No canonical recognition work is ready");
  let recognition = state.recognition;
  if (work.kind === "retry") {
    if (samples !== undefined) throw new Error("Retry must reuse its owned audio");
  } else {
    if (!samples || samples.length !== work.range.endSample - work.range.startSample)
      throw new Error("Canonical audio does not match its offered range");
    recognition = prepareHybridRequest(recognition, samples, finalizing);
  }
  return {...state, recognition: beginHybridAttempt(recognition),
    previewGeneration: state.previewGeneration + 1};
}

export function completeCanonicalTranscription(state: CanonicalCursorSession,
  attempt: HybridAttempt, result: unknown): CanonicalCursorSession {
  return completeCanonicalTranscriptionWithResponse(state, attempt, result).session;
}

export function completeCanonicalTranscriptionWithResponse(state: CanonicalCursorSession,
  attempt: HybridAttempt, result: unknown): {session: CanonicalCursorSession; response: HybridResponse} {
  requireCanonicalCache(state);
  const {session: recognition, response} = completeHybridAttempt(state.recognition, attempt, result);
  return {session: {...state, recognition, checkpointSequence: state.checkpointSequence + 1}, response};
}

export function failCanonicalTranscription(state: CanonicalCursorSession,
  attempt: HybridAttempt): CanonicalCursorSession {
  return {...state, recognition: failHybridAttempt(state.recognition, attempt)};
}

/** Pair synchronously with every actual clear/drain; preserve text for final delivery. */
export function invalidateCanonicalCache(state: CanonicalCursorSession,
  generation: number): CanonicalCursorSession {
  return {...state, recognition: invalidateHybridGeneration(state.recognition, generation),
    ledger: null, cacheReleased: true, processedSourceBlockCount: 0,
    processedSourceEndSample: 0, canonicalAudioEndSample: 0,
    previewGeneration: state.previewGeneration + 1};
}

export function canonicalPreviewSourceAnchor(state: CanonicalCursorSession): number {
  requireCanonicalCache(state);
  const p = state.recognition.progress;
  return rawPreviewAnchor(state.ledger, state.recognition, p.previousDecodedEnd, p.nextInputStart);
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
  if (acknowledgedTargetText !== state.recognition.canonicalText) {
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
  requireCanonicalCache(state);
  if (state.recognition.active || state.recognition.pending) {
    throw new Error("cannot finish with active or pending canonical recognition");
  }
  if (
    state.processedSourceEndSample !==
    normalizeSampleCount(capturedSourceSampleCount)
  ) {
    throw new Error("canonical source prefix is incomplete");
  }
  if (
    state.canonicalAudioEndSample !== state.recognition.progress.previousDecodedEnd
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
    phase: state.phase === "complete" ? "complete" : "failed",
    previewGeneration: state.previewGeneration + 1,
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
    state.recognition.active === null && state.recognition.pending === null
  );
}

/** Legacy fixed-stride replay utility. Live hybrid ranges require PCM-dependent receipts. */
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

function normalizeSampleCount(sampleCount: number): number {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0)
    throw new Error("sample count must be a non-negative safe integer");
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
