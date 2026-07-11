import { describe, expect, it } from "vitest";
import {
  appendableFinalCursorText,
  appendableLiveCursorText,
  clampLivePreviewDelay,
  liveCursorCommitDecision,
  nextLiveCursorFallbackDecision,
  nextLivePreviewDelay,
  reconcileFinalCursorText,
  shouldUseFastLivePreviewConfirmation,
  stableLivePreviewPrefix,
  stableLivePreviewText,
} from "@/lib/liveCommitPolicy";

describe("live cursor streaming", () => {
  it("streams only stable live preview prefixes", () => {
    expect(
      stableLivePreviewPrefix("Okay, let's give it", "Okay, let's give it a"),
    ).toBe("Okay, let's give it");
    expect(
      stableLivePreviewPrefix("Okay, let's give it.", "Okay, let's give it."),
    ).toBe(
      "Okay, let's give it.",
    );
    expect(stableLivePreviewPrefix("Okay", "Okay there")).toBe("Okay");
  });

  it("appends live text without rewriting already typed text", () => {
    expect(appendableLiveCursorText("", "Okay, let's give it", "Okay, let's give it a")).toBe(
      "Okay, let's give it",
    );
    expect(
      appendableLiveCursorText(
        "Okay, let's give",
        "Okay, let's give it",
        "Okay, let's give it a",
      ),
    ).toBe(
      " it",
    );
    expect(
      appendableLiveCursorText(
        "Okay, let's give",
        "Okay, let's give it",
        "Okay, let's give this",
      ),
    ).toBe("");
  });

  it("continues live streaming across punctuation-only preview changes", () => {
    expect(
      appendableLiveCursorText("Okay lets", "Okay, let's give", "Okay, let's give it"),
    ).toBe(" give");
    expect(
      appendableLiveCursorText("hello world", "Hello, world this", "Hello, world this works"),
    ).toBe(" this");
  });

  it("continues when the rolling preview window advances past earlier committed text", () => {
    expect(
      appendableLiveCursorText(
        "This is a longer dictation that has already been typed at the cursor",
        "typed at the cursor and now the next",
        "typed at the cursor and now the next phrase",
      ),
    ).toBe(" and now the next");
  });

  it("uses rolling overlap when previews no longer share a common prefix", () => {
    expect(
      stableLivePreviewText(
        "This is a longer dictation with rolling previews",
        "longer dictation with rolling previews and more words",
      ),
    ).toBe("longer dictation with rolling previews");

    expect(
      appendableLiveCursorText(
        "This is a longer dictation",
        "This is a longer dictation with rolling previews",
        "longer dictation with rolling previews and more words",
      ),
    ).toBe(" with rolling previews");
  });

  it("keeps appending as the preview window slides forward", () => {
    expect(
      appendableLiveCursorText(
        "This is a longer dictation with rolling previews",
        "longer dictation with rolling previews and more words",
        "dictation with rolling previews and more words appearing",
      ),
    ).toBe(" and more words");
  });

  it("appends stable advanced rolling previews without requiring the full session prefix", () => {
    expect(
      appendableLiveCursorText(
        "This paragraph was already typed earlier.",
        "Now we continue with another stable",
        "Now we continue with another stable phrase",
      ),
    ).toBe(" Now we continue with another stable");
  });

  it("continues after a short initial commit when later stable previews are disjoint", () => {
    expect(
      appendableLiveCursorText(
        "I feel like this is a test.",
        "I'm testing it as we speak and I can see",
        "I'm testing it as we speak and I can see words coming",
      ),
    ).toBe(" I'm testing it as we speak and I can see");
  });

  it("uses word overlap when punctuation or casing changes hide character overlap", () => {
    expect(
      appendableLiveCursorText(
        "I can see words coming",
        "Words, coming through clearly now",
        "words coming through clearly now and continuing",
      ),
    ).toBe(" through clearly now");
  });

  it("does not duplicate a rolling preview that is already committed", () => {
    expect(
      appendableLiveCursorText(
        "This paragraph was already typed earlier.",
        "was already typed earlier",
        "was already typed earlier.",
      ),
    ).toBe("");
  });

  it("waits on unsafe live rewrites instead of deleting committed text", () => {
    expect(
      liveCursorCommitDecision("Okay broken", "Okay, let's give", "Okay, let's give it"),
    ).toEqual({ appendText: "", reason: "unsafe-rewrite" });
  });

  it("finalizes only by safe append", () => {
    expect(appendableFinalCursorText("Okay, let's give", "Okay, let's give it a try.")).toBe(
      " it a try.",
    );
    expect(appendableFinalCursorText("Okay lets", "Okay, let's give it a try.")).toBe(
      " give it a try.",
    );
    expect(appendableFinalCursorText("Okay broken", "Okay, let's give it a try.")).toBe("");
  });

  it("classifies final cursor reconciliation explicitly", () => {
    expect(reconcileFinalCursorText("Okay, let's give", "Okay, let's give it a try.")).toEqual({
      status: "safe",
      appendText: " it a try.",
    });
    expect(reconcileFinalCursorText("Okay lets", "Okay, let's give it a try.")).toEqual({
      status: "safe",
      appendText: " give it a try.",
    });
    expect(reconcileFinalCursorText("Okay broken", "Okay, let's give it a try.")).toEqual({
      status: "unsafe",
      appendText: "",
    });
  });

  it("waits when previews shorten or have no stable prefix", () => {
    expect(stableLivePreviewPrefix("The quick brown", "The quick")).toBe("");
    expect(stableLivePreviewPrefix("alpha beta", "gamma beta")).toBe("");
    expect(appendableLiveCursorText("The quick", "The quick brown", "The quick")).toBe("");
  });

  it("does not duplicate repeated words already committed", () => {
    expect(
      appendableLiveCursorText(
        "I think",
        "I think think this",
        "I think this works",
      ),
    ).toBe("");
    expect(
      appendableLiveCursorText(
        "I think",
        "I think this",
        "I think this works",
      ),
    ).toBe(" this");
  });

  it("uses fast confirmation cadence only before first live text appears", () => {
    expect(clampLivePreviewDelay(50, true)).toBe(250);
    expect(clampLivePreviewDelay(50, false)).toBe(800);
    expect(nextLivePreviewDelay(725, true)).toBe(250);
    expect(nextLivePreviewDelay(725, false)).toBe(875);
    expect(nextLivePreviewDelay(1800, false)).toBe(1400);
    expect(
      shouldUseFastLivePreviewConfirmation({
        firstLiveTextInserted: false,
        liveCursorInsertionDisabled: false,
        liveCursorMode: "stable-cursor-streaming",
        transcriptTarget: "cursor",
      }),
    ).toBe(true);
    expect(
      shouldUseFastLivePreviewConfirmation({
        firstLiveTextInserted: true,
        liveCursorInsertionDisabled: false,
        liveCursorMode: "stable-cursor-streaming",
        transcriptTarget: "cursor",
      }),
    ).toBe(false);
  });

  it("backs off preview cadence after live cursor streaming falls back", () => {
    expect(
      shouldUseFastLivePreviewConfirmation({
        firstLiveTextInserted: false,
        liveCursorInsertionDisabled: true,
        liveCursorMode: "stable-cursor-streaming",
        transcriptTarget: "cursor",
      }),
    ).toBe(false);
    expect(
      shouldUseFastLivePreviewConfirmation({
        firstLiveTextInserted: false,
        liveCursorInsertionDisabled: false,
        liveCursorMode: "preview-overlay-only",
        transcriptTarget: "cursor",
      }),
    ).toBe(false);
    expect(
      shouldUseFastLivePreviewConfirmation({
        firstLiveTextInserted: false,
        liveCursorInsertionDisabled: false,
        liveCursorMode: "stable-cursor-streaming",
        transcriptTarget: "clipboard",
      }),
    ).toBe(false);
  });

  it("falls back after repeated blocked live cursor commits", () => {
    let blockedCount = 0;

    for (let index = 0; index < 3; index += 1) {
      const decision = nextLiveCursorFallbackDecision(
        "unsafe-rewrite",
        blockedCount,
      );
      blockedCount = decision.blockedCommitCount;
      expect(decision.shouldFallback).toBe(false);
    }

    const fallback = nextLiveCursorFallbackDecision(
      "waiting-for-stable-preview",
      blockedCount,
    );
    expect(fallback).toEqual({
      blockedCommitCount: 4,
      shouldFallback: true,
    });

    expect(nextLiveCursorFallbackDecision("append", fallback.blockedCommitCount)).toEqual({
      blockedCommitCount: 0,
      shouldFallback: false,
    });
    expect(nextLiveCursorFallbackDecision("already-committed", 2)).toEqual({
      blockedCommitCount: 0,
      shouldFallback: false,
    });
  });

});
