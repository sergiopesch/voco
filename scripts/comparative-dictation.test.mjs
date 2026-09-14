import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateComparison } from './comparative-dictation.mjs';

const sha = 'a'.repeat(64);

function fixture() {
  return [{
    schemaVersion: 1,
    modelSha256: sha,
    resourceCaps: {
      timeoutMs: 1000,
      maxRssBytes: 100
    },
    cases: [{
      id: 'one',
      reference: 'Send 42 files to Ada Lovelace',
      audioSha256: sha,
      durationSeconds: 3,
      maxWer: .5,
      protectedTerms: ['42', 'Ada Lovelace']
    }]
  }, {
    planSha256: sha,
    modelSha256: sha,
    system: {
      id: 'fixture',
      version: 'test',
      artifactSha256: sha
    },
    environment: 'unit test only',
    timingBoundary: 'decode call',
    loadState: 'warm',
    cases: [{
      id: 'one',
      audioSha256: sha,
      status: 'completed',
      hypothesis: 'Send 42 files to Ada Lovelace',
      elapsedMs: 100,
      peakRssBytes: 50,
      correction: null
    }]
  }];
}

test('exact import reports separate edits and unmeasured human correction', () => {
  const [p, r] = fixture();
  const x = evaluateComparison(p, r, sha);
  assert.equal(x.passed, true);
  assert.equal(x.measuredCorrectionCases, 0);
  assert.equal(x.completedOnlyAccuracy.edits, 0);
});

test('passing loose WER cannot waive numeral or proper name corruption', () => {
  for (const hypothesis of ['Send 43 files to Ada Lovelace', 'Send 42 files to Ava Lovelace']) {
    const [p, r] = fixture();
    r.cases[0].hypothesis = hypothesis;
    assert.equal(evaluateComparison(p, r, sha).passed, false);
  }
});

test('empty completed speech fails', () => {
  const [p, r] = fixture();
  r.cases[0].hypothesis = '';
  assert.equal(evaluateComparison(p, r, sha).passed, false);
});

test('timeout stays in denominator and cannot produce a latency percentile', () => {
  const [p, r] = fixture();
  delete r.cases[0].hypothesis;
  r.cases[0].status = 'timeout';
  r.cases[0].elapsedMs = 1000;
  const x = evaluateComparison(p, r, sha);
  assert.equal(x.passed, false);
  assert.equal(x.censoredCases, 1);
  assert.equal(x.completedOnlyLatencyMs.p95, null);
  assert.equal(x.completedOnlyAccuracy.wer, null);
});

test('resource and duration overruns fail even on exact text', () => {
  for (const key of ['elapsedMs', 'peakRssBytes']) {
    const [p, r] = fixture();
    r.cases[0][key] = 1001;
    assert.equal(evaluateComparison(p, r, sha).passed, false);
  }
});

test('invalid IDs hashes booleans and missing cases reject', () => {
  for (const mutate of [
    r => r.modelSha256 = 'b'.repeat(64),
    r => r.cases[0].elapsedMs = true,
    r => r.cases[0].elapsedMs = NaN,
    r => r.cases[0].id = undefined,
    r => r.cases = [],
    r => r.system.artifactSha256 = '',
  ]) {
    const [p, r] = fixture();
    mutate(r);
    assert.throws(() => evaluateComparison(p, r, sha));
  }
});

test('protected phrase count and actual human measurements are explicit', () => {
  const [p, r] = fixture();
  r.cases[0].hypothesis += ' Ada Lovelace';
  r.cases[0].correction = {
    elapsedMs: 500,
    actions: 3
  };
  const x = evaluateComparison(p, r, sha);
  assert.equal(x.passed, false);
  assert.equal(x.measuredCorrectionCases, 1);
  assert.equal(x.results[0].score.insertions, 2);
});

test('CLI invalid input retains a private failure artifact and refuses overwrite', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'voco-compare-'));
  try {
    const p = path.join(d, 'plan'),
      r = path.join(d, 'run'),
      o = path.join(d, 'report');
    fs.writeFileSync(p, '{}');
    fs.writeFileSync(r, '{}');
    const args = ['scripts/comparative-dictation.mjs', p, r, o];
    assert.equal(spawnSync(process.execPath, args).status, 1);
    const prior = fs.readFileSync(o);
    assert.equal(JSON.parse(prior).passed, false);
    assert.equal(fs.statSync(o).mode & 0o777, 0o600);
    assert.equal(spawnSync(process.execPath, args).status, 1);
    assert.deepEqual(fs.readFileSync(o), prior);
  } finally {
    fs.rmSync(d, {
      recursive: true,
      force: true
    });
  }
});

test('unmeasured RSS cannot satisfy a resource-capped qualification', () => {
  const [p, r] = fixture();
  r.cases[0].peakRssBytes = null;
  const x = evaluateComparison(p, r, sha);
  assert.equal(x.passed, false);
  assert.equal(x.missingRssMeasurements, 1);
});

test('present invalid integrity cannot silently disable its prospective gate', () => {
  for (const value of [false, null, 0, '']) {
    const [p, r] = fixture();
    p.cases[0].integrity = value;
    assert.throws(() => evaluateComparison(p, r, sha), /Invalid speech integrity input/);
  }
});

test('nonfinite derived real-time factor is rejected before JSON loses it', () => {
  for (const duration of [1e-320, 1e308]) {
    const [p, r] = fixture();
    p.cases[0].durationSeconds = duration;
    assert.throws(() => evaluateComparison(p, r, sha), /real-time factor|audio duration/);
  }
});

test('CLI rejects FIFO symlink and oversized sidecars without blocking', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'voco-compare-types-'));
  try {
    const run = path.join(d, 'run');
    fs.writeFileSync(run, '{}');
    const ordinary = path.join(d, 'ordinary');
    fs.writeFileSync(ordinary, '{}');
    const symlink = path.join(d, 'symlink');
    fs.symlinkSync(ordinary, symlink);
    const fifo = path.join(d, 'fifo');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const large = path.join(d, 'large');
    fs.writeFileSync(large, '');
    fs.truncateSync(large, 8 * 1024 * 1024 + 1);
    for (const input of [fifo, symlink, large]) {
      const out = input + '.report';
      const result = spawnSync(process.execPath, ['scripts/comparative-dictation.mjs', input, run, out], {
        timeout: 2000
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      const report = JSON.parse(fs.readFileSync(out));
      assert.equal(report.passed, false);
      assert.ok(report.validationError);
    }
  } finally {
    fs.rmSync(d, {
      recursive: true,
      force: true
    });
  }
});
