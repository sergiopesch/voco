#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSpeechReplayRequests, scoreTranscript, validateSpeechFixtureWav, validateSpeechManifest, validateSpeechReplayResults } from "./speech-score.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "tests/fixtures/speech");
const manifestPath = path.join(fixtureDir, "manifest.json");
const manifest = validateSpeechManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
const model = process.env.VOCO_MODEL_PATH;
if (!model || !fs.existsSync(model)) {
  throw new Error("Set VOCO_MODEL_PATH to the existing pinned ggml-base.en.bin. This check never downloads or changes a model.");
}
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (sha256(model) !== manifest.modelSha256) throw new Error("Speech baseline model checksum mismatch");
const target = process.env.CARGO_TARGET_DIR
  ? path.resolve(root, process.env.CARGO_TARGET_DIR)
  : path.join(root, "apps/desktop/src-tauri/target");
const worker = process.env.VOCO_SPEECH_WORKER
  ? path.resolve(root, process.env.VOCO_SPEECH_WORKER)
  : path.join(target, "debug/examples/preview_replay_worker");
if (!fs.existsSync(worker)) throw new Error("Build preview_replay_worker before running this check");
const inspectCommand = (command, args) => execFileSync(command, args, {
  cwd: root, encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024,
}).trim();
const report = {
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  modelSha256: manifest.modelSha256,
  manifestSha256: sha256(manifestPath),
  workerSha256: sha256(worker),
  source: {
    gitHead: inspectCommand("git", ["rev-parse", "HEAD"]),
    gitDirty: inspectCommand("git", ["status", "--porcelain", "--untracked-files=normal"]).length > 0,
  },
  runtime: {
    node: process.version,
    rustc: inspectCommand("rustc", ["--version"]),
    platform: process.platform,
    architecture: process.arch,
    kernelRelease: os.release(),
    logicalCpus: os.cpus().length,
  },
  note: "Small regression corpus; not a representative dictation accuracy benchmark. Direct engine checks do not exercise native IPC, capture, or delivery. Preview is tested only within the native 0.7–20 second range. Timing includes process/model startup. Source identity is the checkout at report time; worker SHA-256 identifies the executable actually run.",
  fixtures: [], silence: [],
};
let failures = 0;
const totals = { edits: 0, referenceWords: 0 };

function replay(file, samples, previousCanonicalText = "") {
  const requests = buildSpeechReplayRequests(samples, previousCanonicalText);
  const started = performance.now();
  const lines = execFileSync(worker, [file], {
    env: { ...process.env, VOCO_MODEL_PATH: model },
    input: requests.map(({ request }) => JSON.stringify(request)).join("\n") + "\n",
    encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  }).trim().split("\n").map((line) => JSON.parse(line));
  return {
    results: validateSpeechReplayResults(requests, lines),
    testedModes: requests.map(({ mode }) => mode),
    elapsedMs: Math.round(performance.now() - started),
  };
}

for (const fixture of manifest.fixtures) {
  const file = path.join(fixtureDir, fixture.file);
  const relativeFile = path.relative(fs.realpathSync(fixtureDir), fs.realpathSync(file));
  if (relativeFile.startsWith(`..${path.sep}`) || relativeFile === ".." || path.isAbsolute(relativeFile)) {
    throw new Error(`Fixture resolves outside the corpus: ${fixture.id}`);
  }
  if (sha256(file) !== fixture.sha256) throw new Error(`Fixture checksum mismatch: ${fixture.id}`);
  const samples = validateSpeechFixtureWav(fs.readFileSync(file), fixture.seconds);
  const { results: { full, canonical, preview }, testedModes, elapsedMs } = replay(file, samples);
  const transcripts = { full: full.text, canonical: canonical.canonicalText, ...(preview ? { preview: preview.text } : {}) };
  const scores = Object.fromEntries(testedModes.map((mode) => [mode, scoreTranscript(fixture.reference, transcripts[mode])]));
  const passed = Object.values(scores).every((score) => Number.isFinite(score.wer) && score.wer <= fixture.maxWer && score.hypothesisWords > 0)
    && canonical.appendText === canonical.canonicalText;
  if (!passed) failures += 1;
  totals.edits += scores.full.edits;
  totals.referenceWords += scores.full.referenceWords;
  report.fixtures.push({ id: fixture.id, passed, elapsedMs, testedModes, ...transcripts, scores,
    previewSkipped: preview ? null : "Outside the native preview command's 0.7–20 second range" });
  console.log(`${passed ? "PASS" : "FAIL"} ${fixture.id}: WER ${(scores.full.wer * 100).toFixed(2)}%, ${elapsedMs}ms (${testedModes.join(", ")})`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "voco-speech-baseline-"));
try {
  for (const seconds of [10, 20, 30]) {
    const bytes = seconds * 16_000 * 2;
    const wav = Buffer.alloc(44 + bytes);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + bytes, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(bytes, 40);
    const file = path.join(temporary, `silence-${seconds}.wav`); fs.writeFileSync(file, wav);
    const { results: { full, canonical, preview }, testedModes } = replay(file, seconds * 16_000, "Preserve this.");
    const passed = full.text === "" && (!preview || (preview.text === "" && preview.segments.length === 0))
      && canonical.canonicalText === "Preserve this." && canonical.appendText === "" && canonical.chunkText === "";
    if (!passed) failures += 1;
    report.silence.push({ seconds, passed, testedModes });
    console.log(`${passed ? "PASS" : "FAIL"} digital silence ${seconds}s: ${testedModes.join(", ")}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
if (!Number.isSafeInteger(totals.referenceWords) || totals.referenceWords <= 0) {
  throw new Error("Speech baseline requires a positive total reference word count");
}
report.aggregateWer = totals.edits / totals.referenceWords;
if (!Number.isFinite(report.aggregateWer) || report.aggregateWer > manifest.maxAggregateWer) failures += 1;
report.aggregateMode = "full";
report.totalReferenceWords = totals.referenceWords;
report.passed = failures === 0;
const reportIndex = process.argv.indexOf("--report");
if (reportIndex >= 0) {
  const reportPath = process.argv[reportIndex + 1];
  if (!reportPath) throw new Error("--report requires a file path");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
}
console.log(`Aggregate WER: ${(report.aggregateWer * 100).toFixed(2)}% (${totals.edits}/${totals.referenceWords}); ${report.passed ? "PASS" : "FAIL"}`);
process.exitCode = report.passed ? 0 : 1;
