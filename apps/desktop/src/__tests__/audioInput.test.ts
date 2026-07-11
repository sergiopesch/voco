import { afterEach, describe, expect, it } from "vitest";
import {
  buildAudioConstraints,
  chooseAudioInputDeviceId,
  openMicrophoneStreamWithDiagnostics,
} from "@/lib/audioInput";

const DEVICES = [
  { deviceId: "speaker-monitor", kind: "audiooutput" as const, label: "Speaker" },
  { deviceId: "built-in", kind: "audioinput" as const, label: "Built-in Microphone" },
  { deviceId: "virtual", kind: "audioinput" as const, label: "VOCO runtime source" },
];

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

afterEach(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

function constraintError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

function installMockMediaDevices(options: {
  devices?: MediaDeviceInfo[];
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}) {
  const getUserMediaCalls: MediaStreamConstraints[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        enumerateDevices: async () => options.devices ?? [],
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          getUserMediaCalls.push(constraints);
          return options.getUserMedia(constraints);
        },
      },
    },
  });
  return { getUserMediaCalls };
}

function mockStream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

describe("audio input device selection", () => {
  it("uses the saved exact device id first", () => {
    expect(chooseAudioInputDeviceId("built-in", DEVICES)).toBe("built-in");
  });

  it("resolves label-prefixed microphone preferences", () => {
    expect(chooseAudioInputDeviceId("label:runtime source", DEVICES)).toBe("virtual");
  });

  it("leaves unresolved preferences unchanged so getUserMedia can fail clearly", () => {
    expect(chooseAudioInputDeviceId("label:missing device", DEVICES)).toBe(
      "label:missing device",
    );
  });

  it("keeps the system default when no preferred device is configured", () => {
    expect(chooseAudioInputDeviceId(null, DEVICES)).toBeNull();
  });

  it("keeps raw capture processing disabled unless requested", () => {
    expect(buildAudioConstraints("mic-1")).toMatchObject({
      deviceId: { exact: "mic-1" },
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    });
  });

  it("allows realtime capture to request echo control", () => {
    expect(
      buildAudioConstraints("mic-1", {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }),
    ).toMatchObject({
      deviceId: { exact: "mic-1" },
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
    });
  });

  it("reports no fallback when ideal microphone constraints work", async () => {
    const { getUserMediaCalls } = installMockMediaDevices({
      getUserMedia: async () => mockStream(),
    });

    const result = await openMicrophoneStreamWithDiagnostics(null);

    expect(result.fallbackStage).toBe("none");
    expect(result.selectedDeviceConfigured).toBe(false);
    expect(getUserMediaCalls).toHaveLength(1);
    expect(getUserMediaCalls[0]?.audio).toMatchObject({
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: false },
    });
  });

  it("falls back to minimal constraints after an overconstrained ideal request", async () => {
    let attempt = 0;
    const { getUserMediaCalls } = installMockMediaDevices({
      getUserMedia: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw constraintError("OverconstrainedError");
        }
        return mockStream();
      },
    });

    const result = await openMicrophoneStreamWithDiagnostics("mic-1");

    expect(result.fallbackStage).toBe("minimal-constraints");
    expect(result.selectedDeviceConfigured).toBe(true);
    expect(getUserMediaCalls).toHaveLength(2);
    expect(getUserMediaCalls[1]).toEqual({
      audio: {
        deviceId: { exact: "mic-1" },
      },
    });
  });

  it("falls back to the default device when a configured device is stale", async () => {
    const { getUserMediaCalls } = installMockMediaDevices({
      getUserMedia: async (constraints) => {
        if (constraints.audio !== true) {
          throw constraintError("NotFoundError");
        }
        return mockStream();
      },
    });

    const result = await openMicrophoneStreamWithDiagnostics("missing-mic");

    expect(result.fallbackStage).toBe("default-device");
    expect(result.selectedDeviceConfigured).toBe(true);
    expect(getUserMediaCalls).toHaveLength(3);
    expect(getUserMediaCalls[2]).toEqual({ audio: true });
  });

  it("falls back to the default device when default constraints are unsupported", async () => {
    const { getUserMediaCalls } = installMockMediaDevices({
      getUserMedia: async (constraints) => {
        if (constraints.audio !== true) {
          throw constraintError("OverconstrainedError");
        }
        return mockStream();
      },
    });

    const result = await openMicrophoneStreamWithDiagnostics(null);

    expect(result.fallbackStage).toBe("default-device");
    expect(result.selectedDeviceConfigured).toBe(false);
    expect(getUserMediaCalls).toHaveLength(3);
    expect(getUserMediaCalls[2]).toEqual({ audio: true });
  });

  it("does not hide permission failures behind fallback retries", async () => {
    installMockMediaDevices({
      getUserMedia: async () => {
        throw constraintError("NotAllowedError");
      },
    });

    await expect(openMicrophoneStreamWithDiagnostics(null)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });
});
