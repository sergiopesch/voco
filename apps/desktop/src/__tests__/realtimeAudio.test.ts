import { describe, expect, it } from "vitest";
import {
  audioLevelBucket,
  decideRealtimeServerEvent,
  pcm16Base64ToSamples,
  resampleLinear,
  samplesToPcm16Base64,
  updateLocalSpeechDetectorState,
} from "@/hooks/useRealtimeConversation";
import type {
  LocalSpeechDetectorState,
  RealtimeRuntimeSnapshot,
} from "@/hooks/useRealtimeConversation";

const BASE_RUNTIME_SNAPSHOT: RealtimeRuntimeSnapshot = {
  responseActive: false,
  waitingForResponse: false,
  cancelResponseInFlight: false,
  inputChunkCount: 0,
  responseDeltaCount: 0,
};

describe("realtime audio helpers", () => {
  it("buckets audio levels for privacy-safe diagnostics", () => {
    expect(audioLevelBucket(0)).toBe("silent");
    expect(audioLevelBucket(0.03)).toBe("low");
    expect(audioLevelBucket(0.12)).toBe("medium");
    expect(audioLevelBucket(0.8)).toBe("high");
  });

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
    const config = {
      levelThreshold: 0.5,
      minDurationMs: 200,
      silenceMs: 300,
      candidateGapMs: 160,
      minVoiceFrames: 2,
    };
    let detector: LocalSpeechDetectorState = {
      active: false,
      candidateStartedAt: null,
      lastVoiceAt: null,
      voiceFrameCount: 0,
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
    const config = {
      levelThreshold: 0.5,
      minDurationMs: 200,
      silenceMs: 300,
      candidateGapMs: 120,
      minVoiceFrames: 2,
    };
    let detector: LocalSpeechDetectorState = {
      active: false,
      candidateStartedAt: null,
      lastVoiceAt: null,
      voiceFrameCount: 0,
    };

    let update = updateLocalSpeechDetectorState(detector, 0.8, 1_000, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.1, 1_100, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.1, 1_130, config);
    expect(update.event).toBeNull();
    expect(update.state.active).toBe(false);
    expect(update.state.candidateStartedAt).toBeNull();
  });

  it("keeps a local speech candidate across short dips", () => {
    const config = {
      levelThreshold: 0.5,
      minDurationMs: 200,
      silenceMs: 300,
      candidateGapMs: 160,
      minVoiceFrames: 2,
    };
    let detector: LocalSpeechDetectorState = {
      active: false,
      candidateStartedAt: null,
      lastVoiceAt: null,
      voiceFrameCount: 0,
    };

    let update = updateLocalSpeechDetectorState(detector, 0.8, 1_000, config);
    expect(update.event).toBeNull();
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.1, 1_090, config);
    expect(update.event).toBeNull();
    expect(update.state.candidateStartedAt).toBe(1_000);
    expect(update.state.voiceFrameCount).toBe(1);
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0.8, 1_220, config);
    expect(update.event).toBe("started");
    expect(update.state.active).toBe(true);
  });

  it("requires multiple local speech frames before starting", () => {
    const config = {
      levelThreshold: 0.02,
      minDurationMs: 100,
      silenceMs: 300,
      candidateGapMs: 900,
      minVoiceFrames: 2,
    };
    let detector: LocalSpeechDetectorState = {
      active: false,
      candidateStartedAt: null,
      lastVoiceAt: null,
      voiceFrameCount: 0,
    };

    let update = updateLocalSpeechDetectorState(detector, 0.5, 1_000, config);
    expect(update.event).toBeNull();
    expect(update.state.voiceFrameCount).toBe(1);
    detector = update.state;

    update = updateLocalSpeechDetectorState(detector, 0, 1_900, config);
    expect(update.event).toBeNull();
    expect(update.state.active).toBe(false);
    expect(update.state.voiceFrameCount).toBe(0);
  });

  it("decides to cancel active assistant playback when server speech starts", () => {
    const decision = decideRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started" },
      { ...BASE_RUNTIME_SNAPSHOT, responseActive: true, waitingForResponse: true },
    );

    expect(decision.traceEvents).toContainEqual({
      event: "realtime_server_speech_started",
    });
    expect(decision.cancelResponse).toBe(true);
    expect(decision.stopOutputPlayback).toBe(true);
    expect(decision.clearResponseTimeouts).toBe(true);
    expect(decision.waitingForResponse).toBe(false);
    expect(decision.serverDetectedCurrentTurn).toBe(true);
    expect(decision.status?.status).toBe("listening");
  });

  it("schedules a response fallback when server commits input", () => {
    const decision = decideRealtimeServerEvent(
      { type: "input_audio_buffer.committed" },
      BASE_RUNTIME_SNAPSHOT,
    );

    expect(decision.traceEvents).toContainEqual({
      event: "realtime_server_input_committed",
    });
    expect(decision.scheduleResponseFallback).toBe(true);
    expect(decision.resetLocalSpeechDetector).toBe(true);
    expect(decision.serverDetectedCurrentTurn).toBe(false);
  });

  it("tracks assistant audio deltas and returns to listening on response done", () => {
    const deltaDecision = decideRealtimeServerEvent(
      { type: "response.output_audio.delta", delta: "abc" },
      { ...BASE_RUNTIME_SNAPSHOT, responseDeltaCount: 2 },
    );

    expect(deltaDecision.responseDeltaCount).toBe(3);
    expect(deltaDecision.playOutputAudio).toBe("abc");
    expect(deltaDecision.traceEvents).toContainEqual({
      event: "realtime_output_audio_delta",
      fields: { responseDeltaCount: 3 },
    });
    expect(deltaDecision.status?.status).toBe("speaking");

    const doneDecision = decideRealtimeServerEvent(
      { type: "response.done" },
      { ...BASE_RUNTIME_SNAPSHOT, responseActive: true, responseDeltaCount: 3 },
    );

    expect(doneDecision.responseActive).toBe(false);
    expect(doneDecision.waitingForResponse).toBe(false);
    expect(doneDecision.clearResponseTimeouts).toBe(true);
    expect(doneDecision.status?.status).toBe("listening");
    expect(doneDecision.traceEvents).toContainEqual({
      event: "realtime_server_response_done",
      fields: { responseDeltaCount: 3 },
    });
  });

  it("ignores late assistant audio deltas after sending response cancel", () => {
    const decision = decideRealtimeServerEvent(
      { type: "response.output_audio.delta", delta: "abc" },
      { ...BASE_RUNTIME_SNAPSHOT, cancelResponseInFlight: true },
    );

    expect(decision.playOutputAudio).toBeUndefined();
    expect(decision.responseDeltaCount).toBeUndefined();
    expect(decision.traceEvents).toContainEqual({
      event: "realtime_output_audio_delta_ignored_after_cancel",
    });
  });

  it("marks realtime server errors for cleanup with an actionable state", () => {
    const decision = decideRealtimeServerEvent(
      { type: "error", error: { message: "bad session" } },
      BASE_RUNTIME_SNAPSHOT,
    );

    expect(decision.cleanup).toBe(true);
    expect(decision.status).toEqual({
      status: "error",
      detail: "Realtime error.",
      error: "bad session",
    });
    expect(decision.traceEvents).toContainEqual({ event: "realtime_server_error" });
  });

  it("keeps realtime alive for benign response cancel race errors", () => {
    const decision = decideRealtimeServerEvent(
      {
        type: "error",
        error: { message: "Cannot cancel response because there is no active response" },
      },
      { ...BASE_RUNTIME_SNAPSHOT, cancelResponseInFlight: true },
    );

    expect(decision.cleanup).toBeUndefined();
    expect(decision.status).toBeUndefined();
    expect(decision.clearCancelResponseInFlight).toBe(true);
    expect(decision.traceEvents).toContainEqual({
      event: "realtime_response_cancel_ignored_error",
    });
  });
});
