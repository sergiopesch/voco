#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/report-cursor-streaming-trace.mjs");

function writeTrace(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voco-trace-test-"));
  const tracePath = path.join(dir, "hotkey-trace.jsonl");
  fs.writeFileSync(
    tracePath,
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
  );
  return tracePath;
}

function runReport(entries, args = []) {
  return execFileSync(process.execPath, [scriptPath, ...args, writeTrace(entries)], {
    encoding: "utf8",
  });
}

{
  const output = runReport([{ event: "app_start" }]);
  assert.match(output, /status: no-dictation-session/);
  assert.match(output, /no completed dictation session/);
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_first_live_text_visible", duration_ms: 1000 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_live_preview_completed", duration_ms: 700 },
    { event: "dictation_live_preview_completed", duration_ms: 900 },
    { event: "dictation_live_cursor_overlay_fallback" },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: dictation-session-observed/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), 1 final output event\(s\), 1 first live text event\(s\), 2 live cursor update event\(s\), 2 live preview event\(s\), 1 overlay fallback event\(s\), 0 live preview fallback event\(s\), 0 non-destructive final fallback event\(s\)/,
  );
  assert.match(
    output,
    /dictation_recording_duration,1,10000ms,10000ms,10000ms,10000ms/,
  );
}

{
  const output = runReport([
    { event: "dictation_owned_preedit_started" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_first_live_text_visible", duration_ms: 850 },
    { event: "dictation_owned_preedit_updated", t_ms: 1000 },
    { event: "dictation_live_preview_completed", duration_ms: 620 },
    { event: "dictation_owned_preedit_updated", t_ms: 1800 },
    { event: "dictation_owned_preedit_committed" },
    { event: "dictation_final_output_completed" },
    { event: "dictation_stop_to_idle", duration_ms: 1100 },
  ]);
  assert.match(output, /status: dictation-session-observed/);
  assert.match(output, /2 live cursor update event\(s\)/);
  assert.match(output, /dictation_owned_preedit_started: 1/);
  assert.match(output, /dictation_owned_preedit_updated: 2/);
  assert.match(output, /dictation_owned_preedit_committed: 1/);
  assert.match(
    output,
    /dictation_live_cursor_update_gap,1,800ms,800ms,800ms,800ms/,
  );
}

{
  const output = runReport(
    [
      { event: "dictation_final_output_completed" },
      { event: "dictation_recording_duration", duration_ms: 600000 },
      { event: "dictation_live_preview_completed", duration_ms: 1000 },
      { event: "dictation_live_cursor_insert_updated" },
      { event: "dictation_stop_to_idle", duration_ms: 1600 },
    ],
    ["--expect-final-only", "--min-duration-ms", "600000"],
  );
  assert.match(output, /status: final-only-live-events-observed/);
  assert.match(
    output,
    /detail: 2 live preview\/cursor\/fallback event\(s\) observed during final-only validation/,
  );
}

{
  const output = runReport(
    [
      { event: "dictation_final_output_completed" },
      { event: "dictation_recording_duration", duration_ms: 10000 },
      { event: "dictation_first_live_text_visible", duration_ms: 1000 },
      { event: "dictation_live_cursor_insert_updated" },
      { event: "dictation_stop_to_idle", duration_ms: 1200 },
    ],
    ["--min-duration-ms", "10000"],
  );
  assert.match(output, /Minimum recording duration: 10000ms/);
  assert.match(output, /status: dictation-session-observed/);
}

{
  const output = runReport(
    [
      { event: "dictation_final_output_completed" },
      { event: "dictation_recording_duration", duration_ms: 600000 },
      { event: "dictation_stop_to_idle", duration_ms: 1600 },
    ],
    ["--expect-final-only", "--min-duration-ms", "600000"],
  );
  assert.match(output, /Expected mode: final-text-only/);
  assert.match(output, /status: final-dictation-observed/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), 1 final output event\(s\), 1 recording duration event\(s\), 0 live preview event\(s\), 0 overlay fallback event\(s\)/,
  );
}

{
  const output = runReport(
    [
      { event: "dictation_final_output_completed" },
      { event: "dictation_recording_duration", duration_ms: 590000 },
      { event: "dictation_stop_to_idle", duration_ms: 1600 },
    ],
    ["--expect-final-only", "--min-duration-ms=600000"],
  );
  assert.match(output, /status: recording-duration-too-short/);
}

{
  const output = runReport(
    [
      { event: "dictation_final_output_completed" },
      { event: "dictation_recording_duration", duration_ms: 9500 },
      { event: "dictation_first_live_text_visible", duration_ms: 1000 },
      { event: "dictation_live_cursor_insert_updated" },
      { event: "dictation_stop_to_idle", duration_ms: 1200 },
    ],
    ["--min-duration-ms=10000"],
  );
  assert.match(output, /status: recording-duration-too-short/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), but longest recording duration was 9500ms below required 10000ms/,
  );
}

{
  const output = runReport([
    { event: "dictation_live_preview_completed", duration_ms: 700 },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: final-output-unproven/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), but no final output completion event was observed/,
  );
}

{
  const output = runReport([
    { event: "dictation_final_output_unreconciled" },
    { event: "dictation_live_cursor_final_unreconciled" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_first_live_text_visible", duration_ms: 900 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: final-cursor-output-unreconciled/);
  assert.match(output, /dictation_live_cursor_final_unreconciled: 1/);
  assert.match(
    output,
    /1 session\(s\) preserved a final transcript in VOCO but could not safely finish it at the cursor/,
  );
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_live_preview_failed" },
    { event: "dictation_live_cursor_overlay_fallback" },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: dictation-session-observed/);
  assert.match(output, /1 overlay fallback event\(s\), 1 live preview fallback event\(s\)/);
  assert.match(output, /dictation_live_preview_failed: 1/);
}

{
  const output = runReport([
    { event: "dictation_final_output_completed", dictation_session_id: 1 },
    { event: "dictation_recording_duration", duration_ms: 10000, dictation_session_id: 1 },
    { event: "dictation_first_live_text_visible", duration_ms: 900, dictation_session_id: 1 },
    { event: "dictation_live_cursor_insert_updated", dictation_session_id: 1 },
    { event: "dictation_stop_to_idle", duration_ms: 1200, dictation_session_id: 1 },
    { event: "dictation_live_preview_completed", duration_ms: 700, dictation_session_id: 2 },
    { event: "dictation_stop_to_idle", duration_ms: 1300, dictation_session_id: 2 },
  ]);
  assert.match(output, /Latest completed dictation session: 2/);
  assert.match(output, /Reported dictation session scope: 2/);
  assert.match(output, /status: final-output-unproven/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), but no final output completion event was observed/,
  );
}

{
  const output = runReport([
    { event: "dictation_final_output_completed", dictation_session_id: 1 },
    { event: "dictation_recording_duration", duration_ms: 10000, dictation_session_id: 1 },
    { event: "dictation_first_live_text_visible", duration_ms: 900, dictation_session_id: 1 },
    { event: "dictation_live_cursor_insert_updated", dictation_session_id: 1 },
    { event: "dictation_live_cursor_insert_failed", dictation_session_id: 1 },
    { event: "dictation_stop_to_idle", duration_ms: 1200, dictation_session_id: 1 },
    { event: "dictation_final_output_completed", dictation_session_id: 2 },
    { event: "dictation_recording_duration", duration_ms: 10000, dictation_session_id: 2 },
    { event: "dictation_first_live_text_visible", duration_ms: 700, dictation_session_id: 2 },
    { event: "dictation_live_cursor_insert_updated", dictation_session_id: 2 },
    { event: "dictation_stop_to_idle", duration_ms: 1100, dictation_session_id: 2 },
  ]);
  assert.match(output, /Latest completed dictation session: 2/);
  assert.match(output, /Reported dictation session scope: 1/);
  assert.match(output, /status: failures-observed/);
  assert.match(output, /detail: 1 failure event\(s\) observed; 1 completed session\(s\) present/);
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_first_live_text_visible", duration_ms: 1600 },
    { event: "dictation_live_cursor_insert_updated", t_ms: 1000 },
    { event: "dictation_live_cursor_insert_updated", t_ms: 2000 },
    { event: "dictation_live_cursor_insert_updated", t_ms: 4500 },
    { event: "dictation_live_preview_window_advanced", duration_ms: 2400 },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: cursor-streaming-latency-above-target/);
  assert.match(output, /first live text 1600ms exceeds 1500ms/);
  assert.match(output, /cursor update gap p95 2500ms exceeds 2000ms/);
  assert.match(
    output,
    /dictation_live_cursor_update_gap,2,1000ms,1000ms,2500ms,2500ms/,
  );
  assert.match(
    output,
    /dictation_live_preview_window_advanced,1,2400ms,2400ms,2400ms,2400ms/,
  );
}

{
  const output = runReport(
    [
      { event: "dictation_final_output_completed" },
      { event: "dictation_recording_duration", duration_ms: 10000 },
      { event: "dictation_first_live_text_visible", duration_ms: 1600 },
      { event: "dictation_live_cursor_insert_updated", t_ms: 1000 },
      { event: "dictation_live_cursor_insert_updated", t_ms: 3500 },
      { event: "dictation_stop_to_idle", duration_ms: 1200 },
    ],
    ["--max-first-live-text-ms=2000", "--max-cursor-gap-p95-ms", "3000"],
  );
  assert.match(output, /Maximum first live text: 2000ms/);
  assert.match(output, /Maximum cursor update gap p95: 3000ms/);
  assert.match(output, /status: dictation-session-observed/);
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_live_preview_completed", duration_ms: 700 },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: cursor-streaming-unproven/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), but no live cursor text or overlay fallback was observed/,
  );
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_first_live_text_visible", duration_ms: 900 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: recording-duration-unproven/);
  assert.match(
    output,
    /detail: 1 completed session\(s\), but no recording duration event was observed/,
  );
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_first_live_text_visible", duration_ms: 900 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_live_preview_completed", duration_ms: 700 },
    { event: "dictation_live_preview_completed", duration_ms: 760 },
    { event: "dictation_live_preview_completed", duration_ms: 800 },
    { event: "dictation_live_preview_completed", duration_ms: 840 },
    { event: "dictation_live_cursor_commit_waiting" },
    { event: "dictation_live_cursor_commit_waiting" },
    { event: "dictation_live_cursor_unsafe_rewrite_blocked" },
    { event: "dictation_live_cursor_unsafe_rewrite_blocked" },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: cursor-streaming-stalled/);
  assert.match(
    output,
    /detail: 4 live preview event\(s\), 1 live cursor update event\(s\), 4 blocked commit event\(s\), 4 preview event\(s\) after the last cursor update, 4 blocked commit event\(s\) after the last cursor update, and no overlay fallback/,
  );
}

{
  const output = runReport([
    { event: "dictation_final_output_completed" },
    { event: "dictation_recording_duration", duration_ms: 10000 },
    { event: "dictation_first_live_text_visible", duration_ms: 900 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_live_preview_completed", duration_ms: 700 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_live_preview_completed", duration_ms: 760 },
    { event: "dictation_live_preview_completed", duration_ms: 800 },
    { event: "dictation_live_cursor_insert_updated" },
    { event: "dictation_live_preview_completed", duration_ms: 840 },
    { event: "dictation_live_preview_completed", duration_ms: 880 },
    { event: "dictation_live_preview_completed", duration_ms: 920 },
    { event: "dictation_live_cursor_commit_waiting" },
    { event: "dictation_live_cursor_commit_waiting" },
    { event: "dictation_live_cursor_unsafe_rewrite_blocked" },
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
  ]);
  assert.match(output, /status: cursor-streaming-stalled/);
  assert.match(
    output,
    /detail: 6 live preview event\(s\), 3 live cursor update event\(s\), 3 blocked commit event\(s\), 3 preview event\(s\) after the last cursor update, 3 blocked commit event\(s\) after the last cursor update, and no overlay fallback/,
  );
}

{
  const output = runReport([
    { event: "dictation_stop_to_idle", duration_ms: 1200 },
    { event: "dictation_final_insertion_failed" },
  ]);
  assert.match(output, /status: failures-observed/);
  assert.match(output, /detail: 1 failure event\(s\) observed; 1 completed session\(s\) present/);
}

{
  const output = runReport([
    { event: "recording_state_active" },
    { event: "dictation_live_preview_failed" },
  ]);
  assert.match(output, /status: no-dictation-session/);
  assert.match(output, /detail: no completed dictation session is present in this trace window/);
}

console.log("report-cursor-streaming-trace tests passed");
