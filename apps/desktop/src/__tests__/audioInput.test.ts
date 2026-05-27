import { describe, expect, it } from "vitest";
import { chooseAudioInputDeviceId } from "@/lib/audioInput";

const DEVICES = [
  { deviceId: "speaker-monitor", kind: "audiooutput" as const, label: "Speaker" },
  { deviceId: "built-in", kind: "audioinput" as const, label: "Built-in Microphone" },
  { deviceId: "virtual", kind: "audioinput" as const, label: "VOCO runtime source" },
];

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
});
