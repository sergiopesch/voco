import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Actual App, hooks, store and ControlPanel; every native/media boundary is mocked.
// These checks never request host microphone access or model inference.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.VOCO_RENDERER_EVIDENCE_DIR;
if (!out)
    throw Error('Exclusive VOCO_RENDERER_EVIDENCE_DIR required');
await mkdir(out, {
    recursive: false
});
await writeFile(path.join(out, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)), {
    flag: 'wx'
});
// Mirror the production entry point's CSS imports, including its packaged fonts.
const mainEntry = await readFile(path.join(root, 'apps/desktop/src/main.tsx'), 'utf8');
const pageShell = await readFile(path.join(root, 'apps/desktop/index.html'), 'utf8');
assert.equal(pageShell.match(/<script type="module" src="\/src\/main\.tsx"><\/script>/g)?.length, 1);
const styleSpecifiers = [...mainEntry.matchAll(/import\s+["']([^"']+\.css)["'];/g)].map(match => match[1]);
assert.ok(styleSpecifiers.includes('./styles.css') && styleSpecifiers.some(name => name.startsWith('@fontsource/geist/')));
const styleBindings = {};
for (const name of styleSpecifiers) {
    const file = name.startsWith('./') ? path.join(root, 'apps/desktop/src', name) : path.join(root, 'node_modules', name);
    styleBindings[name] = { path: await realpath(file), sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
}
// This HTML is intercepted after Vite's HTML import rewriting. Request CSS as
// stylesheets so the browser does not attempt to execute raw CSS as JavaScript.
const styleLinks = Object.values(styleBindings).map(binding => `<link rel="stylesheet" href="${encodeURI('/@fs' + binding.path)}?direct">`).join('\n');
await writeFile(path.join(out, 'STYLE-SOURCE.json'), JSON.stringify({ mainSha256: createHash('sha256').update(mainEntry).digest('hex'), imports: styleBindings }, null, 2) + '\n', { flag: 'wx' });
const results = [], errors = [], consoleWarnings = [];
let server, browser, page;
const save = (n, v) => writeFile(path.join(out, n), JSON.stringify(v, null, 2) + '\n', {
    flag: 'wx'
});
const files = [
    'src/main.tsx', 'src/styles.css', 'src/lib/shortcutPresentation.ts', 'src/lib/windowRemap.ts', 'src/types/index.ts', 'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/components/Onboarding.tsx', 'src/lib/dictationRecording.ts', 'src/lib/benchmarkPhraseQueue.ts', 'src/lib/microphoneRefresh.ts', 'src/lib/audioInput.ts', 'src/store/useStore.ts', 'src/lib/nativeCapture.ts', 'src/lib/nativeCaptureAudit.ts', 'src/lib/captureDescriptor.ts', 'src/lib/tauri.ts', 'src/lib/nativeCaptureSettings.ts', 'src/hooks/useNativeCaptureSettings.ts', 'src/components/NativeMicrophoneSettings.tsx', 'src/hooks/useDictation.ts'
];
await save('SOURCE.json', Object.fromEntries(await Promise.all(files.map(async (f) => [
    f, createHash('sha256').update(await readFile(path.join(root, 'apps/desktop', f))).digest('hex')
]))));
try {
    server = await createServer({
        configFile: path.join(root, 'apps/desktop/vite.config.ts'),
        root: path.join(root, 'apps/desktop'),
        logLevel: 'warn',
        server: {
            host: '127.0.0.1',
            port: 0,
            hmr: false,
            fs: {
                allow: [
                    root, await realpath(path.join(root, 'node_modules'))
                ]
            }
        }
    });
    await server.listen();
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({
        headless: true
    });
    const context = await browser.newContext({
        viewport: {
            width: 1100,
            height: 800
        }
    });
    await context.grantPermissions([
        'local-network-access'
    ], {
        origin
    });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleWarnings.push({ type: message.type(), text: message.text() }); });
    const tauri = await readFile(path.join(root, 'apps/desktop/src/lib/tauri.ts'), 'utf8');
    const names = [
        ...tauri.matchAll(/export (?:async )?function (\w+)/g)
    ].map(x => x[1]);
    const native = names.map(n => `export const ${n} = async (...args) => window.nativeCall(${JSON.stringify(n)},args);`).join('\n');
    await page.route('**/src/lib/tauri.ts*', r => r.fulfill({
        contentType: 'application/javascript',
        body: native
    }));
    await page.route('**/@tauri-apps_api_core.js*', r => r.fulfill({contentType:'application/javascript',body:'export const invoke=(name,args)=>window.nativeInvoke(name,args); export class Channel {}'}));
    await page.route('**/@tauri-apps_api_app.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: 'export const getVersion=async()=>"2026.0.21";'
    }));
    await page.route('**/@tauri-apps_api_window.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: `
          const windowHandle = new Proxy({}, {
            get: (_, name) => {
              if (name === 'listen') return async (event, callback) => {
                window.listeners[event] = callback;
                return () => delete window.listeners[event];
              };
              if (name === 'onFocusChanged') return async callback => {
                window.focusListeners.add(callback);
                return () => window.focusListeners.delete(callback);
              };
              if (name.startsWith('on')) return async () => () => {};
              if (name === 'scaleFactor') return async () => 1;
              if (name === 'isFocused') return async () => {
                if (window.deferFocusRead) return new Promise(resolve => window.focusReads.push(resolve));
                return window.focused;
              };
              return async () => {};
            }
          });
          export const getCurrentWindow = () => windowHandle;
          export const currentMonitor = async () => null;
          export const availableMonitors = async () => [];
        `
    }));
    await page.route('https://api.github.com/**', r => r.fulfill({
        json: []
    }));
    await page.route('**/app-microphone-check*', r => r.fulfill({
        contentType: 'text/html',
        body: `
          ${pageShell.split('<script type="module" src="/src/main.tsx"></script>')[0]}
          ${styleLinks}
          <script type="module">
            import React from '/node_modules/.vite/deps/react.js';
            import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
            import { App } from '/src/App.tsx';
            import { useStore } from '/src/store/useStore.ts';
            window.store = useStore;
            window.reactRoot = ReactDOM.createRoot(document.getElementById('root'));
            window.reactRoot.render(React.createElement(App));
          </script>
          ${pageShell.split('<script type="module" src="/src/main.tsx"></script>')[1]}
        `
    }));
    // Install deterministic device, permission and audio mocks before App imports.
    await page.addInitScript(() => {
        window.listeners = {};
        window.focusListeners = new Set();
        window.focusReads = [];
        window.focused = true;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => {
                if (window.failClipboard) throw Error('Fixture clipboard unavailable');
                window.copiedText = text;
            }
        } });
        window.calls = [];
        window.tracks = [];
        window.enums = [];
        window.probes = [];
        window.deferEnums = false;
        window.deferProbe = false;
        window.permissionMode = 'missing';
        window.contexts = [];
        window.pendingResumes = [];
        window.resumeMode = 'normal';
        window.config = {
            hotkey: 'Alt+D',
            selectedMic: null,
            insertionStrategy: 'auto',
            transcriptTarget: 'cursor',
            liveCursorMode: 'final-text-only',
            openclawAgent: 'main',
            openclawPromptPrefix: '',
            transcriptEnhancement: 'off',
            localLlmEndpoint: 'http://127.0.0.1:8080/v1/chat/completions',
            localLlmModel: null,
            onboardingCompleted: false,
            updateChannel: 'stable',
            installChannel: 'github-release',
            voiceProfile: 'default'
        };
        window.nativeCommands=[];window.auditUploads=[];
        window.captureScenario=new URL(location.href).searchParams.get('scenario')||'enabled';
        window.source={selectionToken:'token-1',name:'fixture-source',label:'Public fixture source',index:62,objectSerial:'62',isMonitor:false};
        window.catalog={revision:'r1',sources:[window.source],defaultSelectionToken:'token-1'};
        window.nativeInvoke=async(name,args)=>{
          window.nativeCommands.push({name,args});
          if(name==='benchmark_stream' && window.onboardingFixture) {
            const r=args.request;
            if(['quality','diagnostic','cancel'].includes(r.op))return {};
            if(window.recognitionError)throw {message:'Speech engine unavailable for this test.'};
            return {...r,mode:'append-only',text:r.op==='start'?null:window.silentFixture?'':r.op==='finish'?'This is my voice test.':'This is my voice test'};
          }
          if(name==='native_capture_capabilities') {
            if(window.captureScenario==='pending') return new Promise(resolve=>window.resolveCapability=resolve);
            if(window.captureScenario==='error') throw Error('Capability unavailable');
            return {enabled:window.captureScenario!=='off'};
          }
          if(name==='native_capture_list_sources') {if(window.catalogError)throw Error(window.catalogError);return window.catalog;}
          if(name==='native_capture_select_source') {if(window.selectError)throw {message:window.selectError};return window.source;}
          if(name==='native_capture_begin') {
            if(window.deferBegin) await new Promise((resolve,reject)=>{window.rejectBegin=reject;});
            if(!window.allowBegin)throw Error('Native source unavailable');
            window.captureIdentity={captureId:'capture-'+args.request.sessionId,sessionId:args.request.sessionId,generation:args.request.generation};window.stopped=false;window.ack=0;
            return {...window.captureIdentity,source:window.source,format:'s16le',sampleRate:44100,channels:2,channelMap:['front-left','front-right'],frameBytes:4,maxFrames:26460000};
          }
          const receipt=()=>({state:window.stopped?'stopped':'stopping',producedFrames:35280,lastSequence:4,corkAcknowledged:window.stopped,barrierAcknowledged:window.stopped,limitReached:false,acknowledgedSequence:window.ack||0,health:{healthy:!window.unhealthy,reason:window.unhealthy?'Fixture transport interrupted':null}});
          if(name==='native_capture_stop'){window.stopped=true;return receipt();}
          if(name==='native_capture_drain'){
            window.ack=args.request.ackThroughSequence;
            const blocks=window.ack===0?Array.from({length:4},(_,i)=>({sequence:i+1,frameStart:i*8820,frames:8820,byteOffset:i*35280,byteLength:35280})):[];
            const meta=new TextEncoder().encode(JSON.stringify({version:1,...window.captureIdentity,blocks,receipt:receipt()}));
            const bytes=new Uint8Array(4+meta.length+blocks.length*35280);const view=new DataView(bytes.buffer);view.setUint32(0,meta.length,true);bytes.set(meta,4);
            for(let i=4+meta.length;i<bytes.length;i+=2)view.setInt16(i,Math.round(Math.sin(i/18)*8000)+(window.auditEnabled?4000:0),true);
            if(blocks.length)window.issuedFixturePcm=bytes.slice(4+meta.length);
            return bytes.buffer;
          }
          if(name==='native_capture_cancel')return null;
          throw Error('Unexpected native capture call '+name);
        };
        window.nativeCall = async (name, args) => {
            window.calls.push([
                name, ...args
            ]);
            if(name==='debugNativeCaptureEnabled')return window.auditEnabled===true&&window.auditUploads.length===0;
            if(name==='saveDebugNativeRetainedSource'){
                if(!window.stopped||window.ack!==4)throw Error('Retained-source export preceded terminal ACK');
                window.auditUploads.push(new Uint8Array(args[0]));
                return '/mock-private-renderer/COMMIT.json';
            }
            if(name==='transcribeAudio') {if(window.transcriptionError)throw Error('Fixture recognition failure');return 'Fixture transcript';}
            if (name === 'getConfig')
                return {
                    revision: 1,
                    config: window.config
                };
            if (name === 'getRuntimeDiagnostics')
                return {
                    sessionType: 'wayland',
                    typeSimulation: {
                        available: true,
                        missingCommands: [],
                        optionalMissingCommands: []
                    },
                    clipboard: {
                        available: true,
                        missingCommands: []
                    },
                    ownedPreedit: {
                        setupState: 'ready',
                        available: true
                    }
                };
            if (name === 'beginRuntimeStatusSession')
                return 1;
            if (name === 'loadCachedUpdateState')
                return null;
            if (name === 'createRealtimeClientSecret')
                return new Promise(() => {
                });
            return false;
        };
        const media = new EventTarget();
        media.enumerateDevices = () => {
            window.enumCount = (window.enumCount || 0) + 1;
            return window.deferEnums ? new Promise(resolve => window.enums.push(resolve)) : Promise.resolve([
                {
                    kind: 'audioinput',
                    deviceId: window.enumDevice || 'mic-a',
                    label: 'Mic A'
                }
            ]);
        };
        const stream = () => {
            const track = new EventTarget();
            track.readyState = 'live';
            track.stop = () => {
                track.readyState = 'ended';
                track.stops = (track.stops || 0) + 1;
            };
            window.tracks.push(track);
            return {
                getTracks: () => [
                    track
                ],
                getAudioTracks: () => [
                    track
                ]
            };
        };
        media.getUserMedia = async () => {
            window.streamRequests = (window.streamRequests || 0) + 1;
            if (window.failNextStream) {
                window.failNextStream = false;
                throw new DOMException("Initial preview failure", "NotReadableError");
            }
            if (window.deferProbe)
                return new Promise((resolve, reject) => window.probes.push({
                    resolve: () => resolve(stream()),
                    reject
                }));
            return stream();
        };
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: media
        });
        window.setPermission = mode => {
            window.permissionMode = mode;
            Object.defineProperty(navigator, 'permissions', {
                configurable: true,
                value: mode === 'missing' ? undefined : {
                    query: () => {
                        if (mode === 'pending')
                            return new Promise(resolve => window.resolvePermission = resolve);
                        if (mode === 'throw')
                            throw Error('unsupported');
                        if (mode === 'reject')
                            return Promise.reject(Error('unsupported'));
                        return Promise.resolve({
                            state: mode
                        });
                    }
                }
            });
        };
        window.setPermission('missing');
        class Node {
            connect() { return this;
            }
            disconnect() { return this;
            }
        }
        window.AudioWorkletNode = class extends Node {
          constructor() {
            super(); window.captureWorklet = this;
            this.port = {onmessage:null,postMessage:()=>queueMicrotask(()=>this.port.onmessage?.({data:{type:'flushed',complete:true}})),close(){}};
          }
        };
        window.AudioContext = class {
            constructor() { window.contexts.push(this); }
            sourceConnections = 0;
            resumeCalls = 0;
            closeCalls = 0;
            state = 'suspended';
            sampleRate = 16000;
            destination = {};
            audioWorklet = {
                addModule: async () => { window.workletLoads=(window.workletLoads||0)+1;
                }
            };
            resume() {
                this.resumeCalls += 1;
                if (window.resumeMode === 'reject') return Promise.reject(new Error('Preview resume rejected'));
                if (window.resumeMode === 'pending') return new Promise((resolve, reject) => {
                    window.pendingResumes.push({
                        context: this,
                        resolve: () => { if (this.state !== 'closed') this.state = 'running'; resolve(); },
                        reject,
                    });
                });
                if (window.resumeMode !== 'stays-suspended') this.state = 'running';
                return Promise.resolve();
            }
            close() {
                this.closeCalls += 1;
                this.state = 'closed';
                return Promise.resolve();
            }
            currentTime = 0;
            createOscillator() {
                const node = Object.assign(new Node(), { frequency: { value: 0 }, start() { window.speakerTests = (window.speakerTests || 0) + 1; }, stop() { queueMicrotask(() => node.onended?.()); } });
                return node;
            }
            createGain() { return Object.assign(new Node(), { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } }); }
            createMediaStreamSource() {
                this.sourceConnections += 1;
                return new Node();
            }
            createAnalyser() {
                return Object.assign(new Node(), {
                    fftSize: 512,
                    getFloatTimeDomainData: a => {
                        for (let i = 0; i < a.length; i++)
                            a[i] = this.state === 'running' ? Math.sin(i / 8) * .2 : 0;
                    }
                });
            }
        };
    });
    const captureStyledPanel = async (name, target, viewport) => {
      await page.evaluate(async () => {
        await document.fonts.load('400 14px Geist');
        await document.fonts.load('400 14px "Geist Mono"');
        await document.fonts.ready;
      });
      assert.equal(await page.title(), 'VOCO');
      assert.equal(new URL(page.url()).origin, origin);
      assert.equal(new URL(page.url()).pathname, '/app-microphone-check');
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      await page.screenshot({ path: path.join(out, name + '-first-viewport.png') });
      await target.scrollIntoViewIfNeeded();
      const proof = await target.evaluate((element) => {
        const shell = document.querySelector('.voco-panel__shell');
        const style = getComputedStyle(shell);
        const rect = element.getBoundingClientRect();
        const shellRect = shell.getBoundingClientRect();
        const visible = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          fontFamily: getComputedStyle(document.body).fontFamily,
          fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => ({ family: font.family, status: font.status })),
          accent: getComputedStyle(document.documentElement).getPropertyValue('--voco-accent').trim(),
          display: style.display, backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor, radius: style.borderRadius,
          shell: { x: shellRect.x, y: shellRect.y, width: shellRect.width, height: shellRect.height },
          target: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: element.textContent, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight },
          unobstructed: visible === element || element.contains(visible),
          surface: document.querySelector('.voco-panel').dataset.surface,
        };
      });
      assert.ok(proof.fontFamily.includes('Geist'));
      assert.ok(proof.fonts.some(font => font.family.replaceAll('"', '') === 'Geist'));
      assert.ok(proof.fonts.some(font => font.family.replaceAll('"', '') === 'Geist Mono'));
      assert.equal(proof.accent, '#9ea4af');
      assert.equal(proof.display, 'grid');
      assert.ok(parseFloat(proof.radius) > 0);
      assert.ok(proof.backgroundImage !== 'none' || !['transparent', 'rgba(0, 0, 0, 0)'].includes(proof.backgroundColor));
      for (const box of [proof.shell, proof.target]) {
        assert.ok(box.width > 0 && box.height > 0 && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));
      }
      assert.ok(proof.unobstructed, 'Target is covered by another element');
      assert.ok(proof.target.scrollWidth <= proof.target.clientWidth + 1 && proof.target.scrollHeight <= proof.target.clientHeight + 1, 'Target text is internally clipped');
      const png = await page.screenshot({ path: path.join(out, name + '.png') });
      const pixels = await page.evaluate(async (encoded) => {
        const data = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set(); let opaque = 0;
        for (let i = 0; i < rgba.length; i += 4) { if (rgba[i + 3] > 0) opaque++; colors.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]},${rgba[i + 3]}`); }
        return { width: canvas.width, height: canvas.height, distinctColors: colors.size, opaquePixels: opaque };
      }, png.toString('base64'));
      assert.equal(pixels.width, viewport.width); assert.equal(pixels.height, viewport.height);
      assert.ok(pixels.distinctColors > 32 && pixels.opaquePixels > pixels.width * pixels.height / 2, 'Blank screenshot');
      await save(name + '.json', { ...proof, url: page.url(), title: await page.title(), pixels, screenshotSha256: createHash('sha256').update(png).digest('hex'), mockedPlatform: true });
    };
    if (process.env.VOCO_RENDERER_SUITE === 'onboarding') {
      const loadTest = async (scenario = 'enabled') => {
        await page.goto(origin + '/app-microphone-check?scenario=' + scenario);
        await page.waitForFunction(mode => window.store?.getState().captureBackendMode === mode, scenario === 'off' ? 'webkit' : 'native');
        await page.evaluate(() => {
          window.onboardingFixture = true; window.allowBegin = true;
          const previous = window.nativeCall;
          window.nativeCall = async (name,args) => {
            if (name === 'saveConfigPatch') {
              window.calls.push([name,...args]);
              Object.assign(window.config,args[0]);
              return {revision:2,config:window.config};
            }
            if (name === 'getDesktopPasteStatus') {
              window.calls.push([name,...args]);
              return {enabled:true,available:false,targetToken:null,detail:'Click in a text field, then press your dictation shortcut to start.'};
            }
            return previous(name,args);
          };
        });
        await page.getByRole('button',{name:'Start Test',exact:true}).waitFor();
      };
      const noOutput = async () => {
        const calls = await page.evaluate(() => window.calls.map(c=>c[0]));
        assert.ok(!calls.includes('pasteDesktopText'));
        assert.ok(!calls.includes('insertText'));
        assert.ok(!calls.includes('beginDesktopShortcutSession'));
        assert.ok(!calls.includes('startOwnedPreedit'));
        assert.equal(await page.evaluate(() => window.copiedText),undefined);
        assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='benchmark_stream'&&c.args.request.op==='quality')),false);
      };
      for (const scenario of ['onboarding-toggle', 'dictation-toggle', 'dictation-stop', 'browser-stop']) {
        await loadTest();
        await page.evaluate(scenario => {
          const previous = window.nativeInvoke;
          window.nativeInvoke = async (name,args) => {
            if (name === 'native_capture_select_source') {
              await new Promise(resolve => { window.finishSelection = resolve; });
            }
            return previous(name,args);
          };
          if (scenario !== 'onboarding-toggle') window.store.getState().setSurface('hidden');
        }, scenario);
        if (scenario === 'onboarding-toggle') {
          await page.getByRole('button',{name:'Start Test',exact:true}).click();
        } else {
          await page.evaluate(scenario => window.listeners['voco:toggle-dictation']({payload:
            scenario === 'browser-stop' ? {triggerId:'browser:pending-test',action:'start'} : null}), scenario);
        }
        await page.waitForFunction(()=>Boolean(window.finishSelection));
        await page.evaluate(scenario => {
          window.listeners['voco:toggle-dictation']({payload: scenario.endsWith('-stop') ? {action:'stop'} : null});
          window.finishSelection();
        }, scenario);
        await page.waitForFunction(()=>window.store.getState().nativeCaptureSource!==null);
        // Allow the original async handler and any incorrectly admitted start to settle.
        await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
        assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='native_capture_begin')),false,scenario);
        assert.equal(await page.evaluate(()=>window.calls.some(c=>c[0]==='getDesktopPasteStatus')),false,scenario);
        assert.equal(await page.evaluate(()=>window.store.getState().status),'idle',scenario);
        if (scenario === 'onboarding-toggle') assert.equal(await page.evaluate(()=>window.store.getState().surface),'onboarding');
        if (scenario === 'browser-stop') assert.ok(await page.evaluate(()=>window.calls.some(c=>c[0]==='releaseBrowserRecording'&&c[1]==='browser:pending-test')));
        await noOutput();
        results.push({case:scenario+'-cancels-pending-microphone-setup',passed:true});
      }
      await loadTest();
      assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='native_capture_begin')),false);
      assert.equal(await page.getByRole('button',{name:'Finish Onboarding'}).isDisabled(),true);
      await page.getByRole('button',{name:'Test speaker',exact:true}).click();
      await page.waitForFunction(()=>window.speakerTests===1 && window.contexts.every(c=>c.state==='closed'));
      assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='native_capture_begin')),false);
      await page.evaluate(()=>window.store.getState().setNativeCaptureSource({...window.source,selectionToken:'previous-device'}));
      await captureStyledPanel('onboarding-idle',page.getByRole('button',{name:'Start Test',exact:true}),{width:1100,height:800});
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.getByRole('region',{name:'Test transcript'}).getByText('This is my voice test',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.config.onboardingCompleted),false);
      assert.equal(await page.evaluate(()=>window.store.getState().surface),'onboarding');
      assert.equal(await page.evaluate(()=>window.nativeCommands.filter(c=>c.name==='native_capture_select_source').length),1);
      assert.ok(Number(await page.getByRole('meter',{name:'Microphone signal'}).getAttribute('aria-valuenow'))>0);
      await noOutput();
      await captureStyledPanel('onboarding-listening',page.getByRole('button',{name:'Stop Test',exact:true}),{width:1100,height:800});
      await page.getByRole('button',{name:'Stop Test',exact:true}).click();
      await page.waitForFunction(()=>window.store.getState().onboardingTestPassed);
      assert.equal(await page.getByRole('region',{name:'Test transcript'}).innerText(),'This is my voice test.');
      assert.equal(await page.evaluate(()=>window.stopped&&window.ack===4),true);
      assert.equal(await page.evaluate(()=>window.config.onboardingCompleted),false);
      await noOutput();
      await captureStyledPanel('onboarding-complete-test',page.getByRole('button',{name:'Finish Onboarding'}),{width:1100,height:800});
      await page.setViewportSize({width:760,height:560});
      await captureStyledPanel('onboarding-minimum-window',page.getByRole('button',{name:'Finish Onboarding'}),{width:760,height:560});
      await page.getByRole('button',{name:'Finish Onboarding'}).click();
      await page.waitForFunction(()=>window.config.onboardingCompleted&&window.store.getState().surface==='hidden');
      results.push({case:'default-microphone-live-meter-transcript-stop-finish-no-external-output',passed:true});
      await page.setViewportSize({width:1100,height:800});
      await loadTest();
      await page.evaluate(()=>window.silentFixture=true);
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.waitForFunction(()=>window.ack===4);
      await page.getByRole('button',{name:'Stop Test',exact:true}).click();
      await page.waitForFunction(()=>window.store.getState().status==='idle');
      assert.equal(await page.getByRole('button',{name:'Finish Onboarding'}).isDisabled(),true);
      await page.getByText('No speech was recognized.',{exact:false}).waitFor();
      await noOutput();
      results.push({case:'silence-does-not-complete-onboarding',passed:true});
      await loadTest();
      await page.evaluate(()=>window.selectError='Microphone permission denied');
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.getByText('Microphone permission denied',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='native_capture_begin')),false);
      assert.equal(await page.getByRole('button',{name:'Finish Onboarding'}).isDisabled(),true);
      results.push({case:'denied-access-does-not-record-or-complete',passed:true});
      await page.evaluate(()=>window.selectError=null);
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.waitForFunction(()=>window.ack===4);
      await page.getByRole('button',{name:'Stop Test',exact:true}).click();
      await page.waitForFunction(()=>window.store.getState().onboardingTestPassed);
      results.push({case:'retry-after-access-failure',passed:true});
      await loadTest();
      await page.evaluate(()=>window.recognitionError=true);
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.getByText('Test paused. Stop Test, then try again.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Finish Onboarding'}).isDisabled(),true);
      assert.ok(!(await page.locator('body').innerText()).includes('[object Object]'));
      await page.getByRole('button',{name:'Stop Test',exact:true}).click();
      await page.waitForFunction(()=>window.store.getState().status==='error');
      assert.equal(await page.evaluate(()=>window.config.onboardingCompleted),false);
      await page.evaluate(()=>window.recognitionError=false);
      await page.getByRole('button',{name:'Test again',exact:true}).click();
      await page.getByRole('region',{name:'Test transcript'}).getByText('This is my voice test',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Finish Onboarding'}).click();
      await page.waitForFunction(()=>window.config.onboardingCompleted&&window.store.getState().surface==='hidden');
      assert.equal(await page.evaluate(()=>window.stopped&&window.ack===4),true);
      await noOutput();
      results.push({case:'recognition-error-retry-and-finish-during-recording',passed:true});
      await loadTest();
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.waitForFunction(()=>window.ack===4);
      await page.evaluate(()=>window.listeners['voco:toggle-dictation']?.({payload:null}));
      await page.waitForFunction(()=>window.store.getState().onboardingTestPassed);
      assert.equal(await page.evaluate(()=>window.store.getState().surface),'onboarding');
      await noOutput();
      results.push({case:'alt-d-stops-test-and-keeps-setup-open',passed:true});
      await loadTest();
      await page.evaluate(()=>{window.store.getState().setSurface('hidden');window.listeners['voco:toggle']?.({payload:null});});
      // Use the app's actual registered global-shortcut event.
      await page.evaluate(()=>window.listeners['voco:toggle-dictation']?.({payload:null}));
      await page.waitForFunction(()=>window.calls.some(c=>c[0]==='showNotification'&&c[1]==='No text cursor available'));
      assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='native_capture_begin')),false);
      assert.equal(await page.evaluate(()=>window.store.getState().surface),'hidden');
      results.push({case:'no-cursor-notification-without-capture-or-focus-steal',passed:true});
      await loadTest('off');
      await page.evaluate(()=>{window.config.selectedMic='previous-mic';window.store.getState().setConfig({...window.config});});
      assert.equal(await page.evaluate(()=>window.streamRequests||0),0);
      await page.getByRole('button',{name:'Start Test',exact:true}).click();
      await page.waitForFunction(()=>window.captureWorklet?.port.onmessage && window.store.getState().status==='recording');
      await page.evaluate(()=>window.captureWorklet.port.onmessage({data:{type:'samples',data:Float32Array.from({length:16000},(_,i)=>Math.sin(i/20)*.2)}}));
      await page.getByRole('region',{name:'Test transcript'}).getByText('This is my voice test',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Finish Onboarding'}).click();
      await page.waitForFunction(()=>window.config.onboardingCompleted&&window.store.getState().surface==='hidden');
      assert.equal(await page.evaluate(()=>window.nativeCommands.some(c=>c.name==='native_capture_begin')),false);
      assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
      await noOutput();
      assert.equal(await page.evaluate(()=>window.config.selectedMic),null);
      assert.equal(await page.evaluate(()=>window.store.getState().selectedDeviceId),null);
      results.push({case:'webkit-onboarding-capture-live-text-flush-and-finish',passed:true});
      assert.deepEqual(errors,[]);assert.deepEqual(consoleWarnings,[]);
      await save('RESULTS.json',{passed:true,results,errors,consoleWarnings,mockedCapture:true,mockedRecognition:true,physicalMicrophone:false});
    } else {
    const expected=['default-off-webkit','pending-no-fallback','capability-error-no-fallback','retry-setup-native-no-capture','native-setup-no-webkit','explicit-source-required','consent-required','selection-no-capture','selection-failure-clears-grant','default-resolves-explicit-token','refresh-no-capture','catalog-change-invalidates-grant','catalog-failure-no-fallback'];
    const record=(name)=>results.push({case:name,passed:true});
    const state=()=>page.evaluate(()=>({mode:window.store.getState().captureBackendMode,ready:window.store.getState().microphoneReady,source:window.store.getState().nativeCaptureSource,streams:window.streamRequests||0,enums:window.enumCount||0,commands:window.nativeCommands}));
    const noCapture=async()=>{const s=await state();assert.equal(s.streams,0);assert.equal(s.enums,0);assert.equal(s.commands.filter(x=>/native_capture_(begin|drain|stop|cancel)$/.test(x.name)).length,0);};
    const load=async(scenario)=>{
      await page.goto(origin+'/app-microphone-check?scenario='+scenario);
      await page.waitForFunction(()=>window.store && window.nativeCommands.some(x=>x.name==='native_capture_capabilities'));
      await page.evaluate(()=>window.store.getState().setSurface('settings'));
      await page.getByRole('button',{name:'Microphone',exact:true}).click();
    };
    await load('off');await page.getByRole('combobox', { name: /Input device/ }).waitFor();
    await page.waitForFunction(()=>window.store.getState().captureBackendMode==='webkit');assert.ok((await state()).enums>0);record(expected[0]);
    await load('pending');await page.getByRole('button',{name:'Retry capture setup'}).waitFor();await noCapture();assert.equal((await state()).mode,'pending');record(expected[1]);
    await load('error');await page.getByText('Capability unavailable',{exact:true}).waitFor();await noCapture();assert.equal((await state()).mode,'pending');record(expected[2]);
    await page.evaluate(()=>window.captureScenario='enabled');await page.getByRole('button',{name:'Retry capture setup'}).click();
    await page.getByLabel('Native input device').waitFor();await noCapture();assert.equal((await state()).mode,'native');record(expected[3]);
    await load('enabled');const select=page.getByLabel('Native input device');await select.waitFor();await page.evaluate(()=>navigator.mediaDevices.dispatchEvent(new Event('devicechange')));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await noCapture();assert.equal(await page.getByRole('button',{name:'Retry microphone access',exact:true}).count(),0);record(expected[4]);
    const use=page.getByRole('button',{name:'Use this microphone',exact:true});const consent=page.getByLabel('Allow native microphone access for this app session');
    assert.equal(await use.isDisabled(),true);assert.equal(await consent.isDisabled(),true);assert.equal((await state()).source,null);record(expected[5]);
    await select.selectOption('token-1');assert.equal(await use.isDisabled(),true);await noCapture();record(expected[6]);
    await consent.check();await use.click();await page.waitForFunction(()=>window.store.getState().nativeCaptureSource?.selectionToken==='token-1');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await noCapture();
    assert.deepEqual((await state()).commands.filter(x=>x.name==='native_capture_select_source').at(-1).args,{selectionToken:'token-1',acknowledged:true});assert.equal((await state()).ready,true);record(expected[7]);
    await noCapture();
    await page.evaluate(()=>window.selectError='Selection expired');await consent.check();await use.click();await page.getByText('Selection expired',{exact:true}).waitFor();assert.equal((await state()).source,null);await noCapture();assert.equal((await state()).ready,false);record(expected[8]);
    await page.evaluate(()=>window.selectError=null);await select.selectOption('system-default');await consent.check();await use.click();await page.waitForFunction(()=>window.store.getState().nativeCaptureSource?.selectionToken==='token-1');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal((await state()).commands.filter(x=>x.name==='native_capture_select_source').at(-1).args.selectionToken,'token-1');await noCapture();record(expected[9]);
    await page.getByRole('button',{name:'Refresh native devices'}).click();await page.waitForFunction(()=>window.nativeCommands.filter(x=>x.name==='native_capture_list_sources').length>=2);await noCapture();record(expected[10]);
    await page.evaluate(()=>window.catalog={revision:'r2',sources:[],defaultSelectionToken:null});await page.getByRole('button',{name:'Refresh native devices'}).click();await page.waitForFunction(()=>window.store.getState().nativeCaptureSource===null);await page.getByText('The microphone list changed. Choose and allow a microphone again.',{exact:true}).waitFor();await noCapture();assert.equal((await state()).ready,false);record(expected[11]);
    await page.evaluate(()=>window.catalogError='Source server unavailable');await page.getByRole('button',{name:'Refresh native devices'}).click();await page.getByText('Source server unavailable',{exact:true}).waitFor();assert.equal((await state()).mode,'native');await noCapture();record(expected[12]);
    expected.push('native-settings-without-preview');record('native-settings-without-preview');
    const originalExpected=[...expected];
    const activate=async(auditEnabled=false)=>{
      await load('enabled');await page.getByLabel('Native input device').selectOption('token-1');await page.getByLabel('Allow native microphone access for this app session').check();await page.getByRole('button',{name:'Use this microphone',exact:true}).click();
      await page.waitForFunction(()=>window.store.getState().nativeCaptureSource!==null);
      await page.evaluate(enabled=>{window.auditEnabled=enabled;window.allowBegin=true;window.store.getState().setSurface('hidden');},auditEnabled);
      await page.waitForFunction(()=>window.listeners['voco:toggle-dictation']);
      await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
      await page.waitForFunction(()=>window.nativeCommands.some(x=>x.name==='native_capture_drain'&&x.args.request.ackThroughSequence===4));
    };
    await activate();assert.equal((await state()).streams,0);assert.equal((await state()).enums,0);
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.store.getState().status==='idle'||window.store.getState().recovery);
    assert.ok((await state()).commands.some(x=>x.name==='native_capture_stop'));assert.ok((await state()).commands.some(x=>x.name==='native_capture_drain'&&x.args.request.ackThroughSequence===4));
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript');
    assert.equal(await page.evaluate(()=>window.auditUploads.length),0);
    expected.push('native-start-stop-ack-completion');record(expected.at(-1));
    await activate();await page.evaluate(()=>window.transcriptionError=true);
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===true);
    assert.equal((await state()).streams,0);assert.equal((await state()).commands.filter(x=>x.name==='native_capture_begin').length,1);
    expected.push('native-recognition-failure-retains-recovery');record(expected.at(-1));
    await page.evaluate(()=>{window.transcriptionError=false;window.store.getState().setSurface('popover');});
    await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript');
    assert.equal((await state()).commands.filter(x=>x.name==='native_capture_begin').length,1);assert.equal((await state()).streams,0);
    expected.push('manual-retry-does-not-recapture');record(expected.at(-1));
    await activate();await page.evaluate(()=>window.store.getState().setSurface('popover'));await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===true);
    assert.ok((await state()).commands.some(x=>x.name==='native_capture_stop'));assert.equal((await state()).streams,0);
    assert.equal((await state()).ready,true);assert.ok((await state()).source);assert.equal((await state()).commands.filter(x=>x.name==='native_capture_cancel').length,0);
    expected.push('native-user-cancel-retains-audio');record(expected.at(-1));
    await activate();await page.evaluate(()=>window.store.getState().setSurface('settings'));
    await page.getByRole('button',{name:'Microphone',exact:true}).click();
    await page.getByLabel('Native input device').waitFor();assert.equal(await page.getByLabel('Native input device').isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Use this microphone',exact:true}).isDisabled(),true);
    assert.equal((await state()).commands.filter(x=>x.name==='native_capture_select_source').length,1);
    const listsBefore=(await state()).commands.filter(x=>x.name==='native_capture_list_sources').length;
    await page.evaluate(()=>navigator.mediaDevices.dispatchEvent(new Event('devicechange')));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal((await state()).commands.filter(x=>x.name==='native_capture_list_sources').length,listsBefore);assert.equal((await state()).ready,true);
    expected.push('active-capture-prevents-source-selection');record(expected.at(-1));
    await page.evaluate(()=>window.store.getState().setSurface('hidden'));
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript');
    await activate();await page.evaluate(()=>window.unhealthy=true);
    await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===true);
    assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='transcribeAudio').length),0);
    assert.equal((await state()).streams,0);assert.equal((await state()).commands.filter(x=>x.name==='native_capture_begin').length,1);
    expected.push('native-tail-failure-retains-prefix-without-auto-transcription');record(expected.at(-1));
    await load('enabled');await page.getByLabel('Native input device').waitFor();
    await page.evaluate(()=>{window.source={...window.source,objectSerial:null};window.catalog={revision:'unsupported',sources:[window.source],defaultSelectionToken:'token-1'};});
    await page.getByRole('button',{name:'Refresh native devices'}).click();
    await page.waitForFunction(()=>document.querySelector('option[value="system-default"]')?.disabled===true);
    assert.equal(await page.getByRole('button',{name:'Use this microphone',exact:true}).isDisabled(),true);assert.equal((await state()).source,null);assert.equal((await state()).ready,false);await noCapture();
    expected.push('unsupported-default-source-cannot-be-approved');record(expected.at(-1));
    const beginAgain=async()=>{
      await page.evaluate(()=>{window.unhealthy=false;window.transcriptionError=false;window.store.getState().setSurface('hidden');});
      await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
      await page.waitForFunction(()=>window.nativeCommands.filter(x=>x.name==='native_capture_begin').length===2 && window.ack===4);
      const starts=(await state()).commands.filter(x=>x.name==='native_capture_begin');
      assert.ok(starts[1].args.request.sessionId>starts[0].args.request.sessionId);
      assert.ok(starts[1].args.request.generation>starts[0].args.request.generation);
      assert.equal(starts[1].args.request.selectionToken,'token-1');
      assert.equal((await state()).streams,0);
      await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
      await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript'&&window.store.getState().status==='idle');
    };
    await activate();await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript'&&window.store.getState().status==='idle');
    await page.evaluate(()=>window.store.getState().setSurface('popover'));
    await page.getByRole('button',{name:/Clear transcript|Discard recovery/}).click();
    await beginAgain();expected.push('same-app-second-recording-after-healthy-stop');record(expected.at(-1));
    await activate();await page.evaluate(()=>window.unhealthy=true);
    await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===true);
    await page.evaluate(()=>window.store.getState().setSurface('popover'));
    await page.getByRole('button',{name:'Discard recovery',exact:true}).click();
    assert.equal((await state()).source,null);assert.equal((await state()).ready,false);
    await page.evaluate(()=>window.store.getState().setSurface('settings'));
    await page.getByRole('button',{name:'Microphone',exact:true}).click();
    await page.getByRole('button',{name:'Refresh native devices'}).click();
    await page.getByLabel('Native input device').selectOption('token-1');
    await page.getByLabel('Allow native microphone access for this app session').check();
    await page.getByRole('button',{name:'Use this microphone',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().nativeCaptureSource!==null);
    assert.equal((await state()).commands.filter(x=>x.name==='native_capture_select_source').length,2);
    await beginAgain();expected.push('same-app-second-recording-after-unhealthy-discard');record(expected.at(-1));
    for(const recoveredMode of ['off','enabled']) {
      await load('error');await page.waitForFunction(()=>window.store.getState().error?.startsWith('Failed to initialize:'));
      assert.equal(await page.evaluate(()=>window.workletLoads||0),0);
      await page.evaluate(mode=>window.captureScenario=mode,recoveredMode);
      await page.getByRole('button',{name:'Retry capture setup'}).click();
      await page.waitForFunction(()=>window.calls.some(x=>x[0]==='syncRuntimeStatus'&&x[1].runtimeInitialized===true));
      assert.equal(await page.evaluate(()=>window.store.getState().error),null);
      if(recoveredMode==='off') {
        assert.ok(await page.evaluate(()=>window.workletLoads>0));assert.equal((await state()).mode,'webkit');
        assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='syncRuntimeStatus').at(-1)[1].nativeMicrophoneReady),null);
      } else {
        await noCapture();assert.equal(await page.evaluate(()=>window.workletLoads||0),0);
        await page.getByLabel('Native input device').selectOption('token-1');
        await page.getByLabel('Allow native microphone access for this app session').check();
        await page.getByRole('button',{name:'Use this microphone',exact:true}).click();
        await page.waitForFunction(()=>window.store.getState().microphoneReady===true);
        await page.evaluate(()=>window.store.getState().setMicrophonePermission('denied'));
        await page.waitForFunction(()=>window.calls.some(x=>x[0]==='syncRuntimeStatus'&&x[1].nativeMicrophoneReady===true&&x[1].microphonePermission==='denied'));
        assert.equal(await page.evaluate(()=>window.store.getState().microphonePermission),'denied');await noCapture();
      }
      expected.push('failed-setup-retry-'+recoveredMode+'-completes-initialization');record(expected.at(-1));
    }
    await load('enabled');await page.getByLabel('Native input device').selectOption('token-1');
    await page.getByLabel('Allow native microphone access for this app session').check();
    await page.getByRole('button',{name:'Use this microphone',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().nativeCaptureSource!==null);
    await page.evaluate(()=>window.store.getState().setSurface('hidden'));
    await page.waitForFunction(()=>window.listeners['voco:toggle-dictation']);
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.nativeCommands.some(x=>x.name==='native_capture_begin')&&window.store.getState().nativeCaptureSource===null);
    assert.equal((await state()).ready,false);assert.equal((await state()).streams,0);assert.equal((await state()).enums,0);
    assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='transcribeAudio').length),0);
    expected.push('native-start-failure-revokes-grant-without-fallback');record(expected.at(-1));
    await load('enabled');await page.getByLabel('Native input device').selectOption('token-1');
    await page.getByLabel('Allow native microphone access for this app session').check();
    await page.getByRole('button',{name:'Use this microphone',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().nativeCaptureSource!==null);
    await page.evaluate(()=>{window.deferBegin=true;window.store.getState().setSurface('hidden');});
    await page.waitForFunction(()=>window.listeners['voco:toggle-dictation']);
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>typeof window.rejectBegin==='function');
    // Ownership fault injection, not an enabled UI selection during startup.
    await page.evaluate(()=>{window.newerSource={...window.source,selectionToken:'token-newer',index:63,objectSerial:'63'};window.store.getState().setNativeCaptureSource(window.newerSource);window.rejectBegin(Error('Late old begin rejection'));});
    await page.waitForFunction(()=>window.store.getState().error?.includes('Late old begin rejection'));
    assert.equal((await state()).source.selectionToken,'token-newer');assert.equal((await state()).ready,true);
    assert.equal((await state()).streams,0);assert.equal((await state()).enums,0);
    expected.push('late-begin-rejection-preserves-newer-source-ownership-fault');record(expected.at(-1));
    const verifyRetainedWitness=async(outcome)=>{
      await page.waitForFunction(()=>window.auditUploads.length===1);
      const proof=await page.evaluate(()=>{
        const packet=window.auditUploads[0],view=new DataView(packet.buffer),n=view.getUint32(0,true);
        const metadata=JSON.parse(new TextDecoder().decode(packet.slice(4,4+n)));
        const original=window.issuedFixturePcm,source=new DataView(original.buffer,original.byteOffset,original.byteLength);
        let mismatches=0,sum=0;
        for(let i=0;i<original.byteLength/4;i++){
          const actual=view.getFloat32(4+n+i*4,true),expected=(source.getInt16(i*4,true)+source.getInt16(i*4+2,true))/65536;
          if(!Object.is(actual,expected))mismatches++;
          sum+=actual;
        }
        return {metadata,mismatches,mean:sum/(original.byteLength/4),payloadBytes:packet.length-4-n,identity:window.captureIdentity};
      });
      assert.equal(proof.mismatches,0);assert.ok(proof.mean>.1,'DC bias must still be present before preparation');
      assert.equal(proof.payloadBytes,35280*4);assert.equal(proof.metadata.sampleCount,35280);
      assert.equal(proof.metadata.terminalOutcome,outcome);assert.deepEqual(proof.metadata.nativeCaptureIdentity,proof.identity);
      assert.equal(proof.metadata.captureDescriptor.sourceSampleRate,44100);
      assert.equal(proof.metadata.stage,'renderer-retained-source-before-dc-resample');
    };
    // Transport fault injection: a retained prefix followed by one lost Drain reply.
    // Native queue/lease behavior is tested separately; this fixture isolates renderer ownership.
    await activate(true);
    await page.evaluate(()=>{
      const invoke=window.nativeInvoke,identity={...window.captureIdentity};
      const raw=window.issuedFixturePcm.slice(0,35280);
      const meta=new TextEncoder().encode(JSON.stringify({version:1,...identity,
        blocks:[{sequence:5,frameStart:35280,frames:8820,byteOffset:0,byteLength:35280}],
        receipt:{state:'stopping',producedFrames:44100,lastSequence:5,corkAcknowledged:false,
          barrierAcknowledged:false,limitReached:false,acknowledgedSequence:4,health:{healthy:true,reason:null}}}));
      const packet=new Uint8Array(4+meta.length+raw.length);new DataView(packet.buffer).setUint32(0,meta.length,true);
      packet.set(meta,4);packet.set(raw,4+meta.length);
      window.nativeInvoke=(name,args)=>{
        if(name==='native_capture_drain'&&!window.stallInjected&&args.request.sessionId===identity.sessionId){
          window.stallInjected=true;window.nativeCommands.push({name,args});
          return new Promise(resolve=>{window.resolveOldDrain=()=>{window.oldDrainReleased=true;resolve(packet.buffer);};});
        }
        return invoke(name,args);
      };
    });
    await page.waitForFunction(()=>window.stallInjected===true);
    await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===true,{},{timeout:12000});
    await verifyRetainedWitness('interrupted');
    assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='transcribeAudio').length),0);
    assert.equal((await state()).source,null);assert.equal((await state()).ready,false);
    await page.evaluate(()=>window.store.getState().setSurface('popover'));
    await page.getByRole('button',{name:'Discard recovery',exact:true}).waitFor();
    assert.equal(await page.locator('vite-error-overlay').count(),0);
    await save('stall-recovery-view.json',{url:page.url(),title:await page.title(),text:await page.locator('body').innerText(),browser:'Browser plugin not available; regular Playwright',viewport:page.viewportSize()});
    await page.screenshot({path:path.join(out,'stall-recovery.png')});
    expected.push('drain-timeout-retains-exact-prefix-without-automatic-output');record(expected.at(-1));
    await page.getByRole('button',{name:'Discard recovery',exact:true}).click();
    await page.evaluate(()=>window.store.getState().setSurface('settings'));
    await page.getByRole('button',{name:'Microphone',exact:true}).click();
    await page.getByRole('button',{name:'Refresh native devices'}).click();
    await page.getByLabel('Native input device').selectOption('token-1');
    await page.getByLabel('Allow native microphone access for this app session').check();
    await page.getByRole('button',{name:'Use this microphone',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().nativeCaptureSource!==null);
    await page.evaluate(()=>window.store.getState().setSurface('hidden'));
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.nativeCommands.filter(x=>x.name==='native_capture_begin').length===2&&window.ack===4);
    await page.evaluate(()=>window.resolveOldDrain());
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,60)));
    assert.equal((await state()).ready,true);assert.ok((await state()).source);
    assert.equal(await page.evaluate(()=>window.store.getState().recovery),null);
    assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='transcribeAudio').length),0);
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript'&&window.store.getState().status==='idle');
    const lateProof=await page.evaluate(()=>({released:window.oldDrainReleased,
      transcriptionSamples:window.calls.filter(x=>x[0]==='transcribeAudio').map(x=>x[1].length),
      starts:window.nativeCommands.filter(x=>x.name==='native_capture_begin').map(x=>x.args.request),
      uploads:window.auditUploads.length,cancels:window.nativeCommands.filter(x=>x.name==='native_capture_cancel').map(x=>x.args.request)}));
    assert.equal(lateProof.released,true);assert.deepEqual(lateProof.transcriptionSamples,[12800]);
    assert.ok(lateProof.starts[1].sessionId>lateProof.starts[0].sessionId);
    assert.ok(lateProof.starts[1].generation>lateProof.starts[0].generation);
    assert.equal(lateProof.uploads,1);assert.equal(lateProof.cancels.length,1);
    assert.equal(lateProof.cancels[0].sessionId,lateProof.starts[0].sessionId);
    await save('late-drain-proof.json',lateProof);
    expected.push('late-timed-out-drain-cannot-contaminate-fresh-recording');record(expected.at(-1));
    await activate(true);
    await page.evaluate(()=>window.listeners['voco:toggle-dictation']({payload:null}));
    await verifyRetainedWitness('healthy-stop');
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript');
    expected.push('opt-in-audit-retains-exact-source-before-dc-and-resampling');record(expected.at(-1));
    await activate(true);await page.evaluate(()=>window.store.getState().setSurface('popover'));await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
    await verifyRetainedWitness('cancelled');
    await page.waitForFunction(()=>window.store.getState().recovery?.audioAvailable===true);
    assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='transcribeAudio').length),0);
    expected.push('cancelled-audit-keeps-prefix-and-does-not-claim-healthy');record(expected.at(-1));
    await page.evaluate(()=>window.store.getState().setSurface('popover'));
    await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
    await page.waitForFunction(()=>window.store.getState().transcript==='Fixture transcript');
    assert.equal(await page.evaluate(()=>window.auditUploads.length),1);
    expected.push('manual-recovery-does-not-export-source-a-second-time');record(expected.at(-1));
    // Real App observation wiring at actual desktop panel sizes. No native capture begins.
    await load('enabled');
    await page.evaluate(() => {
      window.source.label = 'Remapped voco_test_sink_8dacc27a8e4a4c8f.monitor';
      window.store.getState().setNativeCaptureSource({ ...window.source });
      window.shortcutObservation = { hotkey: 'Alt+D', route: null, state: 'unavailable', detail: 'No readable keyboard. Select VOCO Dictation explicitly in Input Sources.' };
      const originalCall = window.nativeCall;
      window.nativeCall = async (name, args) => {
        if (name !== 'getRuntimeDiagnostics') return originalCall(name, args);
        window.diagnosticRequests = (window.diagnosticRequests || 0) + 1;
        const base = await originalCall(name, args);
        if (window.deferDiagnostics) return new Promise(resolve => { window.resolveDiagnostics = () => resolve({ ...base, shortcut: { hotkey: 'Alt+D', route: 'evdev', state: 'available', detail: 'Old observation' } }); });
        return { ...base, shortcut: { ...window.shortcutObservation } };
      };
      window.store.getState().setSurface('popover');
    });
    await page.setViewportSize({ width: 420, height: 520 });
    await page.waitForFunction(() => (window.diagnosticRequests || 0) > 0);
    await page.getByText('Shortcut configured: Alt+D. Start dictation from the tray.', { exact: false }).waitFor();
    const footer = page.getByRole('button', { name: 'Microphone: Remapped voco_test_sink_8dacc27a8e4a4c8f.monitor', exact: true });
    await captureStyledPanel('shortcut-unavailable-popover-420x520', footer, { width: 420, height: 520 });
    await noCapture();
    expected.push('unavailable-shortcut-and-approved-native-footer-at-popover-size'); record(expected.at(-1));

    await page.setViewportSize({ width: 760, height: 560 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await page.getByText('No readable keyboard.', { exact: false }).waitFor();
    await captureStyledPanel('shortcut-settings-760x560', page.getByRole('button', { name: 'Record shortcut', exact: true }), { width: 760, height: 560 });
    await captureStyledPanel('shortcut-settings-instructions-760x560', page.getByText('For IBus recording shortcuts, add VOCO Dictation in your desktop Input Sources settings, select it, then focus a text field. VOCO never switches your input source automatically.', { exact: true }), { width: 760, height: 560 });
    await page.evaluate(() => { window.shortcutObservation = { hotkey: 'Alt+D', route: 'ibus', state: 'focus-required', detail: 'Focus a supported input field.' }; });
    await page.getByText('Focus a text field with VOCO Dictation selected as your input source.', { exact: true }).waitFor();
    expected.push('settings-shows-current-focus-required-ibus-instructions'); record(expected.at(-1));

    await page.evaluate(() => { window.deferDiagnostics = true; });
    await page.waitForFunction(() => typeof window.resolveDiagnostics === 'function');
    await page.evaluate(() => {
      window.store.getState().setConfig({ ...window.store.getState().config, hotkey: 'Alt+X' });
      window.resolveDiagnostics();
      window.deferDiagnostics = false;
    });
    await page.getByText('Shortcut configured: Alt+X. Start dictation from the tray.', { exact: false }).waitFor();
    assert.equal(await page.getByText('Press Alt+D to record and copy.', { exact: true }).count(), 0);
    await noCapture();
    expected.push('late-old-key-diagnostic-cannot-advertise-new-configuration'); record(expected.at(-1));
    const prepareDeferredDiagnostics = async () => {
      await load('enabled');
      await page.evaluate(() => {
        const originalCall = window.nativeCall;
        window.observerCalls = 0;
        window.holdObserver = false;
        window.nativeCall = async (name, args) => {
          if (name === 'saveConfigPatch') {
            window.savePending = true;
            return new Promise(resolve => { window.finishSave = () => resolve({ revision: 2, config: { ...window.config, ...args[0] } }); });
          }
          if (name !== 'getRuntimeDiagnostics') return originalCall(name, args);
          window.observerCalls += 1;
          const base = await originalCall(name, args);
          const reply = { ...base, shortcut: { hotkey: 'Alt+D', route: 'global-shortcut', state: 'available', detail: 'Verified mock registration' } };
          if (window.holdObserver) return new Promise(resolve => {
            window.finishObserver = () => resolve({ ...reply, ownedPreedit: { ...base.ownedPreedit, setupState: 'error' } });
          });
          return reply;
        };
        window.store.getState().setSurface('popover');
      });
      await page.getByText('Press Alt+D to record and copy.', { exact: false }).waitFor();
      await page.evaluate(() => { window.holdObserver = true; });
      await page.waitForFunction(() => typeof window.finishObserver === 'function');
    };

    await prepareDeferredDiagnostics();
    const pendingCalls = await page.evaluate(() => window.observerCalls);
    await page.getByText('Shortcut configured: Alt+D. Start dictation from the tray.', { exact: false }).waitFor({ timeout: 3000 });
    const openStarted = performance.now();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).waitFor({ timeout: 3000 });
    assert.ok(performance.now() - openStarted < 3000, 'Pending observer must not block Settings');
    await page.waitForTimeout(2500); // Cross two poll intervals while the same backend call remains pending.
    assert.equal(await page.evaluate(() => window.observerCalls), pendingCalls);
    expected.push('available-status-expires-and-permanent-pending-observer-does-not-accumulate'); record(expected.at(-1));

    for (const transition of ['hide', 'save', 'unmount']) {
      await prepareDeferredDiagnostics();
      if (transition === 'save') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
        await page.getByLabel('Start and stop listening', { exact: true }).fill('Alt+X');
        await page.getByRole('button', { name: 'Save hotkey', exact: true }).click();
        await page.waitForFunction(() => window.savePending === true);
      } else if (transition === 'hide') {
        await page.evaluate(() => window.store.getState().setSurface('hidden'));
        await page.waitForFunction(() => !document.querySelector('.voco-panel'));
      } else {
        await page.evaluate(() => window.reactRoot.unmount());
      }
      const setupBefore = await page.evaluate(() => window.store.getState().ownedPreeditSetupState);
      await page.evaluate(async () => {
        window.finishObserver();
        await new Promise(resolve => setTimeout(resolve, 50));
      });
      assert.equal(await page.evaluate(() => window.store.getState().ownedPreeditSetupState), setupBefore, 'Rejected late observer must not publish any diagnostics');
      assert.equal(await page.getByText('Press Alt+D to record and copy.', { exact: false }).count(), 0);
      if (transition === 'save') await page.evaluate(() => window.finishSave());
      await noCapture();
      expected.push('late-observer-after-' + transition + '-cannot-publish'); record(expected.at(-1));
    }
    // The real App's asynchronous focus listener must not let an old blur reply
    // dismiss a manual transcript after a newer focused observation.
    await page.setViewportSize({ width: 420, height: 660 });
    await activate();
    await page.evaluate(() => window.listeners['voco:toggle-dictation']({ payload: null }));
    await page.waitForFunction(() => window.store.getState().recovery?.kind === 'manual-copy');
    await page.waitForFunction(() => window.calls.filter(x => x[0] === 'syncRuntimeStatus').at(-1)[1].recoveryAvailable === true);
    await page.evaluate(() => window.listeners['voco:show-popover']({ payload: {} }));
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).waitFor();
    await page.waitForFunction(() => window.focusListeners.size === 1);
    await page.evaluate(() => { window.failClipboard = true; });
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).click();
    await page.getByText('Copy failed: Fixture clipboard unavailable', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.store.getState().transcript), 'Fixture transcript');
    assert.equal(await page.evaluate(() => window.store.getState().recovery.kind), 'manual-copy');
    expected.push('failed-copy-retains-manual-transcript'); record(expected.at(-1));
    await page.evaluate(() => {
      window.failClipboard = false;
      window.deferFocusRead = true;
      for (const callback of window.focusListeners) callback({ payload: false });
    });
    await page.waitForFunction(() => window.focusReads.length === 1);
    await page.evaluate(async () => {
      window.deferFocusRead = false;
      window.focused = true;
      for (const callback of window.focusListeners) callback({ payload: true });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).click();
    await page.getByText('Copied to clipboard. The transcript stays here until you dismiss it.', { exact: true }).waitFor();
    await page.evaluate(async () => {
      window.focusReads.shift()(false);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(await page.evaluate(() => window.store.getState().surface), 'popover');
    assert.equal(await page.evaluate(() => window.copiedText), 'Fixture transcript');
    assert.equal(await page.evaluate(() => window.store.getState().recovery.kind), 'manual-copy');
    await captureStyledPanel('copied-transcript-stale-blur-420x660', page.getByText('Copied to clipboard. The transcript stays here until you dismiss it.', { exact: true }), { width: 420, height: 660 });
    expected.push('copy-and-newer-focus-survive-stale-blur-reply'); record(expected.at(-1));
    await page.evaluate(() => {
      window.focused = false;
      for (const callback of window.focusListeners) callback({ payload: false });
    });
    await page.waitForFunction(() => window.store.getState().surface === 'hidden');
    assert.equal(await page.evaluate(() => window.store.getState().transcript), 'Fixture transcript');
    await page.evaluate(() => {
      window.focused = true;
      window.listeners['voco:show-popover']({ payload: {} });
    });
    await page.getByRole('button', { name: 'Clear transcript', exact: true }).click();
    await page.waitForFunction(() => window.store.getState().recovery === null && window.store.getState().transcript === '');
    await page.waitForFunction(() => {
      const snapshot = window.calls.filter(x => x[0] === 'syncRuntimeStatus').at(-1)[1];
      return snapshot.manualTranscriptReady === false && snapshot.recoveryAvailable === false;
    });
    assert.equal(await page.evaluate(() => window.copiedText), 'Fixture transcript');
    await page.evaluate(() => window.store.getState().setSurface('hidden'));
    await page.waitForFunction(() => window.focusListeners.size === 0);
    await page.evaluate(() => window.listeners['voco:toggle-dictation']({ payload: null }));
    await page.waitForFunction(() => window.store.getState().status === 'recording' && window.nativeCommands.filter(x => x.name === 'native_capture_begin').length === 2);
    await page.evaluate(()=>window.store.getState().setSurface('popover'));
    await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click();
    await page.waitForFunction(() => window.store.getState().recovery?.audioAvailable === true);
    await page.waitForFunction(() => {
      const snapshot = window.calls.filter(x => x[0] === 'syncRuntimeStatus').at(-1)[1];
      return snapshot.manualTranscriptReady === false && snapshot.recoveryAvailable === true;
    });
    await page.evaluate(() => window.listeners['voco:show-popover']({ payload: {} }));
    await page.getByRole('button', { name: 'Discard recovery', exact: true }).click();
    await page.waitForFunction(() => window.calls.filter(x => x[0] === 'syncRuntimeStatus').at(-1)[1].recoveryAvailable === false);
    assert.equal(await page.evaluate(() => window.copiedText), 'Fixture transcript');
    expected.push('genuine-blur-retains-text-and-clear-allows-next-recording'); record(expected.at(-1));
    await save('CONSOLE.json', { consoleWarnings, note: 'All native and media boundaries are mocked; warnings are retained verbatim for review, not automatically classified as harmless.' });
    assert.deepEqual(results.slice(0,originalExpected.length).map(x=>x.case),originalExpected);
    assert.deepEqual(results.map(x=>x.case),expected);assert.deepEqual(errors,[]);assert.deepEqual(consoleWarnings,[]);
    await save('RESULTS.json',{passed:true,results,errors,consoleWarnings,mockedCapture:true,physicalMicrophone:false,scope:'Actual App setup, native start/stop binary ACK, recovery and Cancel with mocked native/media boundaries'});
    }
} catch(error) {
    await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    await save('FAILURE.json',{error:String(error),stack:error.stack,results,errors,consoleWarnings,diagnostics:await page?.evaluate(()=>({text:document.body.innerText,calls:window.nativeCommands,state:window.store?.getState()})).catch(()=>null)});throw error;
} finally {await browser?.close();await server?.close();}
