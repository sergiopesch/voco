#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { compareText } from './dictation-quality.mjs';
import { words } from './speech-score.mjs';

export function distribution(values) {
  const a = values.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x-y);
  const q = p => a.length ? a[Math.ceil(p*a.length)-1] : null;
  return { n:a.length, median:q(.5), p95:q(.95), max:a.at(-1) ?? null,
    tailQualified:false, note:'Descriptive nearest-rank; repeated fixtures are not independent speakers.' };
}

export function scoreRun(run) {
  assert.equal(run.schemaVersion, 1);
  assert.ok(Array.isArray(run.trials) && run.trials.length);
  const rows = run.trials.map(row => {
    if (row.status !== 'completed') return {id:row.id, trial:row.trial, status:row.status};
    assert.ok(row.durationMs > 0 && row.elapsedMs >= 0);
    assert.equal(typeof row.reference, 'string');
    assert.equal(typeof row.hypothesis, 'string');
    assert.ok(Array.isArray(row.updates) && row.updates.length);
    const quality = compareText(row.reference, row.hypothesis,
      row.referenceFormattingAudited ? {punctuation:true, capitalization:true} : {});
    let previous = '', previousAt = null, revisions = 0;
    const gaps = [], batchWords = [];
    const updates = row.updates.filter(x => x.text.trim());
    for (const update of updates) {
      assert.ok(Number.isFinite(update.atMs) && update.atMs >= 0);
      if (update.text === previous) continue;
      if (previousAt !== null) {
        assert.ok(update.atMs >= previousAt);
        gaps.push(update.atMs-previousAt);
      }
      if (previous && !update.text.startsWith(previous)) revisions++;
      batchWords.push(Math.max(0, words(update.text).length-words(previous).length));
      previous = update.text; previousAt = update.atMs;
    }
    assert.equal(row.updates.at(-1).text, row.hypothesis);
    const punctuation = updates.find(x => /[.,!?;:]/u.test(x.text));
    return { id:row.id, trial:row.trial, split:row.split, status:row.status, quality,
      startAckMs:row.startAckMs, finishAckMs:row.finishAckMs,
      serviceRtf:row.requestServiceMs/row.durationMs,
      firstHypothesisMs:run.config.paced ? updates[0]?.atMs ?? null : null,
      firstHypothesisAudioEndMs:updates[0]?.audioEndMs ?? null,
      firstPunctuationMs:run.config.paced ? punctuation?.atMs ?? null : null,
      firstWordEndLagMs:null, destinationFirstWordMs:null, punctuationBoundaryLagMs:null,
      updateGapMs:run.config.paced ? distribution(gaps) : distribution([]),
      newWordsPerUpdate:distribution(batchWords), revisions,
      ingressQueueAgeMs:distribution(row.ingressQueueAgeMs),
      sampledWorkerRssBytes:row.sampledWorkerRssBytes };
  });
  const completed = rows.filter(x => x.status === 'completed');
  const sum = key => completed.reduce((n,x) => n+x.quality.normalizedLexical[key],0);
  const errors = sum('edits'), referenceWords = sum('referenceWords');
  return {schemaVersion:1, config:run.config, sourceCommit:run.sourceCommit,
    harnessSha256:run.harnessSha256, runtimeHashes:run.runtimeHashes,
    boundary:run.boundary, coldReadyMs:run.coldReadyMs,
    summary:{attempted:rows.length, completed:completed.length, failed:rows.length-completed.length,
      referenceWords, errors, wer:referenceWords ? errors/referenceWords : null,
      substitutions:sum('substitutions'), deletions:sum('deletions'), insertions:sum('insertions'),
      exactLexicalCases:completed.filter(x=>x.quality.normalizedLexical.edits===0).length,
      startAckMs:distribution(completed.map(x=>x.startAckMs)),
      finishAckMs:distribution(completed.map(x=>x.finishAckMs)),
      firstHypothesisMs:distribution(completed.map(x=>x.firstHypothesisMs)),
      serviceRtf:distribution(completed.map(x=>x.serviceRtf)),
      maxSampledWorkerRssBytes:completed.length ? Math.max(...completed.map(x=>x.sampledWorkerRssBytes)) : null},
    unavailable:{shortcutStart:'No capture or shortcut exercised',
      destinationLatency:'No recipient or renderer exercised',
      wordEndLag:'No audited word-end alignment', punctuationAccuracy:'Corpus has no audited punctuation',
      punctuationLag:'No audited sentence/clause boundary timestamps',
      worldwideRank:'No representative corpus or matched competitor trials'}, cases:rows};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node scripts/score-dictation-worker.mjs run.json new-score.json');
  const report = scoreRun(JSON.parse(fs.readFileSync(input,'utf8')));
  fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n', {flag:'wx', mode:0o600});
  console.log(JSON.stringify(report.summary,null,2));
}
