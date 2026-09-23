import {chromium} from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {freezeLongPlayback} from './browser-long-accuracy.mjs';
import {browserCaptureStopEvidence} from './browser-capture-lifecycle.mjs';
import {scoreTranscript} from './speech-score.mjs';
import {scoreSpeechIntegrity} from './speech-integrity.mjs';
const longCapture = process.env.VOCO_BROWSER_LONG_CAPTURE === '1';
assert.notEqual(process.env.VOCO_BROWSER_DIAG_SECOND_CAPTURE, '1', 'The retired debug-capture mode is unavailable; use VOCO_BROWSER_LONG_CAPTURE=1 for full-reference Nemotron delivery.');
const root = process.env.VOCO_BROWSER_TEST_ROOT;
assert.ok(root && process.env.XDG_RUNTIME_DIR === `${root}/runtime` && process.env.DISPLAY === ':0');
const hash = async p => crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
assert.equal(await hash(`${root}/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`), 'd9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d');
let longPlan;
if (longCapture) {
  const manifestBytes = await fs.readFile('tests/fixtures/speech/manifest.json');
  const fixtureManifest = JSON.parse(manifestBytes);
  const fixtureWavs = Object.fromEntries(await Promise.all(fixtureManifest.fixtures.map(async row => [row.id, await fs.readFile(path.join('tests/fixtures/speech', row.file))])));
  longPlan = freezeLongPlayback(manifestBytes, await fs.readFile(`${root}/evidence/playback-manifest.json`), await fs.readFile(`${root}/long.wav`), fixtureWavs);
  await fs.writeFile(`${root}/evidence/long-accuracy-plan.json`, JSON.stringify(longPlan, null, 2));
}
const extensionSource = process.env.VOCO_BROWSER_EXTENSION_DIR || 'integrations/chromium';
const extensionHashes = Object.fromEntries(await Promise.all(['manifest.json', 'content.js', 'background.js'].map(async file => [file, await hash(path.join(extensionSource, file))])));
const extension = `${root}/extension`; await fs.cp(extensionSource, extension, {recursive: true});
const manifest = JSON.parse(await fs.readFile(`${extension}/manifest.json`)); manifest.host_permissions = ['http://127.0.0.1/*'];
await fs.writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
const profile = `${root}/profile`; await fs.mkdir(`${profile}/NativeMessagingHosts`, {recursive: true});
await fs.writeFile(`${profile}/NativeMessagingHosts/com.voco.exact_field.json`, JSON.stringify({name:'com.voco.exact_field',description:'Isolated VOCO acceptance',type:'stdio',path:`${root}/voco-browser-host`,allowed_origins:['chrome-extension://dohnphckdenppjhdafmhefhomomodgcc/']}));
const server = http.createServer((_q,r) => r.end('<!doctype html><title>VOCO exact recipient</title><textarea id="a"></textarea><textarea id="b"></textarea>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const log = await fs.open(`${root}/evidence/app.log`, 'w');
const app = spawn(`${root}/voco`, [], {env: {...process.env, VOCO_HOTKEY_TRACE: '1'}, stdio:['ignore',log.fd,log.fd]});
const delay = ms=>new Promise(r=>setTimeout(r,ms));
const traces = async()=> (await fs.readFile(`${root}/state/voco/hotkey-trace.jsonl`,'utf8').catch(()=>'' )).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
async function until(fn, label, ms=30_000) {const deadline=Date.now()+ms;while(Date.now()<deadline){if(await fn())return;if(playbacks.some(p=>p.record.error || p.record.timedOut || (p.record.exitCode !== undefined && p.record.exitCode !== 0)))throw Error('Fixture playback failed; see playback.json');if(app.exitCode!==null)throw Error(`App exited: ${label}`);await delay(50);}throw Error(`Timed out: ${label}`);}
let browser, page, worker, failure; const results=[], playbacks=[];
async function disconnectStagedNativeHost() {
  // Closing the extension-side Port does not fire its own onDisconnect event.
  // Terminate the remote native host to exercise the real reconnect boundary.
  const executable = `${root}/voco-browser-host`;
  const candidates = (await Promise.all((await fs.readdir('/proc'))
    .filter(entry => /^\d+$/.test(entry))
    .map(async entry => (await fs.readlink(`/proc/${entry}/exe`).catch(() => null)) === executable
      ? Number(entry) : null))).filter(pid => pid !== null);
  assert.equal(candidates.length, 1, 'exactly one staged native host in the private PID namespace');
  process.kill(candidates[0], 'SIGTERM');
  await until(() => worker.evaluate(() => native === null && ready === false),
    'native host loss reaches the production disconnect handler');
}
async function playFixture(file) {
  const record = {file:path.basename(file), sha256:await hash(file), startedAt:new Date().toISOString(), startedMonotonicMs:performance.now(), stderr:''};
  const child = spawn(process.env.VOCO_BROWSER_PLAY,['--device=fixture',file],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>{record.stderr=(record.stderr+chunk.toString()).slice(0,4096);});
  const done = new Promise((resolve,reject)=>{
    const timeout = setTimeout(()=>{record.timedOut=true;child.kill('SIGKILL');},60_000);
    timeout.unref();
    child.on('error',error=>{clearTimeout(timeout);record.error=error.message;reject(error);});
    child.on('exit',(code,signal)=>{clearTimeout(timeout);record.exitCode=code;record.signal=signal;record.finishedAt=new Date().toISOString();record.elapsedMs=performance.now()-record.startedMonotonicMs;resolve(record.timedOut?'timeout':code);});
  });
  void done.catch(()=>{}); // Failure is reported by the active gate and saved as metadata.
  playbacks.push({record,done,child});
  return {done,child,record};
}
try {
  await until(()=>fs.stat(`${root}/runtime/voco-browser/exact-field.sock`).then(()=>true).catch(()=>false),'broker socket');
  await delay(6000);
  browser = await chromium.launchPersistentContext(profile, {executablePath:'/tmp/browser/chrome',headless:false,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  await worker.evaluate(() => { globalThis.nativeRequestMetadata = []; });
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url?.startsWith('http://127.0.0.1')).id);
  async function shortCase(reject, retry = false) {
    await page.reload(); await page.bringToFront();
    await worker.evaluate(async tabId=>enableTab(await chrome.tabs.get(tabId)),tabId);
    assert.equal(await worker.evaluate(()=>ready),true);
    await worker.evaluate(() => { if (!globalThis.observedNativePorts) globalThis.observedNativePorts = new WeakSet(); if (!globalThis.observedNativePorts.has(native)) { globalThis.observedNativePorts.add(native); native.onMessage.addListener(m => { if (['claim', 'append', 'cancel'].includes(m.type)) globalThis.nativeRequestMetadata.push({type: m.type, sequence: m.sequence, expectedCommittedCharacters: m.expectedCommittedCharacters, textCharacters: typeof m.text === 'string' ? Array.from(m.text).length : null, final: m.final}); }); } });
    await page.locator('#a').focus();
    const traceStart=(await traces()).length;
    await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='recording_state_active'),'real microphone recording');
    await delay(500);
    const player=await playFixture('tests/fixtures/speech/84-121123-0000.wav');
    assert.equal(await player.done,0);
    let prefix;
    if(reject){
      await until(async()=> (await page.locator('#a').inputValue()).length > 0,'live browser prefix');
      await page.locator('#b').focus();
      prefix = await page.locator('#a').inputValue();
      await page.locator('#a').focus();
    }
    await delay(600);await page.keyboard.press('Alt+Shift+v');
    if(reject) await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_recovery_retained'),'focus-loss transcript recovery',45_000);
    else await until(async()=> (await page.locator('#a').inputValue()).toLowerCase().match(/[a-z]+/g)?.join(' ')==='go do you hear','real transcript exact-field delivery',45_000);
    if(!reject) await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_stop_to_idle'),'dictation returns idle');
    assert.equal(await page.locator('#b').inputValue(),'');
    if(reject)assert.equal(await page.locator('#a').inputValue(),prefix,'Focus loss preserves already delivered text without replay');
    await page.screenshot({path:`${root}/evidence/${retry?'after-recovery':reject?'focus-loss':'delivery'}.png`});
    results.push({case:retry?'fresh-recording-after-clearing-recovery':reject?'focus-loss':'delivery',passed:true,events:(await traces()).slice(traceStart).map(t=>t.event)});
  }
  await shortCase(false);
  if (longCapture) {
    await page.reload(); await page.bringToFront();
    await worker.evaluate(async tabId=>enableTab(await chrome.tabs.get(tabId)),tabId);
    await page.locator('#a').focus();
    const traceStart=(await traces()).length;
    await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='recording_state_active'),'long real microphone recording');
    const player=await playFixture(`${root}/long.wav`);
    await until(async()=> (await page.locator('#a').inputValue()).length > 0,'long live browser prefix',30_000);
    assert.equal(player.record?.exitCode, undefined);
    assert.equal(await player.done,0);
    await delay(600); await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_stop_to_idle'),'long stream returns idle',45_000);
    const text=await page.locator('#a').inputValue();
    const score=scoreTranscript(longPlan.reference,text);
    const integrity=longPlan.integrityRequirements ? scoreSpeechIntegrity(longPlan.reference,text,longPlan.integrityRequirements) : null;
    const passed=score.hypothesisWords>0 && score.wer<=longPlan.maxWer && (!integrity || integrity.integrityPassed);
    await fs.writeFile(`${root}/evidence/long-accuracy.json`,JSON.stringify({plan:longPlan,text,score,integrity,passed},null,2));
    assert.ok(passed,'Complete browser transcript must satisfy the frozen full-reference WER and repetition checks');
    assert.equal(await page.locator('#b').inputValue(),'');
    results.push({case:'full-reference-long-stream',passed,score,events:(await traces()).slice(traceStart).map(t=>t.event)});
    await page.screenshot({path:`${root}/evidence/long-delivery.png`});
  }
  await shortCase(true);

  const clear = spawn('/usr/bin/python3', ['scripts/test-browser-clear-recovery.py'], {stdio: ['ignore', log.fd, log.fd]});
  assert.equal(await new Promise(resolve => clear.on('exit', resolve)), 0, 'actual recovery clear button');
  await shortCase(false, true);

  // Exercise terminal browser lifetime with real capture and native receipts.
  // Unit tests cannot prove that the packaged renderer actually stops its mic.
  for (const departure of ['navigation', 'tab-close', 'native-disconnect']) {
    const recipient = await browser.newPage();
    const url = `http://127.0.0.1:${server.address().port}/?lifetime=${departure}`;
    await recipient.goto(url); await recipient.bringToFront();
    const recipientId = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async id => enableTab(await chrome.tabs.get(id)), recipientId);
    await recipient.locator('#a').focus();
    const sourceOutputs = () => JSON.parse(execFileSync(process.env.VOCO_BROWSER_PACTL || 'pactl',
      ['--format=json', 'list', 'source-outputs'], {encoding: 'utf8'}));
    const activeSources = () => sourceOutputs().filter(output => output.corked === false).map(output => output.index);
    const baselineSources = activeSources();
    const traceStart = (await traces()).length;
    await recipient.keyboard.press('Alt+Shift+v');
    await until(async () => (await traces()).slice(traceStart).some(row =>
      row.event === 'recording_state_active'), `${departure}: recording starts`);
    const recording = (await traces()).slice(traceStart).find(row => row.event === 'recording_state_active');
    assert.ok(Number.isSafeInteger(recording.dictation_session_id));
    let recordingSources;
    await until(() => {
      recordingSources = activeSources().filter(index => !baselineSources.includes(index));
      return recordingSources.length > 0;
    }, `${departure}: private Pulse observes active capture`);
    const playback = await playFixture('tests/fixtures/speech/84-121123-0000.wav');
    await until(async () => (await recipient.locator('#a').inputValue()).length > 0,
      `${departure}: live prefix arrives`);
    if (departure === 'navigation') await recipient.goto(url + '&departed=1');
    else if (departure === 'tab-close') await recipient.close();
    else await disconnectStagedNativeHost();
    let captureStop;
    await until(async () => {
      captureStop = browserCaptureStopEvidence((await traces()).slice(traceStart), recording.dictation_session_id);
      return captureStop !== null;
    }, `${departure}: capture tears down and recording reaches recovery or idle`, 15_000);
    let afterSources;
    await until(() => {
      afterSources = activeSources();
      return recordingSources.every(index => !afterSources.includes(index)) &&
        afterSources.every(index => baselineSources.includes(index));
    }, `${departure}: private Pulse confirms capture release`, 5_000);
    assert.equal(await playback.done, 0);
    if (departure === 'navigation') assert.equal(await recipient.locator('#a').inputValue(), '');
    if (!recipient.isClosed()) assert.equal(await recipient.locator('#b').inputValue(), '');
    const stopped = (await traces()).slice(traceStart);
    assert.equal(stopped.filter(row => row.event === 'recording_state_active').length, 1);
    if (captureStop.terminal === 'dictation_recovery_retained') {
      const clear = spawn('/usr/bin/python3', ['scripts/test-browser-clear-recovery.py'],
        {stdio: ['ignore', log.fd, log.fd]});
      assert.equal(await new Promise(resolve => clear.on('exit', resolve)), 0);
    }
    if (!recipient.isClosed()) await recipient.close();
    results.push({case: `${departure}-stops-active-capture`, passed: true, captureStop,
      pulseCapture: {baselineSources, recordingSources, activeAfterStop: afterSources},
      events: stopped.map(row => row.event)});
    // A fresh successful recording proves the pending Stop receipt was retired.
    await shortCase(false, true);
  }

} catch (error) {
  failure = error.message;
  await Promise.allSettled(playbacks.map(p=>p.done));
  throw error;
} finally {
  await fs.writeFile(`${root}/evidence/playback.json`, JSON.stringify(playbacks.map(p=>p.record),null,2));
  if (longCapture) await fs.copyFile(`${root}/long.wav`,`${root}/evidence/playback-long.wav`).catch(()=>{});
  await fs.writeFile(`${root}/evidence/result.json`,JSON.stringify({appSha256:await hash(`${root}/voco`),hostSha256:await hash(`${root}/voco-browser-host`),modelSha256:await hash(`${root}/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`),extensionHashes, recognizer: 'Nemotron 0.6B Q8', outputMode: 'stable-cursor-streaming', tests:results, failure, harnessOnlyHostGrant:'http://127.0.0.1/*'},null,2));
  if (worker) await fs.writeFile(`${root}/evidence/native-request-metadata.json`, JSON.stringify(await worker.evaluate(()=>globalThis.nativeRequestMetadata).catch(()=>[]), null, 2));
  await fs.copyFile(`${root}/state/voco/hotkey-trace.jsonl`,`${root}/evidence/hotkey-trace.jsonl`).catch(()=>{});
  if (browser) await browser.pages().at(-1)?.screenshot({path:`${root}/evidence/final-browser.png`}).catch(()=>{});
  // Exact process-lifetime CPU counters complement the recorder's two-second samples.
  try {
    const raw = await fs.readFile(`/proc/${app.pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    await fs.writeFile(`${root}/evidence/process-cpu.json`, JSON.stringify({
      scope:'VOCO backend process, including decoder threads; excludes WebKit and Chromium',
      userTicks:Number(fields[11]), systemTicks:Number(fields[12]),
      clockTicksPerSecond:Number(execFileSync('getconf', ['CLK_TCK'], {encoding:'utf8'}).trim()),
    },null,2));
  } catch (error) {
    await fs.writeFile(`${root}/evidence/process-cpu.json`, JSON.stringify({unavailable:error.code || 'read-failed'}));
  }
  await browser?.close(); app.kill();
  await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(2000)]);
  await fs.cp(`${root}/state/voco/performance`, `${root}/evidence/performance`, {recursive:true}).catch(()=>{});
  await log.close(); server.close();
}
