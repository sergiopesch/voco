// Execute live-preview collection, async preparation, decoding, and sealing.
// Capture and owned-preedit are deterministic; no native model is run.
import { describe, expect, it, vi } from "vitest";
import * as sessions from "@/lib/dictationSession";
import * as buffers from "@/lib/audioCaptureBuffer";
import {
  createLivePreviewRunner,
  type LivePreviewRunnerEnv,
} from "@/lib/livePreviewRunner";
import type { PreviewTranscription } from "@/types";

// Regression geometry observed from a real 16,384-sample prepared preview:
// native output ended at 2,000 ms although the supplied audio lasted 1,024 ms.
// The words and bounds are retained verbatim; this fixture does not infer their
// acoustic accuracy or claim the observed run actually skipped source audio.
const observedShortPreview = {

  preparedSampleCount: 16_384,

  response: {
    text: "He had written a new book.",
    segments: [{
      text: "He had written a new book.",
      startMs: 0,
      endMs: 2000
    }],

  },
} satisfies {
  preparedSampleCount: number;
  response: PreviewTranscription;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return {
    promise,
    resolve
  };
}

function harness(sampleRate: number, startSample: number, windowSamples: number) {
  const preparation = deferred<Float32Array>();
  const inference = deferred<PreviewTranscription>();
  const ref = <T,>(current: T) => ({ current });
  const sessionRef = ref(
    sessions.markRecording(
      sessions.startSession(sessions.createDictationSessionState()),
    ),
  );
  const audio = buffers.createAudioCaptureBuffer();
  const retained = Float32Array.from(
    { length: startSample + windowSamples },
    (_, i) => i % 2 ? 0.2 : -0.1,
  );
  buffers.appendAudioSamples(audio, retained);
  const nextStart = ref(startSample);
  const confirmed = ref("");
  const candidate = ref(observedShortPreview.response.text);
  const native = vi.fn((_audio: Float32Array) => inference.promise);
  const publish = vi.fn(async () => { });
  const interim = vi.fn();
  const warning = vi.fn();
  const cache = ref(null as { key: string; preview: PreviewTranscription; preparedSampleCount: number } | null);
  const run = createLivePreviewRunner({
    sessionRef,
    clearLivePreviewTimer: vi.fn(),
    captureDescriptorRef: ref(null),
    livePreviewInFlightRef: ref<Promise<void> | null>(null),
    livePreviewCacheRef: cache,
    recordingSampleRate: () => sampleRate,
    shouldRunLivePreview: () => true,
    shouldUseFastLiveConfirmation: () => false,
    scheduleLivePreview: vi.fn(),
    usesCanonicalCursorStreaming: () => true,
    sessionConfigRef: ref({ transcriptTarget: "cursor", liveCursorMode: "stable-cursor-streaming" }),
    livePreviewAudioStartSampleRef: nextStart,
    audioBufferRef: ref(audio),
    resampleAudioBuffer: vi.fn(() => preparation.promise),
    previewTranscribeAudio: native,
    livePreviewNextDelayMsRef: ref(100),
    traceDictationEvent: vi.fn(async () => { }),
    lastLivePreviewTextRef: ref(""),
    setInterimTranscript: interim,
    debugCaptureEnabledRef: ref(false),
    console: { warn: warning },
    liveCursorInsertionDisabledRef: ref(false),
    livePreviewFailureNotifiedRef: ref(false),
    liveCursorFallbackNotifiedRef: ref(false),
    showNotification: vi.fn(async () => { }),
    liveCursorCandidateTextRef: candidate,
    waitForOwnedPreeditStart: async () => true,
    phaseRef: ref("recording"),
    ownedPreeditActiveRef: ref(true),
    liveDraftConfirmedTextRef: confirmed,
    ownedPreeditCommittedTextRef: ref(""),
    publishOwnedPreedit: publish,
  } as unknown as LivePreviewRunnerEnv);
  return {
    run: () => run.runLivePreview(sessions.createPreviewToken(sessionRef.current)),
    stop: () => run.stopLivePreview(),
    discard: () => run.clearCapturedAudio(),
    preparation,
    inference,
    native,
    publish,
    interim,
    warning,
    audio,
    retained,
    nextStart,
    confirmed,
    candidate,
    sessionRef,
    cache,
  };
}

const drainMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useDictation preview snapshot geometry", () => {
  it("reuses capped immutable audio while still checking geometry, and decodes new bounds or generations", async () => {
    const h = harness(16000, 0, 20 * 16000);
    // Unusable timestamps deliberately prevent sealing: the anchored window
    // stays full even as capture continues, reproducing the measured CPU waste.
    h.inference.resolve({text:"Retain this preview.",segments:[{text:"Retain this preview.",startMs:0,endMs:21000}]});
    await h.run();
    const retained = h.retained.slice();
    buffers.appendAudioSamples(h.audio, new Float32Array(16000));
    await h.run(); await h.run();
    expect(h.native).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledTimes(3);
    expect(h.nextStart.current).toBe(0);
    expect(h.confirmed.current).toBe("");
    expect(h.audio.chunks[0]).toEqual(retained);
    h.nextStart.current = 16000;
    await h.run(); expect(h.native).toHaveBeenCalledTimes(2);
    h.sessionRef.current = sessions.invalidateLivePreview(h.sessionRef.current);
    await h.run(); expect(h.native).toHaveBeenCalledTimes(3);
    expect(h.cache.current).not.toBeNull();
    h.stop(); expect(h.cache.current).toBeNull();
    await h.run(); expect(h.native).toHaveBeenCalledTimes(4);
    h.discard(); expect(h.cache.current).toBeNull();
    expect(h.audio.sampleCount).toBe(0);
    expect(h.warning).not.toHaveBeenCalled();
  });

  it("does not cache unavailable/empty inference or hide newly captured audio", async () => {
    const h = harness(16000, 0, 16000);
    h.inference.resolve({text:"",segments:[]});
    await h.run(); await h.run();
    expect(h.native).toHaveBeenCalledTimes(2);
    buffers.appendAudioSamples(h.audio, new Float32Array(16000));
    await h.run(); expect(h.native.mock.calls[h.native.mock.calls.length - 1]?.[0].length).toBe(32000);
  });

  it(
    "does not seal or advance into new audio arriving during a pending native decode",
    async () => {
      const h = harness(16000, 0, observedShortPreview.preparedSampleCount);
      const saved = h.retained.slice();
      const response = structuredClone(observedShortPreview.response);
      const pending = h.run();
      expect(h.native).toHaveBeenCalledOnce();
      expect(h.native.mock.calls[0]?.[0].length).toBe(observedShortPreview.preparedSampleCount);
      buffers.appendAudioSamples(h.audio, new Float32Array(24576));
      h.inference.resolve(response);
      await pending;
      expect(h.warning).not.toHaveBeenCalled();
      expect(h.nextStart.current).toBe(0);
      expect(h.confirmed.current).toBe("");
      expect(h.candidate.current).toBe(response.text);
      expect(h.publish).toHaveBeenCalledWith("", response.text, response.text, response.text);
      expect(h.interim).toHaveBeenCalledWith(response.text);
      expect(h.audio.sampleCount).toBe(40960);
      expect(h.audio.chunks[0]).toEqual(saved);
      expect(response).toEqual(observedShortPreview.response);
    }
  );

  it.each([44100, 48000])(
    "captures a nonzero anchor endpoint before resampling and decode awaits at %i Hz",
    async sampleRate => {
      const start = sampleRate;
    const windowSamples = sampleRate;
      const h = harness(sampleRate, start, windowSamples);
      const saved = h.retained.slice();
    const pending = h.run();
      expect(h.native).not.toHaveBeenCalled();
      buffers.appendAudioSamples(h.audio, new Float32Array(sampleRate));
      const prepared = new Float32Array(16000);
      h.preparation.resolve(prepared);
      await drainMicrotasks();
      expect(h.native).toHaveBeenCalledExactlyOnceWith(prepared);
      buffers.appendAudioSamples(h.audio, new Float32Array(sampleRate));
      const invalid = structuredClone(observedShortPreview.response);
      h.inference.resolve(invalid);
      await pending;
      expect(h.warning).not.toHaveBeenCalled();
      expect(h.nextStart.current).toBe(start);
      expect(h.confirmed.current).toBe("");
      expect(h.candidate.current).toBe(invalid.text);
      expect(h.audio.sampleCount).toBe(sampleRate * 4);
      expect(h.audio.chunks[0]).toEqual(saved);
    }
  );

  it.each([16000, 44100, 48000])(
    "allows valid sealing only through the decoded endpoint at %i Hz",
    async sampleRate => {
      const h = harness(sampleRate, sampleRate, sampleRate);
      const pending = h.run();
      if (sampleRate !== 16000) {
      h.preparation.resolve(new Float32Array(16000));
      await drainMicrotasks();
    }
      buffers.appendAudioSamples(h.audio, new Float32Array(sampleRate * 2));
      const valid = {
        text: observedShortPreview.response.text,
        segments: [{
          text: observedShortPreview.response.text,
          startMs: 0,
          endMs: 1000
        }]
      };
      h.inference.resolve(valid);
      await pending;
      expect(h.warning).not.toHaveBeenCalled();
      expect(h.nextStart.current).toBe(sampleRate * 2);
      expect(h.confirmed.current).toBe(valid.text);
      expect(h.audio.sampleCount).toBe(sampleRate * 4);
      expect(valid.segments[0]?.endMs).toBe(1000);
    }
  );
});
