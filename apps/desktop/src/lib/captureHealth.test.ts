import { afterEach, describe, expect, it, vi } from "vitest";
import { monitorCaptureHealth } from "@/lib/captureHealth";

class Track extends EventTarget {
  muted = false;
  readyState = "live";
}

function monitor(track = new Track(), maximumDurationMs = 600_000) {
  const interrupted = vi.fn();
  const limit = vi.fn();
  const health = monitorCaptureHealth({
    stream: { getAudioTracks: () => [track as unknown as MediaStreamTrack] },
    onInterrupted: interrupted,
    onDurationLimit: limit,
    now: () => Date.now(),
    maximumDurationMs,
  });
  return { track, interrupted, limit, health };
}

afterEach(() => vi.useRealTimers());

describe("capture liveness", () => {
  it("detects a stalled stream without needing another sample callback", () => {
    vi.useFakeTimers();
    const { interrupted, health } = monitor();
    vi.advanceTimersByTime(4_750);
    health.samplesReceived();
    vi.advanceTimersByTime(4_750);
    expect(interrupted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(interrupted).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(interrupted).toHaveBeenCalledOnce();
  });

  it("treats silent but arriving samples as healthy and enforces elapsed duration", () => {
    vi.useFakeTimers();
    const { interrupted, limit, health } = monitor(new Track(), 6_000);
    for (let index = 0; index < 6; index++) {
      health.samplesReceived();
      vi.advanceTimersByTime(1_000);
    }
    expect(interrupted).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledOnce();
  });

  it("tolerates a brief mute but stops a prolonged system mute", () => {
    vi.useFakeTimers();
    const { track, interrupted, health } = monitor();
    track.dispatchEvent(new Event("mute"));
    vi.advanceTimersByTime(2_000);
    track.dispatchEvent(new Event("unmute"));
    health.samplesReceived();
    vi.advanceTimersByTime(2_000);
    expect(interrupted).not.toHaveBeenCalled();
    track.dispatchEvent(new Event("mute"));
    health.samplesReceived();
    vi.advanceTimersByTime(3_000);
    expect(interrupted).toHaveBeenCalledWith(expect.stringContaining("muted by the system"));
  });

  it("ends immediately on unplug and removes old event listeners on disposal", () => {
    vi.useFakeTimers();
    const first = monitor();
    first.health.dispose();
    first.track.dispatchEvent(new Event("ended"));
    vi.advanceTimersByTime(5_000);
    expect(first.interrupted).not.toHaveBeenCalled();
    const second = monitor();
    second.track.dispatchEvent(new Event("ended"));
    second.track.dispatchEvent(new Event("ended"));
    expect(second.interrupted).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
