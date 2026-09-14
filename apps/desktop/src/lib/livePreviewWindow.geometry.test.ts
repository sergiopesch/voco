import { describe, expect, it } from "vitest";
import {
  previewGeometryWithinSnapshot,
  reviseOwnedPreedit
} from "@/lib/livePreviewWindow";

const snapshot = {
  preparedSampleCount: 16_384,
  sourceSampleCount: 16_384,
  sourceSampleRate: 16_000
};
const preview = (startMs = 0, endMs = 1000) => ({
  text: "Hello world.",
  segments: [{
    text: "Hello world.",
    startMs,
    endMs
  }]
});

describe("preview geometry within the decoded snapshot", () => {
  it.each([
    [NaN, 1000],
    [0, NaN],
    [Infinity, 1000],
    [0, Infinity],
    [-1, 1000],
    [500, 499],
    [0, 1024.01],
  ])(
    "rejects invalid bounds %s to %s",
    (start, end) => {
      expect(previewGeometryWithinSnapshot(preview(start, end), snapshot)).toBe(false);
    }
  );
  it("requires every segment to be ordered and nonoverlapping", () => {
    const value = preview();
    value.segments.push({
      text: "More.",
      startMs: 900,
      endMs: 1024
    });
    expect(previewGeometryWithinSnapshot(value, snapshot)).toBe(false);
    value.segments[1] = {
      text: "More.",
      startMs: 0,
      endMs: 100
    };
    expect(previewGeometryWithinSnapshot(value, snapshot)).toBe(false);
  });
  it("checks both prepared duration and source duration", () => {
    expect(previewGeometryWithinSnapshot(preview(), {
      ...snapshot,
      preparedSampleCount: 11_200
    })).toBe(false);
    expect(previewGeometryWithinSnapshot(preview(), {
      ...snapshot,
      sourceSampleCount: 11_200
    })).toBe(false);
  });
  it("refuses existing millisecond rounding if it would cross the source endpoint", () => {
    expect(previewGeometryWithinSnapshot(preview(0, 1023.75), {
      ...snapshot,
      sourceSampleCount: 16_380
    })).toBe(false);
  });
  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid snapshot counts %s", count => {
    expect(previewGeometryWithinSnapshot(preview(), {
      ...snapshot,
      preparedSampleCount: count
    })).toBe(false);
    expect(previewGeometryWithinSnapshot(preview(), {
      ...snapshot,
      sourceSampleCount: count
    })).toBe(false);
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid source rates %s", rate => {
    expect(previewGeometryWithinSnapshot(preview(), {
      ...snapshot,
      sourceSampleRate: rate
    })).toBe(false);
  });
  it(
    "keeps invalid text provisional without rewriting the raw response or earlier confirmation",
    () => {
      const value = preview(0, 2000);
    const raw = structuredClone(value);
      const revision = reviseOwnedPreedit(
        "Earlier.",
        value.text,
        value.text,
        value,
        previewGeometryWithinSnapshot(value, snapshot)
      );
      expect(revision.confirmedText).toBe("Earlier.");
      expect(revision.confirmedAppendText).toBe("");
      expect(revision.advanceDurationMs).toBe(0);
      expect(revision.candidateText).toBe(value.text);
      expect(revision.provisionalText).toBe("Earlier. Hello world.");
      expect(value).toEqual(raw);
    }
  );
  it("retains ordinary sealing for valid adjacent segments", () => {
    const value = {
      text: "Hello world. More.",
      segments: [{
        text: "Hello world.",
        startMs: 0,
        endMs: 500
      }, {
        text: "More.",
        startMs: 500,
        endMs: 1024
      }]
    };
    expect(previewGeometryWithinSnapshot(value, snapshot)).toBe(true);
    const revision = reviseOwnedPreedit("", value.text, value.text, value, true);
    expect(revision.confirmedText).toBe(value.text);
    expect(revision.advanceDurationMs).toBe(1024);
  });
});
