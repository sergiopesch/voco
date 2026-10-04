import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// The renderer the microphone and native-capture suites load: VOCO's real App,
// hooks and store from Vite in Playwright's Chromium, with every Tauri, device,
// audio and network boundary mocked. Every mocked command lands in window.calls
// once, before a suite's handler answers it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');

// A new evidence directory with the suite, this module and the hashes of the app
// sources the suite exercises.
export async function prepareEvidence(suite, files) {
    const out = process.env.VOCO_RENDERER_EVIDENCE_DIR;
    if (!out)
        throw Error('Exclusive VOCO_RENDERER_EVIDENCE_DIR required');
    await mkdir(out, {
        recursive: false
    });
    await writeFile(path.join(out, 'harness.mjs'), await readFile(fileURLToPath(suite)), {
        flag: 'wx'
    });
    await writeFile(path.join(out, 'renderer-fixture.mjs'), await readFile(fileURLToPath(import.meta.url)), {
        flag: 'wx'
    });
    const save = (n, v) => writeFile(path.join(out, n), JSON.stringify(v, null, 2) + '\n', {
        flag: 'wx'
    });
    await save('SOURCE.json', Object.fromEntries(await Promise.all(files.map(async (f) => [
        f, sha256(await readFile(path.join(root, 'apps/desktop', f)))
    ]))));
    return { out, save };
}

const appScript = `<script type="module">
            import React from '/node_modules/.vite/deps/react.js';
            import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
            import { App } from '/src/App.tsx';
            import { useStore } from '/src/store/useStore.ts';
            window.store = useStore;
            window.reactRoot = ReactDOM.createRoot(document.getElementById('root'));
            window.reactRoot.render(React.createElement(App));
          </script>`;

// The settings page with only VOCO's base styles.
export const isolatedShell = `
          <title>VOCO isolated settings</title>
          <link rel="stylesheet" href="/src/styles.css">
          <div id="root"></div>
          ${appScript}
        `;

// The page inside the app's own index.html, with the production entry point's CSS
// imports, packaged fonts included; STYLE-SOURCE.json records which files they were.
export async function productionShell(out) {
    const mainEntry = await readFile(path.join(root, 'apps/desktop/src/main.tsx'), 'utf8');
    const pageShell = await readFile(path.join(root, 'apps/desktop/index.html'), 'utf8');
    assert.equal(pageShell.match(/<script type="module" src="\/src\/main\.tsx"><\/script>/g)?.length, 1);
    const styleSpecifiers = [...mainEntry.matchAll(/import\s+["']([^"']+\.css)["'];/g)].map(match => match[1]);
    assert.ok(styleSpecifiers.includes('./styles.css') && styleSpecifiers.some(name => name.startsWith('@fontsource/geist/')));
    const styleBindings = {};
    for (const name of styleSpecifiers) {
        const file = name.startsWith('./') ? path.join(root, 'apps/desktop/src', name) : path.join(root, 'node_modules', name);
        styleBindings[name] = { path: await realpath(file), sha256: sha256(await readFile(file)) };
    }
    // This HTML is intercepted after Vite's HTML import rewriting. Request CSS as
    // stylesheets so the browser does not attempt to execute raw CSS as JavaScript.
    const styleLinks = Object.values(styleBindings).map(binding => `<link rel="stylesheet" href="${encodeURI('/@fs' + binding.path)}?direct">`).join('\n');
    await writeFile(path.join(out, 'STYLE-SOURCE.json'), JSON.stringify({ mainSha256: sha256(mainEntry), imports: styleBindings }, null, 2) + '\n', { flag: 'wx' });
    const [head, tail] = pageShell.split('<script type="module" src="/src/main.tsx"></script>');
    return `
          ${head}
          ${styleLinks}
          ${appScript}
          ${tail}
        `;
}

// Vite serves apps/desktop with its own config; a fresh Chromium context holds one page.
export async function openRenderer(errors) {
    const server = await createServer({
        configFile: path.join(root, 'apps/desktop/vite.config.ts'),
        root: path.join(root, 'apps/desktop'),
        logLevel: 'warn',
        server: {
            host: '127.0.0.1',
            port: Number(process.env.VOCO_RENDERER_PORT ?? 0),
            hmr: false,
            fs: {
                allow: [
                    root, await realpath(path.join(root, 'node_modules'))
                ]
            }
        }
    });
    let browser;
    try {
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
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', e => errors.push(e.message));
        return { server, browser, page, origin };
    } catch (error) {
        await browser?.close();
        await server.close();
        throw error;
    }
}

// The window mock records each method it doesn't answer, and counts drag requests.
const windowModule = `
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
              if (name === 'startDragging') return async () => {
                window.dragRequests = (window.dragRequests || 0) + 1;
                window.calls.push(['window:' + name]);
              };
              return async () => { window.calls.push(['window:' + name]); };
            }
          });
          export const getCurrentWindow = () => windowHandle;
          export const currentMonitor = async () => null;
          export const availableMonitors = async () => [];
        `;

// tauri.ts's wrappers become window.nativeCall; coreInvoke is the suite's own
// @tauri-apps/api/core module.
export async function routeTauriModules(page, coreInvoke) {
    const tauri = await readFile(path.join(root, 'apps/desktop/src/lib/tauri.ts'), 'utf8');
    const names = [
        ...tauri.matchAll(/export (?:async )?function (\w+)/g)
    ].map(x => x[1]);
    const native = names.map(n => `export const ${n} = async (...args) => window.nativeCall(${JSON.stringify(n)},args);`).join('\n');
    await page.route('**/src/lib/tauri.ts*', r => r.fulfill({
        contentType: 'application/javascript',
        body: native
    }));
    await page.route('**/@tauri-apps_api_core.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: coreInvoke
    }));
    await page.route('**/@tauri-apps_api_app.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: 'export const getVersion=async()=>"2026.0.21";'
    }));
    await page.route('**/@tauri-apps_api_window.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: windowModule
    }));
    await page.route('https://api.github.com/**', r => r.fulfill({
        json: []
    }));
}

export const routeAppShell = (page, body) => page.route('**/app-microphone-check*', r => r.fulfill({
    contentType: 'text/html',
    body
}));

// Install deterministic device, permission and audio mocks before App imports.
// A suite answers its own commands through window.nativeHandlers; anything else
// gets the defaults, false for an unknown command. worklet adds the nodes only
// WebKit dictation capture builds.
export const installRendererMocks = (page, { worklet = false } = {}) => page.addInitScript(({ worklet }) => {
    window.listeners = {};
    window.focusListeners = new Set();
    window.focusReads = [];
    window.focused = true;
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
        onboardingCompleted: false,
        updateChannel: 'stable',
        installChannel: 'github-release',
    };
    window.nativeHandlers = {};
    window.nativeCall = async (name, args) => {
        window.calls.push([
            name, ...args
        ]);
        if (Object.hasOwn(window.nativeHandlers, name))
            return window.nativeHandlers[name](args);
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
                    missingCommands: []
                },
                clipboard: {
                    available: true,
                    missingCommands: []
                },
                ibusShortcut: {
                    setupState: 'ready',
                    available: true
                }
            };
        if (name === 'beginRuntimeStatusSession')
            return 1;
        if (name === 'loadCachedUpdateState')
            return null;
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
    if (worklet) {
        window.AudioWorkletNode = class extends Node {
          constructor() {
            super(); window.captureWorklet = this;
            this.port = {onmessage:null,postMessage:()=>queueMicrotask(()=>this.port.onmessage?.({data:{type:'flushed',complete:true}})),close(){}};
          }
        };
        window.AudioContext.prototype.createGain = () => Object.assign(new Node(), { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } });
    }
}, { worklet });
