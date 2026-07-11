#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tracePath =
  process.argv[2] ??
  path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "voco",
    "hotkey-trace.jsonl",
  );

const traceDir = path.dirname(tracePath);
fs.mkdirSync(traceDir, { recursive: true });

let archivedPath = null;
if (fs.existsSync(tracePath) && fs.statSync(tracePath).size > 0) {
  archivedPath = nextArchivePath(tracePath);
  fs.renameSync(tracePath, archivedPath);
}

fs.closeSync(fs.openSync(tracePath, "w"));

console.log("VOCO cursor streaming trace reset");
console.log("");
console.log(`Trace file: ${tracePath}`);
if (archivedPath) {
  console.log(`Archived previous trace: ${archivedPath}`);
} else {
  console.log("Archived previous trace: none");
}
console.log("status: reset-ready");

function nextArchivePath(filePath) {
  const dir = path.dirname(filePath);
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = path.join(dir, `${baseName}.${stamp}${suffix}${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find an available trace archive path");
}
