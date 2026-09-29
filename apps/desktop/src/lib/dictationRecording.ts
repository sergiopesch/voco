import { CrashJournal, CrashJournalCleanupError } from "@/lib/crashRecovery";
import {
  collectAudioSamplesRange,
  type AudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { AudioCaptureFlushError } from "@/lib/audioCaptureFlush";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import { BenchmarkPhraseQueue } from "@/lib/benchmarkPhraseQueue";
import {
  createCaptureDescriptor,
  type CaptureDescriptor,
  type CaptureSelection,
} from "@/lib/captureDescriptor";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import type { CursorDeliveryEvent } from "@/lib/dictationDelivery";
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
import { beginNativeCapture,type NativeCaptureSession } from "@/lib/nativeCapture";
import type { HotkeyTraceFields,pasteDesktopText } from "@/lib/tauri";
import type { useStore as appStore } from "@/store/useStore";
import type { AppConfig,DesktopPasteStatus,DictationStatus } from "@/types";
import { BrowserStreamDelivery } from "./browserStreamDelivery";

export type Ref<T> = { current: T };

/** Unverified capture is never typed; Stop explains that with this sentence. */
const UNVERIFIED_CAPTURE_REASON = "VOCO couldn't confirm it received all of your audio, so it didn't type this recording. Try again.";

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
 * Owns Start, Stop and Cancel, including delivery hand-off and fail-closed
 * recovery. Created once per mount; env is refs plus functions
 * that read .current.
 */
export interface DictationRecordingEnv {
  phaseRef: Ref<DictationRecordingPhase | string>;
  sessionRef: Ref<DictationSessionState>;
  disposedRef: Ref<boolean>;
  cancelledRef: Ref<string | null>;
  browserDeliveryRef: Ref<BrowserStreamDelivery | null>;
  desktopPhraseQueueRef: Ref<{
    cancel(): void;
    finish(): Promise<{ undelivered: string; uncertain?: boolean }>;
    pushAudio?(samples: Float32Array, sampleRate: number): void;
    enqueue?(): void;
  } | null>;
  desktopPasteSessionRef: Ref<boolean>;
  desktopStreamedSampleCountRef: Ref<number>;
  desktopPhrasePasteCountRef: Ref<number>;
  activeTriggerIdRef: Ref<string | undefined>;
  recoverySessionIdRef: Ref<string | null>;
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
  transitionCursorDelivery: (event: CursorDeliveryEvent) => void;
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
    phaseRef,
    sessionRef,
    disposedRef,
    cancelledRef,
    browserDeliveryRef,
    desktopPhraseQueueRef,
    desktopPasteSessionRef,
    desktopStreamedSampleCountRef,
    desktopPhrasePasteCountRef,
    activeTriggerIdRef,
    recoverySessionIdRef,
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
    transitionCursorDelivery,
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
    if (!triggerId?.startsWith("browser:")) return;
    if (activeTriggerIdRef.current === triggerId) activeTriggerIdRef.current = undefined;
    void releaseBrowserRecording(triggerId).catch(() => {});
  }

  function retainRecovery(reason: string) {
    if (disposedRef.current) return;
    void browserDeliveryRef.current?.cancel();
    releaseRecordingOrigin();
    const current = useStore.getState();
    if (current.dictationPurpose !== "onboarding") {
      // A live notification already covered this session; the error slot keeps the reason.
      const alreadyNotified = interruptionNotifiedSession === sessionRef.current.sessionId;
      interruptionNotifiedSession = null;
      const native = nativeCaptureRef.current;
      nativeCaptureRef.current = null;
      void native?.cancel().catch(() => {});
      desktopPhraseQueueRef.current = null;
      clearCapturedAudio();
      clearTranscript();
      current.setRecovery(null);
      current.setCaptureNotice(null);
      current.setSurface("hidden");
      phaseRef.current = "idle";
      sessionRef.current = finishSessionIdle(sessionRef.current);
      setCanCancel(false);
      setCancellationPending(false);
      setStatus("idle");
      setError(reason);
      transitionCursorDelivery("session-idle");
      traceDictationEvent("dictation_interrupted").catch(() => {});
      const body = reason === new CrashJournalCleanupError().message ? reason
        : alreadyNotified ? null
        : reason === UNVERIFIED_CAPTURE_REASON ? reason
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
    phaseRef.current = "error";
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
    const stopRequestedAtMs = stopRequestedAtMsRef.current;
    if (stopRequestedAtMs !== null) {
      traceDictationEvent("dictation_stop_to_idle", {
        durationMs: Math.round(performance.now() - stopRequestedAtMs),
      }).catch(() => {});
      stopRequestedAtMsRef.current = null;
    }

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

    useStore.getState().setRecovery(null);
    const onboardingTest = triggerId === "onboarding:test";
    // A notice from an earlier attempt must not outlive the next start.
    if (!onboardingTest) useStore.getState().setCaptureNotice(null);
    useStore.getState().setDictationPurpose(onboardingTest ? "onboarding" : "cursor");
    if (onboardingTest) useStore.getState().setOnboardingTestPassed(false);
    activeTriggerIdRef.current = triggerId;
    desktopPasteSessionRef.current = false;
    desktopPhraseQueueRef.current?.cancel();
    desktopPhraseQueueRef.current = null;
    void browserDeliveryRef.current?.cancel();
    browserDeliveryRef.current = null;
    desktopStreamedSampleCountRef.current = 0;
    desktopPhrasePasteCountRef.current = 0;
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
      // A previous checkpoint that could not be deleted is retried here but
      // never blocks a new dictation.
      await finishJournal().catch(() => { journal = null; });
      assertOutputAllowed(startingSessionId);
      if (!onboardingTest && !triggerId?.startsWith("browser:") && sessionConfigRef.current?.transcriptTarget === "cursor") {
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
        // Retain the fixed compatibility snapshot; the queue owns streaming.
        sessionConfigRef.current = { ...sessionConfigRef.current, liveCursorMode: "final-text-only" };
        traceDictationEvent("dictation_desktop_paste_session_started").catch(() => {});
      }
      if (!onboardingTest && !triggerId?.startsWith("browser:") && !desktopPasteSessionRef.current) {
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
        transitionCursorDelivery("ownership-established");
      }
      if (!onboardingTest) {
        const owned = new CrashJournal(recoverySessionIdRef.current!);
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
        recordingStartedAtMsRef.current = performance.now();
      }

      sessionRef.current = markRecording(sessionRef.current);
      phaseRef.current = "recording";
      if (captureAdmission === "automatic") {
        const rate = recordingSampleRate();
        let firstPhraseDispatched = false;
        desktopPhraseQueueRef.current = new BenchmarkPhraseQueue(async (text, correlation) => {
          assertOutputAllowed(startingSessionId);
          // Onboarding exercises recognition without owning or mutating another app.
          if (onboardingTest) return;
          const browser = browserDeliveryRef.current;
          if (browser) {
            desktopPhrasePasteCountRef.current++;
            await browser.append(text);
            return;
          }
          const started = performance.now();
          desktopPhrasePasteCountRef.current++;
          traceDictationEvent("dictation_desktop_paste_requested").catch(() => {});
          const result = await pasteDesktopText(text, correlation);
          if (result.outcome !== "dispatched") throw new Error("Desktop phrase paste was not dispatched.");
          // The old queue still records its actual native outcome, but a late
          // completion must not update a replacement session's UI or timings.
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDesktopPasteMetrics(result);
          traceDictationEvent("dictation_desktop_paste_dispatched", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
          if (!firstPhraseDispatched && recordingStartedAtMsRef.current !== null) {
            firstPhraseDispatched = true;
            traceDictationEvent("dictation_desktop_first_phrase_dispatched", { durationMs: Math.round(performance.now() - recordingStartedAtMsRef.current) }).catch(() => {});
          }
        }, (text) => {
          if (!isCurrentSession(startingSessionId)) return;
          setTranscript(text);
          journal?.update(text);
        }, (error, kind) => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          if (onboardingTest) setError(`Voice test paused: ${sentence(error.message)} Finish test, then try again.`);
          else if (phaseRef.current === "recording") {
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
        desktopPhraseQueueRef.current?.pushAudio?.(prefix, rate);
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
        retainRecovery(errorMessage(cleanupFailure));
        return;
      }
      // Teardown can flush a WebKit prefix even when cancellation or failure
      // happened before Listening. Retention belongs to the received samples,
      // not the backend or interruption reason.
      if (audioBufferRef.current.sampleCount > 0) {
        retainRecovery(cancelledRef.current ?? `Microphone startup failed: ${errorMessage(err)}`);
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
          cancelledRef.current ??= desktopPhraseQueueRef.current ? error.message : UNVERIFIED_CAPTURE_REASON;
          desktopPhraseQueueRef.current?.cancel();
          useStore.getState().setCaptureNotice(cancelledRef.current);
        }
        throw error;
      }
      assertOutputAllowed(stoppingSessionId);
      resetAudioLevel();
      const queue = desktopPhraseQueueRef.current;
      if (!queue) {
        await finishJournal();
        // Unverified capture is never typed.
        if (audioBufferRef.current.sampleCount) {
          retainRecovery(UNVERIFIED_CAPTURE_REASON);
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
      if (stopRequestedAtMsRef.current !== null) traceDictationEvent("dictation_stop_to_final_transcript", { durationMs: Math.round(performance.now() - stopRequestedAtMsRef.current) }).catch(() => {});
      desktopPhraseQueueRef.current = null;
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
          void showNotification("Dictation saved in Review", "VOCO couldn't paste or copy it. Choose Review in the VOCO tray menu to copy it.").catch(() => {});
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
      desktopPhraseQueueRef.current?.cancel();
      void browserDeliveryRef.current?.cancel();
      resetAudioLevel();
      let cleanupFailure: unknown = null;
      await finishJournal().catch(failure => { cleanupFailure = failure; });
      traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
      retainRecovery(cleanupFailure ? errorMessage(cleanupFailure) : cancelledRef.current ?? (useStore.getState().dictationPurpose === "onboarding"
        ? `Voice test stopped: ${sentence(errorMessage(error))} You can try the test again.`
        : sentence(errorMessage(error))));
    }
  }

  async function cancelRecording(reason = "Recording cancelled.") {
    if (phaseRef.current === "idle" || phaseRef.current === "error" || phaseRef.current === "finalizing" || cancelledRef.current) return;
    cancelledRef.current = reason;
    desktopPhraseQueueRef.current?.cancel();
    void browserDeliveryRef.current?.cancel();
    setCancellationPending(true);
    setCanCancel(false);
    captureHealthRef.current?.dispose();
    captureHealthRef.current = null;
    if (phaseRef.current === "recording") {
      await stopRecording();
    }
  }


  function dispose() {
    disposedRef.current = true;
    desktopPhraseQueueRef.current?.cancel();
    void browserDeliveryRef.current?.cancel();
    releaseRecordingOrigin();
    lifecycleEpochRef.current += 1;
    phaseRef.current = "idle";
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
    void browserDeliveryRef.current?.cancel();
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
