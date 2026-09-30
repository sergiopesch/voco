import { describe, expect, it } from "vitest";
import {
  consumeQueuedStop,
  createDictationSessionState,
  failSession,
  finishSessionIdle,
  markRecording,
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

  it("ignores repeated hotkeys while stopping", () => {
    const state = requestStop(markRecording(startSession(createDictationSessionState())));

    let toggle = requestToggle(state);
    expect(toggle.action).toBe("none");
    expect(toggle.state.queuedAction).toBeNull();

    toggle = requestToggle(toggle.state);
    expect(toggle.action).toBe("none");
    expect(toggle.state.queuedAction).toBeNull();
  });

  it("allows a new recording only after stopping reaches idle or error", () => {
    let state = markRecording(startSession(createDictationSessionState()));
    state = requestStop(state);

    expect(requestToggle(state).action).toBe("none");

    state = finishSessionIdle(state);
    expect(requestToggle(state).action).toBe("start");

    state = failSession(requestStop(markRecording(startSession(state))));
    expect(requestToggle(state).action).toBe("start");
  });

  it("completes repeated start-stop toggle cycles without stale state", () => {
    let state = createDictationSessionState();

    for (let session = 1; session <= 20; session += 1) {
      const start = requestToggle(state);
      expect(start.action).toBe("start");
      state = markRecording(startSession(start.state));

      const stop = requestToggle(state);
      expect(stop.action).toBe("stop");
      state = requestStop(stop.state);
      expect(requestToggle(state).action).toBe("none");

      state = finishSessionIdle(state);
      expect(state.phase).toBe("idle");
      expect(state.sessionId).toBe(session);
      expect(state.queuedAction).toBeNull();
    }
  });
});
