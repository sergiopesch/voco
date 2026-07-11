#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/report-dictation-baseline-config.mjs");

function writeConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voco-config-test-"));
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function runReport(config) {
  return execFileSync(process.execPath, [scriptPath, writeConfig(config)], {
    encoding: "utf8",
  });
}

{
  const output = runReport({
    transcriptTarget: "cursor",
    liveCursorMode: "stable-cursor-streaming",
    transcriptEnhancement: "off",
  });
  assert.match(output, /status: baseline-ready/);
  assert.match(output, /transcriptTarget: ok/);
  assert.match(output, /liveCursorMode: ok/);
  assert.match(output, /transcriptEnhancement: ok/);
}

{
  const output = runReport({
    transcriptTarget: "cursor",
    liveCursorMode: "stable-cursor-streaming",
    transcriptEnhancement: "conservative",
  });
  assert.match(output, /status: baseline-mismatch/);
  assert.match(
    output,
    /transcriptEnhancement: mismatch \(actual=conservative, expected=off\)/,
  );
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voco-config-missing-test-"));
  const output = execFileSync(process.execPath, [scriptPath, path.join(dir, "missing.json")], {
    encoding: "utf8",
  });
  assert.match(output, /status: config-missing/);
}

console.log("report-dictation-baseline-config tests passed");
