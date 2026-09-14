#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreTranscript, validateSpeechFixtureWav, validateSpeechManifest } from "./speech-score.mjs";
import { scoreSpeechIntegrity } from "./speech-integrity.mjs";

// Fixed prospectively before evaluating the corrected merger. The old merger
// deleted 24/72 reference words (33.33%); never tune this threshold to a run.
export const CONTINUITY_MAX_WER = 0.15;
const REPETITIONS = 18;
const SAMPLE_RATE = 16_000;
const PAUSE_SAMPLES = SAMPLE_RATE / 4;
const CHUNK_SAMPLES = SAMPLE_RATE * 30;
const STRIDE_SAMPLES = SAMPLE_RATE * 29;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hashFile = (file) => hash(fs.readFileSync(file));

export function buildRepeatedSpeech(wav, seconds) {
  validateSpeechFixtureWav(wav, seconds);
  const unit = Buffer.concat([wav.subarray(44), Buffer.alloc(PAUSE_SAMPLES * 2)]);
  const body = Buffer.concat(Array(REPETITIONS).fill(unit));
  const repeated = Buffer.concat([wav.subarray(0, 44), body]);
  repeated.writeUInt32LE(repeated.length - 8, 4);
  repeated.writeUInt32LE(body.length, 40);
  return repeated;
}

export function checkCanonicalContinuity(previous, result) {
  if (!result || typeof result.canonicalText !== "string" || typeof result.appendText !== "string" || typeof result.chunkText !== "string") {
    throw new Error("Malformed canonical worker response");
  }
  if (!result.canonicalText.startsWith(previous) || result.canonicalText !== previous + result.appendText) {
    throw new Error("Canonical prefix was changed, removed, or replayed");
  }
  return result.canonicalText;
}

export function continuityWindows(samples) {
  if (!Number.isSafeInteger(samples) || samples <= 0) throw new Error("Positive sample count required");
  const windows = [];
  for (let start = 0; start < samples; start += STRIDE_SAMPLES) {
    const end = Math.min(start + CHUNK_SAMPLES, samples);
    windows.push({ startSample: start, endSample: end });
    if (end === samples) break;
  }
  return windows;
}

export function checkRepeatedContinuity(reference, hypothesis, phrase) {
  const integrity = scoreSpeechIntegrity(reference, hypothesis, {
    repetition: { phrase, count: REPETITIONS },
  });
  const werPassed = integrity.accuracy.wer <= CONTINUITY_MAX_WER;
  return { ...integrity, werPassed, passed: werPassed && integrity.integrityPassed };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--report" || !args[1])) {
    throw new Error("Usage: node scripts/test-speech-continuity.mjs [--report NEW-report.json]");
  }
  const reportPath = args.length ? path.resolve(args[1]) : null;
  if (reportPath && fs.lstatSync(reportPath, { throwIfNoEntry: false })) {
    throw new Error("Continuity report already exists; choose a new path to preserve prior evidence");
  }
  const manifestPath = path.join(root, "tests/fixtures/speech/manifest.json");
  const manifest = validateSpeechManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const fixture = manifest.fixtures.find(({ id }) => id === "84-121123-0000");
  if (!fixture) throw new Error("Pinned continuity source fixture is missing");
  const fixturePath = path.join(root, "tests/fixtures/speech", fixture.file);
  if (hashFile(fixturePath) !== fixture.sha256) throw new Error("Continuity fixture checksum mismatch");
  const model = process.env.VOCO_MODEL_PATH;
  if (!model || hashFile(model) !== manifest.modelSha256) throw new Error("Set VOCO_MODEL_PATH to the existing pinned model; this check never downloads a model");
  const target = process.env.CARGO_TARGET_DIR ? path.resolve(root, process.env.CARGO_TARGET_DIR) : path.join(root, "apps/desktop/src-tauri/target");
  const worker = process.env.VOCO_SPEECH_WORKER
    ? path.resolve(root, process.env.VOCO_SPEECH_WORKER)
    : path.join(target, "debug/examples/preview_replay_worker");
  const repeated = buildRepeatedSpeech(fs.readFileSync(fixturePath), fixture.seconds);
  const reference = Array(REPETITIONS).fill(fixture.reference).join(" ");
  const sampleCount = (repeated.length - 44) / 2;
  const report = {
    schemaVersion: 2, startedAt: new Date().toISOString(),
    note: "Deterministic continuity regression from an existing licensed corpus fixture, not a representative accuracy benchmark. Direct worker inference excludes microphone, native IPC and output delivery. Timestamps include worker/model startup only in the first request.",
    recipe: { fixtureId: fixture.id, repetitions: REPETITIONS, pauseMsAfterEach: 250, chunkSeconds: 30, strideSeconds: 29 },
    maxWer: CONTINUITY_MAX_WER, seconds: sampleCount / SAMPLE_RATE, reference,
    integrityRequirements: { repetition: { phrase: fixture.reference, count: REPETITIONS } },
    referenceWords: scoreTranscript(reference, reference).referenceWords,
    fixtureSha256: fixture.sha256, derivedWavSha256: hash(repeated),
    modelSha256: hashFile(model), workerSha256: hashFile(worker), manifestSha256: hashFile(manifestPath), runnerSha256: hashFile(fileURLToPath(import.meta.url)),
    integrityScorerSha256: hashFile(path.join(root, "scripts/speech-integrity.mjs")),
    normalizationScorerSha256: hashFile(path.join(root, "scripts/speech-score.mjs")),
    // A worker override can point at an older binary; checkout context is not
    // proof of that executable's source. Bind it through the build manifest.
    currentWorktree: { gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), transcribeSha256: hashFile(path.join(root, "apps/desktop/src-tauri/src/transcribe.rs")) },
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, kernelRelease: os.release() },
    canonicalWindows: [], passed: false,
  };
  if (report.referenceWords !== 72 || sampleCount !== 673_920) throw new Error("Pinned continuity recipe changed");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "voco-speech-continuity-"));
  const wavPath = path.join(temporary, "repeated-short.wav");
  fs.writeFileSync(wavPath, repeated);
  let child;
  try {
    child = spawn(worker, [wavPath], { env: { ...process.env, VOCO_MODEL_PATH: model }, stdio: ["pipe", "pipe", "pipe"] });
    const exit = new Promise((resolve) => { child.once("error", (error) => resolve({ error: error.message })); child.once("close", (code, signal) => resolve({ code, signal })); });
    child.stdin.on("error", () => {}); // Closed-worker failure is reported through its stdout/exit state.
    let stderr = "";
    child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-16_384); });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    async function request(value) {
      const started = performance.now();
      child.stdin.write(JSON.stringify(value) + "\n");
      let timer;
      try {
        const line = await Promise.race([lines.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Continuity inference exceeded 120 seconds")), 120_000); })]);
        if (line.done) throw new Error(`Worker closed without a response: ${stderr}`);
        return { response: JSON.parse(line.value), elapsedMs: Math.round(performance.now() - started) };
      } finally { clearTimeout(timer); }
    }
    const full = await request({ startSample: 0, endSample: sampleCount, fullSession: true });
    if (typeof full.response.text !== "string") throw new Error("Malformed full worker response");
    report.full = { text: full.response.text, elapsedMs: full.elapsedMs, score: scoreTranscript(reference, full.response.text) };
    let previous = "";
    for (const window of continuityWindows(sampleCount)) {
      const { response, elapsedMs } = await request({ ...window, canonical: true, previousCanonicalText: previous });
      previous = checkCanonicalContinuity(previous, response);
      report.canonicalWindows.push({ ...window, elapsedMs, ...response, prefixPreserved: true });
    }
    report.canonical = { text: previous, score: scoreTranscript(reference, previous), prefixContinuity: true, elapsedMs: report.canonicalWindows.reduce((sum, window) => sum + window.elapsedMs, 0) };
    child.stdin.end();
    let exitTimer;
    let result;
    try {
      result = await Promise.race([exit, new Promise((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error("Continuity worker did not exit after completing requests")), 5_000);
      })]);
    } finally { clearTimeout(exitTimer); }
    if (result.error || result.code !== 0) throw new Error(`Worker failed: ${JSON.stringify(result)} ${stderr}`);
    for (const mode of ["full", "canonical"]) {
      report[mode].integrity = checkRepeatedContinuity(reference, report[mode].text, fixture.reference);
    }
    report.werPassed = [report.full, report.canonical].every(result => result.integrity.werPassed);
    report.integrityPassed = [report.full, report.canonical].every(result => result.integrity.integrityPassed);
    report.passed = report.werPassed && report.integrityPassed;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
    report.completedAt = new Date().toISOString();
    if (reportPath) {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    }
  }
  for (const mode of ["full", "canonical"]) {
    const result = report[mode];
    if (result) console.log(`${mode}: S=${result.score.substitutions} D=${result.score.deletions} I=${result.score.insertions}; ${result.score.hypothesisWords}/72 words; WER=${(result.score.wer * 100).toFixed(2)}%; ${result.elapsedMs}ms`);
  }
  console.log(`${report.passed ? "PASS" : "FAIL"} speech continuity: fixed maximum WER 15% and exact 18-phrase sequence${report.error ? `: ${report.error}` : ""}`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
