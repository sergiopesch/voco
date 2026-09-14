import { describe, expect, it } from "vitest";
import {
  CANONICAL_CHUNK_SAMPLES,
  CANONICAL_STRIDE_SAMPLES,
  acknowledgeCanonicalDelivery,
  activateCanonicalDelivery,
  beginCanonicalTranscription as beginActual,
  canonicalTranscriptionRanges,
  completeCanonicalTranscription as completeActual,
  completeCanonicalTranscriptionWithResponse,
  createCanonicalCursorSession,
  createCanonicalPreviewToken,
  failCanonicalTranscription as failActual,
  finishCanonicalSession,
  isCanonicalPreviewTokenActive,
  markCanonicalDeliveryUncertain,
  planFinalSourceBlock,
  planNextCompleteSourceBlock,
  recordCanonicalSourceBlock as recordActual,
  captureCanonicalPreparation,
  planCanonicalWork,
  invalidateCanonicalCache,
  canonicalPreviewSourceAnchor,
  type CanonicalCursorSession,
  type CanonicalSourceBlock,
  type CanonicalTranscriptionRange,
  requestCanonicalStop,
} from "@/lib/canonicalCursorSession";


// These legacy-overlap receipt fixtures preserve the old replay tests explicitly.
// Hybrid cut behavior is exercised separately below with actual numeric receipts.
function recordCanonicalSourceBlock(state: CanonicalCursorSession, block: CanonicalSourceBlock, n: number) {
  return recordActual(state, block, n, captureCanonicalPreparation(state, block));
}
function range(state: CanonicalCursorSession, finalizing: boolean): CanonicalTranscriptionRange | null {
  const work = planCanonicalWork(state, finalizing);
  if (!work) return null;
  if (work.kind === "retry") {
    const m = work.pending.metadata;
    return {chunkIndex: m.plannerSequence, startSample: m.nextInputStart,
      endSample: m.nextInputStart + m.payloadSamples, complete: m.payloadSamples === 480000};
  }
  return {...work.range, chunkIndex: state.recognition.progress.plannerSequence,
    complete: work.range.endSample - work.range.startSample === 480000};
}
const planNextCompleteCanonicalRange = (s: CanonicalCursorSession) => range(s, false);
const planFinalCanonicalRange = (s: CanonicalCursorSession) => range(s, true);
function beginCanonicalTranscription(state: CanonicalCursorSession, r: CanonicalTranscriptionRange) {
  return beginActual(state, state.recognition.pending ? undefined : new Float32Array(r.endSample-r.startSample), !r.complete);
}
function completeCanonicalTranscription(state: CanonicalCursorSession, text: {canonicalText:string;appendText:string;chunkText:string}) {
  const attempt=state.recognition.active!, m=attempt.metadata;
  const end=m.nextInputStart+m.payloadSamples;
  return completeActual(state,attempt,{protocolVersion:2,sessionId:m.sessionId,generation:m.generation,
    requestSequence:m.requestSequence,...text,receipt:{sequence:m.plannerSequence,inputStart:m.nextInputStart,
    inputEnd:end,previousDecodedEnd:m.previousDecodedEnd,leftJoinMode:m.plannerSequence===0?"initial":m.previousDecodedEnd===m.nextInputStart?"disjoint":"legacyOverlap",
    rightBoundaryMode:m.payloadSamples===480000?"legacyStride":"final",plateauStart:null,plateauEnd:null,
    nextInputStart:m.payloadSamples===480000?end-16000:end}});
}
const failCanonicalTranscription=(s:CanonicalCursorSession)=>failActual(s,s.recognition.active!);

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

  it("retains the legacy replay 10-minute range count and tail", () => {
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
    ).toThrow(/recognized prefix/u);
    const retry = failCanonicalTranscription(state);
    expect(retry.recognition.active).toBeNull();
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
    expect(state.acknowledgedTargetText).toBe(state.recognition.canonicalText);
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
    expect(isCanonicalPreviewTokenActive(state, postCheckpointToken)).toBe(false);
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
      const previous = state.recognition.canonicalText;
      state = beginCanonicalTranscription(state, range);
      state = completeCanonicalTranscription(state, {
        canonicalText: nextText,
        appendText: nextText.slice(previous.length),
        chunkText: nextText,
      });
      state = acknowledgeCanonicalDelivery(
        state,
        state.acknowledgedTargetText,
        state.recognition.canonicalText.slice(state.acknowledgedTargetText.length),
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
    expect(state.acknowledgedTargetText).toBe(state.recognition.canonicalText);
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
        canonicalText: state.recognition.canonicalText + "x",
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
      canonicalText: state.recognition.canonicalText + "z",
      appendText: "z",
      chunkText: "z",
    });
    state = finishCanonicalSession(state, capturedSourceSamples);
    expect(state.recognition.progress.plannerSequence).toBe(21);
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
    ).toThrow(/source block sequence/u);
    expect(() => finishCanonicalSession(recording, 0)).toThrow(/stopping/u);

    const stopping = requestCanonicalStop(recording);
    expect(() => finishCanonicalSession(stopping, 1)).toThrow(/source prefix/u);
  });
});


describe("hybrid ownership and source preview", () => {
  it("keeps the undecoded tail previewable after a seven-second silence core", () => {
    let state = createCanonicalCursorSession(71, 48_000);
    const block = planNextCompleteSourceBlock(state, 1_440_000)!;
    state = recordCanonicalSourceBlock(state, block, 480_000);
    state = beginActual(state, new Float32Array(480_000), true);
    const attempt = state.recognition.active!;
    const raw = {
      protocolVersion: 2, sessionId: 71, generation: 0, requestSequence: 1,
      chunkText: "", canonicalText: "", appendText: "",
      receipt: {sequence: 0, inputStart: 0, inputEnd: 112_000,
        previousDecodedEnd: 0, leftJoinMode: "initial", rightBoundaryMode: "numericalPlateau",
        plateauStart: 0, plateauEnd: 224_000, nextInputStart: 112_000},
    };
    const completed = completeCanonicalTranscriptionWithResponse(state, attempt, raw);
    state = completed.session;
    raw.receipt.inputEnd = 480_000;
    raw.canonicalText = "mutated";
    expect(completed.response.receipt.inputEnd).toBe(112_000);
    expect(Object.isFrozen(completed.response)).toBe(true);
    expect(Object.isFrozen(completed.response.receipt)).toBe(true);
    expect(canonicalPreviewSourceAnchor(state)).toBe(336_000);
    expect(state.processedSourceEndSample).toBe(1_440_000);
    expect(state.checkpointSequence).toBe(1);
    expect(planCanonicalWork(state, true)).toEqual({kind: "range", finalizing: true,
      range: {startSample: 112_000, endSample: 480_000}});
    state = beginActual(state, new Float32Array(368_000), true);
    const m = state.recognition.active!.metadata;
    state = completeActual(state, state.recognition.active!, {
      protocolVersion: 2, sessionId: m.sessionId, generation: m.generation,
      requestSequence: m.requestSequence, chunkText: "Retained tail", canonicalText: "Retained tail", appendText: "Retained tail",
      receipt: {sequence: 1, inputStart: 112_000, inputEnd: 480_000,
        previousDecodedEnd: 112_000, leftJoinMode: "disjoint", rightBoundaryMode: "final",
        plateauStart: null, plateauEnd: null, nextInputStart: 480_000},
    });
    expect(canonicalPreviewSourceAnchor(state)).toBe(1_440_000);
    expect(state.recognition.progress.plannerSequence).toBe(2);
    expect(state.processedSourceBlockCount).toBe(1);
  });

  it("fences an asynchronous source ticket and active result when the cache is cleared", () => {
    let state = createCanonicalCursorSession(72, 16_000);
    const first = planNextCompleteSourceBlock(state, 480_000)!;
    state = recordCanonicalSourceBlock(state, first, 480_000);
    const second = planNextCompleteSourceBlock(state, 944_000)!;
    const ticket = captureCanonicalPreparation(state, second);
    state = beginActual(state, new Float32Array(480_000));
    const attempt = state.recognition.active!;
    const released = invalidateCanonicalCache(state, 1);
    expect(released.ledger).toBeNull();
    expect(released.processedSourceEndSample).toBe(0);
    expect(released.canonicalAudioEndSample).toBe(0);
    expect(released.recognition.active).toBeNull();
    expect(released.recognition.pending).toBeNull();
    expect(() => recordActual(released, second, 464_000, ticket)).toThrow(/released/);
    expect(() => completeActual(released, attempt, {})).toThrow(/released/);
    expect(() => planCanonicalWork(released, true)).toThrow(/released/);
  });
});
