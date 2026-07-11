#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/reset-cursor-streaming-trace.mjs");

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voco-trace-reset-test-"));
  const tracePath = path.join(dir, "hotkey-trace.jsonl");
  fs.writeFileSync(tracePath, '{"event":"app_start"}\n');

  const output = execFileSync(process.execPath, [scriptPath, tracePath], {
    encoding: "utf8",
  });

  assert.match(output, /status: reset-ready/);
  assert.match(output, /Archived previous trace: .+hotkey-trace\..+\.jsonl/);
  assert.equal(fs.readFileSync(tracePath, "utf8"), "");

  const archivedFiles = fs
    .readdirSync(dir)
    .filter((file) => /^hotkey-trace\..+\.jsonl$/.test(file));
  assert.equal(archivedFiles.length, 1);
  assert.equal(
    fs.readFileSync(path.join(dir, archivedFiles[0]), "utf8"),
    '{"event":"app_start"}\n',
  );
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voco-trace-reset-empty-test-"));
  const tracePath = path.join(dir, "hotkey-trace.jsonl");

  const output = execFileSync(process.execPath, [scriptPath, tracePath], {
    encoding: "utf8",
  });

  assert.match(output, /Archived previous trace: none/);
  assert.equal(fs.readFileSync(tracePath, "utf8"), "");
}

console.log("reset-cursor-streaming-trace tests passed");
