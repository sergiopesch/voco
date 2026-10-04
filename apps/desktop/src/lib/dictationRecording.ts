import { CrashJournal, CrashJournalCleanupError } from "@/lib/crashRecovery";
import {
  collectAudioSamplesRange,
  type AudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { AudioCaptureFlushError } from "@/lib/audioCaptureFlush";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import { DictationStream } from "@/lib/dictationStream";
import {
  createCaptureDescriptor,
  type CaptureDescriptor,
  type CaptureSelection,
} from "@/lib/captureDescriptor";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import { errorMessage,sentence } from "@/lib/dictationRecovery";
import {
  consumeQueuedStop,
  failSession,
  finishSessionIdle,
  markRecording,
  requestStop as requestSessionStop,
  startSession,
  type DictationSessionState,
} from "@/lib/dictationSession";
import { isBrowserTrigger } from "@/lib/dictationTrigger";
import { beginNativeCapture,type NativeCaptureSession } from "@/lib/nativeCapture";
import type { HotkeyTraceFields,pasteDesktopText } from "@/lib/tauri";
import type { useStore as appStore } from "@/store/useStore";
import type { CursorDeliveryState,DesktopPasteStatus,DictationStatus } from "@/types";
import { BrowserStreamDelivery } from "./browserStreamDelivery";
import type { Ref } from "./desktopCaptureTail";

/** Unverified capture is never typed; Stop explains that with this sentence. */
const UNVERIFIED_CAPTURE_REASON = "VOCO couldn't confirm it received all of your audio, so it didn't type this recording. Try again.";

type CaptureAdmission = "pending" | "automatic" | "manual-review";

/**
 * Owns Start, Stop and Cancel, including delivery hand-off and fail-closed
 * recovery. Created once per mount; env is refs plus functions
 * that read .current.
 */
export interface DictationRecordingEnv {
  sessionRef: Ref<DictationSessionState>;
  disposedRef: Ref<boolean>;
  cancelledRef: Ref<string | null>;
  browserDeliveryRef: Ref<BrowserStreamDelivery | null>;
  dictationStreamRef: Ref<{
    cancel(): void;
    finish(): Promise<{ undelivered: string; uncertain?: boolean }>;
    pushAudio?(samples: Float32Array, sampleRate: number): void;
    enqueue?(): void;
  } | null>;
  desktopPasteSessionRef: Ref<boolean>;
  desktopStreamedSampleCountRef: Ref<number>;
  activeTriggerIdRef: Ref<string | undefined>;
  nativeCaptureRef: Ref<NativeCaptureSession | null>;
  captureDescriptorRef: Ref<CaptureDescriptor | null>;
  captureSelectionRef: Ref<(() => CaptureSelection) | undefined>;
  firstHotkeyPressMsRef: Ref<number | null>;
  debugNativeCaptureEnabledRef: Ref<boolean>;
  audioBufferRef: Ref<AudioCaptureBuffer>;
  lifecycleEpochRef: Ref<number>;
  audioContextRef: Ref<AudioContext | null>;
  primedStreamRef: Ref<MediaStream | null>;
  primedStreamPromiseRef: Ref<Promise<MediaStream> | null>;
  captureHealthRef: Ref<{ dispose(): void } | null>;
  workletFlushRef: Ref<{ cancel(): void } | null>;
  streamRef: Ref<MediaStream | null>;
  sourceRef: Ref<MediaStreamAudioSourceNode | null>;
  primedDeviceIdRef: Ref<string | null>;
  // Store and native helpers are injected so tests can substitute them.
  useStore: Pick<typeof appStore, "getState">;
  getDesktopPasteStatus: () => Promise<DesktopPasteStatus>;
  pasteDesktopText: typeof pasteDesktopText;
  copyDesktopText: (text: string) => Promise<void>;
  traceDictationEvent: (event: string, fields?: HotkeyTraceFields | null) => Promise<void>;
  showNotification: (title: string, body: string) => Promise<void>;
  setCancellationPending: (value: boolean) => void;
  setCanCancel: (value: boolean) => void;
  setStatus: (status: DictationStatus) => void;
  setTranscript: (text: string) => void;
  setError: (error: string | null) => void;
  setMicrophoneReadyState: (ready: boolean) => void;
  clearTranscript: () => void;
  resetAudioLevel: () => void;
  updateAudioLevel: (level: number) => void;
  clearCapturedAudio: () => void;
  setCursorDelivery: (state: CursorDeliveryState) => void;
  recordingSampleRate: () => number;
  appendRecordingSamples: (samples: Float32Array) => number;
  enqueueDesktopPhrase: (end: number) => void;
  teardownAudioGraph: () => Promise<number>;
  disconnectAudioGraph: () => void;
  ensureAudioContext: () => Promise<AudioContext>;
  openTracedMicrophoneStream: (deviceId: string | null) => Promise<MediaStream>;
  connectWorklet: (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => Promise<boolean>;
  connectScriptProcessor: (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => void;
  traceDesktopPasteMetrics: (result: Awaited<ReturnType<typeof pasteDesktopText>>) => void;
  debugNativeCaptureEnabled: () => Promise<boolean>;
  beginNativeCapture: typeof beginNativeCapture;
  releaseBrowserRecording: (triggerId: string) => Promise<void>;
}

export function createDictationRecording(env: DictationRecordingEnv) {
  const {
    sessionRef,
    disposedRef,
    cancelledRef,
    browserDeliveryRef,
    dictationStreamRef,
    desktopPasteSessionRef,
    desktopStreamedSampleCountRef,
    activeTriggerIdRef,
    nativeCaptureRef,
    captureDescriptorRef,
    captureSelectionRef,
    firstHotkeyPressMsRef,
    debugNativeCaptureEnabledRef,
    audioBufferRef,
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
    getDesktopPasteStatus,
    pasteDesktopText,
    copyDesktopText,
    traceDictationEvent,
    showNotification,
    setCancellationPending,
    setCanCancel,
    setStatus,
    setTranscript,
    setError,
    setMicrophoneReadyState,
    clearTranscript,
    resetAudioLevel,
    updateAudioLevel,
    clearCapturedAudio,
    setCursorDelivery,
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

  // One controller lives for the whole launch, so these limit repeat notifications.
  let crashRecoveryUnavailableNotified = false;
  let interruptionNotifiedSession: number | null = null;
  let journal: CrashJournal | null = null;
  let journalCleanup: Promise<void> = Promise.resolve();
  // Start, Stop and the stream callbacks share these across recordings.
  let captureGeneration = 0;
  let recordingStartedAtMs: number | null = null;
  let stopRequestedAtMs: number | null = null;
  let initialHotkeyLatencyLogged = false;
  async function finishJournal() {
    const owned = journal;
    if (owned) journalCleanup = owned.finish().finally(() => {
      if (owned.cleanupComplete && journal === owned) journal = null;
      journalCleanup = Promise.resolve();
    });
    await journalCleanup;
  }
  async function keepJournal() {
    const owned = journal;
    if (!owned || !(await owned.keep())) return false;
    if (journal === owned) journal = null;
    return true;
  }

  function isCurrentSession(sessionId: number): boolean {
    return !disposedRef.current && sessionRef.current.sessionId === sessionId;
  }

  function assertOutputAllowed(sessionId = sessionRef.current.sessionId) {
    if (!isCurrentSession(sessionId)) {
      throw new Error("Recording session is no longer active.");
    }
    if (cancelledRef.current) throw new Error(cancelledRef.current);
  }

  function releaseRecordingOrigin(triggerId = activeTriggerIdRef.current) {
    if (!isBrowserTrigger(triggerId)) return;
    if (activeTriggerIdRef.current === triggerId) activeTriggerIdRef.current = undefined;
    void releaseBrowserRecording(triggerId).catch(() => {});
  }

  function interruptRecording(reason: string) {
    if (disposedRef.current) return;
    void browserDeliveryRef.current?.cancel();
    releaseRecordingOrigin();
    const current = useStore.getState();
    if (current.dictationPurpose !== "onboarding") {
      // A live notification already covered the Stop it asked for. The error
      // slot keeps the reason.
      const alreadyNotified = interruptionNotifiedSession === sessionRef.current.sessionId;
      interruptionNotifiedSession = null;
      // Typed text is part of the transcript: without one nothing is missing.
      const typedNothing = !current.transcript;
      const native = nativeCaptureRef.current;
      nativeCaptureRef.current = null;
      void native?.cancel().catch(() => {});
      dictationStreamRef.current = null;
      clearCapturedAudio();
      clearTranscript();
      current.setRecovery(null);
      current.setCaptureNotice(null);
      current.setSurface("hidden");
      sessionRef.current = finishSessionIdle(sessionRef.current);
      setCanCancel(false);
      setCancellationPending(false);
      setStatus("idle");
      setError(reason);
      setCursorDelivery("inactive");
      traceDictationEvent("dictation_interrupted").catch(() => {});
      const body = reason === new CrashJournalCleanupError().message ? reason
        : alreadyNotified ? null
        : reason === UNVERIFIED_CAPTURE_REASON ? reason
        : typedNothing ? `Nothing was typed. ${sentence(reason)}`
        : "Some words may be missing. Check your text field before starting again.";
      if (body) void showNotification("Dictation interrupted", body).catch(() => {});
      return;
    }
    traceDictationEvent("dictation_recovery_retained", {
      trackSampleRate: recordingSampleRate(),
      durationMs: Math.round(audioBufferRef.current.sampleCount / (recordingSampleRate()) * 1000),
    }).catch(() => {});
    // Nothing retries a failed voice test's audio; Test again records anew.
    clearCapturedAudio();
    useStore.getState().setRecovery({ reason });
    sessionRef.current = failSession(sessionRef.current);
    setCanCancel(false);
    setCancellationPending(false);
    setStatus("error");
    setError(reason);
    useStore.getState().setSurface("onboarding");
  }

  function finalizeIdleState() {
    if (disposedRef.current) return;
    void browserDeliveryRef.current?.cancel();
    const completed = useStore.getState();
    if (completed.dictationPurpose === "onboarding") {
      completed.setOnboardingTestPassed(!completed.recovery && Boolean(completed.transcript.trim()) && completed.transcript !== "(no speech detected)");
    } else {
      clearTranscript();
    }
    releaseRecordingOrigin();
    setCanCancel(false);
    setCancellationPending(false);
    nativeCaptureRef.current = null;
    clearCapturedAudio();
    if (stopRequestedAtMs !== null) {
      traceDictationEvent("dictation_stop_to_idle", {
        durationMs: Math.round(performance.now() - stopRequestedAtMs),
      }).catch(() => {});
      stopRequestedAtMs = null;
    }

    sessionRef.current = finishSessionIdle(sessionRef.current);
    activeTriggerIdRef.current = undefined;
    setStatus("idle");
    setCursorDelivery("inactive");
  }

  async function startRecording(triggerId?: string) {
    const phase = sessionRef.current.phase;
    if (phase !== "idle" && phase !== "error") {
      return;
    }

    useStore.getState().setRecovery(null);
    const onboardingTest = triggerId === "onboarding:test";
    // A notice from an earlier attempt must not outlive the next start.
    if (!onboardingTest) useStore.getState().setCaptureNotice(null);
    useStore.getState().setDictationPurpose(onboardingTest ? "onboarding" : "cursor");
    if (onboardingTest) useStore.getState().setOnboardingTestPassed(false);
    activeTriggerIdRef.current = triggerId;
    desktopPasteSessionRef.current = false;
    dictationStreamRef.current?.cancel();
    dictationStreamRef.current = null;
    void browserDeliveryRef.current?.cancel();
    browserDeliveryRef.current = null;
    desktopStreamedSampleCountRef.current = 0;
    cancelledRef.current = null;
    setCancellationPending(false);
    setCanCancel(true);
    sessionRef.current = startSession(sessionRef.current);
    const startingSessionId = sessionRef.current.sessionId;
    traceDictationEvent("recording_state_requested").catch(() => {});
    let nativeAttempt: { generation: number; selectionToken: string } | null = null;
    let webkitCaptureAttempted = false;
    let destinationSetupFailure = false;
    const invalidateNativeSelection = () => {
      if (!nativeAttempt || !isCurrentSession(startingSessionId) ||
          captureGeneration !== nativeAttempt.generation) return;
      const state = useStore.getState();
      if (state.captureBackendMode === "native" &&
          state.nativeCaptureSource?.selectionToken === nativeAttempt.selectionToken) {
        state.loseNativeCaptureSource?.();
      }
    };

    let startFailureTitle = "Dictation could not start";
    try {
      // A previous checkpoint that could not be deleted is retried here but
      // never blocks a new dictation.
      await finishJournal().catch(() => { journal = null; });
      assertOutputAllowed(startingSessionId);
      if (!onboardingTest && !isBrowserTrigger(triggerId) && useStore.getState().config) {
        const paste = await getDesktopPasteStatus();
        assertOutputAllowed(startingSessionId);
        // The only desktop prerequisites; each paste goes to whatever has focus.
        if (!paste.enabled) {
          destinationSetupFailure = true;
          throw new Error("Desktop dictation is unavailable. Complete desktop input setup before recording.");
        }
        if (!paste.available) {
          startFailureTitle = "Dictation setup incomplete";
          destinationSetupFailure = true;
          traceDictationEvent("dictation_desktop_paste_unavailable").catch(() => {});
          throw new Error(paste.detail);
        }
        if (!paste.streamingEnabled) {
          destinationSetupFailure = true;
          throw new Error("Streaming dictation is disabled in the desktop environment.");
        }
        desktopPasteSessionRef.current = true;
        traceDictationEvent("dictation_desktop_paste_session_started").catch(() => {});
      }
      if (!onboardingTest && !isBrowserTrigger(triggerId) && !desktopPasteSessionRef.current) {
        destinationSetupFailure = true;
        throw new Error("Desktop dictation is unavailable. Complete desktop input setup before recording.");
      }
      clearTranscript();
      setStatus("starting");
      startFailureTitle = "Microphone could not start";
      const captureSelection = captureSelectionRef.current?.() ?? { backend: "webkit" as const };
      let captureAdmission: CaptureAdmission = "pending";
      if (captureSelection.backend === "native" && !captureSelection.selectionToken) {
        throw new Error("Choose a microphone in Microphone settings.");
      }
      resetAudioLevel();
      clearCapturedAudio();
      recordingStartedAtMs = null;
      stopRequestedAtMs = null;
      setCursorDelivery("inactive");
      captureGeneration += 1;
      const generation = captureGeneration;
      let audioContext: AudioContext | null = null;
      debugNativeCaptureEnabledRef.current = false;
      // Field admission must not start capture or revoke an approved microphone.
      if (isBrowserTrigger(triggerId)) {
        const delivery = new BrowserStreamDelivery(() => isCurrentSession(startingSessionId) && !cancelledRef.current);
        browserDeliveryRef.current = delivery;
        await delivery.start(startingSessionId, triggerId);
        assertOutputAllowed(startingSessionId);
        setCursorDelivery("owned");
      }
      if (!onboardingTest) {
        const owned = new CrashJournal(crypto.randomUUID());
        journal = owned;
        const opened = await owned.begin().then(() => true, () => false);
        assertOutputAllowed(startingSessionId);
        if (!opened) {
          // Crash protection is optional: dictate without a checkpoint.
          journal = null;
          if (!crashRecoveryUnavailableNotified) {
            crashRecoveryUnavailableNotified = true;
            void showNotification("Crash recovery unavailable", "Dictation continues, but VOCO can't recover it if VOCO exits unexpectedly.").catch(() => {});
          }
        }
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
            if (isCurrentSession(startingSessionId) && captureGeneration === generation) {
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
        recordingStartedAtMs = performance.now();
        if (
          firstHotkeyPressMsRef.current !== null &&
          !initialHotkeyLatencyLogged
        ) {
          initialHotkeyLatencyLogged = true;
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

        // The legacy fallback cannot prove a complete recording, so it is never typed.
        const workletOk = await connectWorklet(audioContext!, source);
        assertOutputAllowed(startingSessionId);
        captureAdmission = workletOk ? "automatic" : "manual-review";
        if (!workletOk) {
          // The popover cannot open during dictation, so notify instead.
          if (!onboardingTest) {
            interruptionNotifiedSession = startingSessionId;
            void showNotification("Dictation won't be typed", "VOCO can't confirm it is receiving all of your audio, so it won't type this recording. Stop and try again.").catch(() => {});
          }
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
        recordingStartedAtMs = performance.now();
      }

      sessionRef.current = markRecording(sessionRef.current);
      if (captureAdmission === "automatic") {
        const rate = recordingSampleRate();
        let firstPhraseDispatched = false;
        dictationStreamRef.current = new DictationStream(async (text, correlation) => {
          assertOutputAllowed(startingSessionId);
          // Onboarding exercises recognition without owning or mutating another app.
          if (onboardingTest) return;
          const browser = browserDeliveryRef.current;
          if (browser) {
            await browser.append(text);
            return;
          }
          const started = performance.now();
          traceDictationEvent("dictation_desktop_paste_requested").catch(() => {});
          const result = await pasteDesktopText(text, correlation);
          if (result.outcome !== "dispatched") throw new Error("Desktop phrase paste was not dispatched.");
          // The old queue still records its actual native outcome, but a late
          // completion must not update a replacement session's UI or timings.
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDesktopPasteMetrics(result);
          traceDictationEvent("dictation_desktop_paste_dispatched", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
          if (!firstPhraseDispatched && recordingStartedAtMs !== null) {
            firstPhraseDispatched = true;
            traceDictationEvent("dictation_desktop_first_phrase_dispatched", { durationMs: Math.round(performance.now() - recordingStartedAtMs) }).catch(() => {});
          }
        }, (text) => {
          if (!isCurrentSession(startingSessionId)) return;
          setTranscript(text);
          journal?.update(text);
        }, (error, kind) => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          if (onboardingTest) setError(`Voice test paused: ${sentence(error.message)} Finish test, then try again.`);
          else if (sessionRef.current.phase === "recording") {
            // A delivery failure stops typing; healthy recognition runs through Stop.
            if (kind === "recognition") interruptionNotifiedSession = startingSessionId;
            void (kind === "delivery"
              ? showNotification("VOCO stopped typing", "It's still listening. When you stop, VOCO copies the rest of your words to the clipboard.")
              : showNotification("Dictation interrupted", "Some words may be missing. Stop dictation and check your text field.")).catch(() => {});
          }
        }, (event, durationMs) => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current || onboardingTest) return;
          const name = event === "appended" ? "dictation_desktop_live_prefix_dispatched"
            : event === "deferred" ? "dictation_desktop_paste_deferred"
            : `dictation_desktop_snapshot_${event}`;
          traceDictationEvent(name, durationMs === undefined ? null : { durationMs }).catch(() => {});
        }, startingSessionId, !onboardingTest);
        // Audio can arrive while the worklet is starting. Keep planner offsets
        // aligned with the complete retained source, including that prefix.
        const prefix = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
        dictationStreamRef.current?.pushAudio?.(prefix, rate);
        desktopStreamedSampleCountRef.current = prefix.length;
        traceDictationEvent("dictation_desktop_stream_started").catch(() => {});
      }
      nativeCaptureRef.current?.startDelivery();
      setStatus("recording");
      traceDictationEvent("recording_state_active").catch(() => {});

      const queuedStop = consumeQueuedStop(sessionRef.current);
      sessionRef.current = queuedStop.state;
      if (queuedStop.shouldStop) {
        void stopRecording();
      }
    } catch (err) {
      if (!isCurrentSession(startingSessionId)) return;
      if (!cancelledRef.current) invalidateNativeSelection();
      await teardownAudioGraph().catch(() => {});
      void browserDeliveryRef.current?.cancel();
      if (!isCurrentSession(startingSessionId)) return;
      releaseRecordingOrigin(triggerId);
      setCanCancel(false);
      setCancellationPending(false);
      // Invalidate a failed WebKit capture before retained audio takes the
      // recovery path. Cancellation and pre-capture destination rejection do
      // not revoke readiness; native selection invalidation is guarded above.
      if (webkitCaptureAttempted && !cancelledRef.current) setMicrophoneReadyState(false);
      resetAudioLevel();
      let cleanupFailure: unknown = null;
      await finishJournal().catch(failure => { cleanupFailure = failure; });
      if (cleanupFailure) {
        interruptRecording(errorMessage(cleanupFailure));
        return;
      }
      // Teardown can flush a WebKit prefix even when cancellation or failure
      // happened before Listening. Retention belongs to the received samples,
      // not the backend or interruption reason.
      if (audioBufferRef.current.sampleCount > 0) {
        interruptRecording(cancelledRef.current ?? `Microphone startup failed: ${errorMessage(err)}`);
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
      setStatus("error");
      sessionRef.current = failSession(sessionRef.current);
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
    if (sessionRef.current.phase !== "recording") return;
    const stoppingSessionId = sessionRef.current.sessionId;
    sessionRef.current = requestSessionStop(sessionRef.current);
    traceDictationEvent("dictation_recording_stopped").catch(() => {});
    stopRequestedAtMs = performance.now();
    if (recordingStartedAtMs !== null) {
      traceDictationEvent("dictation_recording_duration", {
        durationMs: Math.round(stopRequestedAtMs - recordingStartedAtMs),
      }).catch(() => {});
    }
    setStatus("processing");
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
          // Without a stream queue the capture was never verified, so nothing was typed.
          cancelledRef.current ??= dictationStreamRef.current ? error.message : UNVERIFIED_CAPTURE_REASON;
          dictationStreamRef.current?.cancel();
          useStore.getState().setCaptureNotice(cancelledRef.current);
        }
        throw error;
      }
      assertOutputAllowed(stoppingSessionId);
      resetAudioLevel();
      const queue = dictationStreamRef.current;
      if (!queue) {
        await finishJournal();
        // Unverified capture is never typed.
        if (audioBufferRef.current.sampleCount) {
          interruptRecording(UNVERIFIED_CAPTURE_REASON);
        } else {
          finalizeIdleState();
        }
        return;
      }
      const started = performance.now();
      enqueueDesktopPhrase(audioBufferRef.current.sampleCount);
      const { undelivered, uncertain } = await queue.finish();
      assertOutputAllowed(stoppingSessionId);
      const browser = browserDeliveryRef.current;
      browserDeliveryRef.current = null;
      // A browser field that stopped taking text is handled like a failed
      // paste: its lease is released and the rest is copied below.
      if (undelivered) void browser?.cancel();
      else await browser?.finish();
      assertOutputAllowed(stoppingSessionId);
      traceDictationEvent("dictation_desktop_stream_flush_completed", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
      if (stopRequestedAtMs !== null) traceDictationEvent("dictation_stop_to_final_transcript", { durationMs: Math.round(performance.now() - stopRequestedAtMs) }).catch(() => {});
      dictationStreamRef.current = null;
      if (undelivered.trim() && (desktopPasteSessionRef.current || browser)) {
        // Text the app did not take (or may not have taken) is never replayed;
        // the clipboard lets the user paste it themselves, and Review keeps
        // the dictation when even the copy fails. The copy keeps its joining
        // space, so pasting it after the words that arrived keeps them apart.
        const copied = await copyDesktopText(undelivered).then(() => true, () => false);
        assertOutputAllowed(stoppingSessionId);
        if (!copied) {
          if (!(await keepJournal())) throw new Error("VOCO couldn't paste, copy or save this dictation.");
          assertOutputAllowed(stoppingSessionId);
          traceDictationEvent("dictation_desktop_remainder_kept").catch(() => {});
          useStore.getState().setCaptureNotice(null);
          void showNotification("Dictation saved in Review", "VOCO couldn't paste or copy it. Choose Review in VOCO's menu to copy it.").catch(() => {});
          finalizeIdleState();
          return;
        }
        traceDictationEvent("dictation_desktop_remainder_copied").catch(() => {});
        useStore.getState().setCaptureNotice(null);
        void showNotification("Dictation copied to clipboard", uncertain
          ? "Some words may already be in the app, so check it first. Then press Shift+Insert or Ctrl+V to paste the rest."
          : "VOCO couldn't paste into the focused app. Press Shift+Insert or Ctrl+V to paste it.").catch(() => {});
      }
      // The dictation completed, so a missed checkpoint no longer matters;
      // checkpoint text that could not be deleted still takes the recovery path.
      await finishJournal().catch(failure => { if (failure instanceof CrashJournalCleanupError) throw failure; });
      finalizeIdleState();
    } catch (error) {
      if (!isCurrentSession(stoppingSessionId)) return;
      dictationStreamRef.current?.cancel();
      void browserDeliveryRef.current?.cancel();
      resetAudioLevel();
      let cleanupFailure: unknown = null;
      await finishJournal().catch(failure => { cleanupFailure = failure; });
      traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
      interruptRecording(cleanupFailure ? errorMessage(cleanupFailure) : cancelledRef.current ?? (useStore.getState().dictationPurpose === "onboarding"
        ? `Voice test stopped: ${sentence(errorMessage(error))} You can try the test again.`
        : sentence(errorMessage(error))));
    }
  }

  async function cancelRecording(reason = "Recording cancelled.") {
    const { phase } = sessionRef.current;
    if (phase === "idle" || phase === "error" || cancelledRef.current) return;
    cancelledRef.current = reason;
    // The session now ends without the Stop a live notice asked for, so the
    // interruption still notifies.
    if (interruptionNotifiedSession === sessionRef.current.sessionId) interruptionNotifiedSession = null;
    dictationStreamRef.current?.cancel();
    void browserDeliveryRef.current?.cancel();
    setCancellationPending(true);
    setCanCancel(false);
    captureHealthRef.current?.dispose();
    captureHealthRef.current = null;
    if (sessionRef.current.phase === "recording") {
      await stopRecording();
    }
  }


  function dispose() {
    disposedRef.current = true;
    dictationStreamRef.current?.cancel();
    void browserDeliveryRef.current?.cancel();
    releaseRecordingOrigin();
    lifecycleEpochRef.current += 1;
    sessionRef.current = {
      ...finishSessionIdle(sessionRef.current),
      sessionId: sessionRef.current.sessionId + 1,
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
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    clearCapturedAudio();
    void finishJournal().catch(() => {});
    const state = useStore.getState();
    if (state.dictationPurpose !== "onboarding") {
      clearTranscript();
      state.setRecovery(null);
      state.setCaptureNotice(null);
      setStatus("idle");
      setError(null);
    }
  }

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    finalizeIdleState,
    isCurrentSession,
    releaseRecordingOrigin,
    dispose,
  };
}
