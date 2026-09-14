import {BenchmarkPhraseQueue} from '../lib/benchmarkPhraseQueue';
import { DesktopPhraseSegmenter, DesktopPreviewCadence } from "@/lib/desktopPhraseStream";
import { createCaptureDescriptor, retainedSampleRate, type CaptureDescriptor, type CaptureSelection } from "@/lib/captureDescriptor";
import { beginNativeCapture, type NativeCaptureSession } from "@/lib/nativeCapture";
import { encodeNativeRetainedSource, type NativeCaptureTerminalOutcome } from "@/lib/nativeCaptureAudit";
import { AudioCaptureFlushError, CAPTURE_INPUT_INTERRUPTED, createAudioCaptureFlush } from "@/lib/audioCaptureFlush";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  askOpenClawAgent,
  checkpointOwnedPreedit,
  debugDictationCaptureEnabled,
  debugNativeCaptureEnabled,
  finishCanonicalOwnedPreedit,
  getOwnedPreeditStatus,
  getDesktopPasteStatus,
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
  speakOpenClawResponse,
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
  appendAudioSamplesUpTo,
  appendAudioSamples,
  collectAudioSamplesRange,
  collectRecentAudioSamples,
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
  consumeQueuedStop,
  createDictationSessionState,
  createPreviewToken,
  disableLiveCursorInsertion,
  disableLivePreview,
  failSession,
  finishSessionIdle,
  invalidateLivePreview,
  isActivePreviewToken,
  markFinalizing,
  markProcessing,
  markRecording,
  recordPreviewDuration,
  requestStop as requestSessionStop,
  requestToggle as requestSessionToggle,
  startSession,
} from "@/lib/dictationSession";
import type { DictationPreviewToken } from "@/lib/dictationSession";
import {
  askLocalAssistantForDictation,
  enhanceTranscriptForDictation,
} from "@/lib/localIntelligence";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import { captureSampleLimit, errorMessage, resumeCanonicalForRecovery } from "@/lib/dictationRecovery";
import { admitsDictationTrigger, type DictationTriggerAction } from "@/lib/dictationTrigger";
import {
  LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS,
  LIVE_PREVIEW_INITIAL_DELAY_MS,
  LIVE_PREVIEW_MIN_INTERVAL_MS,
  clampLivePreviewDelay,
  nextLivePreviewDelay,
  shouldUseFastLivePreviewConfirmation,
  withCursorAppendSeparator,
} from "@/lib/liveCommitPolicy";
import {
  reviseOwnedPreedit,
  previewGeometryWithinSnapshot,
  type PreviewAudioSnapshot,
} from "@/lib/livePreviewWindow";
import {
  acknowledgeCanonicalDelivery,
  activateCanonicalDelivery,
  beginCanonicalTranscription,
  completeCanonicalTranscriptionWithResponse,
  createCanonicalCursorSession,
  failCanonicalSession,
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
  requestCanonicalStop,
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

const TARGET_SAMPLE_RATE = 16000;
const MAX_AUDIO_SECONDS = 600;
// Owned preedit can safely revise an early hypothesis, so the first preview
// does not need to wait for a full second of audio.
const LIVE_PREVIEW_MIN_SECONDS = 0.7;
const LIVE_PREVIEW_MAX_SECONDS = 6;
const ANCHORED_LIVE_PREVIEW_MAX_SECONDS = 20;
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
  const desktopPhraseSegmenterRef = useRef<DesktopPhraseSegmenter | null>(null);
  const desktopPhraseEndRef = useRef(0);
  const desktopPreviewCadenceRef = useRef<DesktopPreviewCadence | null>(null);
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

  function clearLivePreviewTimer() {
    if (livePreviewTimeoutRef.current !== null) {
      window.clearTimeout(livePreviewTimeoutRef.current);
      livePreviewTimeoutRef.current = null;
    }
  }

  function scheduleLivePreview(delayMs = livePreviewNextDelayMsRef.current) {
    clearLivePreviewTimer();
    if (canonicalCheckpointInFlightRef.current) {
      return;
    }
    const token = createPreviewToken(sessionRef.current);
    const safeDelayMs = clampLivePreviewDelay(
      delayMs,
      shouldUseFastLiveConfirmation(),
    );
    livePreviewTimeoutRef.current = window.setTimeout(() => {
      livePreviewTimeoutRef.current = null;
      void runLivePreview(token);
    }, safeDelayMs);
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
    if (
      !isActivePreviewToken(sessionRef.current, token) ||
      !shouldRunLivePreview()
    ) {
      return;
    }

    if (livePreviewInFlightRef.current) {
      scheduleLivePreview(
        shouldUseFastLiveConfirmation()
          ? LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS
          : LIVE_PREVIEW_MIN_INTERVAL_MS,
      );
      return;
    }

    const previewPromise: Promise<void> = (async () => {
      const sampleRate = recordingSampleRate();
      const usesAnchoredCursorWindow = usesCanonicalCursorStreaming(
        sessionConfigRef.current,
      );
      const previewStartSample = usesAnchoredCursorWindow
        ? Math.min(
            livePreviewAudioStartSampleRef.current,
            audioBufferRef.current.sampleCount,
          )
        : Math.max(
            0,
            audioBufferRef.current.sampleCount -
              Math.round(sampleRate * LIVE_PREVIEW_MAX_SECONDS),
          );
      const maximumSamples = Math.round(sampleRate * (usesAnchoredCursorWindow
        ? ANCHORED_LIVE_PREVIEW_MAX_SECONDS : LIVE_PREVIEW_MAX_SECONDS));
      const previewEndSample = Math.min(audioBufferRef.current.sampleCount, previewStartSample + maximumSamples);
      const sourceSampleCount = previewEndSample - previewStartSample;
      if (sourceSampleCount < sampleRate * LIVE_PREVIEW_MIN_SECONDS) {
        if (shouldUseFastLiveConfirmation()) {
          livePreviewNextDelayMsRef.current = LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
        }
        traceDictationEvent("dictation_live_preview_skipped_short_audio").catch(() => {});
        return;
      }

      const key = `${token.sessionId}:${token.generation}:${sampleRate}:${previewStartSample}:${previewEndSample}`;
      const cached = livePreviewCacheRef.current?.key === key ? livePreviewCacheRef.current : null;
      let preview: PreviewTranscription | null;
      let preparedSampleCount: number;
      if (cached) {
        preview = cached.preview;
        preparedSampleCount = cached.preparedSampleCount;
        // Replay normal confirmation/geometry checks, without another native
        // decode or a fabricated zero-duration recognition measurement.
        traceDictationEvent("dictation_live_preview_reused").catch(() => {});
      } else {
        const previewSamples = usesAnchoredCursorWindow
          ? collectAudioSamplesRange(audioBufferRef.current, previewStartSample, maximumSamples)
          : collectRecentAudioSamples(audioBufferRef.current, maximumSamples);
        let prepared = removeDcOffsetInPlace(previewSamples);
        if (Math.abs(sampleRate - TARGET_SAMPLE_RATE) > 1) {
          prepared = await resampleAudioBuffer(prepared, sampleRate, TARGET_SAMPLE_RATE);
        }
        if (!isActivePreviewToken(sessionRef.current, token)) return;
        preparedSampleCount = prepared.length;
        const startedAt = performance.now();
        preview = await previewTranscribeAudio(prepared);
        const durationMs = Math.round(performance.now() - startedAt);
        if (!isActivePreviewToken(sessionRef.current, token)) return;
        sessionRef.current = recordPreviewDuration(sessionRef.current, token, durationMs);
        livePreviewNextDelayMsRef.current = nextLivePreviewDelay(durationMs, shouldUseFastLiveConfirmation());
        traceDictationEvent("dictation_live_preview_completed", { durationMs }).catch(() => {});
        // Null also means busy/unavailable at the native boundary. It must be
        // retried, not cached as proof of silent audio.
        livePreviewCacheRef.current = preview?.text.trim()
          ? { key, preview, preparedSampleCount } : null;
      }

      const normalizedPreview = preview?.text.trim() ?? "";
      if (normalizedPreview.length === 0) {
        if (shouldUseFastLiveConfirmation()) {
          livePreviewNextDelayMsRef.current = LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
        }
        traceDictationEvent("dictation_live_preview_empty").catch(() => {});
        return;
      }

      if (isActivePreviewToken(sessionRef.current, token) && preview) {
        const previewChanged = normalizedPreview !== lastLivePreviewTextRef.current;
        lastLivePreviewTextRef.current = normalizedPreview;
        if (previewChanged) {
          setInterimTranscript(normalizedPreview);
        }
        await updateLiveCursorText(
          normalizedPreview,
          preview,
          sampleRate,
          previewStartSample,
          previewEndSample,
          {
            preparedSampleCount,
            sourceSampleCount,
            sourceSampleRate: sampleRate,
          },
        );
        if (debugCaptureEnabledRef.current) {
          debugPreviewFramesRef.current.push({
            sequence: debugPreviewFramesRef.current.length + 1,
            sourceSampleRate: sampleRate,
            capturedSampleCount: audioBufferRef.current.sampleCount,
            previewStartSample,
            preview,
            stateAfter: {
              candidateText: liveCursorCandidateTextRef.current,
              committedWindowText: "",
              committedCursorText: ownedPreeditProgressiveRef.current
                ? ownedPreeditCommittedTextRef.current
                : liveCursorTextRef.current,
              nextPreviewStartSample: livePreviewAudioStartSampleRef.current,
              blockedCommitCount: 0,
              cursorInsertionDisabled:
                liveCursorInsertionDisabledRef.current ||
                sessionRef.current.liveCursorInsertionDisabled,
            },
          });
        }
        traceDictationEvent(
          previewChanged
            ? "dictation_live_preview_updated"
            : "dictation_live_preview_confirmed",
        ).catch(() => {});
      }
    })()
      .catch((error) => {
        console.warn("Live dictation preview failed:", error);
        if (isActivePreviewToken(sessionRef.current, token)) {
          sessionRef.current = disableLivePreview(sessionRef.current);
          liveCursorInsertionDisabledRef.current = true;
          traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
          if (!livePreviewFailureNotifiedRef.current) {
            livePreviewFailureNotifiedRef.current = true;
            setInterimTranscript(
              "Live preview paused. Final insertion will still run when you stop dictation.",
            );
            showNotification(
              "Live preview paused",
              "VOCO could not produce a live preview. Final insertion will still run when you stop dictation.",
            ).catch(() => {});
          }
        }
        traceDictationEvent("dictation_live_preview_failed").catch(() => {});
      })
      .finally(() => {
        if (livePreviewInFlightRef.current === previewPromise) {
          livePreviewInFlightRef.current = null;
        }
        if (
          isActivePreviewToken(sessionRef.current, token)
        ) {
          scheduleLivePreview();
        }
      });

    livePreviewInFlightRef.current = previewPromise;
    await previewPromise;
  }

  async function updateLiveCursorText(
    nextText: string,
    preview: PreviewTranscription,
    sampleRate: number,
    previewStartSample: number,
    previewEndSample: number,
    snapshot: PreviewAudioSnapshot,
  ) {
    const config = sessionConfigRef.current;
    if (
      !usesCanonicalCursorStreaming(config) ||
      sessionRef.current.liveCursorInsertionDisabled ||
      liveCursorInsertionDisabledRef.current
    ) {
      return;
    }

    const previousCandidate = liveCursorCandidateTextRef.current;
    liveCursorCandidateTextRef.current = nextText;

    const ownedPreeditActive = await waitForOwnedPreeditStart();
    if (phaseRef.current !== "recording") {
      return;
    }
    if (
      ownedPreeditActive &&
      ownedPreeditActiveRef.current
    ) {
      const revision = reviseOwnedPreedit(
        liveDraftConfirmedTextRef.current,
        previousCandidate,
        nextText,
        preview,
        previewGeometryWithinSnapshot(preview, snapshot),
      );
      liveDraftConfirmedTextRef.current = revision.confirmedText;
      liveCursorCandidateTextRef.current = revision.candidateText;
      if (revision.advanceDurationMs > 0) {
        livePreviewAudioStartSampleRef.current = Math.min(
          previewStartSample +
            Math.max(
              1,
              Math.round((revision.advanceDurationMs / 1000) * sampleRate),
            ),
          previewEndSample,
        );
        traceDictationEvent("dictation_live_preview_window_advanced", {
          chunkCount: revision.advancedSegmentCount,
          durationMs: revision.advanceDurationMs,
        }).catch(() => {});
      }

      const confirmedText = ownedPreeditCommittedTextRef.current;
      const preeditText = withCursorAppendSeparator(
        confirmedText,
        revision.provisionalText,
      );
      await publishOwnedPreedit(
        confirmedText,
        preeditText,
        confirmedText + preeditText,
        nextText,
      );
      return;
    }

    sessionRef.current = disableLiveCursorInsertion(sessionRef.current);
    liveCursorInsertionDisabledRef.current = true;
    transitionCursorDelivery("ownership-unavailable");
    setInterimTranscript(nextText);
    traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
    if (!liveCursorFallbackNotifiedRef.current) {
      liveCursorFallbackNotifiedRef.current = true;
      showNotification(
        "Live cursor streaming unavailable",
        "VOCO cannot prove ownership of this target, so it will not type a later result into another field.",
      ).catch(() => {});
    }
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
    clearLivePreviewTimer();
    livePreviewCacheRef.current = null;
    lastLivePreviewTextRef.current = "";
    liveCursorCandidateTextRef.current = "";
    liveDraftConfirmedTextRef.current = "";
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
    if (
      canonicalCheckpointInFlightRef.current ||
      canonicalCheckpointDeferredRef.current ||
      phaseRef.current !== "recording" ||
      !canonicalSessionRef.current
    ) {
      return;
    }

    // Sample arrivals without canonical work must not postpone a pending preview.
    // Keep planner errors in the existing asynchronous deferred-checkpoint path.
    try {
      if (
        !planCanonicalWork(canonicalSessionRef.current, false) &&
        !planNextCompleteSourceBlock(
          canonicalSessionRef.current,
          audioBufferRef.current.sampleCount,
        )
      ) {
        return;
      }
    } catch {
      // The unchanged pump below handles invalid state and reports the failure.
    }

    const pumpSessionId = sessionRef.current.sessionId;
    const pump = (async () => {
      try {
        while (phaseRef.current === "recording" && isCurrentSession(pumpSessionId)) {
          const state = canonicalSessionRef.current;
          if (!state) {
            return;
          }
          const work = planCanonicalWork(state, false);
          if (work) {
            await processCanonicalWork(work, true);
            continue;
          }
          const sourceBlock = planNextCompleteSourceBlock(
            state,
            audioBufferRef.current.sampleCount,
          );
          if (!sourceBlock) {
            return;
          }
          await prepareCanonicalSourceBlock(sourceBlock);
        }
      } catch (error) {
        if (!isCurrentSession(pumpSessionId)) return;
        if (!canonicalCheckpointDeferredRef.current) {
          traceDictationEvent("dictation_canonical_checkpoint_failed").catch(
            () => {},
          );
        }
        canonicalCheckpointDeferredRef.current = true;
        console.warn("Canonical cursor checkpoint deferred until stop:", error);
      }
    })().finally(() => {
      if (canonicalCheckpointInFlightRef.current === pump) {
        canonicalCheckpointInFlightRef.current = null;
      }
      if (phaseRef.current === "recording" && shouldRunLivePreview()) {
        scheduleLivePreview();
      }
    });
    canonicalCheckpointInFlightRef.current = pump;
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
    livePreviewCacheRef.current = null;
    clearAudioCaptureBuffer(audioBufferRef.current);
    captureDescriptorRef.current = null;
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

  function enqueueDesktopPhrase(end: number) {
    const start = desktopPhraseEndRef.current;
    if (end <= start || !desktopPhraseQueueRef.current) return;
    desktopPhraseEndRef.current = end;
    desktopPhraseQueueRef.current.enqueue(collectAudioSamplesRange(audioBufferRef.current, start, end - start));
    desktopPreviewCadenceRef.current?.reset(end);
    traceDictationEvent("dictation_desktop_phrase_queued", { durationMs: Math.round((end - start) / recordingSampleRate() * 1000) }).catch(() => {});
  }

  function appendRecordingSamples(samples: Float32Array): number {
    const sampleRate = recordingSampleRate();
    captureHealthRef.current?.samplesReceived();
    const maxSamples = captureSampleLimit(sampleRate, MAX_AUDIO_SECONDS);
    const appendResult = appendAudioSamplesUpTo(
      audioBufferRef.current,
      samples,
      maxSamples,
    );
    pumpCanonicalCheckpoints();
    if (desktopPhraseSegmenterRef.current && phaseRef.current === "recording") {
      const accepted = samples.subarray(0, appendResult.appendedSampleCount);
      desktopPhraseQueueRef.current?.pushAudio(accepted, sampleRate);
    }

    if (
      phaseRef.current === "recording" &&
      appendResult.reachedLimit
    ) {
      traceDictationEvent("dictation_recording_limit_reached", {
        durationMs: MAX_AUDIO_SECONDS * 1000,
      }).catch(() => {});
      void stopRecording();
    }
    return appendResult.appendedSampleCount;
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
    const rate = recordingSampleRate();
    const native = nativeCaptureRef.current;
    if (native) {
      try { await native.stopAndDrain(); }
      catch {
        persistNativeRetainedSource(native, "interrupted");
        throw new AudioCaptureFlushError();
      }
      persistNativeRetainedSource(native, cancelledRef.current ? "cancelled" : "healthy-stop");
      return rate;
    }
    captureHealthRef.current?.dispose();
    captureHealthRef.current = null;
    try {
      await flushCaptureSamples();
    } finally {
      disconnectAudioGraph();
    }
    return rate;
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

  function finalizeIdleState() {
    if (disposedRef.current) return;
    const completed = useStore.getState();
    if (!completed.recovery && completed.transcript.trim() && completed.transcript !== "(no speech detected)") {
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
    activeTriggerIdRef.current = triggerId;
    desktopPasteSessionRef.current = false;
    desktopStreamEnabledRef.current = false;
    desktopTargetTokenRef.current = null;
    desktopPhraseQueueRef.current?.cancel();
    desktopPhraseQueueRef.current = null;
    desktopPhraseSegmenterRef.current = null;
    desktopPhraseEndRef.current = 0;
    desktopPreviewCadenceRef.current = null;
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
    phaseRef.current = "starting";
    traceDictationEvent("recording_state_requested").catch(() => {});
    let nativeAttempt: { generation: number; selectionToken: string } | null = null;
    const invalidateNativeSelection = () => {
      if (!nativeAttempt || !isCurrentSession(startingSessionId) ||
          captureGenerationRef.current !== nativeAttempt.generation) return;
      const state = useStore.getState();
      if (state.captureBackendMode === "native" &&
          state.nativeCaptureSource?.selectionToken === nativeAttempt.selectionToken) {
        state.setNativeCaptureSource(null);
      }
    };

    try {
      if (!triggerId?.startsWith("browser:") && sessionConfigRef.current?.transcriptTarget === "cursor") {
        const paste = await getDesktopPasteStatus();
        assertOutputAllowed(startingSessionId);
        if (paste?.enabled) {
          if (!paste.available) {
            traceDictationEvent("dictation_desktop_paste_unavailable").catch(() => {});
            throw new Error(paste.detail);
          }
          desktopPasteSessionRef.current = true;
          desktopTargetTokenRef.current = paste.targetToken ?? null;
          desktopStreamEnabledRef.current = Boolean(paste.streamingEnabled) && sessionConfigRef.current?.transcriptEnhancement === "off";
          manualCopyRequestedRef.current = false;
          // The desktop queue owns append-only streaming. Disable the separate
          // owned-preedit preview scheduler for this delivery session.
          sessionConfigRef.current = { ...sessionConfigRef.current, liveCursorMode: "final-text-only" };
          traceDictationEvent("dictation_desktop_paste_session_started").catch(() => {});
        }
      }
      const captureSelection = captureSelectionRef.current?.() ?? { backend: "webkit" as const };
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
      beginOwnedPreedit(sessionRef.current.sessionId, triggerId);
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
      if (desktopStreamEnabledRef.current) {
        const rate = recordingSampleRate();
        desktopPhraseSegmenterRef.current = new DesktopPhraseSegmenter(rate);
        desktopPreviewCadenceRef.current = new DesktopPreviewCadence(rate);
        desktopPhraseQueueRef.current = new BenchmarkPhraseQueue(async (audio, role) => {
          assertOutputAllowed(startingSessionId);
          if (audio.length < rate * 0.3 || audio.every(sample => Math.abs(sample) < 0.000001)) return "";
          removeDcOffsetInPlace(audio);
          const prepared = Math.abs(rate - TARGET_SAMPLE_RATE) > 1
            ? await resampleAudioForTranscription(audio, rate, TARGET_SAMPLE_RATE) : audio;
          assertOutputAllowed(startingSessionId);
          const started = performance.now();
          const text = role === "preview"
            ? (await previewTranscribeAudio(prepared, true))?.text ?? ""
            : await transcribeAudio(prepared);
          assertOutputAllowed(startingSessionId);
          traceDictationEvent(role === "preview" ? "dictation_desktop_preview_transcribed" : "dictation_desktop_phrase_transcribed", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
          return text;
        }, async (text) => {
          assertOutputAllowed(startingSessionId);
          const started = performance.now();
          desktopPhrasePasteCountRef.current++;
          traceDictationEvent("dictation_desktop_paste_requested").catch(() => {});
          const result = await pasteDesktopText(text, desktopTargetTokenRef.current);
          if (result.outcome !== "dispatched") throw new Error("Desktop phrase paste was not acknowledged.");
          traceDesktopPasteMetrics(result);
          traceDictationEvent("dictation_desktop_paste_dispatched", { durationMs: Math.round(performance.now() - started) }).catch(() => {});
          if (desktopPhrasePasteCountRef.current === 1 && recordingStartedAtMsRef.current !== null) {
            traceDictationEvent("dictation_desktop_first_phrase_dispatched", { durationMs: Math.round(performance.now() - recordingStartedAtMsRef.current) }).catch(() => {});
          }
        }, (text) => {
          if (!isCurrentSession(startingSessionId)) return;
          setTranscript(text);
          useStore.getState().setRawTranscript(text);
        }, () => {
          if (!isCurrentSession(startingSessionId) || cancelledRef.current) return;
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          useStore.getState().setCaptureNotice("Live delivery paused. Stop recording to recover your transcript; review the target before pasting again.");
        }, (event, durationMs) => {
          if (event === "appended") desktopPreviewCadenceRef.current?.settleStartup();
          const name = event === "appended" ? "dictation_desktop_live_prefix_dispatched"
            : `dictation_desktop_snapshot_${event}`;
          traceDictationEvent(name, durationMs === undefined ? null : { durationMs }).catch(() => {});
        }, startingSessionId);
        // Audio can arrive while the worklet is starting. Keep planner offsets
        // aligned with the complete retained source, including that prefix.
        const prefix = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
        desktopPhraseQueueRef.current.pushAudio(prefix, rate);
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
        "Microphone initialization failed",
        "Use your recording shortcut to try microphone initialization again.",
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
        setError(`Failed to start recording: ${err}`);
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
          desktopPhraseSegmenterRef.current = null;
          desktopPhraseQueueRef.current = null;
          finalizeIdleState();
        } catch (error) {
          traceDictationEvent("dictation_desktop_stream_failed").catch(() => {});
          retainRecovery(cancelledRef.current ?? `Progressive delivery stopped: ${errorMessage(error)}. Review the target before copying retained text.`);
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
        const pendingCapture: PendingDebugCapture = {
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
      const config = sessionConfigRef.current;
      let transcriptForOutput = transcript;
      if (config?.transcriptEnhancement && config.transcriptEnhancement !== "off") {
        setInterimTranscript(
          config.transcriptEnhancement === "commands-only"
            ? "Applying voice commands..."
            : "Polishing transcript locally...",
        );
        const enhancementStartedAt = performance.now();
        const enhancement = await enhanceTranscriptForDictation(transcript, config);
        assertOutputAllowed(stoppingSessionId);
        transcriptForOutput = enhancement.text;
        const enhancementDurationMs = Math.round(
          performance.now() - enhancementStartedAt,
        );
        console.info(
          `[timing] transcript enhancement completed: ${enhancementDurationMs}ms`,
        );
        traceDictationEvent("dictation_enhancement_completed", {
          durationMs: enhancementDurationMs,
        }).catch(() => {});
        if (enhancement.warning) {
          console.warn("Transcript enhancement skipped:", enhancement.warning);
        }
      }

      setTranscript(transcriptForOutput);
      if (!transcriptForOutput.trim()) {
        await clearLiveCursorText().catch(() => {});
        finalizeIdleState();
        return;
      }
      let textToInsert = transcriptForOutput;

      if (config?.transcriptTarget === "local-agent") {
        setInterimTranscript("Asking local model...");
        const localAssistantStartedAt = performance.now();
        try {
          const response = await askLocalAssistantForDictation(transcriptForOutput, config);
          assertOutputAllowed(stoppingSessionId);
          const localAssistantDurationMs = Math.round(
            performance.now() - localAssistantStartedAt,
          );
          console.info(
            `[timing] local assistant completed: ${localAssistantDurationMs}ms`,
          );
          traceDictationEvent("dictation_local_assistant_completed", {
            durationMs: localAssistantDurationMs,
          }).catch(() => {});
          textToInsert = response;
          setTranscript(response);
          setInterimTranscript("Typing local model answer at your cursor...");
        } catch (err) {
          if (!isCurrentSession(stoppingSessionId)) return;
          const detail = err instanceof Error ? err.message : String(err);
          showNotification(
            "Local model request failed",
            detail || "VOCO could not complete the local model request.",
          ).catch(() => {});
          phaseRef.current = "error";
          sessionRef.current = failSession(sessionRef.current);
          retainCurrentTranscript("output-failed");
          setStatus("error");
          retainRecovery(cancelledRef.current ?? `Local model request failed: ${detail}`, false);
          await clearLiveCursorText().catch((error) => {
            console.warn("Failed to clear live cursor text after local model error:", error);
          });
          return;
        }
      } else if (
        config?.transcriptTarget === "openclaw-agent" ||
        config?.transcriptTarget === "openclaw-speech"
      ) {
        setInterimTranscript("Asking OpenClaw...");
        try {
          const result = await askOpenClawAgent(
            transcriptForOutput,
            config.openclawAgent,
            config.openclawPromptPrefix,
          );
          assertOutputAllowed(stoppingSessionId);
          textToInsert = result.response;
          setTranscript(result.response);
          if (config.transcriptTarget === "openclaw-speech") {
            setInterimTranscript("Speaking OpenClaw's answer...");
            assertOutputAllowed(stoppingSessionId);
            setCanCancel(false);
            await speakOpenClawResponse(result.response);
            if (!isCurrentSession(stoppingSessionId)) return;
            finalizeIdleState();
            return;
          }
          setInterimTranscript("Typing OpenClaw's answer at your cursor...");
        } catch (err) {
          if (!isCurrentSession(stoppingSessionId)) return;
          const detail = err instanceof Error ? err.message : String(err);
          showNotification(
            config?.transcriptTarget === "openclaw-speech"
              ? "OpenClaw speech failed"
              : "OpenClaw request failed",
            detail || "VOCO could not complete the OpenClaw request.",
          ).catch(() => {});
          phaseRef.current = "error";
          sessionRef.current = failSession(sessionRef.current);
          retainCurrentTranscript("output-failed");
          setStatus("error");
          setError(
            config?.transcriptTarget === "openclaw-speech"
              ? `OpenClaw speech failed: ${detail}`
              : `OpenClaw request failed: ${detail}`,
          );
          retainRecovery(cancelledRef.current ?? `OpenClaw output failed: ${detail}`, false);
          await clearLiveCursorText().catch((error) => {
            console.warn("Failed to clear live cursor text after OpenClaw error:", error);
          });
          return;
        }
      } else {
        setInterimTranscript("Typing at your cursor...");
      }

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

  function isCurrentSession(sessionId: number): boolean {
    return !disposedRef.current && sessionRef.current.sessionId === sessionId;
  }

  function assertOutputAllowed(sessionId = sessionRef.current.sessionId) {
    if (!isCurrentSession(sessionId)) {
      throw new Error("Recording session is no longer active.");
    }
    if (cancelledRef.current) throw new Error(cancelledRef.current);
  }

  function retainRecovery(reason: string, keepAudio = true) {
    if (disposedRef.current) return;
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
    useStore.getState().setSurface("popover");
  }

  function releaseRecordingOrigin(triggerId = activeTriggerIdRef.current) {
    if (!triggerId?.startsWith("browser:")) return;
    if (activeTriggerIdRef.current === triggerId) activeTriggerIdRef.current = undefined;
    void releaseBrowserRecording(triggerId).catch(() => {});
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

  async function cancelRecording(reason = "Recording cancelled. Captured audio remains in memory until you retry or discard it.") {
    const recoveryWait = recoveryWaitRef.current;
    if (recoveryWait) {
      recoveryWaitRef.current = null;
      recoveryWait.cancel();
      retainRecovery("Recovery waiting cancelled. Audio remains available to retry or discard. The previous local operation may still be finishing.");
      return;
    }
    if (phaseRef.current === "idle" || phaseRef.current === "error" || phaseRef.current === "finalizing" || cancelledRef.current) return;
    cancelledRef.current = reason;
    desktopPhraseQueueRef.current?.cancel();
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
    // Cancelling this attempt never cancels native work. Every subsequent Retry
    // still waits for the same pending operations before reopening output.
    let cancelWait: () => void = () => {};
    const cancelled = new Promise<false>((resolve) => { cancelWait = () => resolve(false); });
    const attempt = { cancel: cancelWait };
    recoveryWaitRef.current = attempt;
    const settled = Promise.all([
      canonicalCheckpointInFlightRef.current?.catch(() => {}),
      livePreviewInFlightRef.current?.catch(() => {}),
      waitForLiveCursorInsertion(),
    ]).then(() => true);
    const ready = await Promise.race([settled, cancelled]);
    if (!ready || recoveryWaitRef.current !== attempt || !isCurrentSession(recoverySessionId)) return;
    recoveryWaitRef.current = null;
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
      if (canonicalSessionRef.current) {
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
      retainRecovery("Recovered locally. Review any text already in the target, then copy the text you need. Nothing was inserted automatically.", false);
      finalizeIdleState();
    } catch (error) {
      if (!isCurrentSession(recoverySessionId)) return;
      retainRecovery(cancelledRef.current ?? `Recovery transcription failed: ${errorMessage(error)}`);
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
      disposedRef.current = true;
      desktopPhraseQueueRef.current?.cancel();
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
