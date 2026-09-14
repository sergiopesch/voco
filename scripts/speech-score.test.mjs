import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSpeechReplayRequests, scoreTranscript, validateSpeechFixtureWav, validateSpeechManifest, validateSpeechReplayResults, words } from "./speech-score.mjs";

assert.deepEqual(words("Don’t drop Café 42."), ["don't", "drop", "café", "42"]);
assert.equal(scoreTranscript("One two three", "one two three.").wer, 0);
assert.deepEqual(scoreTranscript("one two three", "one four"), {
  substitutions: 1, deletions: 1, insertions: 0, edits: 2,
  referenceWords: 3, hypothesisWords: 2, wer: 2 / 3,
});
assert.equal(scoreTranscript("do not send", "do send").deletions, 1);
assert.equal(scoreTranscript("42", "43").substitutions, 1);
assert.equal(scoreTranscript("", "invented speech").insertions, 2);
assert.equal(scoreTranscript("", "invented speech").wer, null);
assert.equal(scoreTranscript("", "").wer, 0);
assert.equal(scoreTranscript("a", "a a").insertions, 1);
assert.equal(scoreTranscript("don't", "do not").edits, 2);

const manifest = {
  schemaVersion: 1, modelSha256: "a".repeat(64), maxAggregateWer: 0.25,
  fixtures: [{ id: "example", file: "example.wav", sha256: "b".repeat(64),
    sourceFlacSha256: "c".repeat(64), seconds: 10, maxWer: 0.5, reference: "Independent reference" }],
};
assert.equal(validateSpeechManifest(manifest), manifest);
for (const change of [
  { schemaVersion: 2 }, { fixtures: [] }, { fixtures: null },
  { maxAggregateWer: undefined }, { maxAggregateWer: NaN }, { maxAggregateWer: Infinity },
  { maxAggregateWer: -1 }, { modelSha256: "missing" },
  { fixtures: [manifest.fixtures[0], manifest.fixtures[0]] },
  { fixtures: [manifest.fixtures[0], { ...manifest.fixtures[0], id: "different" }] },
]) {
  assert.throws(() => validateSpeechManifest({ ...manifest, ...change }), /Invalid speech manifest/u);
}
for (const change of [
  { id: "" }, { file: "../secret.wav" }, { file: "/absolute.wav" },
  { file: "sub/../../escape.wav" }, { file: "sub\\escape.wav" }, { file: "./example.wav" },
  { file: "example.flac" }, { file: "C:/example.wav" }, { file: "bad\0.wav" },
  { sha256: "" }, { sourceFlacSha256: "" }, { reference: "..." }, { reference: null },
  { maxWer: undefined }, { maxWer: NaN }, { maxWer: Infinity }, { maxWer: -0.1 },
  { seconds: 0 }, { seconds: Infinity }, { seconds: NaN }, { seconds: 30.01 },
]) {
  assert.throws(() => validateSpeechManifest({ ...manifest, fixtures: [{ ...manifest.fixtures[0], ...change }] }), /Invalid speech manifest/u);
}
for (const value of [null, [], undefined]) {
  assert.throws(() => validateSpeechManifest(value), /Invalid speech manifest/u);
}
assert.deepEqual(buildSpeechReplayRequests(20 * 16_000).map(({ mode }) => mode), ["full", "canonical", "preview"]);
assert.deepEqual(buildSpeechReplayRequests(20 * 16_000 + 1).map(({ mode }) => mode), ["full", "canonical"]);
assert.deepEqual(buildSpeechReplayRequests(30 * 16_000, "Preserve this.").map(({ mode }) => mode), ["full", "canonical"]);
assert.deepEqual(buildSpeechReplayRequests(0.7 * 16_000 - 1).map(({ mode }) => mode), ["full", "canonical"]);
assert.equal(buildSpeechReplayRequests(16_000, "Preserve this.")[1].request.previousCanonicalText, "Preserve this.");
for (const samples of [0, -1, NaN, Infinity, 1.5, 30 * 16_000 + 1]) {
  assert.throws(() => buildSpeechReplayRequests(samples));
}
const requests = buildSpeechReplayRequests(16_000);
const responses = [{ text: "Hello" }, { canonicalText: "Hello", appendText: "Hello", chunkText: "Hello" }, { text: "Hello", segments: [] }];
assert.deepEqual(Object.keys(validateSpeechReplayResults(requests, responses)), ["full", "canonical", "preview"]);
for (const values of [[], responses.slice(0, 2), [...responses, {}], [null, ...responses.slice(1)],
  [responses[0], responses[1], null], [responses[0], responses[1], { text: "" }],
  [responses[0], { canonicalText: "partial" }, responses[2]]]) {
  assert.throws(() => validateSpeechReplayResults(requests, values), /Replay worker returned/u);
}
const corpus = new URL("../tests/fixtures/speech/", import.meta.url);
const checkedManifest = validateSpeechManifest(JSON.parse(fs.readFileSync(new URL("manifest.json", corpus), "utf8")));
for (const fixture of checkedManifest.fixtures) {
  const wav = fs.readFileSync(new URL(fixture.file, corpus));
  assert.equal(validateSpeechFixtureWav(wav, fixture.seconds), Math.round(fixture.seconds * 16_000));
  assert.throws(() => validateSpeechFixtureWav(wav, fixture.seconds / 2), /duration/u);
  assert.throws(() => validateSpeechFixtureWav(wav.subarray(0, wav.length - 2), fixture.seconds), /complete/u);
}
console.log("speech scoring tests passed");
