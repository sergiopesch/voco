import { useCallback, useEffect, useRef, useState } from "react";
import { openMicrophoneStream } from "@/lib/audioInput";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import {
  createRealtimeClientSecret,
  showNotification,
  traceHotkeyEvent,
} from "@/lib/tauri";
import type { HotkeyTraceFields } from "@/lib/tauri";
import type { RealtimeStatus } from "@/types";

interface RealtimeState {
  status: RealtimeStatus;
  detail: string;
  error: string | null;
}

export type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  error?: { message?: string };
};

export interface RealtimeRuntimeSnapshot {
  responseActive: boolean;
  waitingForResponse: boolean;
  inputChunkCount: number;
  responseDeltaCount: number;
}

export interface RealtimeTraceEvent {
  event: string;
  fields?: HotkeyTraceFields;
}

export interface RealtimeServerDecision {
  traceEvents: RealtimeTraceEvent[];
  clearNoSpeechTimeout?: boolean;
  clearLocalCommitFallbackTimeout?: boolean;
  clearResponseTimeouts?: boolean;
  stopOutputPlayback?: boolean;
  cancelResponse?: boolean;
  scheduleResponseFallback?: boolean;
  playOutputAudio?: string;
  cleanup?: boolean;
  resetLocalSpeechDetector?: boolean;
  status?: RealtimeState;
  responseActive?: boolean;
  waitingForResponse?: boolean;
  responseDeltaCount?: number;
  serverDetectedCurrentTurn?: boolean;
}

const INITIAL_STATE: RealtimeState = {
  status: "idle",
  detail: "Realtime conversation is off.",
  error: null,
};

const REALTIME_SAMPLE_RATE = 24_000;
const INPUT_LEVEL_TRACE_THRESHOLD = 0.08;
const INPUT_LEVEL_TRACE_INTERVAL_MS = 1_500;
const OUTPUT_LEVEL_TRACE_THRESHOLD = 0.04;
const OUTPUT_LEVEL_TRACE_INTERVAL_MS = 1_500;
const INPUT_CHUNK_TRACE_INTERVAL = 100;
const NO_SPEECH_TIMEOUT_MS = 8_000;
const RESPONSE_CREATE_FALLBACK_MS = 1_200;
const NO_RESPONSE_TIMEOUT_MS = 8_000;
const LOCAL_SPEECH_LEVEL_THRESHOLD = 0.08;
const LOCAL_SPEECH_MIN_DURATION_MS = 240;
const LOCAL_SPEECH_SILENCE_MS = 850;
const LOCAL_COMMIT_FALLBACK_MS = 700;

type LocalSpeechDetectorEvent = "started" | "stopped" | null;

export interface LocalSpeechDetectorState {
  active: boolean;
  candidateStartedAt: number | null;
  lastVoiceAt: number | null;
}

export interface LocalSpeechDetectorConfig {
  levelThreshold: number;
  minDurationMs: number;
  silenceMs: number;
}

const INITIAL_LOCAL_SPEECH_DETECTOR_STATE: LocalSpeechDetectorState = {
  active: false,
  candidateStartedAt: null,
  lastVoiceAt: null,
};

const LOCAL_SPEECH_DETECTOR_CONFIG: LocalSpeechDetectorConfig = {
  levelThreshold: LOCAL_SPEECH_LEVEL_THRESHOLD,
  minDurationMs: LOCAL_SPEECH_MIN_DURATION_MS,
  silenceMs: LOCAL_SPEECH_SILENCE_MS,
};

export function audioLevelBucket(level: number): NonNullable<
  HotkeyTraceFields["audioLevelBucket"]
> {
  if (level < 0.02) {
    return "silent";
  }
  if (level < 0.08) {
    return "low";
  }
  if (level < 0.35) {
    return "medium";
  }
  return "high";
}

export function updateLocalSpeechDetectorState(
  state: LocalSpeechDetectorState,
  level: number,
  nowMs: number,
  config: LocalSpeechDetectorConfig = LOCAL_SPEECH_DETECTOR_CONFIG,
): { state: LocalSpeechDetectorState; event: LocalSpeechDetectorEvent } {
  if (level >= config.levelThreshold) {
    if (state.active) {
      return {
        state: { ...state, lastVoiceAt: nowMs },
        event: null,
      };
    }

    const candidateStartedAt = state.candidateStartedAt ?? nowMs;
    if (nowMs - candidateStartedAt >= config.minDurationMs) {
      return {
        state: {
          active: true,
          candidateStartedAt: null,
          lastVoiceAt: nowMs,
        },
        event: "started",
      };
    }

    return {
      state: {
        active: false,
        candidateStartedAt,
        lastVoiceAt: nowMs,
      },
      event: null,
    };
  }

  if (
    state.active &&
    state.lastVoiceAt !== null &&
    nowMs - state.lastVoiceAt >= config.silenceMs
  ) {
    return {
      state: INITIAL_LOCAL_SPEECH_DETECTOR_STATE,
      event: "stopped",
    };
  }

  if (!state.active) {
    return {
      state: INITIAL_LOCAL_SPEECH_DETECTOR_STATE,
      event: null,
    };
  }

  return { state, event: null };
}

export function decideRealtimeServerEvent(
  message: RealtimeServerEvent,
  snapshot: RealtimeRuntimeSnapshot,
): RealtimeServerDecision {
  switch (message.type) {
    case "session.created":
      return { traceEvents: [{ event: "realtime_session_created" }] };
    case "session.updated":
      return { traceEvents: [{ event: "realtime_session_updated" }] };
    case "input_audio_buffer.speech_started":
      return {
        traceEvents: [{ event: "realtime_server_speech_started" }],
        clearNoSpeechTimeout: true,
        clearLocalCommitFallbackTimeout: true,
        clearResponseTimeouts: true,
        stopOutputPlayback: true,
        cancelResponse: snapshot.responseActive,
        status: { status: "listening", detail: "Listening...", error: null },
        waitingForResponse: false,
        serverDetectedCurrentTurn: true,
      };
    case "input_audio_buffer.speech_stopped":
      return {
        traceEvents: [{ event: "realtime_server_speech_stopped" }],
        status: {
          status: "listening",
          detail: "Heard you. Waiting for the response...",
          error: null,
        },
      };
    case "input_audio_buffer.committed":
      return {
        traceEvents: [{ event: "realtime_server_input_committed" }],
        clearLocalCommitFallbackTimeout: true,
        scheduleResponseFallback: true,
        resetLocalSpeechDetector: true,
        serverDetectedCurrentTurn: false,
      };
    case "response.created":
      return {
        traceEvents: [
          {
            event: "realtime_server_response_created",
            fields: { chunkCount: snapshot.inputChunkCount },
          },
        ],
        clearResponseTimeouts: true,
        status: { status: "speaking", detail: "Speaking... talk to interrupt.", error: null },
        waitingForResponse: false,
        responseActive: true,
      };
    case "response.output_audio.delta": {
      const nextResponseDeltaCount = message.delta
        ? snapshot.responseDeltaCount + 1
        : snapshot.responseDeltaCount;
      return {
        traceEvents: message.delta
          ? [
              {
                event: "realtime_output_audio_delta",
                fields: { responseDeltaCount: nextResponseDeltaCount },
              },
            ]
          : [],
        status: { status: "speaking", detail: "Speaking... talk to interrupt.", error: null },
        playOutputAudio: message.delta,
        responseDeltaCount: nextResponseDeltaCount,
      };
    }
    case "response.done":
      return {
        traceEvents: [
          {
            event: "realtime_server_response_done",
            fields: { responseDeltaCount: snapshot.responseDeltaCount },
          },
        ],
        clearResponseTimeouts: true,
        status: { status: "listening", detail: "Listening...", error: null },
        waitingForResponse: false,
        responseActive: false,
      };
    case "error":
      return {
        traceEvents: [{ event: "realtime_server_error" }],
        status: {
          status: "error",
          detail: "Realtime error.",
          error: message.error?.message ?? "Unknown Realtime error",
        },
        cleanup: true,
      };
    default:
      return { traceEvents: [] };
  }
}

export function samplesToPcm16Base64(samples: Float32Array): string {
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

export function pcm16Base64ToSamples(audio: string): Float32Array {
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

export function resampleLinear(
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

function sendRealtimeEvent(socket: WebSocket | null, event: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(event));
  return true;
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
  const noSpeechTimeoutRef = useRef<number | null>(null);
  const localCommitFallbackTimeoutRef = useRef<number | null>(null);
  const responseCreateFallbackTimeoutRef = useRef<number | null>(null);
  const noResponseTimeoutRef = useRef<number | null>(null);
  const inputChunkCountRef = useRef(0);
  const responseDeltaCountRef = useRef(0);
  const lastInputLevelTraceMsRef = useRef(0);
  const lastOutputLevelTraceMsRef = useRef(0);
  const waitingForResponseRef = useRef(false);
  const serverDetectedCurrentTurnRef = useRef(false);
  const localSpeechDetectorRef = useRef<LocalSpeechDetectorState>(
    INITIAL_LOCAL_SPEECH_DETECTOR_STATE,
  );
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

  const clearNoSpeechTimeout = useCallback(() => {
    if (noSpeechTimeoutRef.current !== null) {
      window.clearTimeout(noSpeechTimeoutRef.current);
      noSpeechTimeoutRef.current = null;
    }
  }, []);

  const clearResponseTimeouts = useCallback(() => {
    if (responseCreateFallbackTimeoutRef.current !== null) {
      window.clearTimeout(responseCreateFallbackTimeoutRef.current);
      responseCreateFallbackTimeoutRef.current = null;
    }
    if (noResponseTimeoutRef.current !== null) {
      window.clearTimeout(noResponseTimeoutRef.current);
      noResponseTimeoutRef.current = null;
    }
  }, []);

  const clearLocalCommitFallbackTimeout = useCallback(() => {
    if (localCommitFallbackTimeoutRef.current !== null) {
      window.clearTimeout(localCommitFallbackTimeoutRef.current);
      localCommitFallbackTimeoutRef.current = null;
    }
  }, []);

  const scheduleNoSpeechTimeout = useCallback(() => {
    clearNoSpeechTimeout();
    noSpeechTimeoutRef.current = window.setTimeout(() => {
      traceHotkeyEvent("realtime_no_speech_timeout", {
        chunkCount: inputChunkCountRef.current,
      }).catch(() => {});
      if (statusRef.current === "listening") {
        setRealtimeState({
          status: "listening",
          detail: "Listening... no mic speech detected yet.",
          error: null,
        });
      }
      noSpeechTimeoutRef.current = null;
    }, NO_SPEECH_TIMEOUT_MS);
  }, [clearNoSpeechTimeout, setRealtimeState]);

  const sendResponseCreate = useCallback((socket: WebSocket | null): boolean => {
    return sendRealtimeEvent(socket, {
      type: "response.create",
      response: {
        output_modalities: ["audio"],
      },
    });
  }, []);

  const sendInputCommit = useCallback((socket: WebSocket | null): boolean => {
    return sendRealtimeEvent(socket, { type: "input_audio_buffer.commit" });
  }, []);

  const scheduleResponseFallback = useCallback(
    (socket: WebSocket) => {
      clearResponseTimeouts();
      waitingForResponseRef.current = true;

      responseCreateFallbackTimeoutRef.current = window.setTimeout(() => {
        responseCreateFallbackTimeoutRef.current = null;
        if (!waitingForResponseRef.current || responseActiveRef.current) {
          return;
        }
        if (sendResponseCreate(socket)) {
          traceHotkeyEvent("realtime_response_create_fallback_sent", {
            chunkCount: inputChunkCountRef.current,
            responseDeltaCount: responseDeltaCountRef.current,
          }).catch(() => {});
        }
      }, RESPONSE_CREATE_FALLBACK_MS);

      noResponseTimeoutRef.current = window.setTimeout(() => {
        noResponseTimeoutRef.current = null;
        if (!waitingForResponseRef.current || responseActiveRef.current) {
          return;
        }
        traceHotkeyEvent("realtime_no_response_timeout", {
          chunkCount: inputChunkCountRef.current,
          responseDeltaCount: responseDeltaCountRef.current,
        }).catch(() => {});
        if (statusRef.current === "listening") {
          setRealtimeState({
            status: "listening",
            detail: "Listening... speech was detected, waiting for a response.",
            error: null,
          });
        }
      }, NO_RESPONSE_TIMEOUT_MS);
    },
    [clearResponseTimeouts, sendResponseCreate, setRealtimeState],
  );

  const scheduleLocalCommitFallback = useCallback(
    (socket: WebSocket) => {
      clearLocalCommitFallbackTimeout();
      localCommitFallbackTimeoutRef.current = window.setTimeout(() => {
        localCommitFallbackTimeoutRef.current = null;
        if (
          serverDetectedCurrentTurnRef.current ||
          waitingForResponseRef.current ||
          responseActiveRef.current
        ) {
          return;
        }
        if (sendInputCommit(socket)) {
          traceHotkeyEvent("realtime_input_audio_commit_fallback_sent", {
            chunkCount: inputChunkCountRef.current,
          }).catch(() => {});
          scheduleResponseFallback(socket);
        }
      }, LOCAL_COMMIT_FALLBACK_MS);
    },
    [clearLocalCommitFallbackTimeout, scheduleResponseFallback, sendInputCommit],
  );

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
    waitingForResponseRef.current = false;
    serverDetectedCurrentTurnRef.current = false;
    localSpeechDetectorRef.current = INITIAL_LOCAL_SPEECH_DETECTOR_STATE;
    inputChunkCountRef.current = 0;
    responseDeltaCountRef.current = 0;
    lastInputLevelTraceMsRef.current = 0;
    lastOutputLevelTraceMsRef.current = 0;
    clearNoSpeechTimeout();
    clearLocalCommitFallbackTimeout();
    clearResponseTimeouts();
    stopOutputPlayback();
    resetRealtimeLevel();

    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      if (
        socketRef.current.readyState === WebSocket.CONNECTING ||
        socketRef.current.readyState === WebSocket.OPEN
      ) {
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
  }, [
    clearNoSpeechTimeout,
    clearLocalCommitFallbackTimeout,
    clearResponseTimeouts,
    resetRealtimeLevel,
    stopOutputPlayback,
  ]);

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
      const outputLevel = calculateVisualAudioLevelFromSamples(samples);
      pushRealtimeLevel(outputLevel);
      const now = performance.now();
      if (
        outputLevel >= OUTPUT_LEVEL_TRACE_THRESHOLD &&
        now - lastOutputLevelTraceMsRef.current >= OUTPUT_LEVEL_TRACE_INTERVAL_MS
      ) {
        lastOutputLevelTraceMsRef.current = now;
        traceHotkeyEvent("realtime_output_audio_level_detected", {
          audioLevelBucket: audioLevelBucket(outputLevel),
          responseDeltaCount: responseDeltaCountRef.current,
        }).catch(() => {});
      }
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
        const inputLevel = calculateVisualAudioLevelFromSamples(input);
        pushRealtimeLevel(inputLevel);
        inputChunkCountRef.current += 1;
        if (
          inputChunkCountRef.current === 1 ||
          inputChunkCountRef.current % INPUT_CHUNK_TRACE_INTERVAL === 0
        ) {
          traceHotkeyEvent("realtime_input_audio_chunk_sent", {
            audioLevelBucket: audioLevelBucket(inputLevel),
            chunkCount: inputChunkCountRef.current,
          }).catch(() => {});
        }
        const now = performance.now();
        if (
          inputLevel >= INPUT_LEVEL_TRACE_THRESHOLD &&
          now - lastInputLevelTraceMsRef.current >= INPUT_LEVEL_TRACE_INTERVAL_MS
        ) {
          lastInputLevelTraceMsRef.current = now;
          traceHotkeyEvent("realtime_input_audio_level_detected", {
            audioLevelBucket: audioLevelBucket(inputLevel),
            chunkCount: inputChunkCountRef.current,
          }).catch(() => {});
        }
        const localSpeechUpdate = updateLocalSpeechDetectorState(
          localSpeechDetectorRef.current,
          inputLevel,
          now,
        );
        localSpeechDetectorRef.current = localSpeechUpdate.state;
        if (localSpeechUpdate.event === "started") {
          clearNoSpeechTimeout();
          clearLocalCommitFallbackTimeout();
          if (!serverDetectedCurrentTurnRef.current) {
            traceHotkeyEvent("realtime_local_speech_started", {
              audioLevelBucket: audioLevelBucket(inputLevel),
              chunkCount: inputChunkCountRef.current,
            }).catch(() => {});
          }
          stopOutputPlayback();
          if (responseActiveRef.current) {
            if (sendRealtimeEvent(socket, { type: "response.cancel" })) {
              traceHotkeyEvent("realtime_response_cancel_sent").catch(() => {});
            }
          }
          setRealtimeState({ status: "listening", detail: "Listening...", error: null });
        } else if (localSpeechUpdate.event === "stopped") {
          if (!serverDetectedCurrentTurnRef.current) {
            traceHotkeyEvent("realtime_local_speech_stopped", {
              audioLevelBucket: audioLevelBucket(inputLevel),
              chunkCount: inputChunkCountRef.current,
            }).catch(() => {});
            scheduleLocalCommitFallback(socket);
          }
        }
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
      scheduleNoSpeechTimeout();
    },
    [
      clearNoSpeechTimeout,
      clearLocalCommitFallbackTimeout,
      pushRealtimeLevel,
      scheduleLocalCommitFallback,
      scheduleNoSpeechTimeout,
      selectedDeviceId,
      setRealtimeState,
      stopOutputPlayback,
    ],
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
          const decision = decideRealtimeServerEvent(message, {
            responseActive: responseActiveRef.current,
            waitingForResponse: waitingForResponseRef.current,
            inputChunkCount: inputChunkCountRef.current,
            responseDeltaCount: responseDeltaCountRef.current,
          });

          if (decision.clearNoSpeechTimeout) {
            clearNoSpeechTimeout();
          }
          if (decision.clearLocalCommitFallbackTimeout) {
            clearLocalCommitFallbackTimeout();
          }
          if (decision.clearResponseTimeouts) {
            clearResponseTimeouts();
          }
          if (decision.serverDetectedCurrentTurn !== undefined) {
            serverDetectedCurrentTurnRef.current = decision.serverDetectedCurrentTurn;
          }
          if (decision.resetLocalSpeechDetector) {
            localSpeechDetectorRef.current = INITIAL_LOCAL_SPEECH_DETECTOR_STATE;
          }
          if (decision.waitingForResponse !== undefined) {
            waitingForResponseRef.current = decision.waitingForResponse;
          }
          if (decision.responseActive !== undefined) {
            responseActiveRef.current = decision.responseActive;
          }
          if (decision.responseDeltaCount !== undefined) {
            responseDeltaCountRef.current = decision.responseDeltaCount;
          }
          for (const traceEvent of decision.traceEvents) {
            traceHotkeyEvent(traceEvent.event, traceEvent.fields ?? null).catch(() => {});
          }
          if (decision.stopOutputPlayback) {
            stopOutputPlayback();
          }
          if (decision.cancelResponse) {
            if (sendRealtimeEvent(socket, { type: "response.cancel" })) {
              traceHotkeyEvent("realtime_response_cancel_sent").catch(() => {});
            }
          }
          if (decision.status) {
            setRealtimeState(decision.status);
          }
          if (decision.playOutputAudio) {
            void playOutputAudio(decision.playOutputAudio);
          }
          if (decision.scheduleResponseFallback) {
            scheduleResponseFallback(socket);
          }
          if (decision.cleanup) {
            cleanup();
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
        cleanup();
      };

      socket.onclose = () => {
        traceHotkeyEvent("realtime_websocket_closed").catch(() => {});
        if (statusRef.current !== "idle" && statusRef.current !== "error") {
          setRealtimeState({
            status: "error",
            detail: "Realtime socket closed.",
            error: "WebSocket closed",
          });
          cleanup();
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
    clearNoSpeechTimeout,
    clearLocalCommitFallbackTimeout,
    clearResponseTimeouts,
    playOutputAudio,
    scheduleResponseFallback,
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
