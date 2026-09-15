// Execute the production lifecycle functions with deterministic IPC. This proves
// ownership ordering, not physical shortcut delivery or microphone capture.
import { expect, it, vi } from "vitest";
import ts from "typescript";
import source from "./useDictation.ts?raw";
import { DesktopShortcutSession } from "@/lib/desktopShortcutSession";
import * as session from "@/lib/dictationSession";
import { errorMessage } from "@/lib/dictationRecovery";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function production(scope: Record<string, unknown>) {
  const names = ["releaseDesktopShortcutSession", "startRecording", "stopRecording", "finalizeIdleState", "retainRecovery", "cancelRecording", "isCurrentSession", "assertOutputAllowed"];
  const ast = ts.createSourceFile("useDictation.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(ast));
    if (ts.isReturnStatement(node) && node.expression && ts.isArrowFunction(node.expression) && node.expression.body.getText(ast).includes("disposedRef.current = true")) {
      found.set("unmount", `function unmount() ${node.expression.body.getText(ast)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (found.size !== names.length + 1) throw new Error("Production shortcut lifecycle functions unavailable");
  const code = ts.transpileModule([...found.values()].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(scope), `${code}; return {${[...names, "unmount"].join(",")}};`)(...Object.values(scope)) as {
    startRecording(trigger?: string): Promise<void>;
    stopRecording(): Promise<void>;
    cancelRecording(reason?: string): Promise<void>;
    finalizeIdleState(): void;
    retainRecovery(reason: string): void;
    releaseDesktopShortcutSession(owner?: DesktopShortcutSession): Promise<boolean>;
    unmount(): void;
  };
}

function harness() {
  const ref = <T>(current: T) => ({ current });
  const phase = ref("idle");
  const current = ref(session.createDictationSessionState());
  const owner = ref<DesktopShortcutSession | null>(null);
  const cleanup = ref<Promise<boolean>>(Promise.resolve(true));
  const cancelled = ref<string | null>(null);
  const queue = ref<{ finish(): Promise<void>; cancel(): void } | null>(null);
  const disposed = ref(false);
  const begin = vi.fn<(id: string, epoch: number) => Promise<void>>(async () => {});
  const end = vi.fn<(id: string) => Promise<void>>(async () => {});
  const state = {
    config: { transcriptTarget: "cursor", transcriptEnhancement: "off" },
    recovery: null as unknown, transcript: "", setCaptureNotice: vi.fn(),
    setSurface: vi.fn(), setLastDictationResult: vi.fn(), setRawTranscript: vi.fn(),
    setRecovery: vi.fn((value: unknown) => { state.recovery = value; }),
  };
  const status = { shortcutEpoch: 7, enabled: true, available: true, streamingEnabled: true, targetToken: "guarded-target" as string | null };
  const target = ref<string | null>(null);
  const pasteStatus = vi.fn(async () => status);
  // Deliberately end startup at source selection after shortcut acquisition.
  // The real failure path must release ownership; no microphone is opened.
  const captureSelection = vi.fn(() => ({ backend: "native", selectionToken: "" }));
  const trace = vi.fn(async () => {});
  const setError = vi.fn();
  const scope: Record<string, unknown> = {
    ...session, requestSessionStop: session.requestStop, DesktopShortcutSession, errorMessage,
    useStore: { getState: () => state }, phaseRef: phase, sessionRef: current,
    desktopShortcutSessionRef: owner, desktopShortcutCleanupRef: cleanup,
    desktopPhraseQueueRef: queue, cancelledRef: cancelled, disposedRef: disposed,
    desktopTargetTokenRef: target,
    beginDesktopShortcutSession: begin, endDesktopShortcutSession: end,
    getDesktopPasteStatus: pasteStatus, captureSelectionRef: ref(captureSelection),
    traceDictationEvent: trace, traceHotkeyEvent: trace, setError,
    teardownAudioGraph: vi.fn(async () => 16000), clearLiveCursorText: vi.fn(async () => {}),
    showNotification: vi.fn(async () => {}), waitForLiveCursorInsertion: vi.fn(async () => {}),
    recordingSampleRate: () => 16000, AudioCaptureFlushError: class extends Error {},
    audioBufferRef: ref({ sampleCount: 0 }), cursorDeliveryStateRef: ref("idle"),
    lifecycleEpochRef: ref(0), audioContextRef: ref(null),
    ownedPreeditSessionIdRef: ref(null), primedStreamRef: ref(null),
    primedStreamPromiseRef: ref(null),
  };
  for (const name of ["activeTriggerIdRef", "recoveryAudioRef", "sessionConfigRef", "recoverySessionIdRef", "nativeCaptureRef", "captureDescriptorRef", "canonicalSessionRef", "recordingStartedAtMsRef", "stopRequestedAtMsRef", "canonicalCheckpointInFlightRef", "livePreviewInFlightRef", "recoveryWaitRef", "captureHealthRef", "workletFlushRef"]) scope[name] = ref(null);
  for (const name of ["desktopStreamedSampleCountRef", "desktopPhrasePasteCountRef", "captureGenerationRef"]) scope[name] = ref(0);
  for (const name of ["desktopPasteSessionRef", "desktopStreamEnabledRef", "manualCopyRequestedRef"]) scope[name] = ref(false);
  for (const name of ["releaseRecordingOrigin", "setCancellationPending", "setCanCancel", "setStatus", "setInterimTranscript", "setMicrophoneReadyState", "resetAudioLevel", "clearCapturedAudio", "clearCanonicalAudioCache", "transitionCursorDelivery", "retainCurrentTranscript", "setTranscript", "stopLivePreview", "enqueueDesktopPhrase", "clearLivePreviewTimer", "disconnectAudioGraph", "resetOwnedPreeditState"]) scope[name] = vi.fn();
  return { ...production(scope), state, phase, current, owner, cleanup, cancelled, queue, begin, end, status, pasteStatus, captureSelection, trace, setError, disposed, target };
}

it("captures a read-only target first, then waits for begin before source selection; failed startup cleans up", async () => {
  const h = harness(), begun = deferred();
  h.begin.mockImplementation(() => begun.promise);
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.begin).toHaveBeenCalledOnce());
  const id = h.begin.mock.calls[0]![0];
  expect(h.begin).toHaveBeenCalledExactlyOnceWith(id, 7);
  expect(h.pasteStatus.mock.invocationCallOrder[0]).toBeLessThan(h.begin.mock.invocationCallOrder[0]!);
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.end).not.toHaveBeenCalled();
  begun.resolve(); await starting;
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.end).toHaveBeenCalledExactlyOnceWith(id);
  expect(h.owner.current).toBeNull();
});

it("a failed begin prevents capture and still ends the uncertain owner", async () => {
  const h = harness(); h.begin.mockRejectedValue(new Error("shortcut unavailable"));
  await h.startRecording();
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.end).toHaveBeenCalledExactlyOnceWith(h.begin.mock.calls[0]![0]);
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_shortcut_acquire_failed");
});

it.each(["browser", "enhancement", "not-streaming"])("retains the existing %s route without a shortcut lease", async route => {
  const h = harness();
  if (route === "enhancement") h.state.config.transcriptEnhancement = "on";
  if (route === "not-streaming") h.status.streamingEnabled = false;
  await h.startRecording(route === "browser" ? "browser:test" : undefined);
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.begin).not.toHaveBeenCalled(); expect(h.end).not.toHaveBeenCalled();
});

it.each([null, "first-visible-target"])("reprobes an initially obscured target after the native ACK: %s", async target => {
  const h = harness();
  h.status.targetToken = null;
  h.pasteStatus.mockResolvedValueOnce(h.status).mockResolvedValueOnce({ ...h.status, targetToken: target });
  await h.startRecording();
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.pasteStatus).toHaveBeenCalledTimes(2);
  expect(h.pasteStatus.mock.invocationCallOrder[1]).toBeGreaterThan(h.begin.mock.invocationCallOrder[0]!);
  expect(h.target.current).toBe(target);
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.end).toHaveBeenCalledOnce();
});

it("never reprobes or replaces an initially valid target after shortcut acquisition", async () => {
  const h = harness();
  h.begin.mockImplementation(async () => { h.status.targetToken = "different-focused-target"; });
  await h.startRecording();
  expect(h.pasteStatus).toHaveBeenCalledOnce();
  expect(h.target.current).toBe("guarded-target");
});

it("a late second target probe cannot resume capture after cancellation", async () => {
  const h = harness(), probed = deferred();
  h.status.targetToken = null;
  h.pasteStatus.mockResolvedValueOnce(h.status).mockImplementationOnce(async () => {
    await probed.promise; return { ...h.status, targetToken: "late-target" };
  });
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.pasteStatus).toHaveBeenCalledTimes(2));
  await h.cancelRecording("cancelled");
  probed.resolve(); await starting;
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.target.current).toBeNull();
  expect(h.end).toHaveBeenCalledOnce();
});

it("serializes replacement behind old cleanup and late startup only ends its own UUID", async () => {
  const h = harness(), begun = deferred(), released = deferred();
  h.begin.mockImplementationOnce(() => begun.promise);
  h.end.mockImplementationOnce(() => released.promise);
  const oldStart = h.startRecording();
  await vi.waitFor(() => expect(h.begin).toHaveBeenCalledOnce());
  const oldId = h.begin.mock.calls[0]![0];
  h.phase.current = "error";
  const freshStart = h.startRecording();
  begun.resolve();
  await vi.waitFor(() => expect(h.end).toHaveBeenCalledWith(oldId));
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.captureSelection).not.toHaveBeenCalled();
  released.resolve(); await Promise.all([oldStart, freshStart]);
  expect(h.begin).toHaveBeenCalledTimes(2);
  const freshId = h.begin.mock.calls[1]![0];
  expect(freshId).not.toBe(oldId);
  expect(h.end.mock.calls.map(call => call[0])).toEqual([oldId, freshId]);
  expect(h.captureSelection).toHaveBeenCalledOnce();
});

it.each(["success", "failure"])("retains shortcut through delayed queue.finish and releases after %s", async outcome => {
  const h = harness(), finished = deferred();
  h.owner.current = new DesktopShortcutSession({ begin: h.begin, end: h.end }, h.status.shortcutEpoch, vi.fn());
  await h.owner.current.acquire();
  h.phase.current = "recording";
  h.current.current = session.startSession(h.current.current);
  const finish = vi.fn(() => finished.promise);
  h.queue.current = { finish, cancel: vi.fn() };
  const stopping = h.stopRecording();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(h.end).not.toHaveBeenCalled();
  if (outcome === "success") finished.resolve(); else finished.reject(new Error("delivery unconfirmed"));
  await stopping; await h.cleanup.current;
  expect(h.end).toHaveBeenCalledOnce();
  expect(h.phase.current).toBe(outcome === "success" ? "idle" : "error");
});

it.each(["cancel", "unmount"])("cleans up after %s while begin is pending", async action => {
  const h = harness(), begun = deferred();
  h.begin.mockImplementation(() => begun.promise);
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.begin).toHaveBeenCalledOnce());
  if (action === "cancel") await h.cancelRecording("cancelled"); else h.unmount();
  expect(h.end).not.toHaveBeenCalled();
  begun.resolve(); await starting; await h.cleanup.current;
  expect(h.end).toHaveBeenCalledExactlyOnceWith(h.begin.mock.calls[0]![0]);
  expect(h.captureSelection).not.toHaveBeenCalled();
});

it("reports unconfirmed cleanup with finite metadata and blocks the next guarded capture", async () => {
  const h = harness(); h.end.mockRejectedValue(new Error("private native failure"));
  await h.startRecording();
  expect(h.state.setCaptureNotice).toHaveBeenCalledWith("VOCO could not confirm shortcut cleanup. Restart VOCO if the shortcut stays reserved.");
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_shortcut_release_failed", { dictationSessionId: 1 });
  h.captureSelection.mockClear();
  await h.startRecording();
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.setError).toHaveBeenLastCalledWith(expect.stringContaining("could not confirm shortcut cleanup"));
});


it("keeps the first preflight epoch while waiting for old cleanup; stale begin prevents capture", async () => {
  const h = harness(), oldCleanup = deferred();
  h.cleanup.current = oldCleanup.promise.then(() => true);
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.pasteStatus).toHaveBeenCalledOnce());
  // Native reload happens after the old preflight and before its queued Begin.
  h.status.shortcutEpoch = 8;
  h.begin.mockImplementation(async (_id, epoch) => {
    if (epoch !== h.status.shortcutEpoch) throw new Error("The recording window changed. Start a new recording.");
  });
  oldCleanup.resolve(); await starting;
  expect(h.begin).toHaveBeenCalledExactlyOnceWith(expect.any(String), 7);
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.end).toHaveBeenCalledOnce();
  expect(h.setError).toHaveBeenCalledWith(expect.stringContaining("window changed"));
});
