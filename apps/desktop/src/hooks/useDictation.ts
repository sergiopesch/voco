import { useCallback, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  askOpenClawAgent,
  checkpointOwnedPreedit,
  debugDictationCaptureEnabled,
  finishCanonicalOwnedPreedit,
  getOwnedPreeditStatus,
  transcribeAudio,
  transcribeCanonicalChunk,
  previewTranscribeAudio,
  insertText,
  cancelOwnedPreedit,
  commitOwnedPreedit,
  showNotification,
  saveDebugDictationCapture,
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
import { planStableCursorFallback } from "@/lib/dictationFinalizer";
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
} from "@/lib/livePreviewWindow";
import {
  acknowledgeCanonicalDelivery,
  activateCanonicalDelivery,
  beginCanonicalTranscription,
  completeCanonicalTranscription,
  createCanonicalCursorSession,
  failCanonicalSession,
  failCanonicalTranscription,
  finishCanonicalSession,
  markCanonicalDeliveryUnavailable,
  markCanonicalDeliveryUncertain,
  planFinalCanonicalRange,
  planFinalSourceBlock,
  planNextCompleteCanonicalRange,
  planNextCompleteSourceBlock,
  recordCanonicalSourceBlock,
  requestCanonicalStop,
} from "@/lib/canonicalCursorSession";
import type {
  CanonicalCursorSession,
  CanonicalSourceBlock,
  CanonicalTranscriptionRange,
} from "@/lib/canonicalCursorSession";
import { usesCanonicalCursorStreaming } from "@/lib/dictationOutputPlan";
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
  CanonicalTranscription,
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

type DictationPhase = DictationStatus | "starting" | "stopping" | "finalizing";
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
  result: CanonicalTranscription;
}

export function useDictation() {
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
    return observeOwnedPreeditMutation(
      mutate,
      getOwnedPreeditStatus,
      observeOwnedPreeditStatus,
    );
  }

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletFlushResolverRef = useRef<(() => void) | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentSinkRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const primedStreamRef = useRef<MediaStream | null>(null);
  const primedStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const audioBufferRef = useRef(createAudioCaptureBuffer());
  const canonicalAudioBufferRef = useRef(createAudioCaptureBuffer());
  const canonicalSessionRef = useRef<CanonicalCursorSession | null>(null);
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
  const ownedPreeditSessionIdRef = useRef<number | null>(null);
  const ownedPreeditProgressiveRef = useRef(false);
  const ownedPreeditCommittedTextRef = useRef("");
  const lastLivePreviewTextRef = useRef("");
  const liveCursorCandidateTextRef = useRef("");
  const liveDraftConfirmedTextRef = useRef("");
  const liveCursorTextRef = useRef("");
  const livePreviewAudioStartSampleRef = useRef(0);
  const liveCursorInsertionDisabledRef = useRef(false);
  const liveCursorFallbackNotifiedRef = useRef(false);
  const livePreviewFailureNotifiedRef = useRef(false);
  const livePreviewNextDelayMsRef = useRef(LIVE_PREVIEW_MIN_INTERVAL_MS);
  const debugCaptureEnabledRef = useRef(false);
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
    return isCurrentCanonicalTargetOperation(operation, {
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
      workletModuleLoadedRef.current = true;
    },
    [],
  );

  const initializeMicrophone = useCallback(
    async (appStartMs: number) => {
      try {
        const deviceId = useStore.getState().selectedDeviceId;
        await probeMicrophoneAccess(deviceId);
        const audioContext = await ensureAudioContext();
        await ensureWorkletModuleLoaded(audioContext).catch(() => {});

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
        setStatus("error");
        setMicrophoneReadyState(false);
        showNotification(
          "Microphone not ready",
          "Press Alt+D to re-initialize microphone access.",
        ).catch(() => {});

        if (err instanceof DOMException) {
          if (err.name === "NotAllowedError") {
            setError(
              "Microphone access denied on startup. Press Alt+D to retry after granting permission.",
            );
          } else if (err.name === "NotFoundError") {
            setError("No microphone found. Connect one and press Alt+D to retry.");
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
    const audioContext = await ensureAudioContext();
    await ensureWorkletModuleLoaded(audioContext).catch(() => {});
  }, [ensureAudioContext, ensureWorkletModuleLoaded]);

  const openTracedMicrophoneStream = useCallback(async (deviceId: string | null) => {
    traceDictationEvent("recording_get_user_media_started").catch(() => {});
    const result = await openMicrophoneStreamWithDiagnostics(deviceId);
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
    return result.stream;
  }, []);

  const primeRecordingStream = useCallback(async () => {
    if (streamRef.current || primedStreamRef.current || primedStreamPromiseRef.current) {
      return;
    }

    const deviceId = useStore.getState().selectedDeviceId;
    const promise = openTracedMicrophoneStream(deviceId)
      .then((stream) => {
        primedStreamRef.current = stream;
        setMicrophoneReadyState(true);
        return stream;
      })
      .finally(() => {
        primedStreamPromiseRef.current = null;
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
    return usesCanonicalCursorStreaming(sessionConfigRef.current);
  }

  function beginOwnedPreedit(sessionId: number): Promise<boolean> | null {
    if (!shouldUseOwnedPreedit()) {
      return null;
    }

    ownedPreeditProgressiveRef.current = false;
    ownedPreeditCommittedTextRef.current = "";
    const startPromise = (async () => {
      try {
        const status = await mutateOwnedPreedit(() =>
          startOwnedPreedit(sessionId),
        );
        const sidecarSessionId = status.sessionId;
        if (sidecarSessionId === null || sidecarSessionId <= 0) {
          throw new Error("VOCO input method did not issue a session lease.");
        }
        if (
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
        const canonicalSession = canonicalSessionRef.current;
        if (canonicalSession?.sessionId === sessionId) {
          canonicalSessionRef.current = activateCanonicalDelivery(canonicalSession);
        }
        transitionCursorDelivery("ownership-established");
        traceDictationEvent("dictation_owned_preedit_started").catch(() => {});
        return true;
      } catch (error) {
        console.info("Owned cursor streaming unavailable; using VOCO preview only.");
        const canonicalSession = canonicalSessionRef.current;
        if (canonicalSession?.sessionId === sessionId) {
          canonicalSessionRef.current =
            markCanonicalDeliveryUnavailable(canonicalSession);
          transitionCursorDelivery("ownership-unavailable");
        }
        traceDictationEvent("dictation_owned_preedit_unavailable").catch(() => {});
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
    await waitForOwnedPreeditStart();
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
      const sampleRate = audioContextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;
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
      const previewSamples = usesAnchoredCursorWindow
        ? collectAudioSamplesRange(
            audioBufferRef.current,
            previewStartSample,
            Math.round(sampleRate * ANCHORED_LIVE_PREVIEW_MAX_SECONDS),
          )
        : collectRecentAudioSamples(
            audioBufferRef.current,
            Math.round(sampleRate * LIVE_PREVIEW_MAX_SECONDS),
          );
      if (previewSamples.length < sampleRate * LIVE_PREVIEW_MIN_SECONDS) {
        if (shouldUseFastLiveConfirmation()) {
          livePreviewNextDelayMsRef.current = LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
        }
        traceDictationEvent("dictation_live_preview_skipped_short_audio").catch(() => {});
        return;
      }

      let prepared = removeDcOffsetInPlace(previewSamples);
      if (Math.abs(sampleRate - TARGET_SAMPLE_RATE) > 1) {
        prepared = await resampleAudioBuffer(prepared, sampleRate, TARGET_SAMPLE_RATE);
      }

      const startedAt = performance.now();
      const preview = await previewTranscribeAudio(prepared);
      const durationMs = Math.round(performance.now() - startedAt);
      if (!isActivePreviewToken(sessionRef.current, token)) {
        return;
      }
      sessionRef.current = recordPreviewDuration(
        sessionRef.current,
        token,
        durationMs,
      );
      livePreviewNextDelayMsRef.current = nextLivePreviewDelay(
        durationMs,
        shouldUseFastLiveConfirmation(),
      );
      traceDictationEvent("dictation_live_preview_completed", {
        durationMs,
      }).catch(() => {});

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
          audioBufferRef.current.sampleCount,
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
    lastLivePreviewTextRef.current = "";
    liveCursorCandidateTextRef.current = "";
    liveDraftConfirmedTextRef.current = "";
  }

  async function clearLiveCursorText() {
    await waitForLiveCursorInsertion();
    if (ownedPreeditActiveRef.current || ownedPreeditStartPromiseRef.current) {
      await cancelOwnedPreeditSession().catch((error) => {
        console.warn("Failed to cancel owned cursor text:", error);
      });
    }
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
    await waitForLiveCursorInsertion();
    await waitForOwnedPreeditStart();
    if (ownedPreeditActiveRef.current) {
      const sessionId = ownedPreeditSessionIdRef.current;
      if (sessionId !== null) {
        try {
          const status = await mutateOwnedPreedit(() =>
            commitOwnedPreedit(sessionId, finalText),
          );
          const finalizationOutcome = status.finalizationOutcome;
          resetOwnedPreeditState();
          liveCursorTextRef.current = "";
          liveCursorCandidateTextRef.current = "";
          sessionRef.current = clearCommittedCursorText(sessionRef.current);
          if (
            finalizationOutcome !== "committed"
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
          const progressivelyCommittedText = ownedPreeditCommittedTextRef.current;
          const hadProgressiveCommit = ownedPreeditProgressiveRef.current;
          const cancellation = await mutateOwnedPreedit(() =>
            cancelOwnedPreedit(sessionId),
          ).catch(() => null);
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
            "Target left unchanged",
            "VOCO could not re-prove the original field, so it did not apply the final result to another target.",
          ).catch(() => {});
          return "unreconciled";
        }
      }
    }
    const hadCommittedTargetText = liveCursorTextRef.current.length > 0;
    const cursorTargetValid = !(
      liveCursorInsertionDisabledRef.current ||
      sessionRef.current.liveCursorInsertionDisabled
    );
    liveCursorTextRef.current = "";
    sessionRef.current = clearCommittedCursorText(sessionRef.current);

    const fallback = planStableCursorFallback(
      hadCommittedTargetText,
      cursorTargetValid,
    );
    if (fallback.status === "preserve-target") {
      traceDictationEvent("dictation_live_cursor_final_unreconciled").catch(() => {});
      showNotification(
        "Live text preserved",
        "VOCO kept the live text at the cursor and did not apply a differing final result to existing target text.",
      ).catch(() => {});
      return "unreconciled";
    }
    return "none";
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

  async function prepareCanonicalSourceBlock(
    block: CanonicalSourceBlock,
  ): Promise<void> {
    const state = canonicalSessionRef.current;
    if (!state) {
      throw new Error("canonical cursor session is unavailable");
    }
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
    if (!current || current.sessionId !== state.sessionId) {
      throw new Error("canonical cursor session changed during preprocessing");
    }
    const next = recordCanonicalSourceBlock(
      current,
      block,
      canonicalSamples.length,
    );
    appendAudioSamples(canonicalAudioBufferRef.current, canonicalSamples);
    canonicalSessionRef.current = next;
  }

  function collectCanonicalRange(
    range: CanonicalTranscriptionRange,
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
    if (state) {
      livePreviewAudioStartSampleRef.current = Math.min(
        state.processedSourceEndSample,
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
    if (!state.canonicalText.startsWith(state.acknowledgedTargetText)) {
      throw new Error("canonical target prefix is inconsistent");
    }

    const expectedCommittedText = state.acknowledgedTargetText;
    const appendText = state.canonicalText.slice(expectedCommittedText.length);
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
      const expectedCharacterCount = Array.from(state.canonicalText).length;
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
      ownedPreeditCommittedTextRef.current = state.canonicalText;
      liveCursorTextRef.current = state.canonicalText;
      traceDictationEvent("dictation_canonical_checkpoint_committed", {
        chunkCount: current.completedChunkCount,
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

  async function processCanonicalRange(
    range: CanonicalTranscriptionRange,
    deliverCheckpoint: boolean,
  ): Promise<void> {
    const initial = canonicalSessionRef.current;
    if (!initial) {
      throw new Error("canonical cursor session is unavailable");
    }
    canonicalSessionRef.current = beginCanonicalTranscription(initial, range);
    sessionRef.current = invalidateLivePreview(sessionRef.current);
    clearLivePreviewTimer();
    const previewInFlight = livePreviewInFlightRef.current;
    if (previewInFlight) {
      await previewInFlight.catch(() => {});
    }
    await waitForLiveCursorInsertion();

    const samples = collectCanonicalRange(range);
    const startedAt = performance.now();
    try {
      const current = canonicalSessionRef.current;
      if (!current || current.sessionId !== initial.sessionId) {
        throw new Error("canonical cursor session changed before transcription");
      }
      const result = await transcribeCanonicalChunk(
        samples,
        current.canonicalText,
      );
      const latest = canonicalSessionRef.current;
      if (!latest || latest.sessionId !== initial.sessionId) {
        throw new Error("canonical cursor session changed during transcription");
      }
      canonicalSessionRef.current = completeCanonicalTranscription(latest, result);
      debugCanonicalChunksRef.current.push({
        sequence: debugCanonicalChunksRef.current.length + 1,
        range,
        result,
      });
      if (range.complete) {
        traceDictationEvent("dictation_canonical_checkpoint_completed", {
          chunkCount: range.chunkIndex + 1,
          durationMs: Math.round(performance.now() - startedAt),
        }).catch(() => {});
      }
      if (deliverCheckpoint) {
        await deliverCanonicalCheckpoint(initial.sessionId);
      }
      resetCanonicalDraftAfterCheckpoint();
    } catch (error) {
      const current = canonicalSessionRef.current;
      if (current?.sessionId === initial.sessionId) {
        canonicalSessionRef.current = failCanonicalTranscription(current);
      }
      canonicalCheckpointDeferredRef.current = true;
      traceDictationEvent("dictation_canonical_checkpoint_failed", {
        chunkCount: range.chunkIndex + 1,
        durationMs: Math.round(performance.now() - startedAt),
      }).catch(() => {});
      throw error;
    }
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

    const pump = (async () => {
      try {
        while (phaseRef.current === "recording") {
          const state = canonicalSessionRef.current;
          if (!state) {
            return;
          }
          const pendingRange = planNextCompleteCanonicalRange(state);
          if (pendingRange) {
            await processCanonicalRange(pendingRange, true);
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
      if (!state) {
        throw new Error("canonical cursor session is unavailable");
      }
      const pendingRange = planNextCompleteCanonicalRange(state);
      if (pendingRange) {
        await processCanonicalRange(pendingRange, false);
        canonicalCheckpointDeferredRef.current = false;
        continue;
      }
      const sourceBlock = planNextCompleteSourceBlock(
        state,
        capturedSourceSampleCount,
      );
      if (!sourceBlock) {
        break;
      }
      await prepareCanonicalSourceBlock(sourceBlock);
    }

    let state = canonicalSessionRef.current;
    if (!state) {
      throw new Error("canonical cursor session is unavailable");
    }
    const finalSourceBlock = planFinalSourceBlock(
      state,
      capturedSourceSampleCount,
    );
    if (finalSourceBlock) {
      await prepareCanonicalSourceBlock(finalSourceBlock);
    }

    state = canonicalSessionRef.current;
    if (!state) {
      throw new Error("canonical cursor session is unavailable");
    }
    while (true) {
      const roundedCompleteRange = planNextCompleteCanonicalRange(state);
      if (!roundedCompleteRange) {
        break;
      }
      await processCanonicalRange(roundedCompleteRange, false);
      canonicalCheckpointDeferredRef.current = false;
      state = canonicalSessionRef.current;
      if (!state) {
        throw new Error("canonical cursor session is unavailable");
      }
    }
    const finalRange = planFinalCanonicalRange(state);
    if (finalRange) {
      await processCanonicalRange(finalRange, false);
      canonicalCheckpointDeferredRef.current = false;
    }

    state = canonicalSessionRef.current;
    if (!state) {
      throw new Error("canonical cursor session is unavailable");
    }
    canonicalSessionRef.current = finishCanonicalSession(
      state,
      capturedSourceSampleCount,
    );
    return {
      audio: drainAudioCaptureBuffer(canonicalAudioBufferRef.current),
      transcript: state.canonicalText,
    };
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
    if (!state.canonicalText.startsWith(state.acknowledgedTargetText)) {
      throw new Error("canonical final target prefix is inconsistent");
    }

    const expectedCommittedText = state.acknowledgedTargetText;
    const appendText = state.canonicalText.slice(expectedCommittedText.length);
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
      const expectedCharacterCount = Array.from(state.canonicalText).length;
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
        chunkCount: current.completedChunkCount,
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
        "Target left unchanged",
        "VOCO could not prove whether the original field accepted the final checkpoint, so it did not retry or type into another field.",
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
  ): Promise<void> {
    const { audio, transcript } = await transcribeCanonicalRemainderAtStop(
      capturedSourceSampleCount,
    );
    clearAudioCaptureBuffer(audioBufferRef.current);
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

    setTranscript(transcript.trim().length > 0 ? transcript : "(no speech detected)");
    phaseRef.current = "finalizing";
    sessionRef.current = markFinalizing(sessionRef.current);
    const finalization = await finishCanonicalTarget();
    if (finalization === "safe") {
      traceDictationEvent("dictation_final_output_completed").catch(() => {});
    } else {
      transitionCursorDelivery("ownership-uncertain");
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

  function appendRecordingSamples(samples: Float32Array): void {
    const sampleRate = audioContextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;
    const maxSamples = Math.round(sampleRate * MAX_AUDIO_SECONDS);
    const appendResult = appendAudioSamplesUpTo(
      audioBufferRef.current,
      samples,
      maxSamples,
    );
    pumpCanonicalCheckpoints();

    if (
      phaseRef.current === "recording" &&
      appendResult.reachedLimit
    ) {
      traceDictationEvent("dictation_recording_limit_reached", {
        durationMs: MAX_AUDIO_SECONDS * 1000,
      }).catch(() => {});
      void stopRecording();
    }
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
    try {
      await ensureWorkletModuleLoaded(audioContext);
      const createdWorklet = new AudioWorkletNode(
        audioContext,
        "audio-capture-processor",
      );
      worklet = createdWorklet;
      const sourceSessionId = sessionRef.current.sessionId;
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
        } else if (e.data.type === "flushed") {
          workletFlushResolverRef.current?.();
          workletFlushResolverRef.current = null;
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

  async function flushWorkletSamples() {
    const worklet = workletRef.current;
    if (!worklet) {
      return;
    }

    await new Promise<void>((resolve) => {
      let timeoutId: number | null = null;
      const finish = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        if (workletFlushResolverRef.current === finish) {
          workletFlushResolverRef.current = null;
        }
        resolve();
      };

      workletFlushResolverRef.current = finish;
      timeoutId = window.setTimeout(finish, 80);
      worklet.port.postMessage({ type: "flush" });
    });
  }

  async function teardownAudioGraph() {
    await flushWorkletSamples();

    if (workletRef.current) {
      const worklet = workletRef.current;
      workletRef.current = null;
      worklet.port.onmessage = null;
      worklet.port.close();
      worklet.disconnect();
    }
    if (processorRef.current) {
      const processor = processorRef.current;
      processorRef.current = null;
      processor.onaudioprocess = null;
      processor.disconnect();
    }
    if (silentSinkRef.current) {
      silentSinkRef.current.disconnect();
      silentSinkRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const sampleRate = audioContextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;

    return sampleRate;
  }

  function finalizeIdleState() {
    const stopRequestedAtMs = stopRequestedAtMsRef.current;
    if (stopRequestedAtMs !== null) {
      traceDictationEvent("dictation_stop_to_idle", {
        durationMs: Math.round(performance.now() - stopRequestedAtMs),
      }).catch(() => {});
      stopRequestedAtMsRef.current = null;
    }

    setInterimTranscript("");
    sessionRef.current = finishSessionIdle(sessionRef.current);
    phaseRef.current = "idle";
    setStatus("idle");
    transitionCursorDelivery("session-idle");
  }

  async function startRecording() {
    const phase = phaseRef.current;
    if (phase !== "idle" && phase !== "error") {
      return;
    }

    sessionRef.current = startSession(sessionRef.current);
    sessionConfigRef.current = useStore.getState().config;
    phaseRef.current = "starting";
    traceDictationEvent("recording_state_requested").catch(() => {});

    try {
      clearTranscript();
      setInterimTranscript("Listening...");
      setStatus("recording");
      resetAudioLevel();
      clearAudioCaptureBuffer(audioBufferRef.current);
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
      clearAudioCaptureBuffer(canonicalAudioBufferRef.current);
      canonicalSessionRef.current = null;
      canonicalCheckpointInFlightRef.current = null;
      canonicalCheckpointDeferredRef.current = false;
      resetOwnedPreeditState();
      transitionCursorDelivery("session-reset");
      const audioContext = await ensureAudioContext();
      if (usesCanonicalCursorStreaming(sessionConfigRef.current)) {
        transitionCursorDelivery("canonical-started");
        canonicalSessionRef.current = createCanonicalCursorSession(
          sessionRef.current.sessionId,
          audioContext.sampleRate,
        );
      }
      beginOwnedPreedit(sessionRef.current.sessionId);
      debugCaptureEnabledRef.current = await debugDictationCaptureEnabled().catch(
        () => false,
      );

      const deviceId = useStore.getState().selectedDeviceId;
      let stream = primedStreamRef.current;
      if (stream) {
        primedStreamRef.current = null;
      } else if (primedStreamPromiseRef.current) {
        stream = await primedStreamPromiseRef.current.catch(() => null);
        primedStreamRef.current = null;
      }
      if (!stream) {
        stream = await openTracedMicrophoneStream(deviceId);
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

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      traceDictationEvent("recording_media_source_created").catch(() => {});

      // Prefer AudioWorklet (off main thread), fall back to ScriptProcessorNode
      const workletOk = await connectWorklet(audioContext, source);
      if (!workletOk) {
        connectScriptProcessor(audioContext, source);
        traceDictationEvent("recording_script_processor_connected").catch(() => {});
      } else {
        traceDictationEvent("recording_worklet_connected").catch(() => {});
      }

      sessionRef.current = markRecording(sessionRef.current);
      phaseRef.current = "recording";
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
      await teardownAudioGraph();
      await clearLiveCursorText().catch(() => {});
      resetAudioLevel();
      setStatus("error");
      setMicrophoneReadyState(false);
      setInterimTranscript("");
      sessionRef.current = failSession(sessionRef.current);
      phaseRef.current = "error";
      showNotification(
        "Microphone initialization failed",
        "Press Alt+D to try microphone initialization again.",
      ).catch(() => {});

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError(
            "Microphone access denied. Check system permissions and press Alt+D to retry.",
          );
        } else if (err.name === "NotFoundError") {
          setError("No microphone found. Connect a microphone and press Alt+D.");
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

    phaseRef.current = "stopping";
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
      sampleRate = await teardownAudioGraph();
      resetAudioLevel();
      const checkpointInFlight = canonicalCheckpointInFlightRef.current;
      if (checkpointInFlight) {
        await checkpointInFlight.catch(() => {});
      }
      const previewInFlight = livePreviewInFlightRef.current;
      if (previewInFlight) {
        await previewInFlight.catch(() => {});
      }
      await waitForLiveCursorInsertion();

      if (canonicalSessionRef.current) {
        const capturedSourceSampleCount = audioBufferRef.current.sampleCount;
        if (capturedSourceSampleCount === 0) {
          clearAudioCaptureBuffer(canonicalAudioBufferRef.current);
          await clearLiveCursorText().catch(() => {});
          finalizeIdleState();
          return;
        }
        if (capturedSourceSampleCount < sampleRate * 0.3) {
          clearAudioCaptureBuffer(audioBufferRef.current);
          clearAudioCaptureBuffer(canonicalAudioBufferRef.current);
          await clearLiveCursorText().catch(() => {});
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
          );
        } catch (error) {
          const current = canonicalSessionRef.current;
          if (current) {
            canonicalSessionRef.current = failCanonicalSession(current);
          }
          transitionCursorDelivery("ownership-uncertain");
          clearAudioCaptureBuffer(audioBufferRef.current);
          clearAudioCaptureBuffer(canonicalAudioBufferRef.current);
          await clearLiveCursorText().catch(() => {});
          const detail = error instanceof Error ? error.message : String(error);
          phaseRef.current = "error";
          sessionRef.current = failSession(sessionRef.current);
          setStatus("error");
          setError(`Canonical transcription failed: ${detail}`);
          setInterimTranscript("");
          return;
        }
        return;
      }

      merged = drainAudioCaptureBuffer(audioBufferRef.current);

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
      resetAudioLevel();
      clearAudioCaptureBuffer(audioBufferRef.current);
      clearAudioCaptureBuffer(canonicalAudioBufferRef.current);
      await clearLiveCursorText().catch(() => {});
      const detail = err instanceof Error ? err.message : String(err);
      phaseRef.current = "error";
      sessionRef.current = failSession(sessionRef.current);
      setStatus("error");
      setError(`Audio processing failed: ${detail}`);
      setInterimTranscript("");
      return;
    }

    if (merged.length === 0) {
      await clearLiveCursorText().catch((error) => {
        console.warn("Failed to clear live cursor text after empty recording:", error);
      });
      finalizeIdleState();
      return;
    }

    // Skip very short recordings (< 0.3s)
    if (merged.length < TARGET_SAMPLE_RATE * 0.3) {
      await clearLiveCursorText().catch((error) => {
        console.warn("Failed to clear live cursor text after short recording:", error);
      });
      finalizeIdleState();
      return;
    }

    if (merged.length > TARGET_SAMPLE_RATE * MAX_AUDIO_SECONDS) {
      await clearLiveCursorText().catch(() => {});
      phaseRef.current = "error";
      sessionRef.current = failSession(sessionRef.current);
      setStatus("error");
      setError(
        `Recording too long. Please keep dictation under ${MAX_AUDIO_SECONDS} seconds.`,
      );
      setInterimTranscript("");
      return;
    }

    phaseRef.current = "processing";
    sessionRef.current = markProcessing(sessionRef.current);
    setInterimTranscript("Transcribing...");
    const transcribeStartedAt = performance.now();

    try {
      // Preview hypotheses are never authoritative. Always run the complete
      // recording through the final transcription path.
      const transcript = await transcribeAudio(merged);
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
        setTranscript("(no speech detected)");
        finalizeIdleState();
        return;
      }

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
      const strategy = config?.insertionStrategy ?? "auto";
      let textToInsert = transcriptForOutput;

      if (config?.transcriptTarget === "local-agent") {
        setInterimTranscript("Asking local model...");
        const localAssistantStartedAt = performance.now();
        try {
          const response = await askLocalAssistantForDictation(transcriptForOutput, config);
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
          const detail = err instanceof Error ? err.message : String(err);
          showNotification(
            "Local model request failed",
            detail || "VOCO could not complete the local model request.",
          ).catch(() => {});
          phaseRef.current = "error";
          sessionRef.current = failSession(sessionRef.current);
          setStatus("error");
          setError(`Local model request failed: ${detail}`);
          setInterimTranscript("");
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
          textToInsert = result.response;
          setTranscript(result.response);
          if (config.transcriptTarget === "openclaw-speech") {
            setInterimTranscript("Speaking OpenClaw's answer...");
            await speakOpenClawResponse(result.response);
            finalizeIdleState();
            return;
          }
          setInterimTranscript("Typing OpenClaw's answer at your cursor...");
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          showNotification(
            config?.transcriptTarget === "openclaw-speech"
              ? "OpenClaw speech failed"
              : "OpenClaw request failed",
            detail || "VOCO could not complete the OpenClaw request.",
          ).catch(() => {});
          phaseRef.current = "error";
          sessionRef.current = failSession(sessionRef.current);
          setStatus("error");
          setError(
            config?.transcriptTarget === "openclaw-speech"
              ? `OpenClaw speech failed: ${detail}`
              : `OpenClaw request failed: ${detail}`,
          );
          setInterimTranscript("");
          await clearLiveCursorText().catch((error) => {
            console.warn("Failed to clear live cursor text after OpenClaw error:", error);
          });
          return;
        }
      } else {
        setInterimTranscript("Typing at your cursor...");
      }

      // One-shot final insertion may need a brief focus handoff. An active
      // owned preedit stays attached to the original field and commits now.
      if (!ownedPreeditActiveRef.current) {
        await new Promise((r) => setTimeout(r, 250));
      }

      try {
        phaseRef.current = "finalizing";
        sessionRef.current = markFinalizing(sessionRef.current);
        const liveFinalization = await replaceLiveCursorTextWithFinal(textToInsert);
        if (liveFinalization === "safe") {
          console.info("[timing] owned cursor text finalized safely");
          traceDictationEvent("dictation_final_output_completed").catch(() => {});
        } else if (liveFinalization === "unreconciled") {
          transitionCursorDelivery("ownership-uncertain");
          console.info("[timing] authoritative final not applied after unsafe live reconciliation");
          traceDictationEvent("dictation_final_output_unreconciled").catch(() => {});
        } else {
          const insertion = await insertText(textToInsert, strategy);
          console.info(`[timing] insertion completed via ${insertion.strategy}`);
          traceDictationEvent("dictation_final_output_completed").catch(() => {});
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        traceDictationEvent("dictation_final_insertion_failed").catch(() => {});
        showNotification(
          "Text insertion failed",
          detail.includes("clipboard")
            ? detail
            : "VOCO could not insert text automatically. Please try again.",
        ).catch(() => {});
        phaseRef.current = "error";
        sessionRef.current = failSession(sessionRef.current);
        setStatus("error");
        setError(`Text insertion failed: ${detail}`);
        setInterimTranscript("");
        return;
      }

      finalizeIdleState();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await clearLiveCursorText().catch((error) => {
        console.warn("Failed to clear live cursor text after transcription failure:", error);
      });
      phaseRef.current = "error";
      sessionRef.current = failSession(sessionRef.current);
      setStatus("error");
      setError(`Transcription failed: ${detail} (${merged.length} samples)`);
      setInterimTranscript("");
    }
  }

  const toggle = useCallback(() => {
    const toggleRequest = requestSessionToggle(sessionRef.current);
    sessionRef.current = toggleRequest.state;

    switch (toggleRequest.action) {
      case "start":
        void startRecording();
        return;
      case "stop":
        void stopRecording();
        return;
      case "none":
        return;
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
    toggle,
    onHotkeyPressed,
  };
}
