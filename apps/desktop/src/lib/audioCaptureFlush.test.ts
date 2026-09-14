import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCaptureFlushError, CAPTURE_INPUT_INTERRUPTED, createAudioCaptureFlush } from "./audioCaptureFlush";

afterEach(() => vi.useRealTimers());

describe("capture flush acknowledgment", () => {
  it("accepts an acknowledgment before the deadline and releases its timer", async () => {
    vi.useFakeTimers();
    const flush = createAudioCaptureFlush();
    await vi.advanceTimersByTimeAsync(79);
    flush.acknowledge();
    await expect(flush.completion).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a missing acknowledgment; a late acknowledgment cannot reverse failure", async () => {
    vi.useFakeTimers();
    const flush = createAudioCaptureFlush();
    const result = expect(flush.completion).rejects.toBeInstanceOf(AudioCaptureFlushError);
    await vi.advanceTimersByTimeAsync(80);
    flush.acknowledge();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels on graph disposal or a rejected port without affecting another graph", async () => {
    vi.useFakeTimers();
    const old = createAudioCaptureFlush();
    const result = expect(old.completion).rejects.toBeInstanceOf(AudioCaptureFlushError);
    old.cancel();
    const next = createAudioCaptureFlush();
    old.acknowledge();
    let complete = false;
    void next.completion.then(() => { complete = true; });
    await result;
    expect(complete).toBe(false);
    next.acknowledge();
    await next.completion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves an interrupted-input reason even if a healthy acknowledgment arrives later", async () => {
    vi.useFakeTimers();
    const flush = createAudioCaptureFlush();
    const result = expect(flush.completion).rejects.toThrow(CAPTURE_INPUT_INTERRUPTED);
    flush.cancel(CAPTURE_INPUT_INTERRUPTED);
    flush.acknowledge();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
