import { useCallback, useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";
import {
  hideStatusOverlay,
  transcribeAudio,
  insertText,
  setRecordingState,
  setMicrophoneReady,
  showNotification,
  showStatusOverlay,
} from "@/lib/tauri";
import {
  calculateVisualAudioLevelFromSamples,
  removeDcOffset,
} from "@/lib/audioLevel";
import type { DictationStatus } from "@/types";

const TARGET_SAMPLE_RATE = 16000;
const STATUS_OVERLAY_WIDTH = 252;
const STATUS_OVERLAY_HEIGHT = 112;
const AUDIO_LEVEL_ATTACK = 0.68;
const AUDIO_LEVEL_RELEASE = 0.24;
const AUDIO_LEVEL_FLOOR = 0.01;
const OVERLAY_REFRESH_MS = 120;
const MIN_PROCESSING_OVERLAY_MS = 420;

type DictationPhase = DictationStatus | "starting" | "stopping";
type QueuedAction = "start" | "stop" | null;

function buildAudioConstraints(
  deviceId: string | null,
): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

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
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentSinkRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const phaseRef = useRef<DictationPhase>("idle");
  const queuedActionRef = useRef<QueuedAction>(null);
  const smoothedAudioLevelRef = useRef(0);
  const firstHotkeyPressMsRef = useRef<number | null>(null);
  const initialHotkeyPressLoggedRef = useRef(false);
  const initialHotkeyLatencyLoggedRef = useRef(false);
  const overlayTrackingTimerRef = useRef<number | null>(null);

  const stopOverlayTracking = useCallback(() => {
    if (overlayTrackingTimerRef.current !== null) {
      window.clearInterval(overlayTrackingTimerRef.current);
      overlayTrackingTimerRef.current = null;
    }
  }, []);

  const startOverlayTracking = useCallback(() => {
    stopOverlayTracking();

    const syncOverlay = () => {
      void showStatusOverlay(STATUS_OVERLAY_WIDTH, STATUS_OVERLAY_HEIGHT).catch(
        (error) => {
          console.warn("Failed to refresh status overlay position:", error);
        },
      );
    };

    syncOverlay();
    overlayTrackingTimerRef.current = window.setInterval(
      syncOverlay,
      OVERLAY_REFRESH_MS,
    );
  }, [stopOverlayTracking]);

  const prepareWindow = useCallback(async () => {
    try {
      stopOverlayTracking();
      await hideStatusOverlay();
    } catch (error) {
      console.warn("Failed to prepare status overlay window:", error);
    }
  }, [stopOverlayTracking]);

  const initializeMicrophone = useCallback(
    async (appStartMs: number) => {
      try {
        const deviceId = useStore.getState().selectedDeviceId;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: buildAudioConstraints(deviceId),
        });
        stream.getTracks().forEach((track) => track.stop());

        await setMicrophoneReady(true);
        console.info("Microphone ready");
        console.info(
          `[timing] app start -> microphone ready: ${Math.round(
            performance.now() - appStartMs,
          )}ms`,
        );
      } catch (err) {
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
    [setError],
  );

  const syncIndicatorWindow = useCallback(async (status: DictationStatus) => {
    try {
      if (status === "recording" || status === "processing") {
        startOverlayTracking();
      } else {
        stopOverlayTracking();
        await hideStatusOverlay();
      }
    } catch (error) {
      console.warn("Failed to sync status overlay window:", error);
    }
  }, [startOverlayTracking, stopOverlayTracking]);

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
      await audioContext.audioWorklet.addModule("/audio-processor.js");
      const worklet = new AudioWorkletNode(
        audioContext,
        "audio-capture-processor",
      );
      worklet.port.onmessage = (e) => {
        if (e.data.type === "samples") {
          samplesRef.current.push(e.data.data as Float32Array);
        } else if (e.data.type === "level") {
          updateAudioLevel(e.data.data as number);
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
      samplesRef.current.push(new Float32Array(input));
      updateAudioLevel(calculateVisualAudioLevelFromSamples(input));
    };
    source.connect(processor);
    connectSilentSink(audioContext, processor);
    processorRef.current = processor;
  };

  async function teardownAudioGraph() {
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

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        // Closing an already-closed context is safe to ignore here.
      }
      audioContextRef.current = null;
    }

    return sampleRate;
  }

  function finalizeIdleState() {
    setInterimTranscript("");
    phaseRef.current = "idle";
    setStatus("idle");

    const queuedAction = queuedActionRef.current;
    queuedActionRef.current = null;

    if (queuedAction === "start") {
      void startRecording();
    }
  }

  async function startRecording() {
    const phase = phaseRef.current;
    if (phase !== "idle" && phase !== "error") {
      return;
    }

    phaseRef.current = "starting";
    queuedActionRef.current = null;

    try {
      clearTranscript();
      setInterimTranscript("Listening...");
      setStatus("recording");
      resetAudioLevel();
      samplesRef.current = [];
      setRecordingState(true).catch(() => {});

      const deviceId = useStore.getState().selectedDeviceId;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(deviceId),
      });

      streamRef.current = stream;
      setMicrophoneReady(true).catch(() => {});
      console.info("Recording started");
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

      const audioContext = new AudioContext({
        latencyHint: "interactive",
      });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Prefer AudioWorklet (off main thread), fall back to ScriptProcessorNode
      const workletOk = await connectWorklet(audioContext, source);
      if (!workletOk) {
        connectScriptProcessor(audioContext, source);
      }

      phaseRef.current = "recording";

      if (queuedActionRef.current === "stop") {
        queuedActionRef.current = null;
        void stopRecording();
      }
    } catch (err) {
      await teardownAudioGraph();
      resetAudioLevel();
      setRecordingState(false).catch(() => {});
      setMicrophoneReady(false).catch(() => {});
      setInterimTranscript("");
      queuedActionRef.current = null;
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
    setStatus("processing");
    setInterimTranscript("Wrapping up...");

    const sampleRate = await teardownAudioGraph();
    resetAudioLevel();
    setRecordingState(false).catch(() => {});

    const chunks = samplesRef.current;
    samplesRef.current = [];

    if (chunks.length === 0) {
      finalizeIdleState();
      return;
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    let merged: Float32Array = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    merged = removeDcOffset(merged);

    // Resample to 16kHz if needed using OfflineAudioContext for proper quality
    if (Math.abs(sampleRate - TARGET_SAMPLE_RATE) > 1) {
      merged = await resample(merged, sampleRate, TARGET_SAMPLE_RATE);
    }

    // Skip very short recordings (< 0.3s)
    if (merged.length < TARGET_SAMPLE_RATE * 0.3) {
      finalizeIdleState();
      return;
    }

    phaseRef.current = "processing";
    setInterimTranscript("Transcribing...");
    const processingStartMs = performance.now();

    const ensureProcessingVisible = async () => {
      const elapsed = performance.now() - processingStartMs;
      if (elapsed < MIN_PROCESSING_OVERLAY_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_PROCESSING_OVERLAY_MS - elapsed),
        );
      }
    };

    try {
      const transcript = await transcribeAudio(merged);

      if (!transcript || transcript.trim().length === 0) {
        await ensureProcessingVisible();
        setTranscript("(no speech detected)");
        finalizeIdleState();
        return;
      }

      setTranscript(transcript);
      setInterimTranscript("Typing at your cursor...");

      // Small delay to let focus return to the previous app
      await new Promise((r) => setTimeout(r, 250));

      const strategy = useStore.getState().config?.insertionStrategy ?? "auto";
      try {
        await insertText(transcript, strategy);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        showNotification(
          "Text insertion failed",
          detail.includes("clipboard")
            ? detail
            : "VOCO could not insert text automatically. Please try again.",
        ).catch(() => {});
      }

      await ensureProcessingVisible();
      finalizeIdleState();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      phaseRef.current = "error";
      setError(`Transcription failed: ${detail} (${merged.length} samples)`);
      setInterimTranscript("");

      const queuedAction = queuedActionRef.current;
      queuedActionRef.current = null;
      if (queuedAction === "start") {
        void startRecording();
      }
    }
  }

  const toggle = useCallback(() => {
    switch (phaseRef.current) {
      case "idle":
      case "error":
        void startRecording();
        break;
      case "starting":
        queuedActionRef.current = "stop";
        break;
      case "recording":
        void stopRecording();
        break;
      case "stopping":
      case "processing":
        queuedActionRef.current = "start";
        break;
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

  useEffect(() => stopOverlayTracking, [stopOverlayTracking]);

  return {
    prepareWindow,
    initializeMicrophone,
    syncIndicatorWindow,
    toggle,
    onHotkeyPressed,
  };
}

/**
 * Resample audio using OfflineAudioContext for proper anti-aliased,
 * browser-native resampling (replaces naive linear interpolation).
 */
async function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  const duration = input.length / fromRate;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * toRate), toRate);
  const buffer = offlineCtx.createBuffer(1, input.length, fromRate);
  buffer.getChannelData(0).set(input);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}
