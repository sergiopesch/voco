import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {freezeLongPlayback, scoreLongDelivery} from './browser-long-accuracy.mjs';
const manifestBytes = fs.readFileSync(new URL('../tests/fixtures/speech/manifest.json', import.meta.url));
const manifest = JSON.parse(manifestBytes);
const row = manifest.fixtures[0];
const fixture = fs.readFileSync(new URL(`../tests/fixtures/speech/${row.file}`, import.meta.url));
const pcm = Buffer.concat(Array.from({length:16}, () => Buffer.concat([fixture.subarray(44), Buffer.alloc(8000)])));
const wav = Buffer.concat([fixture.subarray(0,44), pcm]);
wav.writeUInt32LE(wav.length - 8,4); wav.writeUInt32LE(pcm.length,40);
const playback = {mode:'repeated', selectedBeforeInference:true, fixtures:Array(16).fill({id:row.id,sha256:row.sha256,reference:row.reference}), durationSeconds:pcm.length/32000,wavSha256:crypto.createHash('sha256').update(wav).digest('hex')};
const freeze = (p=playback,w=wav) => freezeLongPlayback(manifestBytes,Buffer.from(JSON.stringify(p)),w,{[row.id]:fixture});
const plan = freeze();
const prefix = row.reference;
const rest = text => text.slice(prefix.length);
test('complete repeated reference retains all 64 words and fixed threshold',()=>{assert.equal(plan.maxWer,.15);const report=scoreLongDelivery(plan,prefix,rest(plan.reference));assert.equal(report.score.referenceWords,64);assert.equal(report.passed,true);});
test('shortened prospective references and changed playback PCM are rejected',()=>{assert.throws(()=>freeze({...playback,fixtures:playback.fixtures.slice(1)}));const changed=Buffer.from(wav);changed[44]^=1;assert.throws(()=>freeze(playback,changed));});
test('natural plan uses every fixture through the 37 second cutoff and manifest threshold',()=>{
  let samples=0; const selected=[]; const sources={}; const parts=[];
  for(const r of manifest.fixtures){const source=fs.readFileSync(new URL(`../tests/fixtures/speech/${r.file}`,import.meta.url));sources[r.id]=source;selected.push({id:r.id,sha256:r.sha256,reference:r.reference});parts.push(source.subarray(44),Buffer.alloc(8000));samples+=(source.length-44)/2+4000;if(samples>=37*16000)break;}
  const audio=Buffer.concat([fixture.subarray(0,44),...parts]);audio.writeUInt32LE(audio.length-8,4);audio.writeUInt32LE(audio.length-44,40);
  const p={mode:'natural',selectedBeforeInference:true,fixtures:selected,durationSeconds:samples/16000,wavSha256:crypto.createHash('sha256').update(audio).digest('hex')};
  const actual=freezeLongPlayback(manifestBytes,Buffer.from(JSON.stringify(p)),audio,sources);
  assert.equal(actual.maxWer,manifest.maxAggregateWer);assert.equal(actual.reference,selected.map(r=>r.reference).join(' '));
  assert.equal(actual.maxWer, .25);
  assert.equal(actual.integrityRequirements, null);
  const scored = scoreLongDelivery(actual, prefix, rest(actual.reference.replace(/\S+$/, 'different')));
  assert.equal(scored.score.substitutions, 1);
  assert.equal(scored.werPassed, true);
  assert.equal(scored.integrityPassed, null);
  assert.equal(scored.integrity, null);
  assert.equal(scored.passed, true);
  assert.throws(()=>freezeLongPlayback(manifestBytes,Buffer.from(JSON.stringify({...p,selectedBeforeInference:false})),audio,sources));
});

test('empty or short delivery and a missing live prefix fail', () => {
  for (const [kept, copied] of [[prefix, ''], ['', ''], ['', plan.reference], [prefix, null]]) {
    const report = scoreLongDelivery(plan, kept, copied);
    assert.equal(report.passed, false);
    assert.ok(report.failures.length > 0);
  }
  assert.ok(scoreLongDelivery(plan, prefix, '').score.wer > .15);
});
for (const count of [15, 17]) test(`delivery rejects ${count} complete phrases even when WER passes`, () => {
  const report = scoreLongDelivery(plan, prefix, rest(Array(count).fill(row.reference).join(' ')));
  assert.equal(report.werPassed, true);
  assert.equal(report.integrity.details.repetition.observedNonoverlappingExactPhrases, count);
  assert.equal(report.integrityPassed, false);
  assert.equal(report.passed, false);
});
test('valid repeated delivery passes both independent gates with the frozen 16-phrase count', () => {
  assert.deepEqual(plan.integrityRequirements, {repetition: {phrase: row.reference, count: 16}});
  const report = scoreLongDelivery(plan, prefix, rest(plan.reference));
  assert.equal(report.werPassed, true);
  assert.equal(report.integrityPassed, true);
  assert.deepEqual(report.failures, []);
});
test('repeated delivery cannot silently skip a missing frozen integrity requirement', () => {
  const report = scoreLongDelivery({...plan, integrityRequirements: null}, prefix, rest(plan.reference));
  assert.equal(report.werPassed, true);
  assert.equal(report.integrityPassed, false);
  assert.equal(report.passed, false);
});
