import { useCallback, useRef } from "react";
import { useStore } from "@/store/useStore";
import {
  hideStatusOverlay,
  transcribeAudio,
  insertText,
  setRecordingState,
  showNotification,
  showStatusOverlay,
} from "@/lib/tauri";
import type { DictationStatus } from "@/types";

const TARGET_SAMPLE_RATE = 16000;
const STATUS_OVERLAY_WIDTH = 252;
const STATUS_OVERLAY_HEIGHT = 112;
const TOGGLE_DEDUPE_MS = 150;

type DictationPhase = DictationStatus | "starting" | "stopping";
type QueuedAction = "start" | "stop" | null;

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
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const phaseRef = useRef<DictationPhase>("idle");
  const queuedActionRef = useRef<QueuedAction>(null);
  const lastToggleRequestMsRef = useRef(0);

  const prepareWindow = useCallback(async () => {
    try {
      await hideStatusOverlay();
    } catch (error) {
      console.warn("Failed to prepare status overlay window:", error);
    }
  }, []);

  const syncIndicatorWindow = useCallback(async (status: DictationStatus) => {
    try {
      if (status === "recording" || status === "processing") {
        await showStatusOverlay(STATUS_OVERLAY_WIDTH, STATUS_OVERLAY_HEIGHT);
      } else {
        await hideStatusOverlay();
      }
    } catch (error) {
      console.warn("Failed to sync status overlay window:", error);
    }
  }, []);

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
          setAudioLevel(e.data.data as number);
        }
      };
      source.connect(worklet);
      worklet.connect(audioContext.destination);
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

      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i]! * input[i]!;
      }
      const rms = Math.sqrt(sum / input.length);
      setAudioLevel(Math.min(1, rms * 8));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
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
      setInterimTranscript("");
      setStatus("recording");
      setAudioLevel(0);
      samplesRef.current = [];

      const deviceId = useStore.getState().selectedDeviceId;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          sampleRate: { ideal: TARGET_SAMPLE_RATE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Prefer AudioWorklet (off main thread), fall back to ScriptProcessorNode
      const workletOk = await connectWorklet(audioContext, source);
      if (!workletOk) {
        connectScriptProcessor(audioContext, source);
      }

      phaseRef.current = "recording";
      setRecordingState(true).catch(() => {});

      if (queuedActionRef.current === "stop") {
        queuedActionRef.current = null;
        void stopRecording();
      }
    } catch (err) {
      await teardownAudioGraph();
      setAudioLevel(0);
      setRecordingState(false).catch(() => {});
      setInterimTranscript("");
      queuedActionRef.current = null;
      phaseRef.current = "error";

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError("Microphone access denied. Check your system permissions.");
        } else if (err.name === "NotFoundError") {
          setError("No microphone found.");
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
    setAudioLevel(0);
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

    try {
      const transcript = await transcribeAudio(merged);

      if (!transcript || transcript.trim().length === 0) {
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
      } catch {
        showNotification(
          "Text insertion failed",
          "Your transcript is in the clipboard — paste with Ctrl+V",
        ).catch(() => {});
      }

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
    const now = Date.now();
    if (now - lastToggleRequestMsRef.current < TOGGLE_DEDUPE_MS) {
      return;
    }
    lastToggleRequestMsRef.current = now;

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

  return { prepareWindow, syncIndicatorWindow, toggle };
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
