import {
  appendAudioSamplesUpTo,
  collectAudioSamplesRange,
  type AudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { captureSampleLimit } from "@/lib/dictationRecovery";
import { AudioCaptureFlushError } from "@/lib/audioCaptureFlush";
import type { NativeCaptureSession } from "@/lib/nativeCapture";
import type { NativeCaptureTerminalOutcome } from "@/lib/nativeCaptureAudit";

export const MAX_AUDIO_SECONDS = 600;

export type Ref<T> = { current: T };

export interface DesktopPhraseQueue {
  pushAudio(samples: Float32Array, sampleRate: number): void;
  enqueue(): void;
}

export interface DesktopCaptureTailEnv {
  audioBufferRef: Ref<AudioCaptureBuffer>;
  desktopPhraseQueueRef: Ref<DesktopPhraseQueue | null>;
  desktopStreamedSampleCountRef: Ref<number>;
  phaseRef: Ref<string>;
  captureHealthRef: Ref<{ samplesReceived(): void; dispose(): void } | null>;
  nativeCaptureRef: Ref<NativeCaptureSession | null>;
  cancelledRef: Ref<string | null>;
  recordingSampleRate: () => number;
  pumpCanonicalCheckpoints: () => void;
  stopRecording: () => void;
  persistNativeRetainedSource: (
    native: NativeCaptureSession,
    outcome: NativeCaptureTerminalOutcome,
  ) => void;
  flushCaptureSamples: () => Promise<void>;
  disconnectAudioGraph: () => void;
  traceDictationEvent: (
    event: string,
    fields?: { durationMs?: number },
  ) => Promise<void>;
  maxAudioSeconds?: number;
  collectAudioSamplesRange?: typeof collectAudioSamplesRange;
}

/**
 * Append-only capture accounting and Stop-tail forwarding.
 * Live samples go to the queue during recording; Stop forwards only the
 * retained tail that live delivery has not already offered.
 */
export function createDesktopCaptureTail(env: DesktopCaptureTailEnv) {
  const maxAudioSeconds = env.maxAudioSeconds ?? MAX_AUDIO_SECONDS;
  const collectRange = env.collectAudioSamplesRange ?? collectAudioSamplesRange;

  function enqueueDesktopPhrase(end: number) {
    const queue = env.desktopPhraseQueueRef.current;
    if (!queue) return;
    const start = env.desktopStreamedSampleCountRef.current;
    // Stop drains capture after the recording phase has ended. Forward only the
    // retained tail that live delivery has not already offered to the recognizer.
    if (end > start) {
      queue.pushAudio(
        collectRange(env.audioBufferRef.current, start, end - start),
        env.recordingSampleRate(),
      );
      env.desktopStreamedSampleCountRef.current = end;
    }
    queue.enqueue();
    env.traceDictationEvent("dictation_desktop_phrase_queued", {
      durationMs: Math.round((end - start) / env.recordingSampleRate() * 1000),
    }).catch(() => {});
  }

  function appendRecordingSamples(samples: Float32Array): number {
    const sampleRate = env.recordingSampleRate();
    env.captureHealthRef.current?.samplesReceived();
    const maxSamples = captureSampleLimit(sampleRate, maxAudioSeconds);
    const appendResult = appendAudioSamplesUpTo(
      env.audioBufferRef.current,
      samples,
      maxSamples,
    );
    env.pumpCanonicalCheckpoints();
    // The production worker owns streaming boundaries; queue existence is the
    // only live-delivery gate. Stop-drained samples are forwarded at finalization.
    const queue = env.desktopPhraseQueueRef.current;
    if (queue && env.phaseRef.current === "recording") {
      const accepted = samples.subarray(0, appendResult.appendedSampleCount);
      queue.pushAudio(accepted, sampleRate);
      env.desktopStreamedSampleCountRef.current += accepted.length;
    }

    if (
      env.phaseRef.current === "recording" &&
      appendResult.reachedLimit
    ) {
      env.traceDictationEvent("dictation_recording_limit_reached", {
        durationMs: maxAudioSeconds * 1000,
      }).catch(() => {});
      void env.stopRecording();
    }
    return appendResult.appendedSampleCount;
  }

  async function teardownAudioGraph() {
    const rate = env.recordingSampleRate();
    const native = env.nativeCaptureRef.current;
    if (native) {
      try { await native.stopAndDrain(); }
      catch {
        env.persistNativeRetainedSource(native, "interrupted");
        throw new AudioCaptureFlushError();
      }
      env.persistNativeRetainedSource(native, env.cancelledRef.current ? "cancelled" : "healthy-stop");
      return rate;
    }
    env.captureHealthRef.current?.dispose();
    env.captureHealthRef.current = null;
    try {
      await env.flushCaptureSamples();
    } finally {
      env.disconnectAudioGraph();
    }
    return rate;
  }

  return { enqueueDesktopPhrase, appendRecordingSamples, teardownAudioGraph };
}
