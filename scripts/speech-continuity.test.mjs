import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRepeatedSpeech, checkCanonicalContinuity, checkRepeatedContinuity, continuityWindows, CONTINUITY_MAX_WER } from "./test-speech-continuity.mjs";
import { scoreTranscript, validateSpeechFixtureWav } from "./speech-score.mjs";

test("continuity corpus recipe is exactly 18 unchanged utterances plus 250ms pauses", () => {
  const source = fs.readFileSync(new URL("../tests/fixtures/speech/84-121123-0000.wav", import.meta.url));
  const repeated = buildRepeatedSpeech(source, 2.09);
  assert.equal(validateSpeechFixtureWav(repeated, 42.12), 673920);
  const unitBytes = source.length - 44 + 8000;
  for (let i = 0; i < 18; i += 1) {
    const start = 44 + i * unitBytes;
    assert.deepEqual(repeated.subarray(start, start + source.length - 44), source.subarray(44));
    assert.equal(repeated.subarray(start + source.length - 44, start + unitBytes).some((byte) => byte !== 0), false);
  }
  assert.equal(CONTINUITY_MAX_WER, 0.15);
});

test("30 second canonical windows share exactly one second and cover the tail", () => {
  assert.deepEqual(continuityWindows(673920), [
    { startSample: 0, endSample: 480000 },
    { startSample: 464000, endSample: 673920 },
  ]);
  assert.throws(() => continuityWindows(0));
});

test("canonical validation rejects rewritten prefixes, wrong append boundaries and malformed results", () => {
  assert.equal(checkCanonicalContinuity("Keep café.", { canonicalText: "Keep café. Next.", appendText: " Next.", chunkText: "Next." }), "Keep café. Next.");
  assert.throws(() => checkCanonicalContinuity("Keep café.", { canonicalText: "Keep cafe. Next.", appendText: " Next.", chunkText: "Next." }));
  assert.throws(() => checkCanonicalContinuity("Keep café.", { canonicalText: "Keep café. Next.", appendText: "Keep café. Next.", chunkText: "Next." }));
  assert.throws(() => checkCanonicalContinuity("", { canonicalText: "Next.", appendText: "Next." }));
});

test("fixed gate rejects the demonstrated 24-word merger loss", () => {
  const reference = Array(18).fill("GO DO YOU HEAR").join(" ");
  const originalFailure = Array(12).fill("GO DO YOU HEAR").join(" ");
  const score = scoreTranscript(reference, originalFailure);
  assert.equal(score.deletions, 24);
  assert.equal(score.hypothesisWords, 48);
  assert.ok(score.wer > CONTINUITY_MAX_WER);
});

test("continuity gates reject missing or extra phrases even when the fixed WER gate passes", () => {
  const phrase = "GO DO YOU HEAR";
  const reference = Array(18).fill(phrase).join(" ");
  for (const count of [17, 19]) {
    const result = checkRepeatedContinuity(reference, Array(count).fill(phrase).join(" "), phrase);
    assert.equal(result.werPassed, true);
    assert.equal(result.integrityPassed, false);
    assert.equal(result.passed, false);
    assert.equal(result.details.repetition.observedNonoverlappingExactPhrases, count);
    assert.equal(result.accuracy.deletions, count === 17 ? 4 : 0);
    assert.equal(result.accuracy.insertions, count === 19 ? 4 : 0);
  }
  assert.equal(checkRepeatedContinuity(reference, Array(18).fill("Go! Do you hear?").join(" "), phrase).passed, true);
});

test("the exact sequence gate counts mistakes inside otherwise intact repetitions", () => {
  const phrase = "GO DO YOU HEAR";
  const reference = Array(18).fill(phrase).join(" ");
  const hypothesis = Array(18).fill(phrase);
  hypothesis[9] = "GO DID YOU HEAR";
  const result = checkRepeatedContinuity(reference, hypothesis.join(" "), phrase);
  assert.equal(result.accuracy.substitutions, 1);
  assert.equal(result.werPassed, true);
  assert.equal(result.passed, false);
});

test("the Nemotron baseline CLI refuses old reports and malformed arguments before model or inference access", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voco-continuity-preflight-"));
  try {
    const report = path.join(directory, "prior.json");
    fs.writeFileSync(report, "retained failed evidence");
    const env = { ...process.env, VOCO_NEMOTRON_MODEL: path.join(directory, "missing-model"), VOCO_SPEECH_WORKER: path.join(directory, "missing-worker") };
    const runner = new URL("./test-speech-baseline.mjs", import.meta.url);
    for (const [args, expected] of [
      [["--report", report], /Choose a new report path/],
      [["--report"], /Usage:/],
      [["--unknown", report], /Usage:/],
    ]) {
      const run = spawnSync(process.execPath, [fileURLToPath(runner), ...args], { env, encoding: "utf8", timeout: 10_000 });
      assert.equal(run.error, undefined);
      assert.equal(run.status, 1);
      assert.match(run.stderr, expected);
      assert.equal(fs.readFileSync(report, "utf8"), "retained failed evidence");
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
