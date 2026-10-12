import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capitalChanges, identical, markdown, myWords, says, summarize, writesAsListed, CONDITIONS } from './speech-check-summary.mjs';

const fixture = { listed: ['Shakespeare', 'Ernest Dowson', 'et cetera'], distractors: ['Kubernetes'] };
const trial = (id, reference, hypothesis) => ({ id, trial: 0, status: 'completed', reference, hypothesis });

test('a clip says a term in its words, possessive included', () => {
  assert.ok(says("THE POETRY OF SHAKESPEARE'S DAY", 'Shakespeare'));
  assert.ok(says('A POEM BY ERNEST DOWSON', 'Ernest Dowson'));
  assert.ok(!says('SHAKESPEAREAN ACTORS', 'Shakespeare'));
  assert.ok(!says('ERNEST AND DOWSON', 'Ernest Dowson'));
});

test('a term is written as listed only with its capitals and on its own', () => {
  assert.ok(writesAsListed("In Shakespeare's day.", 'Shakespeare'));
  assert.ok(!writesAsListed('in shakespeare day', 'Shakespeare'));
  assert.ok(!writesAsListed('Shakespeareans', 'Shakespeare'));
  assert.ok(writesAsListed('pens, ink, et cetera.', 'et cetera'));
});

test('a listed term counts only when every clip that says it writes it as listed', () => {
  const trials = [trial('a', 'SHAKESPEARE WROTE', 'Shakespeare wrote.'), trial('b', 'SHAKESPEARE AGAIN', 'shakespeare again'),
    trial('c', 'PENS ET CETERA', 'Pens, et cetera.'), trial('d', 'ERNEST DOWSON', 'Ernest Dawson.')];
  const result = myWords(trials, fixture);
  assert.equal(result.listedSaid, 3);
  assert.equal(result.listedWrittenAsListed, 1);
  assert.deepEqual(result.notWrittenAsListed, ['Shakespeare', 'Ernest Dowson']);
});

test('a listed or distracting term in a clip that never says it is invented', () => {
  const result = myWords([trial('a', 'RUN THE CLUSTER', 'Run the Kubernetes cluster.'), trial('b', 'A PLAY', 'A Shakespeare play.')], fixture);
  assert.deepEqual(result.invented, [{ term: 'Shakespeare', id: 'b' }, { term: 'Kubernetes', id: 'a' }]);
});

test("a word that comes back with other capitals is counted, except a listed term's", () => {
  assert.equal(capitalChanges('Go do you Hear?', 'Go do you hear?', fixture.listed), 1);
  assert.equal(capitalChanges('In Shakespeare day', 'in shakespeare day', fixture.listed), 1);
  assert.equal(capitalChanges('Pens et cetera, more', 'Pens etcetera, more', fixture.listed), 0);
  const plain = [trial('a', 'GO', 'go now'), trial('b', 'HEAR', 'hear')];
  assert.equal(myWords([trial('a', 'GO', 'Go now'), trial('b', 'HEAR', 'hear')], fixture, plain).capitalChanges, 1);
});

test('identical counts clips whose final words match', () => {
  assert.deepEqual(identical([trial('a', 'X', 'one'), trial('b', 'Y', 'two')], [trial('a', 'X', 'one'), trial('b', 'Y', 'too')]), { same: 1, of: 2 });
});

const BAR = { invented: 0, capitalChanges: 0, addedErrors: 0 };
const GOOD = { none: 'shakespeare wrote', empty: 'shakespeare wrote', listed: 'Shakespeare wrote.', distractors: 'shakespeare wrote',
  'listed-unused-taught': 'Shakespeare wrote.', 'listed-used-taught': 'Shakespeare wrote.' };

// An evidence folder as check-speech.sh leaves it, from each condition's final words.
function evidence(targets, { skip = [] } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'voco-speech-check-'));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), JSON.stringify(value));
  };
  const distribution = median => ({ n: 1, median, p95: median, max: median });
  write('words/benchmark.json', { ...fixture, bar: BAR });
  write('baseline.json', { passed: true, aggregateWer: 0.025, maxAggregateWer: 0.08 });
  for (const [label, extra, said] of targets) {
    write(`${label}/target.json`, { label, commit: 'abcdef0123456789', ...extra });
    for (const condition of CONDITIONS) {
      const name = condition === 'none' ? 'unpaced' : `words-${condition}`;
      for (const run of condition === 'none' ? [name, 'paced'] : [name]) {
        if (skip.includes(run)) continue;
        const hypothesis = said[condition];
        const errors = hypothesis.toLowerCase().includes('wrote') ? 0 : 1;
        write(`${label}/${run}/run.json`, { runtimeHashes: { 'stream_worker.py': '0' }, trials: [trial('a', 'SHAKESPEARE WROTE', hypothesis)] });
        write(`${label}/${run}/score.json`, { coldReadyMs: 1170, summary: { wer: errors / 2, errors, referenceWords: 2, attempted: 1,
          completed: 1, failed: 0, serviceRtf: distribution(0.22), firstHypothesisMs: distribution(1234),
          finishAckMs: distribution(64), startAckMs: distribution(0.1), maxSampledWorkerRssBytes: 1 } });
      }
    }
  }
  return folder;
}

test('the summary sets two speech workers side by side and judges this one', () => {
  const older = { ...GOOD, 'listed-used-taught': 'shakespeare wrote' };
  const summary = summarize(evidence([['this', {}, GOOD], ['against', { ref: 'voco.2026.0.62' }, older]]));
  assert.deepEqual(summary.targets.map(t => t.label), ['this', 'against']);
  assert.equal(summary.targets[0].myWords['listed-used-taught'].listedWrittenAsListed, 1);
  assert.equal(summary.targets[1].myWords['listed-used-taught'].listedWrittenAsListed, 0);
  assert.deepEqual(summary.targets[0].myWords.empty.sameAs, { condition: 'none', same: 1, of: 1 });
  assert.deepEqual(summary.myWordsGates, { passed: true, bar: BAR, failures: [] });
  const text = markdown(summary);
  assert.match(text, /\| Word error rate, 12 clips \| 0\.00% \(0\/2\) \| 0\.00% \(0\/2\) \|/u);
  assert.match(text, /voco\.2026\.0\.62 \(abcdef0\)/u);
  assert.match(text, /My words gates for this checkout, .*: passed\./u);
});

test('each My words gate fails on its own regression', () => {
  const cases = {
    'Empty list: changed the words of 1 clips': { empty: 'Shakespeare wrote.' },
    'Listed terms gained nothing': { listed: 'shakespeare wrote', 'listed-unused-taught': 'shakespeare wrote' },
    'Terms no clip says: 1 invented terms': { distractors: 'Kubernetes wrote' },
    'Terms no clip says: 1 more wrong words than no list': { distractors: 'shakespeare rote' },
    'Listed, taught versions it never hears: changed the words of 1 clips': { 'listed-unused-taught': 'Shakespeare wrote' },
    'Empty list: 1 changed capitals': { empty: 'Shakespeare Wrote' },
  };
  for (const [expected, change] of Object.entries(cases)) {
    const { myWordsGates } = summarize(evidence([['this', {}, { ...GOOD, ...change }]]));
    assert.equal(myWordsGates.passed, false, expected);
    assert.ok(myWordsGates.failures.some(failure => failure.startsWith(expected)), `${expected}: ${myWordsGates.failures}`);
  }
});

test('a run that crashed is unavailable, never passed, and the summary still lists the rest', () => {
  const summary = summarize(evidence([['this', {}, GOOD]], { skip: ['words-listed'] }));
  assert.deepEqual(summary.targets[0].myWords.listed, { unavailable: true });
  assert.equal(summary.myWordsGates.passed, false);
  assert.deepEqual(summary.myWordsGates.failures, ['Listed terms: unavailable']);
  const text = markdown(summary);
  assert.match(text, /\| Listed terms \| unavailable \|/u);
  assert.match(text, /\| No list \| 0\.00% \/ 0 of 1 \/ 0 \/ 0 \|/u);
});
