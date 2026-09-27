import {
  collectAudioSamplesRange,
  type AudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import {
  AudioCaptureFlushError,
  CAPTURE_INPUT_INTERRUPTED,
} from "@/lib/audioCaptureFlush";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import { BenchmarkPhraseQueue } from "@/lib/benchmarkPhraseQueue";
import {
  createCaptureDescriptor,
  type CaptureDescriptor,
  type CaptureSelection,
} from "@/lib/captureDescriptor";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import { DesktopShortcutSession } from "@/lib/desktopShortcutSession";
import type { CursorDeliveryEvent } from "@/lib/dictationDelivery";
import { errorMessage,LIVE_DELIVERY_PAUSED,LIVE_LOCAL_TRANSCRIPTION } from "@/lib/dictationRecovery";
import {
  consumeQueuedStop,
  disableLivePreview,
  failSession,
  finishSessionIdle,
  markRecording,
  requestStop as requestSessionStop,
  startSession,
  type DictationSessionState,
} from "@/lib/dictationSession";
import { beginNativeCapture,type NativeCaptureSession } from "@/lib/nativeCapture";
import type { HotkeyTraceFields,pasteDesktopText } from "@/lib/tauri";
import type { useStore as appStore } from "@/store/useStore";
import type { AppConfig,DictationStatus } from "@/types";
import { BrowserStreamDelivery } from "./browserStreamDelivery";

export type Ref<T> = { current: T };

export type DictationRecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "processing"
  | "finalizing"
  | "error";
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
  browserDeliveryRef: Ref<BrowserStreamDelivery | null>;
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
  desktopStreamedSampleCountRef: Ref<number>;
  desktopPhrasePasteCountRef: Ref<number>;
  manualCopyRequestedRef: Ref<boolean>;
  activeTriggerIdRef: Ref<string | undefined>;
  recoverySessionIdRef: Ref<string | null>;
  recoveryWaitRef: Ref<{ cancel: () => void } | null>;
  sessionConfigRef: Ref<AppConfig | null>;
  nativeCaptureRef: Ref<NativeCaptureSession | null>;
  captureDescriptorRef: Ref<CaptureDescriptor | null>;
  captureSelectionRef: Ref<(() => CaptureSelection) | undefined>;
  captureGenerationRef: Ref<number>;
  recordingStartedAtMsRef: Ref<number | null>;
  stopRequestedAtMsRef: Ref<number | null>;
  firstHotkeyPressMsRef: Ref<number | null>;
  initialHotkeyLatencyLoggedRef: Ref<boolean>;
  debugNativeCaptureEnabledRef: Ref<boolean>;
  audioBufferRef: Ref<AudioCaptureBuffer>;
  cursorDeliveryStateRef: Ref<string>;
  lifecycleEpochRef: Ref<number>;
  audioContextRef: Ref<AudioContext | null>;
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
  // Store and native helpers are injected so tests can substitute them.
  useStore: Pick<typeof appStore, "getState">;
  beginDesktopShortcutSession: (id: string, epoch: number) => Promise<void>;
  endDesktopShortcutSession: (id: string) => Promise<void>;
  awaitStopShortcutReservation: (sessionId: number) => Promise<void>;
  getDesktopPasteStatus: () => Promise<{
    enabled?: boolean;
    available?: boolean;
    streamingEnabled?: boolean;
    targetToken?: string | null;
    failureReason?: "setup" | "cursor" | null;
    shortcutEpoch?: number | null;
    detail?: string;
  }>;
  pasteDesktopText: typeof pasteDesktopText;
  traceDictationEvent: (event: string, fields?: HotkeyTraceFields | null) => Promise<void>;
  traceHotkeyEvent: (event: string, fields?: HotkeyTraceFields | null) => Promise<void>;
  showNotification: (title: string, body: string) => Promise<void>;
  setCancellationPending: (value: boolean) => void;
  setCanCancel: (value: boolean) => void;
  setStatus: (status: DictationStatus) => void;
  setInterimTranscript: (text: string) => void;
  setTranscript: (text: string) => void;
  setError: (error: string | null) => void;
  setMicrophoneReadyState: (ready: boolean) => void;
  clearTranscript: () => void;
  resetAudioLevel: () => void;
  updateAudioLevel: (level: number) => void;
  clearCapturedAudio: () => void;
  transitionCursorDelivery: (event: CursorDeliveryEvent) => void;
  retainCurrentTranscript: (reason: "delivery-unconfirmed" | "output-failed") => void;
  recordingSampleRate: () => number;
  appendRecordingSamples: (samples: Float32Array) => number;
  enqueueDesktopPhrase: (end: number) => void;
  teardownAudioGraph: () => Promise<number>;
  disconnectAudioGraph: () => void;
  flushCaptureSamples?: () => Promise<void>;
  ensureAudioContext: () => Promise<AudioContext>;
  openTracedMicrophoneStream: (deviceId: string | null) => Promise<MediaStream>;
  connectWorklet: (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => Promise<boolean>;
  connectScriptProcessor: (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => void;
  traceDesktopPasteMetrics: (result: Awaited<ReturnType<typeof pasteDesktopText>>) => void;
  debugNativeCaptureEnabled: () => Promise<boolean>;
  beginNativeCapture: typeof beginNativeCapture;
  releaseBrowserRecording: (triggerId: string) => Promise<void>;
  console?: Pick<Console, "info" | "warn">;
}

export function createDictationRecording(env: DictationRecordingEnv) {
  const {
    phaseRef,
    sessionRef,
    disposedRef,
    cancelledRef,
    browserDeliveryRef,
    desktopShortcutSessionRef,
    desktopShortcutCleanupRef,
    desktopPhraseQueueRef,
    desktopTargetTokenRef,
    desktopPasteSessionRef,
    desktopStreamedSampleCountRef,
    desktopPhrasePasteCountRef,
    manualCopyRequestedRef,
    activeTriggerIdRef,
    recoverySessionIdRef,
    recoveryWaitRef,
    sessionConfigRef,
    nativeCaptureRef,
    captureDescriptorRef,
    captureSelectionRef,
    captureGenerationRef,
    recordingStartedAtMsRef,
    stopRequestedAtMsRef,
    firstHotkeyPressMsRef,
    initialHotkeyLatencyLoggedRef,
    debugNativeCaptureEnabledRef,
    audioBufferRef,
    cursorDeliveryStateRef,
    lifecycleEpochRef,
    audioContextRef,
    primedStreamRef,
    primedStreamPromiseRef,
    captureHealthRef,
    workletFlushRef,
    streamRef,
    sourceRef,
    primedDeviceIdRef,
    useStore,
    beginDesktopShortcutSession,
    endDesktopShortcutSession,
    awaitStopShortcutReservation,
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
    transitionCursorDelivery,
    retainCurrentTranscript,
    recordingSampleRate,
    appendRecordingSamples,
    enqueueDesktopPhrase,
    teardownAudioGraph,
    disconnectAudioGraph,
    ensureAudioContext,
    openTracedMicrophoneStream,
    connectWorklet,
    connectScriptProcessor,
    traceDesktopPasteMetrics,
    debugNativeCaptureEnabled,
    beginNativeCapture,
    releaseBrowserRecording,
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
    void browserDeliveryRef.current?.cancel();
    releaseRecordingOrigin();
    traceDictationEvent("dictation_recovery_retained", {
      trackSampleRate: recordingSampleRate(),
      durationMs: Math.round(audioBufferRef.current.sampleCount / (recordingSampleRate()) * 1000),
    }).catch(() => {});
    if (!keepAudio) {
      clearCapturedAudio();
    }
    const reviewingRecovery = Boolean(useStore.getState().recovery);
    useStore.getState().setRecovery({
      reason,
      audioAvailable: keepAudio && audioBufferRef.current.sampleCount > 0,
      retrying: false,
      targetMayContainText: desktopPhrasePasteCountRef.current > 0 || cursorDeliveryStateRef.current === "unreconciled",
    });
    phaseRef.current = "error";
    sessionRef.current = failSession(sessionRef.current);
    setCanCancel(false);
    setCancellationPending(false);
    setStatus("error");
    setError(reason);
    setInterimTranscript("");
    const state = useStore.getState();
    if (state.captureNotice === LIVE_DELIVERY_PAUSED || state.captureNotice === LIVE_LOCAL_TRANSCRIPTION) {
      state.setCaptureNotice(null);
    }
    if (state.dictationPurpose === "onboarding") {
      state.setSurface("onboarding");
    } else if (!reviewingRecovery) {
      state.setSurface("hidden");
      void showNotification("Dictation saved in VOCO", "Open VOCO from the tray to review or copy your dictation. It stays available until VOCO closes.").catch(() => {});
    }
  }

  function retainManualTranscript() {
    if (disposedRef.current) return;
    clearCapturedAudio();
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
    void browserDeliveryRef.current?.cancel();
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
    nativeCaptureRef.current = null;
    clearCapturedAudio();
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
      void showNotification("Previous transcript available", "Open VOCO from the tray to copy or clear the previous transcript before starting another.").catch(() => {});
      return;
    }
    const onboardingTest = triggerId === "onboarding:test";
    useStore.getState().setDictationPurpose(onboardingTest ? "onboarding" : "cursor");
    if (onboardingTest) useStore.getState().setOnboardingTestPassed(false);
    activeTriggerIdRef.current = triggerId;
    desktopPasteSessionRef.current = false;
    desktopTargetTokenRef.current = null;
    desktopPhraseQueueRef.current?.cancel();
    desktopPhraseQueueRef.current = null;
    void releaseDesktopShortcutSession();
    void browserDeliveryRef.current?.cancel();
    browserDeliveryRef.current = null;
    desktopStreamedSampleCountRef.current = 0;
    desktopPhrasePasteCountRef.current = 0;
    manualCopyRequestedRef.current = !triggerId?.startsWith("browser:");
    cancelledRef.current = null;
    setCancellationPending(false);
    setCanCancel(true);
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
    let webkitCaptureAttempted = false;
    let destinationSetupFailure = false;
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
            startFailureTitle = paste.failureReason === "cursor" ? "No text cursor available" : "Dictation setup incomplete";
            destinationSetupFailure = true;
            traceDictationEvent("dictation_desktop_paste_unavailable").catch(() => {});
            throw new Error(paste.detail);
          }
          desktopPasteSessionRef.current = true;
          shortcutEpoch = paste.shortcutEpoch ?? null;
          desktopTargetTokenRef.current = paste.targetToken ?? null;
          if (!paste.streamingEnabled) throw new Error("Streaming dictation is disabled in the desktop environment.");
          manualCopyRequestedRef.current = false;
          // Retain the fixed compatibility snapshot; the queue owns streaming.
          sessionConfigRef.current = { ...sessionConfigRef.current, liveCursorMode: "final-text-only" };
          traceDictationEvent("dictation_desktop_paste_session_started").catch(() => {});
        }
      }
      // Capture waits for the native lease ACK (or a confirmed unsupported-route
      // no-op). A held Start shortcut may obscure the first target probe.
      if (desktopPasteSessionRef.current && !onboardingTest) {
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
      clearTranscript();
      setInterimTranscript("Starting microphone. Wait for Listening before speaking.");
      setStatus("starting");
      if (desktopPasteSessionRef.current) {
        try {
          await awaitStopShortcutReservation(startingSessionId);
          assertOutputAllowed(startingSessionId);
        } catch (error) {
          startFailureTitle = "Dictation setup incomplete";
          destinationSetupFailure = true;
          throw error;
        }
      }
      startFailureTitle = "Microphone could not start";
      const captureSelection = captureSelectionRef.current?.() ?? { backend: "webkit" as const };
      let captureAdmission: CaptureAdmission = "pending";
      if (captureSelection.backend === "native" && !captureSelection.selectionToken) {
        throw new Error("Choose and allow a native microphone in Audio settings.");
      }
      resetAudioLevel();
      clearCapturedAudio();
      recordingStartedAtMsRef.current = null;
      stopRequestedAtMsRef.current = null;
      transitionCursorDelivery("session-reset");
      captureGenerationRef.current += 1;
      const generation = captureGenerationRef.current;
      let audioContext: AudioContext | null = null;
      debugNativeCaptureEnabledRef.current = false;
      // Field admission must not start capture or revoke an approved microphone.
      if (triggerId?.startsWith("browser:")) {
        const delivery = new BrowserStreamDelivery(() => isCurrentSession(startingSessionId) && !cancelledRef.current);
        browserDeliveryRef.current = delivery;
        await delivery.start(startingSessionId, triggerId);
        assertOutputAllowed(startingSessionId);
        manualCopyRequestedRef.current = false;
        transitionCursorDelivery("ownership-established");
      }
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
        webkitCaptureAttempted = true;
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
      if (captureAdmission === "automatic") {
        const rate = recordingSampleRate();
        desktopPhraseQueueRef.current = new BenchmarkPhraseQueue(async (text, correlation) => {
          assertOutputAllowed(startingSessionId);
          // Onboarding exercises recognition without owning or mutating another app.
          if (onboardingTest || manualCopyRequestedRef.current) return;
          const browser = browserDeliveryRef.current;
          if (browser) {
            desktopPhrasePasteCountRef.current++;
            await browser.append(text);
            return;
          }
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
        }, (error, kind) => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          if (onboardingTest) setError(`Voice test paused: ${error.message} Stop Test, then try again.`);
          else {
            const notice = kind === "delivery"
              ? LIVE_LOCAL_TRANSCRIPTION
              : LIVE_DELIVERY_PAUSED;
            useStore.getState().setCaptureNotice(notice);
            if (phaseRef.current === "recording") {
              void showNotification(kind === "delivery" ? "Text delivery paused" : "Dictation needs attention", notice).catch(() => {});
            }
          }
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
      void browserDeliveryRef.current?.cancel();
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
      if (destinationSetupFailure) {
        finalizeIdleState();
        setError(null);
        useStore.getState().setCaptureNotice(errorMessage(err));
        void showNotification(startFailureTitle, errorMessage(err)).catch(() => {});
        return;
      }
      resetAudioLevel();
      setStatus("error");
      // Native readiness belongs to the guarded selection invalidation above.
      // Destination/shortcut rejection happens before capture and says nothing
      // about microphone readiness. A late native failure must not revoke a newer source.
      if (webkitCaptureAttempted) setMicrophoneReadyState(false);
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
    if (phaseRef.current !== "recording") return;
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
    setStatus("processing");
    setInterimTranscript("Wrapping up...");
    try {
      try {
        const sampleRate = await teardownAudioGraph();
        if (!isCurrentSession(stoppingSessionId)) return;
        traceDictationEvent("dictation_audio_teardown_completed", {
          trackSampleRate: sampleRate,
          durationMs: Math.round(audioBufferRef.current.sampleCount / sampleRate * 1000),
        }).catch(() => {});
      } catch (error) {
        if (error instanceof AudioCaptureFlushError && isCurrentSession(stoppingSessionId)) {
          cancelledRef.current ??= error.message;
          desktopPhraseQueueRef.current?.cancel();
          useStore.getState().setCaptureNotice(cancelledRef.current);
        }
        throw error;
      }
      assertOutputAllowed(stoppingSessionId);
      resetAudioLevel();
      const queue = desktopPhraseQueueRef.current;
      if (!queue) {
        // Unverified capture is retained for an explicit local recovery only.
        if (audioBufferRef.current.sampleCount) {
          retainRecovery("Complete audio capture could not be confirmed. Retry transcription to review the audio received.");
        } else {
          finalizeIdleState();
        }
        return;
      }
      const started = performance.now();
      enqueueDesktopPhrase(audioBufferRef.current.sampleCount);
      await queue.finish();
      assertOutputAllowed(stoppingSessionId);
      await browserDeliveryRef.current?.finish();
      assertOutputAllowed(stoppingSessionId);
      browserDeliveryRef.current = null;
      traceDictationEvent("dictation_desktop_stream_flush_completed", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
      if (stopRequestedAtMsRef.current !== null) traceDictationEvent("dictation_stop_to_final_transcript", { durationMs: Math.round(performance.now() - stopRequestedAtMsRef.current) }).catch(() => {});
      desktopPhraseQueueRef.current = null;
      if (manualCopyRequestedRef.current && useStore.getState().dictationPurpose !== "onboarding" && useStore.getState().transcript.trim()) {
        retainManualTranscript();
      }
      finalizeIdleState();
    } catch (error) {
      if (!isCurrentSession(stoppingSessionId)) return;
      desktopPhraseQueueRef.current?.cancel();
      void browserDeliveryRef.current?.cancel();
      resetAudioLevel();
      traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
      retainRecovery(cancelledRef.current ?? (useStore.getState().dictationPurpose === "onboarding"
        ? `Voice test stopped: ${errorMessage(error)}. You can try the test again.`
        : errorMessage(error)));
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
    void browserDeliveryRef.current?.cancel();
    setCancellationPending(true);
    setCanCancel(false);
    sessionRef.current = disableLivePreview(sessionRef.current);
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
    void browserDeliveryRef.current?.cancel();
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
    workletFlushRef.current?.cancel();
    workletFlushRef.current = null;
    disconnectAudioGraph();
    const native = nativeCaptureRef.current;
    nativeCaptureRef.current = null;
    void native?.cancel().catch(() => {});
    primedStreamRef.current?.getTracks().forEach((track) => track.stop());
    primedStreamRef.current = null;
    primedStreamPromiseRef.current = null;
    void browserDeliveryRef.current?.cancel();
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    clearCapturedAudio();
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
