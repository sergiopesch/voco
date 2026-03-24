import { useCallback, useRef } from "react";
import { useStore } from "@/store/useStore";
import { transcribeAudio, insertText, setRecordingState } from "@/lib/tauri";
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

  const showWindowLarge = useCallback(async () => {
    try {
      const w = getCurrentWindow();
      await w.setSize(new LogicalSize(300, 200));
      await w.center();
      await w.show();
      await w.setFocus();
    } catch (e) {
      console.warn("Failed to show window:", e);
    }
  }, []);

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

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        samplesRef.current.push(new Float32Array(input));

        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i]! * input[i]!;
        }
        const rms = Math.sqrt(sum / input.length);
        const level = Math.min(1, rms * 8);
        setAudioLevel(level);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setStatus("recording");
      // Update tray icon to red (recording)
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
    // Stop audio capture
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
    // Update tray icon back to white (idle)
    setRecordingState(false).catch(() => {});

    const sampleRate = audioContextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Merge all captured chunks
    const chunks = samplesRef.current;
    samplesRef.current = [];

    if (chunks.length === 0) {
      setStatus("idle");
      return;
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    let merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Resample to 16kHz if needed
    if (Math.abs(sampleRate - TARGET_SAMPLE_RATE) > 1) {
      merged = resample(merged, sampleRate, TARGET_SAMPLE_RATE) as Float32Array<ArrayBuffer>;
    }

    // Skip very short recordings (< 0.3s)
    if (merged.length < TARGET_SAMPLE_RATE * 0.3) {
      setStatus("idle");
      return;
    }

    setStatus("processing");
    setInterimTranscript("Transcribing...");

    try {
      const transcript = await transcribeAudio(Array.from(merged));
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
      } catch (insertErr) {
        console.warn("Text insertion failed:", insertErr);
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

  return {
    toggle,
    startRecording,
    stopRecording,
    showWindowLarge,
    moveWindowOffScreen,
    isRecording: status === "recording",
    isProcessing: status === "processing",
  };
}

function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;

    if (idx + 1 < input.length) {
      output[i] = input[idx]! * (1 - frac) + input[idx + 1]! * frac;
    } else {
      output[i] = input[idx] ?? 0;
    }
  }

  return output;
}
