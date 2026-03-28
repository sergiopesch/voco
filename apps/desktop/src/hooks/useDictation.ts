import { useCallback, useRef } from "react";
import { useStore } from "@/store/useStore";
import {
  transcribeAudio,
  insertText,
  setRecordingState,
  showNotification,
} from "@/lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";

const TARGET_SAMPLE_RATE = 16000;

export function useDictation() {
  const {
    status,
    setStatus,
    setTranscript,
    setInterimTranscript,
    setError,
    setAudioLevel,
    clearTranscript,
  } = useStore();

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);

  const moveWindowOffScreen = useCallback(async () => {
    try {
      const w = getCurrentWindow();
      await w.setSize(new LogicalSize(1, 1));
      await w.setPosition(new LogicalPosition(-100, -100));
      await w.show(); // Must stay "shown" for WebKitGTK to allow getUserMedia
    } catch (e) {
      console.warn("Failed to move window off-screen:", e);
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

  const startRecording = useCallback(async () => {
    try {
      clearTranscript();
      setError(null);
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

      setStatus("recording");
      setRecordingState(true).catch(() => {});
    } catch (err) {
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
  }, [clearTranscript, setError, setStatus, setAudioLevel]);

  const stopRecording = useCallback(async () => {
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
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setAudioLevel(0);
    setRecordingState(false).catch(() => {});

    const sampleRate = audioContextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const chunks = samplesRef.current;
    samplesRef.current = [];

    if (chunks.length === 0) {
      setStatus("idle");
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
      setStatus("idle");
      return;
    }

    setStatus("processing");
    setInterimTranscript("Transcribing...");

    try {
      const transcript = await transcribeAudio(merged);
      setInterimTranscript("");

      if (!transcript || transcript.trim().length === 0) {
        setTranscript("(no speech detected)");
        setStatus("idle");
        return;
      }

      setTranscript(transcript);

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

      setStatus("idle");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Transcription failed: ${detail} (${merged.length} samples)`);
      setInterimTranscript("");
      setStatus("idle");
    }
  }, [setStatus, setTranscript, setInterimTranscript, setError, setAudioLevel]);

  const toggle = useCallback(() => {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle" || status === "error") {
      startRecording();
    }
  }, [status, startRecording, stopRecording]);

  return { toggle, moveWindowOffScreen };
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
