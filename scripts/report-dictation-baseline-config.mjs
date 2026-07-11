#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const configPath =
  process.argv[2] ??
  path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "voco",
    "config.json",
  );

const expected = {
  transcriptTarget: "cursor",
  liveCursorMode: "stable-cursor-streaming",
  transcriptEnhancement: "off",
};

console.log("VOCO dictation baseline config report");
console.log("");
console.log(`Config file: ${configPath}`);

if (!fs.existsSync(configPath)) {
  console.log("status: config-missing");
  console.log("detail: no config file exists; VOCO will create defaults on launch");
  process.exit(0);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  console.log("status: config-unreadable");
  console.log(`detail: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const mismatches = Object.entries(expected).filter(
  ([key, value]) => config[key] !== value,
);

if (mismatches.length === 0) {
  console.log("status: baseline-ready");
  console.log(
    "detail: cursor target, stable cursor streaming, and enhancement-off baseline are configured",
  );
} else {
  console.log("status: baseline-mismatch");
  console.log(
    `detail: ${mismatches.length} baseline setting(s) differ from the stabilization QA spec`,
  );
}

console.log("");
console.log("Required baseline settings");
for (const [key, expectedValue] of Object.entries(expected)) {
  const actualValue = config[key] ?? "(missing)";
  const status = actualValue === expectedValue ? "ok" : "mismatch";
  console.log(`${key}: ${status} (actual=${actualValue}, expected=${expectedValue})`);
}
