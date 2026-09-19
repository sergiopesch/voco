import { describe, expect, it } from "vitest";
import { createCaptureDescriptor, retainedSampleRate } from "./captureDescriptor";
describe("retained capture format", () => {
  it("keeps actual source rate after graph teardown and independent of later selection", () => {
    const descriptor = createCaptureDescriptor({ backend: "native", sessionId: 4, generation: 2,
      sourceSampleRate: 44100, sourceChannels: 2, deliveredChannels: 1, sourceIdentity: "approved-source",
      conversion: "s16le-stereo-average" });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(retainedSampleRate(descriptor, 44100)).toBe(44100);
    expect(() => retainedSampleRate(null, 44100)).toThrow("no capture format");
    expect(retainedSampleRate(null, 0)).toBe(16000);
  });
  it.each([96001,176400,192000,384000])("rejects unsupported %i Hz before capture admission", rate => {
    expect(() => createCaptureDescriptor({backend:"webkit",sessionId:1,generation:0,
      sourceSampleRate:rate,sourceChannels:1,deliveredChannels:1,sourceIdentity:null,
      conversion:"webaudio-mono"})).toThrow("8 to 96 kHz");
  });
  it.each([8000,44100,48000,96000])("accepts supported %i Hz unchanged", rate => {
    expect(createCaptureDescriptor({backend:"webkit",sessionId:1,generation:0,
      sourceSampleRate:rate,sourceChannels:1,deliveredChannels:1,sourceIdentity:null,
      conversion:"webaudio-mono"}).sourceSampleRate).toBe(rate);
  });
  it("does not silently repair invalid source formats or identity", () => {
    const base = { backend: "native" as const, sessionId: 1, generation: 0, sourceSampleRate: 44100,
      sourceChannels: 2, deliveredChannels: 1 as const, sourceIdentity: "source", conversion: "s16le-stereo-average" as const };
    for (const delta of [{sourceSampleRate:NaN},{sourceSampleRate:0},{sourceIdentity:null},{sourceChannels:1},{sessionId:0}])
      expect(() => createCaptureDescriptor({...base,...delta})).toThrow();
  });
});
