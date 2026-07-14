export const LIVE_PREVIEW_MIN_INTERVAL_MS = 100;
export const LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS = 100;
export const LIVE_PREVIEW_MAX_INTERVAL_MS = 450;
export const LIVE_PREVIEW_INITIAL_DELAY_MS = 600;
export const LIVE_PREVIEW_TARGET_COMPLETION_INTERVAL_MS = 1100;
export const LIVE_CURSOR_BLOCKED_COMMIT_FALLBACK_THRESHOLD = 4;

export type LiveCursorCommitDecision =
  | {
      appendText: string;
      reason: "append" | "already-committed" | "waiting-for-stable-preview";
    }
  | {
      appendText: "";
      reason: "unsafe-rewrite";
    };

export type FinalCursorReconciliation =
  | { status: "safe"; appendText: string }
  | { status: "unsafe"; appendText: "" };

export type LiveCursorFallbackDecision = {
  blockedCommitCount: number;
  shouldFallback: boolean;
};

export type LivePreviewConfirmationState = {
  firstLiveTextInserted: boolean;
  liveCursorInsertionDisabled: boolean;
  liveCursorMode: string | null | undefined;
  transcriptTarget: string | null | undefined;
};

export function clampLivePreviewDelay(
  delayMs: number,
  fastConfirmation: boolean,
): number {
  const minDelayMs = fastConfirmation
    ? LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS
    : LIVE_PREVIEW_MIN_INTERVAL_MS;
  return Math.max(
    minDelayMs,
    Math.min(LIVE_PREVIEW_MAX_INTERVAL_MS, delayMs),
  );
}

export function nextLivePreviewDelay(
  previewDurationMs: number,
  fastConfirmation: boolean,
): number {
  if (fastConfirmation) {
    return LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
  }

  return clampLivePreviewDelay(
    LIVE_PREVIEW_TARGET_COMPLETION_INTERVAL_MS - previewDurationMs,
    false,
  );
}

export function shouldUseFastLivePreviewConfirmation(
  state: LivePreviewConfirmationState,
): boolean {
  return (
    state.transcriptTarget === "cursor" &&
    state.liveCursorMode === "stable-cursor-streaming" &&
    !state.firstLiveTextInserted &&
    !state.liveCursorInsertionDisabled
  );
}

export function appendableLiveCursorText(
  committedText: string,
  previousPreviewText: string,
  nextPreviewText: string,
): string {
  return liveCursorCommitDecision(
    committedText,
    previousPreviewText,
    nextPreviewText,
  ).appendText;
}

export function nextLiveCursorFallbackDecision(
  reason: LiveCursorCommitDecision["reason"],
  previousBlockedCommitCount: number,
): LiveCursorFallbackDecision {
  if (reason !== "unsafe-rewrite") {
    return { blockedCommitCount: 0, shouldFallback: false };
  }

  const blockedCommitCount = previousBlockedCommitCount + 1;
  return {
    blockedCommitCount,
    shouldFallback:
      blockedCommitCount >= LIVE_CURSOR_BLOCKED_COMMIT_FALLBACK_THRESHOLD,
  };
}

export function liveCursorCommitDecision(
  committedText: string,
  previousPreviewText: string,
  nextPreviewText: string,
): LiveCursorCommitDecision {
  const stablePreview = stableLivePreviewText(previousPreviewText, nextPreviewText);
  if (stablePreview.length === 0) {
    return { appendText: "", reason: "waiting-for-stable-preview" };
  }

  const suffixStart = findAppendStartForStablePreview(stablePreview, committedText);
  if (suffixStart === null) {
    return { appendText: "", reason: "unsafe-rewrite" };
  }

  const appendText = withCursorAppendSeparator(
    committedText,
    stablePreview.slice(suffixStart),
  );
  return {
    appendText,
    reason: appendText.length > 0 ? "append" : "already-committed",
  };
}

export function anchoredLiveCursorCommitDecision(
  committedWindowText: string,
  previousPreviewText: string,
  nextPreviewText: string,
): LiveCursorCommitDecision {
  const stablePreview = stableLivePreviewPrefix(
    previousPreviewText,
    nextPreviewText,
  );
  if (stablePreview.length === 0) {
    return { appendText: "", reason: "waiting-for-stable-preview" };
  }

  const suffixStart = findNormalizedPrefixEnd(
    stablePreview,
    committedWindowText,
  );
  if (suffixStart === null) {
    return { appendText: "", reason: "unsafe-rewrite" };
  }

  const appendText = withCursorAppendSeparator(
    committedWindowText,
    stablePreview.slice(suffixStart),
  );
  return {
    appendText,
    reason: appendText.length > 0 ? "append" : "already-committed",
  };
}

export function stableLivePreviewText(
  previousPreviewText: string,
  nextPreviewText: string,
): string {
  const stablePrefix = stableLivePreviewPrefix(previousPreviewText, nextPreviewText);
  if (stablePrefix.length > 0) {
    return stablePrefix;
  }

  return stableRollingPreviewOverlap(previousPreviewText, nextPreviewText);
}

export function appendableFinalCursorText(
  committedText: string,
  finalText: string,
): string {
  const reconciliation = reconcileFinalCursorText(committedText, finalText);
  return reconciliation.status === "safe" ? reconciliation.appendText : "";
}

export function reconcileFinalCursorText(
  committedText: string,
  finalText: string,
): FinalCursorReconciliation {
  const normalizedFinal = finalText.trim();
  const suffixStart = findNormalizedPrefixEnd(normalizedFinal, committedText);
  if (suffixStart === null) {
    return { status: "unsafe", appendText: "" };
  }

  return { status: "safe", appendText: normalizedFinal.slice(suffixStart) };
}

export function stableLivePreviewPrefix(
  previousPreviewText: string,
  nextPreviewText: string,
): string {
  const previous = previousPreviewText.trim();
  const next = nextPreviewText.trim();
  if (previous.length === 0 || next.length === 0) {
    return "";
  }

  if (previous.startsWith(next) && previous.length > next.length) {
    return "";
  }

  if (
    next.startsWith(previous) &&
    next.length > previous.length &&
    /[\s.!?,;:)\]}"']/.test(next[previous.length] ?? "")
  ) {
    return previous;
  }

  const commonPrefix = commonStringPrefix(previous, next);
  return truncateToStableBoundary(commonPrefix);
}

function truncateToStableBoundary(text: string): string {
  const trimmed = text.trimEnd();
  if (/[.!?,;:)\]}"']$/.test(trimmed)) {
    return trimmed;
  }
  const lastBoundary = Math.max(
    trimmed.lastIndexOf(" "),
    trimmed.lastIndexOf("\n"),
    trimmed.lastIndexOf("\t"),
  );

  if (lastBoundary <= 0) {
    return "";
  }

  return trimmed.slice(0, lastBoundary);
}

function stableRollingPreviewOverlap(
  previousPreviewText: string,
  nextPreviewText: string,
): string {
  const previous = previousPreviewText.trim();
  const next = nextPreviewText.trim();
  if (previous.length === 0 || next.length === 0) {
    return "";
  }

  const previousNormalized = normalizeForPrefixMatch(previous);
  const nextChars = normalizedCharsWithRawEnds(next);
  const nextNormalized = nextChars.map((char) => char.normalized).join("");
  const maxOverlap = Math.min(previousNormalized.length, nextNormalized.length);

  for (let size = maxOverlap; size >= 10; size -= 1) {
    if (
      previousNormalized.slice(previousNormalized.length - size) ===
      nextNormalized.slice(0, size)
    ) {
      const rawEnd = nextChars[size - 1]?.end ?? 0;
      const rawOverlap = next.slice(0, rawEnd);
      const overlap = /[\s.!?,;:)\]}"']/.test(next[rawEnd] ?? "")
        ? rawOverlap.trimEnd()
        : truncateToStableBoundary(rawOverlap);
      if (overlap.trim().split(/\s+/).filter(Boolean).length >= 2) {
        return overlap;
      }
    }
  }

  return "";
}

function findAppendStartForStablePreview(
  stablePreview: string,
  committedText: string,
): number | null {
  if (committedText.length === 0) {
    return 0;
  }

  if (stablePreview.startsWith(committedText)) {
    return committedText.length;
  }

  const prefixEnd = findNormalizedPrefixEnd(stablePreview, committedText);
  if (prefixEnd !== null) {
    return prefixEnd;
  }

  const normalizedStablePreview = normalizeForPrefixMatch(stablePreview);
  const normalizedCommitted = normalizeForPrefixMatch(committedText);
  if (
    normalizedStablePreview.length > 0 &&
    normalizedCommitted.endsWith(normalizedStablePreview)
  ) {
    return stablePreview.length;
  }

  const overlapEnd = findNormalizedSuffixPrefixOverlapEnd(
    committedText,
    stablePreview,
  );
  if (overlapEnd !== null) {
    return overlapEnd;
  }

  const wordOverlapEnd = findWordSuffixPrefixOverlapEnd(
    committedText,
    stablePreview,
  );
  if (wordOverlapEnd !== null) {
    return wordOverlapEnd;
  }

  if (isLikelyAdvancedRollingPreview(committedText, stablePreview)) {
    return 0;
  }

  return null;
}

function findNormalizedSuffixPrefixOverlapEnd(
  committedText: string,
  stablePreview: string,
): number | null {
  const committedNormalized = normalizeForPrefixMatch(committedText);
  const previewChars = normalizedCharsWithRawEnds(stablePreview);
  const previewNormalized = previewChars.map((char) => char.normalized).join("");
  const maxOverlap = Math.min(committedNormalized.length, previewNormalized.length);

  for (let size = maxOverlap; size >= 6; size -= 1) {
    if (
      committedNormalized.slice(committedNormalized.length - size) ===
      previewNormalized.slice(0, size)
    ) {
      return previewChars[size - 1]?.end ?? null;
    }
  }

  return null;
}

function isLikelyAdvancedRollingPreview(
  committedText: string,
  stablePreview: string,
): boolean {
  const committedWords = normalizedWords(committedText);
  const stableWords = normalizedWords(stablePreview);
  if (committedWords.length === 0 || stableWords.length < 2) {
    return false;
  }

  if (stableWords.join("").length < 8) {
    return false;
  }

  if (
    stableWords[0] === committedWords[0] &&
    (stableWords[0]?.length ?? 0) > 2
  ) {
    return false;
  }

  const committedStart = committedWords.slice(0, 2).join(" ");
  const stableStart = stableWords.slice(0, 2).join(" ");
  if (committedStart.length > 0 && stableStart.startsWith(committedStart)) {
    return false;
  }

  const committedRecent = committedWords.slice(-80).join(" ");
  if (committedRecent.includes(stableStart)) {
    return false;
  }

  return true;
}

function findWordSuffixPrefixOverlapEnd(
  committedText: string,
  stablePreview: string,
): number | null {
  const committedWords = normalizedWords(committedText);
  const previewWords = normalizedWordsWithRawEnds(stablePreview);
  const maxOverlap = Math.min(committedWords.length, previewWords.length);

  for (let size = maxOverlap; size >= 1; size -= 1) {
    const committedSuffix = committedWords.slice(committedWords.length - size);
    const previewPrefix = previewWords
      .slice(0, size)
      .map((word) => word.normalized);
    if (arraysEqual(committedSuffix, previewPrefix)) {
      return previewWords[size - 1]?.end ?? null;
    }
  }

  return null;
}

export function withCursorAppendSeparator(
  committedText: string,
  appendText: string,
): string {
  if (appendText.length === 0 || committedText.length === 0) {
    return appendText;
  }

  const lastCommitted = committedText.charAt(committedText.length - 1);
  const firstAppend = appendText.charAt(0);
  if (
    /\s/.test(lastCommitted) ||
    /\s/.test(firstAppend) ||
    /[.!?,;:)\]}"']/.test(firstAppend)
  ) {
    return appendText;
  }

  return ` ${appendText}`;
}

function normalizedCharsWithRawEnds(
  text: string,
): Array<{ normalized: string; end: number }> {
  const result: Array<{ normalized: string; end: number }> = [];
  for (const match of text.matchAll(/[\s\S]/gu)) {
    const char = match[0];
    const normalized = normalizeCharForPrefixMatch(char);
    if (normalized) {
      result.push({
        normalized,
        end: (match.index ?? 0) + char.length,
      });
    }
  }
  return result;
}

function normalizedWords(text: string): string[] {
  return normalizedWordsWithRawEnds(text).map((word) => word.normalized);
}

function normalizedWordsWithRawEnds(
  text: string,
): Array<{ normalized: string; end: number }> {
  const result: Array<{ normalized: string; end: number }> = [];
  for (const match of text.matchAll(/[A-Za-z0-9]+/g)) {
    result.push({
      normalized: match[0].toLocaleLowerCase(),
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return result;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function commonStringPrefix(left: string, right: string): string {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  let index = 0;
  while (
    index < leftChars.length &&
    index < rightChars.length &&
    leftChars[index] === rightChars[index]
  ) {
    index += 1;
  }
  return leftChars.slice(0, index).join("");
}

function findNormalizedPrefixEnd(text: string, prefix: string): number | null {
  const normalizedPrefix = normalizeForPrefixMatch(prefix);
  if (normalizedPrefix.length === 0) {
    return 0;
  }

  let prefixIndex = 0;
  let lastMatchedEnd = 0;
  for (const match of text.matchAll(/[\s\S]/gu)) {
    const char = match[0];
    const index = match.index ?? 0;
    const normalizedChar = normalizeCharForPrefixMatch(char);
    if (!normalizedChar) {
      continue;
    }
    if (normalizedChar !== normalizedPrefix[prefixIndex]) {
      return null;
    }
    prefixIndex += 1;
    lastMatchedEnd = index + 1;
    if (prefixIndex === normalizedPrefix.length) {
      return lastMatchedEnd;
    }
  }

  return null;
}

function normalizeForPrefixMatch(text: string): string {
  return Array.from(text)
    .map(normalizeCharForPrefixMatch)
    .join("");
}

function normalizeCharForPrefixMatch(char: string): string {
  const lower = char.toLocaleLowerCase();
  return /[a-z0-9]/.test(lower) ? lower : "";
}
