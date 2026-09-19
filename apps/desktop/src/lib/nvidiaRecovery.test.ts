import { beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport }));
import { NvidiaRecovery } from "./nvidiaRecovery";

const calls = () => transport.mock.calls.map(([command, { request }]) => ({ command, ...request }));
beforeEach(() => {
  transport.mockReset().mockImplementation(async (_command, { request }) => ({
    ...request, mode: "append-only", text: request.op === "finish" ? "Recovered locally." : null,
  }));
});

it.each([8000, 16000, 44100, 48000, 96000, 176400, 192000, 384000])("preserves every source sample at %i Hz without delivery or resampling", async rate => {
  const audio = Float32Array.from({ length: Math.round(rate * 0.25) + 1 }, (_, i) => Math.sin(i / 20));
  const original = audio.slice();
  const recovery = new NvidiaRecovery();
  await expect(recovery.transcribe(audio, rate)).resolves.toBe("Recovered locally.");
  const requests = calls();
  expect(requests.every(r => r.command === "recover_stream")).toBe(true);
  expect(requests.map(r => r.op)).toEqual(["start", "push", "push", "push", "finish", "cancel"]);
  expect(requests.map(r => r.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(new Set(requests.map(r => r.session)).size).toBe(1);
  expect(requests.filter(r => r.op === "push").flatMap(r => r.audio)).toEqual(Array.from(original));
  expect(audio).toEqual(original);
});

it("cancellation rejects a late result, stops further packets and drains only its own worker", async () => {
  let release!: () => void;
  transport.mockImplementation(async (_command, { request }) => {
    if (request.op === "push") await new Promise<void>(resolve => { release = resolve; });
    return { ...request, mode: "append-only", text: "Late text" };
  });
  const recovery = new NvidiaRecovery();
  const result = recovery.transcribe(new Float32Array(16000), 16000);
  const rejected = expect(result).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(release).toBeDefined());
  recovery.cancel();
  let drained = false;
  void recovery.settled().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false);
  release(); await rejected; await recovery.settled();
  expect(calls().map(r => r.op)).toEqual(["start", "push", "cancel"]);
  expect(drained).toBe(true);
});

it.each(["session", "seq", "mode", "text"])("rejects malformed %s and cleans up without publishing partial text", async field => {
  transport.mockImplementation(async (_command, { request }) => ({
    ...request, mode: "append-only", text: "partial", [field]: { invalid: true },
  }));
  await expect(new NvidiaRecovery().transcribe(new Float32Array(10), 16000)).rejects.toThrow("Invalid recovery response");
  expect(calls().map(r => r.op)).toEqual(["start", "cancel"]);
});

it("a failed push never retries automatically and a new explicit attempt gets a new identity", async () => {
  transport.mockImplementation(async (_command, { request }) => {
    if (request.op === "push") throw new Error("worker died");
    return { ...request, mode: "append-only", text: null };
  });
  const audio = new Float32Array([0.25, -0.25]);
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(new NvidiaRecovery().transcribe(audio, 16000)).rejects.toThrow("worker died");
  }
  expect(calls().map(r => r.op)).toEqual(["start", "push", "cancel", "start", "push", "cancel"]);
  expect(calls()[0].session).not.toBe(calls()[3].session);
  expect(Array.from(audio)).toEqual([0.25, -0.25]);
});

it("requires a final transcript rather than treating a missing finish as success", async () => {
  transport.mockImplementation(async (_command, { request }) => ({ ...request, mode: "append-only", text: null }));
  await expect(new NvidiaRecovery().transcribe(new Float32Array(10), 16000)).rejects.toThrow("without a transcript");
});

it.each([
  [new Float32Array(), 16000], [new Float32Array([NaN]), 16000],
  [new Float32Array([Infinity]), 16000], [new Float32Array(1), 0],
  [new Float32Array(1), 16000.5], [new Float32Array(1), 384001],
  [new Float32Array(8000 * 600 + 1), 8000],
])("rejects invalid capture before opening a worker", async (audio, rate) => {
  await expect(new NvidiaRecovery().transcribe(audio, rate)).rejects.toThrow("Invalid recovery audio");
  expect(transport).not.toHaveBeenCalled();
});
