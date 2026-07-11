export type DictationSessionPhase =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "processing"
  | "finalizing"
  | "error";

export type DictationQueuedAction = "stop" | null;

export interface DictationSessionState {
  sessionId: number;
  phase: DictationSessionPhase;
  previewGeneration: number;
  insertionGeneration: number;
  committedCursorTextLength: number;
  livePreviewDisabled: boolean;
  liveCursorInsertionDisabled: boolean;
  lastPreviewDurationMs: number | null;
  queuedAction: DictationQueuedAction;
  cancellationRequested: boolean;
}

export interface DictationPreviewToken {
  sessionId: number;
  generation: number;
}

export function createDictationSessionState(): DictationSessionState {
  return {
    sessionId: 0,
    phase: "idle",
    previewGeneration: 0,
    insertionGeneration: 0,
    committedCursorTextLength: 0,
    livePreviewDisabled: false,
    liveCursorInsertionDisabled: false,
    lastPreviewDurationMs: null,
    queuedAction: null,
    cancellationRequested: false,
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
    previewGeneration: state.previewGeneration + 1,
    insertionGeneration: state.insertionGeneration + 1,
    committedCursorTextLength: 0,
    livePreviewDisabled: false,
    liveCursorInsertionDisabled: false,
    lastPreviewDurationMs: null,
    queuedAction: null,
    cancellationRequested: false,
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
    case "processing":
    case "finalizing":
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
    previewGeneration: state.previewGeneration + 1,
    cancellationRequested: true,
    queuedAction: null,
  };
}

export function markProcessing(
  state: DictationSessionState,
): DictationSessionState {
  if (state.phase !== "stopping") {
    return state;
  }

  return { ...state, phase: "processing" };
}

export function markFinalizing(
  state: DictationSessionState,
): DictationSessionState {
  if (state.phase !== "processing") {
    return state;
  }

  return { ...state, phase: "finalizing", insertionGeneration: state.insertionGeneration + 1 };
}

export function finishSessionIdle(
  state: DictationSessionState,
): DictationSessionState {
  return {
    ...state,
    phase: "idle",
    committedCursorTextLength: 0,
    queuedAction: null,
    cancellationRequested: false,
  };
}

export function failSession(
  state: DictationSessionState,
): DictationSessionState {
  return {
    ...state,
    phase: "error",
    queuedAction: null,
    cancellationRequested: false,
  };
}

export function createPreviewToken(
  state: DictationSessionState,
): DictationPreviewToken {
  return {
    sessionId: state.sessionId,
    generation: state.previewGeneration,
  };
}

export function isActivePreviewToken(
  state: DictationSessionState,
  token: DictationPreviewToken,
): boolean {
  return (
    state.phase === "recording" &&
    state.sessionId === token.sessionId &&
    state.previewGeneration === token.generation &&
    !state.livePreviewDisabled &&
    !state.cancellationRequested
  );
}

export function recordPreviewDuration(
  state: DictationSessionState,
  token: DictationPreviewToken,
  durationMs: number,
): DictationSessionState {
  if (!isActivePreviewToken(state, token)) {
    return state;
  }

  return { ...state, lastPreviewDurationMs: durationMs };
}

export function addCommittedCursorText(
  state: DictationSessionState,
  text: string,
): DictationSessionState {
  if (text.length === 0) {
    return state;
  }

  return {
    ...state,
    committedCursorTextLength: state.committedCursorTextLength + Array.from(text).length,
  };
}

export function clearCommittedCursorText(
  state: DictationSessionState,
): DictationSessionState {
  return { ...state, committedCursorTextLength: 0 };
}

export function disableLiveCursorInsertion(
  state: DictationSessionState,
): DictationSessionState {
  return { ...state, liveCursorInsertionDisabled: true };
}

export function disableLivePreview(
  state: DictationSessionState,
): DictationSessionState {
  return {
    ...state,
    livePreviewDisabled: true,
    liveCursorInsertionDisabled: true,
    previewGeneration: state.previewGeneration + 1,
  };
}
