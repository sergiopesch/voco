import { useCallback, useRef } from "react";
import { useStore } from "@/store/useStore";
import {
  askOpenClawAgent,
  transcribeAudio,
  previewTranscribeAudio,
  insertText,
  appendLiveText,
  setDictationStatus,
  setMicrophoneReady,
  showNotification,
  speakOpenClawResponse,
  traceHotkeyEvent,
} from "@/lib/tauri";
import type { HotkeyTraceFields } from "@/lib/tauri";
import {
  calculateVisualAudioLevelFromSamples,
  removeDcOffsetInPlace,
} from "@/lib/audioLevel";
import {
  appendAudioSamples,
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
  addCommittedCursorText,
  clearCommittedCursorText,
  consumeQueuedStop,
  createDictationSessionState,
  createPreviewToken,
  disableLiveCursorInsertion,
  disableLivePreview,
  failSession,
  finishSessionIdle,
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
import { planLiveFinalCursorAction } from "@/lib/dictationFinalizer";
import {
  LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS,
  LIVE_PREVIEW_INITIAL_DELAY_MS,
  LIVE_PREVIEW_MIN_INTERVAL_MS,
  clampLivePreviewDelay,
  liveCursorCommitDecision,
  nextLiveCursorFallbackDecision,
  nextLivePreviewDelay,
  shouldUseFastLivePreviewConfirmation,
} from "@/lib/liveCommitPolicy";
import type { DictationStatus } from "@/types";

const TARGET_SAMPLE_RATE = 16000;
const MAX_AUDIO_SECONDS = 600;
const LIVE_PREVIEW_MIN_SECONDS = 1;
const LIVE_PREVIEW_MAX_SECONDS = 6;
const AUDIO_LEVEL_ATTACK = 0.68;
const AUDIO_LEVEL_RELEASE = 0.24;
const AUDIO_LEVEL_FLOOR = 0.01;

type DictationPhase = DictationStatus | "starting" | "stopping" | "finalizing";
type LiveFinalizationResult = "none" | "safe" | "unreconciled";

export function useDictation() {
  const setStatus = useStore((state) => state.setStatus);
  const setTranscript = useStore((state) => state.setTranscript);
  const setInterimTranscript = useStore((state) => state.setInterimTranscript);
  const setError = useStore((state) => state.setError);
  const setAudioLevel = useStore((state) => state.setAudioLevel);
  const clearTranscript = useStore((state) => state.clearTranscript);

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
  const sessionRef = useRef(createDictationSessionState());
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
  const lastLivePreviewTextRef = useRef("");
  const liveCursorCandidateTextRef = useRef("");
  const liveCursorTextRef = useRef("");
  const liveCursorInsertionDisabledRef = useRef(false);
  const liveCursorBlockedCommitCountRef = useRef(0);
  const liveCursorFallbackNotifiedRef = useRef(false);
  const livePreviewFailureNotifiedRef = useRef(false);
  const livePreviewNextDelayMsRef = useRef(LIVE_PREVIEW_MIN_INTERVAL_MS);

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
        await setMicrophoneReady(true);
        await setDictationStatus("idle");
        console.info("Microphone ready");
        console.info(
          `[timing] app start -> microphone ready: ${Math.round(
            performance.now() - appStartMs,
          )}ms`,
        );
      } catch (err) {
        setStatus("error");
        await setDictationStatus("error").catch(() => {});
        await setMicrophoneReady(false).catch(() => {});
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
    [ensureAudioContext, ensureWorkletModuleLoaded, setError, setInterimTranscript],
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
        setMicrophoneReady(true).catch(() => {});
        return stream;
      })
      .finally(() => {
        primedStreamPromiseRef.current = null;
      });

    primedStreamPromiseRef.current = promise;
    await promise.catch(() => {});
  }, [openTracedMicrophoneStream]);

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
    const config = useStore.getState().config;
    return (
      config?.transcriptTarget === "cursor" &&
      config.liveCursorMode !== "final-text-only" &&
      !sessionRef.current.livePreviewDisabled
    );
  }

  function shouldUseFastLiveConfirmation() {
    const config = useStore.getState().config;
    return shouldUseFastLivePreviewConfirmation({
      firstLiveTextInserted: firstLiveTextInsertedRef.current,
      liveCursorInsertionDisabled:
        liveCursorInsertionDisabledRef.current ||
        sessionRef.current.liveCursorInsertionDisabled,
      liveCursorMode: config?.liveCursorMode,
      transcriptTarget: config?.transcriptTarget,
    });
  }

  function shouldShowLivePreviewOverlay() {
    const config = useStore.getState().config;
    return (
      config?.liveCursorMode === "preview-overlay-only" ||
      liveCursorInsertionDisabledRef.current ||
      sessionRef.current.liveCursorInsertionDisabled
    );
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
      const previewSamples = collectRecentAudioSamples(
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

      const normalizedPreview = preview?.trim() ?? "";
      if (normalizedPreview.length === 0) {
        if (shouldUseFastLiveConfirmation()) {
          livePreviewNextDelayMsRef.current = LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
        }
        traceDictationEvent("dictation_live_preview_empty").catch(() => {});
        return;
      }

      if (
        isActivePreviewToken(sessionRef.current, token) &&
        normalizedPreview !== lastLivePreviewTextRef.current
      ) {
        lastLivePreviewTextRef.current = normalizedPreview;
        if (shouldShowLivePreviewOverlay()) {
          setInterimTranscript(normalizedPreview);
        }
        await updateLiveCursorText(normalizedPreview);
        traceDictationEvent("dictation_live_preview_updated").catch(() => {});
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

  async function updateLiveCursorText(nextText: string) {
    const config = useStore.getState().config;
    if (
      config?.transcriptTarget !== "cursor" ||
      config.liveCursorMode !== "stable-cursor-streaming" ||
      sessionRef.current.liveCursorInsertionDisabled ||
      liveCursorInsertionDisabledRef.current
    ) {
      return;
    }

    const previousCandidate = liveCursorCandidateTextRef.current;
    liveCursorCandidateTextRef.current = nextText;

    if (previousCandidate.length === 0) {
      return;
    }

    const committedText = liveCursorTextRef.current;
    const decision = liveCursorCommitDecision(
      committedText,
      previousCandidate,
      nextText,
    );
    const fallback = nextLiveCursorFallbackDecision(
      decision.reason,
      liveCursorBlockedCommitCountRef.current,
    );
    liveCursorBlockedCommitCountRef.current = fallback.blockedCommitCount;

    const appendText = decision.appendText;
    if (appendText.length === 0) {
      if (fallback.shouldFallback) {
        pauseLiveCursorStreamingForSession(nextText);
        return;
      }

      if (decision.reason === "unsafe-rewrite") {
        traceDictationEvent("dictation_live_cursor_unsafe_rewrite_blocked").catch(
          () => {},
        );
        return;
      }

      if (decision.reason === "waiting-for-stable-preview") {
        traceDictationEvent("dictation_live_cursor_commit_waiting").catch(() => {});
      }
      return;
    }

    await appendLiveCursorText(appendText, nextText);
  }

  async function appendLiveCursorText(appendText: string, latestPreviewText: string) {
    const committedText = liveCursorTextRef.current;
    const insertionPromise = (async () => {
      await appendLiveText(appendText);
      liveCursorTextRef.current = committedText + appendText;
      liveCursorBlockedCommitCountRef.current = 0;
      sessionRef.current = addCommittedCursorText(sessionRef.current, appendText);
      if (!firstLiveTextInsertedRef.current && recordingStartedAtMsRef.current !== null) {
        firstLiveTextInsertedRef.current = true;
        traceDictationEvent("dictation_first_live_text_visible", {
          durationMs: Math.round(performance.now() - recordingStartedAtMsRef.current),
        }).catch(() => {});
      }
      traceDictationEvent("dictation_live_cursor_insert_updated").catch(() => {});
    })();

    liveCursorInsertionInFlightRef.current = insertionPromise;

    try {
      await insertionPromise;
    } catch (error) {
      sessionRef.current = disableLiveCursorInsertion(sessionRef.current);
      liveCursorInsertionDisabledRef.current = true;
      liveCursorFallbackNotifiedRef.current = true;
      setInterimTranscript(latestPreviewText);
      console.warn("Live cursor text insertion failed:", error);
      traceDictationEvent("dictation_live_cursor_insert_failed").catch(() => {});
      traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
      showNotification(
        "Live cursor streaming paused",
        "VOCO could not update text at the cursor. Final insertion will still run when you stop dictation.",
      ).catch(() => {});
    } finally {
      if (liveCursorInsertionInFlightRef.current === insertionPromise) {
        liveCursorInsertionInFlightRef.current = null;
      }
    }
  }

  function pauseLiveCursorStreamingForSession(latestPreviewText: string) {
    sessionRef.current = disableLiveCursorInsertion(sessionRef.current);
    liveCursorInsertionDisabledRef.current = true;
    setInterimTranscript(latestPreviewText);
    traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});

    if (!liveCursorFallbackNotifiedRef.current) {
      liveCursorFallbackNotifiedRef.current = true;
      showNotification(
        "Live cursor streaming paused",
        "VOCO is still listening and showing live preview. Final insertion will run when you stop dictation.",
      ).catch(() => {});
    }
  }

  function stopLivePreview() {
    clearLivePreviewTimer();
    lastLivePreviewTextRef.current = "";
    liveCursorCandidateTextRef.current = "";
  }

  async function clearLiveCursorText() {
    await waitForLiveCursorInsertion();
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
    const committedText = liveCursorTextRef.current;
    if (committedText.length === 0) {
      return "none";
    }

    const action = planLiveFinalCursorAction(committedText, finalText);
    if (action.status === "no-live-text") {
      return "none";
    }

    liveCursorTextRef.current = "";
    sessionRef.current = clearCommittedCursorText(sessionRef.current);

    if (action.status === "keep-live-text") {
      traceDictationEvent("dictation_live_cursor_final_unreconciled").catch(() => {});
      showNotification(
        "Final transcript ready",
        "VOCO kept the live text at the cursor. The final transcript is available in VOCO without changing existing text.",
      ).catch(() => {});
      return "unreconciled";
    }

    if (action.status === "append-final-suffix") {
      await appendLiveText(action.appendText);
    }

    traceDictationEvent("dictation_live_cursor_insert_finalized").catch(() => {});
    return "safe";
  }

  async function waitForLiveCursorInsertion() {
    const inFlight = liveCursorInsertionInFlightRef.current;
    if (inFlight) {
      await inFlight.catch(() => {});
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
    try {
      await ensureWorkletModuleLoaded(audioContext);
      const worklet = new AudioWorkletNode(
        audioContext,
        "audio-capture-processor",
      );
      worklet.port.onmessage = (e) => {
        if (e.data.type === "samples") {
          appendAudioSamples(audioBufferRef.current, e.data.data as Float32Array);
        } else if (e.data.type === "level") {
          updateAudioLevel(e.data.data as number);
        } else if (e.data.type === "flushed") {
          workletFlushResolverRef.current?.();
          workletFlushResolverRef.current = null;
        }
      };
      source.connect(worklet);
      connectSilentSink(audioContext, worklet);
      workletRef.current = worklet;
      return true;
    } catch {
      return false;
    }
  };

  const connectScriptProcessor = (
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode,
  ) => {
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      appendAudioSamples(audioBufferRef.current, new Float32Array(input));
      updateAudioLevel(calculateVisualAudioLevelFromSamples(input));
    };
    source.connect(processor);
    connectSilentSink(audioContext, processor);
    processorRef.current = processor;
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
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
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
    setDictationStatus("idle").catch(() => {});
  }

  async function startRecording() {
    const phase = phaseRef.current;
    if (phase !== "idle" && phase !== "error") {
      return;
    }

    sessionRef.current = startSession(sessionRef.current);
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
      liveCursorTextRef.current = "";
      liveCursorInsertionDisabledRef.current = false;
      liveCursorBlockedCommitCountRef.current = 0;
      liveCursorFallbackNotifiedRef.current = false;
      livePreviewFailureNotifiedRef.current = false;
      recordingStartedAtMsRef.current = null;
      stopRequestedAtMsRef.current = null;
      firstLiveTextInsertedRef.current = false;
      livePreviewNextDelayMsRef.current = LIVE_PREVIEW_MIN_INTERVAL_MS;
      setDictationStatus("recording").catch(() => {});

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
      setMicrophoneReady(true).catch(() => {});
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

      const audioContext = await ensureAudioContext();
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
      resetAudioLevel();
      setStatus("error");
      setDictationStatus("error").catch(() => {});
      setMicrophoneReady(false).catch(() => {});
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
    setStatus("processing");
    setInterimTranscript("Wrapping up...");
    setDictationStatus("processing").catch(() => {});
    stopLivePreview();

    let sampleRate: number;
    let merged: Float32Array;
    try {
      sampleRate = await teardownAudioGraph();
      resetAudioLevel();
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
      await clearLiveCursorText().catch(() => {});
      const detail = err instanceof Error ? err.message : String(err);
      phaseRef.current = "error";
      sessionRef.current = failSession(sessionRef.current);
      setStatus("error");
      setError(`Audio processing failed: ${detail}`);
      setInterimTranscript("");
      setDictationStatus("error").catch(() => {});
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
      phaseRef.current = "error";
      sessionRef.current = failSession(sessionRef.current);
      setStatus("error");
      setError(
        `Recording too long. Please keep dictation under ${MAX_AUDIO_SECONDS} seconds.`,
      );
      setInterimTranscript("");
      setDictationStatus("error").catch(() => {});
      return;
    }

    phaseRef.current = "processing";
    sessionRef.current = markProcessing(sessionRef.current);
    setInterimTranscript("Transcribing...");

    try {
      const transcribeStartedAt = performance.now();
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

      if (!transcript || transcript.trim().length === 0) {
        await clearLiveCursorText().catch((error) => {
          console.warn("Failed to clear live cursor text after empty transcript:", error);
        });
        setTranscript("(no speech detected)");
        finalizeIdleState();
        return;
      }

      const config = useStore.getState().config;
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
          setDictationStatus("error").catch(() => {});
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
          setDictationStatus("error").catch(() => {});
          return;
        }
      } else {
        setInterimTranscript("Typing at your cursor...");
      }

      // Small delay to let focus return to the previous app
      await new Promise((r) => setTimeout(r, 250));

      try {
        phaseRef.current = "finalizing";
        sessionRef.current = markFinalizing(sessionRef.current);
        const liveFinalization = await replaceLiveCursorTextWithFinal(textToInsert);
        if (liveFinalization === "safe") {
          console.info("[timing] live cursor text finalized by safe append");
          traceDictationEvent("dictation_final_output_completed").catch(() => {});
        } else if (liveFinalization === "unreconciled") {
          console.info("[timing] final transcript kept in VOCO after unsafe live reconciliation");
          traceDictationEvent("dictation_final_output_completed").catch(() => {});
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
        setDictationStatus("error").catch(() => {});
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
      setDictationStatus("error").catch(() => {});
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
    toggle,
    onHotkeyPressed,
  };
}
