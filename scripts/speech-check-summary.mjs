#!/usr/bin/env node
// Sums up a scripts/check-speech.sh evidence folder: the accuracy gate, word
// error rate and latency, and My words in six conditions, for this checkout and,
// when the run measured one, another commit's speech worker beside it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { words } from './speech-score.mjs';

export const CONDITIONS = ['none', 'empty', 'listed', 'distractors', 'listed-unused-taught', 'listed-used-taught'];
const NAMES = { none: 'No list', empty: 'Empty list', listed: 'Listed terms', distractors: 'Terms no clip says',
  'listed-unused-taught': 'Listed, taught versions it never hears', 'listed-used-taught': 'Listed, taught versions it hears' };
// When a list should change nothing, the run whose words it must repeat.
export const SAME_AS = { empty: 'none', distractors: 'none', 'listed-unused-taught': 'listed' };
const LETTER_OR_DIGIT = String.raw`[\p{L}\p{N}]`;

// Whether TEXT says TERM: its words in a row, the last perhaps possessive, as My words matches it.
export function says(text, term) {
  const have = words(text), want = words(term);
  for (let at = 0; at + want.length <= have.length; at += 1) {
    const span = have.slice(at, at + want.length);
    if (span.slice(0, -1).every((word, index) => word === want[index])
        && (span.at(-1) === want.at(-1) || span.at(-1) === `${want.at(-1)}'s`)) return true;
  }
  return false;
}

// Whether TEXT writes TERM exactly as listed: the same letters and capitals, not inside a longer word.
export function writesAsListed(text, term) {
  const escaped = term.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${LETTER_OR_DIGIT})${escaped}(?!${LETTER_OR_DIGIT})`, 'u').test(text.normalize('NFC'));
}

// Words of PLAIN that come back in TEXT with other capitals, leaving out the listed terms' words.
export function capitalChanges(text, plain, listed) {
  const tokens = value => value.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const lower = word => word.toLocaleLowerCase('en-US');
  const exempt = new Set(listed.flatMap(term => words(term)));
  const a = tokens(plain), b = tokens(text);
  // Pair the words through their longest common lowercase subsequence.
  const longest = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      longest[i][j] = lower(a[i]) === lower(b[j]) ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1]);
    }
  }
  let changes = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (lower(a[i]) === lower(b[j])) {
      if (a[i] !== b[j] && !exempt.has(words(a[i])[0]?.replace(/'s$/u, ''))) changes += 1;
      i += 1; j += 1;
    } else if (longest[i + 1][j] >= longest[i][j + 1]) i += 1;
    else j += 1;
  }
  return changes;
}

const key = trial => `${trial.id}:${trial.trial}`;

// My words in one condition's trials, judged against their references and the unlisted run.
export function myWords(trials, fixture, plainTrials = []) {
  const done = trials.filter(trial => trial.status === 'completed');
  const said = fixture.listed.filter(term => done.some(trial => says(trial.reference, term)));
  const written = said.filter(term => done.filter(trial => says(trial.reference, term))
    .every(trial => writesAsListed(trial.hypothesis, term)));
  const invented = [];
  for (const term of [...fixture.listed, ...fixture.distractors]) {
    for (const trial of done) {
      if (says(trial.hypothesis, term) && !says(trial.reference, term)) invented.push({ term, id: trial.id });
    }
  }
  const plain = new Map(plainTrials.map(trial => [key(trial), trial.hypothesis]));
  const capitals = done.reduce((count, trial) => count
    + (plain.has(key(trial)) ? capitalChanges(trial.hypothesis, plain.get(key(trial)), fixture.listed) : 0), 0);
  return { listedSaid: said.length, listedWrittenAsListed: written.length,
    notWrittenAsListed: said.filter(term => !written.includes(term)), invented, capitalChanges: capitals };
}

// How many of A's trials end with the same words as the same clip's trial in B.
export function identical(a, b) {
  const other = new Map(b.map(trial => [key(trial), trial.hypothesis]));
  return { same: a.filter(trial => other.get(key(trial)) === trial.hypothesis).length, of: a.length };
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const accuracy = ({ summary }) => ({ wer: summary.wer, errors: summary.errors, referenceWords: summary.referenceWords,
  completed: summary.completed, failed: summary.failed });
const median = distribution => distribution?.median ?? null;

export function summarizeTarget(folder, fixture) {
  const run = name => ({ run: read(path.join(folder, name, 'run.json')), score: read(path.join(folder, name, 'score.json')) });
  const runs = { none: run('unpaced') };
  for (const condition of CONDITIONS.slice(1)) runs[condition] = run(`words-${condition}`);
  const paced = run('paced');
  const plain = runs.none.run.trials;
  const conditions = {};
  for (const condition of CONDITIONS) {
    const { run: { trials }, score } = runs[condition];
    conditions[condition] = { ...accuracy(score), ...myWords(trials, fixture, condition === 'none' ? [] : plain) };
    if (SAME_AS[condition]) conditions[condition].sameAs = { condition: SAME_AS[condition], ...identical(trials, runs[SAME_AS[condition]].run.trials) };
  }
  const s = runs.none.score.summary, p = paced.score.summary;
  return { ...read(path.join(folder, 'target.json')),
    runtimeHashes: runs.none.run.runtimeHashes,
    accuracy: { unpaced: accuracy(runs.none.score), paced: accuracy(paced.score) },
    latency: { workerTimePerAudioTime: median(s.serviceRtf), workerTimePerAudioTimeInRealTime: median(p.serviceRtf),
      firstWordsInRealTimeMs: median(p.firstHypothesisMs), stopToFinalTextMs: median(p.finishAckMs),
      startAckMs: median(s.startAckMs), coldReadyMs: runs.none.score.coldReadyMs ?? null,
      maxSampledWorkerRssBytes: s.maxSampledWorkerRssBytes },
    myWords: conditions };
}

export function summarize(folder) {
  const fixture = read(path.join(folder, 'words', 'benchmark.json'));
  const baseline = read(path.join(folder, 'baseline.json'));
  const targets = ['this', 'against'].filter(label => fs.existsSync(path.join(folder, label, 'target.json')))
    .map(label => summarizeTarget(path.join(folder, label), fixture));
  return { schemaVersion: 1, baseline: { passed: baseline.passed, aggregateWer: baseline.aggregateWer ?? null,
    maxAggregateWer: baseline.maxAggregateWer ?? null, error: baseline.error ?? null }, targets };
}

const percent = value => (value === null || value === undefined ? 'unavailable' : `${(value * 100).toFixed(2)}%`);
const ms = value => (value === null || value === undefined ? 'unavailable' : `${Math.round(value)} ms`);
const ratio = value => (value === null || value === undefined ? 'unavailable' : value.toFixed(3));

export function markdown(summary) {
  const { targets, baseline } = summary;
  const head = targets.map(t => `${t.ref ?? 'this checkout'} (${t.commit.slice(0, 7)})`);
  const row = (label, cells) => `| ${label} | ${cells.join(' | ')} |`;
  const lines = ['# Speech check', '', row('', head), row('---', head.map(() => '---')),
    row('Accuracy gate, 8 clips', [baseline.passed ? `passed, ${percent(baseline.aggregateWer)}` : `failed${baseline.error ? `: ${baseline.error}` : ''}`,
      ...targets.slice(1).map(() => 'not run')]),
    row('Word error rate, 12 clips', targets.map(t => `${percent(t.accuracy.unpaced.wer)} (${t.accuracy.unpaced.errors}/${t.accuracy.unpaced.referenceWords})`)),
    row('Same, fed in real time', targets.map(t => percent(t.accuracy.paced.wer))),
    row('Worker time per audio time, median', targets.map(t => ratio(t.latency.workerTimePerAudioTime))),
    row('First words in real time, median', targets.map(t => ms(t.latency.firstWordsInRealTimeMs))),
    row('Stop to final text, median', targets.map(t => ms(t.latency.stopToFinalTextMs))),
    row('Worker ready from cold', targets.map(t => ms(t.latency.coldReadyMs))),
    '', '## My words', '', 'Word error rate / listed terms written as listed / terms written where no clip says them / other words with changed capitals.', '',
    row('Condition', head), row('---', head.map(() => '---'))];
  for (const condition of CONDITIONS) {
    lines.push(row(NAMES[condition], targets.map(t => {
      const c = t.myWords[condition];
      const same = c.sameAs ? `; same words as ${NAMES[c.sameAs.condition].toLowerCase()} for ${c.sameAs.same} of ${c.sameAs.of} clips` : '';
      return `${percent(c.wer)} / ${c.listedWrittenAsListed} of ${c.listedSaid} / ${c.invented.length} / ${c.capitalChanges}${same}`;
    })));
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [folder] = process.argv.slice(2);
  if (!folder) throw Error('Usage: node scripts/speech-check-summary.mjs EVIDENCE-FOLDER');
  const summary = summarize(folder);
  fs.writeFileSync(path.join(folder, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const text = markdown(summary);
  fs.writeFileSync(path.join(folder, 'summary.md'), text, { flag: 'wx', mode: 0o600 });
  process.stdout.write(text);
}
