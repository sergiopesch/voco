import {chromium} from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {freezeLongPlayback, scoreLongDelivery} from './browser-long-accuracy.mjs';
const longCapture = process.env.VOCO_BROWSER_LONG_CAPTURE === '1';
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
const manifest = JSON.parse(await fs.readFile(`${extension}/manifest.json`));
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'nativeMessaging']);
assert.equal(manifest.host_permissions, undefined);
for (const file of ['manifest.json', 'content.js', 'background.js']) assert.equal(await hash(`${extension}/${file}`), extensionHashes[file]);
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
  return {done,child};
}
try {
  await until(()=>fs.stat(`${root}/runtime/voco-browser/exact-field.sock`).then(()=>true).catch(()=>false),'broker socket');
  await delay(6000);
  // Chromium exposes its toolbar over AT-SPI only when it is told an assistive
  // technology is running; the renderer flag alone covers just the page.
  browser = await chromium.launchPersistentContext(profile, {executablePath:'/tmp/browser/chrome',headless:false,env:{...process.env,ACCESSIBILITY_ENABLED:'1'},args:['--force-renderer-accessibility=complete',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  await worker.evaluate(() => { globalThis.nativeRequestMetadata = []; });
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
  let activationIndex = 0;
  async function toolbarUI(action) {
    const args = ['scripts/test-browser-toolbar-action.py', '--stage', String(activationIndex), ...(action ? ['--action', action] : [])];
    const child = spawn('/usr/bin/python3', args, {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }).finally(() => clearTimeout(timer));
    assert.equal(status, 0, `Actual Chromium toolbar UI failed: ${errors}`);
    return JSON.parse(output);
  }
  async function activateToolbar() {
    activationIndex += 1;
    await page.bringToFront();
    const before = await toolbarUI();
    const direct = before.nodes.find(node => node.actionable && node.name === manifest.action.default_title);
    if (direct) await toolbarUI(direct.name);
    else {
      await toolbarUI('Extensions');
      const menu = await toolbarUI();
      const candidates = menu.nodes.filter(node => node.actionable && (node.name === manifest.name || node.name.startsWith(manifest.name + ',')));
      assert.equal(candidates.length, 1, `Expected one observed VOCO extension action; found ${JSON.stringify(candidates)}`);
      await toolbarUI(candidates[0].name);
    }
    await until(async () => await worker.evaluate(async id => (await chrome.action.getBadgeText({tabId: id})) === 'ON', tabId), 'real toolbar action grants activeTab and arms tab');
    assert.equal(await hash(`${extension}/manifest.json`), extensionHashes['manifest.json']);
    assert.equal(await worker.evaluate(() => ready), true);
    await fs.writeFile(`${root}/evidence/toolbar-activation-${activationIndex}.json`, JSON.stringify({actualBrowserUIClick:true, badge:'ON', shippedManifestSha256:extensionHashes['manifest.json'], broadHostPermissionGranted:false}, null, 2));
  }
  if (process.env.VOCO_BROWSER_TOOLBAR_PROBE_ONLY === '1') {
    await activateToolbar();
    assert.ok(!(await traces()).some(row => row.event === 'recording_state_active'), 'Action-only probe must never record');
    results.push({case:'actual-toolbar-activeTab-native-host',passed:true,recordingRequested:false});
  }
  async function shortCase(reject, retry = false) {
    await page.reload(); await page.bringToFront();
    await activateToolbar();
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
    // After focus loss, Stop copies the words the field did not take, as a failed paste does.
    if(reject) await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_desktop_remainder_copied'),'focus-loss remainder copied',45_000);
    else await until(async()=> (await page.locator('#a').inputValue()).toLowerCase().match(/[a-z]+/g)?.join(' ')==='go do you hear','real transcript exact-field delivery',45_000);
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_stop_to_idle'),'dictation returns idle');
    assert.equal(await page.locator('#b').inputValue(),'');
    if(reject){
      assert.equal(await page.locator('#a').inputValue(),prefix,'Focus loss preserves already delivered text without replay');
      const copied = execFileSync('xclip', ['-selection', 'clipboard', '-o'], {encoding: 'utf8', timeout: 5000});
      // Pasted right after the field's words, the copy keeps them apart.
      assert.equal((prefix + copied).toLowerCase().match(/[a-z]+/g)?.join(' '), 'go do you hear', 'The clipboard holds exactly the words the field did not take');
    }
    await page.screenshot({path:`${root}/evidence/${retry?'fresh-recording':reject?'focus-loss':'delivery'}.png`});
    results.push({case:retry?'fresh-recording':reject?'focus-loss':'delivery',passed:true,events:(await traces()).slice(traceStart).map(t=>t.event)});
  }
  if (process.env.VOCO_BROWSER_TOOLBAR_PROBE_ONLY !== '1') {
  for (const reject of (process.env.VOCO_BROWSER_LONG_CAPTURE === '1' ? [] : [false, true])) await shortCase(reject);
  if (process.env.VOCO_BROWSER_LONG_CAPTURE === '1') {
    await page.reload(); await page.bringToFront();
    await activateToolbar();
    await worker.evaluate(() => { if (!globalThis.observedNativePorts) globalThis.observedNativePorts = new WeakSet(); if (!globalThis.observedNativePorts.has(native)) { globalThis.observedNativePorts.add(native); native.onMessage.addListener(m => { if (['claim', 'append', 'cancel'].includes(m.type)) globalThis.nativeRequestMetadata.push({type:m.type,sequence:m.sequence,expectedCommittedCharacters:m.expectedCommittedCharacters,textCharacters:typeof m.text==='string'?Array.from(m.text).length:null,final:m.final}); }); } });
    await page.locator('#a').focus();
    const traceStart=(await traces()).length;
    await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='recording_state_active'),'long real microphone recording');
    const player=await playFixture(`${root}/long.wav`);
    const played=player.done;
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_desktop_live_prefix_dispatched'),'live browser prefix receipt',55_000);
    // Focus leaves first: its focusout revokes #a's lease synchronously, so
    // no later append can land between this sample and the final check.
    await page.locator('#b').focus();
    const prefix=await page.locator('#a').inputValue(); assert.ok(prefix.length>0);
    assert.equal(await played,0); await delay(600); await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_desktop_remainder_copied'),'long focus-loss remainder copied',45_000);
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_stop_to_idle'),'long dictation returns idle');
    assert.equal(await page.locator('#a').inputValue(),prefix); assert.equal(await page.locator('#b').inputValue(),'');
    const copied = execFileSync('xclip', ['-selection', 'clipboard', '-o'], {encoding: 'utf8', timeout: 5000});
    const report = scoreLongDelivery(longPlan, prefix, copied);
    await fs.writeFile(`${root}/evidence/long-accuracy.json`, JSON.stringify({plan: longPlan, prefix, copied, ...report}, null, 2));
    assert.ok(report.passed, `The kept prefix plus the copied remainder must meet the frozen full-reference WER and repetition checks: ${report.failures.join('; ')}`);
    results.push({case:'full-reference-long-accuracy', passed:report.passed, maxWer:longPlan.maxWer, score:report.score});
    results.push({case:'long-focus-loss',passed:true,prefixCharacters:Array.from(prefix).length,events:(await traces()).slice(traceStart).map(t=>t.event)});
    await page.screenshot({path:`${root}/evidence/long-focus-loss.png`});
  }

  // Nothing waits in VOCO after focus loss, so the next recording starts directly.
  await shortCase(false, true);
  }

} catch (error) {
  failure = error.message;
  await Promise.allSettled(playbacks.map(p=>p.done));
  throw error;
} finally {
  await fs.writeFile(`${root}/evidence/playback.json`, JSON.stringify(playbacks.map(p=>p.record),null,2));
  if (longCapture) await fs.copyFile(`${root}/long.wav`,`${root}/evidence/playback-long.wav`).catch(()=>{});
  await fs.writeFile(`${root}/evidence/result.json`,JSON.stringify({appSha256:await hash(`${root}/voco`),hostSha256:await hash(`${root}/voco-browser-host`),modelSha256:await hash(`${root}/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`),extensionHashes, tests:results, failure, harnessOnlyHostGrant:null, shippedManifestPreserved:await hash(`${extension}/manifest.json`)===extensionHashes['manifest.json']},null,2));
  if (worker) await fs.writeFile(`${root}/evidence/native-request-metadata.json`, JSON.stringify(await worker.evaluate(()=>globalThis.nativeRequestMetadata).catch(()=>[]), null, 2));
  await fs.copyFile(`${root}/state/voco/hotkey-trace.jsonl`,`${root}/evidence/hotkey-trace.jsonl`).catch(()=>{});
  if (browser) await browser.pages().at(-1)?.screenshot({path:`${root}/evidence/final-browser.png`}).catch(()=>{});
  await browser?.close(); app.kill(); await log.close(); server.close();
}
