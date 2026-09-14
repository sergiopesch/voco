export function words(text) {
  return text.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[’‘]/gu, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

export function validateSpeechManifest(manifest) {
  const require = (condition, detail) => {
    if (!condition) throw new Error(`Invalid speech manifest: ${detail}`);
  };
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const bound = (value) => Number.isFinite(value) && value >= 0;
  require(manifest !== null && typeof manifest === "object" && !Array.isArray(manifest), "expected an object");
  require(manifest.schemaVersion === 1, "schemaVersion must be 1");
  require(hash(manifest.modelSha256), "modelSha256 must be a lowercase SHA-256 digest");
  require(bound(manifest.maxAggregateWer), "maxAggregateWer must be finite and nonnegative");
  require(Array.isArray(manifest.fixtures) && manifest.fixtures.length > 0, "fixtures must be a nonempty array");
  const ids = new Set();
  const files = new Set();
  let referenceWords = 0;
  for (const fixture of manifest.fixtures) {
    require(fixture !== null && typeof fixture === "object" && !Array.isArray(fixture), "each fixture must be an object");
    require(typeof fixture.id === "string" && fixture.id.trim().length > 0 && !ids.has(fixture.id), "fixture IDs must be nonempty and unique");
    ids.add(fixture.id);
    require(typeof fixture.file === "string" && fixture.file.endsWith(".wav") &&
      !/[\\\u0000-\u001f\u007f:]/u.test(fixture.file) &&
      fixture.file.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    `${fixture.id}: file must be a relative WAV path without traversal`);
    require(!files.has(fixture.file), `${fixture.id}: fixture files must be unique`);
    files.add(fixture.file);
    require(hash(fixture.sha256) && hash(fixture.sourceFlacSha256), `${fixture.id}: invalid fixture/source SHA-256`);
    require(Number.isFinite(fixture.seconds) && fixture.seconds > 0 && fixture.seconds <= 30,
      `${fixture.id}: seconds must be positive and within the 30-second canonical limit`);
    require(bound(fixture.maxWer), `${fixture.id}: maxWer must be finite and nonnegative`);
    require(typeof fixture.reference === "string" && words(fixture.reference).length > 0,
      `${fixture.id}: reference must contain words`);
    referenceWords += words(fixture.reference).length;
  }
  require(Number.isSafeInteger(referenceWords) && referenceWords > 0, "total reference words must be positive");
  return manifest;
}

export function buildSpeechReplayRequests(samples, previousCanonicalText = "") {
  if (!Number.isSafeInteger(samples) || samples <= 0 || samples > 30 * 16_000) {
    throw new Error("Speech replay must contain between one sample and 30 seconds");
  }
  const requests = [
    { mode: "full", request: { startSample: 0, endSample: samples, fullSession: true } },
    { mode: "canonical", request: { startSample: 0, endSample: samples, canonical: true, previousCanonicalText } },
  ];
  if (samples >= 0.7 * 16_000 && samples <= 20 * 16_000) {
    requests.push({ mode: "preview", request: { startSample: 0, endSample: samples } });
  }
  return requests;
}

export function validateSpeechFixtureWav(wav, seconds) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 16) !== "WAVEfmt " || wav.toString("ascii", 36, 40) !== "data" ||
    wav.readUInt32LE(4) !== wav.length - 8 || wav.readUInt32LE(16) !== 16 ||
    wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== 16_000 || wav.readUInt32LE(28) !== 32_000 ||
    wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16 ||
    wav.readUInt32LE(40) !== wav.length - 44 || (wav.length - 44) % 2 !== 0) {
    throw new Error("Speech fixture must be complete mono 16 kHz PCM16 WAV in the replay worker's supported layout");
  }
  const samples = (wav.length - 44) / 2;
  if (!Number.isFinite(seconds) || samples <= 0 || Math.round(seconds * 16_000) !== samples) {
    throw new Error("Speech fixture duration does not match its complete WAV samples");
  }
  return samples;
}

export function validateSpeechReplayResults(requests, responses) {
  if (!Array.isArray(responses) || responses.length !== requests.length) {
    throw new Error("Replay worker returned incomplete results");
  }
  return Object.fromEntries(requests.map(({ mode }, index) => {
    const response = responses[index];
    const textFields = mode === "canonical" ? ["canonicalText", "appendText", "chunkText"] : ["text"];
    if (response === null || typeof response !== "object" || Array.isArray(response) ||
      textFields.some((field) => typeof response[field] !== "string") ||
      (mode === "preview" && !Array.isArray(response.segments))) {
      throw new Error(`Replay worker returned invalid ${mode} output`);
    }
    return [mode, response];
  }));
}

// Levenshtein WER with a deterministic substitution/deletion/insertion tie order.
// Keep empty-reference insertions explicit instead of dividing by zero.
export function scoreTranscript(reference, hypothesis) {
  const expected = words(reference);
  const actual = words(hypothesis);
  let prior = actual.map((_, index) => ({ substitutions: 0, deletions: 0, insertions: index + 1, edits: index + 1 }));
  prior.unshift({ substitutions: 0, deletions: 0, insertions: 0, edits: 0 });
  for (let i = 1; i <= expected.length; i += 1) {
    const row = [{ substitutions: 0, deletions: i, insertions: 0, edits: i }];
    for (let j = 1; j <= actual.length; j += 1) {
      if (expected[i - 1] === actual[j - 1]) {
        row.push({ ...prior[j - 1] });
      } else {
        const choices = [
          { ...prior[j - 1], substitutions: prior[j - 1].substitutions + 1, edits: prior[j - 1].edits + 1 },
          { ...prior[j], deletions: prior[j].deletions + 1, edits: prior[j].edits + 1 },
          { ...row[j - 1], insertions: row[j - 1].insertions + 1, edits: row[j - 1].edits + 1 },
        ];
        row.push(choices.reduce((best, value) => value.edits < best.edits ? value : best));
      }
    }
    prior = row;
  }
  const result = prior[actual.length];
  return { ...result, referenceWords: expected.length, hypothesisWords: actual.length,
    wer: expected.length ? result.edits / expected.length : (actual.length ? null : 0) };
}
