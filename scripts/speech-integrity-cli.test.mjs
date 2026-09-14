import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const modelSha256 = 'a'.repeat(64);
function invocation(change = () => {}, prior = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voco-integrity-cli-'));
  try {
    const plan = { modelSha256, cases: [{ id: 'one', reference: 'hello', maxWer: .5, integrityRequirements: { exactWords: true } }] };
    const report = { modelSha256, workerSha256: 'b'.repeat(64), completedCases: 1, workerExitCode: 0, passed: true, results: [{ id: 'one', response: { chunkText: 'Hello!' } }] };
    change(plan, report);
    const text = JSON.stringify(plan);
    report.planSha256 ??= sha(text);
    fs.writeFileSync(path.join(dir, 'plan.json'), text);
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
    const output = path.join(dir, 'output.json');
    if (prior) fs.writeFileSync(output, 'retained evidence');
    const run = spawnSync(process.execPath, ['scripts/report-speech-integrity.mjs', path.join(dir, 'plan.json'), path.join(dir, 'report.json'), output], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined);
    const saved = fs.readFileSync(output, 'utf8');
    return { status: run.status, saved, report: prior ? null : JSON.parse(saved) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('actual CLI succeeds with matching provenance', () => {
  const run = invocation(); assert.equal(run.status, 0); assert.equal(run.report.passed, true); assert.equal(run.report.workerSha256, 'b'.repeat(64));
});
test('actual CLI retains failure artifacts for malformed IDs, hashes, hypotheses and reported errors', () => {
  const mutations = [
    (p,r) => { delete p.cases[0].id; delete r.results[0].id; },
    (p,r) => { p.cases[0].id = true; r.results[0].id = true; },
    (p,r) => { p.cases[0].id = ' '; r.results[0].id = ' '; },
    (p,r) => { r.planSha256 = 'c'.repeat(64); },
    (p,r) => { delete r.workerSha256; },
    (p,r) => { r.workerSha256 = false; },
    (p,r) => { r.failure = { message: 'decoder exited' }; },
    (p,r) => { delete r.results[0].response.chunkText; },
    (p,r) => { r.results[0].response.chunkText = false; },
    (p,r) => { r.workerExitCode = 1; },
  ];
  for (const change of mutations) {
    const run = invocation(change); assert.equal(run.status, 1); assert.equal(run.report.passed, false); assert.equal(typeof run.report.failure.message, 'string');
  }
});
test('actual CLI keeps original suite failure even with exact words', () => {
  const run = invocation((p,r) => { r.passed = false; });
  assert.equal(run.status, 1); assert.equal(run.report.passed, false); assert.equal(run.report.integrityPassed, true);
});
test('actual CLI refuses to overwrite historical evidence', () => {
  const run = invocation(() => {}, true); assert.notEqual(run.status, 0); assert.equal(run.saved, 'retained evidence');
});
test('qualification preparation help works normally and rejects optimization before preparing data', () => {
  const script = 'scripts/prepare-speech-qualification-next.py';
  const env = { ...process.env }; delete env.PYTHONOPTIMIZE;
  const normal = spawnSync('python3', [script, '--help'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(normal.status, 0); assert.match(normal.stdout, /prior-qualification-plan/);
  for (const [args, options] of [[[ '-O', script, '--help' ], env], [[script, '--help'], { ...env, PYTHONOPTIMIZE: '1' }]]) {
    const run = spawnSync('python3', args, { env: options, encoding: 'utf8', timeout: 10000 });
    assert.notEqual(run.status, 0); assert.match(run.stderr, /Speech validation requires/);
  }
});
