import test from 'node:test';
import assert from 'node:assert/strict';
import { distribution, scoreRun } from './score-dictation-worker.mjs';

function run(paced=true) {
  return {schemaVersion:1,config:{paced},trials:[{
    id:'synthetic',trial:0,status:'completed',durationMs:1000,elapsedMs:1300,
    reference:'do not delete',hypothesis:'do delete',referenceFormattingAudited:false,
    startAckMs:1,finishAckMs:10,requestServiceMs:200,
    sampledWorkerRssBytes:100,ingressQueueAgeMs:[0,3],
    updates:[{text:'do',atMs:400,audioEndMs:300,final:false},
      {text:'do delete',atMs:1000,audioEndMs:900,final:false},
      {text:'do delete',atMs:1300,audioEndMs:1000,final:true}]}]};
}

test('missing timing stays unavailable and no tiny sample qualifies a tail',()=>{
  assert.equal(distribution([null,undefined]).median,null);
  assert.equal(distribution([0,3]).median,0);
  assert.equal(distribution([1,2,3]).tailQualified,false);
});
test('word errors and unavailable punctuation survive a completed worker trial',()=>{
  const result=scoreRun(run());
  assert.equal(result.summary.wer,1/3);
  assert.equal(result.cases[0].quality.punctuation.status,'unavailable');
  assert.equal(result.cases[0].destinationFirstWordMs,null);
  assert.equal(result.cases[0].updateGapMs.n,1);
  assert.equal(result.cases[0].firstHypothesisMs,400);
});
test('unpaced throughput is never labeled user-perceived latency',()=>{
  const result=scoreRun(run(false));
  assert.equal(result.summary.firstHypothesisMs.n,0);
  assert.equal(result.cases[0].firstHypothesisAudioEndMs,300);
});
test('failed trials remain in the denominator',()=>{
  const input=run();input.trials.push({id:'failure',status:'error'});
  const result=scoreRun(input);
  assert.equal(result.summary.attempted,2);
  assert.equal(result.summary.failed,1);
});
test('inconsistent final text fails instead of silently receiving a score',()=>{
  const input=run();input.trials[0].hypothesis='different';
  assert.throws(()=>scoreRun(input));
});
