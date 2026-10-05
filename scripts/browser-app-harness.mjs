// The session both Chromium application runners drive, one per process: VOCO,
// its native host and a copy of the extension staged under VOCO_BROWSER_TEST_ROOT,
// a recipient page with two textareas, fixture playback into the private Pulse
// sink, and the evidence every run keeps.
import {chromium} from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {freezeLongPlayback} from './browser-long-accuracy.mjs';
export const longCapture = process.env.VOCO_BROWSER_LONG_CAPTURE === '1';
export const root = process.env.VOCO_BROWSER_TEST_ROOT;
const model = `${root}/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`;
export const hash = async p => crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
export const delay = ms=>new Promise(r=>setTimeout(r,ms));
export const traces = async()=> (await fs.readFile(`${root}/state/voco/hotkey-trace.jsonl`,'utf8').catch(()=>'' )).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
export const results = [];
const playbacks = [];
export let longPlan, manifest, extension, extensionHashes, origin, browser, page, worker, tabId;
let grant, profile, server, log, app, failure;

// grantLocalHostPermission adds the harness-only http://127.0.0.1/* grant, so the
// runner can find and enable the recipient tab itself. Without it the extension
// must be exactly the shipped one, which has no host permission.
export async function start({grantLocalHostPermission}) {
  assert.equal(typeof grantLocalHostPermission, 'boolean');
  grant = grantLocalHostPermission;
  assert.ok(root && process.env.XDG_RUNTIME_DIR === `${root}/runtime` && process.env.DISPLAY === ':0');
  if (longCapture) {
    const manifestBytes = await fs.readFile('tests/fixtures/speech/manifest.json');
    const fixtureManifest = JSON.parse(manifestBytes);
    const fixtureWavs = Object.fromEntries(await Promise.all(fixtureManifest.fixtures.map(async row => [row.id, await fs.readFile(path.join('tests/fixtures/speech', row.file))])));
    longPlan = freezeLongPlayback(manifestBytes, await fs.readFile(`${root}/evidence/playback-manifest.json`), await fs.readFile(`${root}/long.wav`), fixtureWavs);
    await fs.writeFile(`${root}/evidence/long-accuracy-plan.json`, JSON.stringify(longPlan, null, 2));
  }
  const extensionSource = process.env.VOCO_BROWSER_EXTENSION_DIR || 'integrations/chromium';
  extensionHashes = Object.fromEntries(await Promise.all(['manifest.json', 'content.js', 'background.js'].map(async file => [file, await hash(path.join(extensionSource, file))])));
  extension = `${root}/extension`; await fs.cp(extensionSource, extension, {recursive: true});
  manifest = JSON.parse(await fs.readFile(`${extension}/manifest.json`));
  if (grant) {
    manifest.host_permissions = ['http://127.0.0.1/*'];
    await fs.writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
  } else {
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'nativeMessaging']);
    assert.equal(manifest.host_permissions, undefined);
    for (const file of ['manifest.json', 'content.js', 'background.js']) assert.equal(await hash(`${extension}/${file}`), extensionHashes[file]);
  }
  profile = `${root}/profile`; await fs.mkdir(`${profile}/NativeMessagingHosts`, {recursive: true});
  await fs.writeFile(`${profile}/NativeMessagingHosts/com.voco.exact_field.json`, JSON.stringify({name:'com.voco.exact_field',description:'Isolated VOCO acceptance',type:'stdio',path:`${root}/voco-browser-host`,allowed_origins:['chrome-extension://dohnphckdenppjhdafmhefhomomodgcc/']}));
  server = http.createServer((_q,r) => r.end('<!doctype html><title>VOCO exact recipient</title><textarea id="a"></textarea><textarea id="b"></textarea>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  origin = `http://127.0.0.1:${server.address().port}`;
  log = await fs.open(`${root}/evidence/app.log`, 'w');
  app = spawn(`${root}/voco`, [], {env: {...process.env, RUST_LOG: 'info', VOCO_HOTKEY_TRACE: '1'}, stdio:['ignore',log.fd,log.fd]});
}

export async function until(fn, label, ms=30_000) {const deadline=Date.now()+ms;while(Date.now()<deadline){if(await fn())return;if(playbacks.some(p=>p.record.error || p.record.timedOut || (p.record.exitCode !== undefined && p.record.exitCode !== 0)))throw Error('Fixture playback failed; see playback.json');if(app.exitCode!==null)throw Error(`App exited: ${label}`);await delay(50);}throw Error(`Timed out: ${label}`);}

// Ready once the renderer takes shortcuts and the worker is warm; a failed warm-up fails at once.
async function appReady() {const appLog=await fs.readFile(`${root}/evidence/app.log`,'utf8');if(appLog.includes('Selected speech model startup failed'))throw Error('Speech model startup failed; see app.log');return appLog.includes('Bundled Nemotron streaming model ready')&&(await traces()).some(t=>t.event==='frontend_hotkey_handler_ready');}

// Chromium starts once VOCO is ready, with the recipient page in a new tab.
export async function launch({args = [], env} = {}) {
  await until(()=>fs.stat(`${root}/runtime/voco-browser/exact-field.sock`).then(()=>true).catch(()=>false),'broker socket');
  await until(appReady,'frontend and model readiness');
  browser = await chromium.launchPersistentContext(profile, {executablePath:'/tmp/browser/chrome',headless:false,...(env && {env}),args:[...args,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  page=await browser.newPage();await page.goto(origin);
  await worker.evaluate(() => { globalThis.nativeRequestMetadata = []; });
  // Only the harness grant shows the extension the tab's URL.
  tabId=await worker.evaluate(async grant=> grant ? (await chrome.tabs.query({})).find(t=>t.url?.startsWith('http://127.0.0.1')).id : (await chrome.tabs.query({active:true,currentWindow:true}))[0].id, grant);
}

export async function playFixture(file) {
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

// Records the metadata of each claim, append and cancel the extension sends, once per native port.
export const observeNativeRequests = () => worker.evaluate(() => { if (!globalThis.observedNativePorts) globalThis.observedNativePorts = new WeakSet(); if (!globalThis.observedNativePorts.has(native)) { globalThis.observedNativePorts.add(native); native.onMessage.addListener(m => { if (['claim', 'append', 'cancel'].includes(m.type)) globalThis.nativeRequestMetadata.push({type: m.type, sequence: m.sequence, expectedCommittedCharacters: m.expectedCommittedCharacters, textCharacters: typeof m.text === 'string' ? Array.from(m.text).length : null, final: m.final}); }); } });

// One fixture recording into #a after enable() arms the tab: delivered whole, or with
// reject, focus leaves for #b mid-recording and Stop copies what #a did not take.
export async function shortCase(enable, reject, retry = false) {
  await page.reload(); await page.bringToFront();
  await enable();
  assert.equal(await worker.evaluate(()=>ready),true);
  await observeNativeRequests();
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

export async function failed(error) {
  failure = error.message;
  await Promise.allSettled(playbacks.map(p=>p.done));
}

// Writes the evidence, then stops Chromium and VOCO; extra joins result.json.
export async function finish(extra = {}) {
  await fs.writeFile(`${root}/evidence/playback.json`, JSON.stringify(playbacks.map(p=>p.record),null,2));
  if (longCapture) await fs.copyFile(`${root}/long.wav`,`${root}/evidence/playback-long.wav`).catch(()=>{});
  await fs.writeFile(`${root}/evidence/result.json`,JSON.stringify({appSha256:await hash(`${root}/voco`),hostSha256:await hash(`${root}/voco-browser-host`),modelSha256:await hash(model),extensionHashes, recognizer: 'Nemotron 0.6B Q8', tests:results, failure, harnessOnlyHostGrant:grant?'http://127.0.0.1/*':null, ...extra},null,2));
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
