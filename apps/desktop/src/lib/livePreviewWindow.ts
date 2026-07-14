import {
  reconcileFinalCursorText,
  stableLivePreviewPrefix,
  withCursorAppendSeparator,
} from "@/lib/liveCommitPolicy";
import type { PreviewTranscription } from "@/types";

export interface AnchoredPreviewWindowAdvance {
  nextStartSample: number;
  remainingCommittedText: string;
  remainingPreviewText: string;
  advancedSegmentCount: number;
  advancedDurationMs: number;
}

export interface SealedPreviewCommit {
  appendText: string;
  advanceDurationMs: number;
  advancedSegmentCount: number;
  remainingPreviewText: string;
}

export interface OwnedPreeditRevision {
  confirmedText: string;
  confirmedAppendText: string;
  candidateText: string;
  preeditText: string;
  provisionalText: string;
  advanceDurationMs: number;
  advancedSegmentCount: number;
}

export function reviseOwnedPreedit(
  confirmedText: string,
  previousCandidateText: string,
  nextCandidateText: string,
  preview: PreviewTranscription,
): OwnedPreeditRevision {
  const commit =
    previousCandidateText.length > 0
      ? sealedAnchoredPreviewCommit(previousCandidateText, preview)
      : null;
  const confirmedAppend = commit?.appendText
    ? withCursorAppendSeparator(confirmedText, commit.appendText)
    : "";
  const nextConfirmedText = confirmedText + confirmedAppend;
  const candidateText = commit?.appendText
    ? commit.remainingPreviewText
    : nextCandidateText.trim();
  const preeditText = withCursorAppendSeparator(
    nextConfirmedText,
    candidateText,
  );

  return {
    confirmedText: nextConfirmedText,
    confirmedAppendText: confirmedAppend,
    candidateText,
    preeditText,
    provisionalText: nextConfirmedText + preeditText,
    advanceDurationMs: commit?.advanceDurationMs ?? 0,
    advancedSegmentCount: commit?.advancedSegmentCount ?? 0,
  };
}

export function sealedAnchoredPreviewCommit(
  previousPreviewText: string,
  preview: PreviewTranscription,
): SealedPreviewCommit {
  const unchanged: SealedPreviewCommit = {
    appendText: "",
    advanceDurationMs: 0,
    advancedSegmentCount: 0,
    remainingPreviewText: preview.text.trim(),
  };
  const stableText = stableLivePreviewPrefix(
    previousPreviewText,
    preview.text,
  );
  if (stableText.length === 0 || preview.segments.length === 0) {
    return unchanged;
  }

  let segmentPrefix = "";
  let latestCommit: SealedPreviewCommit | null = null;
  for (let index = 0; index < preview.segments.length; index += 1) {
    const segment = preview.segments[index];
    if (!segment) {
      continue;
    }
    if (segment.text.trim().length === 0 || segment.endMs <= 0) {
      continue;
    }

    segmentPrefix = appendTranscriptText(segmentPrefix, segment.text);
    const stableRemainder = removeTranscriptPrefix(stableText, segmentPrefix);
    const previewRemainder = removeTranscriptPrefix(preview.text, segmentPrefix);
    if (
      stableRemainder.status !== "safe" ||
      previewRemainder.status !== "safe"
    ) {
      continue;
    }

    latestCommit = {
      appendText: segmentPrefix,
      advanceDurationMs: Math.round(segment.endMs),
      advancedSegmentCount: index + 1,
      remainingPreviewText: previewRemainder.appendText,
    };
  }

  return latestCommit ?? unchanged;
}

export function advanceAnchoredPreviewWindow(
  currentStartSample: number,
  sampleRate: number,
  committedWindowText: string,
  preview: PreviewTranscription,
): AnchoredPreviewWindowAdvance {
  const unchanged: AnchoredPreviewWindowAdvance = {
    nextStartSample: currentStartSample,
    remainingCommittedText: committedWindowText,
    remainingPreviewText: preview.text.trim(),
    advancedSegmentCount: 0,
    advancedDurationMs: 0,
  };
  if (
    committedWindowText.trim().length === 0 ||
    preview.segments.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return unchanged;
  }

  let segmentPrefix = "";
  let latestAdvance: AnchoredPreviewWindowAdvance | null = null;

  for (let index = 0; index < preview.segments.length; index += 1) {
    const segment = preview.segments[index];
    if (!segment || segment.text.trim().length === 0 || segment.endMs <= 0) {
      continue;
    }

    segmentPrefix = appendTranscriptText(segmentPrefix, segment.text);
    const committedRemainder = removeTranscriptPrefix(
      committedWindowText,
      segmentPrefix,
    );
    const previewRemainder = removeTranscriptPrefix(preview.text, segmentPrefix);
    if (
      committedRemainder.status !== "safe" ||
      previewRemainder.status !== "safe"
    ) {
      continue;
    }
    if (hasSemanticText(committedRemainder.appendText)) {
      continue;
    }

    const advancedDurationMs = Math.max(0, Math.round(segment.endMs));
    latestAdvance = {
      nextStartSample:
        currentStartSample +
        Math.max(1, Math.round((advancedDurationMs / 1000) * sampleRate)),
      remainingCommittedText: "",
      remainingPreviewText: previewRemainder.appendText,
      advancedSegmentCount: index + 1,
      advancedDurationMs,
    };
  }

  return latestAdvance ?? unchanged;
}

function hasSemanticText(text: string): boolean {
  return /[A-Za-z0-9]/u.test(text);
}

function removeTranscriptPrefix(
  text: string,
  prefix: string,
): ReturnType<typeof reconcileFinalCursorText> {
  const trimmedText = text.trimStart();
  if (trimmedText.startsWith(prefix)) {
    return {
      status: "safe",
      appendText: trimmedText.slice(prefix.length).trimStart(),
    };
  }

  const reconciliation = reconcileFinalCursorText(prefix, trimmedText);
  return reconciliation.status === "safe"
    ? { status: "safe", appendText: reconciliation.appendText.trimStart() }
    : reconciliation;
}

function appendTranscriptText(current: string, next: string): string {
  const appendText = next.trim();
  if (appendText.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return appendText;
  }

  const firstAppend = appendText.charAt(0);
  return /[.!?,;:)]/.test(firstAppend)
    ? `${current}${appendText}`
    : `${current} ${appendText}`;
}
