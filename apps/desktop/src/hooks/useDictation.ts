import {BenchmarkPhraseQueue} from '../lib/benchmarkPhraseQueue';
import { NvidiaRecovery } from "@/lib/nvidiaRecovery";
import { DesktopShortcutSession } from "@/lib/desktopShortcutSession";
import { retainedSampleRate, type CaptureDescriptor, type CaptureSelection } from "@/lib/captureDescriptor";
import { beginNativeCapture, type NativeCaptureSession } from "@/lib/nativeCapture";
import { encodeNativeRetainedSource, type NativeCaptureTerminalOutcome } from "@/lib/nativeCaptureAudit";
import { AudioCaptureFlushError, CAPTURE_INPUT_INTERRUPTED, createAudioCaptureFlush } from "@/lib/audioCaptureFlush";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  checkpointOwnedPreedit,
  debugDictationCaptureEnabled,
  debugNativeCaptureEnabled,
  finishCanonicalOwnedPreedit,
  getOwnedPreeditStatus,
  getDesktopPasteStatus,
  beginDesktopShortcutSession,
  endDesktopShortcutSession,
  pasteDesktopText,
  transcribeAudio,
  transcribeHybridChunk,
  previewTranscribeAudio,
  cancelOwnedPreedit,
  releaseBrowserRecording,
  commitOwnedPreedit,
  showNotification,
  saveDebugDictationCapture,
  saveDebugNativeRetainedSource,
  startOwnedPreedit,
  traceHotkeyEvent,
  updateOwnedPreedit,
} from "@/lib/tauri";
import type { HotkeyTraceFields } from "@/lib/tauri";
import {
  calculateVisualAudioLevelFromSamples,
  removeDcOffsetInPlace,
} from "@/lib/audioLevel";
import {
  appendAudioSamples,
  collectAudioSamplesRange,
  createAudioCaptureBuffer,
  drainAudioCaptureBuffer,
  clearAudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import {
  resampleAudioBuffer,
  resampleAudioForTranscription,
} from "@/lib/audioResampling";
import {
  openMicrophoneStreamWithDiagnostics,
  probeMicrophoneAccess,
} from "@/lib/audioInput";
import {
  clearCommittedCursorText,
  createDictationSessionState,
  disableLiveCursorInsertion,
  invalidateLivePreview,
  markFinalizing,
  requestToggle as requestSessionToggle,
} from "@/lib/dictationSession";
import type { DictationPreviewToken } from "@/lib/dictationSession";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import { errorMessage, LIVE_DELIVERY_PAUSED, resumeCanonicalForRecovery } from "@/lib/dictationRecovery";
import { admitsDictationTrigger, type DictationTriggerAction } from "@/lib/dictationTrigger";
import {
  LIVE_PREVIEW_MIN_INTERVAL_MS,
  TARGET_SAMPLE_RATE,
  shouldUseFastLivePreviewConfirmation,
} from "@/lib/liveCommitPolicy";
import { createLivePreviewSchedule } from "@/lib/livePreviewSchedule";
import { createLivePreviewRunner } from "@/lib/livePreviewRunner";
import { createDesktopCaptureTail } from "@/lib/desktopCaptureTail";
import { createDictationRecording } from "@/lib/dictationRecording";
import {
  acknowledgeCanonicalDelivery,
  activateCanonicalDelivery,
  beginCanonicalTranscription,
  completeCanonicalTranscriptionWithResponse,
  failCanonicalTranscription,
  finishCanonicalSession,
  markCanonicalDeliveryUnavailable,
  markCanonicalDeliveryUncertain,
  planFinalSourceBlock,
  planCanonicalWork,
  captureCanonicalPreparation,
  canonicalPreviewSourceAnchor,
  invalidateCanonicalCache,
  planNextCompleteSourceBlock,
  recordCanonicalSourceBlock,
} from "@/lib/canonicalCursorSession";
import type {
  CanonicalCursorSession,
  CanonicalSourceBlock,
  CanonicalTranscriptionRange,
  CanonicalWork,
} from "@/lib/canonicalCursorSession";
import type { HybridResponse } from "@/lib/hybridSession";
import { requiresVerifiedTextTarget, usesCanonicalCursorStreaming } from "@/lib/dictationOutputPlan";
import {
  isCurrentAudioCaptureSource,
  isCurrentCanonicalTargetOperation,
} from "@/lib/dictationAsyncGuards";
import { observeOwnedPreeditMutation } from "@/lib/ownedPreeditObservation";
import type { CanonicalTargetOperationIdentity } from "@/lib/dictationAsyncGuards";
import {
  nextCursorDeliveryState,
  type CursorDeliveryEvent,
} from "@/lib/dictationDelivery";
import type {
  AppConfig,
  CursorDeliveryState,
  DictationStatus,
  OwnedPreeditStatus,
  PreviewTranscription,
} from "@/types";

const AUDIO_LEVEL_ATTACK = 0.68;
const AUDIO_LEVEL_RELEASE = 0.24;
const AUDIO_LEVEL_FLOOR = 0.01;

type DictationPhase = DictationStatus | "stopping" | "finalizing";
type LiveFinalizationResult = "none" | "safe" | "unreconciled";
interface DebugPreviewFrame {
  sequence: number;
  sourceSampleRate: number;
  capturedSampleCount: number;
  previewStartSample: number;
  preview: PreviewTranscription;
  stateAfter: {
    candidateText: string;
    committedWindowText: string;
    committedCursorText: string;
    nextPreviewStartSample: number;
    blockedCommitCount: number;
    cursorInsertionDisabled: boolean;
  };
}

interface PendingDebugCapture {
  audio: Float32Array;
  completedTranscript: string;
  committedCursorText: string;
  cursorInsertionDisabled: boolean;
  needsFullAudioReference: boolean;
  previewFrames: DebugPreviewFrame[];
  sessionId: number;
  canonicalChunks?: DebugCanonicalChunk[];
}

interface DebugCanonicalChunk {
  sequence: number;
  range: CanonicalTranscriptionRange;
  result: HybridResponse;
}

export function useDictation(options: { getCaptureSelection?: () => CaptureSelection } = {}) {
  const captureSelectionRef = useRef(options.getCaptureSelection);
  captureSelectionRef.current = options.getCaptureSelection;
  const setStatus = useStore((state) => state.setStatus);
  const setTranscript = useStore((state) => state.setTranscript);
  const setInterimTranscript = useStore((state) => state.setInterimTranscript);
  const setError = useStore((state) => state.setError);
  const setAudioLevel = useStore((state) => state.setAudioLevel);
  const setMicrophoneReadyState = useStore((state) => state.setMicrophoneReady);
  const setOwnedPreeditSetupState = useStore(
    (state) => state.setOwnedPreeditSetupState,
  );
  const clearTranscript = useStore((state) => state.clearTranscript);
  const [cancellationPending, setCancellationPending] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const disposedRef = useRef(false);
  const lifecycleEpochRef = useRef(0);
  const cancelledRef = useRef<string | null>(null);
  const recoveryWaitRef = useRef<{ cancel: () => void } | null>(null);
  const nvidiaRecoveryRef = useRef<NvidiaRecovery | null>(null);
  const captureHealthRef = useRef<ReturnType<typeof monitorCaptureHealth> | null>(null);
  const recoveryAudioRef = useRef<Float32Array | null>(null);
  const recoverySessionIdRef = useRef<string | null>(null);
  const [cursorDeliveryState, setCursorDeliveryState] =
    useState<CursorDeliveryState>("inactive");
  const cursorDeliveryStateRef = useRef<CursorDeliveryState>("inactive");

  function updateCursorDeliveryState(next: CursorDeliveryState) {
    cursorDeliveryStateRef.current = next;
    setCursorDeliveryState(next);
  }

  function transitionCursorDelivery(event: CursorDeliveryEvent) {
    updateCursorDeliveryState(
      nextCursorDeliveryState(cursorDeliveryStateRef.current, event),
    );
  }

  function observeOwnedPreeditStatus(status: OwnedPreeditStatus) {
    setOwnedPreeditSetupState(status.setupState);
  }

  function mutateOwnedPreedit(
    mutate: () => Promise<OwnedPreeditStatus>,
  ): Promise<OwnedPreeditStatus> {
    const dictationSessionId = sessionRef.current.sessionId;
    return observeOwnedPreeditMutation(
      mutate,
      getOwnedPreeditStatus,
      (status) => {
        if (isCurrentSession(dictationSessionId)) observeOwnedPreeditStatus(status);
      },
    );
  }

  const captureDescriptorRef = useRef<CaptureDescriptor | null>(null);
  const nativeCaptureRef = useRef<NativeCaptureSession | null>(null);
  const captureGenerationRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletFlushRef = useRef<ReturnType<typeof createAudioCaptureFlush> | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentSinkRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const primedStreamRef = useRef<MediaStream | null>(null);
  const primedDeviceIdRef = useRef<string | null>(null);
  const primedStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const audioBufferRef = useRef(createAudioCaptureBuffer());
  const canonicalAudioBufferRef = useRef(createAudioCaptureBuffer());
  const canonicalSessionRef = useRef<CanonicalCursorSession | null>(null);
  const canonicalGenerationRef = useRef(0);
  const canonicalCheckpointInFlightRef = useRef<Promise<void> | null>(null);
  const canonicalCheckpointDeferredRef = useRef(false);
  const debugCanonicalChunksRef = useRef<DebugCanonicalChunk[]>([]);
  const sessionRef = useRef(createDictationSessionState());
  const sessionConfigRef = useRef<AppConfig | null>(null);
  const phaseRef = useRef<DictationPhase>("idle");
  const workletModuleLoadedRef = useRef(false);
  const smoothedAudioLevelRef = useRef(0);
  const firstHotkeyPressMsRef = useRef<number | null>(null);
  const initialHotkeyPressLoggedRef = useRef(false);
  const initialHotkeyLatencyLoggedRef = useRef(false);
  const recordingStartedAtMsRef = useRef<number | null>(null);
  const stopRequestedAtMsRef = useRef<number | null>(null);
  const firstLiveTextInsertedRef = useRef(false);
  const livePreviewTimeoutRef = useRef<number | null>(null);
  const livePreviewInFlightRef = useRef<Promise<void> | null>(null);
  const liveCursorInsertionInFlightRef = useRef<Promise<void> | null>(null);
  const ownedPreeditStartPromiseRef = useRef<Promise<boolean> | null>(null);
  const ownedPreeditActiveRef = useRef(false);
  const activeTriggerIdRef = useRef<string | undefined>(undefined);
  const manualCopyRequestedRef = useRef(false);
  const desktopPasteSessionRef = useRef(false);
  const desktopStreamEnabledRef = useRef(false);
  const desktopTargetTokenRef = useRef<string | null>(null);
  const desktopPhraseQueueRef = useRef<BenchmarkPhraseQueue | null>(null);
  const desktopShortcutSessionRef = useRef<DesktopShortcutSession | null>(null);
  const desktopShortcutCleanupRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const desktopStreamedSampleCountRef = useRef(0);
  const desktopPhrasePasteCountRef = useRef(0);
  const ownedPreeditSessionIdRef = useRef<number | null>(null);
  const ownedPreeditProgressiveRef = useRef(false);
  const ownedPreeditCommittedTextRef = useRef("");
  const lastLivePreviewTextRef = useRef("");
  // Capture chunks are append-only within a session. Identical bounds therefore
  // identify identical decoder input; never reuse across preview generations.
  const livePreviewCacheRef = useRef<{
    key: string;
    preview: PreviewTranscription;
    preparedSampleCount: number;
  } | null>(null);
  const liveCursorCandidateTextRef = useRef("");
  const liveDraftConfirmedTextRef = useRef("");
  const liveCursorTextRef = useRef("");
  const livePreviewAudioStartSampleRef = useRef(0);
  const liveCursorInsertionDisabledRef = useRef(false);
  const liveCursorFallbackNotifiedRef = useRef(false);
  const livePreviewFailureNotifiedRef = useRef(false);
  const livePreviewNextDelayMsRef = useRef(LIVE_PREVIEW_MIN_INTERVAL_MS);
  const debugCaptureEnabledRef = useRef(false);
  const debugNativeCaptureEnabledRef = useRef(false);
  const debugPreviewFramesRef = useRef<DebugPreviewFrame[]>([]);

  function traceDictationEvent(
    event: string,
    fields: HotkeyTraceFields | null = null,
  ): Promise<void> {
    const sessionId = sessionRef.current.sessionId;
    if (sessionId <= 0) {
      return traceHotkeyEvent(event, fields);
    }

    return traceHotkeyEvent(event, {
      ...(fields ?? {}),
      dictationSessionId: sessionId,
    });
  }

  function canonicalTargetOperationIsCurrent(
    operation: CanonicalTargetOperationIdentity,
  ): boolean {
    return !disposedRef.current && !cancelledRef.current && isCurrentCanonicalTargetOperation(operation, {
      dictationSessionId: sessionRef.current.sessionId,
      canonicalSession: canonicalSessionRef.current,
      ownedSessionId: ownedPreeditSessionIdRef.current,
      ownedSessionActive: ownedPreeditActiveRef.current,
    });
  }

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext({
        latencyHint: "interactive",
      });
      workletModuleLoadedRef.current = false;
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume().catch(() => {});
    }

    return audioContextRef.current;
  }, []);

  const ensureWorkletModuleLoaded = useCallback(
    async (audioContext: AudioContext) => {
      if (workletModuleLoadedRef.current) {
        return;
      }

      await audioContext.audioWorklet.addModule("/audio-processor.js");
      if (!disposedRef.current && audioContextRef.current === audioContext) workletModuleLoadedRef.current = true;
    },
    [],
  );

  const initializeMicrophone = useCallback(
    async (appStartMs: number) => {
      const lifecycleEpoch = lifecycleEpochRef.current;
      const initializationSessionId = sessionRef.current.sessionId;
      const isCurrentInitialization = () => !disposedRef.current &&
        lifecycleEpochRef.current === lifecycleEpoch && sessionRef.current.sessionId === initializationSessionId;
      if (!isCurrentInitialization()) return;
      try {
        if (captureSelectionRef.current?.().backend === "native") return;
        const deviceId = useStore.getState().selectedDeviceId;
        await probeMicrophoneAccess(deviceId);
        if (!isCurrentInitialization()) return;
        const audioContext = await ensureAudioContext();
        if (!isCurrentInitialization()) return;
        await ensureWorkletModuleLoaded(audioContext).catch(() => {});
        if (!isCurrentInitialization()) return;

        setStatus("idle");
        setError(null);
        setInterimTranscript("");
        setMicrophoneReadyState(true);
        console.info("Microphone ready");
        console.info(
          `[timing] app start -> microphone ready: ${Math.round(
            performance.now() - appStartMs,
          )}ms`,
        );
      } catch (err) {
        if (!isCurrentInitialization()) return;
        setStatus("error");
        setMicrophoneReadyState(false);
        showNotification(
          "Microphone not ready",
          `Press ${useStore.getState().config?.hotkey ?? "Alt+D"} to re-initialize microphone access.`,
        ).catch(() => {});

        if (err instanceof DOMException) {
          if (err.name === "NotAllowedError") {
            setError(
              `Microphone access denied on startup. Press ${useStore.getState().config?.hotkey ?? "Alt+D"} to retry after granting permission.`,
            );
          } else if (err.name === "NotFoundError") {
            setError(`No microphone found. Connect one and press ${useStore.getState().config?.hotkey ?? "Alt+D"} to retry.`);
          } else {
            setError(`Microphone startup error: ${err.message}`);
          }
        } else {
          setError(`Microphone startup failed: ${err}`);
        }
      }
    },
    [
      ensureAudioContext,
      ensureWorkletModuleLoaded,
      setError,
      setInterimTranscript,
      setMicrophoneReadyState,
    ],
  );

  const prepareAudioEngine = useCallback(async () => {
    if (captureSelectionRef.current?.().backend === "native") return;
    const audioContext = await ensureAudioContext();
    await ensureWorkletModuleLoaded(audioContext).catch(() => {});
  }, [ensureAudioContext, ensureWorkletModuleLoaded]);

  const openTracedMicrophoneStream = useCallback(async (deviceId: string | null) => {
    const lifecycleEpoch = lifecycleEpochRef.current;
    traceDictationEvent("recording_get_user_media_started").catch(() => {});
    const result = await openMicrophoneStreamWithDiagnostics(deviceId);
    if (disposedRef.current || lifecycleEpochRef.current !== lifecycleEpoch || deviceId !== useStore.getState().selectedDeviceId) {
      return result.stream;
    }
    if (result.fallbackStage === "minimal-constraints") {
      traceDictationEvent("recording_get_user_media_constraints_fallback", {
        selectedDeviceConfigured: result.selectedDeviceConfigured,
      }).catch(() => {});
    } else if (result.fallbackStage === "default-device") {
      traceDictationEvent("recording_get_user_media_default_fallback", {
        selectedDeviceConfigured: result.selectedDeviceConfigured,
      }).catch(() => {});
    }
    traceDictationEvent("recording_get_user_media_done", {
      selectedDeviceConfigured: result.selectedDeviceConfigured,
    }).catch(() => {});
    if (result.fallbackStage === "default-device" && result.selectedDeviceConfigured) {
      const notice = "Your selected microphone is unavailable. VOCO is using the system default microphone for this recording.";
      useStore.getState().setCaptureNotice(notice);
      void showNotification("Microphone changed", notice).catch(() => {});
    } else {
      useStore.getState().setCaptureNotice(null);
    }
    return result.stream;
  }, []);

  const primeRecordingStream = useCallback(async () => {
    if (captureSelectionRef.current?.().backend === "native") return;
    if (streamRef.current || primedStreamRef.current || primedStreamPromiseRef.current) {
      return;
    }

    const deviceId = useStore.getState().selectedDeviceId;
    const lifecycleEpoch = lifecycleEpochRef.current;
    primedDeviceIdRef.current = deviceId;
    const promise = openTracedMicrophoneStream(deviceId)
      .then((stream) => {
        if (disposedRef.current || lifecycleEpochRef.current !== lifecycleEpoch || useStore.getState().selectedDeviceId !== deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("Primed microphone selection is no longer current.");
        }
        primedStreamRef.current = stream;
        setMicrophoneReadyState(true);
        return stream;
      })
      .finally(() => {
        if (primedStreamPromiseRef.current === promise) primedStreamPromiseRef.current = null;
      });

    primedStreamPromiseRef.current = promise;
    await promise.catch(() => {});
  }, [openTracedMicrophoneStream, setMicrophoneReadyState]);

  const updateAudioLevel = useCallback(
    (rawLevel: number) => {
      const clamped = Math.min(1, Math.max(0, rawLevel));
      const previous = smoothedAudioLevelRef.current;
      const blend =
        clamped >= previous ? AUDIO_LEVEL_ATTACK : AUDIO_LEVEL_RELEASE;
      const next = previous + (clamped - previous) * blend;
      const finalLevel = next < AUDIO_LEVEL_FLOOR ? 0 : next;

      smoothedAudioLevelRef.current = finalLevel;
      setAudioLevel(finalLevel);
    },
    [setAudioLevel],
  );

  const resetAudioLevel = useCallback(() => {
    smoothedAudioLevelRef.current = 0;
    setAudioLevel(0);
  }, [setAudioLevel]);

  const livePreviewScheduleRef = useRef<ReturnType<typeof createLivePreviewSchedule> | null>(null);
  // Once per mount: env is refs plus functions that read .current. Rebuilding on
  // audio-level renders would allocate without changing dictation behavior.
  if (livePreviewScheduleRef.current === null) {
    livePreviewScheduleRef.current = createLivePreviewSchedule({
    sessionRef,
    phaseRef,
    canonicalSessionRef,
    canonicalCheckpointInFlightRef,
    canonicalCheckpointDeferredRef,
    livePreviewTimeoutRef,
    livePreviewNextDelayMsRef,
    audioBufferRef,
    planCanonicalWork,
    planNextCompleteSourceBlock,
    processCanonicalWork,
    prepareCanonicalSourceBlock,
    isCurrentSession,
    shouldRunLivePreview,
    shouldUseFastLiveConfirmation,
    runLivePreview,
    traceDictationEvent,
    });
  }
  const livePreviewSchedule = livePreviewScheduleRef.current;

  const livePreviewRunnerRef = useRef<ReturnType<typeof createLivePreviewRunner> | null>(null);
  if (livePreviewRunnerRef.current === null) {
    livePreviewRunnerRef.current = createLivePreviewRunner({
    sessionRef,
    phaseRef,
    sessionConfigRef,
    audioBufferRef,
    captureDescriptorRef,
    livePreviewInFlightRef,
    livePreviewCacheRef,
    livePreviewNextDelayMsRef,
    livePreviewAudioStartSampleRef,
    lastLivePreviewTextRef,
    liveCursorCandidateTextRef,
    liveDraftConfirmedTextRef,
    liveCursorInsertionDisabledRef,
    livePreviewFailureNotifiedRef,
    liveCursorFallbackNotifiedRef,
    ownedPreeditActiveRef,
    ownedPreeditCommittedTextRef,
    ownedPreeditProgressiveRef,
    liveCursorTextRef,
    debugCaptureEnabledRef,
    debugPreviewFramesRef,
    recordingSampleRate,
    shouldRunLivePreview,
    shouldUseFastLiveConfirmation,
    scheduleLivePreview,
    clearLivePreviewTimer,
    usesCanonicalCursorStreaming,
    resampleAudioBuffer,
    previewTranscribeAudio,
    setInterimTranscript,
    waitForOwnedPreeditStart,
    publishOwnedPreedit,
    traceDictationEvent,
    showNotification,
    transitionCursorDelivery,
    });
  }
  const livePreviewRunner = livePreviewRunnerRef.current;

  function clearLivePreviewTimer() {
    livePreviewSchedule.clearLivePreviewTimer();
  }

  function scheduleLivePreview(delayMs = livePreviewNextDelayMsRef.current) {
    livePreviewSchedule.scheduleLivePreview(delayMs);
  }

  function shouldRunLivePreview() {
    const config = sessionConfigRef.current;
    return (
      config?.transcriptTarget === "cursor" &&
      config.liveCursorMode !== "final-text-only" &&
      !sessionRef.current.livePreviewDisabled
    );
  }

  function shouldUseOwnedPreedit() {
    return !desktopPasteSessionRef.current && requiresVerifiedTextTarget(sessionConfigRef.current);
  }

  function beginOwnedPreedit(sessionId: number, triggerId?: string): Promise<boolean> | null {
    if (!shouldUseOwnedPreedit()) {
      return null;
    }

    ownedPreeditProgressiveRef.current = false;
    ownedPreeditCommittedTextRef.current = "";
    const startPromise = (async () => {
      try {
        const status = await mutateOwnedPreedit(() =>
          startOwnedPreedit(sessionId, triggerId),
        );
        const sidecarSessionId = status.sessionId;
        if (sidecarSessionId === null || sidecarSessionId <= 0) {
          throw new Error("VOCO input method did not issue a session lease.");
        }
        if (
          disposedRef.current || cancelledRef.current ||
          sessionRef.current.sessionId !== sessionId ||
          phaseRef.current === "idle" ||
          phaseRef.current === "error"
        ) {
          await mutateOwnedPreedit(() =>
            cancelOwnedPreedit(sidecarSessionId),
          ).catch(() => {});
          return false;
        }
        if (!status.engineActive || status.focusLost) {
          await mutateOwnedPreedit(() =>
            cancelOwnedPreedit(sidecarSessionId),
          ).catch(() => {});
          transitionCursorDelivery("ownership-unavailable");
          return false;
        }

        ownedPreeditSessionIdRef.current = sidecarSessionId;
        ownedPreeditActiveRef.current = true;
        manualCopyRequestedRef.current = false;
        const canonicalSession = canonicalSessionRef.current;
        if (canonicalSession?.sessionId === sessionId) {
          canonicalSessionRef.current = activateCanonicalDelivery(canonicalSession);
        }
        transitionCursorDelivery("ownership-established");
        traceDictationEvent("dictation_owned_preedit_started").catch(() => {});
        return true;
      } catch (error) {
        if (disposedRef.current || sessionRef.current.sessionId !== sessionId) return false;
        console.info("Owned cursor streaming unavailable; using VOCO preview only.");
        const canonicalSession = canonicalSessionRef.current;
        if (canonicalSession?.sessionId === sessionId) {
          canonicalSessionRef.current =
            markCanonicalDeliveryUnavailable(canonicalSession);
        }
        if (!disposedRef.current && sessionRef.current.sessionId === sessionId) {
          transitionCursorDelivery("ownership-unavailable");
        }
        traceDictationEvent("dictation_owned_preedit_unavailable").catch(() => {});
        if (manualCopyRequestedRef.current) return false;
        const detail = error instanceof Error ? error.message : String(error);
        const sensitiveOrUnsupportedField = detail.includes(
          "safe non-sensitive preedit context",
        );
        const inputSourceUnavailable =
          detail.includes("VOCO Dictation") || detail.includes("not active");
        const protocolMismatch = detail.includes("protocol version");
        liveCursorFallbackNotifiedRef.current = true;
        showNotification(
          protocolMismatch
            ? "VOCO input source restart required"
            : sensitiveOrUnsupportedField
            ? "Live cursor unavailable for this field"
            : inputSourceUnavailable
              ? "VOCO Dictation input source required"
              : "Live cursor safety fallback",
          protocolMismatch
            ? "Quit VOCO, restart IBus or sign out and back in, then reopen VOCO. Switching input sources alone cannot load the upgraded engine. This recording will remain preview-only."
            : sensitiveOrUnsupportedField
            ? "VOCO keeps sensitive or unsupported fields preview-only. This recording will remain inside VOCO."
            : inputSourceUnavailable
              ? "Add and select VOCO Dictation in your desktop Input Sources, then focus the target field. This recording will remain preview-only."
              : "VOCO could not establish a verified private input session, so this recording will remain preview-only.",
        ).catch(() => {});
        return false;
      }
    })();
    ownedPreeditStartPromiseRef.current = startPromise;
    return startPromise;
  }

  async function waitForOwnedPreeditStart(): Promise<boolean> {
    const startPromise = ownedPreeditStartPromiseRef.current;
    if (startPromise) {
      return startPromise.catch(() => false);
    }
    return ownedPreeditActiveRef.current;
  }

  function resetOwnedPreeditState() {
    ownedPreeditStartPromiseRef.current = null;
    ownedPreeditActiveRef.current = false;
    ownedPreeditSessionIdRef.current = null;
    ownedPreeditProgressiveRef.current = false;
    ownedPreeditCommittedTextRef.current = "";
  }

  async function cancelOwnedPreeditSession(): Promise<OwnedPreeditStatus | null> {
    const dictationSessionId = sessionRef.current.sessionId;
    await waitForOwnedPreeditStart();
    if (!isCurrentSession(dictationSessionId)) return null;
    const sessionId = ownedPreeditSessionIdRef.current;
    const wasActive = ownedPreeditActiveRef.current;
    resetOwnedPreeditState();
    if (sessionId === null || !wasActive) {
      return null;
    }

    const status = await mutateOwnedPreedit(() =>
      cancelOwnedPreedit(sessionId),
    );
    traceDictationEvent("dictation_owned_preedit_cancelled").catch(() => {});
    return status;
  }

  function shouldUseFastLiveConfirmation() {
    const config = sessionConfigRef.current;
    if (!usesCanonicalCursorStreaming(config)) {
      return false;
    }
    return shouldUseFastLivePreviewConfirmation({
      firstLiveTextInserted: firstLiveTextInsertedRef.current,
      liveCursorInsertionDisabled:
        liveCursorInsertionDisabledRef.current ||
        sessionRef.current.liveCursorInsertionDisabled,
      liveCursorMode: config?.liveCursorMode,
      transcriptTarget: config?.transcriptTarget,
    });
  }

  async function runLivePreview(token: DictationPreviewToken): Promise<void> {
    return livePreviewRunner.runLivePreview(token);
  }

  async function publishOwnedPreedit(
    confirmedText: string,
    preeditText: string,
    provisionalText: string,
    latestPreviewText: string,
  ): Promise<boolean> {
    const sessionId = ownedPreeditSessionIdRef.current;
    const dictationSessionId = sessionRef.current.sessionId;
    if (sessionId === null || !ownedPreeditActiveRef.current) {
      return false;
    }

    const insertionPromise = (async () => {
      const previouslyCommittedText = ownedPreeditCommittedTextRef.current;
      const status = await mutateOwnedPreedit(() =>
        updateOwnedPreedit(
          sessionId,
          confirmedText,
          preeditText,
          provisionalText,
        ),
      );
      if (
        sessionRef.current.sessionId !== dictationSessionId ||
        ownedPreeditSessionIdRef.current !== sessionId
      ) {
        return;
      }
      if (!status.engineActive || status.focusLost || !status.ownershipIntact) {
        throw new Error("The dictation target lost focus.");
      }
      ownedPreeditProgressiveRef.current = status.progressiveCommitActive;
      const confirmedCharacterCount = Array.from(confirmedText).length;
      if (status.committedCharacterCount !== confirmedCharacterCount) {
        throw new Error("VOCO input method reported an invalid committed range.");
      }
      ownedPreeditCommittedTextRef.current = confirmedText;
      if (ownedPreeditCommittedTextRef.current !== previouslyCommittedText) {
        traceDictationEvent(
          "dictation_owned_preedit_progressive_commit",
        ).catch(() => {});
      }
      if (!firstLiveTextInsertedRef.current && recordingStartedAtMsRef.current !== null) {
        firstLiveTextInsertedRef.current = true;
        traceDictationEvent("dictation_first_live_text_visible", {
          durationMs: Math.round(performance.now() - recordingStartedAtMsRef.current),
        }).catch(() => {});
      }
      traceDictationEvent("dictation_owned_preedit_updated").catch(() => {});
    })();
    liveCursorInsertionInFlightRef.current = insertionPromise;

    try {
      await insertionPromise;
      return true;
    } catch (error) {
      const isCurrentSession =
        sessionRef.current.sessionId === dictationSessionId &&
        ownedPreeditSessionIdRef.current === sessionId;
      if (!isCurrentSession) {
        await mutateOwnedPreedit(() => cancelOwnedPreedit(sessionId)).catch(
          () => null,
        );
        return false;
      }
      const canonicalSession = canonicalSessionRef.current;
      if (canonicalSession?.sessionId === dictationSessionId) {
        canonicalSessionRef.current =
          markCanonicalDeliveryUncertain(canonicalSession);
        transitionCursorDelivery("ownership-uncertain");
      }
      const progressivelyCommittedText = ownedPreeditCommittedTextRef.current;
      let cancellationOutcome: OwnedPreeditStatus["finalizationOutcome"] = null;
      const isCurrentRecording =
        phaseRef.current === "recording" &&
        ownedPreeditSessionIdRef.current === sessionId;
      const cancellation = await mutateOwnedPreedit(() =>
        cancelOwnedPreedit(sessionId),
      ).catch(() => null);
      cancellationOutcome = cancellation?.finalizationOutcome ?? null;
      resetOwnedPreeditState();
      liveCursorTextRef.current =
        cancellationOutcome === "preserved" ? progressivelyCommittedText : "";
      liveCursorCandidateTextRef.current = "";
      sessionRef.current = disableLiveCursorInsertion(sessionRef.current);
      liveCursorInsertionDisabledRef.current = true;
      if (isCurrentRecording) {
        setInterimTranscript(latestPreviewText);
        console.warn("Owned cursor streaming stopped:", error);
        traceDictationEvent("dictation_owned_preedit_failed").catch(() => {});
        traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
        showNotification(
          "Live cursor streaming paused",
          "The target field stopped accepting live updates. VOCO will leave existing target text unchanged and will not type a later result into another field.",
        ).catch(() => {});
      }
      return false;
    } finally {
      if (liveCursorInsertionInFlightRef.current === insertionPromise) {
        liveCursorInsertionInFlightRef.current = null;
      }
    }
  }

  function stopLivePreview() {
    livePreviewRunner.stopLivePreview();
  }

  async function clearLiveCursorText() {
    const dictationSessionId = sessionRef.current.sessionId;
    await waitForLiveCursorInsertion();
    if (!isCurrentSession(dictationSessionId)) return;
    if (ownedPreeditActiveRef.current || ownedPreeditStartPromiseRef.current) {
      await cancelOwnedPreeditSession().catch((error) => {
        console.warn("Failed to cancel owned cursor text:", error);
      });
    }
    if (!isCurrentSession(dictationSessionId)) return;
    const previousText = liveCursorTextRef.current;
    if (previousText.length === 0) {
      return;
    }

    liveCursorTextRef.current = "";
    sessionRef.current = clearCommittedCursorText(sessionRef.current);
    traceDictationEvent("dictation_live_cursor_insert_cleared").catch(() => {});
  }

  async function replaceLiveCursorTextWithFinal(
    finalText: string,
  ): Promise<LiveFinalizationResult> {
    const dictationSessionId = sessionRef.current.sessionId;
    await waitForLiveCursorInsertion();
    assertOutputAllowed(dictationSessionId);
    await waitForOwnedPreeditStart();
    assertOutputAllowed(dictationSessionId);
    if (ownedPreeditActiveRef.current) {
      const sessionId = ownedPreeditSessionIdRef.current;
      if (sessionId !== null) {
        try {
          const status = await mutateOwnedPreedit(() =>
            commitOwnedPreedit(sessionId, finalText),
          );
          if (!isCurrentSession(dictationSessionId) || ownedPreeditSessionIdRef.current !== sessionId) {
            return "unreconciled";
          }
          const finalizationOutcome = status.finalizationOutcome;
          resetOwnedPreeditState();
          liveCursorTextRef.current = "";
          liveCursorCandidateTextRef.current = "";
          sessionRef.current = clearCommittedCursorText(sessionRef.current);
          if (
            finalizationOutcome !== "committed" ||
            status.sessionId !== sessionId ||
            !status.engineActive || status.focusLost || !status.ownershipIntact ||
            status.committedCharacterCount !== Array.from(finalText).length
          ) {
            traceDictationEvent("dictation_owned_preedit_final_preserved").catch(
              () => {},
            );
            showNotification(
              "Live text preserved",
              "VOCO committed all live text it still owned and left earlier target text untouched. It did not apply the differing full-session result.",
            ).catch(() => {});
            return "unreconciled";
          }
          traceDictationEvent("dictation_owned_preedit_committed").catch(() => {});
          return "safe";
        } catch (error) {
          if (!isCurrentSession(dictationSessionId) || ownedPreeditSessionIdRef.current !== sessionId) {
            return "unreconciled";
          }
          const progressivelyCommittedText = ownedPreeditCommittedTextRef.current;
          const hadProgressiveCommit = ownedPreeditProgressiveRef.current;
          const cancellation = await mutateOwnedPreedit(() =>
            cancelOwnedPreedit(sessionId),
          ).catch(() => null);
          if (!isCurrentSession(dictationSessionId) || ownedPreeditSessionIdRef.current !== sessionId) {
            return "unreconciled";
          }
          const liveTextWasPreserved =
            cancellation?.finalizationOutcome === "preserved" ||
            (cancellation === null && hadProgressiveCommit);
          resetOwnedPreeditState();
          liveCursorTextRef.current = liveTextWasPreserved
            ? progressivelyCommittedText
            : "";
          liveCursorCandidateTextRef.current = "";
          sessionRef.current = clearCommittedCursorText(sessionRef.current);
          console.warn("Owned cursor final commit failed:", error);
          traceDictationEvent("dictation_owned_preedit_commit_failed").catch(() => {});
          showNotification(
            "Delivery unconfirmed",
            "Some text may already be in the original field. VOCO did not retry in another target. Review that field before pasting the recovered transcript.",
          ).catch(() => {});
          return "unreconciled";
        }
      }
    }
    // Never route an automatic result to whichever field happens to be focused now.
    // Missing or invalidated recording-time ownership always requires manual recovery.
    return "unreconciled";
  }

  async function waitForLiveCursorInsertion() {
    const inFlight = liveCursorInsertionInFlightRef.current;
    if (inFlight) {
      await inFlight.catch(() => {});
    }
  }

  async function persistDebugCapture(
    pending: PendingDebugCapture,
  ): Promise<void> {
    let referenceTranscript = pending.completedTranscript;
    if (pending.needsFullAudioReference) {
      const referenceStartedAt = performance.now();
      referenceTranscript = await transcribeAudio(pending.audio).catch((error) => {
        console.warn(
          "Failed to create full-audio debug reference transcript:",
          error,
        );
        return pending.completedTranscript;
      });
      traceHotkeyEvent("dictation_debug_reference_completed", {
        dictationSessionId: pending.sessionId,
        durationMs: Math.round(performance.now() - referenceStartedAt),
      }).catch(() => {});
    }

    const capture = await saveDebugDictationCapture(pending.audio, {
      schemaVersion: pending.canonicalChunks ? 2 : 1,
      targetSampleRate: TARGET_SAMPLE_RATE,
      finalTranscript: referenceTranscript,
      committedCursorText: pending.committedCursorText,
      cursorInsertionDisabled: pending.cursorInsertionDisabled,
      previewFrames: pending.previewFrames,
      canonicalChunks: pending.canonicalChunks,
    }).catch((error) => {
      console.warn("Failed to save local debug dictation capture:", error);
      return null;
    });
    if (!capture) {
      return;
    }

    console.info(`Debug dictation capture saved: ${capture.timelinePath}`);
    showNotification(
      "Debug dictation captured",
      `Saved locally for replay: ${capture.timelinePath}`,
    ).catch(() => {});
  }

  function invalidateCanonicalAudioCache() {
    const generation = canonicalGenerationRef.current + 1;
    if (!Number.isSafeInteger(generation)) throw new Error("Canonical generation exhausted");
    const current = canonicalSessionRef.current;
    const next = current ? invalidateCanonicalCache(current, generation) : null;
    canonicalGenerationRef.current = generation;
    canonicalSessionRef.current = next;
  }

  function clearCanonicalAudioCache() {
    invalidateCanonicalAudioCache();
    clearAudioCaptureBuffer(canonicalAudioBufferRef.current);
  }

  function drainCanonicalAudioCache(): Float32Array {
    invalidateCanonicalAudioCache();
    return drainAudioCaptureBuffer(canonicalAudioBufferRef.current);
  }

  async function prepareCanonicalSourceBlock(
    block: CanonicalSourceBlock,
  ): Promise<void> {
    const state = canonicalSessionRef.current;
    if (!state) {
      throw new Error("canonical cursor session is unavailable");
    }
    const ticket = captureCanonicalPreparation(state, block);
    const sourceSamples = collectAudioSamplesRange(
      audioBufferRef.current,
      block.startSample,
      block.endSample - block.startSample,
    );
    if (sourceSamples.length !== block.endSample - block.startSample) {
      throw new Error("canonical source audio prefix is incomplete");
    }

    removeDcOffsetInPlace(sourceSamples);
    const canonicalSamples =
      state.sourceSampleRate !== TARGET_SAMPLE_RATE
        ? await resampleAudioBuffer(
            sourceSamples,
            state.sourceSampleRate,
            TARGET_SAMPLE_RATE,
          )
        : sourceSamples;
    const current = canonicalSessionRef.current;
    if (disposedRef.current || sessionRef.current.sessionId !== state.sessionId || !current || current.sessionId !== state.sessionId) {
      throw new Error("canonical cursor session changed during preprocessing");
    }
    const next = recordCanonicalSourceBlock(
      current,
      block,
      canonicalSamples.length,
      ticket,
    );
    appendAudioSamples(canonicalAudioBufferRef.current, canonicalSamples);
    canonicalSessionRef.current = next;
  }

  function collectCanonicalRange(
    range: { startSample: number; endSample: number },
  ): Float32Array {
    const samples = collectAudioSamplesRange(
      canonicalAudioBufferRef.current,
      range.startSample,
      range.endSample - range.startSample,
    );
    if (samples.length !== range.endSample - range.startSample) {
      throw new Error("canonical transcription audio range is incomplete");
    }
    return samples;
  }

  function resetCanonicalDraftAfterCheckpoint() {
    const state = canonicalSessionRef.current;
    lastLivePreviewTextRef.current = "";
    liveDraftConfirmedTextRef.current = "";
    liveCursorCandidateTextRef.current = "";
    if (state && state.ledger) {
      livePreviewAudioStartSampleRef.current = Math.min(
        canonicalPreviewSourceAnchor(state),
        audioBufferRef.current.sampleCount,
      );
    }
  }

  async function deliverCanonicalCheckpoint(
    expectedCanonicalSessionId: number,
  ): Promise<boolean> {
    const dictationSessionId = sessionRef.current.sessionId;
    if (dictationSessionId !== expectedCanonicalSessionId) {
      return false;
    }
    const ownedPreeditStarted = await waitForOwnedPreeditStart();
    let state = canonicalSessionRef.current;
    if (
      sessionRef.current.sessionId !== dictationSessionId ||
      !state ||
      state.sessionId !== expectedCanonicalSessionId
    ) {
      return false;
    }
    if (!ownedPreeditStarted) {
      canonicalSessionRef.current = markCanonicalDeliveryUnavailable(state);
      transitionCursorDelivery("ownership-unavailable");
      return false;
    }
    if (state.delivery === "pending") {
      state = activateCanonicalDelivery(state);
      canonicalSessionRef.current = state;
    }
    const ownedSessionId = ownedPreeditSessionIdRef.current;
    if (
      state.delivery !== "owned" ||
      ownedSessionId === null ||
      !ownedPreeditActiveRef.current
    ) {
      transitionCursorDelivery(
        state.delivery === "uncertain"
          ? "ownership-uncertain"
          : "ownership-unavailable",
      );
      return false;
    }
    const operation: CanonicalTargetOperationIdentity = {
      dictationSessionId,
      canonicalSessionId: expectedCanonicalSessionId,
      ownedSessionId,
    };
    if (!canonicalTargetOperationIsCurrent(operation)) {
      return false;
    }
    if (!state.recognition.canonicalText.startsWith(state.acknowledgedTargetText)) {
      throw new Error("canonical target prefix is inconsistent");
    }

    const expectedCommittedText = state.acknowledgedTargetText;
    const appendText = state.recognition.canonicalText.slice(expectedCommittedText.length);
    const mutation = mutateOwnedPreedit(() =>
      checkpointOwnedPreedit(
        ownedSessionId,
        expectedCommittedText,
        appendText,
      ),
    );
    const mutationWait = mutation.then(
      () => undefined,
      () => undefined,
    );
    liveCursorInsertionInFlightRef.current = mutationWait;
    try {
      const status = await mutation;
      const expectedCharacterCount = Array.from(state.recognition.canonicalText).length;
      if (
        !canonicalTargetOperationIsCurrent(operation) ||
        status.sessionId !== ownedSessionId ||
        !status.engineActive ||
        status.focusLost ||
        !status.ownershipIntact ||
        status.committedCharacterCount !== expectedCharacterCount
      ) {
        throw new Error("VOCO input method did not acknowledge the exact checkpoint");
      }
      const current = canonicalSessionRef.current;
      if (!current || current.sessionId !== state.sessionId) {
        throw new Error("canonical cursor session changed during target delivery");
      }
      canonicalSessionRef.current = acknowledgeCanonicalDelivery(
        current,
        expectedCommittedText,
        appendText,
      );
      ownedPreeditProgressiveRef.current = status.progressiveCommitActive;
      ownedPreeditCommittedTextRef.current = state.recognition.canonicalText;
      liveCursorTextRef.current = state.recognition.canonicalText;
      traceDictationEvent("dictation_canonical_checkpoint_committed", {
        chunkCount: current.recognition.progress.plannerSequence,
      }).catch(() => {});
      return true;
    } catch (error) {
      if (!canonicalTargetOperationIsCurrent(operation)) {
        await mutateOwnedPreedit(() =>
          cancelOwnedPreedit(ownedSessionId),
        ).catch(() => null);
        return false;
      }
      const current = canonicalSessionRef.current;
      if (!current) {
        await mutateOwnedPreedit(() =>
          cancelOwnedPreedit(ownedSessionId),
        ).catch(() => null);
        return false;
      }
      canonicalSessionRef.current = markCanonicalDeliveryUncertain(current);
      transitionCursorDelivery("ownership-uncertain");
      await mutateOwnedPreedit(() =>
        cancelOwnedPreedit(ownedSessionId),
      ).catch(() => null);
      resetOwnedPreeditState();
      sessionRef.current = disableLiveCursorInsertion(sessionRef.current);
      liveCursorInsertionDisabledRef.current = true;
      console.warn("Canonical cursor checkpoint stopped:", error);
      traceDictationEvent("dictation_canonical_checkpoint_failed").catch(() => {});
      traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
      if (!liveCursorFallbackNotifiedRef.current) {
        liveCursorFallbackNotifiedRef.current = true;
        showNotification(
          "Live cursor checkpoint paused",
          "VOCO could not prove whether the target accepted the checkpoint. It will not retry or type a later result into another field.",
        ).catch(() => {});
      }
      return false;
    } finally {
      if (liveCursorInsertionInFlightRef.current === mutationWait) {
        liveCursorInsertionInFlightRef.current = null;
      }
    }
  }

  async function processCanonicalWork(
    work: CanonicalWork,
    deliverCheckpoint: boolean,
  ): Promise<void> {
    const initial = canonicalSessionRef.current;
    if (!initial) throw new Error("canonical cursor session is unavailable");
    const samples = work.kind === "range" ? collectCanonicalRange(work.range) : undefined;
    const begun = beginCanonicalTranscription(initial, samples,
      work.kind === "range" ? work.finalizing : false);
    const attempt = begun.recognition.active;
    if (!attempt) throw new Error("canonical request did not start");
    canonicalSessionRef.current = begun;
    sessionRef.current = invalidateLivePreview(sessionRef.current);
    clearLivePreviewTimer();
    const startedAt = performance.now();
    let result: HybridResponse;
    try {
      const previewInFlight = livePreviewInFlightRef.current;
      if (previewInFlight) await previewInFlight.catch(() => {});
      await waitForLiveCursorInsertion();
      assertOutputAllowed(initial.sessionId);
      const current = canonicalSessionRef.current;
      if (!current || current.recognition.active !== attempt) {
        throw new Error("canonical cursor session changed before transcription");
      }
      const raw = await transcribeHybridChunk(attempt.packet());
      const latest = canonicalSessionRef.current;
      if (!isCurrentSession(initial.sessionId) || !latest || latest.recognition.active !== attempt) {
        throw new Error("canonical cursor session changed during transcription");
      }
      const completed = completeCanonicalTranscriptionWithResponse(latest, attempt, raw);
      canonicalSessionRef.current = completed.session;
      result = completed.response;
    } catch (error) {
      if (!isCurrentSession(initial.sessionId)) throw error;
      const current = canonicalSessionRef.current;
      if (current?.recognition.active === attempt) {
        canonicalSessionRef.current = failCanonicalTranscription(current, attempt);
      }
      canonicalCheckpointDeferredRef.current = true;
      traceDictationEvent("dictation_canonical_checkpoint_failed", {
        chunkCount: attempt.metadata.plannerSequence + 1,
        durationMs: Math.round(performance.now() - startedAt),
      }).catch(() => {});
      throw error;
    }

    // Recognition is already committed. Output cancellation or delivery failure
    // must never enter the decode-failure transition or discard its prefix.
    debugCanonicalChunksRef.current.push({
      sequence: result.receipt.sequence + 1,
      range: {chunkIndex: result.receipt.sequence, startSample: result.receipt.inputStart,
        endSample: result.receipt.inputEnd,
        complete: result.receipt.inputEnd - result.receipt.inputStart === 480_000},
      result,
    });
    resetCanonicalDraftAfterCheckpoint();
    assertOutputAllowed(initial.sessionId);
    traceDictationEvent("dictation_canonical_checkpoint_completed", {
      chunkCount: result.receipt.sequence + 1,
      durationMs: Math.round(performance.now() - startedAt),
    }).catch(() => {});
    if (deliverCheckpoint) await deliverCanonicalCheckpoint(initial.sessionId);
  }

  function pumpCanonicalCheckpoints(): void {
    livePreviewSchedule.pumpCanonicalCheckpoints();
  }

  async function transcribeCanonicalRemainderAtStop(
    capturedSourceSampleCount: number,
  ): Promise<{ audio: Float32Array; transcript: string }> {
    canonicalCheckpointDeferredRef.current = false;
    while (true) {
      const state = canonicalSessionRef.current;
      if (!state) throw new Error("canonical cursor session is unavailable");
      if (state.cacheReleased) {
        if (state.phase !== "complete") throw new Error("Canonical audio cache is no longer available");
        return {audio: new Float32Array(), transcript: state.recognition.canonicalText};
      }
      const completeWork = planCanonicalWork(state, false);
      if (completeWork) {
        await processCanonicalWork(completeWork, false);
        canonicalCheckpointDeferredRef.current = false;
        continue;
      }
      const sourceBlock = planNextCompleteSourceBlock(state, capturedSourceSampleCount) ??
        planFinalSourceBlock(state, capturedSourceSampleCount);
      if (sourceBlock) {
        await prepareCanonicalSourceBlock(sourceBlock);
        continue;
      }
      const finalWork = planCanonicalWork(state, true);
      if (finalWork) {
        await processCanonicalWork(finalWork, false);
        canonicalCheckpointDeferredRef.current = false;
        continue;
      }
      const completed = finishCanonicalSession(state, capturedSourceSampleCount);
      canonicalSessionRef.current = completed;
      return {audio: drainCanonicalAudioCache(), transcript: completed.recognition.canonicalText};
    }
  }

  async function finishCanonicalTarget(): Promise<LiveFinalizationResult> {
    const initialState = canonicalSessionRef.current;
    if (!initialState) {
      return "unreconciled";
    }
    const dictationSessionId = sessionRef.current.sessionId;
    const canonicalSessionId = initialState.sessionId;
    if (dictationSessionId !== canonicalSessionId) {
      return "unreconciled";
    }
    const started = await waitForOwnedPreeditStart();
    let state = canonicalSessionRef.current;
    if (
      sessionRef.current.sessionId !== dictationSessionId ||
      !state ||
      state.sessionId !== canonicalSessionId
    ) {
      return "unreconciled";
    }
    if (started && state.delivery === "pending") {
      state = activateCanonicalDelivery(state);
      canonicalSessionRef.current = state;
    }
    const ownedSessionId = ownedPreeditSessionIdRef.current;
    if (
      !started ||
      state.delivery !== "owned" ||
      ownedSessionId === null ||
      !ownedPreeditActiveRef.current
    ) {
      if (ownedSessionId !== null && ownedPreeditActiveRef.current) {
        await mutateOwnedPreedit(() =>
          cancelOwnedPreedit(ownedSessionId),
        ).catch(() => null);
        resetOwnedPreeditState();
      }
      return "unreconciled";
    }
    const operation: CanonicalTargetOperationIdentity = {
      dictationSessionId,
      canonicalSessionId,
      ownedSessionId,
    };
    if (!canonicalTargetOperationIsCurrent(operation)) {
      return "unreconciled";
    }
    if (!state.recognition.canonicalText.startsWith(state.acknowledgedTargetText)) {
      throw new Error("canonical final target prefix is inconsistent");
    }

    const expectedCommittedText = state.acknowledgedTargetText;
    const appendText = state.recognition.canonicalText.slice(expectedCommittedText.length);
    const mutation = mutateOwnedPreedit(() =>
      finishCanonicalOwnedPreedit(
        ownedSessionId,
        expectedCommittedText,
        appendText,
      ),
    );
    const mutationWait = mutation.then(
      () => undefined,
      () => undefined,
    );
    liveCursorInsertionInFlightRef.current = mutationWait;
    try {
      const status = await mutation;
      const expectedCharacterCount = Array.from(state.recognition.canonicalText).length;
      if (
        !canonicalTargetOperationIsCurrent(operation) ||
        status.sessionId !== ownedSessionId ||
        !status.engineActive ||
        status.focusLost ||
        !status.ownershipIntact ||
        status.finalizationOutcome !== "committed" ||
        status.committedCharacterCount !== expectedCharacterCount
      ) {
        throw new Error("VOCO input method did not acknowledge the exact final text");
      }
      const current = canonicalSessionRef.current;
      if (!current || current.sessionId !== state.sessionId) {
        throw new Error("canonical cursor session changed during final delivery");
      }
      canonicalSessionRef.current = acknowledgeCanonicalDelivery(
        current,
        expectedCommittedText,
        appendText,
      );
      resetOwnedPreeditState();
      liveCursorTextRef.current = "";
      liveCursorCandidateTextRef.current = "";
      liveDraftConfirmedTextRef.current = "";
      sessionRef.current = clearCommittedCursorText(sessionRef.current);
      traceDictationEvent("dictation_canonical_final_completed", {
        chunkCount: current.recognition.progress.plannerSequence,
      }).catch(() => {});
      return "safe";
    } catch (error) {
      if (!canonicalTargetOperationIsCurrent(operation)) {
        await mutateOwnedPreedit(() =>
          cancelOwnedPreedit(ownedSessionId),
        ).catch(() => null);
        return "unreconciled";
      }
      const current = canonicalSessionRef.current;
      if (!current) {
        await mutateOwnedPreedit(() =>
          cancelOwnedPreedit(ownedSessionId),
        ).catch(() => null);
        return "unreconciled";
      }
      canonicalSessionRef.current = markCanonicalDeliveryUncertain(current);
      await mutateOwnedPreedit(() =>
        cancelOwnedPreedit(ownedSessionId),
      ).catch(() => null);
      resetOwnedPreeditState();
      liveCursorInsertionDisabledRef.current = true;
      sessionRef.current = disableLiveCursorInsertion(sessionRef.current);
      console.warn("Canonical final target delivery failed:", error);
      traceDictationEvent("dictation_owned_preedit_commit_failed").catch(() => {});
      showNotification(
        "Delivery unconfirmed",
        "Some text may already be in the original field. VOCO could not confirm the final checkpoint and did not retry. Review that field before pasting the recovered transcript.",
      ).catch(() => {});
      return "unreconciled";
    } finally {
      if (liveCursorInsertionInFlightRef.current === mutationWait) {
        liveCursorInsertionInFlightRef.current = null;
      }
    }
  }

  async function completeCanonicalRecording(
    capturedSourceSampleCount: number,
    transcribeStartedAt: number,
    dictationSessionId: number,
  ): Promise<void> {
    const { audio, transcript } = await transcribeCanonicalRemainderAtStop(
      capturedSourceSampleCount,
    );
    assertOutputAllowed(dictationSessionId);
    clearCapturedAudio();
    const transcriptionDurationMs = Math.round(
      performance.now() - transcribeStartedAt,
    );
    traceDictationEvent("dictation_transcription_completed", {
      durationMs: transcriptionDurationMs,
      chunkCount: debugCanonicalChunksRef.current.length,
    }).catch(() => {});
    if (stopRequestedAtMsRef.current !== null) {
      traceDictationEvent("dictation_stop_to_final_transcript", {
        durationMs: Math.round(performance.now() - stopRequestedAtMsRef.current),
      }).catch(() => {});
    }

    useStore.getState().setRawTranscript(transcript);
    setTranscript(transcript.trim().length > 0 ? transcript : "(no speech detected)");
    phaseRef.current = "finalizing";
    setCanCancel(false);
    sessionRef.current = markFinalizing(sessionRef.current);
    const finalization = await finishCanonicalTarget();
    if (!isCurrentSession(dictationSessionId)) return;
    if (finalization === "safe") {
      traceDictationEvent("dictation_final_output_completed").catch(() => {});
    } else if (manualCopyRequestedRef.current && !ownedPreeditActiveRef.current) {
      retainManualTranscript();
    } else {
      transitionCursorDelivery("ownership-uncertain");
      retainRecovery("Cursor delivery could not be verified. Review the target before copying any missing text.", false);
      traceDictationEvent("dictation_final_output_unreconciled").catch(() => {});
    }

    if (debugCaptureEnabledRef.current) {
      const state = canonicalSessionRef.current;
      const pendingCapture: PendingDebugCapture = {
        audio,
        completedTranscript: transcript,
        committedCursorText: state?.acknowledgedTargetText ?? "",
        cursorInsertionDisabled:
          state?.delivery !== "owned" ||
          liveCursorInsertionDisabledRef.current ||
          sessionRef.current.liveCursorInsertionDisabled,
        needsFullAudioReference: false,
        previewFrames: [...debugPreviewFramesRef.current],
        canonicalChunks: [...debugCanonicalChunksRef.current],
        sessionId: sessionRef.current.sessionId,
      };
      debugCaptureEnabledRef.current = false;
      void persistDebugCapture(pendingCapture);
    }

    finalizeIdleState();
  }

  function recordingSampleRate(): number {
    return retainedSampleRate(captureDescriptorRef.current, audioBufferRef.current.sampleCount);
  }

  function clearCapturedAudio(): void {
    livePreviewRunner.clearCapturedAudio();
  }

  function traceDesktopPasteMetrics(result: Awaited<ReturnType<typeof pasteDesktopText>>) {
    const metrics = result.pasteMetrics;
    if (!metrics) return;
    for (const [name, durationMs] of [
      ["dictation_desktop_target_probe_completed", metrics.targetProbeMs],
      ["dictation_desktop_paste_preflight_completed", metrics.preflightMs],
      ["dictation_desktop_clipboard_write_completed", metrics.clipboardMs],
      ["dictation_desktop_keyboard_dispatch_completed", metrics.keyboardMs],
    ] as const) traceDictationEvent(name, { durationMs }).catch(() => {});
    traceDictationEvent(metrics.terminal ? "dictation_desktop_terminal_route_dispatched" : "dictation_desktop_standard_route_dispatched").catch(() => {});
  }

  const recordingRef = useRef<ReturnType<typeof createDictationRecording> | null>(null);
  const desktopCaptureRef = useRef<ReturnType<typeof createDesktopCaptureTail> | null>(null);
  if (desktopCaptureRef.current === null) {
    desktopCaptureRef.current = createDesktopCaptureTail({
      audioBufferRef,
      desktopPhraseQueueRef,
      desktopStreamedSampleCountRef,
      phaseRef,
      captureHealthRef,
      nativeCaptureRef,
      cancelledRef,
      recordingSampleRate,
      pumpCanonicalCheckpoints,
      stopRecording: () => { void recordingRef.current?.stopRecording(); },
      persistNativeRetainedSource,
      flushCaptureSamples,
      disconnectAudioGraph,
      traceDictationEvent,
    });
  }
  const desktopCapture = desktopCaptureRef.current;

  function enqueueDesktopPhrase(end: number) {
    desktopCapture.enqueueDesktopPhrase(end);
  }

  function appendRecordingSamples(samples: Float32Array): number {
    return desktopCapture.appendRecordingSamples(samples);
  }

  const connectSilentSink = useCallback(
    (audioContext: AudioContext, sourceNode: AudioNode) => {
      const silentSink = audioContext.createGain();
      silentSink.gain.value = 0;
      sourceNode.connect(silentSink);
      silentSink.connect(audioContext.destination);
      silentSinkRef.current = silentSink;
    },
    [],
  );

  const connectWorklet = async (
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode,
  ): Promise<boolean> => {
    let worklet: AudioWorkletNode | null = null;
    const sourceSessionId = sessionRef.current.sessionId;
    try {
      await ensureWorkletModuleLoaded(audioContext);
      if (!isCurrentSession(sourceSessionId)) return false;
      const createdWorklet = new AudioWorkletNode(
        audioContext,
        "audio-capture-processor",
      );
      worklet = createdWorklet;
      let inputInterrupted = false;
      const interruptInput = () => {
        if (inputInterrupted) return;
        inputInterrupted = true;
        traceDictationEvent("dictation_capture_input_gap").catch(() => {});
        useStore.getState().setCaptureNotice(CAPTURE_INPUT_INTERRUPTED);
        void cancelRecording(CAPTURE_INPUT_INTERRUPTED);
      };
      createdWorklet.port.onmessage = (e) => {
        if (
          !isCurrentAudioCaptureSource(
            createdWorklet,
            sourceSessionId,
            workletRef.current,
            sessionRef.current.sessionId,
          )
        ) {
          return;
        }
        if (e.data.type === "samples") {
          appendRecordingSamples(e.data.data as Float32Array);
        } else if (e.data.type === "level") {
          updateAudioLevel(e.data.data as number);
        } else if (e.data.type === "capture-interrupted") {
          // The producer reports the gap before its buffered prefix. Invalidate
          // automatic output before accepting those final received samples.
          interruptInput();
        } else if (e.data.type === "flushed") {
          if (e.data.complete === true && !inputInterrupted) {
            workletFlushRef.current?.acknowledge();
          } else if (e.data.complete === false || inputInterrupted) {
            interruptInput();
            workletFlushRef.current?.cancel(CAPTURE_INPUT_INTERRUPTED);
          } else {
            workletFlushRef.current?.cancel();
          }
        }
      };
      workletRef.current = createdWorklet;
      source.connect(createdWorklet);
      connectSilentSink(audioContext, createdWorklet);
      return true;
    } catch {
      if (worklet) {
        if (workletRef.current === worklet) {
          workletRef.current = null;
        }
        worklet.port.onmessage = null;
        worklet.port.close();
        worklet.disconnect();
        try {
          source.disconnect(worklet);
        } catch {
          // The source may not have connected before initialization failed.
        }
      }
      return false;
    }
  };

  const connectScriptProcessor = (
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode,
  ) => {
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const sourceSessionId = sessionRef.current.sessionId;
    processor.onaudioprocess = (e) => {
      if (
        !isCurrentAudioCaptureSource(
          processor,
          sourceSessionId,
          processorRef.current,
          sessionRef.current.sessionId,
        )
      ) {
        return;
      }
      const input = e.inputBuffer.getChannelData(0);
      appendRecordingSamples(new Float32Array(input));
      updateAudioLevel(calculateVisualAudioLevelFromSamples(input));
    };
    processorRef.current = processor;
    source.connect(processor);
    connectSilentSink(audioContext, processor);
  };

  async function flushCaptureSamples() {
    const worklet = workletRef.current;
    if (!worklet) {
      // ScriptProcessor has no input flush acknowledgment. Waiting for callbacks
      // cannot prove completeness: delayed dispatch can overwrite queued buffers.
      if (processorRef.current) throw new AudioCaptureFlushError();
      return;
    }

    const flush = createAudioCaptureFlush();
    workletFlushRef.current = flush;
    try {
      try {
        worklet.port.postMessage({ type: "flush" });
      } catch {
        flush.cancel();
      }
      await flush.completion;
    } finally {
      if (workletFlushRef.current === flush) workletFlushRef.current = null;
    }
  }

  function persistNativeRetainedSource(native: NativeCaptureSession, outcome: NativeCaptureTerminalOutcome) {
    if (!debugNativeCaptureEnabledRef.current ||
        !isCurrentSession(native.identity.sessionId) ||
        captureDescriptorRef.current?.generation !== native.identity.generation) return;
    debugNativeCaptureEnabledRef.current = false;
    try {
      const samples = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
      const packet = encodeNativeRetainedSource(samples, native.identity, native.descriptor, outcome);
      void saveDebugNativeRetainedSource(packet).then(path => {
        if (path) console.info(`Native retained-source evidence saved: ${path}`);
      }).catch(error => console.warn("Native retained-source evidence was not saved:", error));
    } catch (error) {
      console.warn("Native retained-source evidence could not be captured:", error);
    }
  }

  async function teardownAudioGraph() {
    return desktopCapture.teardownAudioGraph();
  }

  function disconnectAudioGraph() {
    const worklet = workletRef.current;
    const processor = processorRef.current;
    const sink = silentSinkRef.current;
    const source = sourceRef.current;
    const stream = streamRef.current;
    workletRef.current = null;
    processorRef.current = null;
    silentSinkRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    if (worklet) {
      worklet.port.onmessage = null;
      try { worklet.port.close(); } catch { /* The browser may already have closed the port. */ }
    }
    if (processor) processor.onaudioprocess = null;
    for (const node of [worklet, processor, sink, source]) {
      try { node?.disconnect(); } catch { /* Continue releasing the rest of the capture graph. */ }
    }
    stream?.getTracks().forEach((track) => track.stop());
  }

  function retainCurrentTranscript(reason: "delivery-unconfirmed" | "output-failed") {
    const id = recoverySessionIdRef.current;
    if (!id) return;
    const state = useStore.getState();
    const finalText = state.transcript.trim();
    const text = finalText || canonicalSessionRef.current?.recognition.canonicalText.trim() || "";
    if (!text || text === "(no speech detected)") return;
    state.retainRecoverableTranscript({ id, text, reason, isPartial: !finalText });
    state.setLastDictationResult({ completedAt: Date.now(), outcome: "needs-recovery" });
  }

  if (recordingRef.current === null) {
    recordingRef.current = createDictationRecording({
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
      workletRef,
      processorRef,
      silentSinkRef,
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
    });
  }
  const recording = recordingRef.current;
  const startRecording = recording.startRecording.bind(recording);
  const stopRecording = recording.stopRecording.bind(recording);
  const cancelRecording = recording.cancelRecording.bind(recording);
  function finalizeIdleState() {
    recording.finalizeIdleState();
  }
  function retainRecovery(reason: string, keepAudio = true) {
    recording.retainRecovery(reason, keepAudio);
  }
  function retainManualTranscript() {
    recording.retainManualTranscript();
  }
  function releaseRecordingOrigin(triggerId = activeTriggerIdRef.current) {
    recording.releaseRecordingOrigin(triggerId);
  }
  function isCurrentSession(sessionId: number): boolean {
    return recording.isCurrentSession(sessionId);
  }
  function assertOutputAllowed(sessionId = sessionRef.current.sessionId) {
    recording.assertOutputAllowed(sessionId);
  }

  async function retryRecovery() {
    const recovery = useStore.getState().recovery;
    if (!recovery?.audioAvailable || recovery.retrying || (phaseRef.current !== "idle" && phaseRef.current !== "error")) return;
    const recoverySessionId = sessionRef.current.sessionId;
    useStore.getState().setRecovery({ ...recovery, retrying: true,
      reason: "Waiting for the previous local operation to finish. Cancel dictation stops this wait and keeps your audio; it does not interrupt that operation.",
    });
    phaseRef.current = "processing";
    setStatus("processing");
    setCanCancel(true);
    setCancellationPending(false);
    setInterimTranscript("Waiting for the previous local operation to finish...");
    // Cancellation cannot interrupt an outstanding native request. A subsequent
    // Retry waits for that request and its private recovery worker cleanup.
    let nativeRecovery: NvidiaRecovery | null = null;
    let cancelWait: () => void = () => {};
    const cancelled = new Promise<false>((resolve) => {
      cancelWait = () => { nativeRecovery?.cancel(); resolve(false); };
    });
    const attempt = { cancel: cancelWait };
    recoveryWaitRef.current = attempt;
    const settled = Promise.all([
      canonicalCheckpointInFlightRef.current?.catch(() => {}),
      livePreviewInFlightRef.current?.catch(() => {}),
      waitForLiveCursorInsertion(),
      nvidiaRecoveryRef.current?.settled(),
    ]).then(() => true);
    const ready = await Promise.race([settled, cancelled]);
    if (!ready || recoveryWaitRef.current !== attempt || !isCurrentSession(recoverySessionId)) return;
    // Keep the cancellation token throughout NVIDIA recovery. Cancelling returns
    // the UI immediately; the next Retry waits for its private worker cleanup.
    const useNvidia = desktopStreamEnabledRef.current;
    if (!useNvidia) recoveryWaitRef.current = null;
    useStore.getState().setRecovery({ ...recovery, retrying: true,
      reason: "Recovering the audio received locally. The result will stay in VOCO.",
    });
    cancelledRef.current = null;
    setCancellationPending(false);
    setCanCancel(true);
    phaseRef.current = "processing";
    setStatus("processing");
    setInterimTranscript("Recovering transcription locally. The result will stay in VOCO.");
    try {
      let transcript: string;
      if (useNvidia) {
        nativeRecovery = new NvidiaRecovery();
        nvidiaRecoveryRef.current = nativeRecovery;
        const audio = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
        const result = await Promise.race([
          nativeRecovery.transcribe(audio, recordingSampleRate()).then(text => ({ text })),
          cancelled,
        ]);
        if (result === false || recoveryWaitRef.current !== attempt || !isCurrentSession(recoverySessionId)) return;
        transcript = result.text;
      } else if (canonicalSessionRef.current) {
        canonicalSessionRef.current = resumeCanonicalForRecovery(canonicalSessionRef.current);
        const result = await transcribeCanonicalRemainderAtStop(audioBufferRef.current.sampleCount);
        transcript = result.transcript;
      } else {
        let audio = recoveryAudioRef.current;
        if (!audio) {
          audio = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
          removeDcOffsetInPlace(audio);
          audio = await resampleAudioForTranscription(audio, recordingSampleRate(), TARGET_SAMPLE_RATE);
          assertOutputAllowed(recoverySessionId);
          recoveryAudioRef.current = audio;
        }
        assertOutputAllowed(recoverySessionId);
        transcript = await transcribeAudio(audio);
      }
      assertOutputAllowed(recoverySessionId);
      useStore.getState().setRawTranscript(transcript);
      setTranscript(transcript || "(no speech detected)");
      // Remove the completed action prompt, preserving capture/tail uncertainty.
      if (useStore.getState().captureNotice === LIVE_DELIVERY_PAUSED) {
        useStore.getState().setCaptureNotice(null);
      }
      retainRecovery(`Recovered locally${useNvidia ? " with the bundled NVIDIA model" : " with Whisper"}. Review any text already in the target, then copy the text you need. Nothing was inserted automatically.`, false);
      finalizeIdleState();
    } catch (error) {
      if (!isCurrentSession(recoverySessionId)) return;
      if (useNvidia && recoveryWaitRef.current !== attempt) return;
      retainRecovery(cancelledRef.current ?? `Recovery transcription failed: ${errorMessage(error)}`);
    } finally {
      if (recoveryWaitRef.current === attempt) recoveryWaitRef.current = null;
    }
  }

  function discardRecovery() {
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") return;
    if (recoverySessionIdRef.current) useStore.getState().dismissRecoverableTranscript(recoverySessionIdRef.current);
    const native = nativeCaptureRef.current;
    nativeCaptureRef.current = null;
    void native?.cancel().catch(() => {});
    recoveryWaitRef.current?.cancel();
    recoveryWaitRef.current = null;
    recoveryAudioRef.current = null;
    clearCapturedAudio();
    clearCanonicalAudioCache();
    canonicalSessionRef.current = null;
    useStore.getState().setRecovery(null);
    useStore.getState().setCaptureNotice(null);
    clearTranscript();
    cancelledRef.current = null;
    transitionCursorDelivery("session-reset");
    finalizeIdleState();
  }

  useEffect(() => {
    disposedRef.current = false;
    lifecycleEpochRef.current += 1;
    return () => {
      recordingRef.current?.dispose();
    };
  }, []);

  const toggle = useCallback((triggerId?: string, action?: DictationTriggerAction) => {
    if (!admitsDictationTrigger(sessionRef.current.phase, activeTriggerIdRef.current, triggerId, action)) {
      void traceDictationEvent(action === "start" ? "dictation_trigger_start_rejected" : "dictation_trigger_stop_rejected").catch(() => {});
      if (action === "start" && triggerId !== activeTriggerIdRef.current) releaseRecordingOrigin(triggerId);
      return false;
    }
    // Admission is authorization/phase validation, not proof capture or teardown completed.
    void traceDictationEvent(action === "start" ? "dictation_trigger_start_admitted" : action === "stop" ? "dictation_trigger_stop_admitted" : "dictation_trigger_toggle_admitted").catch(() => {});
    const toggleRequest = requestSessionToggle(sessionRef.current);
    sessionRef.current = toggleRequest.state;

    switch (toggleRequest.action) {
      case "start":
        void startRecording(triggerId);
        return phaseRef.current === "starting";
      case "stop":
        void stopRecording();
        return true;
      case "none":
        if (sessionRef.current.phase === "starting" && sessionRef.current.queuedAction === "stop") {
          setInterimTranscript("Stop requested. Waiting for microphone initialization to finish.");
        }
        return false;
    }
  }, []);

  const onHotkeyPressed = useCallback(() => {
    if (initialHotkeyPressLoggedRef.current) {
      return;
    }

    initialHotkeyPressLoggedRef.current = true;
    firstHotkeyPressMsRef.current = performance.now();
    console.info("Hotkey pressed: initial trigger.");
  }, []);

  return {
    initializeMicrophone,
    prepareAudioEngine,
    primeRecordingStream,
    cursorDeliveryState,
    canCancel,
    cancellationPending,
    cancelRecording,
    retryRecovery,
    discardRecovery,
    toggle,
    onHotkeyPressed,
  };
}
