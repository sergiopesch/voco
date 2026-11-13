import { afterEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ value: { allowed: true } as { allowed: boolean; detail?: string } }));
const systemDefault = vi.hoisted(() => ({ label: null as string | null, fails: false }));
vi.mock("@/lib/tauri", () => ({
  microphoneAccess: async () => access.value,
  defaultMicrophoneLabel: async () => {
    if (systemDefault.fails) throw new Error("The sound server can't be asked");
    return systemDefault.label;
  },
}));

import { chooseDefaultAudioInputDeviceId, openMicrophoneStream } from "@/lib/audioInput";

afterEach(() => {
  vi.unstubAllGlobals();
  access.value = { allowed: true };
  systemDefault.label = null;
  systemDefault.fails = false;
});

const input = (deviceId: string, label: string) => ({ deviceId, label, kind: "audioinput" as MediaDeviceKind });
const listed = [input("a", "Built-in Audio Analog Stereo"), input("b", "Loopback Analog Stereo"), input("c", "USB Headset Mono")];

function microphones(devices: Array<{ deviceId: string; label: string; kind: MediaDeviceKind }>[]) {
  const stream = { getTracks: () => [] };
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
  // Each enumeration returns the next list, the last one from then on.
  const enumerateDevices = vi.fn(async () => devices[Math.min(enumerateDevices.mock.calls.length - 1, devices.length - 1)]);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices } });
  return { getUserMedia, stream };
}

const requestedDevice = (getUserMedia: ReturnType<typeof microphones>["getUserMedia"], call = 0) =>
  (getUserMedia.mock.calls[call]?.[0].audio as MediaTrackConstraints).deviceId;

describe("openMicrophoneStream", () => {
  it("opens no microphone the snap can't use, and names what to do", async () => {
    const { getUserMedia } = microphones([[]]);
    access.value = { allowed: false, detail: "Quit VOCO and open it again." };
    await expect(openMicrophoneStream(null)).rejects.toThrow("Quit VOCO and open it again.");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("opens the microphone when it may", async () => {
    const { getUserMedia, stream } = microphones([[]]);
    await expect(openMicrophoneStream(null)).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("opens the system's default microphone when none is chosen, not the first one listed", async () => {
    const { getUserMedia } = microphones([listed]);
    systemDefault.label = "USB Headset Mono";
    await openMicrophoneStream(null);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(requestedDevice(getUserMedia)).toEqual({ exact: "c" });
  });

  it("leaves the choice to WebKit when the list has no device with the default's label", async () => {
    const { getUserMedia } = microphones([listed]);
    systemDefault.label = "Virtual microphone";
    await openMicrophoneStream(null);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(requestedDevice(getUserMedia)).toBeUndefined();
  });

  it("leaves the choice to WebKit when the sound server can't be asked", async () => {
    const { getUserMedia } = microphones([listed]);
    systemDefault.fails = true;
    await openMicrophoneStream(null);
    expect(requestedDevice(getUserMedia)).toBeUndefined();
  });

  it("opens a microphone once to learn the labels WebKit hides until then", async () => {
    const unnamed = listed.map((device) => ({ ...device, label: "" }));
    const { getUserMedia } = microphones([unnamed, listed]);
    systemDefault.label = "USB Headset Mono";
    await openMicrophoneStream(null);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({ audio: true });
    expect(requestedDevice(getUserMedia, 1)).toEqual({ exact: "c" });
  });

  it("keeps a chosen microphone whatever the system's default is", async () => {
    const { getUserMedia } = microphones([listed]);
    systemDefault.label = "USB Headset Mono";
    await openMicrophoneStream("b");
    expect(requestedDevice(getUserMedia)).toEqual({ exact: "b" });
  });
});

describe("chooseDefaultAudioInputDeviceId", () => {
  it("matches the whole label without case, and only microphones", () => {
    expect(chooseDefaultAudioInputDeviceId("usb headset mono", listed)).toBe("c");
    expect(chooseDefaultAudioInputDeviceId("USB Headset", listed)).toBeNull();
    expect(chooseDefaultAudioInputDeviceId("", listed)).toBeNull();
    const speaker = { deviceId: "s", label: "USB Headset Mono", kind: "audiooutput" as MediaDeviceKind };
    expect(chooseDefaultAudioInputDeviceId("USB Headset Mono", [speaker])).toBeNull();
  });
});
