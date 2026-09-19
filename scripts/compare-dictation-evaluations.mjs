#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scoreRun, distribution } from './score-dictation-worker.mjs';

// Inputs are explicit retained worker runs. No speech collection or remote calls.
const args = process.argv.slice(2), baseline=[], candidate=[];
let output;
for (let i=0;i<args.length;i+=2) {
  if (args[i]==='--baseline') baseline.push(args[i+1]);
  else if (args[i]==='--candidate') candidate.push(args[i+1]);
  else if (args[i]==='--output') output=args[i+1];
  else throw Error('Expected --baseline run.json --candidate run.json --output new-report.json');
}
assert.ok(baseline.length && baseline.length===candidate.length && output);
const read=paths=>paths.map(path=>({path,run:JSON.parse(fs.readFileSync(path,'utf8')),
  sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));
const a=read(baseline),b=read(candidate);
const reference=a[0].run;
for (const group of [a,b]) {
  for (const {run} of group) assert.deepEqual(run.config,group[0].run.config,'Mixed settings within one arm');
}
for (const {run} of [...a,...b]) {
  assert.equal(run.config.paced,true,'Latency comparisons require paced replay');
  assert.deepEqual(run.runtimeHashes,reference.runtimeHashes,'Runtime/model mismatch');
  assert.deepEqual(run.fixtures,reference.fixtures,'Corpus/order metadata mismatch');
  assert.equal(run.boundary,reference.boundary);
  assert.equal(run.sourceCommit,reference.sourceCommit);
  assert.deepEqual(run.host,reference.host,'Host identity mismatch');
  assert.equal(run.harnessSha256,reference.harnessSha256,'Harness mismatch');
  assert.equal(run.trials.length,reference.trials.length,'Incomplete comparison');
  const keys = run.trials.map(x=>`${x.id}:${x.trial}`).sort();
  assert.equal(new Set(keys).size, keys.length, 'Duplicate trial identity');
  assert.deepEqual(keys,reference.trials.map(x=>`${x.id}:${x.trial}`).sort(),'Unpaired trials');
}
function summarize(inputs) {
  const scored=inputs.map(({run})=>scoreRun(run));
  const cases=scored.flatMap(x=>x.cases);
  assert.ok(cases.every(x=>x.status==='completed'),'Failed trials reject comparison');
  const quality=rows=>{
    const words=rows.reduce((n,x)=>n+x.quality.normalizedLexical.referenceWords,0);
    const errors=rows.reduce((n,x)=>n+x.quality.normalizedLexical.edits,0);
    return {trials:rows.length,words,errors,wer:words?errors/words:null};
  };
  return {config:inputs[0].run.config,quality:quality(cases),
    splits:Object.fromEntries(['development','held-out'].map(split=>[split,quality(cases.filter(x=>x.split===split))])),
    coldReadyMs:distribution(scored.map(x=>x.coldReadyMs)),
    startAckMs:distribution(cases.map(x=>x.startAckMs)),
    finishAckMs:distribution(cases.map(x=>x.finishAckMs)),
    firstHypothesisMs:distribution(cases.map(x=>x.firstHypothesisMs)),
    serviceRtf:distribution(cases.map(x=>x.serviceRtf)),
    perSessionMedianUpdateGapMs:distribution(cases.map(x=>x.updateGapMs.median)),
    maxObservedUpdateGapMs:Math.max(...cases.map(x=>x.updateGapMs.max ?? 0)),
    perSessionMedianNewWords:distribution(cases.map(x=>x.newWordsPerUpdate.median)),
    revisions:cases.reduce((n,x)=>n+x.revisions,0),
    maxSampledWorkerRssBytes:Math.max(...cases.map(x=>x.sampledWorkerRssBytes)),
    inputs:inputs.map(({path,sha256})=>({path,sha256}))};
}
const before=summarize(a),after=summarize(b);
const result={schemaVersion:1,baseline:before,candidate:after,
  pairedTrialCount:before.quality.trials,independentSpeakers:reference.fixtures.length,
  boundary:reference.boundary,sourceCommit:reference.sourceCommit,
  modelSha256:reference.runtimeHashes['models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'],
  firstHypothesisMedianChangePercent:100*(after.firstHypothesisMs.median/before.firstHypothesisMs.median-1),
  accuracyRegressedSplits:Object.keys(before.splits).filter(k=>after.splits[k].wer>before.splits[k].wer),
  tailQualified:false,productionChangePromoted:false,
  limitation:'Small worker-only experiment. No recipient, physical microphone, punctuation gold, word-end alignment or world ranking.'};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result,null,2));
