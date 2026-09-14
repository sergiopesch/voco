/** VCA2 recognition state. Target delivery has a separate owner. */
export const HYBRID_HORIZON = 480_000;
export const HYBRID_OVERLAP = 16_000;
const MAX_CAPTURE_SAMPLES = 9_600_000;
const MAX_METADATA_BYTES = 1_048_576;

export interface HybridProgress {
  readonly plannerSequence: number;
  readonly previousDecodedEnd: number;
  readonly nextInputStart: number;
  readonly plannerFinalized: boolean;
}

export interface HybridMetadata extends HybridProgress {
  readonly protocolVersion: 2;
  readonly sessionId: number;
  readonly requestSequence: number;
  readonly generation: number;
  readonly payloadSamples: number;
  readonly finalizing: boolean;
  readonly previousCanonicalText: string;
}

export interface HybridReceipt {
  readonly sequence: number;
  readonly inputStart: number;
  readonly inputEnd: number;
  readonly previousDecodedEnd: number;
  readonly leftJoinMode: "initial" | "disjoint" | "legacyOverlap";
  readonly rightBoundaryMode: "numericalPlateau" | "legacyStride" | "final";
  readonly plateauStart: number | null;
  readonly plateauEnd: number | null;
  readonly nextInputStart: number;
}

export interface HybridResponse {
  readonly protocolVersion: 2;
  readonly sessionId: number;
  readonly requestSequence: number;
  readonly generation: number;
  readonly receipt: HybridReceipt;
  readonly chunkText: string;
  readonly canonicalText: string;
  readonly appendText: string;
}

/** Create through this module's transitions; native code validates restored progress. */
export interface HybridSession {
  readonly sessionId: number;
  readonly generation: number;
  readonly progress: HybridProgress;
  readonly canonicalText: string;
  readonly requestSequence: number;
  readonly pending: PendingHybridRequest | null;
  readonly active: HybridAttempt | null;
}

function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function count(value: number, label: string): void {
  requireValue(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);
}

function positive(value: number, label: string): void {
  count(value, label);
  requireValue(value > 0, `${label} must be positive`);
}

function equalProgress(a: HybridProgress, b: HybridProgress): boolean {
  return a.plannerSequence === b.plannerSequence &&
    a.previousDecodedEnd === b.previousDecodedEnd &&
    a.nextInputStart === b.nextInputStart && a.plannerFinalized === b.plannerFinalized;
}

function validateProgress(progress: HybridProgress): void {
  count(progress.plannerSequence, "plannerSequence");
  count(progress.previousDecodedEnd, "previousDecodedEnd");
  count(progress.nextInputStart, "nextInputStart");
  requireValue(typeof progress.plannerFinalized === "boolean", "Invalid planner finality");
  requireValue(progress.previousDecodedEnd <= MAX_CAPTURE_SAMPLES &&
    progress.nextInputStart <= MAX_CAPTURE_SAMPLES, "Progress exceeds capture limit");
  if (progress.plannerSequence === 0) {
    requireValue(progress.previousDecodedEnd === 0 && progress.nextInputStart === 0 &&
      !progress.plannerFinalized, "Invalid initial progress");
  } else {
    const overlap = progress.previousDecodedEnd - progress.nextInputStart;
    requireValue(progress.previousDecodedEnd > 0 && (overlap === 0 || overlap === HYBRID_OVERLAP),
      "Invalid prior incoming seam");
  }
}

export function createHybridSession(sessionId: number, generation: number): HybridSession {
  positive(sessionId, "sessionId");
  count(generation, "generation");
  return Object.freeze({sessionId, generation, canonicalText: "", requestSequence: 0,
    progress: Object.freeze({plannerSequence: 0, previousDecodedEnd: 0, nextInputStart: 0,
      plannerFinalized: false}), pending: null, active: null});
}

/** The owned audio bytes are never returned or aliased into an IPC packet. */
export class PendingHybridRequest {
  readonly #audio: Uint8Array;
  readonly #base: Omit<HybridMetadata, "requestSequence">;

  constructor(state: HybridSession, samples: Float32Array, finalizing: boolean) {
    validateProgress(state.progress);
    requireValue(!state.progress.plannerFinalized, "Recognition is already finalized");
    requireValue(typeof finalizing === "boolean", "Invalid finalizing flag");
    requireValue(samples.length > 0 && samples.length <= HYBRID_HORIZON, "Invalid request sample count");
    requireValue(samples.length === HYBRID_HORIZON || finalizing, "A partial horizon requires finalizing");
    const offeredEnd = state.progress.nextInputStart + samples.length;
    requireValue(offeredEnd <= MAX_CAPTURE_SAMPLES, "Audio exceeds capture limit");
    requireValue(offeredEnd > state.progress.previousDecodedEnd, "Request contains no new audio");
    requireValue(state.progress.plannerSequence !== 0 || state.canonicalText === "", "Initial prefix must be empty");
    this.#audio = new Uint8Array(samples.length * 4);
    const view = new DataView(this.#audio.buffer);
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      requireValue(typeof sample === "number" && Number.isFinite(sample), "Nonfinite audio cannot be submitted");
      view.setFloat32(index * 4, sample, true);
    }
    this.#base = Object.freeze({protocolVersion: 2, sessionId: state.sessionId,
      generation: state.generation, ...state.progress, payloadSamples: samples.length,
      finalizing, previousCanonicalText: state.canonicalText});
    Object.freeze(this);
  }

  get metadata(): Omit<HybridMetadata, "requestSequence"> {
    return this.#base;
  }

  matches(state: HybridSession): boolean {
    return this.#base.sessionId === state.sessionId && this.#base.generation === state.generation &&
      this.#base.previousCanonicalText === state.canonicalText && equalProgress(this.#base, state.progress);
  }

  attempt(requestSequence: number): HybridAttempt {
    positive(requestSequence, "requestSequence");
    return new HybridAttempt(Object.freeze({...this.#base, requestSequence}), this.#audio);
  }
}

export class HybridAttempt {
  readonly metadata: HybridMetadata;
  readonly #packet: Uint8Array;

  constructor(metadata: HybridMetadata, audio: Uint8Array) {
    this.metadata = Object.freeze({...metadata});
    const encoded = new TextEncoder().encode(JSON.stringify(this.metadata));
    requireValue(encoded.length <= MAX_METADATA_BYTES, "Canonical metadata exceeds its transport limit");
    this.#packet = new Uint8Array(8 + encoded.length + audio.length);
    this.#packet.set([0x56, 0x43, 0x41, 0x32]);
    new DataView(this.#packet.buffer).setUint32(4, encoded.length, true);
    this.#packet.set(encoded, 8);
    this.#packet.set(audio, 8 + encoded.length);
    Object.freeze(this);
  }

  packet(): Uint8Array {
    return this.#packet.slice();
  }
}

export function prepareHybridRequest(state: HybridSession, samples: Float32Array,
  finalizing: boolean): HybridSession {
  requireValue(!state.pending && !state.active, "Preserve the pending request before preparing new audio");
  return Object.freeze({...state, pending: new PendingHybridRequest(state, samples, finalizing)});
}

export function beginHybridAttempt(state: HybridSession): HybridSession {
  requireValue(state.pending && !state.active, "A pending request without an active attempt is required");
  requireValue(state.pending.matches(state), "Pending request belongs to different recognition state");
  const requestSequence = state.requestSequence + 1;
  positive(requestSequence, "requestSequence");
  return Object.freeze({...state, requestSequence, active: state.pending.attempt(requestSequence)});
}

export function failHybridAttempt(state: HybridSession, attempt: HybridAttempt): HybridSession {
  requireValue(state.active === attempt, "Failure belongs to a stale request");
  return Object.freeze({...state, active: null});
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `Invalid ${label}`);
  requireValue(Object.keys(value).sort().join(",") === [...keys].sort().join(","), `Unexpected ${label} fields`);
  return value as Record<string, unknown>;
}

function receiptFrom(value: unknown, metadata: HybridMetadata): HybridReceipt {
  const receipt = record(value, ["sequence", "inputStart", "inputEnd", "previousDecodedEnd",
    "leftJoinMode", "rightBoundaryMode", "plateauStart", "plateauEnd", "nextInputStart"], "receipt");
  for (const key of ["sequence", "inputStart", "inputEnd", "previousDecodedEnd", "nextInputStart"])
    count(receipt[key] as number, key);
  const r = receipt as unknown as HybridReceipt;
  requireValue(r.sequence === metadata.plannerSequence && r.inputStart === metadata.nextInputStart &&
    r.previousDecodedEnd === metadata.previousDecodedEnd, "Receipt does not echo pending progress");
  const left = metadata.plannerSequence === 0 ? "initial" :
    metadata.previousDecodedEnd === metadata.nextInputStart ? "disjoint" : "legacyOverlap";
  requireValue(r.leftJoinMode === left, "Receipt changed its incoming seam");
  const offeredEnd = metadata.nextInputStart + metadata.payloadSamples;
  requireValue(r.inputEnd > metadata.previousDecodedEnd && r.inputEnd > r.inputStart &&
    r.inputEnd <= offeredEnd, "Receipt does not extend available audio coverage");
  if (r.rightBoundaryMode === "numericalPlateau") {
    requireValue(metadata.payloadSamples === HYBRID_HORIZON && left !== "legacyOverlap",
      "Plateau violates the full-horizon or latched cadence rule");
    count(r.plateauStart as number, "plateauStart"); count(r.plateauEnd as number, "plateauEnd");
    const start = r.plateauStart as number, end = r.plateauEnd as number;
    requireValue(start >= r.inputStart && end < offeredEnd && end - start >= 3_200 &&
      (start - r.inputStart) % 320 === 0 && (end - r.inputStart) % 320 === 0 &&
      r.inputEnd === start + (end - start) / 2 && r.inputEnd - r.inputStart >= 24_000 &&
      offeredEnd - r.inputEnd >= 24_000 && r.nextInputStart === r.inputEnd,
    "Invalid numerical plateau bounds");
  } else {
    requireValue(r.plateauStart === null && r.plateauEnd === null, "Unexpected plateau evidence");
    requireValue(r.inputEnd === offeredEnd, "Non-plateau receipt omitted offered audio");
    if (r.rightBoundaryMode === "legacyStride") {
      requireValue(metadata.payloadSamples === HYBRID_HORIZON &&
        r.nextInputStart === r.inputEnd - HYBRID_OVERLAP, "Invalid legacy stride");
    } else {
      requireValue(r.rightBoundaryMode === "final" && metadata.finalizing &&
        metadata.payloadSamples < HYBRID_HORIZON && r.nextInputStart === r.inputEnd, "Invalid final receipt");
    }
  }
  return Object.freeze({...r});
}

export function completeHybridAttempt(state: HybridSession, attempt: HybridAttempt,
  value: unknown): {session: HybridSession; response: HybridResponse} {
  requireValue(state.active === attempt && state.pending?.matches(state), "Response belongs to stale recognition state");
  const metadata = attempt.metadata;
  const raw = record(value, ["protocolVersion", "sessionId", "requestSequence", "generation", "receipt",
    "chunkText", "canonicalText", "appendText"], "response");
  requireValue(raw.protocolVersion === 2 && raw.sessionId === state.sessionId &&
    raw.generation === state.generation && raw.requestSequence === state.requestSequence &&
    metadata.requestSequence === state.requestSequence, "Response identity does not match the active attempt");
  const receipt = receiptFrom(raw.receipt, metadata);
  requireValue(typeof raw.chunkText === "string" && typeof raw.canonicalText === "string" &&
    typeof raw.appendText === "string", "Invalid transcription text");
  requireValue(raw.canonicalText === state.canonicalText + raw.appendText, "Transcription changed its recognized prefix");
  if (receipt.leftJoinMode !== "legacyOverlap") {
    const append = raw.chunkText === "" ? "" : (state.canonicalText === "" ? "" : " ") + raw.chunkText;
    requireValue(raw.appendText === append, "Disjoint transcription changed or deduplicated its chunk");
  }
  const progress = Object.freeze({plannerSequence: receipt.sequence + 1, previousDecodedEnd: receipt.inputEnd,
    nextInputStart: receipt.nextInputStart, plannerFinalized: receipt.rightBoundaryMode === "final"});
  validateProgress(progress);
  const response = Object.freeze({...raw, receipt}) as unknown as HybridResponse;
  return {session: Object.freeze({...state, progress, canonicalText: raw.canonicalText, pending: null, active: null}), response};
}

/** Buffered audio can extend beyond decoded audio; overlap is context, not a tail. */
export function nextHybridRange(state: HybridSession, availableEnd: number,
  finalizing: boolean): {startSample: number; endSample: number} | null {
  count(availableEnd, "availableEnd");
  requireValue(typeof finalizing === "boolean", "Invalid finalizing flag");
  requireValue(availableEnd <= MAX_CAPTURE_SAMPLES && availableEnd >= state.progress.previousDecodedEnd,
    "Available audio cannot precede completed coverage or exceed the capture limit");
  requireValue(!state.pending && !state.active, "Resolve pending audio before planning another request");
  if (availableEnd === state.progress.previousDecodedEnd) return null;
  requireValue(!state.progress.plannerFinalized, "Cannot append audio after finalization");
  const endSample = Math.min(state.progress.nextInputStart + HYBRID_HORIZON, availableEnd);
  if (!finalizing && endSample - state.progress.nextInputStart < HYBRID_HORIZON) return null;
  return {startSample: state.progress.nextInputStart, endSample};
}

/** Fence all in-flight work after canonical cache release, keeping committed text. */
export function invalidateHybridGeneration(state: HybridSession, generation: number): HybridSession {
  count(generation, "generation");
  requireValue(generation > state.generation, "Cache release must advance generation");
  return Object.freeze({...state, generation, pending: null, active: null});
}
