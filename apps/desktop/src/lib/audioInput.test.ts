import { afterEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ value: { allowed: true } as { allowed: boolean; detail?: string } }));
vi.mock("@/lib/tauri", () => ({ microphoneAccess: async () => access.value }));

import { openMicrophoneStream } from "@/lib/audioInput";

afterEach(() => {
  vi.unstubAllGlobals();
  access.value = { allowed: true };
});

describe("openMicrophoneStream", () => {
  it("opens no microphone the snap can't use, and names what to do", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
    access.value = { allowed: false, detail: "Quit VOCO and open it again." };
    await expect(openMicrophoneStream(null)).rejects.toThrow("Quit VOCO and open it again.");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("opens the microphone when it may", async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
    await expect(openMicrophoneStream(null)).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
