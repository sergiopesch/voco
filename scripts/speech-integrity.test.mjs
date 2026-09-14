import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreSpeechIntegrity as score } from './speech-integrity.mjs';
const phrase = 'Go do you hear';
const reference = Array(18).fill(phrase).join(' ');
const repetition = { repetition: { phrase, count: 18 }, maxDeletions: 0, maxInsertions: 0 };
test('exact full repetitions pass normalized punctuation and casing', () => {
  assert.equal(score(reference, Array(18).fill('GO! Do you hear?').join(' '), repetition).integrityPassed, true);
});
test('one missing or additional phrase fails even when WER passes the previous .15 gate', () => {
  for (const count of [17, 19]) {
    const result = score(reference, Array(count).fill(phrase).join(' '), repetition);
    assert.ok(result.accuracy.wer <= .15);
    assert.equal(result.integrityPassed, false);
    assert.equal(result.details.repetition.observedNonoverlappingExactPhrases, count);
    assert.equal(count === 17 ? result.accuracy.deletions : result.accuracy.insertions, 4);
  }
});
test('same word count cannot hide missing phrase and unrelated invented words', () => {
  const result = score(reference, Array(17).fill(phrase).join(' ') + ' thank you very much', repetition);
  assert.equal(result.accuracy.referenceWords, result.accuracy.hypothesisWords);
  assert.equal(result.integrityPassed, false);
});
test('separate insertion/deletion budgets cannot cancel each other', () => {
  const result = score('alpha beta gamma delta', 'beta gamma delta epsilon', { maxDeletions: 0, maxInsertions: 0 });
  assert.equal(result.accuracy.deletions, 1); assert.equal(result.accuracy.insertions, 1);
  assert.equal(result.checks.maxDeletions, false); assert.equal(result.checks.maxInsertions, false);
});
test('complete boundary words reject omitted endings and empty speech', () => {
  const requirements = { boundary: { prefix: 'alpha beta', suffix: 'gamma delta' }, maxDeletions: 0 };
  assert.equal(score('alpha beta gamma delta', 'Alpha beta gamma delta.', requirements).integrityPassed, true);
  for (const output of ['', 'alpha beta gamma', 'beta gamma delta']) assert.equal(score('alpha beta gamma delta', output, requirements).integrityPassed, false);
});
test('invalid booleans, NaN, infinity, fractional budgets, vacuous gates and malformed inputs throw', () => {
  for (const value of [true, false, NaN, Infinity, -1, 0.5, '0', null]) assert.throws(() => score('hello', 'hello', { maxDeletions: value }));
  for (const bad of [{}, { exactWords: false }, { boundary: {} }, { boundary: { suffix: 'other' } }, { repetition: { phrase: 'hello', count: true } }, { repetition: { phrase: 'hello', count: 2 } }, { ignored: true }]) assert.throws(() => score('hello', 'hello', bad));
  for (const bad of [true, null, {}, 4]) assert.throws(() => score('hello', bad, { exactWords: true }));
});
test('declared full reference cannot silently crop words or accept overlapping phrase counts', () => {
  assert.throws(() => score('go do you hear now', 'go do you hear', { repetition: { phrase, count: 1 } }));
  assert.equal(score('go go go go', 'go go go', { repetition: { phrase: 'go go', count: 2 } }).integrityPassed, false);
});

test('report adapter rejects incomplete, duplicate, mismatched and failed worker records', async () => {
  const { evaluateIntegrityReport: evaluate } = await import('./speech-integrity.mjs');
  const modelSha256 = 'a'.repeat(64);
  const plan = { modelSha256, cases: [{ id: 'one', reference: 'hello', maxWer: 0.5, integrityRequirements: { exactWords: true } }] };
  const report = { modelSha256, completedCases: 1, workerExitCode: 0, passed: true, results: [{ id: 'one', response: { chunkText: 'Hello!' } }] };
  assert.equal(evaluate(plan, report).passed, true);
  assert.equal(evaluate(plan, { ...report, passed: false }).passed, false, 'original family failure cannot be waived');
  for (const patch of [{ completedCases: true }, { results: [] }, { workerExitCode: false }, { passed: 1 }, { modelSha256: 'b'.repeat(64) }, { results: [{ id: 'other', response: { chunkText: 'hello' } }] }]) assert.throws(() => evaluate(plan, { ...report, ...patch }));
  assert.throws(() => evaluate({ ...plan, cases: [{ ...plan.cases[0], maxWer: true }] }, report));
  assert.throws(() => evaluate({ ...plan, cases: [plan.cases[0], plan.cases[0]] }, { ...report, completedCases: 2, results: [report.results[0], report.results[0]] }));
});
