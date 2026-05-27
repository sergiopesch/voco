import { describe, expect, it } from "vitest";
import {
  pcm16Base64ToSamples,
  resampleLinear,
  samplesToPcm16Base64,
  updateLocalSpeechDetectorState,
} from "@/hooks/useRealtimeConversation";
import type { LocalSpeechDetectorState } from "@/hooks/useRealtimeConversation";

describe("realtime audio helpers", () => {
  it("round-trips PCM16 base64 samples within expected quantization", () => {
    const samples = new Float32Array([-1, -0.5, 0, 0.5, 1]);

    const decoded = pcm16Base64ToSamples(samplesToPcm16Base64(samples));

    expect(Array.from(decoded)).toHaveLength(samples.length);
    expect(decoded[0]).toBeCloseTo(-1, 4);
    expect(decoded[1]).toBeCloseTo(-0.5, 4);
    expect(decoded[2]).toBeCloseTo(0, 4);
    expect(decoded[3]).toBeCloseTo(0.5, 4);
    expect(decoded[4]).toBeCloseTo(1, 4);
  });

  it("resamples to the target sample count with linear interpolation", () => {
    const samples = new Float32Array([0, 1, 0, -1]);

    const resampled = resampleLinear(samples, 48_000, 24_000);

    expect(Array.from(resampled)).toHaveLength(2);
    expect(resampled[0]).toBeCloseTo(0, 6);
    expect(resampled[1]).toBeCloseTo(-1, 6);
  });

  it("copies samples when no resampling is needed", () => {
    const samples = new Float32Array([0.1, -0.2]);

    const resampled = resampleLinear(samples, 24_000, 24_000);

    expect(resampled).not.toBe(samples);
    expect(resampled[0]).toBeCloseTo(0.1, 6);
    expect(resampled[1]).toBeCloseTo(-0.2, 6);
  });

  it("detects local speech only after sustained input and silence", () => {
    const config = { levelThreshold: 0.5, minDurationMs: 200, silenceMs: 300 };
    let detector: LocalSpeechDetectorState = {
      active: false,
      candidateStartedAt: null,
      lastVoiceAt: null,
    };

    let update = updateLocalSpeechDetectorState(detector, 0.8, 1_000, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.8, 1_150, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.8, 1_220, config);
    expect(update.event).toBe("started");
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.1, 1_400, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.1, 1_530, config);
    expect(update.event).toBe("stopped");
    expect(update.state.active).toBe(false);
  });

  it("drops short local audio spikes instead of treating them as speech", () => {
    const config = { levelThreshold: 0.5, minDurationMs: 200, silenceMs: 300 };
    let detector: LocalSpeechDetectorState = {
      active: false,
      candidateStartedAt: null,
      lastVoiceAt: null,
    };

    let update = updateLocalSpeechDetectorState(detector, 0.8, 1_000, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.1, 1_100, config);
    expect(update.event).toBeNull();
    expect(update.state.active).toBe(false);
    expect(update.state.candidateStartedAt).toBeNull();
  });
});
