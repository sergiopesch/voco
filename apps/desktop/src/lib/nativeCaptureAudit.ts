import { createCaptureDescriptor, type CaptureDescriptor } from "./captureDescriptor";
import type { NativeCaptureIdentity } from "./nativeCapture";

export type NativeCaptureTerminalOutcome = "healthy-stop" | "interrupted" | "cancelled";
export const MAX_NATIVE_SOURCE_SAMPLES = 26_460_000;

/** Snapshot the renderer's retained source, before any DC removal or resampling. */
export function encodeNativeRetainedSource(
  samples: Float32Array,
  identity: NativeCaptureIdentity,
  descriptor: CaptureDescriptor,
  terminalOutcome: NativeCaptureTerminalOutcome,
): Uint8Array {
  createCaptureDescriptor(descriptor);
  if (descriptor.backend !== "native" || descriptor.sourceSampleRate !== 44100 ||
      identity.sessionId !== descriptor.sessionId || identity.generation !== descriptor.generation ||
      typeof identity.captureId !== "string" || !identity.captureId || identity.captureId.length > 256 ||
      samples.length > MAX_NATIVE_SOURCE_SAMPLES ||
      !["healthy-stop", "interrupted", "cancelled"].includes(terminalOutcome)) {
    throw new Error("Invalid native retained-source evidence");
  }
  const header = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    nativeCaptureIdentity: identity,
    captureDescriptor: descriptor,
    stage: "renderer-retained-source-before-dc-resample",
    sampleFormat: "f32le",
    sampleCount: samples.length,
    byteLength: samples.byteLength,
    terminalOutcome,
  }));
  if (header.length > 65_536) throw new Error("Native retained-source header exceeds limit");
  const packet = new Uint8Array(4 + header.length + samples.byteLength);
  const view = new DataView(packet.buffer);
  view.setUint32(0, header.length, true);
  packet.set(header, 4);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample === undefined || !Number.isFinite(sample)) throw new Error("Native retained source contains a non-finite sample");
    view.setFloat32(4 + header.length + i * 4, sample, true);
  }
  return packet;
}
