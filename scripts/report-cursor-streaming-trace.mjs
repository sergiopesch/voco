#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAX_FIRST_LIVE_TEXT_MS = 1_500;
const DEFAULT_MAX_CURSOR_GAP_P95_MS = 2_000;
const options = parseArgs(process.argv.slice(2));
const tracePath =
  options.tracePath ??
  path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "voco",
    "hotkey-trace.jsonl",
  );

const eventsToSummarize = [
  "dictation_recording_duration",
  "dictation_first_live_text_visible",
  "dictation_live_preview_completed",
  "dictation_live_preview_window_advanced",
  "dictation_live_cursor_update_gap",
  "dictation_stop_to_final_transcript",
  "dictation_stop_to_idle",
];

const notableEvents = [
  "recording_get_user_media_constraints_fallback",
  "recording_get_user_media_default_fallback",
  "dictation_owned_preedit_started",
  "dictation_owned_preedit_unavailable",
  "dictation_owned_preedit_updated",
  "dictation_owned_preedit_failed",
  "dictation_owned_preedit_cancelled",
  "dictation_owned_preedit_committed",
  "dictation_owned_preedit_commit_failed",
  "dictation_live_cursor_insert_updated",
  "dictation_live_cursor_insert_failed",
  "dictation_live_cursor_unsafe_rewrite_blocked",
  "dictation_live_cursor_overlay_fallback",
  "dictation_live_cursor_final_unreconciled",
  "dictation_final_output_completed",
  "dictation_final_output_unreconciled",
  "dictation_final_insertion_failed",
  "dictation_live_preview_failed",
  "dictation_live_cursor_commit_waiting",
  "dictation_live_preview_confirmed",
  "dictation_live_preview_window_advanced",
  "dictation_live_cursor_tail_transcribed",
  "dictation_live_cursor_tail_flushed",
  "dictation_live_cursor_tail_already_covered",
  "dictation_live_cursor_tail_flush_failed",
  "dictation_recording_limit_reached",
];

function percentile(values, quantile) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((quantile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function formatMs(value) {
  return value === null ? "-" : `${value}ms`;
}

if (!fs.existsSync(tracePath)) {
  console.error(`Trace file not found: ${tracePath}`);
  process.exit(1);
}

const lines = fs.readFileSync(tracePath, "utf8").split(/\r?\n/).filter(Boolean);
const parsedEntries = [];
for (const [index, line] of lines.entries()) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  parsedEntries.push({
    event: entry.event,
    index,
    durationMs: Number.isFinite(entry.duration_ms) ? entry.duration_ms : null,
    tMs: Number.isFinite(entry.t_ms) ? entry.t_ms : null,
    dictationSessionId: Number.isInteger(entry.dictation_session_id)
      ? entry.dictation_session_id
      : null,
  });
}

const completedSessionIds = parsedEntries
  .filter(
    (entry) =>
      entry.event === "dictation_stop_to_idle" &&
      entry.dictationSessionId !== null,
  )
  .map((entry) => entry.dictationSessionId);
const uniqueCompletedSessionIds = [...new Set(completedSessionIds)];
const latestCompletedSessionId =
  completedSessionIds.length > 0
    ? completedSessionIds[completedSessionIds.length - 1]
    : null;
const sessionReports = uniqueCompletedSessionIds.map((sessionId) => {
  const summary = summarizeEntries(
    parsedEntries.filter((entry) => entry.dictationSessionId === sessionId),
  );
  return {
    classification: classifySummary(summary, options),
    sessionId,
    summary,
  };
});
const issueReport = findHighestPriorityIssue(sessionReports);
const latestCompletedSessionReport =
  latestCompletedSessionId === null
    ? null
    : sessionReports.find(
        (report) => report.sessionId === latestCompletedSessionId,
      ) ?? null;
const selectedReport =
  issueReport ??
  latestCompletedSessionReport ??
  {
    classification: null,
    sessionId: null,
    summary: summarizeEntries(parsedEntries),
  };
const { rows, notableCounts } = selectedReport.summary;
const classification =
  selectedReport.classification ?? classifySummary(selectedReport.summary, options);

console.log("VOCO cursor streaming trace report");
console.log("");
console.log(`Trace file: ${tracePath}`);
console.log(`Entries read: ${lines.length}`);
if (options.minDurationMs !== null) {
  console.log(`Minimum recording duration: ${options.minDurationMs}ms`);
}
if (options.expectFinalOnly) {
  console.log("Expected mode: final-text-only");
} else {
  console.log(`Maximum first live text: ${options.maxFirstLiveTextMs}ms`);
  console.log(`Maximum cursor update gap p95: ${options.maxCursorGapP95Ms}ms`);
}
if (latestCompletedSessionId !== null) {
  console.log(`Latest completed dictation session: ${latestCompletedSessionId}`);
}
if (selectedReport.sessionId !== null) {
  console.log(`Reported dictation session scope: ${selectedReport.sessionId}`);
}
console.log("");
console.log("Evidence status");
console.log(`status: ${classification.status}`);
console.log(`detail: ${classification.detail}`);
console.log("");
console.log("Timing events");
console.log("event,count,min,p50,p95,max");
for (const [event, values] of rows) {
  const min = values.length === 0 ? null : Math.min(...values);
  const max = values.length === 0 ? null : Math.max(...values);
  console.log(
    [
      event,
      values.length,
      formatMs(min),
      formatMs(percentile(values, 50)),
      formatMs(percentile(values, 95)),
      formatMs(max),
    ].join(","),
  );
}

console.log("");
console.log("Notable events");
for (const [event, count] of notableCounts) {
  console.log(`${event}: ${count}`);
}

function findLastEventIndex(entries, event) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.event === event) {
      return entries[index].index;
    }
  }
  return -1;
}

function countEventsAfter(entries, event, afterIndex) {
  return entries.filter((entry) => entry.event === event && entry.index > afterIndex).length;
}

function summarizeEntries(entries) {
  const rows = new Map(eventsToSummarize.map((event) => [event, []]));
  const notableCounts = new Map(notableEvents.map((event) => [event, 0]));
  for (const entry of entries) {
    if (rows.has(entry.event) && Number.isFinite(entry.durationMs)) {
      rows.get(entry.event).push(entry.durationMs);
    }

    if (notableCounts.has(entry.event)) {
      notableCounts.set(entry.event, notableCounts.get(entry.event) + 1);
    }
  }

  const cursorUpdateTimes = entries
    .filter(
      (entry) =>
        (entry.event === "dictation_live_cursor_insert_updated" ||
          entry.event === "dictation_owned_preedit_updated") &&
        entry.tMs !== null,
    )
    .map((entry) => entry.tMs);
  const cursorUpdateGaps = cursorUpdateTimes
    .slice(1)
    .map((time, index) => time - cursorUpdateTimes[index])
    .filter((duration) => Number.isFinite(duration) && duration >= 0);
  rows.set("dictation_live_cursor_update_gap", cursorUpdateGaps);

  const completedDictationCount = rows.get("dictation_stop_to_idle")?.length ?? 0;
  const recordingDurations = rows.get("dictation_recording_duration") ?? [];
  const recordingDurationCount = recordingDurations.length;
  const maxRecordingDurationMs =
    recordingDurations.length === 0 ? null : Math.max(...recordingDurations);
  const previewCount = rows.get("dictation_live_preview_completed")?.length ?? 0;
  const firstLiveTextCount = rows.get("dictation_first_live_text_visible")?.length ?? 0;
  const finalOutputCount = notableCounts.get("dictation_final_output_completed") ?? 0;
  const finalUnreconciledCount = Math.max(
    notableCounts.get("dictation_final_output_unreconciled") ?? 0,
    notableCounts.get("dictation_live_cursor_final_unreconciled") ?? 0,
  );
  const previewFailureCount = notableCounts.get("dictation_live_preview_failed") ?? 0;
  const liveCursorInsertUpdatedCount =
    (notableCounts.get("dictation_live_cursor_insert_updated") ?? 0) +
    (notableCounts.get("dictation_owned_preedit_updated") ?? 0);
  const blockedLiveCursorCommitCount =
    (notableCounts.get("dictation_live_cursor_unsafe_rewrite_blocked") ?? 0) +
    (notableCounts.get("dictation_live_cursor_commit_waiting") ?? 0);
  const lastLiveCursorUpdateIndex = Math.max(
    findLastEventIndex(entries, "dictation_live_cursor_insert_updated"),
    findLastEventIndex(entries, "dictation_owned_preedit_updated"),
  );
  const previewsAfterLastLiveCursorUpdate =
    lastLiveCursorUpdateIndex === -1
      ? 0
      : countEventsAfter(
          entries,
          "dictation_live_preview_completed",
          lastLiveCursorUpdateIndex,
        );
  const blockedCommitsAfterLastLiveCursorUpdate =
    lastLiveCursorUpdateIndex === -1
      ? 0
      : countEventsAfter(
          entries,
          "dictation_live_cursor_commit_waiting",
          lastLiveCursorUpdateIndex,
        ) +
        countEventsAfter(
          entries,
          "dictation_live_cursor_unsafe_rewrite_blocked",
          lastLiveCursorUpdateIndex,
        );
  const failureCount = [
    "dictation_live_cursor_insert_failed",
    "dictation_owned_preedit_failed",
    "dictation_owned_preedit_commit_failed",
    "dictation_final_insertion_failed",
  ].reduce((sum, event) => sum + (notableCounts.get(event) ?? 0), 0);
  const fallbackCount = notableCounts.get("dictation_live_cursor_overlay_fallback") ?? 0;
  const cursorStreamingStalled =
    previewCount >= 4 &&
    firstLiveTextCount > 0 &&
    fallbackCount === 0 &&
    ((liveCursorInsertUpdatedCount <= 1 && blockedLiveCursorCommitCount >= 4) ||
      (previewsAfterLastLiveCursorUpdate >= 3 &&
        blockedCommitsAfterLastLiveCursorUpdate >= 3));

  return {
    blockedCommitsAfterLastLiveCursorUpdate,
    blockedLiveCursorCommitCount,
    completedDictationCount,
    cursorStreamingStalled,
    cursorUpdateGapP95Ms: percentile(cursorUpdateGaps, 95),
    failureCount,
    fallbackCount,
    finalOutputCount,
    finalUnreconciledCount,
    firstLiveTextCount,
    firstLiveTextP95Ms: percentile(
      rows.get("dictation_first_live_text_visible") ?? [],
      95,
    ),
    liveCursorInsertUpdatedCount,
    maxRecordingDurationMs,
    notableCounts,
    previewCount,
    previewFailureCount,
    recordingDurationCount,
    previewsAfterLastLiveCursorUpdate,
    rows,
  };
}

function classifySummary(summary, options) {
  if (summary.failureCount > 0) {
    return {
      priority: 1,
      status: "failures-observed",
      detail: `${summary.failureCount} failure event(s) observed; ${summary.completedDictationCount} completed session(s) present`,
    };
  }

  if (summary.completedDictationCount === 0) {
    return {
      priority: 5,
      status: "no-dictation-session",
      detail: "no completed dictation session is present in this trace window",
    };
  }

  if (summary.finalUnreconciledCount > 0) {
    return {
      priority: 2,
      status: "final-cursor-output-unreconciled",
      detail: `${summary.finalUnreconciledCount} session(s) preserved a final transcript in VOCO but could not safely finish it at the cursor`,
    };
  }

  if (summary.finalOutputCount === 0) {
    return {
      priority: 3,
      status: "final-output-unproven",
      detail: `${summary.completedDictationCount} completed session(s), but no final output completion event was observed`,
    };
  }

  if (summary.cursorStreamingStalled) {
    return {
      priority: 2,
      status: "cursor-streaming-stalled",
      detail: `${summary.previewCount} live preview event(s), ${summary.liveCursorInsertUpdatedCount} live cursor update event(s), ${summary.blockedLiveCursorCommitCount} blocked commit event(s), ${summary.previewsAfterLastLiveCursorUpdate} preview event(s) after the last cursor update, ${summary.blockedCommitsAfterLastLiveCursorUpdate} blocked commit event(s) after the last cursor update, and no overlay fallback`,
    };
  }

  if (!options.expectFinalOnly) {
    const firstLiveTextTooSlow =
      summary.firstLiveTextP95Ms !== null &&
      summary.firstLiveTextP95Ms > options.maxFirstLiveTextMs;
    const cursorUpdatesTooBursty =
      summary.cursorUpdateGapP95Ms !== null &&
      summary.cursorUpdateGapP95Ms > options.maxCursorGapP95Ms;
    if (firstLiveTextTooSlow || cursorUpdatesTooBursty) {
      const issues = [];
      if (firstLiveTextTooSlow) {
        issues.push(
          `first live text ${summary.firstLiveTextP95Ms}ms exceeds ${options.maxFirstLiveTextMs}ms`,
        );
      }
      if (cursorUpdatesTooBursty) {
        issues.push(
          `cursor update gap p95 ${summary.cursorUpdateGapP95Ms}ms exceeds ${options.maxCursorGapP95Ms}ms`,
        );
      }
      return {
        priority: 2,
        status: "cursor-streaming-latency-above-target",
        detail: issues.join("; "),
      };
    }
  }

  if (summary.recordingDurationCount === 0) {
    return {
      priority: 4,
      status: "recording-duration-unproven",
      detail: `${summary.completedDictationCount} completed session(s), but no recording duration event was observed`,
    };
  }

  if (
    options.minDurationMs !== null &&
    summary.maxRecordingDurationMs !== null &&
    summary.maxRecordingDurationMs < options.minDurationMs
  ) {
    return {
      priority: 4,
      status: "recording-duration-too-short",
      detail: `${summary.completedDictationCount} completed session(s), but longest recording duration was ${summary.maxRecordingDurationMs}ms below required ${options.minDurationMs}ms`,
    };
  }

  if (options.expectFinalOnly) {
    const liveEventCount =
      summary.previewCount +
      summary.firstLiveTextCount +
      summary.liveCursorInsertUpdatedCount +
      summary.fallbackCount +
      summary.previewFailureCount;
    if (liveEventCount > 0) {
      return {
        priority: 4,
        status: "final-only-live-events-observed",
        detail: `${liveEventCount} live preview/cursor/fallback event(s) observed during final-only validation`,
      };
    }

    return {
      priority: 6,
      status: "final-dictation-observed",
      detail: `${summary.completedDictationCount} completed session(s), ${summary.finalOutputCount} final output event(s), ${summary.recordingDurationCount} recording duration event(s), ${summary.previewCount} live preview event(s), ${summary.fallbackCount} overlay fallback event(s)`,
    };
  }

  if (summary.firstLiveTextCount === 0 && summary.fallbackCount === 0) {
    return {
      priority: 5,
      status: "cursor-streaming-unproven",
      detail: `${summary.completedDictationCount} completed session(s), but no live cursor text or overlay fallback was observed`,
    };
  }

  return {
    priority: 6,
    status: "dictation-session-observed",
    detail: `${summary.completedDictationCount} completed session(s), ${summary.finalOutputCount} final output event(s), ${summary.firstLiveTextCount} first live text event(s), ${summary.liveCursorInsertUpdatedCount} live cursor update event(s), ${summary.previewCount} live preview event(s), ${summary.fallbackCount} overlay fallback event(s), ${summary.previewFailureCount} live preview fallback event(s), ${summary.finalUnreconciledCount} non-destructive final fallback event(s)`,
  };
}

function findHighestPriorityIssue(reports) {
  return reports
    .filter((report) => report.classification.priority < 6)
    .sort(
      (left, right) =>
        left.classification.priority - right.classification.priority ||
        left.sessionId - right.sessionId,
    )[0] ?? null;
}

function parseArgs(args) {
  let expectFinalOnly = false;
  let maxCursorGapP95Ms = DEFAULT_MAX_CURSOR_GAP_P95_MS;
  let maxFirstLiveTextMs = DEFAULT_MAX_FIRST_LIVE_TEXT_MS;
  let minDurationMs = null;
  let tracePath = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--min-duration-ms") {
      index += 1;
      minDurationMs = parsePositiveInteger(args[index], "--min-duration-ms");
    } else if (arg === "--expect-final-only") {
      expectFinalOnly = true;
    } else if (arg === "--max-first-live-text-ms") {
      index += 1;
      maxFirstLiveTextMs = parsePositiveInteger(
        args[index],
        "--max-first-live-text-ms",
      );
    } else if (arg === "--max-cursor-gap-p95-ms") {
      index += 1;
      maxCursorGapP95Ms = parsePositiveInteger(
        args[index],
        "--max-cursor-gap-p95-ms",
      );
    } else if (arg.startsWith("--min-duration-ms=")) {
      minDurationMs = parsePositiveInteger(
        arg.slice("--min-duration-ms=".length),
        "--min-duration-ms",
      );
    } else if (arg.startsWith("--max-first-live-text-ms=")) {
      maxFirstLiveTextMs = parsePositiveInteger(
        arg.slice("--max-first-live-text-ms=".length),
        "--max-first-live-text-ms",
      );
    } else if (arg.startsWith("--max-cursor-gap-p95-ms=")) {
      maxCursorGapP95Ms = parsePositiveInteger(
        arg.slice("--max-cursor-gap-p95-ms=".length),
        "--max-cursor-gap-p95-ms",
      );
    } else if (arg.startsWith("--")) {
      console.error(`Unsupported option: ${arg}`);
      process.exit(1);
    } else if (tracePath === null) {
      tracePath = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return {
    expectFinalOnly,
    maxCursorGapP95Ms,
    maxFirstLiveTextMs,
    minDurationMs,
    tracePath,
  };
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${optionName} requires a positive integer value`);
    process.exit(1);
  }
  return parsed;
}
