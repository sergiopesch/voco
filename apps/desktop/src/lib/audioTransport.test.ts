import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAudioRequest } from "./audioTransport";
import { previewTranscribeAudio, transcribeAudio, transcribeCanonicalChunk, transcribeHybridChunk } from "./tauri";
import { beginHybridAttempt, createHybridSession, prepareHybridRequest } from "./hybridSession";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue("") }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("binary audio transport", () => {
  beforeEach(() => invoke.mockClear());

  it("sends raw bodies through every recognition command, including subarray views", async () => {
    const samples = new Float32Array([99, 0.25, -0.5, 99]).subarray(1, 3);
    await transcribeAudio(samples);
    await previewTranscribeAudio(samples);
    await previewTranscribeAudio(samples, true);
    await transcribeCanonicalChunk(samples, "naïve 🦀");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "transcribe_audio", "preview_transcribe_audio", "preview_desktop_audio", "transcribe_canonical_chunk",
    ]);
    invoke.mock.calls.forEach(([, packet], index) => {
      expect(packet).toBeInstanceOf(Uint8Array);
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      const metadataSize = view.getUint32(4, true);
      expect(new TextDecoder().decode(packet.slice(0, 4))).toBe("VCA1");
      expect(JSON.parse(new TextDecoder().decode(packet.slice(8, 8 + metadataSize))))
        .toEqual({ previousCanonicalText: index === 3 ? "naïve 🦀" : "" });
      expect(packet.length).toBe(8 + metadataSize + 8);
      expect(view.getFloat32(8 + metadataSize, true)).toBe(0.25);
      expect(view.getFloat32(12 + metadataSize, true)).toBe(-0.5);
    });
  });

  it("keeps a thirty-second recording within forty bytes of its raw payload", () => {
    const samples = new Float32Array(16_000 * 30);
    expect(encodeAudioRequest(samples).length - samples.byteLength).toBeLessThan(40);
  });

  it("passes the owned hybrid packet through raw IPC without rewriting identity or PCM", async () => {
    const state = beginHybridAttempt(prepareHybridRequest(createHybridSession(7, 3),
      new Float32Array([99, -0, 0.25, 99]).subarray(1, 3), true));
    const packet = state.active!.packet();
    await transcribeHybridChunk(packet);
    expect(invoke).toHaveBeenCalledWith("transcribe_hybrid_chunk", packet);
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const metadataSize = view.getUint32(4, true);
    expect(new TextDecoder().decode(packet.subarray(0, 4))).toBe("VCA2");
    expect(JSON.parse(new TextDecoder().decode(packet.subarray(8, 8 + metadataSize))))
      .toEqual(state.active!.metadata);
    expect(view.getUint32(8 + metadataSize, true)).toBe(0x80000000);
    expect(view.getFloat32(12 + metadataSize, true)).toBe(0.25);
  });

  it("bounds recordings and canonical metadata", () => {
    expect(() => encodeAudioRequest(new Float32Array())).toThrow();
    expect(() => encodeAudioRequest(new Float32Array(16_000 * 600 + 1))).toThrow();
    expect(() => encodeAudioRequest(new Float32Array(1), "x".repeat(1024 * 1024))).toThrow();
  });
});
