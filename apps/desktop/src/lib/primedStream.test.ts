import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DictationSessionPhase } from "./dictationSession";
import { expirePrimedStream, PRIMED_STREAM_MS } from "./primedStream";

function primedStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
  return { stream, stop, primed: { current: stream as MediaStream | null } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it.each(["idle", "error", "recording", "stopping"] as const)("closes a stream no start took while the session is %s", (phase) => {
  const { stream, stop, primed } = primedStream();
  expirePrimedStream(stream, primed, () => phase);
  vi.advanceTimersByTime(PRIMED_STREAM_MS - 1);
  expect(stop).not.toHaveBeenCalled();
  expect(primed.current).toBe(stream);
  vi.advanceTimersByTime(1);
  expect(stop).toHaveBeenCalledTimes(2);
  expect(primed.current).toBeNull();
});

it("leaves the stream to a start in flight, which takes it or closes it", () => {
  const { stream, stop, primed } = primedStream();
  let phase: DictationSessionPhase = "starting";
  expirePrimedStream(stream, primed, () => phase);
  vi.advanceTimersByTime(PRIMED_STREAM_MS);
  expect(stop).not.toHaveBeenCalled();
  expect(primed.current).toBe(stream);
  phase = "idle";
  vi.advanceTimersByTime(PRIMED_STREAM_MS);
  expect(stop).not.toHaveBeenCalled();
});

it("touches nothing once a start took the stream, or another replaced it", () => {
  const taken = primedStream();
  expirePrimedStream(taken.stream, taken.primed, () => "idle");
  taken.primed.current = null;
  vi.advanceTimersByTime(PRIMED_STREAM_MS);
  expect(taken.stop).not.toHaveBeenCalled();

  const replaced = primedStream();
  const next = primedStream();
  expirePrimedStream(replaced.stream, replaced.primed, () => "idle");
  replaced.primed.current = next.stream;
  vi.advanceTimersByTime(PRIMED_STREAM_MS);
  expect(replaced.stop).not.toHaveBeenCalled();
  expect(replaced.primed.current).toBe(next.stream);
});
