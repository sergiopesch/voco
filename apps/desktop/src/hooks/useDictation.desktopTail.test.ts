// Execute production capture/Stop-tail accounting and the actual NVIDIA queue
// with deterministic capture and worker IPC; no microphone/model required.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as buffers from "@/lib/audioCaptureBuffer";
const transport = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport }));
import { BenchmarkPhraseQueue } from "@/lib/benchmarkPhraseQueue";
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
  const queue = new BenchmarkPhraseQueue(paste, vi.fn(), failure, vi.fn());
  const native = { current: null as null | { stopAndDrain(): Promise<void> } };
  const flush = vi.fn(async () => {});
  const disconnect = vi.fn();
  const fns = createDesktopCaptureTail({
    recordingSampleRate: () => rate, maxAudioSeconds: limitSeconds,
    captureHealthRef: { current: null },
    phaseRef: phase, audioBufferRef: { current: buffer },
    desktopPhraseQueueRef: { current: queue },
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
