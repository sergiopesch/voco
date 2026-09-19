// Exercise the actual hook callbacks and queue with a delayed native dispatch.
import { beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import source from "@/lib/dictationRecording.ts?raw";
const transport = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport }));
import { BenchmarkPhraseQueue, type PasteCorrelation } from "@/lib/benchmarkPhraseQueue";
import type { DesktopStreamEvent } from "@/lib/desktopPhraseStream";

function callbacks(scope: Record<string, unknown>) {
  const ast = ts.createSourceFile("useDictation.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let constructor: ts.NewExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isNewExpression(node) && node.expression.getText(ast) === "BenchmarkPhraseQueue") constructor = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const args = constructor?.arguments;
  if (!args?.[0] || !args[3]) throw new Error("Production paste/preview callbacks unavailable");
  const code = ts.transpileModule(`const paste = ${args[0].getText(ast)}; const preview = ${args[3].getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(scope), `${code}; return {paste, preview};`)(...Object.values(scope)) as {
    paste(text: string, correlation: PasteCorrelation): Promise<void>;
    preview(event: DesktopStreamEvent, durationMs?: number): void;
  };
}

beforeEach(() => {
  transport.mockReset().mockImplementation(async (_command, { request }) => ({
    ...request, mode: "append-only", text: request.op === "push" || request.op === "finish" ? "Words." : null,
  }));
});

it.each(["cancelled", "restarted"])("keeps late native success out of the %s session UI while preserving queue evidence", async stage => {
  let currentSession = 1;
  const cancelledRef = { current: null as string | null };
  const desktopPhrasePasteCountRef = { current: 0 };
  const recordingStartedAtMsRef = { current: performance.now() };
  const desktopTargetTokenRef = { current: "first-target" };
  const trace = vi.fn<(event: string, detail?: unknown) => Promise<void>>().mockResolvedValue(undefined);
  const metrics = vi.fn();
  let release!: () => void;
  const nativePaste = vi.fn(async () => {
    if (nativePaste.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return { strategy: "clipboard", outcome: "dispatched" };
  });
  const create = (startingSessionId: number) => {
    const { paste, preview } = callbacks({
      startingSessionId, cancelledRef, desktopPhrasePasteCountRef,
      recordingStartedAtMsRef, desktopTargetTokenRef,
      isCurrentSession: (id: number) => id === currentSession,
      assertOutputAllowed: (id: number) => { if (id !== currentSession || cancelledRef.current) throw new Error("cancelled or replaced"); },
      pasteDesktopText: nativePaste, traceDictationEvent: trace, traceDesktopPasteMetrics: metrics,
    });
    return new BenchmarkPhraseQueue(paste, vi.fn(), vi.fn(), preview, startingSessionId);
  };
  const oldQueue = create(1);
  oldQueue.pushAudio(new Float32Array(1600), 16000);
  await vi.waitFor(() => expect(release).toBeDefined());
  cancelledRef.current = "cancelled";
  oldQueue.cancel();
  let newQueue: BenchmarkPhraseQueue | undefined;
  if (stage === "restarted") {
    // Discard resets cancellation; the next Start replaces session-bound refs.
    cancelledRef.current = null; currentSession = 2;
    desktopPhrasePasteCountRef.current = 0;
    recordingStartedAtMsRef.current = performance.now();
    desktopTargetTokenRef.current = "second-target";
    newQueue = create(2);
  }
  const countBeforeCompletion = desktopPhrasePasteCountRef.current;
  trace.mockClear(); metrics.mockClear();
  release(); await oldQueue.finish();
  expect(trace).not.toHaveBeenCalled(); expect(metrics).not.toHaveBeenCalled();
  expect(desktopPhrasePasteCountRef.current).toBe(countBeforeCompletion);
  const terminal = transport.mock.calls.map(c => c[1].request)
    .find(r => r.op === "quality" && r.event === "terminal" && r.dictation_session_id === 1);
  expect(terminal).toMatchObject({ outcome: "cancelled", dispatched_count: 1 });
  if (newQueue) {
    newQueue.pushAudio(new Float32Array(1600),16000);newQueue.enqueue();await newQueue.finish();
    expect(trace.mock.calls.filter(c => c[0] === "dictation_desktop_live_prefix_dispatched")).toHaveLength(1);
    expect(desktopPhrasePasteCountRef.current).toBe(1);
    expect(metrics).toHaveBeenCalledOnce();
    expect(trace.mock.calls.some(c => c[0] === "dictation_desktop_first_phrase_dispatched")).toBe(true);
    expect(nativePaste.mock.calls).toHaveLength(2);
  }
});
