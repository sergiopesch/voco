import { useCallback, useRef } from "react";
import { useStore } from "@/store/useStore";
import { transcribeAudio, insertText } from "@/lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";

const TARGET_SAMPLE_RATE = 16000;

export function useDictation() {
  const {
    status,
    setStatus,
    setTranscript,
    setInterimTranscript,
    setError,
    clearTranscript,
  } = useStore();

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);

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

      // If browser gave us a different sample rate, we'll resample later
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Use ScriptProcessorNode to capture raw PCM
      // (AudioWorklet would be better but requires separate file + more setup)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        samplesRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setStatus("recording");
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
  }, [clearTranscript, setError, setStatus]);

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
      // Send to Rust for transcription
      const transcript = await transcribeAudio(Array.from(merged));
      setInterimTranscript("");

      if (!transcript || transcript.trim().length === 0) {
        setTranscript("(no speech detected)");
        setStatus("idle");
        return;
      }

      setTranscript(transcript);

      // Hide overlay so the previous app regains focus, then insert text
      const appWindow = getCurrentWindow();
      try {
        await appWindow.hide();
        // Wait for compositor to refocus the previous window
        await new Promise((r) => setTimeout(r, 250));

        const strategy = useStore.getState().config?.insertionStrategy ?? "auto";
        await insertText(transcript, strategy);
      } catch (insertErr) {
        console.warn("Text insertion failed:", insertErr);
      }

      // Show overlay again briefly with the result
      await appWindow.show();
      setStatus("idle");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Transcription failed: ${detail} (${merged.length} samples)`);
      setInterimTranscript("");
      setStatus("idle");
    }
  }, [setStatus, setTranscript, setInterimTranscript, setError]);

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
