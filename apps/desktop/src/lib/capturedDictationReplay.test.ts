import { describe, expect, it } from "vitest";
import {
  advanceAnchoredPreviewWindow,
  reviseOwnedPreedit,
} from "@/lib/livePreviewWindow";
import { reconcileFinalCursorText } from "@/lib/liveCommitPolicy";
import type { PreviewTranscription } from "@/types";

interface CapturedPreviewFrame {
  sequence: number;
  sourceSampleRate: number;
  capturedSampleCount: number;
  previewStartSample: number;
  preview: PreviewTranscription;
  stateAfter: {
    committedCursorText: string;
    committedWindowText: string;
    nextPreviewStartSample: number;
    cursorInsertionDisabled: boolean;
  };
}

interface CapturedDictationTimeline {
  schemaVersion: number;
  finalTranscript: string;
  committedCursorText?: string;
  cursorInsertionDisabled?: boolean;
  previewFrames: CapturedPreviewFrame[];
}

const capturePath = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env?.VOCO_CAPTURE_TIMELINE;
const captureReplayVerbose =
  (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.VOCO_CAPTURE_REPLAY_VERBOSE === "1";

describe("captured dictation replay", () => {
  const capturedIt = capturePath ? it : it.skip;

  capturedIt("validates the legacy capture timeline invariants", async () => {
    const moduleName = "node:fs";
    const { existsSync, readFileSync } = (await import(
      /* @vite-ignore */ moduleName
    )) as {
      existsSync(path: string): boolean;
      readFileSync(path: string, encoding: "utf8"): string;
    };
    const timeline = JSON.parse(
      readFileSync(capturePath as string, "utf8"),
    ) as CapturedDictationTimeline;
    const audioPath = (capturePath as string).replace(/\.json$/u, ".wav");

    expect(timeline.schemaVersion).toBe(1);
    expect(existsSync(audioPath)).toBe(true);
    expect(timeline.previewFrames.length).toBeGreaterThan(1);
    expect(timeline.finalTranscript.trim().length).toBeGreaterThan(0);

    const orphaningFrames = timeline.previewFrames.filter(
      (frame) =>
        frame.stateAfter.nextPreviewStartSample > frame.previewStartSample &&
        /[A-Za-z0-9]/u.test(frame.stateAfter.committedWindowText),
    );
    for (const orphaningFrame of orphaningFrames) {
      const correctedAdvance = advanceAnchoredPreviewWindow(
        orphaningFrame.previewStartSample,
        orphaningFrame.sourceSampleRate,
        orphaningFrame.stateAfter.committedWindowText,
        orphaningFrame.preview,
      );
      expect(correctedAdvance.nextStartSample).toBe(
        orphaningFrame.previewStartSample,
      );
    }

    const finalFrame = timeline.previewFrames[timeline.previewFrames.length - 1];
    const captureDisabled =
      timeline.cursorInsertionDisabled === true ||
      finalFrame?.stateAfter.cursorInsertionDisabled === true;
    if (captureDisabled) {
      const hasCommittedCursorText =
        (timeline.committedCursorText?.length ?? 0) > 0 ||
        (finalFrame?.stateAfter.committedCursorText.length ?? 0) > 0;
      expect(
        orphaningFrames.length > 0 ||
          // Owned preedit can fail closed before VOCO commits anything to the
          // target. The final may still be appendable in isolation, but there
          // is deliberately no target-owned text to reconcile.
          !hasCommittedCursorText ||
          reconcileFinalCursorText(
            finalFrame?.stateAfter.committedCursorText ?? "",
            timeline.finalTranscript,
          ).status === "unsafe",
      ).toBe(true);
    } else {
      expect(orphaningFrames).toHaveLength(0);
      expect(
        timeline.previewFrames.some(
          (frame) =>
            frame.stateAfter.nextPreviewStartSample > frame.previewStartSample,
        ),
      ).toBe(true);
    }
  });

  capturedIt(
    "replays preview cadence and authoritative full-session ASR from the WAV",
    async () => {
      const timeline = await readCapturedTimeline(capturePath as string);
      const audioPath = (capturePath as string).replace(/\.json$/u, ".wav");
      const worker = await startPreviewReplayWorker(audioPath);

      let previewStartSample = 0;
      let candidateText = "";
      let confirmedText = "";
      let committedTargetText = "";
      let provisionalText = "";
      let progressiveCommitCount = 0;
      let maxPreeditCharacterCount = 0;
      let maxProvisionalCharacterCount = 0;
      const cursorUpdateTimesMs: number[] = [];
      let finalCursorText = "";

      try {
        for (const frame of timeline.previewFrames) {
          const capturedEndSample = Math.round(
            (frame.capturedSampleCount / frame.sourceSampleRate) * 16_000,
          );
          const previewEndSample = Math.min(
            capturedEndSample,
            previewStartSample + 20 * 16_000,
          );
          if (previewEndSample - previewStartSample < 16_000) {
            continue;
          }

          const preview = await worker.request({
            startSample: previewStartSample,
            endSample: previewEndSample,
          });
          const nextPreviewText = preview.text.trim();
          if (nextPreviewText.length === 0) {
            continue;
          }

          const revision = reviseOwnedPreedit(
            confirmedText,
            candidateText,
            nextPreviewText,
            preview,
          );
          confirmedText = revision.confirmedText;
          candidateText = revision.candidateText;
          if (revision.confirmedAppendText.length > 0) {
            committedTargetText = revision.confirmedText;
            progressiveCommitCount += 1;
          }
          provisionalText = revision.provisionalText;
          maxPreeditCharacterCount = Math.max(
            maxPreeditCharacterCount,
            revision.preeditText.length,
          );
          maxProvisionalCharacterCount = Math.max(
            maxProvisionalCharacterCount,
            revision.provisionalText.length,
          );
          cursorUpdateTimesMs.push(
            Math.round(
              (frame.capturedSampleCount / frame.sourceSampleRate) * 1000,
            ),
          );
          if (revision.advanceDurationMs > 0) {
            previewStartSample = Math.min(
              previewStartSample +
                Math.round((revision.advanceDurationMs / 1000) * 16_000),
              capturedEndSample,
            );
          }
        }

        const finalTranscription = await worker.request({
          startSample: 0,
          endSample: Number.MAX_SAFE_INTEGER,
          fullSession: true,
        });
        finalCursorText = finalTranscription.text.trim();
      } finally {
        worker.close();
      }

      const finalReferenceText = timeline.finalTranscript.trim();
      const finalWords = normalizedWords(finalReferenceText);
      const provisionalWordErrorRate = normalizedWordErrorRate(
        finalReferenceText,
        provisionalText,
      );
      const finalWordErrorRate = normalizedWordErrorRate(
        finalReferenceText,
        finalCursorText,
      );
      const updateGapsMs = cursorUpdateTimesMs
        .slice(1)
        .map((time, index) => time - (cursorUpdateTimesMs[index] ?? time));
      console.info(
        "Captured replay metrics",
        JSON.stringify({
          cursorUpdateCount: cursorUpdateTimesMs.length,
          cursorUpdateGapP50Ms: percentile(updateGapsMs, 50),
          cursorUpdateGapP95Ms: percentile(updateGapsMs, 95),
          cursorUpdateGapMaxMs: Math.max(0, ...updateGapsMs),
          progressiveCommitCount,
          committedTargetCharacterCount: committedTargetText.length,
          maxPreeditCharacterCount,
          maxProvisionalCharacterCount,
          provisionalWordCount: normalizedWords(provisionalText).length,
          finalCursorWordCount: normalizedWords(finalCursorText).length,
          referenceWordCount: finalWords.length,
          provisionalWordErrorRate,
          finalWordErrorRate,
        }),
      );
      if (captureReplayVerbose) {
        console.info(
          "Captured replay text",
          JSON.stringify({
            finalReferenceText,
            provisionalText,
            finalCursorText,
          }),
        );
      }
      const finalCursorWords = normalizedWords(finalCursorText);
      expect(cursorUpdateTimesMs.length).toBeGreaterThan(2);
      expect(provisionalText.trim().length).toBeGreaterThan(0);
      expect(progressiveCommitCount).toBeGreaterThan(0);
      expect(committedTargetText.length).toBeGreaterThan(0);
      expect(maxPreeditCharacterCount).toBeLessThan(
        maxProvisionalCharacterCount,
      );
      expect(finalCursorWords.length).toBeGreaterThanOrEqual(
        Math.floor(finalWords.length * 0.9),
      );
      expect(finalCursorWords.length).toBeLessThanOrEqual(
        Math.ceil(finalWords.length * 1.1),
      );
      expect(finalWordErrorRate).toBeLessThanOrEqual(0.02);
      // Every usable preview updates the bounded owned tail while sealed
      // phrases become native target text, so wrapping does not reintroduce
      // the old append-only 13-second stalls.
      expect(percentile(updateGapsMs, 95)).toBeLessThanOrEqual(5_000);
    },
    // Full-capture CPU inference varies substantially with host load. Keep
    // correctness and cursor-cadence limits in the assertions above instead
    // of treating machine throughput as product behavior.
    600_000,
  );
});

async function readCapturedTimeline(
  timelinePath: string,
): Promise<CapturedDictationTimeline> {
  const moduleName = "node:fs";
  const { readFileSync } = (await import(/* @vite-ignore */ moduleName)) as {
    readFileSync(path: string, encoding: "utf8"): string;
  };
  return JSON.parse(
    readFileSync(timelinePath, "utf8"),
  ) as CapturedDictationTimeline;
}

function normalizedWords(text: string): string[] {
  return Array.from(text.toLocaleLowerCase().matchAll(/[a-z0-9]+/gu)).map(
    (match) => match[0],
  );
}

function normalizedWordErrorRate(reference: string, hypothesis: string): number {
  const referenceWords = normalizedWords(reference);
  const hypothesisWords = normalizedWords(hypothesis);
  if (referenceWords.length === 0) {
    return hypothesisWords.length === 0 ? 0 : 1;
  }

  let previous = Array.from(
    { length: hypothesisWords.length + 1 },
    (_, index) => index,
  );
  for (let referenceIndex = 1; referenceIndex <= referenceWords.length; referenceIndex += 1) {
    const current = [referenceIndex];
    for (
      let hypothesisIndex = 1;
      hypothesisIndex <= hypothesisWords.length;
      hypothesisIndex += 1
    ) {
      const substitutionCost =
        referenceWords[referenceIndex - 1] === hypothesisWords[hypothesisIndex - 1]
          ? 0
          : 1;
      current[hypothesisIndex] = Math.min(
        (previous[hypothesisIndex] ?? 0) + 1,
        (current[hypothesisIndex - 1] ?? 0) + 1,
        (previous[hypothesisIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }

  return (previous[hypothesisWords.length] ?? referenceWords.length) /
    referenceWords.length;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((quantile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

interface ReplayWorker {
  request(input: {
    startSample: number;
    endSample: number;
    fullSession?: boolean;
  }): Promise<PreviewTranscription>;
  close(): void;
}

async function startPreviewReplayWorker(audioPath: string): Promise<ReplayWorker> {
  const moduleName = "node:child_process";
  const { spawn } = (await import(/* @vite-ignore */ moduleName)) as {
    spawn(
      command: string,
      args: string[],
      options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] },
    ): {
      stdin: { write(value: string): void; end(): void };
      stdout: { on(event: "data", listener: (data: unknown) => void): void };
      stderr: { on(event: "data", listener: (data: unknown) => void): void };
      on(event: "error", listener: (error: Error) => void): void;
      on(event: "exit", listener: (code: number | null) => void): void;
      kill(): void;
    };
  };
  const currentWorkingDirectory = (
    globalThis as typeof globalThis & { process?: { cwd(): string } }
  ).process?.cwd();
  if (!currentWorkingDirectory) {
    throw new Error("Cannot determine replay test working directory");
  }

  const child = spawn(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--example",
      "preview_replay_worker",
      "--",
      audioPath,
    ],
    {
      cwd: currentWorkingDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let terminalError: Error | null = null;
  const pending: Array<{
    resolve(value: PreviewTranscription): void;
    reject(error: Error): void;
  }> = [];

  const rejectPending = (error: Error) => {
    terminalError = error;
    while (pending.length > 0) {
      pending.shift()?.reject(error);
    }
  };
  child.stderr.on("data", (data) => {
    stderrBuffer += String(data);
  });
  child.stdout.on("data", (data) => {
    stdoutBuffer += String(data);
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.length > 0) {
        const waiter = pending.shift();
        if (waiter) {
          try {
            waiter.resolve(JSON.parse(line) as PreviewTranscription);
          } catch (error) {
            waiter.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }
      }
      newline = stdoutBuffer.indexOf("\n");
    }
  });
  child.on("error", rejectPending);
  child.on("exit", (code) => {
    if (code !== 0) {
      rejectPending(
        new Error(
          `Preview replay worker exited with ${code}: ${stderrBuffer.trim()}`,
        ),
      );
    }
  });

  return {
    request(input) {
      if (terminalError) {
        return Promise.reject(terminalError);
      }
      return new Promise<PreviewTranscription>((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(`${JSON.stringify(input)}\n`);
      });
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}
