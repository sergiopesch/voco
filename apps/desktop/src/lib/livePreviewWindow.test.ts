import { describe, expect, it } from "vitest";
import {
  advanceAnchoredPreviewWindow,
  reviseOwnedPreedit,
  sealedAnchoredPreviewCommit,
} from "@/lib/livePreviewWindow";

describe("anchored live preview window", () => {
  it("advances only through timestamped segments covered by all committed words", () => {
    expect(
      advanceAnchoredPreviewWindow(48_000, 48_000, "Hello world", {
        text: "Hello world and this continues",
        segments: [
          { text: "Hello world", startMs: 0, endMs: 1_200 },
          { text: "and this continues", startMs: 1_200, endMs: 2_500 },
        ],
      }),
    ).toEqual({
      nextStartSample: 105_600,
      remainingCommittedText: "",
      remainingPreviewText: "and this continues",
      advancedSegmentCount: 1,
      advancedDurationMs: 1_200,
    });
  });

  it("does not advance across audio whose words have not been committed", () => {
    expect(
      advanceAnchoredPreviewWindow(0, 16_000, "Hello", {
        text: "Hello world",
        segments: [{ text: "Hello world", startMs: 0, endMs: 900 }],
      }),
    ).toMatchObject({
      nextStartSample: 0,
      remainingCommittedText: "Hello",
      advancedSegmentCount: 0,
    });
  });

  it("accepts punctuation-only differences when sealing a segment", () => {
    expect(
      advanceAnchoredPreviewWindow(0, 16_000, "Hello world", {
        text: "Hello, world. Next phrase",
        segments: [
          { text: "Hello, world.", startMs: 0, endMs: 1_000 },
          { text: "Next phrase", startMs: 1_000, endMs: 1_800 },
        ],
      }),
    ).toMatchObject({
      nextStartSample: 16_000,
      remainingCommittedText: "",
      remainingPreviewText: "Next phrase",
      advancedSegmentCount: 1,
    });
  });

  it("does not orphan words committed from a partially sealed next segment", () => {
    expect(
      advanceAnchoredPreviewWindow(920_808, 44_100, ". As", {
        text: "Okay. As a... Do you guys use teams at all?",
        segments: [
          { text: "Okay.", startMs: 0, endMs: 1_000 },
          { text: "As a...", startMs: 1_000, endMs: 2_000 },
          {
            text: "Do you guys use teams at all?",
            startMs: 2_000,
            endMs: 4_000,
          },
        ],
      }),
    ).toEqual({
      nextStartSample: 920_808,
      remainingCommittedText: ". As",
      remainingPreviewText: "Okay. As a... Do you guys use teams at all?",
      advancedSegmentCount: 0,
      advancedDurationMs: 0,
    });
  });

  it("commits only whole timestamped segments confirmed by consecutive previews", () => {
    expect(
      sealedAnchoredPreviewCommit("Hello world and", {
        text: "Hello world and this continues",
        segments: [
          { text: "Hello world", startMs: 0, endMs: 1_200 },
          { text: "and this continues", startMs: 1_200, endMs: 2_500 },
        ],
      }),
    ).toEqual({
      appendText: "Hello world",
      advanceDurationMs: 1_200,
      advancedSegmentCount: 1,
      remainingPreviewText: "and this continues",
    });
  });

  it("does not commit a stable prefix that ends inside an unstable segment", () => {
    expect(
      sealedAnchoredPreviewCommit("Or how this is going to work", {
        text: "Or how this is gonna work",
        segments: [
          { text: "Or how this is gonna work", startMs: 0, endMs: 2_000 },
        ],
      }),
    ).toEqual({
      appendText: "",
      advanceDurationMs: 0,
      advancedSegmentCount: 0,
      remainingPreviewText: "Or how this is gonna work",
    });
  });

  it("shows the first preview immediately without waiting for confirmation", () => {
    expect(
      reviseOwnedPreedit("", "", "Hello from the first preview", {
        text: "Hello from the first preview",
        segments: [
          { text: "Hello from the first preview", startMs: 0, endMs: 1_400 },
        ],
      }),
    ).toEqual({
      confirmedText: "",
      confirmedAppendText: "",
      candidateText: "Hello from the first preview",
      preeditText: "Hello from the first preview",
      provisionalText: "Hello from the first preview",
      advanceDurationMs: 0,
      advancedSegmentCount: 0,
    });
  });

  it("revises unconfirmed words while preserving the sealed prefix", () => {
    expect(
      reviseOwnedPreedit(
        "Earlier words",
        "are gonna be revised",
        "are going to be revised cleanly",
        {
          text: "are going to be revised cleanly",
          segments: [
            { text: "are going to be revised", startMs: 0, endMs: 1_500 },
            { text: "cleanly", startMs: 1_500, endMs: 2_000 },
          ],
        },
      ),
    ).toMatchObject({
      confirmedText: "Earlier words",
      confirmedAppendText: "",
      candidateText: "are going to be revised cleanly",
      preeditText: " are going to be revised cleanly",
      provisionalText: "Earlier words are going to be revised cleanly",
      advanceDurationMs: 0,
    });
  });

  it("moves only whole stable segments into the confirmed prefix", () => {
    expect(
      reviseOwnedPreedit("Earlier words", "Hello world and", "Hello world and more", {
        text: "Hello world and more",
        segments: [
          { text: "Hello world", startMs: 0, endMs: 1_000 },
          { text: "and more", startMs: 1_000, endMs: 1_800 },
        ],
      }),
    ).toEqual({
      confirmedText: "Earlier words Hello world",
      confirmedAppendText: " Hello world",
      candidateText: "and more",
      preeditText: " and more",
      provisionalText: "Earlier words Hello world and more",
      advanceDurationMs: 1_000,
      advancedSegmentCount: 1,
    });
  });

  it("keeps only the changing tail in the preedit after a stable segment seals", () => {
    const revision = reviseOwnedPreedit(
      "",
      "This stable sentence is followed by",
      "This stable sentence is followed by a changing tail",
      {
        text: "This stable sentence is followed by a changing tail",
        segments: [
          { text: "This stable sentence", startMs: 0, endMs: 1_100 },
          { text: "is followed by a changing tail", startMs: 1_100, endMs: 2_400 },
        ],
      },
    );

    expect(revision.confirmedText).toBe("This stable sentence");
    expect(revision.confirmedAppendText).toBe("This stable sentence");
    expect(revision.preeditText).toBe(" is followed by a changing tail");
    expect(revision.preeditText.length).toBeLessThan(
      revision.provisionalText.length,
    );
  });

});
