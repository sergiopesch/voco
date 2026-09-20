import { BenchmarkPhraseQueue } from "@/lib/benchmarkPhraseQueue";
import { DesktopShortcutSession } from "@/lib/desktopShortcutSession";
import {
  createCaptureDescriptor,
  type CaptureDescriptor,
  type CaptureSelection,
} from "@/lib/captureDescriptor";
import { beginNativeCapture, type NativeCaptureSession } from "@/lib/nativeCapture";
import {
  AudioCaptureFlushError,
  CAPTURE_INPUT_INTERRUPTED,
} from "@/lib/audioCaptureFlush";
import {
  collectAudioSamplesRange,
  type AudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { calculateVisualAudioLevelFromSamples, removeDcOffsetInPlace } from "@/lib/audioLevel";
import { resampleAudioForTranscription } from "@/lib/audioResampling";
import {
  consumeQueuedStop,
  disableLivePreview,
  failSession,
  finishSessionIdle,
  markFinalizing,
  markProcessing,
  markRecording,
  requestStop as requestSessionStop,
  startSession,
  type DictationSessionState,
} from "@/lib/dictationSession";
import { errorMessage, LIVE_DELIVERY_PAUSED } from "@/lib/dictationRecovery";
import {
  LIVE_PREVIEW_INITIAL_DELAY_MS,
  LIVE_PREVIEW_MIN_INTERVAL_MS,
  TARGET_SAMPLE_RATE,
} from "@/lib/liveCommitPolicy";
import { MAX_AUDIO_SECONDS } from "@/lib/desktopCaptureTail";
import { usesCanonicalCursorStreaming } from "@/lib/dictationOutputPlan";
import {
  createCanonicalCursorSession,
  failCanonicalSession,
  markCanonicalDeliveryUncertain,
  requestCanonicalStop,
  type CanonicalCursorSession,
} from "@/lib/canonicalCursorSession";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import type { AppConfig } from "@/types";
import type { HotkeyTraceFields } from "@/lib/tauri";
import type { CursorDeliveryEvent } from "@/lib/dictationDelivery";

export type Ref<T> = { current: T };

export type DictationRecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "processing"
  | "finalizing"
  | "error";

type LiveFinalizationResult = "none" | "safe" | "unreconciled";
type CaptureAdmission = "pending" | "automatic" | "manual-review";

/**
 * Owns Start, Stop and Cancel, including shortcut-session boundaries and
 * fail-closed recovery. Created once per mount; env is refs plus functions
 * that read .current.
 */
export interface DictationRecordingEnv {
  phaseRef: Ref<DictationRecordingPhase | string>;
  sessionRef: Ref<DictationSessionState>;
  disposedRef: Ref<boolean>;
  cancelledRef: Ref<string | null>;
  desktopShortcutSessionRef: Ref<DesktopShortcutSession | null>;
  desktopShortcutCleanupRef: Ref<Promise<boolean>>;
  desktopPhraseQueueRef: Ref<{
    cancel(): void;
    finish(): Promise<void>;
    pushAudio?(samples: Float32Array, sampleRate: number): void;
    enqueue?(): void;
  } | null>;
  desktopTargetTokenRef: Ref<string | null>;
  desktopPasteSessionRef: Ref<boolean>;
  desktopStreamEnabledRef: Ref<boolean>;
  desktopStreamedSampleCountRef: Ref<number>;
  desktopPhrasePasteCountRef: Ref<number>;
  manualCopyRequestedRef: Ref<boolean>;
  activeTriggerIdRef: Ref<string | undefined>;
  recoveryAudioRef: Ref<Float32Array | null>;
  recoverySessionIdRef: Ref<string | null>;
  recoveryWaitRef: Ref<{ cancel: () => void } | null>;
  sessionConfigRef: Ref<AppConfig | null>;
  nativeCaptureRef: Ref<NativeCaptureSession | null>;
  captureDescriptorRef: Ref<CaptureDescriptor | null>;
  captureSelectionRef: Ref<(() => CaptureSelection) | undefined>;
  captureGenerationRef: Ref<number>;
  canonicalSessionRef: Ref<CanonicalCursorSession | null>;
  canonicalGenerationRef: Ref<number>;
  canonicalCheckpointInFlightRef: Ref<Promise<void> | null>;
  canonicalCheckpointDeferredRef: Ref<boolean>;
  livePreviewInFlightRef: Ref<Promise<void> | null>;
  recordingStartedAtMsRef: Ref<number | null>;
  stopRequestedAtMsRef: Ref<number | null>;
  firstHotkeyPressMsRef: Ref<number | null>;
  initialHotkeyLatencyLoggedRef: Ref<boolean>;
  lastLivePreviewTextRef: Ref<string>;
  liveCursorCandidateTextRef: Ref<string>;
  liveDraftConfirmedTextRef: Ref<string>;
  liveCursorTextRef: Ref<string>;
  livePreviewAudioStartSampleRef: Ref<number>;
  liveCursorInsertionDisabledRef: Ref<boolean>;
  liveCursorFallbackNotifiedRef: Ref<boolean>;
  livePreviewFailureNotifiedRef: Ref<boolean>;
  livePreviewNextDelayMsRef: Ref<number>;
  firstLiveTextInsertedRef: Ref<boolean>;
  debugPreviewFramesRef: Ref<unknown[]>;
  debugCanonicalChunksRef: Ref<unknown[]>;
  debugCaptureEnabledRef: Ref<boolean>;
  debugNativeCaptureEnabledRef: Ref<boolean>;
  audioBufferRef: Ref<AudioCaptureBuffer>;
  cursorDeliveryStateRef: Ref<string>;
  lifecycleEpochRef: Ref<number>;
  audioContextRef: Ref<AudioContext | null>;
  ownedPreeditSessionIdRef: Ref<number | null>;
  primedStreamRef: Ref<MediaStream | null>;
  primedStreamPromiseRef: Ref<Promise<MediaStream> | null>;
  captureHealthRef: Ref<{ dispose(): void } | null>;
  workletFlushRef: Ref<{ cancel(): void } | null>;
  streamRef: Ref<MediaStream | null>;
  sourceRef: Ref<MediaStreamAudioSourceNode | null>;
  workletRef: Ref<AudioWorkletNode | null>;
  processorRef: Ref<ScriptProcessorNode | null>;
  silentSinkRef: Ref<GainNode | null>;
  primedDeviceIdRef: Ref<string | null>;
  ownedPreeditProgressiveRef: Ref<boolean>;
  ownedPreeditCommittedTextRef: Ref<string>;
  ownedPreeditActiveRef: Ref<boolean>;
  // Store and native helpers are injected so tests can substitute them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useStore: { getState: () => any };
  beginDesktopShortcutSession: (id: string, epoch: number) => Promise<void>;
  endDesktopShortcutSession: (id: string) => Promise<void>;
  getDesktopPasteStatus: () => Promise<{
    enabled?: boolean;
    available?: boolean;
    streamingEnabled?: boolean;
    targetToken?: string | null;
    shortcutEpoch?: number | null;
    detail?: string;
  }>;
  pasteDesktopText: (
    text: string,
    targetToken?: string | null,
    correlation?: any,
  ) => Promise<{
    outcome: string;
    pasteMetrics?: {
      targetProbeMs?: number;
      preflightMs?: number;
      clipboardMs?: number;
      keyboardMs?: number;
      terminal?: boolean;
    };
  }>;
  traceDictationEvent: (event: string, fields?: HotkeyTraceFields | null) => Promise<void>;
  traceHotkeyEvent: (event: string, fields?: HotkeyTraceFields | null) => Promise<void>;
  showNotification: (title: string, body: string) => Promise<void>;
  setCancellationPending: (value: boolean) => void;
  setCanCancel: (value: boolean) => void;
  setStatus: (status: any) => void;
  setInterimTranscript: (text: string) => void;
  setTranscript: (text: string) => void;
  setError: (error: string | null) => void;
  setMicrophoneReadyState: (ready: boolean) => void;
  clearTranscript: () => void;
  resetAudioLevel: () => void;
  updateAudioLevel: (level: number) => void;
  clearCapturedAudio: () => void;
  clearCanonicalAudioCache: () => void;
  transitionCursorDelivery: (event: CursorDeliveryEvent) => void;
  retainCurrentTranscript: (reason: "delivery-unconfirmed" | "output-failed") => void;
  resetOwnedPreeditState: () => void;
  beginOwnedPreedit: (sessionId: number, triggerId?: string) => unknown;
  shouldUseOwnedPreedit: () => boolean;
  shouldRunLivePreview: () => boolean;
  scheduleLivePreview: (delayMs?: number) => void;
  stopLivePreview: () => void;
  clearLivePreviewTimer: () => void;
  recordingSampleRate: () => number;
  appendRecordingSamples: (samples: Float32Array) => number;
  enqueueDesktopPhrase: (end: number) => void;
  teardownAudioGraph: () => Promise<number>;
  disconnectAudioGraph: () => void;
  flushCaptureSamples?: () => Promise<void>;
  clearLiveCursorText: () => Promise<void>;
  waitForLiveCursorInsertion: () => Promise<void>;
  replaceLiveCursorTextWithFinal: (text: string) => Promise<LiveFinalizationResult>;
  completeCanonicalRecording: (
    capturedSourceSampleCount: number,
    transcribeStartedAt: number,
    dictationSessionId: number,
  ) => Promise<void>;
  transcribeAudio: (samples: Float32Array) => Promise<string>;
  persistDebugCapture: (pending: any) => Promise<void>;
  ensureAudioContext: () => Promise<AudioContext>;
  openTracedMicrophoneStream: (deviceId: string | null) => Promise<MediaStream>;
  connectWorklet: (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => Promise<boolean>;
  connectScriptProcessor: (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => void;
  traceDesktopPasteMetrics: (result: any) => void;
  debugNativeCaptureEnabled: () => Promise<boolean>;
  debugDictationCaptureEnabled: () => Promise<boolean>;
  beginNativeCapture: typeof beginNativeCapture;
  releaseBrowserRecording: (triggerId: string) => Promise<void>;
  cancelOwnedPreedit: (sessionId: number) => Promise<unknown>;
  console?: Pick<Console, "info" | "warn">;
}

export function createDictationRecording(env: DictationRecordingEnv) {
  const {
    phaseRef,
    sessionRef,
    disposedRef,
    cancelledRef,
    desktopShortcutSessionRef,
    desktopShortcutCleanupRef,
    desktopPhraseQueueRef,
    desktopTargetTokenRef,
    desktopPasteSessionRef,
    desktopStreamEnabledRef,
    desktopStreamedSampleCountRef,
    desktopPhrasePasteCountRef,
    manualCopyRequestedRef,
    activeTriggerIdRef,
    recoveryAudioRef,
    recoverySessionIdRef,
    recoveryWaitRef,
    sessionConfigRef,
    nativeCaptureRef,
    captureDescriptorRef,
    captureSelectionRef,
    captureGenerationRef,
    canonicalSessionRef,
    canonicalGenerationRef,
    canonicalCheckpointInFlightRef,
    canonicalCheckpointDeferredRef,
    livePreviewInFlightRef,
    recordingStartedAtMsRef,
    stopRequestedAtMsRef,
    firstHotkeyPressMsRef,
    initialHotkeyLatencyLoggedRef,
    lastLivePreviewTextRef,
    liveCursorCandidateTextRef,
    liveDraftConfirmedTextRef,
    liveCursorTextRef,
    livePreviewAudioStartSampleRef,
    liveCursorInsertionDisabledRef,
    liveCursorFallbackNotifiedRef,
    livePreviewFailureNotifiedRef,
    livePreviewNextDelayMsRef,
    firstLiveTextInsertedRef,
    debugPreviewFramesRef,
    debugCanonicalChunksRef,
    debugCaptureEnabledRef,
    debugNativeCaptureEnabledRef,
    audioBufferRef,
    cursorDeliveryStateRef,
    lifecycleEpochRef,
    audioContextRef,
    ownedPreeditSessionIdRef,
    primedStreamRef,
    primedStreamPromiseRef,
    captureHealthRef,
    workletFlushRef,
    streamRef,
    sourceRef,
    primedDeviceIdRef,
    ownedPreeditProgressiveRef,
    ownedPreeditCommittedTextRef,
    ownedPreeditActiveRef,
    useStore,
    beginDesktopShortcutSession,
    endDesktopShortcutSession,
    getDesktopPasteStatus,
    pasteDesktopText,
    traceDictationEvent,
    traceHotkeyEvent,
    showNotification,
    setCancellationPending,
    setCanCancel,
    setStatus,
    setInterimTranscript,
    setTranscript,
    setError,
    setMicrophoneReadyState,
    clearTranscript,
    resetAudioLevel,
    updateAudioLevel,
    clearCapturedAudio,
    clearCanonicalAudioCache,
    transitionCursorDelivery,
    retainCurrentTranscript,
    resetOwnedPreeditState,
    beginOwnedPreedit,
    shouldUseOwnedPreedit,
    shouldRunLivePreview,
    scheduleLivePreview,
    stopLivePreview,
    clearLivePreviewTimer,
    recordingSampleRate,
    appendRecordingSamples,
    enqueueDesktopPhrase,
    teardownAudioGraph,
    disconnectAudioGraph,
    clearLiveCursorText,
    waitForLiveCursorInsertion,
    replaceLiveCursorTextWithFinal,
    completeCanonicalRecording,
    transcribeAudio,
    persistDebugCapture,
    ensureAudioContext,
    openTracedMicrophoneStream,
    connectWorklet,
    connectScriptProcessor,
    traceDesktopPasteMetrics,
    debugNativeCaptureEnabled,
    debugDictationCaptureEnabled,
    beginNativeCapture,
    releaseBrowserRecording,
    cancelOwnedPreedit,
  } = env;

  function isCurrentSession(sessionId: number): boolean {
    return !disposedRef.current && sessionRef.current.sessionId === sessionId;
  }

  function assertOutputAllowed(sessionId = sessionRef.current.sessionId) {
    if (!isCurrentSession(sessionId)) {
      throw new Error("Recording session is no longer active.");
    }
    if (cancelledRef.current) throw new Error(cancelledRef.current);
  }

  function releaseDesktopShortcutSession(owned = desktopShortcutSessionRef.current): Promise<boolean> {
    if (!owned) return desktopShortcutCleanupRef.current;
    if (desktopShortcutSessionRef.current === owned) desktopShortcutSessionRef.current = null;
    // Mark disposal immediately, including when begin is still pending. The next
    // Start waits for both this owner and any preceding cleanup before acquiring.
    const release = owned.dispose();
    desktopShortcutCleanupRef.current = Promise.all([desktopShortcutCleanupRef.current, release])
      .then(results => results.every(Boolean));
    return desktopShortcutCleanupRef.current;
  }

  function releaseRecordingOrigin(triggerId = activeTriggerIdRef.current) {
    if (!triggerId?.startsWith("browser:")) return;
    if (activeTriggerIdRef.current === triggerId) activeTriggerIdRef.current = undefined;
    void releaseBrowserRecording(triggerId).catch(() => {});
  }

  function retainRecovery(reason: string, keepAudio = true) {
    if (disposedRef.current) return;
    void releaseDesktopShortcutSession();
    releaseRecordingOrigin();
    traceDictationEvent("dictation_recovery_retained", {
      trackSampleRate: recordingSampleRate(),
      durationMs: Math.round(audioBufferRef.current.sampleCount / (recordingSampleRate()) * 1000),
    }).catch(() => {});
    const canonical = canonicalSessionRef.current;
    if (canonical?.recognition.canonicalText) {
      setTranscript(canonical.recognition.canonicalText);
      useStore.getState().setRawTranscript(canonical.recognition.canonicalText);
    }
    if (!keepAudio) {
      recoveryAudioRef.current = null;
      clearCapturedAudio();
      clearCanonicalAudioCache();
    }
    useStore.getState().setRecovery({
      reason,
      audioAvailable: keepAudio && (audioBufferRef.current.sampleCount > 0 || Boolean(recoveryAudioRef.current?.length)),
      retrying: false,
      targetMayContainText: desktopPhrasePasteCountRef.current > 0 || canonical?.delivery === "uncertain" ||
        Boolean(canonical?.acknowledgedTargetText) || cursorDeliveryStateRef.current === "unreconciled",
    });
    phaseRef.current = "error";
    sessionRef.current = failSession(sessionRef.current);
    setCanCancel(false);
    setCancellationPending(false);
    setStatus("error");
    setError(reason);
    setInterimTranscript("");
    useStore.getState().setSurface(useStore.getState().dictationPurpose === "onboarding" ? "onboarding" : "popover");
  }

  function retainManualTranscript() {
    if (disposedRef.current) return;
    recoveryAudioRef.current = null;
    clearCapturedAudio();
    clearCanonicalAudioCache();
    useStore.getState().setRecovery({
      kind: "manual-copy",
      reason: "Copy your transcript, then paste it into your chosen field.",
      audioAvailable: false,
      retrying: false,
      targetMayContainText: false,
    });
    setError(null);
    setInterimTranscript("");
    useStore.getState().setSurface("popover");
    traceDictationEvent("dictation_manual_transcript_ready").catch(() => {});
  }

  function finalizeIdleState() {
    if (disposedRef.current) return;
    void releaseDesktopShortcutSession();
    const completed = useStore.getState();
    if (completed.dictationPurpose === "onboarding") {
      completed.setOnboardingTestPassed(!completed.recovery && Boolean(completed.transcript.trim()) && completed.transcript !== "(no speech detected)");
    } else if (!completed.recovery && completed.transcript.trim() && completed.transcript !== "(no speech detected)") {
      if (cursorDeliveryStateRef.current === "unreconciled") retainCurrentTranscript("delivery-unconfirmed");
      else completed.setLastDictationResult({ completedAt: Date.now(), outcome: "delivered" });
    }
    releaseRecordingOrigin();
    setCanCancel(false);
    setCancellationPending(false);
    recoveryAudioRef.current = null;
    nativeCaptureRef.current = null;
    clearCapturedAudio();
    clearCanonicalAudioCache();
    const stopRequestedAtMs = stopRequestedAtMsRef.current;
    if (stopRequestedAtMs !== null) {
      traceDictationEvent("dictation_stop_to_idle", {
        durationMs: Math.round(performance.now() - stopRequestedAtMs),
      }).catch(() => {});
      stopRequestedAtMsRef.current = null;
    }

    setInterimTranscript("");
    sessionRef.current = finishSessionIdle(sessionRef.current);
    activeTriggerIdRef.current = undefined;
    phaseRef.current = "idle";
    setStatus("idle");
    transitionCursorDelivery("session-idle");
  }

  async function startRecording(triggerId?: string) {
    const phase = phaseRef.current;
    if (phase !== "idle" && phase !== "error") {
      return;
    }

    if (useStore.getState().recovery) {
      releaseRecordingOrigin(triggerId);
      useStore.getState().setSurface("popover");
      void showNotification("Previous transcript available", "Copy any text you need, then clear the previous transcript before starting another.").catch(() => {});
      return;
    }
    const onboardingTest = triggerId === "onboarding:test";
    useStore.getState().setDictationPurpose(onboardingTest ? "onboarding" : "cursor");
    if (onboardingTest) useStore.getState().setOnboardingTestPassed(false);
    activeTriggerIdRef.current = triggerId;
    desktopPasteSessionRef.current = false;
    desktopStreamEnabledRef.current = onboardingTest;
    desktopTargetTokenRef.current = null;
    desktopPhraseQueueRef.current?.cancel();
    desktopPhraseQueueRef.current = null;
    void releaseDesktopShortcutSession();
    desktopStreamedSampleCountRef.current = 0;
    desktopPhrasePasteCountRef.current = 0;
    manualCopyRequestedRef.current = !triggerId?.startsWith("browser:");
    cancelledRef.current = null;
    setCancellationPending(false);
    setCanCancel(true);
    recoveryAudioRef.current = null;
    sessionRef.current = startSession(sessionRef.current);
    const startingSessionId = sessionRef.current.sessionId;
    recoverySessionIdRef.current = crypto.randomUUID();
    sessionConfigRef.current = useStore.getState().config;
    if (onboardingTest && sessionConfigRef.current) {
      sessionConfigRef.current = { ...sessionConfigRef.current, liveCursorMode: "final-text-only" };
    }
    phaseRef.current = "starting";
    traceDictationEvent("recording_state_requested").catch(() => {});
    let nativeAttempt: { generation: number; selectionToken: string } | null = null;
    let ownedShortcut: DesktopShortcutSession | null = null;
    let shortcutEpoch: number | null = null;
    const invalidateNativeSelection = () => {
      if (!nativeAttempt || !isCurrentSession(startingSessionId) ||
          captureGenerationRef.current !== nativeAttempt.generation) return;
      const state = useStore.getState();
      if (state.captureBackendMode === "native" &&
          state.nativeCaptureSource?.selectionToken === nativeAttempt.selectionToken) {
        state.setNativeCaptureSource?.(null);
      }
    };

    let startFailureTitle = "Dictation could not start";
    try {
      if (!onboardingTest && !triggerId?.startsWith("browser:") && sessionConfigRef.current?.transcriptTarget === "cursor") {
        const paste = await getDesktopPasteStatus();
        assertOutputAllowed(startingSessionId);
        if (paste?.enabled) {
          if (!paste.available) {
            startFailureTitle = paste.targetToken ? "Dictation unavailable" : "No text cursor available";
            traceDictationEvent("dictation_desktop_paste_unavailable").catch(() => {});
            throw new Error(paste.detail);
          }
          desktopPasteSessionRef.current = true;
          shortcutEpoch = paste.shortcutEpoch ?? null;
          desktopTargetTokenRef.current = paste.targetToken ?? null;
          desktopStreamEnabledRef.current = Boolean(paste.streamingEnabled) && sessionConfigRef.current?.transcriptEnhancement === "off";
          manualCopyRequestedRef.current = false;
          // The desktop queue owns append-only streaming. Disable the separate
          // owned-preedit preview scheduler for this delivery session.
          sessionConfigRef.current = { ...sessionConfigRef.current, liveCursorMode: "final-text-only" };
          traceDictationEvent("dictation_desktop_paste_session_started").catch(() => {});
        }
      }
      // Capture waits for the native lease ACK (or a confirmed unsupported-route
      // no-op). A held Start shortcut may obscure the first target probe.
      if (desktopStreamEnabledRef.current && !onboardingTest) {
        if (!await desktopShortcutCleanupRef.current) {
          throw new Error("VOCO could not confirm shortcut cleanup. Restart VOCO if the shortcut stays reserved.");
        }
        assertOutputAllowed(startingSessionId);
        if (shortcutEpoch === null) throw new Error("Recording shortcut preflight is unavailable.");
        ownedShortcut = new DesktopShortcutSession({
          begin: beginDesktopShortcutSession,
          end: endDesktopShortcutSession,
        }, shortcutEpoch, confirmed => {
          void traceHotkeyEvent(confirmed ? "dictation_desktop_shortcut_released" : "dictation_desktop_shortcut_release_failed",
            { dictationSessionId: startingSessionId }).catch(() => {});
          if (!confirmed && !disposedRef.current) {
            useStore.getState().setCaptureNotice("VOCO could not confirm shortcut cleanup. Restart VOCO if the shortcut stays reserved.");
          }
        });
        desktopShortcutSessionRef.current = ownedShortcut;
        try {
          await ownedShortcut.acquire();
        } catch (error) {
          if (isCurrentSession(startingSessionId) && !cancelledRef.current) {
            void traceDictationEvent("dictation_desktop_shortcut_acquire_failed").catch(() => {});
          }
          throw error;
        }
        assertOutputAllowed(startingSessionId);
        if (desktopTargetTokenRef.current === null) {
          const paste = await getDesktopPasteStatus();
          assertOutputAllowed(startingSessionId);
          desktopTargetTokenRef.current = paste.targetToken ?? null;
        }
        // Never replace an initially valid target: an intervening focus change
        // must still be rejected by the native paste guard, not silently rebased.
        void traceDictationEvent("dictation_desktop_shortcut_acquired").catch(() => {});
      }
      if (desktopPasteSessionRef.current && !desktopTargetTokenRef.current) {
        throw new Error("VOCO could not verify the dictation destination. Focus an accessible text field and try again.");
      }
      startFailureTitle = "Microphone could not start";
      const captureSelection = captureSelectionRef.current?.() ?? { backend: "webkit" as const };
      let captureAdmission: CaptureAdmission = "pending";
      if (captureSelection.backend === "native" && !captureSelection.selectionToken) {
        throw new Error("Choose and allow a native microphone in Audio settings.");
      }
      clearTranscript();
      setInterimTranscript("Starting microphone. Wait for Listening before speaking.");
      setStatus("starting");
      resetAudioLevel();
      clearCapturedAudio();
      lastLivePreviewTextRef.current = "";
      liveCursorCandidateTextRef.current = "";
      liveDraftConfirmedTextRef.current = "";
      liveCursorTextRef.current = "";
      livePreviewAudioStartSampleRef.current = 0;
      liveCursorInsertionDisabledRef.current = false;
      liveCursorFallbackNotifiedRef.current = false;
      livePreviewFailureNotifiedRef.current = false;
      recordingStartedAtMsRef.current = null;
      stopRequestedAtMsRef.current = null;
      firstLiveTextInsertedRef.current = false;
      livePreviewNextDelayMsRef.current = LIVE_PREVIEW_MIN_INTERVAL_MS;
      debugPreviewFramesRef.current = [];
      debugCanonicalChunksRef.current = [];
      clearCanonicalAudioCache();
      canonicalSessionRef.current = null;
      canonicalCheckpointInFlightRef.current = null;
      canonicalCheckpointDeferredRef.current = false;
      resetOwnedPreeditState();
      transitionCursorDelivery("session-reset");
      captureGenerationRef.current += 1;
      const generation = captureGenerationRef.current;
      let audioContext: AudioContext | null = null;
      debugNativeCaptureEnabledRef.current = false;
      if (captureSelection.backend === "native") {
        nativeAttempt = { generation, selectionToken: captureSelection.selectionToken! };
        debugNativeCaptureEnabledRef.current = await debugNativeCaptureEnabled().catch(() => false);
        assertOutputAllowed(startingSessionId);
        const native = await beginNativeCapture({
          sessionId: startingSessionId, generation, selectionToken: captureSelection.selectionToken!,
          onSamples: (samples) => {
            if (!isCurrentSession(startingSessionId) || captureDescriptorRef.current?.generation !== generation) return 0;
            const accepted = appendRecordingSamples(samples);
            updateAudioLevel(calculateVisualAudioLevelFromSamples(samples));
            return accepted;
          },
          onInterrupted: (reason) => {
            invalidateNativeSelection();
            if (isCurrentSession(startingSessionId) && captureGenerationRef.current === generation) {
              void cancelRecording(reason);
            }
          },
          onLimit: () => { if (isCurrentSession(startingSessionId)) void stopRecording(); },
        });
        if (!isCurrentSession(startingSessionId) || cancelledRef.current) {
          await native.cancel().catch(() => {});
          assertOutputAllowed(startingSessionId);
        }
        nativeCaptureRef.current = native;
        captureDescriptorRef.current = native.descriptor;
        captureAdmission = "automatic";
      } else {
        nativeCaptureRef.current = null;
        audioContext = await ensureAudioContext();
        assertOutputAllowed(startingSessionId);
        captureDescriptorRef.current = createCaptureDescriptor({
          backend: "webkit", sessionId: startingSessionId, generation,
          sourceSampleRate: audioContext.sampleRate, sourceChannels: 1, deliveredChannels: 1,
          sourceIdentity: null, conversion: "webaudio-mono",
        });
      }
      assertOutputAllowed(startingSessionId);
      if (usesCanonicalCursorStreaming(sessionConfigRef.current)) {
        canonicalSessionRef.current = createCanonicalCursorSession(
          sessionRef.current.sessionId,
          recordingSampleRate(),
          canonicalGenerationRef.current,
        );
      }
      if (shouldUseOwnedPreedit()) transitionCursorDelivery("canonical-started");
      if (!onboardingTest) beginOwnedPreedit(sessionRef.current.sessionId, triggerId);
      debugCaptureEnabledRef.current = await debugDictationCaptureEnabled().catch(
        () => false,
      );

      assertOutputAllowed(startingSessionId);
      if (captureSelection.backend === "webkit") {
        const deviceId = useStore.getState().selectedDeviceId;
        let stream = primedStreamRef.current;
        if (stream && (primedDeviceIdRef.current !== deviceId || stream.getAudioTracks().some((track) => track.readyState === "ended"))) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          primedStreamRef.current = null;
        }
        if (stream) {
          primedStreamRef.current = null;
        } else if (primedStreamPromiseRef.current && primedDeviceIdRef.current === deviceId) {
          stream = await primedStreamPromiseRef.current.catch(() => null);
          primedStreamRef.current = null;
        }
        if (!stream) {
          stream = await openTracedMicrophoneStream(deviceId);
        }

        if (disposedRef.current || cancelledRef.current || sessionRef.current.sessionId !== startingSessionId) {
          stream.getTracks().forEach((track) => track.stop());
          assertOutputAllowed(startingSessionId);
        }
        streamRef.current = stream;
        setMicrophoneReadyState(true);
        console.info("Recording started");
        recordingStartedAtMsRef.current = performance.now();
        if (
          firstHotkeyPressMsRef.current !== null &&
          !initialHotkeyLatencyLoggedRef.current
        ) {
          initialHotkeyLatencyLoggedRef.current = true;
          console.info(
            `[timing] first hotkey press -> recording starts: ${Math.round(
              performance.now() - firstHotkeyPressMsRef.current,
            )}ms`,
          );
        }

        traceDictationEvent("recording_audio_context_ready").catch(() => {});

        const source = audioContext!.createMediaStreamSource(stream);
        sourceRef.current = source;
        traceDictationEvent("recording_media_source_created").catch(() => {});

        // The legacy fallback retains received audio for explicit manual recovery.
        const workletOk = await connectWorklet(audioContext!, source);
        assertOutputAllowed(startingSessionId);
        captureAdmission = workletOk ? "automatic" : "manual-review";
        if (!workletOk) {
          sessionRef.current = disableLivePreview(sessionRef.current);
          liveCursorInsertionDisabledRef.current = true;
          canonicalCheckpointDeferredRef.current = true;
          useStore.getState().setCaptureNotice(
            "This recording needs manual review because complete audio capture cannot be confirmed. After stopping, retry transcription to review the audio received.",
          );
          connectScriptProcessor(audioContext!, source);
          traceDictationEvent("recording_script_processor_connected").catch(() => {});
        } else {
          traceDictationEvent("recording_worklet_connected").catch(() => {});
        }

        captureHealthRef.current = monitorCaptureHealth({
          stream,
          onInterrupted: (reason) => {
            traceDictationEvent("dictation_capture_health_interrupted").catch(() => {});
            void cancelRecording(reason);
          },
          onDurationLimit: () => { void stopRecording(); },
        });
      } else {
        setMicrophoneReadyState(true);
        recordingStartedAtMsRef.current = performance.now();
      }

      sessionRef.current = markRecording(sessionRef.current);
      phaseRef.current = "recording";
      if (desktopStreamEnabledRef.current && captureAdmission === "automatic") {
        const rate = recordingSampleRate();
        desktopPhraseQueueRef.current = new BenchmarkPhraseQueue(async (text, correlation) => {
          assertOutputAllowed(startingSessionId);
          // Onboarding exercises recognition without owning or mutating another app.
          if (onboardingTest) return;
          const started = performance.now();
          desktopPhrasePasteCountRef.current++;
          traceDictationEvent("dictation_desktop_paste_requested").catch(() => {});
          const result = await pasteDesktopText(text, desktopTargetTokenRef.current, correlation);
          if (result.outcome !== "dispatched") throw new Error("Desktop phrase paste was not dispatched.");
          // The old queue still records its actual native outcome, but a late
          // completion must not update a replacement session's UI or timings.
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDesktopPasteMetrics(result);
          traceDictationEvent("dictation_desktop_paste_dispatched", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
          if (desktopPhrasePasteCountRef.current === 1 && recordingStartedAtMsRef.current !== null) {
            traceDictationEvent("dictation_desktop_first_phrase_dispatched", { durationMs: Math.round(performance.now() - recordingStartedAtMsRef.current) }).catch(() => {});
          }
        }, (text) => {
          if (!isCurrentSession(startingSessionId)) return;
          setTranscript(text);
          useStore.getState().setRawTranscript(text);
        }, (error) => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          if (onboardingTest) setError(`Voice test paused: ${error.message} Stop Test, then try again.`);
          else useStore.getState().setCaptureNotice(LIVE_DELIVERY_PAUSED);
        }, (event, durationMs) => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current || onboardingTest) return;
          const name = event === "appended" ? "dictation_desktop_live_prefix_dispatched"
            : `dictation_desktop_snapshot_${event}`;
          traceDictationEvent(name, durationMs === undefined ? null : { durationMs }).catch(() => {});
        }, startingSessionId, !onboardingTest);
        // Audio can arrive while the worklet is starting. Keep planner offsets
        // aligned with the complete retained source, including that prefix.
        const prefix = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
        desktopPhraseQueueRef.current?.pushAudio?.(prefix, rate);
        desktopStreamedSampleCountRef.current = prefix.length;
        traceDictationEvent("dictation_desktop_stream_started").catch(() => {});
      }
      nativeCaptureRef.current?.startDelivery();
      setInterimTranscript("Listening...");
      setStatus("recording");
      traceDictationEvent("recording_state_active").catch(() => {});
      if (shouldRunLivePreview()) {
        scheduleLivePreview(LIVE_PREVIEW_INITIAL_DELAY_MS);
      }

      const queuedStop = consumeQueuedStop(sessionRef.current);
      sessionRef.current = queuedStop.state;
      if (queuedStop.shouldStop) {
        void stopRecording();
      }
    } catch (err) {
      if (ownedShortcut) await releaseDesktopShortcutSession(ownedShortcut);
      if (!isCurrentSession(startingSessionId)) return;
      if (!cancelledRef.current) invalidateNativeSelection();
      await teardownAudioGraph().catch(() => {});
      await clearLiveCursorText().catch(() => {});
      if (!isCurrentSession(startingSessionId)) return;
      releaseRecordingOrigin(triggerId);
      setCanCancel(false);
      setCancellationPending(false);
      if (
        audioBufferRef.current.sampleCount > 0 &&
        (captureDescriptorRef.current?.backend === "native" || cancelledRef.current === CAPTURE_INPUT_INTERRUPTED)
      ) {
        retainRecovery(cancelledRef.current ?? `Native microphone startup failed: ${errorMessage(err)}`);
        return;
      }
      if (cancelledRef.current) {
        finalizeIdleState();
        useStore.getState().setCaptureNotice(cancelledRef.current);
        return;
      }
      resetAudioLevel();
      setStatus("error");
      // Native readiness belongs to the guarded selection invalidation above.
      // A late failure must not revoke a newer source's readiness.
      if (!nativeAttempt) setMicrophoneReadyState(false);
      setInterimTranscript("");
      sessionRef.current = failSession(sessionRef.current);
      phaseRef.current = "error";
      showNotification(
        startFailureTitle,
        errorMessage(err),
      ).catch(() => {});

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError(
            "Microphone access denied. Check system permissions, then try recording again.",
          );
        } else if (err.name === "NotFoundError") {
          setError("No microphone found. Connect a microphone, then try recording again.");
        } else {
          setError(`Microphone error: ${err.message}`);
        }
      } else {
        setError(errorMessage(err));
      }
    }
  }

  async function stopRecording() {
    if (phaseRef.current !== "recording") {
      return;
    }

    const stoppingSessionId = sessionRef.current.sessionId;
    phaseRef.current = "stopping";
    traceDictationEvent("dictation_recording_stopped").catch(() => {});
    stopRequestedAtMsRef.current = performance.now();
    if (recordingStartedAtMsRef.current !== null) {
      traceDictationEvent("dictation_recording_duration", {
        durationMs: Math.round(stopRequestedAtMsRef.current - recordingStartedAtMsRef.current),
      }).catch(() => {});
    }
    sessionRef.current = requestSessionStop(sessionRef.current);
    if (canonicalSessionRef.current) {
      canonicalSessionRef.current = requestCanonicalStop(
        canonicalSessionRef.current,
      );
    }
    setStatus("processing");
    setInterimTranscript("Wrapping up...");
    stopLivePreview();

    let sampleRate: number;
    let merged: Float32Array = new Float32Array();
    try {
      try {
        sampleRate = await teardownAudioGraph();
      } catch (error) {
        if (error instanceof AudioCaptureFlushError && isCurrentSession(stoppingSessionId)) {
          // Invalidate pending output before awaiting any native cleanup. Received
          // samples remain available, but missing input or a transport tail cannot
          // be recovered by retrying recognition.
          const reason = cancelledRef.current === CAPTURE_INPUT_INTERRUPTED
            ? CAPTURE_INPUT_INTERRUPTED
            : error.message;
          cancelledRef.current = reason;
          desktopPhraseQueueRef.current?.cancel();
          useStore.getState().setCaptureNotice(reason);
          sessionRef.current = disableLivePreview(sessionRef.current);
          const canonical = canonicalSessionRef.current;
          if (canonical) {
            canonicalSessionRef.current = failCanonicalSession(
              canonical.delivery === "owned" ? markCanonicalDeliveryUncertain(canonical) : canonical,
            );
          }
        }
        throw error;
      }
      if (!isCurrentSession(stoppingSessionId)) return;
      traceDictationEvent("dictation_audio_teardown_completed", {
        trackSampleRate: sampleRate,
        durationMs: Math.round(audioBufferRef.current.sampleCount / sampleRate * 1000),
      }).catch(() => {});
      resetAudioLevel();
      let waitStartedAt = performance.now();
      const checkpointInFlight = canonicalCheckpointInFlightRef.current;
      if (checkpointInFlight) {
        await checkpointInFlight.catch(() => {});
      }
      traceHotkeyEvent("dictation_stop_checkpoint_wait_completed", {
        dictationSessionId: stoppingSessionId,
        durationMs: Math.round(performance.now() - waitStartedAt),
      }).catch(() => {});
      waitStartedAt = performance.now();
      const previewInFlight = livePreviewInFlightRef.current;
      if (previewInFlight) {
        await previewInFlight.catch(() => {});
      }
      traceHotkeyEvent("dictation_stop_preview_wait_completed", {
        dictationSessionId: stoppingSessionId,
        durationMs: Math.round(performance.now() - waitStartedAt),
      }).catch(() => {});
      waitStartedAt = performance.now();
      await waitForLiveCursorInsertion();
      traceHotkeyEvent("dictation_stop_insertion_wait_completed", {
        dictationSessionId: stoppingSessionId,
        durationMs: Math.round(performance.now() - waitStartedAt),
      }).catch(() => {});
      assertOutputAllowed(stoppingSessionId);

      if (desktopPhraseQueueRef.current) {
        const waitStarted = performance.now();
        enqueueDesktopPhrase(audioBufferRef.current.sampleCount);
        try {
          await desktopPhraseQueueRef.current.finish();
          assertOutputAllowed(stoppingSessionId);
          traceDictationEvent("dictation_desktop_stream_flush_completed", { durationMs: Math.round(performance.now() - waitStarted) }).catch(() => {});
          if (stopRequestedAtMsRef.current !== null) traceDictationEvent("dictation_stop_to_final_transcript", { durationMs: Math.round(performance.now() - stopRequestedAtMsRef.current) }).catch(() => {});
          desktopPhraseQueueRef.current = null;
          finalizeIdleState();
        } catch (error) {
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          retainRecovery(cancelledRef.current ?? (useStore.getState().dictationPurpose === "onboarding"
            ? `Voice test stopped: ${errorMessage(error)}. You can try the test again.`
            : `Progressive delivery stopped: ${errorMessage(error)}. Review the target before copying retained text.`));
        }
        return;
      }

      if (canonicalSessionRef.current) {
        const capturedSourceSampleCount = audioBufferRef.current.sampleCount;
        if (capturedSourceSampleCount === 0) {
          clearCanonicalAudioCache();
          await clearLiveCursorText().catch(() => {});
          if (!isCurrentSession(stoppingSessionId)) return;
          finalizeIdleState();
          return;
        }
        if (capturedSourceSampleCount < sampleRate * 0.3) {
          clearCapturedAudio();
          clearCanonicalAudioCache();
          await clearLiveCursorText().catch(() => {});
          if (!isCurrentSession(stoppingSessionId)) return;
          finalizeIdleState();
          return;
        }

        phaseRef.current = "processing";
        sessionRef.current = markProcessing(sessionRef.current);
        setInterimTranscript("Transcribing canonical checkpoints...");
        const transcribeStartedAt = performance.now();
        try {
          await completeCanonicalRecording(
            capturedSourceSampleCount,
            transcribeStartedAt,
            stoppingSessionId,
          );
        } catch (error) {
          if (!isCurrentSession(stoppingSessionId)) return;
          const current = canonicalSessionRef.current;
          if (current) {
            canonicalSessionRef.current = failCanonicalSession(current);
          }
          transitionCursorDelivery("ownership-uncertain");
          await clearLiveCursorText().catch(() => {});
          if (!isCurrentSession(stoppingSessionId)) return;
          retainRecovery(cancelledRef.current ?? `Canonical transcription failed: ${errorMessage(error)}`);
          return;
        }
        return;
      }

      merged = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);

      if (merged.length > 0) {
        removeDcOffsetInPlace(merged);

        if (Math.abs(sampleRate - TARGET_SAMPLE_RATE) > 1) {
          merged = await resampleAudioForTranscription(
            merged,
            sampleRate,
            TARGET_SAMPLE_RATE,
          );
        }
      }
    } catch (err) {
      if (!isCurrentSession(stoppingSessionId)) return;
      resetAudioLevel();
      await clearLiveCursorText().catch(() => {});
      if (!isCurrentSession(stoppingSessionId)) return;
      retainRecovery(cancelledRef.current ?? `Audio processing failed: ${errorMessage(err)}`);
      return;
    }

    if (!isCurrentSession(stoppingSessionId)) return;
    if (merged.length === 0) {
      await clearLiveCursorText().catch((error) => {
        console.warn("Failed to clear live cursor text after empty recording:", error);
      });
      if (!isCurrentSession(stoppingSessionId)) return;
      finalizeIdleState();
      return;
    }

    // Skip very short recordings (< 0.3s)
    if (merged.length < TARGET_SAMPLE_RATE * 0.3) {
      await clearLiveCursorText().catch((error) => {
        console.warn("Failed to clear live cursor text after short recording:", error);
      });
      if (!isCurrentSession(stoppingSessionId)) return;
      finalizeIdleState();
      return;
    }

    if (merged.length > TARGET_SAMPLE_RATE * MAX_AUDIO_SECONDS) {
      await clearLiveCursorText().catch(() => {});
      phaseRef.current = "error";
      sessionRef.current = failSession(sessionRef.current);
      retainCurrentTranscript("output-failed");
      setStatus("error");
      setError(
        `Recording too long. Please keep dictation under ${MAX_AUDIO_SECONDS} seconds.`,
      );
      setInterimTranscript("");
      return;
    }

    recoveryAudioRef.current = merged;
    traceDictationEvent("dictation_audio_prepared", {
      trackSampleRate: TARGET_SAMPLE_RATE,
      durationMs: Math.round(merged.length / TARGET_SAMPLE_RATE * 1000),
    }).catch(() => {});
    phaseRef.current = "processing";
    sessionRef.current = markProcessing(sessionRef.current);
    setInterimTranscript("Transcribing...");
    const transcribeStartedAt = performance.now();

    try {
      // Preview hypotheses are never authoritative. Always run the complete
      // recording through the final transcription path.
      assertOutputAllowed(stoppingSessionId);
      traceDictationEvent("dictation_transcription_started").catch(() => {});
      const transcript = await transcribeAudio(merged);
      assertOutputAllowed(stoppingSessionId);
      const transcriptionDurationMs = Math.round(
        performance.now() - transcribeStartedAt,
      );
      console.info(
        `[timing] transcription completed: ${transcriptionDurationMs}ms`,
      );
      traceDictationEvent("dictation_transcription_completed", {
        durationMs: transcriptionDurationMs,
      }).catch(() => {});
      if (stopRequestedAtMsRef.current !== null) {
        traceDictationEvent("dictation_stop_to_final_transcript", {
          durationMs: Math.round(performance.now() - stopRequestedAtMsRef.current),
        }).catch(() => {});
      }

      if (debugCaptureEnabledRef.current) {
        const pendingCapture = {
          audio: merged,
          completedTranscript: transcript,
          committedCursorText: ownedPreeditProgressiveRef.current
            ? ownedPreeditCommittedTextRef.current
            : ownedPreeditActiveRef.current
              ? ""
              : liveCursorTextRef.current,
          cursorInsertionDisabled:
            liveCursorInsertionDisabledRef.current ||
            sessionRef.current.liveCursorInsertionDisabled,
          needsFullAudioReference: false,
          previewFrames: [...debugPreviewFramesRef.current],
          sessionId: sessionRef.current.sessionId,
        };
        debugCaptureEnabledRef.current = false;
        // A full-session reference pass is intentionally diagnostic-only. Do not
        // hold the toggle or final cursor insertion behind several seconds of
        // extra ASR work when one-shot capture is enabled.
        void persistDebugCapture(pendingCapture);
      }

      if (!transcript || transcript.trim().length === 0) {
        await clearLiveCursorText().catch((error) => {
          console.warn("Failed to clear live cursor text after empty transcript:", error);
        });
        if (!isCurrentSession(stoppingSessionId)) return;
        setTranscript("(no speech detected)");
        finalizeIdleState();
        return;
      }

      useStore.getState().setRawTranscript(transcript);
      setTranscript(transcript);
      const textToInsert = transcript;
      setInterimTranscript("Typing at your cursor...");

      assertOutputAllowed(stoppingSessionId);

      try {
        phaseRef.current = "finalizing";
        setCanCancel(false);
        sessionRef.current = markFinalizing(sessionRef.current);
        if (desktopPasteSessionRef.current) {
          const pasteStarted = performance.now();
          traceDictationEvent("dictation_desktop_paste_requested").catch(() => {});
          const result = await pasteDesktopText(textToInsert);
          if (!isCurrentSession(stoppingSessionId)) return;
          if (result.outcome !== "dispatched") throw new Error("Desktop paste dispatch was not acknowledged.");
          traceDesktopPasteMetrics(result);
          traceDictationEvent("dictation_desktop_paste_dispatched", {
            durationMs: Math.round(performance.now() - pasteStarted),
          }).catch(() => {});
          // Dispatch is not a receipt from the editor. Keep that distinction in
          // telemetry and leave the transcript available in VOCO for recovery.
          finalizeIdleState();
          return;
        }
        const liveFinalization = await replaceLiveCursorTextWithFinal(textToInsert);
        if (!isCurrentSession(stoppingSessionId)) return;
        if (liveFinalization === "safe") {
          console.info("[timing] owned cursor text finalized safely");
          traceDictationEvent("dictation_final_output_completed").catch(() => {});
        } else if (liveFinalization === "unreconciled") {
          if (manualCopyRequestedRef.current && !ownedPreeditActiveRef.current) {
            retainManualTranscript();
          } else {
          transitionCursorDelivery("ownership-uncertain");
          console.info("[timing] authoritative final not applied after unsafe live reconciliation");
          retainRecovery("The original field could not be verified. Review the target, then copy the text you need.", false);
          traceDictationEvent("dictation_final_output_unreconciled").catch(() => {});
          }
        } else {
          transitionCursorDelivery("ownership-uncertain");
        }
      } catch (err) {
        if (!isCurrentSession(stoppingSessionId)) return;
        const detail = errorMessage(err);
        if (desktopPasteSessionRef.current) {
          transitionCursorDelivery("ownership-uncertain");
          traceDictationEvent("dictation_desktop_paste_failed").catch(() => {});
        }
        traceDictationEvent("dictation_final_insertion_failed").catch(() => {});
        showNotification(
          "Text insertion failed",
          detail.includes("clipboard")
            ? detail
            : "VOCO could not confirm insertion. Open VOCO to recover the transcript and review the target before pasting.",
        ).catch(() => {});
        phaseRef.current = "error";
        sessionRef.current = failSession(sessionRef.current);
        retainCurrentTranscript("output-failed");
        setStatus("error");
        retainRecovery(`Text insertion failed: ${detail}`, false);
        return;
      }

      finalizeIdleState();
    } catch (err) {
      if (!isCurrentSession(stoppingSessionId)) return;
      await clearLiveCursorText().catch((error) => {
        console.warn("Failed to clear live cursor text after transcription failure:", error);
      });
      if (!isCurrentSession(stoppingSessionId)) return;
      retainRecovery(cancelledRef.current ?? `Transcription failed: ${errorMessage(err)}`);
    }
  }

  async function cancelRecording(reason = "Recording cancelled. Captured audio remains in memory until you retry or discard it.") {
    const recoveryWait = recoveryWaitRef.current;
    if (recoveryWait) {
      recoveryWaitRef.current = null;
      recoveryWait.cancel();
      retainRecovery("Recovery cancelled. Audio remains available to retry or discard. The previous local operation may still be finishing.");
      return;
    }
    if (phaseRef.current === "idle" || phaseRef.current === "error" || phaseRef.current === "finalizing" || cancelledRef.current) return;
    cancelledRef.current = reason;
    desktopPhraseQueueRef.current?.cancel();
    void releaseDesktopShortcutSession();
    if (canonicalSessionRef.current?.delivery === "owned") {
      canonicalSessionRef.current = markCanonicalDeliveryUncertain(canonicalSessionRef.current);
    }
    setCancellationPending(true);
    setCanCancel(false);
    sessionRef.current = disableLivePreview(sessionRef.current);
    stopLivePreview();
    captureHealthRef.current?.dispose();
    captureHealthRef.current = null;
    if (phaseRef.current === "recording") {
      await stopRecording();
    } else {
      setInterimTranscript("Cancelling output. Waiting for the current local operation to finish...");
    }
  }


  function dispose() {
    disposedRef.current = true;
    desktopPhraseQueueRef.current?.cancel();
    void releaseDesktopShortcutSession();
    recoveryWaitRef.current?.cancel();
    recoveryWaitRef.current = null;
    releaseRecordingOrigin();
    lifecycleEpochRef.current += 1;
    phaseRef.current = "idle";
    sessionRef.current = {
      ...finishSessionIdle(sessionRef.current),
      sessionId: sessionRef.current.sessionId + 1,
      previewGeneration: sessionRef.current.previewGeneration + 1,
    };
    captureHealthRef.current?.dispose();
    captureHealthRef.current = null;
    clearLivePreviewTimer();
    workletFlushRef.current?.cancel();
    workletFlushRef.current = null;
    disconnectAudioGraph();
    const native = nativeCaptureRef.current;
    nativeCaptureRef.current = null;
    void native?.cancel().catch(() => {});
    primedStreamRef.current?.getTracks().forEach((track) => track.stop());
    primedStreamRef.current = null;
    primedStreamPromiseRef.current = null;
    canonicalSessionRef.current = null;
    const ownedId = ownedPreeditSessionIdRef.current;
    if (ownedId !== null) void cancelOwnedPreedit(ownedId).catch(() => {});
    resetOwnedPreeditState();
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    recoveryAudioRef.current = null;
    clearCapturedAudio();
    clearCanonicalAudioCache();
  }

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    releaseDesktopShortcutSession,
    finalizeIdleState,
    retainRecovery,
    retainManualTranscript,
    isCurrentSession,
    assertOutputAllowed,
    releaseRecordingOrigin,
    dispose,
  };
}
