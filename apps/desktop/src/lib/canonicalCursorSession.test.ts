import { describe, expect, it } from "vitest";
import {
  CANONICAL_CHUNK_SAMPLES,
  CANONICAL_STRIDE_SAMPLES,
  acknowledgeCanonicalDelivery,
  activateCanonicalDelivery,
  beginCanonicalTranscription,
  canonicalTranscriptionRanges,
  completeCanonicalTranscription,
  createCanonicalCursorSession,
  createCanonicalPreviewToken,
  failCanonicalTranscription,
  finishCanonicalSession,
  isCanonicalPreviewTokenActive,
  markCanonicalDeliveryUncertain,
  planFinalCanonicalRange,
  planFinalSourceBlock,
  planNextCompleteCanonicalRange,
  planNextCompleteSourceBlock,
  recordCanonicalSourceBlock,
  requestCanonicalStop,
} from "@/lib/canonicalCursorSession";

describe("canonical cursor session", () => {
  it("plans stable source blocks at an arbitrary capture rate", () => {
    let state = createCanonicalCursorSession(1, 44_100);
    const first = planNextCompleteSourceBlock(state, 44_100 * 30);
    expect(first).toEqual({
      blockIndex: 0,
      startSample: 0,
      endSample: 1_323_000,
      complete: true,
    });
    state = recordCanonicalSourceBlock(state, first!, CANONICAL_CHUNK_SAMPLES);

    const second = planNextCompleteSourceBlock(state, 44_100 * 59);
    expect(second).toEqual({
      blockIndex: 1,
      startSample: 1_323_000,
      endSample: 2_601_900,
      complete: true,
    });
    state = recordCanonicalSourceBlock(state, second!, CANONICAL_STRIDE_SAMPLES);

    expect(planNextCompleteSourceBlock(state, 44_100 * 87)).toBeNull();
    expect(planNextCompleteSourceBlock(state, 44_100 * 88)?.startSample).toBe(
      2_601_900,
    );
  });

  it.each([
    [29.9, [[0, 478_400]]],
    [30, [[0, 480_000]]],
    [30.1, [[0, 480_000], [464_000, 481_600]]],
    [59, [[0, 480_000], [464_000, 944_000]]],
    [66.5339375, [[0, 480_000], [464_000, 944_000], [928_000, 1_064_543]]],
  ])("plans exact canonical boundaries for %s seconds", (seconds, expected) => {
    const ranges = canonicalTranscriptionRanges(Math.round(seconds * 16_000));
    expect(ranges.map((range) => [range.startSample, range.endSample])).toEqual(
      expected,
    );
  });

  it("matches the native 10-minute range count and tail", () => {
    const ranges = canonicalTranscriptionRanges(600 * 16_000);
    expect(ranges).toHaveLength(21);
    expect(ranges[0]).toMatchObject({ startSample: 0, endSample: 480_000 });
    expect(ranges[1]).toMatchObject({ startSample: 464_000, endSample: 944_000 });
    expect(ranges[ranges.length - 1]).toMatchObject({
      startSample: 9_280_000,
      endSample: 9_600_000,
      complete: false,
    });
  });

  it("does not create an overlap-only final range at an exact boundary", () => {
    let state = createCanonicalCursorSession(1, 16_000);
    const block = planNextCompleteSourceBlock(state, 480_000)!;
    state = recordCanonicalSourceBlock(state, block, 480_000);
    const range = planNextCompleteCanonicalRange(state)!;
    state = beginCanonicalTranscription(state, range);
    state = completeCanonicalTranscription(state, {
      canonicalText: "hello",
      appendText: "hello",
      chunkText: "hello",
    });

    expect(planFinalCanonicalRange(state)).toBeNull();
    expect(planFinalSourceBlock(state, 480_000)).toBeNull();
  });

  it("plans and completes a partial final after a full checkpoint", () => {
    let state = createCanonicalCursorSession(1, 16_000);
    const fullBlock = planNextCompleteSourceBlock(state, 481_600)!;
    state = recordCanonicalSourceBlock(state, fullBlock, 480_000);
    let range = planNextCompleteCanonicalRange(state)!;
    state = beginCanonicalTranscription(state, range);
    state = completeCanonicalTranscription(state, {
      canonicalText: "first",
      appendText: "first",
      chunkText: "first",
    });
    const finalBlock = planFinalSourceBlock(state, 481_600)!;
    state = recordCanonicalSourceBlock(state, finalBlock, 1_600);
    range = planFinalCanonicalRange(state)!;

    expect(range).toEqual({
      chunkIndex: 1,
      startSample: 464_000,
      endSample: 481_600,
      complete: false,
    });
  });

  it.each([44_100, 48_000, 96_000])(
    "treats a one-frame-short %s Hz render that rounds up as a complete range",
    (sourceSampleRate) => {
      let state = createCanonicalCursorSession(1, sourceSampleRate);
      const capturedSamples = sourceSampleRate * 30 - 1;
      const sourceBlock = planFinalSourceBlock(state, capturedSamples)!;
      const roundedTargetSamples = Math.ceil(
        (sourceBlock.endSample - sourceBlock.startSample) /
          sourceSampleRate *
          16_000,
      );
      expect(roundedTargetSamples).toBe(CANONICAL_CHUNK_SAMPLES);
      state = recordCanonicalSourceBlock(
        state,
        sourceBlock,
        roundedTargetSamples,
      );
      expect(planNextCompleteCanonicalRange(state)).toMatchObject({
        startSample: 0,
        endSample: CANONICAL_CHUNK_SAMPLES,
        complete: true,
      });
    },
  );

  it.each([44_100, 48_000, 96_000])(
    "treats a one-frame-short 59-second %s Hz tail as the second complete range",
    (sourceSampleRate) => {
      let state = createCanonicalCursorSession(1, sourceSampleRate);
      const firstBlock = planNextCompleteSourceBlock(
        state,
        sourceSampleRate * 59 - 1,
      )!;
      state = recordCanonicalSourceBlock(
        state,
        firstBlock,
        CANONICAL_CHUNK_SAMPLES,
      );
      state = beginCanonicalTranscription(
        state,
        planNextCompleteCanonicalRange(state)!,
      );
      state = completeCanonicalTranscription(state, {
        canonicalText: "first",
        appendText: "first",
        chunkText: "first",
      });

      const capturedSamples = sourceSampleRate * 59 - 1;
      const sourceBlock = planFinalSourceBlock(state, capturedSamples)!;
      const roundedTargetSamples = Math.ceil(
        (sourceBlock.endSample - sourceBlock.startSample) /
          sourceSampleRate *
          16_000,
      );
      expect(roundedTargetSamples).toBe(CANONICAL_STRIDE_SAMPLES);
      state = recordCanonicalSourceBlock(
        state,
        sourceBlock,
        roundedTargetSamples,
      );
      expect(planNextCompleteCanonicalRange(state)).toMatchObject({
        startSample: 464_000,
        endSample: 944_000,
        complete: true,
      });
    },
  );

  it("rejects a response that rewrites a non-empty canonical prefix", () => {
    let state = createCanonicalCursorSession(1, 16_000);
    let block = planNextCompleteSourceBlock(state, 944_000)!;
    state = recordCanonicalSourceBlock(state, block, 480_000);
    state = beginCanonicalTranscription(
      state,
      planNextCompleteCanonicalRange(state)!,
    );
    state = completeCanonicalTranscription(state, {
      canonicalText: "first prefix",
      appendText: "first prefix",
      chunkText: "first prefix",
    });
    block = planNextCompleteSourceBlock(state, 944_000)!;
    state = recordCanonicalSourceBlock(state, block, 464_000);
    const expectedRange = planNextCompleteCanonicalRange(state)!;
    state = beginCanonicalTranscription(state, expectedRange);

    expect(() =>
      completeCanonicalTranscription(state, {
        canonicalText: "rewritten prefix tail",
        appendText: " tail",
        chunkText: "tail",
      }),
    ).toThrow(/revised its prior prefix/u);
    const retry = failCanonicalTranscription(state);
    expect(retry.inFlightRange).toBeNull();
    expect(planNextCompleteCanonicalRange(retry)).toEqual(expectedRange);
  });

  it("keeps canonical text separate from exact target acknowledgement", () => {
    let state = activateCanonicalDelivery(
      createCanonicalCursorSession(1, 16_000),
    );
    const block = planNextCompleteSourceBlock(state, 480_000)!;
    state = recordCanonicalSourceBlock(state, block, 480_000);
    state = beginCanonicalTranscription(
      state,
      planNextCompleteCanonicalRange(state)!,
    );
    state = completeCanonicalTranscription(state, {
      canonicalText: "canonical",
      appendText: "canonical",
      chunkText: "canonical",
    });
    expect(state.acknowledgedTargetText).toBe("");

    state = acknowledgeCanonicalDelivery(state, "", "canonical");
    expect(state.acknowledgedTargetText).toBe(state.canonicalText);
    expect(() => acknowledgeCanonicalDelivery(state, "", "canonical")).toThrow(
      /out of sequence/u,
    );
  });

  it("invalidates previews for checkpoint, stop, and uncertain delivery", () => {
    let state = createCanonicalCursorSession(1, 16_000);
    const initialToken = createCanonicalPreviewToken(state);
    const block = planNextCompleteSourceBlock(state, 480_000)!;
    state = recordCanonicalSourceBlock(state, block, 480_000);
    state = beginCanonicalTranscription(
      state,
      planNextCompleteCanonicalRange(state)!,
    );
    expect(isCanonicalPreviewTokenActive(state, initialToken)).toBe(false);

    state = failCanonicalTranscription(state);
    const postCheckpointToken = createCanonicalPreviewToken(state);
    expect(isCanonicalPreviewTokenActive(state, postCheckpointToken)).toBe(true);
    state = requestCanonicalStop(state);
    expect(isCanonicalPreviewTokenActive(state, postCheckpointToken)).toBe(false);
    expect(markCanonicalDeliveryUncertain(state).delivery).toBe("uncertain");
  });

  it("executes the pinned 44.1 kHz source and canonical range sequence statefully", () => {
    const capturedSourceSamples = 2_934_146;
    let state = activateCanonicalDelivery(
      createCanonicalCursorSession(7, 44_100),
    );
    const sourceRanges: Array<[number, number]> = [];
    const canonicalRanges: Array<[number, number]> = [];

    for (const nextText of ["first", "first second"]) {
      const block = planNextCompleteSourceBlock(
        state,
        capturedSourceSamples,
      )!;
      sourceRanges.push([block.startSample, block.endSample]);
      state = recordCanonicalSourceBlock(
        state,
        block,
        block.blockIndex === 0
          ? CANONICAL_CHUNK_SAMPLES
          : CANONICAL_STRIDE_SAMPLES,
      );
      const range = planNextCompleteCanonicalRange(state)!;
      canonicalRanges.push([range.startSample, range.endSample]);
      const previous = state.canonicalText;
      state = beginCanonicalTranscription(state, range);
      state = completeCanonicalTranscription(state, {
        canonicalText: nextText,
        appendText: nextText.slice(previous.length),
        chunkText: nextText,
      });
      state = acknowledgeCanonicalDelivery(
        state,
        state.acknowledgedTargetText,
        state.canonicalText.slice(state.acknowledgedTargetText.length),
      );
    }

    state = requestCanonicalStop(state);
    const finalBlock = planFinalSourceBlock(state, capturedSourceSamples)!;
    sourceRanges.push([finalBlock.startSample, finalBlock.endSample]);
    const finalCanonicalSampleCount = Math.ceil(
      (finalBlock.endSample - finalBlock.startSample) / 44_100 * 16_000,
    );
    expect(finalCanonicalSampleCount).toBe(120_543);
    state = recordCanonicalSourceBlock(
      state,
      finalBlock,
      finalCanonicalSampleCount,
    );
    const finalRange = planFinalCanonicalRange(state)!;
    canonicalRanges.push([finalRange.startSample, finalRange.endSample]);
    state = beginCanonicalTranscription(state, finalRange);
    state = completeCanonicalTranscription(state, {
      canonicalText: "first second final",
      appendText: " final",
      chunkText: "final",
    });
    state = acknowledgeCanonicalDelivery(state, "first second", " final");
    state = finishCanonicalSession(state, capturedSourceSamples);

    expect(sourceRanges).toEqual([
      [0, 1_323_000],
      [1_323_000, 2_601_900],
      [2_601_900, 2_934_146],
    ]);
    expect(canonicalRanges).toEqual([
      [0, 480_000],
      [464_000, 944_000],
      [928_000, 1_064_543],
    ]);
    expect(state.phase).toBe("complete");
    expect(state.acknowledgedTargetText).toBe(state.canonicalText);
  });

  it("executes the complete ten-minute source/range sequence statefully", () => {
    const sourceSampleRate = 44_100;
    const capturedSourceSamples = sourceSampleRate * 600;
    let state = createCanonicalCursorSession(8, sourceSampleRate);
    let completeRangeCount = 0;
    while (true) {
      const block = planNextCompleteSourceBlock(
        state,
        capturedSourceSamples,
      );
      if (!block) {
        break;
      }
      state = recordCanonicalSourceBlock(
        state,
        block,
        block.blockIndex === 0
          ? CANONICAL_CHUNK_SAMPLES
          : CANONICAL_STRIDE_SAMPLES,
      );
      const range = planNextCompleteCanonicalRange(state)!;
      state = beginCanonicalTranscription(state, range);
      state = completeCanonicalTranscription(state, {
        canonicalText: state.canonicalText + "x",
        appendText: "x",
        chunkText: "x",
      });
      completeRangeCount += 1;
    }
    expect(completeRangeCount).toBe(20);
    expect(state.processedSourceEndSample).toBe(sourceSampleRate * 581);

    state = requestCanonicalStop(state);
    const finalBlock = planFinalSourceBlock(state, capturedSourceSamples)!;
    expect([finalBlock.startSample, finalBlock.endSample]).toEqual([
      sourceSampleRate * 581,
      sourceSampleRate * 600,
    ]);
    state = recordCanonicalSourceBlock(
      state,
      finalBlock,
      19 * 16_000,
    );
    const finalRange = planFinalCanonicalRange(state)!;
    expect(finalRange).toMatchObject({
      startSample: 9_280_000,
      endSample: 9_600_000,
      complete: false,
    });
    state = beginCanonicalTranscription(state, finalRange);
    state = completeCanonicalTranscription(state, {
      canonicalText: state.canonicalText + "z",
      appendText: "z",
      chunkText: "z",
    });
    state = finishCanonicalSession(state, capturedSourceSamples);
    expect(state.completedChunkCount).toBe(21);
    expect(state.phase).toBe("complete");
  });

  it("rejects planner-inconsistent blocks and incomplete completion", () => {
    const recording = createCanonicalCursorSession(1, 16_000);
    expect(() =>
      recordCanonicalSourceBlock(
        recording,
        {
          blockIndex: 0,
          startSample: 0,
          endSample: 479_999,
          complete: true,
        },
        CANONICAL_CHUNK_SAMPLES,
      ),
    ).toThrow(/planned boundary/u);
    expect(() => finishCanonicalSession(recording, 0)).toThrow(/stopping/u);

    const stopping = requestCanonicalStop(recording);
    expect(() => finishCanonicalSession(stopping, 1)).toThrow(/source prefix/u);
  });
});
