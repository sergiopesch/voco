import { describe, expect, it } from "vitest";
import {
  advanceAnchoredPreviewWindow,
  reviseOwnedPreedit,
} from "@/lib/livePreviewWindow";
import { reconcileFinalCursorText } from "@/lib/liveCommitPolicy";
import { canonicalTranscriptionRanges } from "@/lib/canonicalCursorSession";
import type { CanonicalTranscription, PreviewTranscription } from "@/types";

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
  canonicalChunks?: Array<{
    sequence: number;
    range: {
      chunkIndex: number;
      startSample: number;
      endSample: number;
      complete: boolean;
    };
    result: CanonicalTranscription;
  }>;
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

    expect([1, 2]).toContain(timeline.schemaVersion);
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
    "replays preview cadence and exact canonical target text from the WAV",
    async () => {
      const timeline = await readCapturedTimeline(capturePath as string);
      const audioPath = (capturePath as string).replace(/\.json$/u, ".wav");
      const worker = await startPreviewReplayWorker(audioPath);

      let previewStartSample = 0;
      let candidateText = "";
      let confirmedDraftText = "";
      let provisionalText = "";
      let maxPreeditCharacterCount = 0;
      const cursorUpdateTimesMs: number[] = [];
      let canonicalText = "";
      let acknowledgedTargetText = "";
      let canonicalCheckpointCount = 0;
      const replayCanonicalTexts: string[] = [];
      const replayCanonicalRanges: Array<[number, number]> = [];

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

          const preview = await worker.requestPreview({
            startSample: previewStartSample,
            endSample: previewEndSample,
          });
          const nextPreviewText = preview.text.trim();
          if (nextPreviewText.length === 0) {
            continue;
          }

          const revision = reviseOwnedPreedit(
            confirmedDraftText,
            candidateText,
            nextPreviewText,
            preview,
          );
          confirmedDraftText = revision.confirmedText;
          candidateText = revision.candidateText;
          provisionalText = revision.provisionalText;
          maxPreeditCharacterCount = Math.max(
            maxPreeditCharacterCount,
            revision.preeditText.length,
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

        const sampleCount = await readCaptureSampleCount(audioPath);
        for (const range of canonicalTranscriptionRanges(sampleCount)) {
          replayCanonicalRanges.push([range.startSample, range.endSample]);
          const result = await worker.requestCanonical({
            startSample: range.startSample,
            endSample: range.endSample,
            canonical: true,
            previousCanonicalText: canonicalText,
          });
          expect(result.canonicalText).toBe(canonicalText + result.appendText);
          canonicalText = result.canonicalText;
          replayCanonicalTexts.push(canonicalText);
          if (range.complete) {
            acknowledgedTargetText = canonicalText;
            canonicalCheckpointCount += 1;
          }
        }
        // Stop-time finish-canonical appends the one exact remaining suffix.
        expect(canonicalText.startsWith(acknowledgedTargetText)).toBe(true);
        acknowledgedTargetText = canonicalText;
      } finally {
        worker.close();
      }

      const finalReferenceText = timeline.finalTranscript;
      const provisionalWordErrorRate = normalizedWordErrorRate(
        finalReferenceText,
        provisionalText,
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
          canonicalCheckpointCount,
          committedTargetCharacterCount: acknowledgedTargetText.length,
          maxPreeditCharacterCount,
          provisionalWordCount: normalizedWords(provisionalText).length,
          finalCursorWordCount: normalizedWords(canonicalText).length,
          referenceWordCount: normalizedWords(finalReferenceText).length,
          provisionalWordErrorRate,
        }),
      );
      if (captureReplayVerbose) {
        console.info(
          "Captured replay text",
          JSON.stringify({
            finalReferenceText,
            provisionalText,
            canonicalText,
          }),
        );
      }
      expect(cursorUpdateTimesMs.length).toBeGreaterThan(2);
      expect(provisionalText.trim().length).toBeGreaterThan(0);
      expect(canonicalCheckpointCount).toBeGreaterThan(0);
      expect(acknowledgedTargetText).toBe(finalReferenceText);
      expect(canonicalText).toBe(finalReferenceText);
      expect(percentile(updateGapsMs, 95)).toBeLessThanOrEqual(5_000);
      if (
        replayCanonicalRanges[replayCanonicalRanges.length - 1]?.[1] ===
        1_064_543
      ) {
        expect(canonicalCheckpointCount).toBe(2);
        expect(replayCanonicalRanges).toEqual([
          [0, 480_000],
          [464_000, 944_000],
          [928_000, 1_064_543],
        ]);
        expect(replayCanonicalTexts.map((text) => text.length)).toEqual([
          222, 486, 555,
        ]);
        expect(
          await Promise.all(replayCanonicalTexts.map(sha256Text)),
        ).toEqual([
          "38231922e9852c4c9989bc8b09861f58d526df1f52bb5266ec901636c9380931",
          "70295ea3f276939163a362da3871926931aa334e77950a068250c9c87f1c6284",
          "d659f33d6eee60874d0ac67d196957985d8cf0855d078ab78b8d4d5ca63bd0d7",
        ]);
      }
      if (timeline.canonicalChunks) {
        expect(
          timeline.canonicalChunks.map((chunk) => chunk.result.canonicalText),
        ).toEqual(replayCanonicalTexts);
      }
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

async function readCaptureSampleCount(audioPath: string): Promise<number> {
  const moduleName = "node:fs";
  const { readFileSync } = (await import(/* @vite-ignore */ moduleName)) as {
    readFileSync(path: string): Uint8Array;
  };
  const wav = readFileSync(audioPath);
  if (wav.length < 44) {
    throw new Error("Captured WAV is incomplete");
  }
  const dataByteLength =
    (wav[40] ?? 0) |
    ((wav[41] ?? 0) << 8) |
    ((wav[42] ?? 0) << 16) |
    ((wav[43] ?? 0) << 24);
  return Math.max(0, dataByteLength >>> 0) / 2;
}

function normalizedWords(text: string): string[] {
  return Array.from(text.toLocaleLowerCase().matchAll(/[a-z0-9]+/gu)).map(
    (match) => match[0],
  );
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
  requestPreview(input: {
    startSample: number;
    endSample: number;
  }): Promise<PreviewTranscription>;
  requestCanonical(input: {
    startSample: number;
    endSample: number;
    canonical: true;
    previousCanonicalText: string;
  }): Promise<CanonicalTranscription>;
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
    resolve(value: PreviewTranscription | CanonicalTranscription): void;
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
    requestPreview(input) {
      if (terminalError) {
        return Promise.reject(terminalError);
      }
      return new Promise<PreviewTranscription>((resolve, reject) => {
        pending.push({
          resolve: (value) => resolve(value as PreviewTranscription),
          reject,
        });
        child.stdin.write(`${JSON.stringify(input)}\n`);
      });
    },
    requestCanonical(input) {
      if (terminalError) {
        return Promise.reject(terminalError);
      }
      return new Promise<CanonicalTranscription>((resolve, reject) => {
        pending.push({
          resolve: (value) => resolve(value as CanonicalTranscription),
          reject,
        });
        child.stdin.write(`${JSON.stringify(input)}\n`);
      });
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}
