// Execute actual hook functions with deterministic dependencies and timers.
// Mounted React/worklet coverage is retained separately; these tests require
// no microphone, native decoder, or new public hook API.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampLivePreviewDelay } from "@/lib/liveCommitPolicy";
import ts from "typescript";
import * as sessions from "@/lib/dictationSession";
import source from "./useDictation.ts?raw";
interface HookFunctions {
  clearLivePreviewTimer(): void;
  scheduleLivePreview(delayMs?: number): void;
  pumpCanonicalCheckpoints(): void;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => resolve = r);
  return {
    promise,
    resolve
  };
}
function extract(text: string, scope: Record<string, unknown>) {
  const ast = ts.createSourceFile("hook.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ["clearLivePreviewTimer", "scheduleLivePreview", "pumpCanonicalCheckpoints"];
  const found = new Map<string, string>();
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) {
      found.set(n.name.text, n.getText(ast));
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  if (found.size !== names.length) {
    throw Error("Actual source function missing");
  }
  const code = ts.transpileModule([...found.values()].join("\n"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None
    }
  }).outputText;
  return new Function(...Object.keys(scope), code + ";return {clearLivePreviewTimer,scheduleLivePreview,pumpCanonicalCheckpoints};")(...Object.values(scope)) as HookFunctions;
}
function harness(text = source) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const sessionRef = {
    current: sessions.markRecording(sessions.startSession(sessions.createDictationSessionState()))
  };
  const phaseRef = {
    current: "recording"
  };
  const canonicalSessionRef = {
    current: {}
  };
  const canonicalCheckpointInFlightRef = {
    current: null as Promise<void> | null
  };
  const canonicalCheckpointDeferredRef = {
    current: false
  };
  const livePreviewTimeoutRef = {
    current: null as ReturnType<typeof setTimeout> | null
  };
  const livePreviewNextDelayMsRef = {
    current: 100
  };
  const times: number[] = [];
  const gate = deferred();
  let work = false;
  let block = false;
  let throwPlan = false;
  const clear = vi.fn((id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const processCanonicalWork = vi.fn(async () => {
    work = false;
    sessionRef.current = sessions.invalidateLivePreview(sessionRef.current);
    api.clearLivePreviewTimer();
    await gate.promise;
  });
  const prepareCanonicalSourceBlock = vi.fn(async () => {
    block = false;
    await gate.promise;
  });
  const planCanonicalWork = vi.fn(() => {
    if (throwPlan) {
      throw Error("Invalid canonical cache");
    }
    return work ? {
      kind: "range"
    } : null;
  });
  const planNextCompleteSourceBlock = vi.fn(() => block ? {} : null);
  const warning = vi.fn();
  const trace = vi.fn(async () => {
  });
  const scope = {
    sessionRef,
    phaseRef,
    canonicalSessionRef,
    canonicalCheckpointInFlightRef,
    canonicalCheckpointDeferredRef,
    livePreviewTimeoutRef,
    livePreviewNextDelayMsRef,
    audioBufferRef: {
      current: {
        sampleCount: 0
      }
    },
    planCanonicalWork,
    planNextCompleteSourceBlock,
    processCanonicalWork,
    prepareCanonicalSourceBlock,
    isCurrentSession: (id: number) => id === sessionRef.current.sessionId,
    shouldRunLivePreview: () => !sessionRef.current.livePreviewDisabled,
    createPreviewToken: sessions.createPreviewToken,
    shouldUseFastLiveConfirmation: () => false,
    clampLivePreviewDelay,
    window: {
      setTimeout,
      clearTimeout: clear
    },
    console: {
      warn: warning
    },
    traceDictationEvent: trace,
    runLivePreview: (token: sessions.DictationPreviewToken) => {
      if (!sessions.isActivePreviewToken(sessionRef.current, token)) {
        return;
      }
      times.push(Date.now());
      livePreviewNextDelayMsRef.current = 450;
      api.scheduleLivePreview();
    }
  };
  const api = extract(text, scope);
  return {
    api,
    times,
    gate,
    sessionRef,
    phaseRef,
    canonicalCheckpointInFlightRef,
    canonicalCheckpointDeferredRef,
    livePreviewTimeoutRef,
    livePreviewNextDelayMsRef,
    processCanonicalWork,
    prepareCanonicalSourceBlock,
    planCanonicalWork,
    warning,
    trace,
    clear,
    setWork: () => work = true,
    setBlock: () => block = true,
    setThrow: () => throwPlan = true
  };
}
afterEach(() => vi.useRealTimers());
describe("actual canonical pump preview timer ownership", () => {
  for (const rate of [16000, 44100, 48000]) {
    it(rate + " continuous 2048-sample arrivals preserve initial and subsequent deadlines", async () => {
      const h = harness();
      h.api.scheduleLivePreview(600);
      const original = h.livePreviewTimeoutRef.current;
      h.api.pumpCanonicalCheckpoints();
      expect(h.canonicalCheckpointInFlightRef.current).toBeNull();
      expect(h.livePreviewTimeoutRef.current).toBe(original);
      const timer = setInterval(() => h.api.pumpCanonicalCheckpoints(), 2048 / rate * 1000);
      await vi.advanceTimersByTimeAsync(1500);
      clearInterval(timer);
      expect(h.times).toEqual([450, 900, 1350]);
      expect(h.processCanonicalWork).not.toHaveBeenCalled();
      expect(h.prepareCanonicalSourceBlock).not.toHaveBeenCalled();
    });
  }
  it("canonical work pauses, waits, resumes one timer and ignores redundant pump arrivals", async () => {
    const h = harness();
    h.api.scheduleLivePreview(450);
    h.livePreviewNextDelayMsRef.current = 450;
    h.setWork();
    h.api.pumpCanonicalCheckpoints();
    const owner = h.canonicalCheckpointInFlightRef.current;
    expect(owner).not.toBeNull();
    expect(h.livePreviewTimeoutRef.current).toBeNull();
    h.api.pumpCanonicalCheckpoints();
    expect(h.canonicalCheckpointInFlightRef.current).toBe(owner);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.times).toEqual([]);
    expect(h.processCanonicalWork).toHaveBeenCalledOnce();
    h.gate.resolve();
    await owner;
    expect(h.canonicalCheckpointInFlightRef.current).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(450);
    expect(h.times).toEqual([1450]);
  });
  it("complete source block still enters original preparation pump and resumes", async () => {
    const h = harness();
    h.setBlock();
    h.api.pumpCanonicalCheckpoints();
    const owner = h.canonicalCheckpointInFlightRef.current;
    expect(owner).not.toBeNull();
    expect(h.prepareCanonicalSourceBlock).toHaveBeenCalledOnce();
    h.gate.resolve();
    await owner;
    expect(vi.getTimerCount()).toBe(1);
  });
  for (const [name, invalidate] of Object.entries({
    Stop: sessions.requestStop,
    Cancel: sessions.disableLivePreview
  }))
    it(name + " during canonical work keeps preview invalidated", async () => {
      const h = harness();
      h.setWork();
      h.api.pumpCanonicalCheckpoints();
      const owner = h.canonicalCheckpointInFlightRef.current;
      h.sessionRef.current = invalidate(h.sessionRef.current);
      h.phaseRef.current = "stopping";
      h.gate.resolve();
      await owner;
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.times).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });
  it("invalid planner uses the existing deferred error path", async () => {
    const h = harness();
    h.setThrow();
    expect(() => h.api.pumpCanonicalCheckpoints()).not.toThrow();
    await h.canonicalCheckpointInFlightRef.current;
    expect(h.canonicalCheckpointDeferredRef.current).toBe(true);
    expect(h.warning).toHaveBeenCalledOnce();
    expect(h.trace).toHaveBeenCalledExactlyOnceWith("dictation_canonical_checkpoint_failed");
    expect(h.processCanonicalWork).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });
});
