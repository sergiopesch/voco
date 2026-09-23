import {
  clearAudioCaptureBuffer,
  collectAudioSamplesRange,
  createAudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { AudioCaptureFlushError,CAPTURE_INPUT_INTERRUPTED,createAudioCaptureFlush } from "@/lib/audioCaptureFlush";
import {
  openMicrophoneStreamWithDiagnostics,
  probeMicrophoneAccess,
} from "@/lib/audioInput";
import {
  calculateVisualAudioLevelFromSamples,
} from "@/lib/audioLevel";
import { BrowserStreamDelivery } from "@/lib/browserStreamDelivery";
import { retainedSampleRate,type CaptureDescriptor,type CaptureSelection } from "@/lib/captureDescriptor";
import { monitorCaptureHealth } from "@/lib/captureHealth";
import { createDesktopCaptureTail } from "@/lib/desktopCaptureTail";
import { DesktopShortcutSession } from "@/lib/desktopShortcutSession";
import {
  isCurrentAudioCaptureSource,
} from "@/lib/dictationAsyncGuards";
import {
  nextCursorDeliveryState,
  type CursorDeliveryEvent,
} from "@/lib/dictationDelivery";
import { createDictationRecording } from "@/lib/dictationRecording";
import { errorMessage } from "@/lib/dictationRecovery";
import {
  createDictationSessionState,
  requestToggle as requestSessionToggle,
} from "@/lib/dictationSession";
import { admitsDictationTrigger,type DictationTriggerAction } from "@/lib/dictationTrigger";
import { beginNativeCapture,type NativeCaptureSession } from "@/lib/nativeCapture";
import { encodeNativeRetainedSource,type NativeCaptureTerminalOutcome } from "@/lib/nativeCaptureAudit";
import { NvidiaRecovery } from "@/lib/nvidiaRecovery";
import type { HotkeyTraceFields } from "@/lib/tauri";
import {
  beginDesktopShortcutSession,
  debugNativeCaptureEnabled,
  endDesktopShortcutSession,
  getDesktopPasteStatus,
  pasteDesktopText,
  releaseBrowserRecording,
  saveDebugNativeRetainedSource,
  showNotification,
  traceHotkeyEvent
} from "@/lib/tauri";
import { useStore } from "@/store/useStore";
import type {
  AppConfig,
  CursorDeliveryState,
  DictationStatus
} from "@/types";
import { useCallback,useEffect,useRef,useState } from "react";
import { BenchmarkPhraseQueue } from '../lib/benchmarkPhraseQueue';

const AUDIO_LEVEL_ATTACK = 0.68;
const AUDIO_LEVEL_RELEASE = 0.24;
const AUDIO_LEVEL_FLOOR = 0.01;

type DictationPhase = DictationStatus | "stopping" | "finalizing";
export function useDictation(options: { getCaptureSelection?: () => CaptureSelection } = {}) {
  const captureSelectionRef = useRef(options.getCaptureSelection);
  captureSelectionRef.current = options.getCaptureSelection;
  const setStatus = useStore((state) => state.setStatus);
  const setTranscript = useStore((state) => state.setTranscript);
  const setInterimTranscript = useStore((state) => state.setInterimTranscript);
  const setError = useStore((state) => state.setError);
  const setAudioLevel = useStore((state) => state.setAudioLevel);
  const setMicrophoneReadyState = useStore((state) => state.setMicrophoneReady);
  const clearTranscript = useStore((state) => state.clearTranscript);
  const [cancellationPending, setCancellationPending] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const disposedRef = useRef(false);
  const lifecycleEpochRef = useRef(0);
  const cancelledRef = useRef<string | null>(null);
  const recoveryWaitRef = useRef<{ cancel: () => void } | null>(null);
  const nvidiaRecoveryRef = useRef<NvidiaRecovery | null>(null);
  const captureHealthRef = useRef<ReturnType<typeof monitorCaptureHealth> | null>(null);
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
  const browserDeliveryRef = useRef<BrowserStreamDelivery | null>(null);
  const activeTriggerIdRef = useRef<string | undefined>(undefined);
  const manualCopyRequestedRef = useRef(false);
  const desktopPasteSessionRef = useRef(false);
  const desktopTargetTokenRef = useRef<string | null>(null);
  const desktopPhraseQueueRef = useRef<BenchmarkPhraseQueue | null>(null);
  const desktopShortcutSessionRef = useRef<DesktopShortcutSession | null>(null);
  const desktopShortcutCleanupRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const desktopStreamedSampleCountRef = useRef(0);
  const desktopPhrasePasteCountRef = useRef(0);
  const debugNativeCaptureEnabledRef = useRef(false);

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

  function recordingSampleRate(): number {
    return retainedSampleRate(captureDescriptorRef.current, audioBufferRef.current.sampleCount);
  }

  function clearCapturedAudio(): void {
    clearAudioCaptureBuffer(audioBufferRef.current);
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
    const text = finalText;
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
      workletRef,
      processorRef,
      silentSinkRef,
      primedDeviceIdRef,
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
      nvidiaRecoveryRef.current?.settled(),
    ]).then(() => true);
    const ready = await Promise.race([settled, cancelled]);
    if (!ready || recoveryWaitRef.current !== attempt || !isCurrentSession(recoverySessionId)) return;
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
      nativeRecovery = new NvidiaRecovery();
      nvidiaRecoveryRef.current = nativeRecovery;
      const audio = collectAudioSamplesRange(audioBufferRef.current, 0, audioBufferRef.current.sampleCount);
      const result = await Promise.race([
        nativeRecovery.transcribe(audio, recordingSampleRate()).then(text => ({ text })),
        cancelled,
      ]);
      if (result === false || recoveryWaitRef.current !== attempt || !isCurrentSession(recoverySessionId)) return;
      const transcript = result.text;
      assertOutputAllowed(recoverySessionId);
      useStore.getState().setRawTranscript(transcript);
      setTranscript(transcript || "(no speech detected)");
      retainRecovery("Recovered locally with the bundled NVIDIA model. Review any text already in the target, then copy the text you need. Nothing was inserted automatically.", false);
      finalizeIdleState();
    } catch (error) {
      if (!isCurrentSession(recoverySessionId)) return;
      if (recoveryWaitRef.current !== attempt) return;
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
    clearCapturedAudio();
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

  const finishOnboardingTest = useCallback(async () => {
    if (useStore.getState().dictationPurpose !== "onboarding") return false;
    if (sessionRef.current.phase === "recording") {
      sessionRef.current = requestSessionToggle(sessionRef.current).state;
      await stopRecording();
    }
    return useStore.getState().status === "idle" && useStore.getState().onboardingTestPassed;
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
    dictationSessionId: sessionRef.current.sessionId,
    initializeMicrophone,
    prepareAudioEngine,
    primeRecordingStream,
    cursorDeliveryState,
    canCancel,
    cancellationPending,
    cancelRecording,
    retryRecovery,
    discardRecovery,
    finishOnboardingTest,
    toggle,
    onHotkeyPressed,
  };
}
