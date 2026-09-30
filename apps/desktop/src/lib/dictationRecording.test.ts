// Execute the production lifecycle factory with deterministic IPC. This proves
// Start/Stop ordering and cleanup, not physical delivery or microphone capture.
import { beforeEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc }));
import {
  appendAudioSamples,
  clearAudioCaptureBuffer,
  createAudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { AudioCaptureFlushError } from "@/lib/audioCaptureFlush";
import * as session from "@/lib/dictationSession";
import {
  createDictationRecording,
  type DictationRecordingEnv,
} from "@/lib/dictationRecording";
import type { NativeCaptureSession } from "@/lib/nativeCapture";

// Commands that reject in the current test; every other command succeeds.
const failing = new Set<string>();
beforeEach(() => {
  failing.clear();
  ipc.mockReset().mockImplementation(async (command: string, args?: { request?: object }) => {
    if (failing.has(command)) throw new Error("read-only filesystem");
    if (command === "get_crash_journal_epoch") return 1;
    if (command === "speech_stream") return { ...args?.request, mode: "append-only", text: null };
  });
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const ref = <T>(current: T) => ({ current });
  const noop = vi.fn();
  const phase = ref("idle");
  const current = ref(session.createDictationSessionState());
  const cancelled = ref<string | null>(null);
  const queue = ref<{ finish(): Promise<{ undelivered: string; uncertain?: boolean }>; cancel(): void } | null>(null);
  const pasteSession = ref(false);
  const state = {
    config: { hotkey: "Alt+D" },
    recovery: null as unknown, transcript: "", setCaptureNotice: vi.fn(),
    setSurface: vi.fn(),
    setRecovery: vi.fn((value: unknown) => { state.recovery = value; }),
    selectedDeviceId: null as string | null,
    dictationPurpose: "cursor" as "cursor" | "onboarding",
    setDictationPurpose: vi.fn((purpose: "cursor" | "onboarding") => { state.dictationPurpose = purpose; }),
    setOnboardingTestPassed: vi.fn(),
  };
  const status = { detail: "Desktop input is ready.", enabled: true, available: true, streamingEnabled: true };
  const pasteStatus = vi.fn(async () => ({ ...status }));
  // Startup ends at source selection unless a test picks a capture backend,
  // so no microphone is opened.
  const captureSelection = vi.fn(() => ({ backend: "native" as const, selectionToken: "" }));
  const copy = vi.fn(async (_text: string) => {});
  const trace = vi.fn(async (_event: string) => {});
  const setError = vi.fn();
  const notify = vi.fn(async (_summary: string, _body: string) => {});
  const audioBuffer = createAudioCaptureBuffer();
  const env = {
    phaseRef: phase,
    sessionRef: current,
    disposedRef: ref(false),
    cancelledRef: cancelled,
    browserDeliveryRef: ref(null),
    dictationStreamRef: queue,
    desktopPasteSessionRef: pasteSession,
    desktopStreamedSampleCountRef: ref(0),
    desktopPhrasePasteCountRef: ref(0),
    activeTriggerIdRef: ref<string | undefined>(undefined),
    recoverySessionIdRef: ref<string | null>(null),
    nativeCaptureRef: ref(null),
    captureDescriptorRef: ref(null),
    captureSelectionRef: ref(captureSelection),
    captureGenerationRef: ref(0),
    recordingStartedAtMsRef: ref<number | null>(null),
    stopRequestedAtMsRef: ref<number | null>(null),
    firstHotkeyPressMsRef: ref<number | null>(null),
    initialHotkeyLatencyLoggedRef: ref(false),
    debugNativeCaptureEnabledRef: ref(false),
    audioBufferRef: ref(audioBuffer),
    lifecycleEpochRef: ref(0),
    audioContextRef: ref(null),
    primedStreamRef: ref(null),
    primedStreamPromiseRef: ref(null),
    captureHealthRef: ref(null),
    workletFlushRef: ref(null),
    streamRef: ref(null),
    sourceRef: ref(null),
    primedDeviceIdRef: ref(null),
    useStore: { getState: () => state },
    getDesktopPasteStatus: pasteStatus,
    pasteDesktopText: vi.fn(async () => ({ outcome: "dispatched" })),
    copyDesktopText: copy,
    traceDictationEvent: trace,
    showNotification: notify,
    setCancellationPending: noop,
    setCanCancel: noop,
    setStatus: noop,
    setTranscript: noop,
    setError,
    setMicrophoneReadyState: vi.fn(),
    clearTranscript: vi.fn(() => { state.transcript = ""; }),
    resetAudioLevel: vi.fn(),
    updateAudioLevel: noop,
    clearCapturedAudio: vi.fn(() => clearAudioCaptureBuffer(audioBuffer)),
    transitionCursorDelivery: noop,
    recordingSampleRate: () => 16000,
    appendRecordingSamples: () => 0,
    enqueueDesktopPhrase: noop,
    teardownAudioGraph: vi.fn(async () => 16000),
    disconnectAudioGraph: noop,
    ensureAudioContext: vi.fn(async () => ({}) as AudioContext),
    openTracedMicrophoneStream: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
    connectWorklet: vi.fn(async () => true),
    connectScriptProcessor: noop,
    traceDesktopPasteMetrics: noop,
    debugNativeCaptureEnabled: vi.fn(async () => false),
    beginNativeCapture: vi.fn(),
    releaseBrowserRecording: vi.fn(async () => {}),
  } as unknown as DictationRecordingEnv;
  const recording = createDictationRecording(env);
  // Puts the harness in a live desktop recording that Stop can finish.
  const recordingWith = (finish: () => Promise<{ undelivered: string; uncertain?: boolean }>) => {
    pasteSession.current = true;
    phase.current = "recording";
    current.current = session.startSession(current.current);
    queue.current = { finish: vi.fn(finish), cancel: vi.fn() };
  };
  return {
    ...recording,
    env,
    unmount: recording.dispose,
    recordingWith,
    state, phase, current, cancelled, queue, pasteSession, status,
    pasteStatus, captureSelection, copy, trace, setError, notify,
  };
}

const journalCalls = (name: string) => ipc.mock.calls
  .filter(([command]) => command === name)
  .map(([, args]) => (args as { id: string }).id);
const journalDeletions = () => journalCalls("finish_crash_journal");

// A native recording with an open crash journal, stopped through a fixture queue.
async function journaledRecording(h: ReturnType<typeof harness>, finish: () => Promise<{ undelivered: string }>) {
  h.env.captureSelectionRef.current = () => ({ backend: "native", selectionToken: "fixture-source" });
  vi.mocked(h.env.beginNativeCapture).mockResolvedValue({
    descriptor: {}, cancel: vi.fn(async () => {}), startDelivery: vi.fn(),
  } as unknown as NativeCaptureSession);
  await h.startRecording();
  expect(h.phase.current).toBe("recording");
  h.queue.current?.cancel();
  h.queue.current = { finish: vi.fn(finish), cancel: vi.fn() };
}

it.each([
  { change: { enabled: false }, title: "Dictation could not start", notice: "Desktop dictation is unavailable. Complete desktop input setup before recording." },
  { change: { available: false, detail: "Install ydotool, then restart VOCO." }, title: "Dictation setup incomplete", notice: "Install ydotool, then restart VOCO." },
  { change: { streamingEnabled: false }, title: "Dictation could not start", notice: "Streaming dictation is disabled in the desktop environment." },
])("explains missing desktop input before capture without an error screen: $notice", async ({ change, title, notice }) => {
  const h = harness();
  Object.assign(h.status, change);
  await h.startRecording();
  expect(h.captureSelection).not.toHaveBeenCalled();
  expect(h.phase.current).toBe("idle");
  expect(h.state.setCaptureNotice).toHaveBeenCalledWith(notice);
  expect(h.notify).toHaveBeenCalledExactlyOnceWith(title, notice);
  expect(h.setError).toHaveBeenCalledWith(null);
  expect(h.env.setMicrophoneReadyState).not.toHaveBeenCalled();
});

it("reaches source selection from input readiness alone, with no destination binding", async () => {
  const h = harness();
  await h.startRecording();
  expect(h.pasteStatus).toHaveBeenCalledOnce();
  expect(h.pasteSession.current).toBe(true);
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_paste_session_started");
  // The fixture stops at source selection, after every destination check.
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.setError).toHaveBeenLastCalledWith("Choose a microphone in Microphone settings.");
});

it("notifies a live recognition failure once, not again at Stop", async () => {
  const h = harness();
  failing.add("speech_stream");
  h.env.captureSelectionRef.current = () => ({ backend: "native", selectionToken: "fixture-source" });
  vi.mocked(h.env.beginNativeCapture).mockResolvedValue({
    descriptor: {}, cancel: vi.fn(async () => {}), startDelivery: vi.fn(),
  } as unknown as NativeCaptureSession);
  const interrupted = () => h.notify.mock.calls.filter(([title]) => title === "Dictation interrupted");
  await h.startRecording();
  await vi.waitFor(() => expect(interrupted()).toHaveLength(1));
  expect(interrupted()[0]![1]).toBe("Some words may be missing. Stop dictation and check your text field.");
  await h.stopRecording();
  expect(h.phase.current).toBe("idle");
  expect(h.setError).toHaveBeenLastCalledWith("read-only filesystem.");
  expect(interrupted()).toHaveLength(1);
  // Live failures notify instead of setting a notice the popover cannot show.
  expect(h.state.setCaptureNotice.mock.calls.every(([notice]) => notice === null)).toBe(true);
});

it("notifies an unverified desktop recording once, at start", async () => {
  const h = harness();
  h.env.captureSelectionRef.current = () => ({ backend: "webkit" });
  vi.mocked(h.env.ensureAudioContext).mockResolvedValue({
    sampleRate: 16000, createMediaStreamSource: vi.fn(() => ({})),
  } as unknown as AudioContext);
  vi.mocked(h.env.openTracedMicrophoneStream).mockResolvedValue({
    getTracks: () => [], getAudioTracks: () => [],
  } as unknown as MediaStream);
  vi.mocked(h.env.connectWorklet).mockResolvedValue(false);
  await h.startRecording();
  expect(h.phase.current).toBe("recording");
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Dictation won't be typed",
    "VOCO can't confirm it is receiving all of your audio, so it won't type this recording. Stop and try again.");
  appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.125, -0.25]));
  await h.stopRecording();
  expect(h.phase.current).toBe("idle");
  expect(h.setError).toHaveBeenLastCalledWith("VOCO couldn't confirm it received all of your audio, so it didn't type this recording. Try again.");
  expect(h.notify).toHaveBeenCalledOnce();
});

it("keeps the start notice as the only one when Stop cannot flush unverified audio", async () => {
  const h = harness();
  h.env.captureSelectionRef.current = () => ({ backend: "webkit" });
  vi.mocked(h.env.ensureAudioContext).mockResolvedValue({
    sampleRate: 16000, createMediaStreamSource: vi.fn(() => ({})),
  } as unknown as AudioContext);
  vi.mocked(h.env.openTracedMicrophoneStream).mockResolvedValue({
    getTracks: () => [], getAudioTracks: () => [],
  } as unknown as MediaStream);
  vi.mocked(h.env.connectWorklet).mockResolvedValue(false);
  vi.mocked(h.env.teardownAudioGraph).mockRejectedValue(new AudioCaptureFlushError());
  await h.startRecording();
  appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.125, -0.25]));
  await h.stopRecording();
  expect(h.phase.current).toBe("idle");
  expect(h.setError).toHaveBeenLastCalledWith("VOCO couldn't confirm it received all of your audio, so it didn't type this recording. Try again.");
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Dictation won't be typed", expect.any(String));
});

it("still notifies when an interruption ends a noticed session before Stop", async () => {
  const h = harness();
  h.env.captureSelectionRef.current = () => ({ backend: "webkit" });
  vi.mocked(h.env.ensureAudioContext).mockResolvedValue({
    sampleRate: 16000, createMediaStreamSource: vi.fn(() => ({})),
  } as unknown as AudioContext);
  vi.mocked(h.env.openTracedMicrophoneStream).mockResolvedValue({
    getTracks: () => [], getAudioTracks: () => [],
  } as unknown as MediaStream);
  vi.mocked(h.env.connectWorklet).mockResolvedValue(false);
  await h.startRecording();
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Dictation won't be typed", expect.any(String));
  appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.125, -0.25]));
  await h.cancelRecording("The microphone disconnected or stopped capturing audio.");
  expect(h.phase.current).toBe("idle");
  expect(h.setError).toHaveBeenLastCalledWith("The microphone disconnected or stopped capturing audio.");
  // Without this, the next shortcut press would start a new recording
  // while the user still expects it to stop this one.
  expect(h.notify).toHaveBeenLastCalledWith("Dictation interrupted", "Some words may be missing. Check your text field before starting again.");
  expect(h.notify).toHaveBeenCalledTimes(2);
});

it("does not query desktop input for an explicit browser recording", async () => {
  const h = harness();
  await h.startRecording("browser:test");
  expect(h.captureSelection).toHaveBeenCalledOnce();
  expect(h.pasteStatus).not.toHaveBeenCalled();
});

it("records without a crash checkpoint when the journal cannot open, notifying once per launch", async () => {
  const h = harness();
  failing.add("begin_crash_journal");
  h.env.captureSelectionRef.current = () => ({ backend: "native", selectionToken: "fixture-source" });
  vi.mocked(h.env.beginNativeCapture).mockResolvedValue({
    descriptor: {}, cancel: vi.fn(async () => {}), startDelivery: vi.fn(),
  } as unknown as NativeCaptureSession);
  await h.startRecording();
  expect(ipc).toHaveBeenCalledWith("begin_crash_journal", expect.anything());
  expect(h.phase.current).toBe("recording");
  expect(h.queue.current).not.toBeNull();
  expect(h.setError).not.toHaveBeenCalled();
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Crash recovery unavailable", "Dictation continues, but VOCO can't recover it if VOCO exits unexpectedly.");
  await h.stopRecording();
  expect(h.phase.current).toBe("idle");
  await h.startRecording();
  expect(h.phase.current).toBe("recording");
  expect(h.notify).toHaveBeenCalledOnce();
  h.unmount();
  expect(journalDeletions()).toEqual([]);
});

it("a checkpoint that still cannot be deleted does not block the next Start", async () => {
  const h = harness();
  failing.add("finish_crash_journal");
  h.env.captureSelectionRef.current = () => ({ backend: "webkit" });
  vi.mocked(h.env.ensureAudioContext).mockRejectedValue(new Error("fixture capture fails"));
  await h.startRecording();
  expect(h.setError).toHaveBeenLastCalledWith(expect.stringContaining("could not be deleted"));
  const [first] = journalDeletions();
  await h.startRecording();
  expect(h.env.ensureAudioContext).toHaveBeenCalledTimes(2);
  // The old checkpoint is retried once before the new recording opens its own.
  const deletions = journalDeletions();
  expect(deletions).toHaveLength(3);
  expect(deletions.slice(0, 2)).toEqual([first, first]);
  expect(deletions[2]).not.toBe(first);
});

it.each(["capture-error", "captured-prefix", "cancelled"])("prioritizes journal cleanup failure during startup: %s", async scenario => {
  const h = harness();
  failing.add("finish_crash_journal");
  h.env.captureSelectionRef.current = () => ({ backend: "webkit" });
  vi.mocked(h.env.ensureAudioContext).mockImplementation(async () => {
    if (scenario === "captured-prefix") appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.1]));
    if (scenario === "cancelled") h.cancelled.current = "Fixture startup cancelled.";
    throw new Error("Fixture microphone failed.");
  });
  await h.startRecording();
  expect(h.setError).toHaveBeenLastCalledWith(expect.stringContaining("could not be deleted"));
  expect(h.notify).toHaveBeenLastCalledWith("Dictation interrupted", expect.stringContaining("could not be deleted"));
  expect(h.phase.current).toBe("idle");
  expect(h.state.recovery).toBeNull();
  expect(h.env.audioBufferRef.current.sampleCount).toBe(0);
});

it.each([
  { kind: "cancellation", frames: 3 },
  { kind: "failure", frames: 3 },
  { kind: "cancellation", frames: 0 },
])("$kind during WebKit startup clears $frames received samples on controlled exit", async ({ kind, frames }) => {
  const h = harness(), connecting = deferred();
  h.env.captureSelectionRef.current = () => ({ backend: "webkit" });
  vi.mocked(h.env.ensureAudioContext).mockResolvedValue({
    sampleRate: 16000, createMediaStreamSource: vi.fn(() => ({})),
  } as unknown as AudioContext);
  vi.mocked(h.env.connectWorklet).mockImplementation(async () => {
    await connecting.promise;
    return true;
  });
  const retained = new Float32Array([0.125, -0.25, 0.5]).subarray(0, frames);
  vi.mocked(h.env.teardownAudioGraph).mockImplementation(async () => {
    // A connected worklet can flush its first retained prefix during teardown,
    // even though cancellation arrived before Listening was published.
    appendAudioSamples(h.env.audioBufferRef.current, retained);
    return 16000;
  });
  const starting = h.startRecording();
  await vi.waitFor(() => expect(h.env.connectWorklet).toHaveBeenCalledOnce());
  expect(h.env.setMicrophoneReadyState).toHaveBeenCalledExactlyOnceWith(true);
  vi.mocked(h.env.resetAudioLevel).mockClear();
  if (kind === "cancellation") {
    await h.cancelRecording();
    connecting.resolve();
  } else {
    connecting.reject(new Error("Audio graph initialization failed"));
  }
  await starting;
  expect(h.env.resetAudioLevel).toHaveBeenCalledOnce();
  expect(vi.mocked(h.env.setMicrophoneReadyState).mock.calls).toEqual(
    kind === "failure" ? [[true], [false]] : [[true]],
  );
  expect(h.state.recovery).toBeNull();
  expect(h.env.audioBufferRef.current.chunks).toEqual([]);
  expect(h.phase.current).toBe("idle");
  expect(h.env.audioBufferRef.current.sampleCount).toBe(0);
  expect(h.queue.current).toBeNull();
  expect(h.env.pasteDesktopText).not.toHaveBeenCalled();
});

it("successful cursor Stop clears text and audio without opening Review or touching the clipboard", async () => {
  const h = harness();
  h.recordingWith(async () => ({ undelivered: "" }));
  h.state.transcript = "Completed fixture dictation.";
  appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.1, 0.2]));
  await h.stopRecording();
  expect(h.state.transcript).toBe("");
  expect(h.env.audioBufferRef.current.sampleCount).toBe(0);
  expect(h.state.setSurface).not.toHaveBeenCalled();
  expect(h.copy).not.toHaveBeenCalled();
  expect(h.notify).not.toHaveBeenCalled();
});

it("copies words the focused app did not take to the clipboard as a handled Stop", async () => {
  const h = harness(), finished = deferred<{ undelivered: string }>();
  h.recordingWith(() => finished.promise);
  h.state.transcript = "Typed words and the rest.";
  appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.1]));
  const stopping = h.stopRecording();
  // Deferred text is still being retried; nothing is copied before finish.
  await vi.waitFor(() => expect(h.queue.current!.finish).toHaveBeenCalledOnce());
  expect(h.copy).not.toHaveBeenCalled();
  expect(h.phase.current).toBe("stopping");
  finished.resolve({ undelivered: " and the rest." });
  await stopping;
  // The joining space stays, so pasting after "Typed words" keeps them apart.
  expect(h.copy).toHaveBeenCalledExactlyOnceWith(" and the rest.");
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_remainder_copied");
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Dictation copied to clipboard", "VOCO couldn't paste into the focused app. Press Shift+Insert or Ctrl+V to paste it.");
  expect(h.env.pasteDesktopText).not.toHaveBeenCalled();
  expect(h.phase.current).toBe("idle");
  expect(h.state.recovery).toBeNull();
  expect(h.state.transcript).toBe("");
  expect(h.env.audioBufferRef.current.sampleCount).toBe(0);
  expect(h.state.setSurface).not.toHaveBeenCalled();
  expect(h.setError).not.toHaveBeenCalled();
});

it("does not replace the clipboard for a remainder with no words", async () => {
  const h = harness();
  h.recordingWith(async () => ({ undelivered: " " }));
  await h.stopRecording();
  expect(h.copy).not.toHaveBeenCalled();
  expect(h.notify).not.toHaveBeenCalled();
  expect(h.phase.current).toBe("idle");
});

it("asks the user to check the app first when a chunk may already be there", async () => {
  const h = harness();
  h.recordingWith(async () => ({ undelivered: "Maybe typed.", uncertain: true }));
  await h.stopRecording();
  expect(h.copy).toHaveBeenCalledExactlyOnceWith("Maybe typed.");
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Dictation copied to clipboard", expect.stringContaining("Some words may already be in the app"));
});

it("keeps the dictation in Review when the Stop clipboard copy fails", async () => {
  const h = harness();
  await journaledRecording(h, async () => ({ undelivered: "Uncopied fixture words." }));
  h.copy.mockRejectedValue({ outcome: "no-mutation", message: "Clipboard helper is unavailable.", clipboardChanged: false });
  await h.stopRecording();
  expect(h.copy).toHaveBeenCalledOnce();
  expect(journalCalls("keep_crash_journal")).toEqual([h.env.recoverySessionIdRef.current]);
  expect(journalDeletions()).toEqual([]);
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_remainder_kept");
  expect(h.notify).toHaveBeenLastCalledWith("Dictation saved in Review", expect.stringContaining("Review in VOCO's menu"));
  expect(h.setError).not.toHaveBeenCalledWith(expect.any(String));
  expect(h.state.recovery).toBeNull();
  expect(h.phase.current).toBe("idle");
  // The kept session is not deleted when the next dictation starts.
  await h.startRecording();
  expect(journalDeletions()).toEqual([]);
});

it("takes the interrupted path when neither the clipboard nor Review can keep the words", async () => {
  const h = harness();
  await journaledRecording(h, async () => ({ undelivered: "Uncopied fixture words." }));
  failing.add("keep_crash_journal");
  h.copy.mockRejectedValue({ outcome: "no-mutation", message: "Clipboard helper is unavailable.", clipboardChanged: false });
  await h.stopRecording();
  expect(h.trace).not.toHaveBeenCalledWith("dictation_desktop_remainder_copied");
  expect(h.trace).not.toHaveBeenCalledWith("dictation_desktop_remainder_kept");
  expect(h.notify).toHaveBeenLastCalledWith("Dictation interrupted", expect.stringContaining("Some words may be missing"));
  expect(h.setError).toHaveBeenCalledWith("VOCO couldn't paste, copy or save this dictation.");
  expect(h.state.transcript).toBe("");
  expect(h.state.recovery).toBeNull();
  expect(h.phase.current).toBe("idle");
});

it("copies the rest when a browser field stops taking text, without finishing its lease", async () => {
  const h = harness();
  h.recordingWith(async () => ({ undelivered: " the rest.", uncertain: true }));
  h.pasteSession.current = false;
  const browser = { finish: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
  (h.env.browserDeliveryRef as { current: unknown }).current = browser;
  await h.stopRecording();
  expect(browser.finish).not.toHaveBeenCalled();
  expect(browser.cancel).toHaveBeenCalled();
  expect(h.copy).toHaveBeenCalledExactlyOnceWith(" the rest.");
  expect(h.trace).toHaveBeenCalledWith("dictation_desktop_remainder_copied");
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("Dictation copied to clipboard", expect.stringContaining("Some words may already be in the app"));
  expect(h.env.browserDeliveryRef.current).toBeNull();
  expect(h.phase.current).toBe("idle");
});

it("finishes a browser field that took every word", async () => {
  const h = harness();
  h.recordingWith(async () => ({ undelivered: "" }));
  h.pasteSession.current = false;
  const browser = { finish: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
  (h.env.browserDeliveryRef as { current: unknown }).current = browser;
  await h.stopRecording();
  expect(browser.finish).toHaveBeenCalledOnce();
  expect(h.copy).not.toHaveBeenCalled();
  expect(h.phase.current).toBe("idle");
});

it("never uses the clipboard outside a desktop paste session", async () => {
  const h = harness();
  h.recordingWith(async () => ({ undelivered: "Fixture words." }));
  h.pasteSession.current = false;
  await h.stopRecording();
  expect(h.copy).not.toHaveBeenCalled();
  expect(h.phase.current).toBe("idle");
});

it("controlled recognition failure clears private content and permits the next recording without Review", async () => {
  const h = harness();
  h.recordingWith(async () => { throw new Error("Recognition stopped responding."); });
  h.state.transcript = "Partly delivered fixture.";
  appendAudioSamples(h.env.audioBufferRef.current, new Float32Array([0.1]));
  await h.stopRecording();
  expect(h.state.transcript).toBe("");
  expect(h.state.recovery).toBeNull();
  expect(h.env.audioBufferRef.current.sampleCount).toBe(0);
  expect(h.copy).not.toHaveBeenCalled();
  expect(h.notify).toHaveBeenCalledWith("Dictation interrupted", expect.stringContaining("Some words may be missing"));
  expect(h.trace).toHaveBeenCalledWith("dictation_interrupted");
  await h.startRecording();
  expect(h.captureSelection).toHaveBeenCalledOnce();
});

it("onboarding retains its successful test text and does not create a cursor result", () => {
  const h = harness();
  h.state.dictationPurpose = "onboarding";
  h.state.transcript = "Voice test fixture.";
  h.finalizeIdleState();
  expect(h.state.transcript).toBe("Voice test fixture.");
  expect(h.state.setOnboardingTestPassed).toHaveBeenCalledWith(true);
});

it("handled unmount resets cursor store content and state", () => {
  const h = harness();
  h.state.transcript = "Synthetic in-flight text.";
  h.state.recovery = { reason: "Voice test stopped." };
  h.phase.current = "recording";
  h.unmount();
  expect(h.state.transcript).toBe("");
  expect(h.state.recovery).toBeNull();
  expect(h.phase.current).toBe("idle");
  expect(h.env.setStatus).toHaveBeenCalledWith("idle");
});
