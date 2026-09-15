#!/usr/bin/env node
import fs from "node:fs/promises";
import { scoreQualityManifest } from "./dictation-quality.mjs";

const usage = "Usage: node scripts/dictation-quality-cli.mjs --input retained-fixture.json --output new-report.json";
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else {
    if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") throw new Error(usage);
    const input = await fs.open(args[1], "r");
    let content;
    try {
      if ((await input.stat()).size > 20_000_000) throw new Error("Input exceeds bounded 20 MB fixture limit");
      content = await input.readFile("utf8");
    } finally { await input.close(); }
    const report = scoreQualityManifest(JSON.parse(content));
    // Never replace an earlier diagnostic receipt, including through a symlink.
    await fs.writeFile(args[3], `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`Scored ${report.summary.cases} cases; ${report.summary.observedCases} have field observations.`);
  }
} catch (error) {
  // JSON syntax errors can quote the input text. Keep opt-in private fixtures out
  // of terminal logs too; validation messages only contain fixed field names/IDs.
  console.error(error instanceof SyntaxError ? "Invalid JSON input; no report written." : error.message);
  process.exitCode = 1;
}
