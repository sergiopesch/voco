import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freezeLongPlayback, scoreLongCapture} from './browser-long-accuracy.mjs';
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
const capture = () => ({schemaVersion:2, committedCursorText:prefix, canonicalChunks:[{result:{canonicalText:prefix,appendText:prefix,chunkText:prefix}},{result:{canonicalText:plan.reference,appendText:plan.reference.slice(prefix.length),chunkText:plan.reference.slice(prefix.length)}}],finalTranscript:plan.reference});
test('complete repeated reference retains all 64 words and fixed threshold',()=>{assert.equal(plan.maxWer,.15);assert.equal(scoreLongCapture(capture(),plan,prefix,prefix).outputs.finalTranscript.score.referenceWords,64);assert.equal(scoreLongCapture(capture(),plan,prefix,prefix).passed,true);});
test('shortened prospective references and changed playback PCM are rejected',()=>{assert.throws(()=>freeze({...playback,fixtures:playback.fixtures.slice(1)}));const changed=Buffer.from(wav);changed[44]^=1;assert.throws(()=>freeze(playback,changed));});
for(const field of ['canonicalText','finalTranscript']) test(`${field} is independently scored against the entire reference`,()=>{const c=capture();if(field==='canonicalText'){c.canonicalChunks[1].result.canonicalText=prefix;c.canonicalChunks[1].result.appendText='';}else c.finalTranscript=prefix;const report=scoreLongCapture(c,plan,prefix,prefix);assert.equal(report.passed,false);assert.ok(report.outputs[field].score.wer>.15);assert.equal(report.outputs[field].text,prefix);});
test('empty output, missing chunks, broken append, and changed focus target fail',()=>{for(const mutate of [c=>c.finalTranscript='',c=>c.canonicalChunks.pop(),c=>c.canonicalChunks[1].result.appendText='wrong',c=>c.schemaVersion=1,c=>c.committedCursorText='wrong']){const c=capture();mutate(c);assert.equal(scoreLongCapture(c,plan,prefix,prefix).passed,false);}assert.equal(scoreLongCapture(capture(),plan,prefix,prefix+'changed').passed,false);});
test('natural plan uses every fixture through the 37 second cutoff and manifest threshold',()=>{
  let samples=0; const selected=[]; const sources={}; const parts=[];
  for(const r of manifest.fixtures){const source=fs.readFileSync(new URL(`../tests/fixtures/speech/${r.file}`,import.meta.url));sources[r.id]=source;selected.push({id:r.id,sha256:r.sha256,reference:r.reference});parts.push(source.subarray(44),Buffer.alloc(8000));samples+=(source.length-44)/2+4000;if(samples>=37*16000)break;}
  const audio=Buffer.concat([fixture.subarray(0,44),...parts]);audio.writeUInt32LE(audio.length-8,4);audio.writeUInt32LE(audio.length-44,40);
  const p={mode:'natural',selectedBeforeInference:true,fixtures:selected,durationSeconds:samples/16000,wavSha256:crypto.createHash('sha256').update(audio).digest('hex')};
  const actual=freezeLongPlayback(manifestBytes,Buffer.from(JSON.stringify(p)),audio,sources);
  assert.equal(actual.maxWer,manifest.maxAggregateWer);assert.equal(actual.reference,selected.map(r=>r.reference).join(' '));
  assert.equal(actual.maxWer, .25);
  assert.equal(actual.integrityRequirements, null);
  const c = capture();
  c.canonicalChunks[1].result = {canonicalText: actual.reference, appendText: actual.reference.slice(prefix.length), chunkText: actual.reference.slice(prefix.length)};
  c.finalTranscript = actual.reference.replace(/\S+$/, 'different');
  const scored = scoreLongCapture(c, actual, prefix, prefix);
  assert.equal(scored.outputs.finalTranscript.score.substitutions, 1);
  assert.equal(scored.werPassed, true);
  assert.equal(scored.integrityPassed, null);
  assert.equal(scored.outputs.finalTranscript.integrity, null);
  assert.equal(scored.passed, true);

  assert.throws(()=>freezeLongPlayback(manifestBytes,Buffer.from(JSON.stringify({...p,selectedBeforeInference:false})),audio,sources));
});

test('CLI rejects retired diagnostics before checking sandbox or starting apps',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./test-browser-full-app.mjs',import.meta.url))],{env:{...process.env,VOCO_BROWSER_DIAG_SECOND_CAPTURE:'1'},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/The retired debug-capture mode is unavailable/);
});

for (const field of ['canonicalText', 'finalTranscript']) {
  for (const count of [15, 17]) test(`${field} rejects ${count} complete phrases even when old WER passes`, () => {
    const c = capture();
    const text = Array(count).fill(row.reference).join(' ');
    if (field === 'canonicalText') {
      c.canonicalChunks[1].result = {canonicalText: text, appendText: text.slice(prefix.length), chunkText: text.slice(prefix.length)};
    } else c.finalTranscript = text;
    const report = scoreLongCapture(c, plan, prefix, prefix);
    assert.equal(report.outputs[field].werPassed, true);
    assert.equal(report.werPassed, true);
    assert.equal(report.outputs[field].integrity.details.repetition.observedNonoverlappingExactPhrases, count);
    assert.equal(report.outputs[field].integrityPassed, false);
    assert.equal(report.integrityPassed, false);
    assert.equal(report.passed, false);
  });
}
test('valid repeated output passes both independent gates with the frozen 16-phrase count', () => {
  assert.deepEqual(plan.integrityRequirements, {repetition: {phrase: row.reference, count: 16}});
  const report = scoreLongCapture(capture(), plan, prefix, prefix);
  assert.equal(report.werPassed, true);
  assert.equal(report.integrityPassed, true);
  assert.equal(report.passed, true);
});
test('repeated capture cannot silently skip a missing frozen integrity requirement', () => {
  const report = scoreLongCapture(capture(), {...plan, integrityRequirements: null}, prefix, prefix);
  assert.equal(report.werPassed, true);
  assert.equal(report.integrityPassed, false);
  assert.equal(report.passed, false);
});
