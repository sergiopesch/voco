import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createPortProbe } from 'node:net';
import { writeFile, mkdir, realpath } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Renderer-only regression tests: all microphone, clipboard and native operations
// below are explicit mocks. This never exercises the user's desktop input devices.
const root = process.env.VOCO_RENDERER_SOURCE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gapOnly = process.env.VOCO_RENDERER_GAP_ONLY === '1';
const baselineGap = process.env.VOCO_RENDERER_GAP_BASELINE === '1';
const evidence = process.env.VOCO_RENDERER_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
let server;
let browser;
try {
const portProbe = createPortProbe();
await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve); });
const port = portProbe.address().port;
await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
server = await createServer({
  configFile: path.join(root, 'apps/desktop/vite.config.ts'),
  root: path.join(root, 'apps/desktop'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false,
    fs: { allow: [root, await realpath(path.join(root, 'node_modules'))] } },
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 420, height: 660 } });
// Intercepted harness documents need an explicit localhost-only permission for
// Vite's development websocket under Chromium's Local Network Access policy.
await context.grantPermissions(['local-network-access'], { origin });
const page = await context.newPage();
page.setDefaultTimeout(8_000);
const screenshot = async (name) => { if (evidence) await page.screenshot({path:path.join(evidence,name)}); };
const errors = [];
page.on('pageerror', e => { errors.push(e.message); });
page.on('response', response=> { if (response.status()>=400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
const consoleMessages = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleMessages.push(m.text()); });
const results = [];
const nativeMock = `
export const calls = window.nativeCalls = [];
const state = () => ({ sessionId: 101, setupState: "ready", engineActive: true, focusLost: false, ownershipIntact: true, finalizationOutcome: "committed", committedCharacterCount: 0 });
export const startOwnedPreedit = async (...args) => { calls.push(['startOwnedPreedit', ...args]); if(window.deferLease) await new Promise(resolve=>window.resolveLease=resolve); if (!window.lease) throw new Error('No eligible original field'); return state(); };
export const getOwnedPreeditStatus = async () => state();
export const getDesktopInputStatus = async () => ({available:!window.pasteUnavailable,detail:"Paste helper unavailable"});
export const getPanelSetupStatus = async () => ({status:'other-desktop',detail:'Use the tray menu.',canEnable:false});
export const enableGnomePanel = getPanelSetupStatus;
export const takeLauncherActivation = async () => false;
export const getDesktopPasteStatus = async () => ({enabled:Boolean(window.desktopPaste),streamingEnabled:Boolean(window.desktopStream),shortcutEpoch:1,targetToken:window.desktopTargetToken === undefined ? 'synthetic-destination' : window.desktopTargetToken,available:!window.pasteUnavailable,detail:'Paste helper unavailable'});
// Model the native shortcut lease API used by the real hook; no desktop input is touched.
export const beginDesktopShortcutSession = async (id, epoch) => { if(typeof id !== 'string' || epoch !== 1) throw new Error('Invalid shortcut preflight'); calls.push(['beginDesktopShortcutSession',id,epoch]); };
export const endDesktopShortcutSession = async (id) => { calls.push(['endDesktopShortcutSession',id]); };
export const awaitStopShortcutReservation = async (sessionId) => { calls.push(['awaitStopShortcutReservation',sessionId]); if(window.deferStopReservation) await new Promise(resolve=>window.resolveStopReservation=resolve); if(window.failStopReservation) throw new Error('GNOME did not reserve Stop'); };
export const pasteDesktopText = async (text) => { calls.push(['pasteDesktopText',text]); if(window.failPaste) throw new Error('Uncertain paste dispatch'); return {strategy:'clipboard',outcome:'dispatched',pasteMetrics:window.pasteMetrics?{terminal:true,targetProbeMs:60,preflightMs:5,clipboardMs:8,keyboardMs:350}:undefined}; };
export const cancelOwnedPreedit = async (...args) => { calls.push(['cancelOwnedPreedit',...args]); return state(); };
export const releaseBrowserRecording = async (triggerId) => { calls.push(['releaseBrowserRecording',triggerId]); };
export const ackBrowserStop = async (triggerId) => { calls.push(['ackBrowserStop',triggerId]); };
export const commitOwnedPreedit = async (id,text) => { calls.push(['commitOwnedPreedit',id,text]); if(window.deferCommit) await new Promise(resolve=>window.resolveCommit=resolve); window.commitReturned=true; if(window.focusChanged) throw new Error('Original field lost focus'); return {...state(), committedCharacterCount: Array.from(text).length}; };
export const checkpointOwnedPreedit = async (id,prefix,text) => { calls.push(['checkpointOwnedPreedit',id,prefix,text]); if(window.deferCheckpoint) await new Promise(resolve=>window.resolveCheckpoint=resolve); return {...state(), focusLost:Boolean(window.focusChanged), committedCharacterCount:Array.from(prefix+text).length}; };
export const finishCanonicalOwnedPreedit = async (id,prefix,text) => { calls.push(['finishCanonicalOwnedPreedit',id,prefix,text]); return {...state(), focusLost:Boolean(window.focusChanged), committedCharacterCount:Array.from(prefix+text).length}; };
export const debugDictationCaptureEnabled = async () => false;
export const debugNativeCaptureEnabled = async () => false;
export const saveDebugNativeRetainedSource = async () => null;
export const traceHotkeyEvent = async (...args) => {(window.traceEvents??=[]).push(args);};
export const refreshShortcutHeartbeat = async (ready) => {calls.push(['refreshShortcutHeartbeat',ready]);};
export const showNotification = async (...args) => { calls.push(['showNotification',...args]); };
export const updateOwnedPreedit = async () => state();
export const saveDebugDictationCapture = async () => null;
export const insertText = async () => { calls.push(['insertText']); throw new Error('Unsafe generic delivery attempted'); };
`;
await page.route('**/src/lib/tauri.ts*', route => route.fulfill({ contentType: 'application/javascript', body: nativeMock }));
await page.route('**/@tauri-apps_api_window.js*', route => route.fulfill({contentType:'application/javascript',body:`export const getCurrentWindow = () => ({listen:async(name,callback)=>{window.shortcutListeners??={};window.shortcutListeners[name]=callback;return ()=>{if(window.shortcutListeners[name]===callback) delete window.shortcutListeners[name];};},startDragging:async()=>{}});`}));
const markup = `<!doctype html><html><head><title>VOCO recovery verification</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
const React = (await import('/node_modules/.vite/deps/react.js')).default;
const {createRoot} = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const {useDictation} = await import('/src/hooks/useDictation.ts');
const {useGlobalShortcut} = await import('/src/hooks/useGlobalShortcut.ts');
const {ControlPanel} = await import('/src/components/ControlPanel.tsx');
const {deriveStatusLabel} = await import('/src/lib/dictationPresentation.ts');
const hookSource = await (await fetch('/src/hooks/useDictation.ts')).text();
const storeImport = hookSource.split(String.fromCharCode(10)).find(line => line.includes('store/useStore')).split('"')[1];
const {useStore} = await import(storeImport);
for (const weight of [400,500,600,700]) await import('/@fs/' + ${JSON.stringify(root)} + '/node_modules/@fontsource/geist/latin-' + weight + '.css');
await import('/src/styles.css');
window.store = useStore;
const config = {hotkey:'Alt+D',selectedMic:null,insertionStrategy:'auto',transcriptTarget:'cursor',liveCursorMode:'final-text-only',transcriptEnhancement:'off',onboardingCompleted:true,updateChannel:'stable',installChannel:'github-release',voiceProfile:'default'};
useStore.getState().setConfig(config); useStore.getState().setSurface('popover');
const noop = async () => {};
function Harness() {
 const hook = useDictation(); window.hook = hook;
 const state = useStore();
 useGlobalShortcut(hook.toggle,()=>true,Boolean(window.shortcutReady),0,()=>{});
 return React.createElement(React.Fragment,null,

 React.createElement(ControlPanel,{surface:state.surface,onboardingStep:0,config:state.config,errorMessage:state.error,statusLabel:deriveStatusLabel({configurationError:false,hasRecovery:Boolean(state.recovery),manualTranscriptReady:state.recovery?.kind==='manual-copy',cursorDeliveryState:hook.cursorDeliveryState,cursorRequired:true,cursorSetupState:'ready',dictationStatus:state.status,microphonePermission:'granted',microphoneReady:true,}),updateState:state.updateState,runtimeDiagnostics:null,dictationStatus:state.status,cursorDeliveryState:hook.cursorDeliveryState,transcript:state.transcript,rawTranscript:state.rawTranscript,recovery:state.recovery,captureNotice:state.captureNotice,canCancelDictation:hook.canCancel,cancellationPending:hook.cancellationPending,onCancelDictation:()=>void hook.cancelRecording(),onRetryRecovery:()=>void hook.retryRecovery(),onDiscardRecovery:hook.discardRecovery,requestedSection:'General',requestedSectionRequestId:0,selectedDeviceId:null,availableDevices:[],microphonePermission:'granted',onSurfaceChange:surface=>state.setSurface(surface),onOnboardingStepChange:()=>{},onConfigChange:noop,onRefreshDevices:noop,onRequestMicrophoneAccess:noop,onCheckForUpdates:noop,onOpenReleasePage:noop,onRefreshRuntimeDiagnostics:noop,onOpenSettings:noop}));
}
window.reactRoot = createRoot(document.getElementById('root')); window.reactRoot.render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
window.remountHarness = () => { window.reactRoot = createRoot(document.getElementById('root')); window.reactRoot.render(React.createElement(React.StrictMode,null,React.createElement(Harness))); };
</script></body></html>`;
await page.route('**/recovery-check', route => route.fulfill({ contentType: 'text/html', body: markup }));
await page.addInitScript(() => {
 window.RealAudioContext = window.AudioContext;
 window.RealAudioWorkletNode = window.AudioWorkletNode;
 window.contexts = [];
 window.lease = false;
 window.nativeCalls = [];
 window.tracks = [];
 // Exercise the real append-only queue against an explicit native IPC double.
 // No alternate recognition transport exists.
 window.benchmarkRequests = [];
 window.benchmarkAudioSamples = 0;
 window.__TAURI_INTERNALS__ = {invoke: async (command, {request}) => {
   if(command === 'recover_stream') {
     (window.recoveryRequests ??= []).push(request);
     if(request.op === 'push' && window.deferRecovery) {
       await new Promise(resolve => window.resolveRecovery = resolve);
     }
     if(window.failRecovery && request.op === 'push') throw new Error('Synthetic recovery worker failure');
     return {session:request.session,seq:request.seq,mode:'append-only',text:request.op==='finish'?'Recovered with bundled NVIDIA.':null};
   }
   if(command !== 'benchmark_stream') throw new Error('Unexpected native command: ' + command);
   window.benchmarkRequests.push(request);
   if(request.op === 'warmup' || request.op === 'diagnostic' || request.op === 'quality') return {};
   if(request.op === 'start') {
     if(request.seq !== 0 || typeof request.session !== 'string') throw new Error('Invalid stream start');
     window.benchmarkSession = request.session;
     window.benchmarkSequence = 0;
     window.benchmarkAudioSamples = 0;
   } else if(request.session !== window.benchmarkSession || request.seq <= window.benchmarkSequence) {
     throw new Error('Stream request identity or sequence changed');
   }
   window.benchmarkSequence = request.seq;
   let text = null;
   if(request.op === 'push') {
     if(request.rate !== 16000 || !Array.isArray(request.audio) || !request.audio.length ||
       request.audio.length > 1600 || !request.audio.every(Number.isFinite)) throw new Error('Invalid stream PCM packet');
     if(window.deferInference) {
       await new Promise(resolve => window.resolveInference = resolve);
       window.deferInference = false;
     }
     window.benchmarkAudioSamples += request.audio.length;
     const plan = window.streamTextAt ?? [{samples:16000,text:'Recovered words'}];
     text = plan.filter(item => item.samples <= window.benchmarkAudioSamples).at(-1)?.text ?? null;
   } else if(request.op === 'finish') {
     text = window.streamFinalText ?? 'Recovered words for manual review.';
   } else if(!['start','cancel'].includes(request.op)) throw new Error('Unexpected stream operation');
   return {session:request.session,seq:request.seq,mode:'append-only',text};
 }};
 class Track extends EventTarget { readyState='live'; muted=false; stop(){this.readyState='ended';this.stopCount=(this.stopCount||0)+1;} }
 const getUserMedia = async (constraints) => { window.requestedMicrophones ??= []; window.requestedMicrophones.push(constraints.audio); if(window.deferMicrophone) await new Promise(resolve=>window.resolveMicrophone=resolve); if(window.failSelectedDevice && constraints.audio !== true) throw new DOMException('Unplugged selected device','NotFoundError'); const track = new Track(); window.tracks.push(track); return {getTracks:()=>[track],getAudioTracks:()=>[track]}; };
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia,enumerateDevices:async()=>[],addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.copiedText=text;}}});
 class AudioNode { connect(){} disconnect(){this.disconnected=true;} }
 window.AudioContext = class { constructor(){window.contexts.push(this);} sampleRate=16000; state='running'; destination={}; audioWorklet={addModule:async()=>{if(window.failWorkletModule) throw new Error('Synthetic worklet startup failure');}}; createMediaStreamSource(){return new AudioNode();} createGain(){return Object.assign(new AudioNode(),{gain:{value:0}});} createScriptProcessor(){const processor = new AudioNode(); window.processor=processor; return processor;} close(){this.state='closed'; return Promise.resolve();} resume(){return Promise.resolve();} };
 window.AudioWorkletNode = class extends AudioNode { constructor(){super();if(window.failWorkletConstruction) throw new Error('Synthetic worklet construction failure');window.captureWorklet=this;this.port={onmessage:null,postMessage:()=>queueMicrotask(()=>this.port.onmessage?.({data:{type:'flushed',complete:true}})),close(){this.closed=true;}};} };
 window.captureReady = () => Boolean(window.captureWorklet?.port.onmessage || window.processor?.onaudioprocess);
 window.samples = seconds => {const audio = Float32Array.from({length:Math.floor(16000*seconds)},(_,i)=>Math.sin(i/20)*0.2); if(window.captureWorklet?.port.onmessage) window.captureWorklet.port.onmessage({data:{type:'samples',data:audio}}); else window.processor.onaudioprocess({inputBuffer:{getChannelData:()=>audio}});};
});
async function load() {
  await page.goto(origin + '/recovery-check');
  try {
    await page.waitForFunction(() => Boolean(window.hook),null,{timeout:8000});
  } catch (error) {
    const diagnostic = {url:page.url(),errors,consoleMessages};
    if (evidence) await writeFile(path.join(evidence,'startup-failure.json'),JSON.stringify(diagnostic,null,2));
    throw new Error(`Dictation harness did not mount: ${JSON.stringify(diagnostic)}`, {cause:error});
  }
}
async function start(seconds=1) { await page.evaluate(()=>window.hook.toggle()); await page.waitForFunction(()=>window.captureReady()); await page.evaluate(seconds => window.samples(seconds),seconds); }
async function stop() {await page.evaluate(()=>window.hook.toggle());}
async function recovered() {try {await page.waitForFunction(()=>Boolean(window.store.getState().recovery),null,{timeout:6000});} catch(e) {console.log('DEBUG_STATE', await page.evaluate(()=>({state:window.store.getState(),calls:window.nativeCalls,processor:!!window.processor?.onaudioprocess}))); throw e;} }

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.failStopReservation=true;});
await page.evaluate(()=>window.hook.toggle());
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='awaitStopShortcutReservation'));
assert.equal(await page.evaluate(()=>window.store.getState().status),'idle');
assert.equal(await page.evaluate(()=>window.tracks.length),0);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='showNotification'&&c[1]==='Dictation setup incomplete')),true);
results.push('A rejected GNOME Stop reservation returns to idle without opening the microphone.');

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.deferStopReservation=true;});
await page.evaluate(()=>{void window.hook.toggle();});
await page.waitForFunction(()=>typeof window.resolveStopReservation==='function');
assert.equal(await page.evaluate(()=>window.tracks.length),0);
assert.equal(await page.evaluate(()=>window.captureReady()),false);
await page.evaluate(()=>window.resolveStopReservation());
await page.waitForFunction(()=>window.captureReady());
await page.evaluate(()=>window.hook.cancelRecording());
results.push('An unconfirmed GNOME Stop reservation holds capture until the session ACK.');

await load();await start();
assert.equal(await page.evaluate(()=>window.hook.toggle('tray:stop','stop',window.hook.dictationSessionId+1)),false);
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
assert.equal(await page.evaluate(()=>window.hook.toggle('tray:stop','stop',window.hook.dictationSessionId)),true);
await recovered();
results.push('A session-bound Stop rejects a different capture and finishes only its own live capture.');

await load();await start();await stop();await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().recovery.kind),'manual-copy');
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered words for manual review.');
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['startOwnedPreedit','pasteDesktopText','insertText'].includes(c[0]))),false);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
results.push('Manual-copy recording uses Nemotron without acquiring or mutating an external destination.');

await load();await page.evaluate(()=>{window.lease=true;window.hook.toggle('browser:fixture','start');});
await page.waitForFunction(()=>window.store.getState().status==='recording');
await page.evaluate(()=>window.samples(1));
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='checkpointOwnedPreedit'));
await page.evaluate(()=>window.hook.toggle('browser:fixture','stop'));
await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='checkpointOwnedPreedit').map(c=>c.slice(2))),[['','Recovered words'],['Recovered words',' for manual review.']]);
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='finishCanonicalOwnedPreedit').map(c=>c.slice(2))),[['Recovered words for manual review.','']]);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['pasteDesktopText','beginDesktopShortcutSession','insertText'].includes(c[0]))),false);
results.push('Browser recording streams Nemotron suffixes through its exact field lease and finalizes without replay.');

await load();await page.evaluate(()=>{window.lease=true;window.focusChanged=true;window.hook.toggle('browser:fixture','start');});
await page.waitForFunction(()=>window.store.getState().status==='recording');
await page.evaluate(()=>window.samples(1));
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='checkpointOwnedPreedit'));
await page.evaluate(()=>window.hook.toggle('browser:fixture','stop'));await recovered();
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='checkpointOwnedPreedit').length),1);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.targetMayContainText),true);
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered with bundled NVIDIA.');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='checkpointOwnedPreedit').length),1);
results.push('An uncertain browser receipt stops delivery; explicit recovery stays local and never retries the field.');

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.streamTextAt=[];});
await start(0.5);
await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'capture-interrupted'}}));
await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),0);
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/microphone stopped/);
results.push('A capture interruption cancels stream output and retains the received prefix for explicit recovery.');

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.streamTextAt=[];});
await start(0.5);
await page.evaluate(()=>{window.captureWorklet.port.postMessage=()=>{};});
await stop();await recovered();
assert.equal(await page.evaluate(()=>window.benchmarkRequests.some(r=>r.op==='finish')),false);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/end of this recording/);
results.push('A missing capture-flush receipt cannot finish recognition or deliver a final suffix.');
// Default NVIDIA route must honor the same capture-completeness policy.
for (const failure of ['module', 'construction']) {
  await load();
  await page.evaluate(failure=>{
    window.desktopPaste=true;window.desktopStream=true;
    window.failWorkletModule=failure==='module';window.failWorkletConstruction=failure==='construction';
  },failure);
  await start(1);
  assert.equal(await page.evaluate(()=>Boolean(window.processor?.onaudioprocess)),true);
  assert.equal(await page.evaluate(()=>window.benchmarkRequests.some(r=>['start','push'].includes(r.op))),false);
  assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='pasteDesktopText')),false);
  await stop();await recovered();
  assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
  assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['transcribeAudio','pasteDesktopText'].includes(c[0]))),false);
  await page.evaluate(()=>window.store.getState().setSurface('popover'));
  await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
  await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
  assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered with bundled NVIDIA.');
  assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/bundled NVIDIA/);
  assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['transcribeAudio','pasteDesktopText'].includes(c[0]))),false);
  assert.equal(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='push').reduce((n,r)=>n+r.audio.length,0)),16000);
  assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/could not be confirmed/);
  results.push(`NVIDIA ${failure} fallback retains source without automatic inference or paste; explicit local recovery uses the same recognizer without delivery.`);
}

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.failWorkletModule=true;});
await start(1);await stop();await recovered();
await page.evaluate(()=>{window.deferRecovery=true;});
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>Boolean(window.resolveRecovery));
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().status==='error' && !window.store.getState().recovery.retrying);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
const firstRecovery=await page.evaluate(()=>window.recoveryRequests[0].session);
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
assert.equal(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='start').length),1);
await page.evaluate(()=>{window.deferRecovery=false;window.failRecovery=true;window.resolveRecovery();});
await page.waitForFunction(()=>window.recoveryRequests.filter(r=>r.op==='start').length===2 && !window.store.getState().recovery.retrying);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
await page.evaluate(()=>{window.failRecovery=false;});
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.notEqual(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='start').at(-1).session),firstRecovery);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered with bundled NVIDIA.');
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['transcribeAudio','pasteDesktopText'].includes(c[0]))),false);
results.push('NVIDIA recovery cancels promptly, waits for old cleanup, preserves audio through worker failure and succeeds on explicit retry without insertion.');

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.failWorkletModule=true;});
await start(1);await stop();await recovered();
await page.evaluate(()=>{window.deferRecovery=true;});
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>Boolean(window.resolveRecovery));
await page.evaluate(()=>{window.reactRoot.unmount();window.store.getState().setTranscript('Replacement state');window.deferRecovery=false;window.resolveRecovery();});
await page.waitForFunction(()=>window.recoveryRequests.some(r=>r.op==='cancel'));
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Replacement state');
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='pasteDesktopText')),false);
results.push('Unmount cancels the recovery worker and suppresses a late transcript.');

await load(); await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.pasteMetrics=true;});
await start();
await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:new Float32Array(16000)}}));
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length===1);
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
await page.evaluate(()=>window.samples(1));await stop();await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),2);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>['start','push','finish'].includes(r.op)).every((r,index)=>r.seq===index)),true);
assert.equal(await page.evaluate(()=>window.traceEvents.filter(c=>c[0]==='dictation_desktop_first_phrase_dispatched').length),1);
assert.equal(await page.evaluate(()=>window.traceEvents.filter(c=>c[0]==='dictation_desktop_terminal_route_dispatched').length),2);
assert.equal(await page.evaluate(()=>window.traceEvents.find(c=>c[0]==='dictation_desktop_keyboard_dispatch_completed')[1].durationMs),350);
results.push('Progressive native dictation pastes before Stop, flushes only the tail, reports paste stages and never repastes the complete transcript.');
await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.deferInference=true;});
await start();await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:new Float32Array(16000)}}));
await page.waitForFunction(()=>Boolean(window.resolveInference));
await page.evaluate(()=>{void window.hook.cancelRecording();});await page.evaluate(()=>window.resolveInference());
await page.waitForFunction(()=>window.benchmarkRequests.some(r=>r.op==='cancel'));
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),0);
results.push('Cancellation while a progressive worker request is in flight drains the cancel command and suppresses its late paste.');
await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.failPaste=true;});
await start();await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:new Float32Array(16000)}}));
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length===1);
await page.evaluate(()=>window.samples(1));await stop();await page.waitForFunction(()=>window.store.getState().status==='error');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),1);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.targetMayContainText),true);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered words for manual review.','Stop retains recognition after delivery was interrupted');
assert.equal(await page.evaluate(()=>window.benchmarkAudioSamples),48000);
assert.equal(await page.evaluate(()=>window.store.getState().surface),'hidden','Recovery must not open a window');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='showNotification'&&c[1]==='Dictation saved in VOCO').length),1);
assert.equal(await page.getByRole('button',{name:'Copy transcript',exact:true}).count(),0);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='showNotification'&&c[1]==='Text delivery paused').length),1);
results.push('Uncertain progressive paste keeps recognition and Stop flushing, retains text/audio, notifies without opening a window and never retries insertion.');
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByText('Saved dictation',{exact:true}).waitFor();
assert.equal(await page.locator('.voco-panel__error').count(),0);
assert.equal(await page.locator('details').evaluate(el=>el.open),false);
await screenshot('saved-dictation-on-request.png');
await page.evaluate(()=>window.store.getState().setSurface('popover'));
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered with bundled NVIDIA.');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),1);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='transcribeAudio')),false);
assert.equal(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='push').reduce((n,r)=>n+r.audio.length,0)),48000);
assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),null,'Successful recovery must remove the obsolete Stop recording prompt');
results.push('Recovery after uncertain NVIDIA paste uses all retained source with the bundled recognizer and does not resend any target text.');


await load(); await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.streamTextAt=[];window.streamFinalText='Exact captured samples.';});
await start(0);
await page.evaluate(()=>{
 const batch = new Float32Array(32321);
 for (let i=1600;i<12000;i++) batch[i]=Math.sin(i/20)*0.2;
 for (let i=18000;i<31000;i++) batch[i]=Math.sin(i/20)*0.2;
 window.expectedStreamAudio = Array.from(batch);
 for(const [from,to] of [[0,111],[111,9876],[9876,batch.length]]) {
   window.captureWorklet.port.onmessage({data:{type:'samples',data:batch.slice(from,to)}});
 }
});
await page.waitForFunction(()=>window.benchmarkAudioSamples===32000);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),0);
await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.deepEqual(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='push').flatMap(r=>r.audio)),await page.evaluate(()=>window.expectedStreamAudio));
assert.deepEqual(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='push').map(r=>r.audio.length)),[...Array(20).fill(1600),321]);
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').map(c=>c[1])),['Exact captured samples.']);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
results.push('Irregular callbacks retain every speech and silence sample in 100 ms packets, flush the partial tail exactly once, and deliver only the final recognized text.');

await load(); await page.evaluate(()=>{
 window.desktopPaste=true;window.desktopStream=true;
 window.streamTextAt=[{samples:16000,text:'Words appe'},{samples:20800,text:'Words appear during speech'}];
 window.streamFinalText='Words appear during speech before stopping now.';
});
await start(0);
await page.evaluate(()=>window.samples(0.8));
await page.waitForFunction(()=>window.benchmarkAudioSamples===12800);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),0);
await page.evaluate(()=>window.samples(0.2));
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length===1);
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
assert.equal(await page.evaluate(()=>window.nativeCalls.find(c=>c[0]==='pasteDesktopText')[1]),'Words appe');
await page.evaluate(()=>window.samples(0.3));
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length===2);
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').map(c=>c[1])),['Words appe','ar during speech']);
await page.evaluate(()=>window.samples(0.25));
await page.waitForFunction(()=>window.benchmarkAudioSamples===24000);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),2);
await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').map(c=>c[1])),['Words appe','ar during speech',' before stopping now.']);
assert.equal(await page.evaluate(()=>window.traceEvents.filter(c=>c[0]==='dictation_desktop_live_prefix_dispatched').length),3);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['previewTranscribeAudio','transcribeAudio'].includes(c[0])).length),0);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
await screenshot('continuous-speech-finished.png');
results.push('Uninterrupted input appends partial words exactly as the worker responds, suppresses repeated hypotheses, and Stop adds only the remaining suffix without legacy re-decoding.');

await load(); await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.streamTextAt=[];window.streamFinalText='Long stream completed.';});
await start(0);
// Yield between capture callbacks so this models an ongoing stream, not a
// multi-minute backlog intentionally rejected by the three-second queue bound.
for(let second=1;second<=300;second++) {
 await page.evaluate(()=>window.samples(1));
 await page.waitForFunction(samples=>window.benchmarkAudioSamples===samples,second*16000);
}
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='push').length),3000);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.some(r=>r.op==='diagnostic')),false);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['previewTranscribeAudio','transcribeAudio'].includes(c[0]))),false);
await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').map(c=>c[1])),['Long stream completed.']);
results.push('Five minutes of simulated captured audio maintains sequenced 100 ms IPC packets, avoids whole-history decoding and finishes once after all captured audio.');


await load(); await page.evaluate(()=>{
 window.desktopPaste=true;window.desktopStream=true;
 window.streamTextAt=[{samples:16000,text:'First phrase.'},{samples:120*16000,text:'First phrase. Later speech'},{samples:300*16000,text:'First phrase. Later speech remains available'}];
 window.streamFinalText='First phrase. Later speech remains available through Stop.';
});
await start(0);
for(let second=1;second<=300;second++) {
 if(second===120) await page.evaluate(()=>window.failPaste=true);
 await page.evaluate(()=>window.samples(1));
 await page.waitForFunction(samples=>window.benchmarkAudioSamples===samples,second*16000);
}
await page.evaluate(()=>window.samples(701/16000));
await stop();await recovered();
assert.equal(await page.evaluate(()=>window.benchmarkAudioSamples),4800701);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),2,'One successful paste and one rejection; no retry');
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'First phrase. Later speech remains available through Stop.');
assert.equal(await page.evaluate(()=>window.store.getState().surface),'hidden');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='showNotification'&&c[1]==='Dictation saved in VOCO').length),1);
await page.evaluate(()=>window.hook.toggle());
assert.equal(await page.evaluate(()=>window.store.getState().surface),'hidden','A blocked restart only notifies; reviewing text is explicit');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='showNotification'&&c[1]==='Previous transcript available').length),1);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='start').length),1);
results.push('Delivery interrupted at two minutes still recognizes five minutes plus a partial Stop tail, with no retry or automatic recovery window.');


if (evidence) await writeFile(path.join(evidence,'results.json'),JSON.stringify({passed:errors.length===0,results,errors,consoleMessages,browser:'Headless Chromium; real React hook/store/components with explicit capture and native IPC doubles'},null,2));
assert.deepEqual(errors,[]);
assert.deepEqual(consoleMessages,[]);
console.log(JSON.stringify({results,errors,evidence},null,2));
} finally {
  await Promise.allSettled([browser?.close(),server?.close()]);
}
