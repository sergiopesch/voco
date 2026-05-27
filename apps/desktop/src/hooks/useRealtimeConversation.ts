import { useCallback, useEffect, useRef, useState } from "react";
import { openMicrophoneStream } from "@/lib/audioInput";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import {
  createRealtimeClientSecret,
  showNotification,
  traceHotkeyEvent,
} from "@/lib/tauri";
import type { RealtimeStatus } from "@/types";

interface RealtimeState {
  status: RealtimeStatus;
  detail: string;
  error: string | null;
}

type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  error?: { message?: string };
};

const INITIAL_STATE: RealtimeState = {
  status: "idle",
  detail: "Realtime conversation is off.",
  error: null,
};

const REALTIME_SAMPLE_RATE = 24_000;

function samplesToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, value, true);
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function pcm16Base64ToSamples(audio: string): Float32Array {
  const binary = atob(audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) {
    return new Float32Array(samples);
  }

  const targetLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const output = new Float32Array(targetLength);
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1);

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = i * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(samples.length - 1, lower + 1);
    const weight = sourceIndex - lower;
    output[i] = (samples[lower] ?? 0) * (1 - weight) + (samples[upper] ?? 0) * weight;
  }

  return output;
}

function sendRealtimeEvent(socket: WebSocket | null, event: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(event));
}

export function useRealtimeConversation(selectedDeviceId: string | null) {
  const [state, setState] = useState<RealtimeState>(INITIAL_STATE);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentSinkRef = useRef<GainNode | null>(null);
  const statusRef = useRef<RealtimeStatus>("idle");
  const nextOutputTimeRef = useRef(0);
  const outputSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const responseActiveRef = useRef(false);
  const realtimeLevelRef = useRef(0);
  const levelDecayTimeoutRef = useRef<number | null>(null);
  const [realtimeLevel, setRealtimeLevel] = useState(0);

  const setRealtimeState = useCallback((nextState: RealtimeState) => {
    statusRef.current = nextState.status;
    setState(nextState);
  }, []);

  const stopOutputPlayback = useCallback(() => {
    outputSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already have ended.
      }
    });
    outputSourcesRef.current = [];
    nextOutputTimeRef.current = audioContextRef.current?.currentTime ?? 0;
  }, []);

  const clearLevelDecay = useCallback(() => {
    if (levelDecayTimeoutRef.current !== null) {
      window.clearTimeout(levelDecayTimeoutRef.current);
      levelDecayTimeoutRef.current = null;
    }
  }, []);

  const resetRealtimeLevel = useCallback(() => {
    clearLevelDecay();
    realtimeLevelRef.current = 0;
    setRealtimeLevel(0);
  }, [clearLevelDecay]);

  const pushRealtimeLevel = useCallback(
    (rawLevel: number) => {
      const normalized = Math.max(0, Math.min(1, rawLevel));
      const current = realtimeLevelRef.current;
      const next =
        normalized > current
          ? normalized
          : current * 0.62 + normalized * 0.38;

      realtimeLevelRef.current = next;
      setRealtimeLevel(next);

      clearLevelDecay();
      levelDecayTimeoutRef.current = window.setTimeout(() => {
        realtimeLevelRef.current = 0;
        setRealtimeLevel(0);
        levelDecayTimeoutRef.current = null;
      }, 180);
    },
    [clearLevelDecay],
  );

  const cleanup = useCallback(() => {
    responseActiveRef.current = false;
    stopOutputPlayback();
    resetRealtimeLevel();

    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
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
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, [resetRealtimeLevel, stopOutputPlayback]);

  const playOutputAudio = useCallback(
    async (audio: string) => {
      const audioContext = audioContextRef.current;
      if (!audioContext) {
        return;
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }

      const samples = pcm16Base64ToSamples(audio);
      pushRealtimeLevel(calculateVisualAudioLevelFromSamples(samples));
      const buffer = audioContext.createBuffer(1, samples.length, REALTIME_SAMPLE_RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        outputSourcesRef.current = outputSourcesRef.current.filter((item) => item !== source);
      };

      const startAt = Math.max(audioContext.currentTime, nextOutputTimeRef.current);
      source.start(startAt);
      nextOutputTimeRef.current = startAt + buffer.duration;
      outputSourcesRef.current.push(source);
    },
    [pushRealtimeLevel],
  );

  const connectMicrophone = useCallback(
    async (socket: WebSocket, audioContext: AudioContext) => {
      traceHotkeyEvent("realtime_get_user_media_started").catch(() => {});
      const stream = await openMicrophoneStream(selectedDeviceId);
      traceHotkeyEvent("realtime_get_user_media_done").catch(() => {});
      streamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentSink = audioContext.createGain();
      silentSink.gain.value = 0;

      processor.onaudioprocess = (event) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        pushRealtimeLevel(calculateVisualAudioLevelFromSamples(input));
        const audio = samplesToPcm16Base64(
          resampleLinear(input, audioContext.sampleRate, REALTIME_SAMPLE_RATE),
        );
        sendRealtimeEvent(socket, {
          type: "input_audio_buffer.append",
          audio,
        });
      };

      source.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(audioContext.destination);

      sourceRef.current = source;
      processorRef.current = processor;
      silentSinkRef.current = silentSink;
      traceHotkeyEvent("realtime_audio_graph_connected").catch(() => {});
    },
    [pushRealtimeLevel, selectedDeviceId],
  );

  const stop = useCallback(() => {
    traceHotkeyEvent("realtime_stop_requested").catch(() => {});
    cleanup();
    setRealtimeState(INITIAL_STATE);
  }, [cleanup, setRealtimeState]);

  const start = useCallback(async () => {
    cleanup();
    traceHotkeyEvent("realtime_start_requested").catch(() => {});
    setRealtimeState({ status: "connecting", detail: "Starting realtime voice...", error: null });

    try {
      const secret = await createRealtimeClientSecret();
      traceHotkeyEvent("realtime_client_secret_created").catch(() => {});

      const audioContext = new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      nextOutputTimeRef.current = audioContext.currentTime;
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }

      traceHotkeyEvent("realtime_websocket_connecting").catch(() => {});
      const socket = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-realtime-2",
        ["realtime", `openai-insecure-api-key.${secret.value}`],
      );
      socketRef.current = socket;

      socket.onopen = () => {
        traceHotkeyEvent("realtime_websocket_open").catch(() => {});
        void connectMicrophone(socket, audioContext)
          .then(() => {
            setRealtimeState({
              status: "listening",
              detail: "Realtime conversation is live.",
              error: null,
            });
          })
          .catch((error) => {
            const detail = error instanceof Error ? error.message : String(error);
            traceHotkeyEvent("realtime_start_failed").catch(() => {});
            setRealtimeState({
              status: "error",
              detail: "Realtime microphone failed.",
              error: detail,
            });
            showNotification("Realtime failed", detail).catch(() => {});
            cleanup();
          });
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RealtimeServerEvent;
          switch (message.type) {
            case "input_audio_buffer.speech_started":
              stopOutputPlayback();
              if (responseActiveRef.current) {
                sendRealtimeEvent(socket, { type: "response.cancel" });
              }
              setRealtimeState({ status: "listening", detail: "Listening...", error: null });
              break;
            case "response.created":
              responseActiveRef.current = true;
              setRealtimeState({
                status: "speaking",
                detail: "Speaking... talk to interrupt.",
                error: null,
              });
              break;
            case "response.output_audio.delta":
              if (message.delta) {
                traceHotkeyEvent("realtime_output_audio_delta").catch(() => {});
                void playOutputAudio(message.delta);
              }
              setRealtimeState({
                status: "speaking",
                detail: "Speaking... talk to interrupt.",
                error: null,
              });
              break;
            case "response.done":
              responseActiveRef.current = false;
              setRealtimeState({ status: "listening", detail: "Listening...", error: null });
              break;
            case "error":
              traceHotkeyEvent("realtime_server_error").catch(() => {});
              setRealtimeState({
                status: "error",
                detail: "Realtime error.",
                error: message.error?.message ?? "Unknown Realtime error",
              });
              break;
          }
        } catch {
          // Ignore non-JSON diagnostics from the Realtime socket.
        }
      };

      socket.onerror = () => {
        traceHotkeyEvent("realtime_websocket_error").catch(() => {});
        setRealtimeState({
          status: "error",
          detail: "Realtime socket failed.",
          error: "WebSocket error",
        });
      };

      socket.onclose = () => {
        traceHotkeyEvent("realtime_websocket_closed").catch(() => {});
        if (statusRef.current !== "idle" && statusRef.current !== "error") {
          setRealtimeState({
            status: "error",
            detail: "Realtime socket closed.",
            error: "WebSocket closed",
          });
        }
      };
    } catch (error) {
      cleanup();
      const detail = error instanceof Error ? error.message : String(error);
      traceHotkeyEvent("realtime_start_failed").catch(() => {});
      setRealtimeState({ status: "error", detail: "Realtime failed to start.", error: detail });
      showNotification("Realtime failed", detail).catch(() => {});
    }
  }, [
    cleanup,
    connectMicrophone,
    playOutputAudio,
    setRealtimeState,
    stopOutputPlayback,
  ]);

  const toggle = useCallback(() => {
    traceHotkeyEvent("frontend_realtime_toggle_received").catch(() => {});
    if (statusRef.current === "idle" || statusRef.current === "error") {
      void start();
    } else {
      stop();
    }
  }, [start, stop]);

  useEffect(() => stop, [stop]);

  return {
    realtimeStatus: state.status,
    realtimeDetail: state.detail,
    realtimeError: state.error,
    realtimeLevel,
    isRealtimeActive: state.status !== "idle" && state.status !== "error",
    startRealtime: start,
    stopRealtime: stop,
    toggleRealtime: toggle,
  };
}
