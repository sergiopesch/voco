export type DictationSessionPhase =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export type DictationQueuedAction = "stop" | null;

export interface DictationSessionState {
  sessionId: number;
  phase: DictationSessionPhase;
  queuedAction: DictationQueuedAction;
}

export function createDictationSessionState(): DictationSessionState {
  return {
    sessionId: 0,
    phase: "idle",
    queuedAction: null,
  };
}

export function startSession(
  state: DictationSessionState,
): DictationSessionState {
  if (state.phase !== "idle" && state.phase !== "error") {
    return state;
  }

  return {
    ...state,
    sessionId: state.sessionId + 1,
    phase: "starting",
    queuedAction: null,
  };
}

export function markRecording(
  state: DictationSessionState,
): DictationSessionState {
  if (state.phase !== "starting") {
    return state;
  }

  return { ...state, phase: "recording" };
}

export function requestToggle(
  state: DictationSessionState,
): { state: DictationSessionState; action: "start" | "stop" | "none" } {
  switch (state.phase) {
    case "idle":
    case "error":
      return { state, action: "start" };
    case "starting":
      return { state: { ...state, queuedAction: "stop" }, action: "none" };
    case "recording":
      return { state, action: "stop" };
    case "stopping":
      return { state: { ...state, queuedAction: null }, action: "none" };
  }
}

export function consumeQueuedStop(
  state: DictationSessionState,
): { state: DictationSessionState; shouldStop: boolean } {
  if (state.queuedAction !== "stop") {
    return { state, shouldStop: false };
  }

  return { state: { ...state, queuedAction: null }, shouldStop: true };
}

export function requestStop(
  state: DictationSessionState,
): DictationSessionState {
  if (state.phase !== "recording") {
    return state;
  }

  return {
    ...state,
    phase: "stopping",
    queuedAction: null,
  };
}

export function finishSessionIdle(
  state: DictationSessionState,
): DictationSessionState {
  return {
    ...state,
    phase: "idle",
    queuedAction: null,
  };
}

export function failSession(
  state: DictationSessionState,
): DictationSessionState {
  return {
    ...state,
    phase: "error",
    queuedAction: null,
  };
}
