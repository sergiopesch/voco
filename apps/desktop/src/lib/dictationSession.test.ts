import { describe, expect, it } from "vitest";
import {
  addCommittedCursorText,
  consumeQueuedStop,
  createDictationSessionState,
  createPreviewToken,
  disableLiveCursorInsertion,
  disableLivePreview,
  failSession,
  finishSessionIdle,
  invalidateLivePreview,
  isActivePreviewToken,
  markFinalizing,
  markProcessing,
  markRecording,
  recordPreviewDuration,
  requestStop,
  requestToggle,
  startSession,
} from "@/lib/dictationSession";

describe("dictation session state machine", () => {
  it("queues stop during startup but never queues a new start", () => {
    let state = createDictationSessionState();
    let toggle = requestToggle(state);
    expect(toggle.action).toBe("start");

    state = startSession(toggle.state);
    toggle = requestToggle(state);
    expect(toggle.action).toBe("none");
    expect(toggle.state.queuedAction).toBe("stop");

    state = markRecording(toggle.state);
    const queued = consumeQueuedStop(state);
    expect(queued.shouldStop).toBe(true);
    expect(queued.state.queuedAction).toBeNull();
  });

  it("ignores repeated hotkeys during stop, processing, and finalizing", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    state = requestStop(state);

    let toggle = requestToggle(state);
    expect(toggle.action).toBe("none");
    expect(toggle.state.queuedAction).toBeNull();

    state = markProcessing(toggle.state);
    toggle = requestToggle(state);
    expect(toggle.action).toBe("none");
    expect(toggle.state.queuedAction).toBeNull();

    state = markFinalizing(toggle.state);
    toggle = requestToggle(state);
    expect(toggle.action).toBe("none");
    expect(toggle.state.queuedAction).toBeNull();
  });

  it("invalidates preview tokens after stop", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    const token = createPreviewToken(state);

    expect(isActivePreviewToken(state, token)).toBe(true);

    state = requestStop(state);
    expect(isActivePreviewToken(state, token)).toBe(false);
    expect(recordPreviewDuration(state, token, 900).lastPreviewDurationMs).toBeNull();
  });

  it("invalidates an in-flight preview without disabling the next preview", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    const staleToken = createPreviewToken(state);

    state = invalidateLivePreview(state);

    expect(isActivePreviewToken(state, staleToken)).toBe(false);
    expect(state.livePreviewDisabled).toBe(false);
    expect(isActivePreviewToken(state, createPreviewToken(state))).toBe(true);
  });

  it("separates old preview tokens from new sessions", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    const oldToken = createPreviewToken(state);

    state = finishSessionIdle(requestStop(state));
    state = markRecording(startSession(state));

    expect(isActivePreviewToken(state, oldToken)).toBe(false);
    expect(createPreviewToken(state).sessionId).toBe(oldToken.sessionId + 1);
  });

  it("allows a new recording only after finalization reaches idle or error", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    state = markFinalizing(markProcessing(requestStop(state)));

    expect(requestToggle(state).action).toBe("none");

    state = finishSessionIdle(state);
    expect(requestToggle(state).action).toBe("start");

    state = failSession(markFinalizing(markProcessing(requestStop(markRecording(startSession(state))))));
    expect(requestToggle(state).action).toBe("start");
  });

  it("completes repeated start-stop-finalize toggle cycles without stale state", () => {
    let state = createDictationSessionState();

    for (let session = 1; session <= 20; session += 1) {
      const start = requestToggle(state);
      expect(start.action).toBe("start");
      state = markRecording(startSession(start.state));

      const stop = requestToggle(state);
      expect(stop.action).toBe("stop");
      state = markFinalizing(markProcessing(requestStop(stop.state)));
      expect(requestToggle(state).action).toBe("none");

      state = finishSessionIdle(state);
      expect(state.phase).toBe("idle");
      expect(state.sessionId).toBe(session);
      expect(state.queuedAction).toBeNull();
      expect(state.committedCursorTextLength).toBe(0);
    }
  });

  it("tracks live cursor insertion failure for the active session", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    state = addCommittedCursorText(state, "hello");
    expect(state.committedCursorTextLength).toBe(5);

    state = disableLiveCursorInsertion(state);
    expect(state.liveCursorInsertionDisabled).toBe(true);

    state = startSession(finishSessionIdle(state));
    expect(state.liveCursorInsertionDisabled).toBe(false);
    expect(state.committedCursorTextLength).toBe(0);
  });

  it("invalidates preview tokens and disables cursor insertion after live preview failure", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    const token = createPreviewToken(state);

    state = disableLivePreview(state);

    expect(state.livePreviewDisabled).toBe(true);
    expect(state.liveCursorInsertionDisabled).toBe(true);
    expect(isActivePreviewToken(state, token)).toBe(false);
    expect(recordPreviewDuration(state, token, 900).lastPreviewDurationMs).toBeNull();
  });

  it("re-enables live preview for a new session", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    state = disableLivePreview(state);
    state = markRecording(startSession(finishSessionIdle(state)));

    expect(state.livePreviewDisabled).toBe(false);
    expect(state.liveCursorInsertionDisabled).toBe(false);
    expect(isActivePreviewToken(state, createPreviewToken(state))).toBe(true);
  });
});
