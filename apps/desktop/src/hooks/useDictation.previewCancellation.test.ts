// Execute actual hook functions with deterministic dependencies and timers.
// Mounted React/worklet coverage is retained separately; these tests require
// no microphone, native decoder, or new public hook API.
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import source from "./useDictation.ts?raw";
import * as sessions from "@/lib/dictationSession";
import * as buffers from "@/lib/audioCaptureBuffer";
import { removeDcOffsetInPlace } from "@/lib/audioLevel";
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
function actualHookFunction(source: string, scope: Record<string, unknown>) {
  const ast = ts.createSourceFile("useDictation.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "runLivePreview") {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!declaration) {
    throw new Error("Actual hook function unavailable");
  }
  const body = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None
    }
  }).outputText;
  return new Function(...Object.keys(scope), body + ";return runLivePreview;")(...Object.values(scope)) as (token: sessions.DictationPreviewToken) => Promise<void>;
}
function harness(text = source) {
  const preparation = deferred<Float32Array>();
  const inference = deferred<{
    text: string;
    segments: unknown[];
  }>();
  const sessionRef = {
    current: sessions.markRecording(sessions.startSession(sessions.createDictationSessionState()))
  };
  const audio = buffers.createAudioCaptureBuffer();
  const retained = Float32Array.from({
    length: 48000
  }, (_, i) => i % 2 ? 0.2 : -0.1);
  buffers.appendAudioSamples(audio, retained);
  const token = sessions.createPreviewToken(sessionRef.current);
  const livePreviewInFlightRef = {
    current: null
  };
  const previewTranscribeAudio = vi.fn(() => inference.promise);
  const resampleAudioBuffer = vi.fn(() => preparation.promise);
  const delivery = vi.fn(async () => {
  });
  const interim = vi.fn();
  const warning = vi.fn();
  const scope = {
    ...sessions,
    ...buffers,
    removeDcOffsetInPlace,
    sessionRef,
    livePreviewInFlightRef,
    livePreviewCacheRef: { current: null },
    recordingSampleRate: () => 48000,
    shouldRunLivePreview: () => true,
    shouldUseFastLiveConfirmation: () => false,
    scheduleLivePreview: vi.fn(),
    usesCanonicalCursorStreaming: () => false,
    sessionConfigRef: {
      current: null
    },
    livePreviewAudioStartSampleRef: {
      current: 0
    },
    audioBufferRef: {
      current: audio
    },
    LIVE_PREVIEW_MAX_SECONDS: 6,
    ANCHORED_LIVE_PREVIEW_MAX_SECONDS: 20,
    LIVE_PREVIEW_MIN_SECONDS: 0.7,
    LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS: 100,
    LIVE_PREVIEW_MIN_INTERVAL_MS: 100,
    TARGET_SAMPLE_RATE: 16000,
    resampleAudioBuffer,
    previewTranscribeAudio,
    performance,
    recordPreviewDuration: sessions.recordPreviewDuration,
    nextLivePreviewDelay: () => 100,
    livePreviewNextDelayMsRef: {
      current: null
    },
    traceDictationEvent: vi.fn(async () => {
    }),
    lastLivePreviewTextRef: {
      current: ""
    },
    setInterimTranscript: interim,
    updateLiveCursorText: delivery,
    debugCaptureEnabledRef: {
      current: false
    },
    console: {
      warn: warning
    },
    liveCursorInsertionDisabledRef: {
      current: false
    },
    livePreviewFailureNotifiedRef: {
      current: false
    },
    showNotification: vi.fn(async () => {
    })
  };
  return {
    run: actualHookFunction(text, scope),
    token,
    sessionRef,
    preparation,
    inference,
    resampleAudioBuffer,
    previewTranscribeAudio,
    delivery,
    interim,
    warning,
    audio,
    retained,
    livePreviewInFlightRef
  };
}
const invalidations = {
  Cancel: sessions.disableLivePreview,
  Stop: sessions.requestStop,
  canonical: sessions.invalidateLivePreview
};
describe("useDictation preview preparation cancellation", () => {
  for (const [name, invalidate] of Object.entries(invalidations))
    it(name + " during deferred resampling never queues stale inference or delivery", async () => {
      const h = harness();
      const saved = h.retained.slice();
      const id = h.sessionRef.current.sessionId;
      const pending = h.run(h.token);
      expect(h.resampleAudioBuffer).toHaveBeenCalledOnce();
      expect(h.previewTranscribeAudio).not.toHaveBeenCalled();
      h.sessionRef.current = invalidate(h.sessionRef.current);
      h.preparation.resolve(new Float32Array(16000));
      await pending;
      expect(h.previewTranscribeAudio).not.toHaveBeenCalled();
      expect(h.delivery).not.toHaveBeenCalled();
      expect(h.interim).not.toHaveBeenCalled();
      expect(h.warning).not.toHaveBeenCalled();
      expect(h.audio.sampleCount).toBe(48000);
      expect(h.audio.chunks[0]).toEqual(saved);
      expect(h.sessionRef.current.sessionId).toBe(id);
      expect(h.livePreviewInFlightRef.current).toBeNull();
    });
  it("active preparation still invokes and delivers exactly once", async () => {
    const h = harness();
    const pending = h.run(h.token);
    const prepared = new Float32Array(16000);
    h.preparation.resolve(prepared);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.previewTranscribeAudio).toHaveBeenCalledExactlyOnceWith(prepared);
    h.inference.resolve({
      text: "active words",
      segments: []
    });
    await pending;
    expect(h.delivery).toHaveBeenCalledOnce();
    expect(h.interim).toHaveBeenCalledExactlyOnceWith("active words");
    expect(h.warning).not.toHaveBeenCalled();
    expect(h.audio.sampleCount).toBe(48000);
  });
  it("keeps the existing post-inference invalidation guard", async () => {
    const h = harness();
    const pending = h.run(h.token);
    h.preparation.resolve(new Float32Array(16000));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.previewTranscribeAudio).toHaveBeenCalledOnce();
    h.sessionRef.current = sessions.disableLivePreview(h.sessionRef.current);
    h.inference.resolve({
      text: "stale words",
      segments: []
    });
    await pending;
    expect(h.delivery).not.toHaveBeenCalled();
    expect(h.interim).not.toHaveBeenCalled();
    expect(h.warning).not.toHaveBeenCalled();
  });
});
