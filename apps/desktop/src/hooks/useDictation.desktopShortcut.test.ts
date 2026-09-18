// Execute the production lifecycle factory with deterministic IPC. This proves
// ownership ordering, not physical shortcut delivery or microphone capture.
import { expect, it, vi } from "vitest";
import { DesktopShortcutSession } from "@/lib/desktopShortcutSession";
import * as session from "@/lib/dictationSession";
import {
  createDictationRecording,
  type DictationRecordingEnv,
} from "@/lib/dictationRecording";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const ref = <T>(current: T) => ({ current });
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => {});
  const phase = ref("idle");
  const current = ref(session.createDictationSessionState());
  const owner = ref<DesktopShortcutSession | null>(null);
  const cleanup = ref<Promise<boolean>>(Promise.resolve(true));
  const cancelled = ref<string | null>(null);
  const queue = ref<{ finish(): Promise<void>; cancel(): void } | null>(null);
  const disposed = ref(false);
  const begin = vi.fn<(id: string, epoch: number) => Promise<void>>(async () => {});
  const end = vi.fn<(id: string) => Promise<void>>(async () => {});
  const state = {
    config: { transcriptTarget: "cursor", transcriptEnhancement: "off" },
    recovery: null as unknown, transcript: "", setCaptureNotice: vi.fn(),
    setSurface: vi.fn(), setLastDictationResult: vi.fn(), setRawTranscript: vi.fn(),
    setRecovery: vi.fn((value: unknown) => { state.recovery = value; }),
    selectedDeviceId: null as string | null,
  };
  const status = { shortcutEpoch: 7, enabled: true, available: true, streamingEnabled: true, targetToken: "guarded-target" as string | null };
  const target = ref<string | null>(null);
  const pasteStatus = vi.fn(async () => status);
  // Deliberately end startup at source selection after shortcut acquisition.
  // The real failure path must release ownership; no microphone is opened.
  const captureSelection = vi.fn(() => ({ backend: "native" as const, selectionToken: "" }));
  const trace = vi.fn(async () => {});
  const setError = vi.fn();
  const env = {
    phaseRef: phase,
    sessionRef: current,
    disposedRef: disposed,
    cancelledRef: cancelled,
    desktopShortcutSessionRef: owner,
    desktopShortcutCleanupRef: cleanup,
    desktopPhraseQueueRef: queue,
    desktopTargetTokenRef: target,
    desktopPasteSessionRef: ref(false),
    desktopStreamEnabledRef: ref(false),
    desktopStreamedSampleCountRef: ref(0),
    desktopPhrasePasteCountRef: ref(0),
    manualCopyRequestedRef: ref(false),
    activeTriggerIdRef: ref<string | undefined>(undefined),
    recoveryAudioRef: ref<Float32Array | null>(null),
    recoverySessionIdRef: ref<string | null>(null),
    recoveryWaitRef: ref<{ cancel: () => void } | null>(null),
    sessionConfigRef: ref(null),
    nativeCaptureRef: ref(null),
    captureDescriptorRef: ref(null),
    captureSelectionRef: ref(captureSelection),
    captureGenerationRef: ref(0),
    canonicalSessionRef: ref(null),
    canonicalGenerationRef: ref(0),
    canonicalCheckpointInFlightRef: ref(null),
    canonicalCheckpointDeferredRef: ref(false),
    livePreviewInFlightRef: ref(null),
    recordingStartedAtMsRef: ref<number | null>(null),
    stopRequestedAtMsRef: ref<number | null>(null),
    firstHotkeyPressMsRef: ref<number | null>(null),
    initialHotkeyLatencyLoggedRef: ref(false),
    lastLivePreviewTextRef: ref(""),
    liveCursorCandidateTextRef: ref(""),
    liveDraftConfirmedTextRef: ref(""),
    liveCursorTextRef: ref(""),
    livePreviewAudioStartSampleRef: ref(0),
    liveCursorInsertionDisabledRef: ref(false),
    liveCursorFallbackNotifiedRef: ref(false),
    livePreviewFailureNotifiedRef: ref(false),
    livePreviewNextDelayMsRef: ref(0),
    firstLiveTextInsertedRef: ref(false),
    debugPreviewFramesRef: ref([]),
    debugCanonicalChunksRef: ref([]),
    debugCaptureEnabledRef: ref(false),
    debugNativeCaptureEnabledRef: ref(false),
    audioBufferRef: ref({ sampleCount: 0, chunks: [] }),
    cursorDeliveryStateRef: ref("idle"),
    lifecycleEpochRef: ref(0),
    audioContextRef: ref(null),
    ownedPreeditSessionIdRef: ref(null),
    primedStreamRef: ref(null),
    primedStreamPromiseRef: ref(null),
    captureHealthRef: ref(null),
    workletFlushRef: ref(null),
    streamRef: ref(null),
    sourceRef: ref(null),
    workletRef: ref(null),
    processorRef: ref(null),
    silentSinkRef: ref(null),
    primedDeviceIdRef: ref(null),
    ownedPreeditProgressiveRef: ref(false),
    ownedPreeditCommittedTextRef: ref(""),
    ownedPreeditActiveRef: ref(false),
    useStore: { getState: () => state },
    beginDesktopShortcutSession: begin,
    endDesktopShortcutSession: end,
    getDesktopPasteStatus: pasteStatus,
    pasteDesktopText: vi.fn(async () => ({ outcome: "dispatched" })),
    traceDictationEvent: trace,
    traceHotkeyEvent: trace,
    showNotification: asyncNoop,
    setCancellationPending: noop,
    setCanCancel: noop,
    setStatus: noop,
    setInterimTranscript: noop,
    setTranscript: noop,
    setError,
    setMicrophoneReadyState: noop,
    clearTranscript: noop,
    resetAudioLevel: noop,
    updateAudioLevel: noop,
    clearCapturedAudio: noop,
    clearCanonicalAudioCache: noop,
    transitionCursorDelivery: noop,
    retainCurrentTranscript: noop,
    resetOwnedPreeditState: noop,
    beginOwnedPreedit: noop,
    shouldUseOwnedPreedit: () => false,
    shouldRunLivePreview: () => false,
    scheduleLivePreview: noop,
    stopLivePreview: noop,
    clearLivePreviewTimer: noop,
    recordingSampleRate: () => 16000,
    appendRecordingSamples: () => 0,
    enqueueDesktopPhrase: noop,
    teardownAudioGraph: vi.fn(async () => 16000),
    disconnectAudioGraph: noop,
    clearLiveCursorText: asyncNoop,
    waitForLiveCursorInsertion: asyncNoop,
    replaceLiveCursorTextWithFinal: vi.fn(async () => "none" as const),
    completeCanonicalRecording: asyncNoop,
    transcribeAudio: vi.fn(async () => ""),
    persistDebugCapture: asyncNoop,
    ensureAudioContext: vi.fn(async () => ({}) as AudioContext),
    openTracedMicrophoneStream: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
    connectWorklet: vi.fn(async () => true),
    connectScriptProcessor: noop,
    traceDesktopPasteMetrics: noop,
    debugNativeCaptureEnabled: vi.fn(async () => false),
    debugDictationCaptureEnabled: vi.fn(async () => false),
    beginNativeCapture: vi.fn(),
    releaseBrowserRecording: asyncNoop,
    cancelOwnedPreedit: asyncNoop,
  } as unknown as DictationRecordingEnv;
  const recording = createDictationRecording(env);
  return {
    ...recording,
    unmount: recording.dispose,
    state, phase, current, owner, cleanup, cancelled, queue, begin, end, status,
    pasteStatus, captureSelection, trace, setError, disposed, target,
  };
}

it("captures a read-only target first, then waits for begin before source selection; failed startup cleans up", async () => {
  const h = harness(), begun = deferred();
  h.begin.mockImplementation(() => begun.promise);
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.begin).toHaveBeenCalledOnce());
  const id = h.begin.mock.calls[0]![0];
  expect(h.begin).toHaveBeenCalledExactlyOnceWith(id, 7);
  expect(h.pasteStatus.mock.invocationCallOrder[0]).toBeLessThan(h.begin.mock.invocationCallOrder[0]!);
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.end).not.toHaveBeenCalled();
  begun.resolve(); await starting;
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.end).toHaveBeenCalledExactlyOnceWith(id);
  expect(h.owner.current).toBeNull();
});

it("a failed begin prevents capture and still ends the uncertain owner", async () => {
  const h = harness(); h.begin.mockRejectedValue(new Error("shortcut unavailable"));
  await h.startRecording();
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.end).toHaveBeenCalledExactlyOnceWith(h.begin.mock.calls[0]![0]);
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_shortcut_acquire_failed");
});

it.each(["browser", "enhancement", "not-streaming"])("retains the existing %s route without a shortcut lease", async route => {
  const h = harness();
  if (route === "enhancement") h.state.config.transcriptEnhancement = "on";
  if (route === "not-streaming") h.status.streamingEnabled = false;
  await h.startRecording(route === "browser" ? "browser:test" : undefined);
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.begin).not.toHaveBeenCalled(); expect(h.end).not.toHaveBeenCalled();
});

it.each([null, "first-visible-target"])("reprobes an initially obscured target after the native ACK: %s", async target => {
  const h = harness();
  h.status.targetToken = null;
  h.pasteStatus.mockResolvedValueOnce(h.status).mockResolvedValueOnce({ ...h.status, targetToken: target });
  await h.startRecording();
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.pasteStatus).toHaveBeenCalledTimes(2);
  expect(h.pasteStatus.mock.invocationCallOrder[1]).toBeGreaterThan(h.begin.mock.invocationCallOrder[0]!);
  expect(h.target.current).toBe(target);
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.end).toHaveBeenCalledOnce();
});

it("never reprobes or replaces an initially valid target after shortcut acquisition", async () => {
  const h = harness();
  h.begin.mockImplementation(async () => { h.status.targetToken = "different-focused-target"; });
  await h.startRecording();
  expect(h.pasteStatus).toHaveBeenCalledOnce();
  expect(h.target.current).toBe("guarded-target");
});

it("a late second target probe cannot resume capture after cancellation", async () => {
  const h = harness(), probed = deferred();
  h.status.targetToken = null;
  h.pasteStatus.mockResolvedValueOnce(h.status).mockImplementationOnce(async () => {
    await probed.promise; return { ...h.status, targetToken: "late-target" };
  });
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.pasteStatus).toHaveBeenCalledTimes(2));
  await h.cancelRecording("cancelled");
  probed.resolve(); await starting;
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.target.current).toBeNull();
  expect(h.end).toHaveBeenCalledOnce();
});

it("serializes replacement behind old cleanup and late startup only ends its own UUID", async () => {
  const h = harness(), begun = deferred(), released = deferred();
  h.begin.mockImplementationOnce(() => begun.promise);
  h.end.mockImplementationOnce(() => released.promise);
  const oldStart = h.startRecording();
  await vi.waitFor(() => expect(h.begin).toHaveBeenCalledOnce());
  const oldId = h.begin.mock.calls[0]![0];
  h.phase.current = "error";
  const freshStart = h.startRecording();
  begun.resolve();
  await vi.waitFor(() => expect(h.end).toHaveBeenCalledWith(oldId));
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.captureSelection).not.toHaveBeenCalled();
  released.resolve(); await Promise.all([oldStart, freshStart]);
  expect(h.begin).toHaveBeenCalledTimes(2);
  const freshId = h.begin.mock.calls[1]![0];
  expect(freshId).not.toBe(oldId);
  expect(h.end.mock.calls.map(call => call[0])).toEqual([oldId, freshId]);
  expect(h.captureSelection).toHaveBeenCalledOnce();
});

it.each(["success", "failure"])("retains shortcut through delayed queue.finish and releases after %s", async outcome => {
  const h = harness(), finished = deferred();
  h.owner.current = new DesktopShortcutSession({ begin: h.begin, end: h.end }, h.status.shortcutEpoch, vi.fn());
  await h.owner.current.acquire();
  h.phase.current = "recording";
  h.current.current = session.startSession(h.current.current);
  const finish = vi.fn(() => finished.promise);
  h.queue.current = { finish, cancel: vi.fn() };
  const stopping = h.stopRecording();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(h.end).not.toHaveBeenCalled();
  if (outcome === "success") finished.resolve(); else finished.reject(new Error("delivery unconfirmed"));
  await stopping; await h.cleanup.current;
  expect(h.end).toHaveBeenCalledOnce();
  expect(h.phase.current).toBe(outcome === "success" ? "idle" : "error");
});

it.each(["cancel", "unmount"])("cleans up after %s while begin is pending", async action => {
  const h = harness(), begun = deferred();
  h.begin.mockImplementation(() => begun.promise);
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.begin).toHaveBeenCalledOnce());
  if (action === "cancel") await h.cancelRecording("cancelled"); else h.unmount();
  expect(h.end).not.toHaveBeenCalled();
  begun.resolve(); await starting; await h.cleanup.current;
  expect(h.end).toHaveBeenCalledExactlyOnceWith(h.begin.mock.calls[0]![0]);
  expect(h.captureSelection).not.toHaveBeenCalled();
});

it("reports unconfirmed cleanup with finite metadata and blocks the next guarded capture", async () => {
  const h = harness(); h.end.mockRejectedValue(new Error("private native failure"));
  await h.startRecording();
  expect(h.state.setCaptureNotice).toHaveBeenCalledWith("VOCO could not confirm shortcut cleanup. Restart VOCO if the shortcut stays reserved.");
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_shortcut_release_failed", { dictationSessionId: 1 });
  h.captureSelection.mockClear();
  await h.startRecording();
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.setError).toHaveBeenLastCalledWith(expect.stringContaining("could not confirm shortcut cleanup"));
});


it("keeps the first preflight epoch while waiting for old cleanup; stale begin prevents capture", async () => {
  const h = harness(), oldCleanup = deferred();
  h.cleanup.current = oldCleanup.promise.then(() => true);
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.pasteStatus).toHaveBeenCalledOnce());
  // Native reload happens after the old preflight and before its queued Begin.
  h.status.shortcutEpoch = 8;
  h.begin.mockImplementation(async (_id, epoch) => {
    if (epoch !== h.status.shortcutEpoch) throw new Error("The recording window changed. Start a new recording.");
  });
  oldCleanup.resolve(); await starting;
  expect(h.begin).toHaveBeenCalledExactlyOnceWith(expect.any(String), 7);
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.end).toHaveBeenCalledOnce();
  expect(h.setError).toHaveBeenCalledWith(expect.stringContaining("window changed"));
});
