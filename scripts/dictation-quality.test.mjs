import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compareText, scoreQualityManifest } from "./dictation-quality.mjs";
import { scoreTranscript } from "./speech-score.mjs";

const audited = { punctuation: true, capitalization: true };
const manifest = (...cases) => ({ schemaVersion: 1,
  provenance: { kind: "public-fixture", description: "Authored synthetic public text; no recording or personal data." }, cases });
const fixture = (changes = {}) => ({ id: "public-example", reference: { text: "Hello, world.", formatting: audited },
  modelText: "Hello, world.", queuedText: "Hello, world.", intendedFieldText: "Hello, world.",
  observedField: { status: "observed", text: "Hello, world." }, ...changes });

test("case and punctuation blindspots remain visible without changing lexical WER", () => {
  assert.equal(scoreTranscript("Hello, world!", "hello world").wer, 0);
  const result = compareText("Hello, world!", "hello world", audited);
  assert.equal(result.normalizedLexical.wer, 0);
  assert.equal(result.exactCharacters.exact, false);
  assert.equal(result.exactCharacters.editDistance, 3);
  assert.equal(result.capitalization.errors, 1);
  assert.equal(result.capitalization.eligibleWords, 2);
  assert.equal(result.punctuation.falseNegative, 2);
  assert.equal(result.punctuation.recall, 0);
  assert.equal(result.punctuation.precision, null);
  assert.equal(result.rawWhitespaceTokens.errorRate, 1);
  assert.equal(result.whitespace.status, "unavailable");
});

test("leading/trailing whitespace and repeated-session joins are independent errors", () => {
  const result = compareText("Hello. World.\n", "Hello.World.");
  assert.equal(result.normalizedLexical.wer, 0);
  assert.equal(result.whitespace.missingBoundaries, 2);
  assert.equal(result.whitespace.missingCodepoints, 2);
  assert.equal(result.exactCharacters.editDistance, 2);
  const added = compareText("Hello world", " Hello  world ");
  assert.equal(added.whitespace.extraBoundaries, 2);
  assert.equal(added.whitespace.changedWhitespace, 1);
  assert.equal(added.whitespace.extraCodepoints, 3);
  assert.equal(compareText("Hello\nworld", "Hello world").whitespace.changedWhitespace, 1);
  assert.equal(compareText("Hello\u00a0world", "Hello world").whitespace.changedWhitespace, 1);
});

test("character slots detect split and joined partial words", () => {
  assert.equal(compareText("hello", "hel lo").whitespace.extraBoundaries, 1);
  assert.equal(compareText("some thing", "something").whitespace.missingBoundaries, 1);
  assert.equal(compareText("hello", "hel").exactCharacters.editDistance, 2);
  assert.equal(compareText("hello", "hel", audited).capitalization.status, "unavailable");
});

test("numbers, dates, identifiers and Unicode retain exact written form", () => {
  assert.equal(compareText("42", "43").normalizedLexical.substitutions, 1);
  assert.equal(compareText("42", "forty two").normalizedLexical.wer, 2);
  assert.equal(compareText("2026-09-15", "2026/09/15", audited).punctuation.falsePositive, 2);
  assert.equal(compareText("API_v2", "api_v2", audited).capitalization.errors, 1);
  const width = compareText("42", "４２", audited);
  assert.equal(width.normalizedLexical.wer, 0);
  assert.equal(width.exactCharacters.editDistance, 2);
  const composed = compareText("Café", "Cafe\u0301", audited);
  assert.equal(composed.normalizedLexical.wer, 0);
  assert.equal(composed.exactCharacters.editDistance, 2);
  assert.equal(composed.capitalization.errors, 0);
  const emoji = compareText("a😀", "a😃");
  assert.equal(emoji.exactCharacters.referenceCodepoints, 2);
  assert.equal(emoji.exactCharacters.editDistance, 1);
  assert.equal(emoji.exactCharacters.cer, 0.5);
  assert.equal(compareText("don’t", "don't", audited).exactCharacters.editDistance, 1);
});

test("punctuation scores by mark and aligned boundary, including additions", () => {
  const result = compareText("Hello, world.", "Hello world!", audited).punctuation;
  assert.equal(result.truePositive, 0);
  assert.equal(result.falseNegative, 2);
  assert.equal(result.falsePositive, 1);
  assert.equal(result.byMark[","].falseNegative, 1);
  assert.equal(result.byMark["!"].falsePositive, 1);
  assert.equal(result.f1, 0);
  const moved = compareText("Hello, world", "Hello world,", audited).punctuation;
  assert.equal(moved.falsePositive, 1);
  assert.equal(moved.falseNegative, 1);
  assert.equal(compareText("Hello world", "Hello world", audited).punctuation.f1, null);
});

test("substitutions and ambiguous repeated words exclude unsupported formatting", () => {
  const substitution = compareText("Nice, blue sky.", "nice green sky!", audited);
  assert.equal(substitution.alignment.excludedReferenceWords, 1);
  assert.equal(substitution.punctuation.eligibleBoundaries, 2);
  assert.equal(substitution.punctuation.excludedReferenceBoundaries, 2);
  assert.equal(substitution.punctuation.falseNegative, 1); // The comma beside changed 'blue' is excluded.
  assert.equal(substitution.capitalization.eligibleWords, 2);
  assert.equal(substitution.capitalization.errors, 1);
  const repeated = compareText("Go, go.", "go.", audited);
  assert.equal(repeated.alignment.ambiguousReferenceWords, 2);
  assert.equal(repeated.alignment.unambiguousEqualWords, 0);
  assert.equal(repeated.capitalization.status, "unavailable");
  assert.equal(repeated.punctuation.status, "unavailable");
  assert.equal(repeated.punctuation.f1, null);
  assert.equal(compareText("Go, go.", "Go, go.", audited).capitalization.eligibleWords, 2);
});

test("unaudited references never authorize punctuation or capitalization scoring", () => {
  const result = compareText("HELLO WORLD", "Hello, world.");
  assert.equal(result.punctuation.status, "unavailable");
  assert.equal(result.capitalization.status, "unavailable");
  assert.equal(result.normalizedLexical.wer, 0);
  assert.equal(result.exactCharacters.exact, false);
});

test("missing reference and empty reference are distinct and do not fabricate rates", () => {
  assert.deepEqual(compareText(undefined, "speech"), { status: "unavailable", reason: "missing_reference_text" });
  const silence = compareText("", "invented speech", audited);
  assert.equal(silence.normalizedLexical.wer, null);
  assert.equal(silence.normalizedLexical.insertions, 2);
  assert.equal(silence.exactCharacters.cer, null);
  assert.equal(silence.exactCharacters.editDistance, 15);
  const empty = compareText("", "", audited);
  assert.equal(empty.exactCharacters.exact, true);
  assert.equal(empty.exactCharacters.cer, null);
  assert.equal(empty.normalizedLexical.wer, null);
  assert.equal(empty.punctuation.precision, null);
  assert.equal(empty.capitalization.accuracy, null);
  assert.equal(compareText("...", "...", audited).punctuation.truePositive, 3);
});

test("stage attribution separates model error from exact application and field delivery", () => {
  const result = scoreQualityManifest(manifest(fixture({
    modelText: "Hello, word.", queuedText: "Hello, word.", intendedFieldText: "Prefill: Hello, word.",
    observedField: { status: "observed", text: "Prefill: Hello, word." },
  })));
  assert.deepEqual(result.cases[0].stageDifferences, ["recognition"]);
  assert.equal(result.summary.stages.delivery.exact, 1);
  const delivery = scoreQualityManifest(manifest(fixture({ observedField: { status: "observed", text: "Hello, wor" } })));
  assert.deepEqual(delivery.cases[0].stageDifferences, ["delivery"]);
});

test("dispatch-only evidence and missing full-field intent cannot pass delivery", () => {
  const result = scoreQualityManifest(manifest(fixture({
    reference: undefined, observedField: { status: "unavailable", reason: "Only helper dispatch observed." },
  }), fixture({ id: "missing-intent", intendedFieldText: undefined })));
  assert.equal(result.summary.stages.recognition.unavailable, 1);
  assert.equal(result.summary.stages.delivery.unavailable, 2);
  assert.equal(result.summary.stages.delivery.exact, 0);
  assert.equal(result.summary.observedCases, 1);
  assert.equal(result.cases[0].stages.delivery.reason, "target_field_not_observed");
  assert.equal(result.cases[1].stages.delivery.reason, "missing_reference_text");
});

test("an explicit empty model update array remains unavailable", () => {
  const result = scoreQualityManifest(manifest(fixture({ modelUpdates: [] })));
  assert.deepEqual(result.cases[0].finalization, { status: "unavailable", reason: "model_update_evidence_not_supplied" });
});

test("two sessions and a final revision remain explicit without inventing a join policy", () => {
  const result = scoreQualityManifest(manifest(fixture({
    reference: { text: "Hello. World.", formatting: audited }, modelText: "Hello. World.",
    queuedText: "Hello.World.", intendedFieldText: "Hello.World.",
    observedField: { status: "observed", text: "Hello.World." },
    sessions: [{ sessionId: "s1", modelText: "Hello.", queuedText: "Hello." },
      { sessionId: "s2", modelText: "World.", queuedText: "World." }],
    modelUpdates: [{ text: "Hello. Wor" }, { text: "Hello. World" }, { text: "Hello. World.", final: true }],
  })));
  const item = result.cases[0];
  assert.deepEqual(item.stageDifferences, ["transformation"]);
  assert.equal(item.stages.transformation.whitespace.missingBoundaries, 1);
  assert.equal(item.sessions.count, 2);
  assert.equal(item.sessions.repeatedSessions, true);
  assert.equal(item.finalization.revisions.length, 0);
  const revised = scoreQualityManifest(manifest(fixture({ modelText: "Hello, world.",
    modelUpdates: [{ text: "hello world" }, { text: "Hello, world.", final: true }] }))).cases[0];
  assert.equal(revised.finalization.revisions.length, 1);
  assert.equal(revised.finalization.revisions[0].final, true);
  assert.equal(revised.finalization.lastUpdateMatchesModelText, true);
});

test("malformed or implicit evidence is rejected", () => {
  for (const value of [null, {}, { ...manifest(fixture()), provenance: undefined }, manifest(fixture(), fixture()),
    manifest(fixture({ reference: { text: null } })), manifest(fixture({ observedField: undefined })),
    manifest(fixture({ observedField: { status: "dispatched" } })),
    manifest(fixture({ observedField: { status: "unavailable", reason: "" } })),
    manifest(fixture({ sessions: [{ sessionId: "s", modelText: "a", queuedText: "a" }, { sessionId: "s", modelText: "b", queuedText: "b" }] })),
    manifest(fixture({ reference: { text: "hello", formatting: { punctuation: "yes" } } })),
  ]) assert.throws(() => scoreQualityManifest(value), /Invalid dictation quality manifest/u);
});

test("report omits raw diagnostic text and arbitrary descriptions/reasons", () => {
  const input = manifest(fixture({ modelText: "PRIVATE_PAYLOAD_SENTINEL", queuedText: "PRIVATE_PAYLOAD_SENTINEL",
    observedField: { status: "unavailable", reason: "PRIVATE_REASON_SENTINEL" } }));
  input.provenance = { kind: "explicit-local-diagnostic", description: "PRIVATE_DESCRIPTION_SENTINEL" };
  const output = JSON.stringify(scoreQualityManifest(input));
  assert.ok(!output.includes("PRIVATE_"));
});

test("large alignments are bounded and explicitly unavailable while exact fidelity survives", () => {
  const result = compareText("hello ".repeat(1500), "world ".repeat(1500), audited);
  assert.equal(result.normalizedLexical.status, "unavailable");
  assert.equal(result.alignment.status, "unavailable");
  assert.equal(result.exactCharacters.exact, false);
  assert.equal(result.exactCharacters.editDistance, null);
  assert.equal(result.exactCharacters.cerUnavailableReason, "bounded_character_alignment_limit");
});

test("CLI retains immutable private reports and rejects malformed input without leaking it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "voco-quality-"));
  try {
    const input = path.join(directory, "public-fixture.json");
    const output = path.join(directory, "report.json");
    await fs.writeFile(input, JSON.stringify(manifest(fixture())));
    const run = () => spawnSync(process.execPath, [new URL("./dictation-quality-cli.mjs", import.meta.url).pathname,
      "--input", input, "--output", output], { encoding: "utf8" });
    assert.equal(run().status, 0);
    assert.equal(JSON.parse(await fs.readFile(output, "utf8")).summary.stages.delivery.exact, 1);
    assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
    assert.equal(run().status, 1);
    await fs.writeFile(input, "{PRIVATE_SYNTAX_SENTINEL");
    const broken = run();
    assert.equal(broken.status, 1);
    assert.ok(!broken.stderr.includes("PRIVATE_SYNTAX_SENTINEL"));
    assert.match(broken.stderr, /Invalid JSON input/u);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
