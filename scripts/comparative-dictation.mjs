import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { scoreTranscript, words } from './speech-score.mjs';
import { scoreSpeechIntegrity } from './speech-integrity.mjs';

const MAX_SIDECAR_BYTES = 8 * 1024 * 1024;

// Inspect the opened object, not a path that could change between stat and read.
// Nonblocking opens let us reject FIFO/device inputs before reading them.
function readSidecar(path) {
  const fd = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const info = fs.fstatSync(fd);
    assert.ok(info.isFile(), 'Sidecar must be a regular non-symlink file');
    assert.ok(info.size <= MAX_SIDECAR_BYTES, 'Sidecar exceeds 8 MiB limit');
    const buffer = Buffer.alloc(MAX_SIDECAR_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    assert.ok(length <= MAX_SIDECAR_BYTES, 'Sidecar grew beyond 8 MiB limit');
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const finite = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const quantile = (xs, q) => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(q * xs.length) - 1] : null;
const occurrences = (source, term) => {
  const a = words(source),
    b = words(term);
  return a.reduce((n, _, i) => n + Number(b.every((w, j) => a[i + j] === w)), 0);
};

/** Import measurements, never execute applications or infer absent/censored text. */
export function evaluateComparison(plan, run, planSha256) {
  assert.equal(plan.schemaVersion, 1);
  assert.ok(digest(planSha256));
  assert.ok(digest(plan.modelSha256));
  assert.equal(run.modelSha256, plan.modelSha256);
  assert.equal(run.planSha256, planSha256);
  assert.ok(text(run.system?.id) && text(run.system.version) && digest(run.system.artifactSha256));
  assert.ok(text(run.environment) && text(run.timingBoundary));
  assert.ok(['cold', 'warm'].includes(run.loadState));
  assert.ok(finite(plan.resourceCaps?.timeoutMs) && plan.resourceCaps.timeoutMs > 0);
  assert.ok(finite(plan.resourceCaps.maxRssBytes) && plan.resourceCaps.maxRssBytes > 0);
  assert.ok(Array.isArray(plan.cases) && plan.cases.length > 0);
  assert.ok(Array.isArray(run.cases) && run.cases.length === plan.cases.length);
  const ids = new Set();
  const actual = new Map();
  for (const row of run.cases) {
    assert.ok(text(row.id) && !actual.has(row.id));
    actual.set(row.id, row);
  }
  const results = [];
  for (const item of plan.cases) {
    assert.ok(text(item.id) && !ids.has(item.id));
    ids.add(item.id);
    assert.ok(text(item.reference) && words(item.reference).length > 0 && words(item.reference).length <= 2000);
    assert.ok(digest(item.audioSha256) && finite(item.durationSeconds) && item.durationSeconds > 0);
    assert.ok(finite(item.maxWer));
    const row = actual.get(item.id);
    assert.ok(row, 'Missing planned case');
    assert.equal(row.audioSha256, item.audioSha256);
    assert.ok(['completed', 'timeout', 'error', 'resource-limit'].includes(row.status));
    assert.ok(finite(row.elapsedMs));
    assert.ok(row.peakRssBytes === null || finite(row.peakRssBytes));
    assert.ok(
      row.correction === null ||
      (finite(row.correction?.elapsedMs) &&
        Number.isSafeInteger(row.correction.actions) &&
        row.correction.actions >= 0),
    );
    const capExceeded =
      row.elapsedMs > plan.resourceCaps.timeoutMs ||
      (row.peakRssBytes !== null &&
        row.peakRssBytes > plan.resourceCaps.maxRssBytes);
    assert.ok(Array.isArray(item.protectedTerms));
    for (const term of item.protectedTerms) assert.ok(text(term) && words(term).length > 0 && occurrences(item.reference, term) > 0);
    // Validate prospective integrity even when the peer timed out.
    if (Object.hasOwn(item, 'integrity')) scoreSpeechIntegrity(item.reference, item.reference, item.integrity);
    if (row.status !== 'completed') {
      assert.ok(!Object.hasOwn(row, 'hypothesis'), 'Censored output belongs in raw evidence, not a completed score');
      assert.equal(row.correction, null);
      results.push({
        id: item.id,
        status: row.status,
        passed: false,
        score: null,
        elapsedMs: row.elapsedMs,
        capExceeded,
        correction: null
      });
      continue;
    }
    assert.ok(typeof row.hypothesis === 'string' && words(row.hypothesis).length <= 4000);
    const score = scoreTranscript(item.reference, row.hypothesis);
    const protectedTerms = item.protectedTerms.map(term => ({
      term,
      expected: occurrences(item.reference, term),
      actual: occurrences(row.hypothesis, term)
    }));
    const integrity = Object.hasOwn(item, 'integrity') ? scoreSpeechIntegrity(item.reference, row.hypothesis, item.integrity) : null;
    const durationMs = item.durationSeconds * 1000;
    assert.ok(Number.isFinite(durationMs) && durationMs > 0, 'Converted audio duration must be finite and positive');
    const realTimeFactor = row.elapsedMs / durationMs;
    assert.ok(Number.isFinite(realTimeFactor), 'Derived real-time factor must be finite');
    results.push({
      id: item.id,
      status: row.status,
      passed:
        score.hypothesisWords > 0 &&
        score.wer <= item.maxWer &&
        row.peakRssBytes !== null &&
        !capExceeded &&
        protectedTerms.every(t => t.actual === t.expected) &&
        (!integrity || integrity.integrityPassed),
      score,
      protectedTerms,
      integrity,
      elapsedMs: row.elapsedMs,
      realTimeFactor,
      peakRssBytes: row.peakRssBytes,
      capExceeded,
      minimumWordEditProxy: score.edits,
      correction: row.correction
    });
  }
  const completed = results.filter(x => x.score !== null),
    times = completed.map(x => x.elapsedMs);
  const totals = completed.reduce((a, x) => {
    for (const k of Object.keys(a)) a[k] += x.score[k];
    return a;
  }, {
    substitutions: 0,
    deletions: 0,
    insertions: 0,
    edits: 0,
    referenceWords: 0
  });
  return {
    schemaVersion: 1,
    planSha256,
    modelSha256: plan.modelSha256,
    system: run.system,
    environment: run.environment,
    timingBoundary: run.timingBoundary,
    loadState: run.loadState,
    passed: results.every(x => x.passed),
    plannedCases: results.length,
    completedCases: completed.length,
    failedCases: results.filter(x => !x.passed).length,
    censoredCases: results.length - completed.length,
    completedOnlyAccuracy: {
      ...totals,
      wer: totals.referenceWords ? totals.edits / totals.referenceWords : null
    },
    completedOnlyLatencyMs: {
      p50: quantile(times, .5),
      p90: quantile(times, .9),
      p95: quantile(times, .95),
      n: times.length
    },
    missingRssMeasurements: run.cases.filter(x => x.peakRssBytes === null).length,
    measuredCorrectionCases: completed.filter(x => x.correction !== null).length,
    results
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) {
    console.error('Usage: node scripts/comparative-dictation.mjs PLAN.json RUN.json NEW_REPORT.json');
    process.exitCode = 2;
  } else {
    const [planPath, runPath, output] = process.argv.slice(2);
    let report;
    try {
      const bytes = readSidecar(planPath),
        runBytes = readSidecar(runPath);
      report = {
        ...evaluateComparison(JSON.parse(bytes), JSON.parse(runBytes), hash(bytes)),
        runSha256: hash(runBytes),
        evaluatorSha256: hash(fs.readFileSync(new URL(import.meta.url))),
        scorerSha256: hash(fs.readFileSync(new URL('./speech-score.mjs', import.meta.url))),
        integrityScorerSha256: hash(fs.readFileSync(new URL('./speech-integrity.mjs', import.meta.url)))
      };
      if (!report.passed) process.exitCode = 1;
    } catch (error) {
      report = {
        passed: false,
        validationError: error.message
      };
      process.exitCode = 1;
    }
    // Exclusive creation preserves previous evidence, including on invalid input.
    try {
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600
      });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
