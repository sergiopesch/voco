import { invoke } from "@tauri-apps/api/core";
import { createCaptureDescriptor, type CaptureDescriptor } from "@/lib/captureDescriptor";

export interface NativeCaptureIdentity { captureId: string; sessionId: number; generation: number }
export interface NativeCaptureSource {
  selectionToken: string; name: string; label: string; index: number; objectSerial: string; isMonitor: boolean;
}
export interface NativeCaptureReceipt {
  state: "stopping" | "stopped"; producedFrames: number; lastSequence: number;
  corkAcknowledged: boolean; barrierAcknowledged: boolean; limitReached: boolean;
  acknowledgedSequence: number; health: { healthy: boolean; reason: string | null };
}
interface BeginReply extends NativeCaptureIdentity {
  source: NativeCaptureSource; format: "s16le"; sampleRate: 44100; channels: 2;
  channelMap: ["front-left", "front-right"]; frameBytes: 4; maxFrames: 26460000;
}
interface Block { sequence: number; frameStart: number; frames: number; byteOffset: number; byteLength: number }
export interface NativeCaptureApi {
  begin(request: { sessionId: number; generation: number; selectionToken: string }): Promise<unknown>;
  drain(request: NativeCaptureIdentity & { ackThroughSequence: number }): Promise<unknown>;
  stop(request: NativeCaptureIdentity): Promise<unknown>;
  cancel(request: NativeCaptureIdentity): Promise<unknown>;
}
export const nativeCaptureApi: NativeCaptureApi = {
  begin: (request) => invoke("native_capture_begin", { request }),
  drain: (request) => invoke("native_capture_drain", { request }),
  stop: (request) => invoke("native_capture_stop", { request }),
  cancel: (request) => invoke("native_capture_cancel", { request }),
};
const MAX_FRAMES = 26460000;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("Invalid native capture fields");
  return value as Record<string, unknown>;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error("Invalid native capture integer");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4096) throw new Error("Invalid native capture text");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid native capture flag");
  return value;
}
export function parseNativeReceipt(value: unknown): NativeCaptureReceipt {
  const r = object(value, ["state", "producedFrames", "lastSequence", "corkAcknowledged", "barrierAcknowledged", "limitReached", "acknowledgedSequence", "health"]);
  if (r.state !== "stopping" && r.state !== "stopped") throw new Error("Invalid native capture state");
  const health = object(r.health, ["healthy", "reason"]);
  boolean(health.healthy);
  if (health.reason !== null) text(health.reason);
  if (health.healthy && health.reason !== null) throw new Error("Contradictory native capture health");
  const frames = integer(r.producedFrames, MAX_FRAMES), last = integer(r.lastSequence, frames);
  const ack = integer(r.acknowledgedSequence, last);
  boolean(r.corkAcknowledged); boolean(r.barrierAcknowledged); boolean(r.limitReached);
  if ((frames === 0) !== (last === 0) || (r.limitReached && frames !== MAX_FRAMES)) throw new Error("Contradictory native capture extent");
  return { ...r, producedFrames: frames, lastSequence: last, acknowledgedSequence: ack } as unknown as NativeCaptureReceipt;
}
function parseBegin(value: unknown, sessionId: number, generation: number, token: string): BeginReply {
  const r = object(value, ["captureId", "sessionId", "generation", "source", "format", "sampleRate", "channels", "channelMap", "frameBytes", "maxFrames"]);
  text(r.captureId);
  if (r.sessionId !== sessionId || r.generation !== generation || r.format !== "s16le" || r.sampleRate !== 44100 ||
      r.channels !== 2 || r.frameBytes !== 4 || r.maxFrames !== MAX_FRAMES ||
      JSON.stringify(r.channelMap) !== '["front-left","front-right"]') throw new Error("Native capture descriptor mismatch");
  const s = object(r.source, ["selectionToken", "name", "label", "index", "objectSerial", "isMonitor"]);
  if (s.selectionToken !== token) throw new Error("Native capture source changed");
  text(s.selectionToken); text(s.name); text(s.label); text(s.objectSerial); integer(s.index, 4294967294); boolean(s.isMonitor);
  return r as unknown as BeginReply;
}
export function parseNativeBatch(value: unknown, identity: NativeCaptureIdentity) {
  let bytes: Uint8Array;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (value instanceof Uint8Array) bytes = value;
  else if (Array.isArray(value) && value.length <= 4 + 65536 + 8 * 35280 && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) bytes = Uint8Array.from(value);
  else throw new Error("Invalid native capture binary response");
  if (bytes.length < 4 || bytes.length > 4 + 65536 + 8 * 35280) throw new Error("Native capture packet size exceeded");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (length === 0 || length > 65536 || length + 4 > bytes.length) throw new Error("Native capture metadata extent mismatch");
  const r = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + length))),
    ["version", "captureId", "sessionId", "generation", "blocks", "receipt"]);
  if (r.version !== 1 || r.captureId !== identity.captureId || r.sessionId !== identity.sessionId || r.generation !== identity.generation)
    throw new Error("Stale native capture identity");
  if (!Array.isArray(r.blocks) || r.blocks.length > 8) throw new Error("Native capture batch count exceeded");
  let offset = 0, previous: Block | null = null;
  const blocks = r.blocks.map(value => {
    const b = object(value, ["sequence", "frameStart", "frames", "byteOffset", "byteLength"]);
    const sequence = integer(b.sequence), start = integer(b.frameStart, MAX_FRAMES), frames = integer(b.frames, 8820);
    if (sequence === 0 || frames === 0 || start + frames > MAX_FRAMES || b.byteOffset !== offset || b.byteLength !== frames * 4 ||
        (previous && (sequence !== previous.sequence + 1 || start !== previous.frameStart + previous.frames))) throw new Error("Native capture block extent/order mismatch");
    const block = { sequence, frameStart: start, frames, byteOffset: offset, byteLength: frames * 4 };
    offset += block.byteLength; previous = block; return block;
  });
  if (4 + length + offset !== bytes.length) throw new Error("Native capture payload extent mismatch");
  const receipt = parseNativeReceipt(r.receipt);
  const last = blocks[blocks.length - 1];
  if (last && (last.sequence > receipt.lastSequence || last.frameStart + last.frames > receipt.producedFrames)) throw new Error("Native receipt precedes payload");
  return { blocks, receipt, pcm: bytes.slice(4 + length) };
}
export function nativeStereoToMono(bytes: Uint8Array): Float32Array {
  if (bytes.length % 4) throw new Error("Partial native stereo frame");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), mono = new Float32Array(bytes.length / 4);
  for (let i = 0; i < mono.length; i++) mono[i] = (view.getInt16(i * 4, true) + view.getInt16(i * 4 + 2, true)) / 65536;
  return mono;
}
export interface NativeCaptureSession {
  readonly descriptor: CaptureDescriptor;
  readonly identity: NativeCaptureIdentity;
  startDelivery(): void;
  stopAndDrain(): Promise<NativeCaptureReceipt>;
  cancel(): Promise<void>;
}
async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Native capture operation timed out")), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function beginNativeCapture(options: {
  sessionId: number; generation: number; selectionToken: string;
  onSamples: (samples: Float32Array) => number;
  onInterrupted: (reason: string) => void;
  onLimit: () => void;
  api?: NativeCaptureApi;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<NativeCaptureSession> {
  integer(options.sessionId); integer(options.generation); text(options.selectionToken);
  if (!options.sessionId) throw new Error("Invalid recording session");
  const api = options.api ?? nativeCaptureApi;
  const pollMs = options.pollMs ?? 20, timeoutMs = options.timeoutMs ?? 5000;
  let expired = false;
  const starting = api.begin({ sessionId: options.sessionId, generation: options.generation, selectionToken: options.selectionToken })
    .then(value => {
      const parsed = parseBegin(value, options.sessionId, options.generation, options.selectionToken);
      if (expired) void api.cancel({ captureId: parsed.captureId, sessionId: parsed.sessionId, generation: parsed.generation }).catch(() => {});
      return parsed;
    });
  let reply: BeginReply;
  try { reply = await bounded(starting, timeoutMs); }
  catch (error) { expired = true; throw error; }
  const identity = Object.freeze({ captureId: reply.captureId, sessionId: reply.sessionId, generation: reply.generation });
  const descriptor = createCaptureDescriptor({ backend: "native", sessionId: identity.sessionId, generation: identity.generation,
    sourceSampleRate: reply.sampleRate, sourceChannels: 2, deliveredChannels: 1,
    sourceIdentity: JSON.stringify(reply.source), conversion: "s16le-stereo-average" });
  let cancelled = false, stopping = false, started = false, sequence = 0, frames = 0, failure: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: Promise<NativeCaptureReceipt> | null = null, stopPromise: Promise<NativeCaptureReceipt> | null = null;
  const remembered = new Map<number, { start: number; bytes: Uint8Array }>();
  let lastSampleAt = performance.now();
  function interrupt(error: unknown) {
    if (failure || cancelled) return;
    failure = error instanceof Error ? error.message : String(error);
    options.onInterrupted(failure);
  }
  async function drain(budgetMs = timeoutMs): Promise<NativeCaptureReceipt> {
    const requestedAck = sequence;
    const batch = parseNativeBatch(await bounded(api.drain({ ...identity, ackThroughSequence: requestedAck }), budgetMs), identity);
    if (batch.receipt.acknowledgedSequence > requestedAck) throw new Error("Native capture acknowledged unretained audio");
    if (cancelled) throw new Error("Native capture cancelled");
    if (!batch.receipt.health.healthy) interrupt(batch.receipt.health.reason ?? "Native microphone capture interrupted");
    for (const b of batch.blocks) {
      const bytes = batch.pcm.slice(b.byteOffset, b.byteOffset + b.byteLength);
      if (b.sequence <= sequence) {
        const prior = remembered.get(b.sequence);
        if (!prior || prior.start !== b.frameStart || prior.bytes.length !== bytes.length || !bytes.every((v, i) => v === prior.bytes[i])) throw new Error("Conflicting native capture replay");
        continue;
      }
      if (b.sequence !== sequence + 1 || b.frameStart !== frames) throw new Error("Native capture delivery gap");
      if (options.onSamples(nativeStereoToMono(bytes)) !== b.frames) throw new Error("Native capture block was not fully retained");
      lastSampleAt = performance.now();
      sequence = b.sequence; frames += b.frames; remembered.set(sequence, { start: b.frameStart, bytes });
      if (remembered.size > 8) remembered.delete(remembered.keys().next().value!);
    }
    if (!stopping && performance.now() - lastSampleAt >= 5000) interrupt("Native microphone stopped delivering audio");
    if (batch.receipt.limitReached && !stopping) options.onLimit();
    return batch.receipt;
  }
  function nextDrain(budgetMs = timeoutMs): Promise<NativeCaptureReceipt> {
    if (active) return active;
    active = drain(budgetMs).finally(() => { active = null; });
    return active;
  }
  function schedule() {
    if (cancelled || stopping || failure) return;
    timer = setTimeout(() => {
      timer = null;
      void nextDrain().catch(interrupt).finally(schedule);
    }, pollMs);
  }
  return {
    descriptor, identity,
    startDelivery() { if (!started && !cancelled) { started = true; schedule(); } },
    stopAndDrain() {
      if (stopPromise) return stopPromise;
      stopping = true; if (timer !== null) clearTimeout(timer); timer = null;
      stopPromise = (async () => {
        const deadline = performance.now() + timeoutMs;
        if (active) await active.catch(interrupt);
        while (!cancelled && performance.now() < deadline) {
          const terminal = parseNativeReceipt(await bounded(api.stop(identity), Math.max(1, deadline - performance.now())));
          if (!terminal.health.healthy) interrupt(terminal.health.reason ?? "Native microphone capture interrupted");
          const received = await nextDrain(Math.max(1, deadline - performance.now()));
          if (terminal.state === "stopped" && received.state === "stopped" &&
              terminal.producedFrames === received.producedFrames && terminal.lastSequence === received.lastSequence &&
              received.lastSequence === sequence && received.acknowledgedSequence === sequence && received.producedFrames === frames) {
            if (failure || !received.corkAcknowledged || !received.barrierAcknowledged || !received.health.healthy) throw new Error(failure ?? "Native capture tail unconfirmed");
            return received;
          }
          await new Promise(resolve => setTimeout(resolve, pollMs));
        }
        throw new Error("Native capture stop/drain deadline exceeded");
      })().catch(error => { interrupt(error); throw error; });
      return stopPromise;
    },
    async cancel() {
      if (cancelled) return;
      cancelled = true; if (timer !== null) clearTimeout(timer); timer = null;
      await bounded(api.cancel(identity), timeoutMs);
    },
  };
}
