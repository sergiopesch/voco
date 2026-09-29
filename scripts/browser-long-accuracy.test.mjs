import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freezeLongPlayback} from './browser-long-accuracy.mjs';
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
test('complete repeated reference retains all 64 words and fixed threshold',()=>{assert.equal(plan.maxWer,.15);assert.equal(plan.reference.split(/\s+/).length,64);});
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
  assert.throws(()=>freezeLongPlayback(manifestBytes,Buffer.from(JSON.stringify({...p,selectedBeforeInference:false})),audio,sources));
});

test('CLI rejects retired diagnostics before checking sandbox or starting apps',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./test-browser-full-app.mjs',import.meta.url))],{env:{...process.env,VOCO_BROWSER_DIAG_SECOND_CAPTURE:'1'},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/The retired debug-capture mode is unavailable/);
});

test('repeated plan freezes the 16-phrase integrity requirement', () => {
  assert.deepEqual(plan.integrityRequirements, {repetition: {phrase: row.reference, count: 16}});
});
