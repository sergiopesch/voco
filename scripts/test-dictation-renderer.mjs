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
export const getDesktopPasteStatus = async () => ({enabled:Boolean(window.desktopPaste),streamingEnabled:Boolean(window.desktopStream),shortcutEpoch:1,targetToken:window.desktopTargetToken??null,available:!window.pasteUnavailable,detail:'Paste helper unavailable'});
// Model the native shortcut lease API used by the real hook; no desktop input is touched.
export const beginDesktopShortcutSession = async (id, epoch) => { if(typeof id !== 'string' || epoch !== 1) throw new Error('Invalid shortcut preflight'); calls.push(['beginDesktopShortcutSession',id,epoch]); };
export const endDesktopShortcutSession = async (id) => { calls.push(['endDesktopShortcutSession',id]); };
export const pasteDesktopText = async (text) => { calls.push(['pasteDesktopText',text]); if(window.failPaste) throw new Error('Uncertain paste dispatch'); return {strategy:'clipboard',outcome:'dispatched',pasteMetrics:window.pasteMetrics?{terminal:true,targetProbeMs:60,preflightMs:5,clipboardMs:8,keyboardMs:350}:undefined}; };
export const cancelOwnedPreedit = async (...args) => { calls.push(['cancelOwnedPreedit',...args]); return state(); };
export const releaseBrowserRecording = async (triggerId) => { calls.push(['releaseBrowserRecording',triggerId]); };
export const commitOwnedPreedit = async (id,text) => { calls.push(['commitOwnedPreedit',id,text]); if(window.deferCommit) await new Promise(resolve=>window.resolveCommit=resolve); window.commitReturned=true; if(window.focusChanged) throw new Error('Original field lost focus'); return {...state(), committedCharacterCount: Array.from(text).length}; };
export const checkpointOwnedPreedit = async (id,prefix,text) => { calls.push(['checkpointOwnedPreedit',id,prefix,text]); if(window.deferCheckpoint) await new Promise(resolve=>window.resolveCheckpoint=resolve); return {...state(), committedCharacterCount:Array.from(prefix+text).length}; };
export const finishCanonicalOwnedPreedit = async (id,prefix,text) => { calls.push(['finishCanonicalOwnedPreedit',id,prefix,text]); return {...state(), committedCharacterCount:Array.from(prefix+text).length}; };
export const transcribeAudio = async (audio) => { calls.push(['transcribeAudio',audio.length]); if(window.captureInferenceAudio) (window.inferenceAudio ??= []).push(Array.from(audio)); if(window.deferInference) await new Promise(resolve => window.resolveInference = resolve); if(window.failInference) throw new Error(typeof window.failInference === 'string' ? window.failInference : 'Synthetic inference failure'); return window.inferenceTexts?.shift() ?? 'Recovered words for manual review.'; };
export const transcribeHybridChunk = async (packet) => {
 const view = new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
 const size = view.getUint32(4,true);
 if(new TextDecoder().decode(packet.subarray(0,4))!=='VCA2') throw new Error('Expected binary VCA2 packet');
 const m = JSON.parse(new TextDecoder().decode(packet.subarray(8,8+size)));
 const audio = Float32Array.from({length:m.payloadSamples},(_,i)=>view.getFloat32(8+size+i*4,true));
 const prefix = m.previousCanonicalText;
 calls.push(['transcribeHybridChunk',audio.length,prefix,m]);
 (window.hybridPackets ??= []).push(packet.slice());
 if(window.captureInferenceAudio) (window.inferenceAudio ??= []).push(Array.from(audio));
 if(window.deferCanonical) await new Promise(resolve=>window.resolveCanonical=resolve);
 window.canonicalReturned=true;
 if(window.failCanonicalBeforeDecode) throw 'Transcription state is unavailable';
 if(window.failCanonical && prefix) throw new Error(typeof window.failCanonical === 'string' ? window.failCanonical : 'Synthetic tail failure');
 const chunkText = prefix ? 'Recovered tail.' : 'Completed checkpoint.';
 const appendText = (prefix ? ' ' : '') + chunkText;
 const inputEnd = m.nextInputStart + m.payloadSamples;
 const rightBoundaryMode = m.payloadSamples === 480000 ? 'legacyStride' : 'final';
 const result = {protocolVersion:2,sessionId:m.sessionId,requestSequence:m.requestSequence,generation:m.generation,
  receipt:{sequence:m.plannerSequence,inputStart:m.nextInputStart,inputEnd,previousDecodedEnd:m.previousDecodedEnd,
   leftJoinMode:m.plannerSequence===0?'initial':m.previousDecodedEnd===m.nextInputStart?'disjoint':'legacyOverlap',
   rightBoundaryMode,plateauStart:null,plateauEnd:null,nextInputStart:rightBoundaryMode==='legacyStride'?inputEnd-16000:inputEnd},
  chunkText,appendText,canonicalText:prefix+appendText};
 window.mutateHybridResponse?.(result,m);
 return result;
};
export const debugDictationCaptureEnabled = async () => false;
export const debugNativeCaptureEnabled = async () => false;
export const saveDebugNativeRetainedSource = async () => null;
export const previewTranscribeAudio = async (audio) => { calls.push(['previewTranscribeAudio',audio.length]); if(window.desktopStream && window.inferenceTexts) return {text:window.inferenceTexts.shift() ?? '',segments:[]}; (window.previewSampleCounts ??= []).push(audio.length); if(window.capturePreviewAudio) (window.previewAudio ??= []).push(audio.slice()); return {text:'',segments:[]}; };
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

 React.createElement(ControlPanel,{surface:'popover',onboardingStep:0,config:state.config,errorMessage:state.error,statusLabel:deriveStatusLabel({configurationError:false,hasRecovery:Boolean(state.recovery),manualTranscriptReady:state.recovery?.kind==='manual-copy',cursorDeliveryState:hook.cursorDeliveryState,cursorRequired:true,cursorSetupState:'ready',dictationStatus:state.status,microphonePermission:'granted',microphoneReady:true,}),updateState:state.updateState,runtimeDiagnostics:null,dictationStatus:state.status,cursorDeliveryState:hook.cursorDeliveryState,transcript:state.transcript,rawTranscript:state.rawTranscript,recovery:state.recovery,captureNotice:state.captureNotice,canCancelDictation:hook.canCancel,cancellationPending:hook.cancellationPending,onCancelDictation:()=>void hook.cancelRecording(),onRetryRecovery:()=>void hook.retryRecovery(),onDiscardRecovery:hook.discardRecovery,requestedSection:'General',requestedSectionRequestId:0,selectedDeviceId:null,availableDevices:[],microphonePermission:'granted',onSurfaceChange:()=>{},onOnboardingStepChange:()=>{},onConfigChange:noop,onRefreshDevices:noop,onRequestMicrophoneAccess:noop,onCheckForUpdates:noop,onOpenReleasePage:noop,onRefreshRuntimeDiagnostics:noop,onOpenSettings:noop}));
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
 // Legacy transcribeAudio/preview callbacks are not the current stream transport.
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
   if(request.op === 'warmup' || request.op === 'diagnostic') return {};
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
       request.audio.length > 320 || !request.audio.every(Number.isFinite)) throw new Error('Invalid stream PCM packet');
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
async function startWorklet(seconds = 1, canonical = false) {
  await load();
  await page.evaluate(({seconds,canonical}) => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context { audioWorklet = {addModule:async()=>{}}; };
    window.AudioWorkletNode = class {
      constructor(){window.captureWorklet=this;this.port={onmessage:null,postMessage:()=>{window.flushRequested=true;},close(){this.closed=true;}};}
      connect(){} disconnect(){this.disconnected=true;}
    };
    window.captureInferenceAudio=true;
    if(canonical){window.deferCanonical=true;window.lease=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});}
    window.workletSeconds=seconds;window.hook.toggle();
  },{seconds,canonical});
  await page.waitForFunction(()=>Boolean(window.captureWorklet?.port.onmessage));
  await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:Float32Array.from({length:16000*window.workletSeconds},(_,i)=>Math.sin(i/20)*.2)}}));
}

// Execute the checked-in processor body, with a deterministic MessagePort bridge.
// Generated numeric input never accesses an actual microphone or native decoder.
async function startRealProcessor({canonical=false, deferCanonical=false, leadingEmpty=false}={}) {
  await load();
  await page.evaluate(async ({canonical,deferCanonical,leadingEmpty})=>{
    const source = await (await fetch('/audio-processor.js')).text();
    let Processor;
    class ProcessorBase {constructor(){
      this.channel=new MessageChannel();this.port=this.channel.port1;
      const send=this.port.postMessage.bind(this.port);
      this.port.postMessage=(message,transfer=[])=>{if(message.type==='flushed' && window.suppressFlushAck)return;send(message,transfer);};
    }}
    new Function('AudioWorkletProcessor','registerProcessor',source)(ProcessorBase,(_name,value)=>{Processor=value;});
    window.AudioWorkletNode = class {
      constructor(){window.captureWorklet=this;this.processor=new Processor();this.port=this.processor.channel.port2;
        const send=this.port.postMessage.bind(this.port);const close=this.port.close.bind(this.port);
        this.port.postMessage=(message)=>{window.flushRequested=true;if(window.gapAtFlush)this.processor.process([]);send(message);};
        this.port.close=()=>{this.port.closed=true;close();this.processor.port.close();};}
      connect(){} disconnect(){this.disconnected=true;}
    };
    window.captureInferenceAudio=true;window.deferCanonical=deferCanonical;
    if(canonical){window.lease=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});}
    window.feedProcessor=(count,value=.125)=>{const x=Float32Array.from({length:count},(_,i)=>i%2?-value:value);window.captureWorklet.processor.process([[x]]);return Array.from(x);};
    await window.hook.toggle();

  },{canonical,deferCanonical,leadingEmpty});
  await page.waitForFunction(()=>Boolean(window.captureWorklet?.port.onmessage));
  await page.waitForFunction(()=>window.traceEvents?.some(e=>e[0]==='recording_state_active'));
  if(leadingEmpty) await page.evaluate(()=>window.captureWorklet.processor.process([]));
}
async function gapVisual(name) {
  const visual = {url:page.url(),title:await page.title(),viewport:page.viewportSize(),bodyText:await page.locator('body').innerText(),frameworkErrorOverlays:await page.locator('vite-error-overlay').count()};
  assert.match(visual.url,/\/recovery-check$/);
  assert.equal(visual.title,'VOCO recovery verification');
  assert.equal(visual.frameworkErrorOverlays,0);
  assert.match(visual.bodyText,/microphone stopped providing input/i);
  assert.ok(visual.bodyText.length>100);
  await screenshot(name+'.png');
  if(evidence) await writeFile(path.join(evidence,name+'.json'),JSON.stringify(visual,null,2));
}
async function gapCases() {
  await startRealProcessor({leadingEmpty:true});
  await page.evaluate(()=>{window.expectedPrefix=window.feedProcessor(16256);window.captureWorklet.processor.process([]);window.feedProcessor(4096,.25);});
  if(baselineGap){
    await stop();await recovered();
    assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),1);
    assert.equal(await page.evaluate(()=>window.inferenceAudio[0].length),20352);
    assert.equal(await page.evaluate(()=>Boolean(window.store.getState().captureNotice)),false);
    results.push('UNCHANGED BASELINE REPRODUCED: actual worklet merges 16256 prefix + 4096 resumed samples across absent input and automatically transcribes 20352 samples without gap notice.');
    return;
  }
  await recovered();
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['transcribeAudio','transcribeHybridChunk','commitOwnedPreedit','checkpointOwnedPreedit'].includes(c[0])).length),0);
  await gapVisual('input-gap-recovery');
  const notice=await page.evaluate(()=>window.store.getState().captureNotice);
  assert.ok(notice,'Active input gap must keep an interruption notice');
  await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
  await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
  assert.deepEqual(await page.evaluate(()=>window.inferenceAudio[0]),await page.evaluate(()=>window.expectedPrefix));
  assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),notice);
  await gapVisual('input-gap-after-retry');
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['commitOwnedPreedit','checkpointOwnedPreedit','finishCanonicalOwnedPreedit','insertText'].includes(c[0])).length),0);
  results.push('Real processor active gap seals exact prefix; no automatic inference/delivery; explicit Retry uses every prefix byte locally and preserves notice.');

  await startRealProcessor({leadingEmpty:true});
  await page.evaluate(()=>window.feedProcessor(16384,0));await stop();await recovered();
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),1);
  assert.equal(await page.evaluate(()=>window.inferenceAudio[0].every(x=>x===0)),true);
  assert.equal(await page.evaluate(()=>Boolean(window.store.getState().captureNotice)),false);
  results.push('Leading empty input and present all-zero samples are healthy input, not an inferred gap.');

  await startRealProcessor();
  await page.evaluate(()=>{window.expectedPrefix=window.feedProcessor(16256);window.oldWorklet=window.captureWorklet;window.oldCallback=window.captureWorklet.port.onmessage;window.gapAtFlush=true;});
  await stop();await recovered();
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),0);
  await page.evaluate(()=>{window.hook.discardRecovery();window.gapAtFlush=false;});
  await page.waitForFunction(()=>window.store.getState().recovery===null);
  await page.evaluate(()=>window.hook.toggle());await page.waitForFunction(()=>Boolean(window.captureWorklet?.port.onmessage));
  await page.evaluate(()=>{window.oldCallback?.({data:{type:'capture-interrupted'}});window.oldWorklet.processor.process([]);window.feedProcessor(16384);});
  assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
  await stop();await recovered();
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),1);
  results.push('Gap racing Stop/flush blocks automatic output; Discard permits healthy restart and old producer messages cannot interrupt the new recording.');

  await startRealProcessor();
  await page.evaluate(()=>{window.expectedPrefix=window.feedProcessor(16256);window.suppressFlushAck=true;window.captureWorklet.processor.process([]);});
  await recovered();
  const missingAckNotice=await page.evaluate(()=>window.store.getState().captureNotice);
  assert.equal(missingAckNotice,notice,'Missing flush must not replace the known input-gap cause');
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),0);
  await page.evaluate(()=>window.hook.retryRecovery());
  await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
  assert.deepEqual(await page.evaluate(()=>window.inferenceAudio[0]),await page.evaluate(()=>window.expectedPrefix));
  assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),missingAckNotice);
  results.push('Known input interruption survives missing flush acknowledgment and manual Retry retains the exact available prefix.');

  await startRealProcessor({canonical:true,deferCanonical:true});
  await page.evaluate(()=>{window.feedProcessor(512128);});
  try { await page.waitForFunction(()=>Boolean(window.resolveCanonical)); } catch(error) { console.log('GAP_CANONICAL_DIAGNOSTIC',await page.evaluate(()=>({state:window.store.getState(),calls:window.nativeCalls,contexts:window.contexts.map(c=>c.state)}))); throw error; }
  await page.evaluate(()=>window.captureWorklet.processor.process([]));await recovered();
  await page.evaluate(()=>{window.deferCanonical=false;window.resolveCanonical();});
  await page.waitForFunction(()=>window.canonicalReturned);
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['checkpointOwnedPreedit','finishCanonicalOwnedPreedit','commitOwnedPreedit','insertText'].includes(c[0])).length),0);
  assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),1);
  results.push('Active gap invalidates in-flight canonical output without treating uncompleted suffix as delivered; prefix stays recoverable and no automatic next request starts.');
}
await gapCases();
if (!gapOnly) {
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
  await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
  await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
  assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered with bundled NVIDIA.');
  assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/bundled NVIDIA/);
  assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['transcribeAudio','pasteDesktopText'].includes(c[0]))),false);
  assert.equal(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='push').reduce((n,r)=>n+r.audio.length,0)),16000);
  assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/could not be confirmed/);
  results.push(`NVIDIA ${failure} fallback retains source without automatic inference or paste; explicit local recovery never calls Whisper or delivers.`);
}

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.failWorkletModule=true;});
await start(1);await stop();await recovered();
await page.evaluate(()=>{window.deferRecovery=true;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>Boolean(window.resolveRecovery));
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().status==='error' && !window.store.getState().recovery.retrying);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
const firstRecovery=await page.evaluate(()=>window.recoveryRequests[0].session);
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
assert.equal(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='start').length),1);
await page.evaluate(()=>{window.deferRecovery=false;window.failRecovery=true;window.resolveRecovery();});
await page.waitForFunction(()=>window.recoveryRequests.filter(r=>r.op==='start').length===2 && !window.store.getState().recovery.retrying);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
await page.evaluate(()=>{window.failRecovery=false;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.notEqual(await page.evaluate(()=>window.recoveryRequests.filter(r=>r.op==='start').at(-1).session),firstRecovery);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered with bundled NVIDIA.');
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['transcribeAudio','pasteDesktopText'].includes(c[0]))),false);
results.push('NVIDIA recovery cancels promptly, waits for old cleanup, preserves audio through worker failure and succeeds on explicit retry without insertion.');

await load();await page.evaluate(()=>{window.desktopPaste=true;window.desktopStream=true;window.failWorkletModule=true;});
await start(1);await stop();await recovered();
await page.evaluate(()=>{window.deferRecovery=true;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>Boolean(window.resolveRecovery));
await page.evaluate(()=>{window.reactRoot.unmount();window.store.getState().setTranscript('Replacement state');window.deferRecovery=false;window.resolveRecovery();});
await page.waitForFunction(()=>window.recoveryRequests.some(r=>r.op==='cancel'));
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Replacement state');
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='pasteDesktopText')),false);
results.push('Unmount cancels the recovery worker and suppresses a late transcript.');

for (const canonical of [false, true]) {
  await load();
  await page.evaluate(canonical=>{window.failWorkletModule=true;window.captureInferenceAudio=true;window.lease=true;if(canonical) window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});},canonical);
  await start(canonical ? 31 : 1);
  assert.equal(await page.evaluate(()=>Boolean(window.processor?.onaudioprocess)),true);
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['transcribeAudio','transcribeHybridChunk','checkpointOwnedPreedit'].includes(c[0])).length),0,'Unverifiable compatibility capture must defer automatic inference and delivery');
  await stop(); await recovered();
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['transcribeAudio','transcribeHybridChunk','checkpointOwnedPreedit','finishCanonicalOwnedPreedit','commitOwnedPreedit'].includes(c[0])).length),0,'ScriptProcessor stop cannot certify complete capture');
  assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
  assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/end of this recording could not be confirmed/i);
  assert.equal(await page.evaluate(()=>window.processor.onaudioprocess===null && window.processor.disconnected && window.tracks.every(t=>t.readyState==='ended')),true);
  await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
  await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
  // Canonical recovery retains the established one-second overlap: 0..30,29..31.
  assert.deepEqual(await page.evaluate(()=>window.inferenceAudio.map(audio=>audio.length)),canonical ? [480000,32000] : [16000]);
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['checkpointOwnedPreedit','finishCanonicalOwnedPreedit','commitOwnedPreedit'].includes(c[0])).length),0);
  assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/end of this recording could not be confirmed/i);
  results.push(`ScriptProcessor ${canonical ? 'canonical' : 'one-shot'} capture defers automatic output, closes capture on Stop, and preserves all received samples for explicit manual Retry with persistent completeness uncertainty.`);
}
await load();
await page.evaluate(()=>{window.failWorkletModule=true;window.deferLease=true;window.lease=true;});
await start(); await stop();
await page.evaluate(()=>window.resolveLease()); await recovered();
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='cancelOwnedPreedit').length),1);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['transcribeAudio','commitOwnedPreedit'].includes(c[0])).length),0);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
results.push('A target lease arriving after incomplete fallback capture stops is cancelled and cannot publish its received audio.');
await load();
await page.evaluate(()=>{window.failWorkletModule=true;window.lease=true;});
await start(); await page.getByRole('button',{name:'Cancel dictation',exact:true}).click(); await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),0);
await page.getByRole('button',{name:'Discard recovery',exact:true}).click();
await page.evaluate(()=>{window.failWorkletModule=false;});
await start(); await stop();
await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),null);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),1);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='commitOwnedPreedit').length),1);
results.push('Cancel retains fallback audio without automatic output; Discard and a healthy worklet restart restore normal transcription and verified delivery.');
await startWorklet();
await page.evaluate(()=>{window.captureWorklet.port.postMessage=()=>setTimeout(()=>window.captureWorklet.port.onmessage?.({data:{type:'samples',data:new Float32Array(128).fill(.1)}}),10);});
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),0,'An unacknowledged capture tail must not be published as a complete transcription');
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/end of this recording could not be confirmed/i);
assert.equal(await page.evaluate(()=>window.captureWorklet.port.closed && window.tracks.every(t=>t.readyState==='ended')),true);
await page.evaluate(()=>window.hook.retryRecovery());
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/end of this recording could not be confirmed/i);
assert.equal(await page.evaluate(()=>window.inferenceAudio[0].length),16128);
results.push('A missing worklet flush acknowledgment closes capture, retains every received sample without automatic transcription, and preserves tail uncertainty after manual Retry.');
await startWorklet(31, true);
await page.waitForFunction(()=>Boolean(window.resolveCanonical));
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='checkpointOwnedPreedit').length),0);
await page.evaluate(()=>{window.retryPromise=window.hook.retryRecovery();});
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),1);
assert.equal(await page.evaluate(()=>window.store.getState().status),'processing');
await page.evaluate(()=>{window.deferCanonical=false;window.resolveCanonical();});
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['checkpointOwnedPreedit','finishCanonicalOwnedPreedit','commitOwnedPreedit'].includes(c[0])).length),0);
assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/end of this recording could not be confirmed/i);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Completed checkpoint. Recovered tail.');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),2,'Valid late recognition retains its completed prefix; only the tail is decoded during recovery');
results.push('A missing flush ACK invalidates pending canonical output; manual Retry waits for the old request, retains its valid local prefix and all 31 seconds, and never delivers its late result to the target.');
await startWorklet(31, true);
await page.waitForFunction(()=>Boolean(window.resolveCanonical));
await stop(); await recovered();
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.getByText('Waiting for the previous local operation to finish. Cancel dictation stops this wait and keeps your audio; it does not interrupt that operation.',{exact:true}).waitFor();
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().status==='error' && !window.store.getState().recovery.retrying);
const cancelledWaitRecovery = await page.evaluate(()=>JSON.stringify(window.store.getState().recovery));
assert.match(cancelledWaitRecovery,/Recovery cancelled/i);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/end of this recording could not be confirmed/i);
await page.evaluate(()=>{window.deferCanonical=false;window.resolveCanonical();});
await page.waitForFunction(()=>window.canonicalReturned);
await page.waitForTimeout(30);
assert.equal(await page.evaluate(()=>JSON.stringify(window.store.getState().recovery)),cancelledWaitRecovery);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),1);
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Completed checkpoint. Recovered tail.');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['checkpointOwnedPreedit','finishCanonicalOwnedPreedit'].includes(c[0])).length),0);
results.push('Cancel waiting immediately restores recovery; late native completion cannot resume the cancelled Retry, while a later explicit Retry succeeds without target insertion.');
await startWorklet(31, true);
await page.waitForFunction(()=>Boolean(window.resolveCanonical));
await stop(); await recovered();
for(let attempt=0;attempt<2;attempt++) {
  await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
  await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
  await page.waitForFunction(()=>window.store.getState().status==='error');
}
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),1);
await page.getByRole('button',{name:'Discard recovery',exact:true}).click();
await page.evaluate(()=>{window.oldCanonicalResolve=window.resolveCanonical;window.oldCapture=window.captureWorklet;window.deferCanonical=false;window.hook.toggle();});
await page.waitForFunction(()=>window.captureWorklet!==window.oldCapture && Boolean(window.captureWorklet.port.onmessage));
await page.evaluate(()=>window.oldCanonicalResolve());
await page.waitForTimeout(30);
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),null);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),1);
await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:Float32Array.from({length:31*16000},(_,i)=>Math.sin(i/20)*.2)}}));
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length===2);
await page.evaluate(()=>window.reactRoot.unmount());
results.push('Repeated cancelled waits stay behind the same native request; Discard and a new recording invalidate its late completion without suppressing new checkpoints.');
await startWorklet();
await page.evaluate(()=>{window.captureWorklet.port.postMessage=()=>{throw new Error('Synthetic closed port');};});
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.captureWorklet.port.closed && window.captureWorklet.disconnected && window.tracks.every(t=>t.readyState==='ended')),true);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length),0);
results.push('A synchronous flush port failure still releases the graph and retains recovery without inference.');
await startWorklet();
await page.evaluate(()=>{window.captureWorklet.port.postMessage=()=>{
  window.captureWorklet.port.onmessage({data:{type:'samples',data:new Float32Array(128).fill(.1)}});
  window.captureWorklet.port.onmessage({data:{type:'flushed',complete:true}});
};});
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.inferenceAudio[0].length),16128);
assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),null);
results.push('An acknowledged flush includes its final transferred samples in transcription with no uncertainty notice.');
await startWorklet();
await stop();
await page.evaluate(()=>{window.reactRoot.unmount();window.store.getState().setStatus('processing');window.store.getState().setError('Replacement state');});
await page.waitForTimeout(100);
assert.equal(await page.evaluate(()=>window.store.getState().error),'Replacement state');
assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
assert.equal(await page.evaluate(()=>window.captureWorklet.port.closed && window.tracks.every(t=>t.readyState==='ended')),true);
results.push('Unmount cancels a pending flush without reviving old recovery state or leaving capture tracks active.');
await load();
assert.equal(await page.title(),'VOCO recovery verification');
assert(await page.getByText('VOCO', {exact:true}).count()>0);
await start(); await stop(); await recovered();
let calls = await page.evaluate(()=>window.nativeCalls);
assert(!calls.some(c=>c[0]==='insertText'||c[0]==='commitOwnedPreedit'));
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered words for manual review.');
await page.getByRole('button',{name:'Copy transcript',exact:true}).click();
assert.equal(await page.evaluate(()=>window.copiedText),'Recovered words for manual review.');
await page.evaluate(()=>window.hook.toggle());
assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>c[0]==='startOwnedPreedit').length,1);
await screenshot('01-recovered-copy.png');
assert.equal(await page.evaluate(()=>window.store.getState().recovery.kind),'manual-copy');
assert.equal(await page.evaluate(()=>window.store.getState().status),'idle');
assert.equal(await page.evaluate(()=>window.store.getState().error),null);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.targetMayContainText),false);
results.push('Manual one-shot result completes successfully; Copy works; new hotkey cannot replace pending text.');
await page.getByRole('button',{name:'Clear transcript',exact:true}).click();
assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
results.push('Discard explicitly releases recovery and permits another recording.');
await load();
await page.waitForFunction(()=>Boolean(window.shortcutListeners?.['voco:toggle-dictation']));
await page.evaluate(()=>window.shortcutListeners['voco:toggle-dictation']({payload:{triggerId:'browser:a',action:'start'}}));
await page.waitForFunction(()=>window.captureReady());
await page.evaluate(()=>{
  window.samples(1);
  window.shortcutListeners['voco:toggle-dictation']({payload:{triggerId:'browser:a',action:'start'}});
  window.shortcutListeners['voco:toggle-dictation']({payload:{triggerId:'browser:b',action:'stop'}});
});
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>c[0]==='transcribeAudio'));
await page.evaluate(()=>window.shortcutListeners['voco:toggle-dictation']({payload:{triggerId:'browser:a',action:'stop'}}));
await recovered();
assert.notEqual(await page.evaluate(()=>window.store.getState().recovery.kind),'manual-copy');
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='releaseBrowserRecording')), [['releaseBrowserRecording','browser:a']]);
await page.getByRole('button',{name:'Discard recovery',exact:true}).click();
await page.evaluate(()=>window.shortcutListeners['voco:toggle-dictation']({payload:{triggerId:'browser:a',action:'stop'}}));
assert.equal(await page.evaluate(()=>window.store.getState().status),'idle');
assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>c[0]==='startOwnedPreedit').length,1);
const admissionEvents = await page.evaluate(() => window.traceEvents.map(c=>c[0]));
assert.equal(admissionEvents.filter(e=>e==='dictation_trigger_start_admitted').length,1);
assert.equal(admissionEvents.filter(e=>e==='dictation_trigger_stop_admitted').length,1);
assert.equal(admissionEvents.filter(e=>e==='dictation_trigger_start_rejected').length,1);
assert.equal(admissionEvents.filter(e=>e==='dictation_trigger_stop_rejected').length,2);
results.push('Directed browser events preserve action: duplicate starts and foreign stops cannot toggle; a late matching stop cannot start another recording.');
for (const failureStage of ['audio-context', 'microphone-after-claim']) {
  await load();
  await page.evaluate(stage => {
    window.lease = true;
    if (stage === 'audio-context') {
      window.AudioContext = class { constructor() { throw new Error('Synthetic audio context startup failure'); } };
    } else {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic microphone startup failure', 'NotAllowedError'); };
    }
    window.hook.toggle('browser:startup-origin', 'start');
  }, failureStage);
  await page.waitForFunction(()=>window.store.getState().status === 'error');
  const failureCalls = await page.evaluate(()=>window.nativeCalls);
  assert.deepEqual(failureCalls.filter(c=>c[0] === 'releaseBrowserRecording'), [['releaseBrowserRecording','browser:startup-origin']]);
  assert.equal(failureCalls.some(c=>c[0] === 'startOwnedPreedit'), failureStage === 'microphone-after-claim');
  if (failureStage === 'microphone-after-claim') assert(failureCalls.some(c=>c[0] === 'cancelOwnedPreedit'));
  assert(!failureCalls.some(c=>['transcribeAudio','commitOwnedPreedit','insertText'].includes(c[0])));
  await page.evaluate(()=>window.hook.toggle('browser:startup-origin', 'stop'));
  assert.equal(await page.evaluate(()=>window.store.getState().status),'error');
  results.push(`Browser ${failureStage} startup failure releases only its recording origin and cannot make a late stop start recording.`);
}

await load();
await page.evaluate(()=>{
  window.lease = true;
  window.originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = () => new Promise((_, reject)=>window.rejectOldStartup=reject);
  window.oldHook = window.hook;
  window.hook.toggle('browser:old-startup', 'start');
});
await page.waitForFunction(()=>Boolean(window.rejectOldStartup));
await page.evaluate(()=>{
  window.reactRoot.unmount();
  navigator.mediaDevices.getUserMedia = window.originalGetUserMedia;
  window.store.getState().setStatus('idle');
  window.remountHarness();
});
await page.waitForFunction(()=>window.hook !== window.oldHook);
await page.evaluate(()=>window.hook.toggle('browser:new-startup', 'start'));
await page.waitForFunction(()=>window.captureReady());
await page.evaluate(()=>window.rejectOldStartup(new Error('Late old microphone failure')));
await page.waitForTimeout(50);
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0] === 'releaseBrowserRecording')), [['releaseBrowserRecording','browser:old-startup']]);
results.push('A stale startup failure after remount cannot release the replacement browser origin or change its recording state.');
await load();
await page.evaluate(()=>{window.deferInference=true;});
await start(); await stop(); await page.waitForFunction(()=>Boolean(window.resolveInference));
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
assert.equal(await page.evaluate(()=>window.hook.cancellationPending),true);
await page.evaluate(()=>window.resolveInference()); await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
await page.evaluate(()=>{window.deferInference=false;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered words for manual review.');
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['insertText','commitOwnedPreedit'].includes(c[0])));
results.push('Cancel while inference is pending suppresses output; Retry uses retained audio and never delivers to a field.');
await screenshot('02-cancel-retry.png');
const incompleteDecodeMessage = 'Speech recognition did not finish and automatic recovery was unavailable. Please retry the recording.';
await load();
await page.evaluate(message=>{window.failInference=message;window.captureInferenceAudio=true;window.lease=true;},incompleteDecodeMessage);
await start(); await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().status),'error');
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/automatic recovery was unavailable/);
assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>c[0]==='transcribeAudio').length,1);
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['insertText','commitOwnedPreedit','checkpointOwnedPreedit'].includes(c[0])));
// An explicit retry that fails again must retain the identical recording and
// remain recoverable; it must not spin another decode or publish partial text.
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='transcribeAudio').length===2 && !window.store.getState().recovery.retrying);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
assert.deepEqual(await page.evaluate(()=>window.inferenceAudio[1]),await page.evaluate(()=>window.inferenceAudio[0]));
await screenshot('02-incomplete-decoder-recovery.png');
await page.evaluate(()=>{window.failInference=false;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.deepEqual(await page.evaluate(()=>window.inferenceAudio[2]),await page.evaluate(()=>window.inferenceAudio[0]));
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered words for manual review.');
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['insertText','commitOwnedPreedit','checkpointOwnedPreedit'].includes(c[0])));
await page.getByRole('button',{name:'Discard recovery',exact:true}).click();
assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
await start(); await stop();
await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>c[0]==='commitOwnedPreedit').length,1);
results.push('An incomplete native decode retains identical audio across explicit failed/successful retries, publishes no partial text or automatic field edits, and Discard allows a fresh session.');
await load(); await page.evaluate(()=>{window.lease=true;});
await start(); await stop();
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='commitOwnedPreedit') && window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Recovered words for manual review.');
assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>c[0]==='commitOwnedPreedit').length,1);
results.push('A valid original-field lease acknowledges one final commit and completes without recovery.');
await load(); await page.evaluate(()=>{window.lease=true;window.focusChanged=true;});
await start(); await stop(); await recovered();
assert((await page.evaluate(()=>window.nativeCalls)).some(c=>c[0]==='commitOwnedPreedit'));
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>c[0]==='insertText'));
results.push('A field that loses its lease during one-shot finalization fails into recovery with no generic input fallback.');
await load();
await page.evaluate(()=>{
  window.lease=true;window.failCanonicalBeforeDecode=true;
  window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});
});
await start(30);
await page.waitForFunction(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length===1);
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),2,
  'Stop makes one bounded retry of the same unresolved request; there is no automatic retry loop');
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'');
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/Transcription state is unavailable/);
await page.evaluate(()=>{window.failCanonicalBeforeDecode=false;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Completed checkpoint.');
const commandRetryPackets=await page.evaluate(()=>window.hybridPackets.map(packet=>{
  const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength),n=view.getUint32(4,true);
  const metadata=JSON.parse(new TextDecoder().decode(packet.subarray(8,8+n)));
  return {magic:Array.from(packet.subarray(0,4)),metadata,pcm:Array.from(packet.subarray(8+n))};
}));
assert.equal(commandRetryPackets.length,3);
assert.deepEqual(commandRetryPackets.map(p=>p.metadata.requestSequence),[1,2,3]);
for(const packet of commandRetryPackets){
  assert.deepEqual(packet.magic,[86,67,65,50]);
  assert.equal(packet.metadata.plannerSequence,0);
  assert.equal(packet.metadata.previousDecodedEnd,0);
  assert.equal(packet.metadata.nextInputStart,0);
  assert.equal(packet.metadata.previousCanonicalText,'');
  assert.deepEqual(packet.pcm,commandRetryPackets[0].pcm);
  const {requestSequence,...metadata}=packet.metadata;
  const {requestSequence:firstSequence,...firstMetadata}=commandRetryPackets[0].metadata;
  assert.deepEqual(metadata,firstMetadata,'Only the attempt sequence may change on retry');
}
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['insertText','commitOwnedPreedit','checkpointOwnedPreedit','finishCanonicalOwnedPreedit'].includes(c[0])));
results.push('A first VCA2 raw-string command failure retains exact owned PCM and prior metadata across bounded Stop and manual retries; only attempt sequence advances and recovery never types into a target.');
await load(); await page.evaluate(message=>{window.failCanonical=message;window.captureInferenceAudio=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});},incompleteDecodeMessage);
await start(31); await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='transcribeHybridChunk'));
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Completed checkpoint.');
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/automatic recovery was unavailable/);
await page.evaluate(()=>{window.failCanonical=false;});
await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===false);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Completed checkpoint. Recovered tail.');
assert.equal(await page.evaluate(()=>window.store.getState().status),'idle');
assert.equal(await page.evaluate(()=>window.store.getState().error),null);
calls = await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk'));
assert.deepEqual(calls.map(c=>c[2]),['','Completed checkpoint.','Completed checkpoint.']);
assert.deepEqual(await page.evaluate(()=>window.inferenceAudio[2]),await page.evaluate(()=>window.inferenceAudio[1]));
results.push('Canonical tail failure preserves its completed prefix; Retry continues the failed tail without retranscribing or inserting the prefix.');
await screenshot('03-canonical-tail-recovery.png');
await load(); await start(); await page.evaluate(()=>window.tracks.at(-1).dispatchEvent(new Event('ended'))); await recovered();
assert.equal(await page.evaluate(()=>window.tracks.at(-1).readyState),'ended');
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/disconnected/);
results.push('A microphone ended event stops capture and retains the captured audio immediately.');
await load(); await page.evaluate(()=>{window.failSelectedDevice=true;window.store.getState().setSelectedDeviceId('unplugged-id');});
await start();
assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/system default microphone/);
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click(); await recovered();
results.push('Selected-device fallback is visible and Cancel during capture stops tracks.');
await load(); await page.evaluate(()=>{window.lease=true;window.deferCommit=true;});
await start(); await stop(); await page.waitForFunction(()=>Boolean(window.resolveCommit));
await page.evaluate(()=>{window.reactRoot.unmount();window.store.getState().setTranscript('Replacement view');window.store.getState().setStatus('idle');window.resolveCommit();});
await page.waitForFunction(()=>window.commitReturned);
await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Replacement view');
assert.equal(await page.evaluate(()=>window.store.getState().status),'idle');
results.push('A final commit acknowledgement arriving after unmount cannot mutate replacement renderer state.');
await load(); await page.evaluate(()=>{window.lease=true;window.deferCheckpoint=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});});
await start(31); await page.waitForFunction(()=>Boolean(window.resolveCheckpoint));
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
await page.evaluate(()=>window.resolveCheckpoint()); await recovered();
assert.equal(await page.evaluate(()=>window.store.getState().recovery.targetMayContainText),true);
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Completed checkpoint.');
results.push('Cancellation during a pending canonical commit preserves the completed prefix and warns that the target may contain it.');
await load(); await page.evaluate(()=>{window.deferCanonical=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});});
await start(31); await page.waitForFunction(()=>Boolean(window.resolveCanonical));
await page.evaluate(()=>{window.reactRoot.unmount();window.store.getState().setTranscript('Replacement view');window.store.getState().setStatus('idle');window.resolveCanonical();});
await page.waitForFunction(()=>window.canonicalReturned);
await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Replacement view');
assert.equal(await page.evaluate(()=>window.store.getState().status),'idle');
results.push('A canonical transcription completing after unmount cannot repopulate the old session or overwrite replacement state.');
for (const extraSample of [false,true]) {
  await load();
  await page.evaluate(()=>{window.lease=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});});
  await start(30);
  await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='checkpointOwnedPreedit'));
  if(extraSample) await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:new Float32Array([.1])}}));
  await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
  const requests=await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk'));
  assert.deepEqual(requests.map(r=>r[1]),extraSample?[480000,16001]:[480000]);
  if(extraSample){assert.equal(requests[1][3].nextInputStart,464000);assert.equal(requests[1][3].previousDecodedEnd,480000);}
  assert.equal(await page.evaluate(()=>window.store.getState().transcript),extraSample?'Completed checkpoint. Recovered tail.':'Completed checkpoint.');
}
results.push('Exact 30-second stop avoids an overlap-only decode; one new sample retains the required context and complete transcript.');
await load();
await page.evaluate(()=>{
  window.lease=true;window.captureInferenceAudio=true;window.capturePreviewAudio=true;
  window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});
  window.mutateHybridResponse=(r,m)=>{
    if(m.plannerSequence===0){
      Object.assign(r.receipt,{inputEnd:112000,nextInputStart:112000,rightBoundaryMode:'numericalPlateau',plateauStart:0,plateauEnd:224000});
      r.chunkText='';r.appendText='';r.canonicalText='';
    }else{r.chunkText='Retained speech.';r.appendText='Retained speech.';r.canonicalText='Retained speech.';}
  };
  window.hook.toggle();
});
await page.waitForFunction(()=>window.captureReady());
await page.evaluate(()=>{
  const audio=Float32Array.from({length:480000},(_,i)=>i<224000?0:Math.sin((i-224000)/20)*.2);
  window.plateauRaw=audio.slice();
  window.captureWorklet.port.onmessage({data:{type:'samples',data:audio}});
});
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='checkpointOwnedPreedit'));
await page.waitForFunction(()=>window.previewSampleCounts?.includes(320000));
assert.equal(await page.evaluate(()=>{
  // Independently select the retained source interval, then reproduce its
  // unchanged DC-only profile. This detects a correct length at the wrong start.
  const expected=window.plateauRaw.slice(112000,432000);
  let sum=0;for(const value of expected) sum+=value;
  const mean=sum/expected.length;
  if(Math.abs(mean)>=1e-6) for(let i=0;i<expected.length;i++) expected[i]-=mean;
  return window.previewAudio.some(actual=>actual.length===expected.length &&
    actual.every((value,i)=>Object.is(value,expected[i])));
}),true,'Preview must contain the exact retained source interval with its unchanged preparation profile');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk').length),1);
await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
const plateauCalls=await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='transcribeHybridChunk'));
assert.deepEqual(plateauCalls.map(r=>r[1]),[480000,368000]);
assert.equal(plateauCalls[1][3].nextInputStart,112000);
assert.equal(plateauCalls[1][3].previousDecodedEnd,112000);
assert.equal(await page.evaluate(()=>window.inferenceAudio[1].every((value,i)=>
  Object.is(value,window.inferenceAudio[0][112000+i]))),true,'Final tail must reuse exact prepared PCM bytes');
assert.equal(await page.evaluate(()=>window.store.getState().transcript),'Retained speech.');
results.push('A silent 7-second core from a 30-second lookahead leaves a 20-second preview available; Stop decodes the complete retained tail.');
await load(); await page.evaluate(()=>{window.deferMicrophone=true;window.hook.toggle();});
await page.waitForFunction(()=>Boolean(window.resolveMicrophone));
await page.evaluate(()=>{window.reactRoot.unmount();window.store.getState().setCaptureNotice('Replacement view');window.resolveMicrophone();});
await page.waitForFunction(()=>window.tracks.length>0 && window.tracks.every(track=>track.readyState==='ended'));
assert.equal(await page.evaluate(()=>window.store.getState().captureNotice),'Replacement view');
results.push('Microphone permission resolving after unmount closes the late stream and does not alter replacement state.');
await load(); await page.evaluate(async()=>{window.store.getState().setSelectedDeviceId('old-device');await window.hook.primeRecordingStream();window.store.getState().setSelectedDeviceId('new-device');});
await start();
assert.equal(await page.evaluate(()=>window.tracks[0].readyState),'ended');
assert.equal(await page.evaluate(()=>window.requestedMicrophones.at(-1).deviceId.exact),'new-device');
results.push('Changing microphone selection discards an already primed old device and opens the selected one.');
await load(); await page.evaluate(async()=>{window.failSelectedDevice=true;window.store.getState().setSelectedDeviceId('missing-device');await window.hook.primeRecordingStream();});
await start();
assert.match(await page.evaluate(()=>window.store.getState().captureNotice),/system default microphone/);
results.push('A primed default-device fallback remains visible when the recording starts.');
await page.setViewportSize({width:420,height:660});
await load(); await start(); await page.evaluate(()=>window.reactRoot.unmount());
assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
assert.equal(await page.evaluate(()=>window.captureWorklet.port.onmessage),null);
results.push('Unmount stops microphone tracks and disconnects the AudioWorklet callback.');
await load(); await page.evaluate(()=>{window.deferMicrophone=true;window.initialization=window.hook.initializeMicrophone(performance.now());});
await page.waitForFunction(()=>Boolean(window.resolveMicrophone));
await page.evaluate(async()=>{window.reactRoot.unmount();window.store.getState().setStatus('processing');window.store.getState().setError('Replacement state');window.resolveMicrophone();await window.initialization;});
assert.equal(await page.evaluate(()=>window.store.getState().status),'processing');
assert.equal(await page.evaluate(()=>window.store.getState().error),'Replacement state');
assert.equal(await page.evaluate(()=>window.contexts.length),0);
assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
results.push('Late startup permission after unmount releases the probe stream without allocating a new audio engine or overwriting replacement state.');
await load();
await page.evaluate(async()=>{
 window.AudioContext = class extends window.RealAudioContext { constructor(){super({sampleRate:16000});window.contexts.push(this);} };
 const NativeWorklet = window.RealAudioWorkletNode;
 window.AudioWorkletNode = class extends NativeWorklet {constructor(...args){super(...args);window.captureWorklet=this;this.port.addEventListener('message',event=>{if(event.data.type==='samples') window.realPackets=(window.realPackets||0)+1;});}};
 window.generatedContext = new window.RealAudioContext({sampleRate:16000});
 const oscillator = window.generatedContext.createOscillator();
 const destination = window.generatedContext.createMediaStreamDestination();
 oscillator.frequency.value=220;oscillator.connect(destination);oscillator.start();
 await window.generatedContext.resume();
 navigator.mediaDevices.getUserMedia=async()=>{window.tracks.push(...destination.stream.getTracks());return destination.stream;};
 window.hook.toggle();
});
await page.waitForFunction(()=>window.realPackets>=6);
assert.equal(await page.evaluate(()=>Boolean(window.processor)),false);
await stop(); await recovered();
assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
assert.equal(await page.evaluate(()=>window.captureWorklet.port.onmessage),null);
const realCapturedLength = await page.evaluate(()=>window.nativeCalls.find(c=>c[0]==='transcribeAudio')[1]);
assert(realCapturedLength>=12288 && realCapturedLength<16000*5);
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['insertText','commitOwnedPreedit'].includes(c[0])));
await page.evaluate(async()=>{window.reactRoot.unmount();await window.generatedContext.close();});
assert.equal(await page.evaluate(()=>window.contexts.every(c=>c.state==='closed')),true);
results.push('Real Chromium AudioWorklet module, generated MediaStream, graph and transferred samples complete transcription recovery and release tracks, message callbacks and AudioContext without host microphone access.');
await load(); await page.evaluate(()=>{window.deferMicrophone=true;window.initialization=window.hook.initializeMicrophone(performance.now());});
await page.waitForFunction(()=>Boolean(window.resolveMicrophone));
await page.evaluate(()=>{window.deferMicrophone=false;}); await start();
await page.evaluate(async()=>{window.resolveMicrophone();await window.initialization;});
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click(); await recovered();
results.push('A startup permission probe completing after a recording begins cannot reset its visible recording state.');
await load(); await page.evaluate(()=>{window.lease=true;window.hook.toggle('authenticated-trigger-token');});
await page.waitForFunction(()=>window.captureReady());
await page.evaluate(()=>window.samples(1)); await stop();
await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.nativeCalls.find(c=>c[0]==='startOwnedPreedit')[2]),'authenticated-trigger-token');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='startOwnedPreedit').length),1);
results.push('A consuming shortcut trigger token reaches the original-field lease once for its recording.');
await load(); await page.evaluate(()=>{window.deferMicrophone=true;window.hook.toggle();});
await page.waitForFunction(()=>Boolean(window.resolveMicrophone));
await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
await page.evaluate(()=>window.resolveMicrophone());
await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['transcribeAudio','commitOwnedPreedit'].includes(c[0])));
results.push('Cancellation while microphone permission is pending closes the arriving stream without transcription or delivery.');
await load(); await start();
await page.evaluate(()=>{const track=window.tracks.at(-1);track.readyState='ended';track.dispatchEvent(new Event('ended'));});
await recovered();
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/disconnected/);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['transcribeAudio','commitOwnedPreedit'].includes(c[0])));
results.push('DEVICE: ended track retains captured audio without automatic inference or delivery.');
await load(); await start();
await page.evaluate(()=>window.tracks.at(-1).dispatchEvent(new Event('mute')));
await page.clock.fastForward(1000);
await page.evaluate(()=>{window.tracks.at(-1).dispatchEvent(new Event('unmute'));window.samples(1);});
await page.clock.fastForward(2500);
assert.equal(await page.evaluate(()=>window.store.getState().status),'recording');
await stop();await recovered();
results.push('DEVICE: transient mute/unmute remains live with ongoing samples and completes explicit stop.');
await load(); await page.evaluate(()=>{window.deferMicrophone=true;window.hook.toggle();});
await page.waitForFunction(()=>Boolean(window.resolveMicrophone));
await stop();
await page.evaluate(()=>window.resolveMicrophone());
await page.waitForFunction(()=>window.tracks.length>0 && window.tracks.every(t=>t.readyState==='ended'));
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['transcribeAudio','commitOwnedPreedit'].includes(c[0])));
results.push('DEVICE: user stop during delayed permission closes arriving stream without output.');
await load(); await start(601);
await recovered();
assert.equal(await page.evaluate(()=>window.nativeCalls.find(c=>c[0]==='transcribeAudio')[1]),16000*600);
assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
results.push('A capture block that crosses the maximum duration stops automatically and never sends samples beyond the 600-second bound to recognition.');
await load(); await page.clock.install(); await start();
await page.clock.fastForward(5250); await recovered();
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/stopped responding/);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>['transcribeAudio','commitOwnedPreedit'].includes(c[0])));
results.push('A stopped audio callback is detected without another sample: tracks close and captured audio stays available without automatic output.');
await load(); await start();
await page.evaluate(()=>window.tracks.at(-1).dispatchEvent(new Event('mute')));
await page.clock.fastForward(3250); await recovered();
assert.match(await page.evaluate(()=>window.store.getState().recovery.reason),/muted by the system/);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),true);
results.push('Sustained system mute interrupts the rendered recording and retains its audio for explicit recovery.');
await load();
await page.waitForFunction(()=>Object.keys(window.shortcutListeners||{}).length===1);
assert(!(await page.evaluate(()=>window.nativeCalls)).some(c=>c[0]==='refreshShortcutHeartbeat' && c[1]));
await page.evaluate(()=>{window.shortcutReady=true;window.store.getState().setCaptureNotice('Ready for shortcut');});
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='refreshShortcutHeartbeat' && c[1]));
await page.clock.runFor(2100);
assert((await page.evaluate(()=>window.nativeCalls)).filter(c=>c[0]==='refreshShortcutHeartbeat' && c[1]).length>=3);
await page.evaluate(()=>window.shortcutListeners['voco:toggle-dictation']({payload:{triggerId:'event-trigger-token'}}));
await page.waitForFunction(()=>window.nativeCalls.some(c=>c[0]==='startOwnedPreedit'));
assert.equal(await page.evaluate(()=>window.nativeCalls.find(c=>c[0]==='startOwnedPreedit')[2]),'event-trigger-token');
await page.evaluate(()=>window.reactRoot.unmount());
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='refreshShortcutHeartbeat').at(-1)[1]),false);
const heartbeatCount = await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='refreshShortcutHeartbeat').length);
await page.clock.runFor(2100);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='refreshShortcutHeartbeat').length),heartbeatCount);
assert.equal(await page.evaluate(()=>Object.keys(window.shortcutListeners).length),0);
results.push('The shortcut event forwards its trigger token; readiness refreshes while mounted and stops with a false heartbeat and listener cleanup on unmount.');
}
// Native paste is a final dispatch, never a claimed exact-field receipt.
await load();
await page.evaluate(()=>{window.desktopPaste=true;window.store.getState().setConfig({...window.store.getState().config,liveCursorMode:'stable-cursor-streaming'});});
await start();await stop();await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),1);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>['startOwnedPreedit','previewTranscribeAudio','transcribeHybridChunk'].includes(c[0])).length),0);
assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
assert.equal(await page.evaluate(()=>window.traceEvents.some(c=>c[0]==='dictation_desktop_paste_dispatched')),true);
assert.equal(await page.evaluate(()=>window.traceEvents.some(c=>c[0]==='dictation_final_output_completed')),false);
results.push('Desktop paste dispatches the final text once, skips preview/cursor lease work and does not claim an editor receipt.');
await load();await page.evaluate(()=>{window.desktopPaste=true;window.pasteUnavailable=true;});
await page.evaluate(()=>window.hook.toggle());await page.waitForFunction(()=>window.store.getState().status==='error');
assert.equal(await page.evaluate(()=>window.tracks.length),0);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='pasteDesktopText')),false);
results.push('Unavailable desktop paste fails preflight before requesting the microphone.');
await load();await page.evaluate(()=>{window.desktopPaste=true;window.failPaste=true;});
await start();await stop();await page.waitForFunction(()=>window.store.getState().status==='error');
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),1);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.targetMayContainText),true);
assert.equal(await page.evaluate(()=>window.store.getState().recovery.audioAvailable),false);
results.push('An uncertain desktop paste retains recovery, marks possible target text and is never retried.');
await load();await page.evaluate(()=>{window.desktopPaste=true;window.deferInference=true;});
await start();await stop();await page.waitForFunction(()=>Boolean(window.resolveInference));
await page.evaluate(()=>window.hook.cancelRecording());await page.evaluate(()=>window.resolveInference());
await page.waitForTimeout(50);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>c[0]==='pasteDesktopText')),false);
results.push('Cancellation during inference suppresses a late desktop paste.');

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
results.push('Uncertain progressive paste retains text/audio and never sends queued phrases or a final duplicate.');
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
await page.waitForFunction(()=>window.benchmarkAudioSamples===32320);
assert.equal(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').length),0);
await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.deepEqual(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='push').flatMap(r=>r.audio)),await page.evaluate(()=>window.expectedStreamAudio));
assert.deepEqual(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='push').map(r=>r.audio.length)),[...Array(101).fill(320),1]);
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').map(c=>c[1])),['Exact captured samples.']);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
results.push('Irregular callbacks retain every speech and silence sample in 20 ms packets, flush the one-sample tail exactly once, and deliver only the final recognized text.');

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
await page.waitForFunction(()=>window.benchmarkAudioSamples===24640);
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
// 21-second backlog intentionally rejected by the three-second queue bound.
for(let second=1;second<=21;second++) {
 await page.evaluate(()=>window.samples(1));
 await page.waitForFunction(samples=>window.benchmarkAudioSamples===samples,second*16000);
}
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='push').length),1050);
assert.equal(await page.evaluate(()=>window.benchmarkRequests.some(r=>r.op==='diagnostic')),false);
assert.equal(await page.evaluate(()=>window.nativeCalls.some(c=>['previewTranscribeAudio','transcribeAudio'].includes(c[0]))),false);
await stop(); await page.waitForFunction(()=>window.store.getState().status==='idle');
assert.equal(await page.evaluate(()=>window.benchmarkRequests.filter(r=>r.op==='finish').length),1);
assert.deepEqual(await page.evaluate(()=>window.nativeCalls.filter(c=>c[0]==='pasteDesktopText').map(c=>c[1])),['Long stream completed.']);
results.push('A stream exceeding 20 seconds maintains sequenced 20 ms IPC packets, avoids whole-history decoding and finishes once after all captured audio.');

if (evidence) await writeFile(path.join(evidence,'diagnostics.json'),JSON.stringify({results,errors,consoleMessages},null,2));
assert.equal(consoleMessages.filter(message=>message.startsWith('Canonical cursor checkpoint deferred until stop: Error: no canonical transcription is in flight')).length,0, 'Output cancellation must not invalidate an otherwise valid local recognition receipt');
const expectedInjectedWarnings = [
  'Canonical cursor checkpoint deferred until stop: Error: The microphone stopped providing input during this recording. Retrying can transcribe only the audio received before the interruption.',
  'Canonical cursor checkpoint deferred until stop: Transcription state is unavailable',
  'Canonical cursor checkpoint deferred until stop: Error: The end of this recording could not be confirmed. Retrying can transcribe only the audio received.',
  'Owned cursor final commit failed: Error: Original field lost focus',
  'Canonical cursor checkpoint deferred until stop: Error: Recording cancelled.',
  'Canonical cursor checkpoint deferred until stop: Error: canonical cursor session changed during transcription',
];
const unexpectedConsoleMessages = consoleMessages.filter(message => !expectedInjectedWarnings.some(prefix=>message.startsWith(prefix)));
if (evidence) await writeFile(path.join(evidence,'results.json'), JSON.stringify({passed:errors.length===0 && unexpectedConsoleMessages.length===0,url:origin+'/recovery-check',viewports:[{width:420,height:660},{width:460,height:196}],browser:gapOnly?'Chromium headless; actual hook/store/components; real processor body bridged through queued transferred messages; mocked AudioContext/native decoder, no actual AudioWorklet graph':'Chromium headless; real React StrictMode, hook, store and components; explicit native/clipboard mocks; bridged-processor gap cases plus actual AudioWorklet generated-stream graph',results,errors,consoleMessages,unexpectedConsoleMessages},null,2));
assert.deepEqual(errors,[]);
assert.deepEqual(unexpectedConsoleMessages, [], 'Unexpected renderer warning/error output');
console.log(JSON.stringify({results,errors,evidence},null,2));
} finally {
  await Promise.allSettled([browser?.close(), server?.close()]);
}
