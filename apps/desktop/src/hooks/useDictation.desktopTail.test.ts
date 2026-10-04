// Execute production capture/Stop-tail accounting and the actual DictationStream
// with deterministic capture and worker IPC; no microphone/model required.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as buffers from "@/lib/audioCaptureBuffer";
const transport = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport }));
import { DictationStream } from "@/lib/dictationStream";
import {
  createDesktopCaptureTail,
  type DesktopCaptureTailEnv,
} from "@/lib/desktopCaptureTail";

function harness(rate = 16000, limitSeconds = 600) {
  const buffer = buffers.createAudioCaptureBuffer();
  const phase = { current: "recording" };
  const sent = { current: 0 };
  const collect = vi.fn(buffers.collectAudioSamplesRange);
  const paste = vi.fn(async () => {});
  const failure = vi.fn();
  const queue = new DictationStream(paste, vi.fn(), failure, vi.fn());
  const native = { current: null as null | { stopAndDrain(): Promise<void> } };
  const flush = vi.fn(async () => {});
  const disconnect = vi.fn();
  const fns = createDesktopCaptureTail({
    recordingSampleRate: () => rate, maxAudioSeconds: limitSeconds,
    captureHealthRef: { current: null },
    isRecording: () => phase.current === "recording", audioBufferRef: { current: buffer },
    dictationStreamRef: { current: queue },
    desktopStreamedSampleCountRef: sent,
    traceDictationEvent: vi.fn(async () => {}), stopRecording: vi.fn(),
    nativeCaptureRef: native, cancelledRef: { current: null },
    persistNativeRetainedSource: vi.fn(),
    flushCaptureSamples: flush, disconnectAudioGraph: disconnect,
    collectAudioSamplesRange: collect,
  } as unknown as DesktopCaptureTailEnv);
  const stop = async () => {
    phase.current = "stopping";
    await fns.teardownAudioGraph();
    fns.enqueueDesktopPhrase(buffer.sampleCount);
    await queue.finish();
  };
  return { ...fns, stop, rate, buffer, phase, sent, collect, paste, failure, queue, native, flush, disconnect };
}
const packets = () => transport.mock.calls.map(c => c[1].request).filter(r => r.op === "push");
const received = () => packets().flatMap(r => r.audio);
const fixture = (size: number, offset = 0) => Float32Array.from({ length: size }, (_, i) => (i + offset) / 10000);
beforeEach(() => {
  transport.mockReset().mockImplementation(async (_command, { request }) => ({ ...request, mode: "append-only", text: null }));
});

describe("NVIDIA capture drain and Stop-tail accounting", () => {
  it.each([16000, 48000])("sends delayed native drain samples exactly once at %i Hz", async rate => {
    const h = harness(rate);
    const live = fixture(Math.round(rate * .02) + 17);
    const tail = fixture(53, live.length);
    h.appendRecordingSamples(live);
    let release!: () => void;
    h.native.current = { stopAndDrain: () => new Promise<void>(resolve => {
      release = () => { h.appendRecordingSamples(tail); resolve(); };
    }) };
    const stopped = h.stop();
    expect(h.phase.current).toBe("stopping");
    expect(h.sent.current).toBe(live.length);
    release(); await stopped;
    expect(received()).toEqual([...live, ...tail]);
    expect(h.buffer.sampleCount).toBe(live.length + tail.length);
    expect(h.sent.current).toBe(h.buffer.sampleCount);
    expect(h.collect).toHaveBeenCalledExactlyOnceWith(h.buffer, live.length, tail.length);
    expect(packets().every(p => p.rate === rate)).toBe(true);
  });
  it("preserves worklet flush tail and disconnects before finalizing input", async () => {
    const h = harness(); const live = fixture(321), tail = fixture(79,321);
    h.appendRecordingSamples(live);
    h.flush.mockImplementation(async () => { await Promise.resolve(); h.appendRecordingSamples(tail); });
    await h.stop();
    expect(h.disconnect).toHaveBeenCalledOnce();
    expect(received()).toEqual([...live,...tail]);
    expect(h.collect).toHaveBeenCalledExactlyOnceWith(h.buffer,321,79);
  });
  it("does not recopy an already streamed recording at Stop", async () => {
    const h = harness(); const live = fixture(645);
    h.appendRecordingSamples(live); await h.stop();
    expect(h.collect).not.toHaveBeenCalled();
    expect(received()).toEqual(Array.from(live));
  });
  it("preserves a retained startup prefix without replaying it at Stop", async () => {
    const h = harness(); const prefix=fixture(43),live=fixture(287,43),tail=fixture(11,330);
    buffers.appendAudioSamples(h.buffer,prefix);
    h.queue.pushAudio(prefix,h.rate); h.sent.current=prefix.length;
    h.appendRecordingSamples(live);
    h.flush.mockImplementation(async()=>{h.appendRecordingSamples(tail);});
    await h.stop();
    expect(received()).toEqual([...prefix,...live,...tail]);
    expect(h.collect).toHaveBeenCalledExactlyOnceWith(h.buffer,330,11);
  });
  it("finishes empty recordings explicitly", async () => {
    const h=harness(); await h.stop();
    expect(transport.mock.calls.filter(c=>c[1].request.op==='finish')).toHaveLength(1);
    expect(h.collect).not.toHaveBeenCalled();expect(received()).toEqual([]);
  });
  it("cancellation retains drained audio but cannot send or paste the late tail", async () => {
    const h=harness(); const live=fixture(1600),tail=fixture(55,1600);
    h.appendRecordingSamples(live);await vi.waitFor(()=>expect(received()).toEqual(Array.from(live)));
    h.queue.cancel();h.flush.mockImplementation(async()=>{h.appendRecordingSamples(tail);});
    await h.stop();
    expect(h.buffer.sampleCount).toBe(1655);expect(received()).toEqual(Array.from(live));
    expect(h.paste).not.toHaveBeenCalled();
    expect(transport.mock.calls.some(c=>c[1].request.op==='finish')).toBe(false);
  });
  it("failed capture drain retains audio and does not finish incomplete input", async () => {
    const h=harness();h.appendRecordingSamples(fixture(320));
    h.native.current={stopAndDrain:async()=>{h.appendRecordingSamples(fixture(37,320));throw new Error('capture gap');}};
    await expect(h.stop()).rejects.toThrow();
    expect(h.buffer.sampleCount).toBe(357);expect(h.sent.current).toBe(320);
    expect(h.collect).not.toHaveBeenCalled();
    expect(transport.mock.calls.some(c=>c[1].request.op==='finish')).toBe(false);
  });
  it("streams only the retained portion when Stop drain reaches the capture limit", async () => {
    const h=harness(16000,1);const live=fixture(15990),tail=fixture(40,15990);
    h.appendRecordingSamples(live);
    h.flush.mockImplementation(async()=>{expect(h.appendRecordingSamples(tail)).toBe(10);});
    await h.stop();
    expect(h.buffer.sampleCount).toBe(16000);expect(h.sent.current).toBe(16000);
    expect(received()).toEqual([...live,...tail.subarray(0,10)]);
    expect(h.collect).toHaveBeenCalledExactlyOnceWith(h.buffer,15990,10);
  });
  it("a repeated finish cannot duplicate the drained tail", async () => {
    const h=harness();h.appendRecordingSamples(fixture(320));
    h.phase.current='stopping';h.appendRecordingSamples(fixture(43,320));
    h.enqueueDesktopPhrase(h.buffer.sampleCount);await h.queue.finish();
    h.enqueueDesktopPhrase(h.buffer.sampleCount);await h.queue.finish();
    expect(received()).toEqual(Array.from(fixture(363)));expect(h.collect).toHaveBeenCalledOnce();
    expect(transport.mock.calls.filter(c=>c[1].request.op==='finish')).toHaveLength(1);
  });
});

// Hold a real worker push across Stop, rather than substituting queue.finish.
// Only IPC is mocked: packet admission and capture retention are real.
describe("Stop while the recognizer is behind capture", () => {
  it.each([16000, 44100])("waits for the unresolved push and sends the Stop tail once at %i Hz", async rate => {
    let release!: () => void;
    let pushing = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transport.mockImplementation(async (_command, { request }) => {
      if (request.op === "push" && request.seq === 1) {
        pushing = true;
        await gate;
      }
      return { ...request, mode: "append-only", text: request.op === "finish"
        ? "First tail." : request.op === "push" ? "First" : null };
    });
    const h = harness(rate), packetSize = Math.round(rate * .1);
    const live = fixture(packetSize * 2 + 17), tail = fixture(53, live.length);
    h.appendRecordingSamples(live.subarray(0, packetSize));
    await vi.waitFor(() => expect(pushing).toBe(true));
    h.appendRecordingSamples(live.subarray(packetSize));
    h.flush.mockImplementation(async () => { h.appendRecordingSamples(tail); });
    let settled = false;
    const stopped = h.stop().then(() => { settled = true; });
    await vi.waitFor(() => expect(h.collect).toHaveBeenCalledOnce());
    expect(h.disconnect).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(packets()).toHaveLength(1);
    expect(transport.mock.calls.some(([, { request }]) => request.op === "finish")).toBe(false);
    expect(h.paste).not.toHaveBeenCalled();
    release();
    await stopped;
    expect(settled).toBe(true);
    expect(h.failure).not.toHaveBeenCalled();
    expect(h.paste).toHaveBeenNthCalledWith(1, "First", expect.any(Object));
    expect(h.paste).toHaveBeenNthCalledWith(2, " tail.", expect.any(Object));
    expect(h.paste).toHaveBeenCalledTimes(2);
    expect(packets().map(request => request.audio.length)).toEqual([packetSize, packetSize, 70]);
    expect(received()).toEqual([...live, ...tail]);
    expect(h.collect).toHaveBeenCalledExactlyOnceWith(h.buffer, live.length, tail.length);
    const operations = transport.mock.calls.map(([, { request }]) => request)
      .filter(request => ["start", "push", "finish"].includes(request.op));
    expect(operations.map(request => request.op)).toEqual(["start", "push", "push", "push", "finish"]);
    expect(operations.map(request => request.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(operations.map(request => request.session)).size).toBe(1);
    expect(packets().every(request => request.rate === rate)).toBe(true);
  });

  it.each([16000, 44100])("keeps capturing through the Stop tail after gradual overload at %i Hz", async rate => {
    let release!: () => void;
    let pushing = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transport.mockImplementation(async (_command, { request }) => {
      if (request.op === "push" && request.seq === 1) {
        pushing = true;
        await gate;
      }
      return { ...request, mode: "append-only", text: request.op === "push" ? "Late prefix" : null };
    });
    const h = harness(rate), packetSize = Math.round(rate * .1);
    const live = fixture(packetSize * 32 + 19), tail = fixture(53, live.length);
    h.appendRecordingSamples(live.subarray(0, packetSize));
    await vi.waitFor(() => expect(pushing).toBe(true));
    // Separate capture callbacks accumulate behind the in-flight request, and
    // capture continues after admission fails.
    for (let offset = packetSize; offset < live.length; offset += packetSize) {
      h.appendRecordingSamples(live.subarray(offset, offset + packetSize));
      await Promise.resolve();
    }
    expect(h.failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: expect.stringContaining("three seconds"),
    }), "recognition");
    h.flush.mockImplementation(async () => { h.appendRecordingSamples(tail); });
    let settled = false;
    const stopped = h.stop().then(
      () => { settled = true; return null; },
      error => { settled = true; return error as Error; },
    );
    await vi.waitFor(() => expect(h.collect).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(h.buffer.sampleCount).toBe(live.length + tail.length);
    release();
    expect(await stopped).toMatchObject({ message: expect.stringContaining("three seconds") });
    expect(h.paste).not.toHaveBeenCalled();
    expect(packets()).toHaveLength(1);
    expect(transport.mock.calls.some(([command, { request }]) =>
      command === "speech_stream" && request.op === "finish")).toBe(false);
    const source = buffers.collectAudioSamplesRange(h.buffer, 0, h.buffer.sampleCount);
    expect(Array.from(source)).toEqual([...live, ...tail]);
  });
});
