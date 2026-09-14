import { describe, expect, it } from "vitest";
import { createCaptureDescriptor } from "./captureDescriptor";
import { encodeNativeRetainedSource } from "./nativeCaptureAudit";

const identity = { captureId: "native-1-1", sessionId: 2, generation: 4 };
const descriptor = createCaptureDescriptor({
  backend: "native", sessionId: 2, generation: 4, sourceSampleRate: 44100,
  sourceChannels: 2, deliveredChannels: 1, sourceIdentity: "explicit-source",
  conversion: "s16le-stereo-average",
});

describe("native retained source evidence", () => {
  it("preserves the actual source including DC, signs, subarray bounds and float bits", () => {
    const storage = new Float32Array([999, 0.25, -0, -0.125, 0.9999847412109375, 888]);
    const source = storage.subarray(1, 5);
    const packet = encodeNativeRetainedSource(source, identity, descriptor, "healthy-stop");
    const view = new DataView(packet.buffer), length = view.getUint32(0, true);
    const metadata = JSON.parse(new TextDecoder().decode(packet.subarray(4, 4 + length)));
    expect(metadata).toMatchObject({ nativeCaptureIdentity: identity, captureDescriptor: descriptor,
      sampleCount: 4, byteLength: 16, terminalOutcome: "healthy-stop",
      stage: "renderer-retained-source-before-dc-resample", sampleFormat: "f32le" });
    source.fill(0); // Later buffer preparation or clearing cannot change the packet.
    expect(view.getFloat32(4 + length, true)).toBe(0.25);
    expect(Object.is(view.getFloat32(8 + length, true), -0)).toBe(true);
    expect(view.getFloat32(12 + length, true)).toBe(-0.125);
    expect(view.getFloat32(16 + length, true)).toBe(0.9999847412109375);
    expect(packet.byteLength).toBe(4 + length + 16);
  });

  it("rejects wrong generation, wrong sample rate and non-finite source data", () => {
    expect(() => encodeNativeRetainedSource(new Float32Array([1]), { ...identity, generation: 5 }, descriptor, "healthy-stop")).toThrow();
    expect(() => encodeNativeRetainedSource(new Float32Array([1]), identity, { ...descriptor, sourceSampleRate: 48000 }, "healthy-stop")).toThrow();
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => encodeNativeRetainedSource(new Float32Array([value]), identity, descriptor, "healthy-stop")).toThrow("non-finite");
    }
  });

  it("keeps interrupted and empty evidence distinct from healthy capture", () => {
    const packet = encodeNativeRetainedSource(new Float32Array(), identity, descriptor, "interrupted");
    const length = new DataView(packet.buffer).getUint32(0, true);
    expect(JSON.parse(new TextDecoder().decode(packet.subarray(4, 4 + length))))
      .toMatchObject({ terminalOutcome: "interrupted", sampleCount: 0, byteLength: 0 });
  });
});
